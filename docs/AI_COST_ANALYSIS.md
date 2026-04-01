# AI Cost Analysis — ChatBridge

This document estimates the AI-related costs for developing and operating ChatBridge, an AI chat platform with third-party app integration powered by OpenAI GPT-4o with function calling.

## Quick Summary

| 100 Users | 1,000 Users | 10,000 Users | 100,000 Users |
|-----------|-------------|--------------|---------------|
| $420/month | $4,195/month | $41,950/month | $419,500/month |

*Unoptimized. With GPT-4o-mini routing + conversation summarization, costs drop 50-70%. See Section 4.*

---

## 1. Development Costs

### Assumptions

- ~500 API calls made during the full development cycle (testing chat, debugging tool calls, iterating on prompts)
- Average input per call: ~2,000 tokens (system prompt + conversation history + tool schemas for chess/weather/github)
- Average output per call: ~500 tokens (assistant responses, tool call JSON)
- Model: GPT-4o

### GPT-4o Pricing (as of March 2026)

| Component | Rate |
|-----------|------|
| Input tokens | $2.50 / 1M tokens |
| Output tokens | $10.00 / 1M tokens |

### Development Cost Estimate

| Metric | Value |
|--------|-------|
| Total API calls | 500 |
| Total input tokens | 500 x 2,000 = 1,000,000 |
| Total output tokens | 500 x 500 = 250,000 |
| Input cost | 1.0M x $2.50 = **$2.50** |
| Output cost | 0.25M x $10.00 = **$2.50** |
| **Total development AI cost** | **$5.00** |

Development AI costs are negligible. The majority of project cost is developer time, not API usage.

---

## 2. Production Cost Projections

### Assumptions

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Messages per user per day | 20 | Mix of casual and power users |
| Days active per month | 20 | Not all users are daily; average engagement |
| Messages per user per month | 400 | 20 msgs/day x 20 days |
| Tool call rate | 30% | Chess, weather, and GitHub tools triggered on ~1 in 3 messages |
| System prompt | 800 tokens | App descriptions, available tools, behavioral instructions |
| Avg user message | 50 tokens | Short conversational inputs |
| Avg assistant response | 150 tokens | Responses with explanations, sometimes tool call JSON |
| Tool schema overhead (when tools invoked) | 1,200 tokens | JSON schemas for all registered app tools sent to OpenAI |
| Avg conversation context | 1,500 tokens | Rolling window of recent messages (grows during session, summarized periodically) |
| Tool result tokens (per invocation) | 200 tokens | JSON result from chess/weather/github fed back to model |

### Per-Message Token Breakdown

**Standard message (70% of messages):**

| Component | Input Tokens | Output Tokens |
|-----------|-------------|---------------|
| System prompt | 800 | — |
| Conversation context | 1,500 | — |
| User message | 50 | — |
| Assistant response | — | 150 |
| **Subtotal** | **2,350** | **150** |

**Tool-calling message (30% of messages):**

| Component | Input Tokens | Output Tokens |
|-----------|-------------|---------------|
| System prompt | 800 | — |
| Conversation context | 1,500 | — |
| Tool schemas | 1,200 | — |
| User message | 50 | — |
| Assistant tool call | — | 100 |
| Tool result (2nd API call) | 2,350 + 200 | — |
| Assistant final response | — | 150 |
| **Subtotal** | **6,100** | **250** |

Tool-calling messages require two LLM round-trips: one to generate the tool call, and one to process the result and respond to the user.

**Weighted average per message:**
- Input: (0.70 x 2,350) + (0.30 x 6,100) = 1,645 + 1,830 = **3,475 tokens**
- Output: (0.70 x 150) + (0.30 x 250) = 105 + 75 = **180 tokens**

### Monthly AI Cost by Scale

| Scale (MAU) | Messages/Month | Input Tokens (M) | Output Tokens (M) | Input Cost | Output Cost | **Total AI Cost** |
|-------------|---------------|-------------------|--------------------|-----------:|------------:|------------------:|
| 100 | 40,000 | 139.0 | 7.2 | $347.50 | $72.00 | **$419.50** |
| 1,000 | 400,000 | 1,390.0 | 72.0 | $3,475.00 | $720.00 | **$4,195.00** |
| 10,000 | 4,000,000 | 13,900.0 | 720.0 | $34,750.00 | $7,200.00 | **$41,950.00** |
| 100,000 | 40,000,000 | 139,000.0 | 7,200.0 | $347,500.00 | $72,000.00 | **$419,500.00** |

### Infrastructure Costs

#### Supabase (Postgres Database)

| Scale (MAU) | Tier | Monthly Cost | Notes |
|-------------|------|-------------:|-------|
| 100 | Free | $0 | 500 MB storage, 2 GB transfer |
| 1,000 | Pro | $25 | 8 GB storage, 250 GB transfer |
| 10,000 | Pro | $25 - $100 | May need compute add-ons for connection pooling |
| 100,000 | Team/Enterprise | $500 - $2,000 | Dedicated compute, read replicas, higher IOPS |

#### Vercel Hosting

