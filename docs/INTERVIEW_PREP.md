# ChatBridge Interview Prep — Talking Points

## 1. Walk us through your solution at a high level. What was your overall approach?

ChatBridge is an AI chat platform where third-party apps can plug in, register tools, and communicate bidirectionally with the LLM. The core insight is treating the chat as a **router** — the LLM decides which app to invoke based on the user's message.

**Architecture in 30 seconds:**
- User sends a message to the Express backend
- Backend loads all registered tool schemas from Supabase and passes them to GPT-4o via the `tools` parameter
- GPT-4o either responds with text OR returns a function call (e.g., `chess__new_game`)
- The frontend receives the function call via SSE, spins up the app's iframe, and sends the tool invocation via `postMessage`
- The iframe app executes the tool, sends back a `TOOL_RESULT` via postMessage
- The frontend posts that result back to the server, which feeds it to GPT-4o for a final natural language response

**Four apps demonstrate different complexity levels, all designed for K-12 education:**
- **Chess** — high complexity: ongoing stateful game, bidirectional communication (board moves go back to LLM), completion signaling on checkmate
- **Flashcards** — medium complexity: LLM generates card content, students flip and rate themselves, progress tracking, bidirectional (UI clicks feed back to chat)
- **Math Quiz** — medium complexity: procedurally generated problems, adjustable difficulty, instant feedback, hints via chat, bidirectional
- **GitHub Issues** — medium complexity: OAuth2 popup flow for write access, demonstrates the authenticated app pattern

**Key design decision:** Apps are sandboxed in iframes with a typed postMessage protocol (TOOL_INVOKE, TOOL_RESULT, READY, USER_ACTION, APP_COMPLETE). This mirrors real plugin platforms like Shopify or Figma — apps control their own UI and communicate through a narrow, well-defined interface. Every app is bidirectional — students can control them through chat commands OR by interacting with the UI directly. UI interactions send USER_ACTION messages back to the chatbot, which responds with educational feedback.

**Built on a fork of Chatbox** (open-source Electron chat app). Used their React+Vite shell for the UI chrome (sidebar, themes) and added our Express server layer + plugin system on top.

---

## 2. What edge cases did you consider, and how did you handle them?

**Iframe timing and mount race conditions:**
- Iframes don't load instantly. When GPT-4o returns a tool call, the iframe might not be mounted yet. Solved with a **2-phase mount**: Phase 1 polls with `requestAnimationFrame` until the iframe DOM exists, Phase 2 waits for the app to send a `READY` postMessage signal. Only then do we send the TOOL_INVOKE. Without this, tool invocations would silently fail.

**Conversation history losing iframe state:**
- When you load a past conversation from the sidebar, the iframes are gone. Solved by scanning the message history for tool calls, extracting app IDs, and re-creating the activeApps array so iframes re-mount for historical conversations.

**OAuth inside iframes:**
- Can't do OAuth redirects inside an iframe — GitHub's X-Frame-Options blocks it. Solved with a **popup window flow**: the iframe tells the parent it needs auth, the parent opens a popup to `/api/auth/github/start`, GitHub redirects back to our callback, and the callback page uses `window.opener.postMessage` to send the token back. No tokens ever pass through the iframe directly.

**Chatbox layout bleeding into app iframes:**
- When `/apps/chess` loads in an iframe, Chatbox's root layout (sidebar, splash screen, background overlay) would wrap it. Solved by detecting `window.parent !== window && pathname.startsWith('/apps/')` in the root route and rendering just the `<Outlet />` — stripping all Chatbox chrome.

**Chatbox onboarding redirect hijacking our route:**
- Chatbox auto-redirects to `/guide` if no AI provider is configured. This killed our `/chatbridge` route. Fixed by adding `/chatbridge` to the skip list in the onboarding check.

**SSE streaming with tool call continuation:**
- When GPT-4o returns a tool call mid-stream, we need to pause, execute the tool, and then resume with a second LLM call. The server handles this by detecting tool_calls in the stream completion, emitting them as SSE events, then waiting for the client to POST the result back before making a follow-up OpenAI call.

---

## 3. If you had more time, what would you improve or do differently?

**Real chess engine:**
- Currently using a heuristic AI (piece values + position bonuses). With more time, I'd integrate Stockfish WASM in a Web Worker for proper engine-level play. The architecture supports it — just swap the `getAIMove()` function.

**Platform auth (NextAuth.js):**
- The current version has no platform-level authentication — anyone can access any conversation. Would add NextAuth.js with GitHub OAuth for platform login, then scope conversations to users via `user_id` foreign keys.

**WebSocket for real-time:**
- SSE is unidirectional (server→client). For features like collaborative chess or live app state sync, WebSockets would be better. Current architecture uses POST for client→server which adds latency.

**App marketplace / dynamic registration:**
- Right now apps are bootstrapped at server startup. A real platform would have a developer portal where third parties register apps, submit tool schemas, and get API keys — all through the existing `/api/apps/register` endpoint which is already built but not exposed in the UI.

**Better error recovery:**
- If an iframe crashes or a tool times out, the UX is rough. Would add retry logic, graceful degradation (show the LLM response even if the iframe fails), and app health monitoring.

**Testing:**
- The original Next.js repo has 18 integration tests. The Chatbox fork needs its own test suite — especially for the postMessage protocol and SSE streaming. Would use Playwright for E2E tests of the full flow.

---

## 4. What was the most challenging part of this problem, and how did you overcome it?

**The hardest part was integrating our server-side plugin system into a client-only app.**

Chatbox is an Electron app designed to run entirely in the browser with localStorage persistence. It has no server, no database, no API routes. Our ChatBridge needs all of those — OpenAI function calling, Supabase persistence, OAuth flows, SSE streaming.

**The solution was a hybrid architecture:**
- Added an Express server alongside Vite (port 3001), with Vite proxying `/api/*` calls to Express
- Created a standalone `vite.web.config.ts` that bypasses electron-vite entirely, building only the renderer for web
- Added our `/chatbridge` route as a TanStack Router page that uses our own backend instead of Chatbox's provider system

**The second biggest challenge was the iframe lifecycle.** Getting iframes to mount, signal readiness, receive tool invocations, and return results — all in the right order — required careful async orchestration. The 2-phase mount (requestAnimationFrame polling + READY signal) was the breakthrough. Before that, about 30% of tool invocations would silently fail because the iframe wasn't ready.

**Deployment was also tricky.** Chatbox + Express doesn't fit neatly into Vercel's model (which expects Next.js or static sites). Solved by:
- Building the Vite frontend as static files
- Exporting the entire Express app as a single Vercel Serverless Function at `api/index.ts`
- Using `vercel.json` rewrites to route `/api/*` to the function and `/*` to the SPA

The approach of keeping maximum compatibility with the upstream Chatbox (their sidebar, theme system, router) while grafting on a completely different backend architecture was the core engineering challenge. The key insight was to **work with Chatbox's patterns** (TanStack Router, Jotai, Mantine) rather than fight them.
