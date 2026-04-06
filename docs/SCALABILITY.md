# Scalability Analysis: 200,000 Students, Unpredictable Third-Party Apps

## The Problem

The case study describes 200,000 students on the platform. The critical scenario: thousands of students return from recess at the same time and start interacting. Each conversation may invoke a third-party app (flashcards, math quiz, chess) via an iframe, and **we don't know how long the app will take to respond**. A flashcard deck creation returns in milliseconds, but a chess AI move could take seconds, and a poorly-built third-party app could hang indefinitely.

## Current Architecture Bottlenecks

Tracing a single tool-calling conversation through the system reveals three resource-holding phases:

```
1. POST /api/chat → SSE stream open → OpenAI streams tokens → tool_call event emitted
   [Server holds: HTTP connection + OpenAI API connection]
   
2. Client receives tool_call → postMessage to iframe → WAITS for TOOL_RESULT
   [Server holds: nothing (client-side wait)]
   
3. POST /api/chat/:id/tool-result → SSE stream open → OpenAI continues
   [Server holds: HTTP connection + OpenAI API connection]
```

**Key insight:** Phase 2 (waiting for the third-party app) happens entirely client-side. The server connection from Phase 1 has already closed. This is actually better than it first appears — the server isn't blocking on third-party app latency. But Phases 1 and 3 each hold an open SSE connection and an OpenAI API call for the full duration of token streaming.

**Actual bottlenecks at 1000+ concurrent users:**

1. **OpenAI API rate limits** — GPT-4o has tokens-per-minute and requests-per-minute caps. 1000 simultaneous conversations could hit these limits.
2. **Open HTTP connections** — Each SSE stream is a long-lived connection. Express on a single Vercel Function can handle this via Fluid Compute, but there's a ceiling.
3. **Supabase connection pool** — Every request reads/writes conversation history. 1000 concurrent queries strain the connection pool.
4. **Burst traffic pattern** — The "back from recess" scenario is a spike, not steady state. The system needs to absorb the burst without dropping requests.

## Proposed Solutions

### 1. Queue-Based LLM Calls (Highest Impact)

The single biggest improvement: don't call OpenAI synchronously. Instead:

```
Client sends message → Server enqueues job → Returns job ID immediately
Worker picks up job → Calls OpenAI → Streams result to client via WebSocket/polling
```

**Implementation:**
- Use a message queue (Redis, Vercel Queues, SQS) between the API and OpenAI
- Workers pull from the queue at a rate that respects OpenAI rate limits
- Client receives a job ID and either polls or subscribes via WebSocket
- During burst traffic, the queue absorbs the spike — students see "Thinking..." with a position indicator instead of a timeout

**Why this matters:** Without a queue, 1000 simultaneous requests all hit OpenAI's API at once and most get rate-limited (429 errors). With a queue, requests are processed at the maximum safe rate and the burst is smoothed over 30-60 seconds.

### 2. Decouple Tool Results from SSE Connections

Currently, when tool results come back, the client opens a new SSE stream for the LLM continuation. Under load, this means 1000 tool-result POST requests each opening a new streaming connection.

**Better approach:**
- Client sends tool results via a simple POST (non-streaming)
- Server enqueues the continuation
- Client receives the response via the same WebSocket/polling channel from Solution 1
- This eliminates the second SSE connection per tool call

### 3. Client-Side App Timeout + Circuit Breaker

We already have 10s/30s timeouts on tool invocations. At scale, add:

- **Circuit breaker per app**: If an app fails 5 times in 60 seconds, stop invoking it and tell the LLM "this app is temporarily unavailable." This prevents a broken third-party app from cascading failures across the platform.
- **Graceful degradation**: If a tool invocation times out, the chatbot continues the conversation without the result: "The flashcard app is taking a moment. While we wait, let me tell you about the solar system..."
- **Client-side retry with exponential backoff**: If the iframe doesn't send READY in time, retry once before showing an error.

### 4. Caching and Pre-computation

Some work doesn't need to happen in real-time:

- **Flashcard deck caching**: Popular topics (solar system, US presidents, multiplication tables) can be pre-generated and cached. When the LLM calls `create_deck` with a common topic, serve the cached version instead of waiting for GPT-4o to generate 10 cards.
- **Math quiz is already client-side**: Problems are generated procedurally in the browser — no server load. This was a deliberate design choice.
- **LLM response caching**: For identical or near-identical prompts (many students asking "quiz me on the solar system"), cache the function call response. The tool schema + system prompt + user message often produces the same tool call.

### 5. Connection Pooling and Backpressure

- **Supabase connection pooling**: Use PgBouncer (Supabase offers this) to multiplex thousands of client connections over a smaller pool of actual database connections.
- **OpenAI API key rotation**: Distribute requests across multiple API keys to increase effective rate limits.
- **Backpressure signaling**: When the queue is deep, return estimated wait times to the client. Students see "Your tutor is helping other students. Estimated wait: 15 seconds" instead of a spinner that might time out.

### 6. Horizontal Scaling (Vercel-Specific)

On Vercel with Fluid Compute:
- **Functions scale automatically**: Each incoming request can be handled by a new or reused function instance. No single Express server bottleneck.
- **Stateless by design**: Conversation state is in Supabase, not in-memory. Any function instance can handle any request.
- **Regional deployment**: Deploy functions in regions close to the school districts using the platform (e.g., us-east for East Coast schools). Reduces latency.

### 7. WebSocket Upgrade for Real-Time Apps

For the "back from recess" burst scenario, replace per-request SSE with persistent WebSocket connections:

- Students open WebSocket when they navigate to /chatbridge
- All messages, tool calls, and tool results flow over one connection
- Eliminates HTTP connection overhead for each interaction
- Server can push "app unavailable" or "high traffic" notices proactively

## Priority Order for Implementation

| Priority | Solution | Impact | Effort |
|----------|----------|--------|--------|
| 1 | Queue-based LLM calls | Prevents rate limit failures | Medium |
| 2 | Supabase connection pooling | Prevents DB connection exhaustion | Low |
| 3 | Flashcard/response caching | Reduces LLM calls by ~30% for common topics | Low |
| 4 | Circuit breaker per app | Prevents cascade from broken apps | Low |
| 5 | WebSocket upgrade | Reduces connection overhead | Medium |
| 6 | Backpressure/wait-time UI | Better UX under load | Low |
| 7 | Multi-region deployment | Reduces latency | Low (Vercel handles it) |

## Key Takeaway

The most important insight is that **the third-party app wait happens client-side, not server-side** — our current architecture accidentally got this right. The iframe postMessage model means the server isn't holding a connection while waiting for a chess move or a flashcard flip. The real scalability bottleneck is the LLM API itself, and the solution is a queue that smooths burst traffic into a steady stream that respects rate limits while giving students clear feedback about wait times.