| Scale (MAU) | Tier | Monthly Cost | Notes |
|-------------|------|-------------:|-------|
| 100 | Hobby | $0 | Sufficient for low traffic |
| 1,000 | Pro | $20 | Better bandwidth, analytics, preview deployments |
| 10,000 | Pro | $20 - $150 | May incur bandwidth/function overage charges |
| 100,000 | Enterprise | $500 - $2,000 | Custom pricing, SLAs, dedicated support |

---

## 3. Total Cost Breakdown (Per User Per Month)

| Scale (MAU) | AI Cost/User | Infra Cost/User | **Total/User/Month** |
|-------------|-------------:|----------------:|---------------------:|
| 100 | $4.20 | $0.00 | **$4.20** |
| 1,000 | $4.20 | $0.05 | **$4.25** |
| 10,000 | $4.20 | $0.01 - $0.03 | **$4.21 - $4.23** |
| 100,000 | $4.20 | $0.01 - $0.04 | **$4.21 - $4.24** |

AI costs dominate at every scale. Infrastructure costs are negligible per user. The per-user AI cost remains essentially flat because token usage scales linearly with users.

---

## 4. Cost Optimization Strategies

### 4.1 Conversation Summarization

**Problem:** As conversations grow, the context window fills with old messages, increasing input tokens on every call.

**Solution:** After every 10-15 messages, summarize the conversation history into a compact summary (~200 tokens) using a cheap model call. Replace the full history with the summary for subsequent messages.

**Impact:** Reduces average conversation context from 1,500 to ~500 tokens. Saves ~30% on input token costs.

| Metric | Before | After |
|--------|-------:|------:|
| Avg input tokens/message | 3,475 | 2,525 |
| Monthly AI cost (1K MAU) | $4,195 | $3,095 |
| **Savings** | — | **~26%** |

### 4.2 Caching Common Queries

**Problem:** Many weather queries are identical or nearly identical ("weather in SF", "weather in New York").

**Solution:** Cache tool results for idempotent tools (weather) with a short TTL (5-15 minutes). Serve cached results without an LLM call when the query matches a known pattern.

**Impact:** Depends on query distribution. Conservatively, 10-15% of weather queries are duplicates within the cache window.

**Estimated savings:** 2-5% of total AI costs.

### 4.3 GPT-4o-mini for Routing

**Problem:** Every message goes through GPT-4o, even simple ones like "yes", "thanks", or "show me the board" that don't need advanced reasoning.

**Solution:** Use a two-stage pipeline:
1. **Router (GPT-4o-mini):** Classify the message — does it need tool calls? Is it a simple acknowledgment? Route accordingly.
2. **Main model (GPT-4o):** Only invoked for messages requiring tool calls or complex reasoning.

GPT-4o-mini pricing: $0.15/1M input, $0.60/1M output (roughly 15x cheaper on input, 16x cheaper on output).

| Metric | Before | After (60% routed to mini) |
|--------|-------:|---------------------------:|
| Monthly AI cost (1K MAU) | $4,195 | ~$1,900 |
| **Savings** | — | **~55%** |

This is the single highest-impact optimization.

### 4.4 Rate Limiting Per User

**Problem:** A small number of power users or abusive users can generate disproportionate costs.

**Solution:** Implement tiered rate limits:
- Free tier: 50 messages/day, 5 tool calls/hour
- Paid tier: 500 messages/day, 50 tool calls/hour
- Hard cap: 1,000 messages/day regardless of tier

**Impact:** Prevents runaway costs from outlier users. Reduces effective average from 20 to ~15 messages/day for free users.

### 4.5 Tool Schema Optimization

**Problem:** Sending all tool schemas (~1,200 tokens) on every tool-eligible message, even when only one app is relevant.

**Solution:** Only include tool schemas for apps that are contextually relevant (e.g., if the user is mid-chess-game, only send chess tools). Use conversation state to determine active apps.

**Impact:** Reduces tool schema tokens from 1,200 to ~400 on average. Saves ~5-8% on input costs.

---

## 5. Combined Optimization Impact

Applying all strategies together:

| Scale (MAU) | Unoptimized/User/Month | Optimized/User/Month | Savings |
|-------------|----------------------:|-----------------:|--------:|
| 100 | $4.20 | $1.50 - $2.00 | 52-64% |
| 1,000 | $4.20 | $1.50 - $2.00 | 52-64% |
| 10,000 | $4.20 | $1.30 - $1.80 | 57-69% |
| 100,000 | $4.20 | $1.10 - $1.60 | 62-74% |

At scale, aggressive caching, smarter routing, and bulk pricing negotiations with OpenAI can push per-user costs below $1.50/month.

---

## 6. Key Takeaways

1. **Development costs are trivial** — under $5 total for the entire build.
2. **AI API costs dominate production expenses** — infrastructure is <1% of total cost.
3. **GPT-4o-mini routing is the biggest lever** — routing simple messages to a cheaper model cuts costs by over 50%.
4. **Per-user costs are flat** — they don't decrease with scale unless you negotiate volume discounts or implement aggressive optimization.
5. **At 10K MAU without optimization, expect ~$42K/month in AI costs.** With optimization, this drops to $13K-$18K/month.
6. **Monetization threshold:** At $1.50-$4.20/user/month in AI costs, a subscription price of $10-$20/month yields healthy margins.
