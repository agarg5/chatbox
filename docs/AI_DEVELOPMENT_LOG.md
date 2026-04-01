# AI Development Log — ChatBridge

## Tools & Workflow

| Tool | Role | How Used |
|------|------|----------|
| Claude Code (Anthropic) | Primary coding agent | Architecture design, full-stack code generation (Next.js API routes, React components, Supabase queries, iframe postMessage protocol), debugging, documentation. Ran via CLI with persistent project context in CLAUDE.md. |
| Claude-in-Chrome (MCP) | Browser testing | Automated navigation, form input, screenshot capture, and visual verification of UI state — chat streaming, iframe loading, chess board rendering, tool call round-trips. |
| GPT-4o (OpenAI) | Product LLM | Powers the ChatBridge chatbot: natural language understanding, tool selection via function calling, streaming responses over SSE. |

**Workflow**: Full spec loaded into CLAUDE.md → session protocol (read spec → find next task → implement → test in Chrome → commit → mark done) → repeat. Each session was productive from minute one with zero re-explaining.

## MCP Usage

| MCP | What It Enabled |
|-----|----------------|
| Claude-in-Chrome | Real browser testing without leaving the CLI workflow. Verified sign-in flow, chat streaming, weather dashboard rendering, chess board display, tool call lifecycle, and multi-app tab switching — all programmatically. Caught bugs like orphaned tool_calls crashing OpenAI API and missing `conversationId` in tool result flow. |

## Effective Prompts (3-5 actual prompts that worked well)

1. **Full project spec as CLAUDE.md preamble**
   ```
   # ChatBridge — AI Chat Platform with Third-Party App Integration
   ## Architecture Decisions
   - Apps are routes within the same Next.js app, loaded in iframes
   - Tool names namespaced by app: chess__new_game, weather__get_forecast
   - postMessage protocol: TOOL_INVOKE, TOOL_RESULT, APP_COMPLETE...
   ## Endpoint Design [with full JSON request/response examples]
   ## Database Schema [with all table definitions]
   ## Task Checklist [with checkboxes]
   ```
   *Why it worked*: Every session started with full context. No re-explaining, no drift. The endpoint contracts with exact JSON shapes meant generated code matched on the first pass.

2. **"Build the GitHub Issue Tracker app following the same postMessage pattern as chess/weather"**
   *Why it worked*: Referencing existing patterns let Claude produce consistent code. The third app was built in one pass because the pattern was established.

3. **"Fix: Error 400 — An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'"**
   *Why it worked*: Pasting the exact error message led directly to the root cause analysis (orphaned tool calls in conversation history) and a targeted fix (sanitize history before sending to OpenAI).

4. **"Send conversationId with tool_call events so the client can POST tool results back for new conversations"**
   *Why it worked*: Describing the exact data flow gap (new conversation → no convId → tool result POST fails) made the fix surgical — one new SSE event type, one client-side handler.

5. **Session protocol instruction**: "At session start: Read CLAUDE.md, find the next unchecked [ ] task, and begin work. After each task: commit, test in Chrome, mark [x], then move to the next."
   *Why it worked*: Turned open-ended "build a platform" into a series of discrete, completable tasks with built-in progress tracking.

## Code Analysis

| Category | Percentage | Examples |
|----------|-----------|---------|
| AI-generated | ~85% | API routes, React components, database queries, CSS, TypeScript types, configuration, postMessage protocol handlers, documentation |
| Hand-edited | ~15% | postMessage timing edge cases, OAuth popup flow, chess AI move scoring, tool call sanitization for conversation history, UI polish |

## Strengths & Limitations

### Where AI Excelled
- **Rapid scaffolding**: Full project structure, database schema, working chat UI, and SSE streaming built in first session
- **Pattern consistency**: Once Chess was integrated end-to-end, the same patterns (tool registration, postMessage, iframe embedding) applied cleanly to Weather and GitHub with minimal adjustment
- **Bug diagnosis**: Given exact error messages, Claude identified root causes and produced targeted fixes (orphaned tool_calls, missing conversationId, React controlled input issues)
- **Documentation**: API docs, cost analysis, and this dev log generated from actual code knowledge, not boilerplate

### Where AI Struggled
- **Browser automation reliability**: Chrome extension disconnected intermittently; React controlled inputs didn't respond to programmatic `type` after state resets — required workarounds
- **Multi-step integration debugging**: The tool invocation lifecycle (LLM → SSE → client → postMessage → iframe → response → POST → continuation) had subtle timing issues that required manual testing to surface
- **Visual judgment**: UI polish, spacing, and "does this look right?" decisions needed human eyes

## Key Learnings

1. **Front-load the spec**: A detailed CLAUDE.md with endpoint contracts, DB schema, and task checklist was the single highest-leverage investment. Every session was productive immediately.
2. **Build vertically**: Completing Chess end-to-end (registration → tools → iframe → postMessage → completion signaling) before starting Weather/GitHub surfaced integration issues early and established reusable patterns.
3. **Commit frequently**: Small commits after each task made rollbacks easy and kept AI context aligned with actual codebase state.
4. **postMessage is deceptively tricky**: The protocol looks simple but debugging message ordering, origin validation, and timeout handling required careful manual testing. AI got the happy path right but edge cases needed hand-tuning.
5. **Error messages are the best prompts**: Pasting exact error output into the AI consistently produced the fastest fixes.
