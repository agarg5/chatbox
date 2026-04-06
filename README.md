# ChatBridge (Chatbox Fork)

AI chat platform with third-party app integration, built on top of [Chatbox](https://github.com/chatboxai/chatbox). Apps plug in, register tools, render custom UI via iframes, and communicate bidirectionally with the chatbot.

Built for [Gauntlet AI](https://gauntletai.com).

**Deployed:** https://chatbridge-seven.vercel.app

## Case Study Analysis

TutorMeAI's core challenge isn't building a chatbot — it's building a platform boundary that lets unknown third-party code run safely inside a conversation while keeping the chatbot aware of what's happening. This is fundamentally a trust problem wrapped in an engineering problem.

**Key Problems.** The first problem is sandboxing untrusted code in a K-12 context. When a third-party app runs inside the chat, it has proximity to student data: conversation history, user identity, and the ability to render arbitrary UI. A malicious or poorly-built app could exfiltrate student information, display inappropriate content, or impersonate the chatbot. In an education setting with minors, the consequences of getting this wrong aren't just technical — they're legal (COPPA, FERPA) and reputational. The second problem is bidirectional state awareness. The chatbot needs to know what's happening inside an app it doesn't control. When a student plays chess and asks "what should I do here?", the chatbot must query the board state from an app that manages its own internal logic. This means defining a communication protocol flexible enough for any app — from a simple calculator to a multi-step physics simulation — without requiring the platform to understand each app's domain. The third problem is completion signaling: how does the platform know when a third-party interaction is "done"? A chess game has a clear end state (checkmate), but a flashcard set or math quiz might not.

**Tradeoffs.** We chose iframes with postMessage over Web Components or server-side rendering for app sandboxing. Iframes provide real browser-level isolation — the app can't access the parent DOM, cookies, or JavaScript context. The tradeoff is performance (each iframe is a separate page load) and communication complexity (postMessage is asynchronous and untyped by default). For a K-12 platform where safety matters more than milliseconds, this is the right call. We chose LLM function calling for tool discovery rather than a custom routing layer, meaning the chatbot decides when to invoke an app based on natural language intent. The tradeoff is non-determinism — we mitigate this with explicit routing rules in the system prompt.

**Ethical Decisions.** In a K-12 context, we default to restrictive rather than permissive. Apps run in sandboxed iframes with `allow-scripts allow-same-origin` but no access to camera, microphone, or geolocation. The platform validates tool schemas at registration time. OAuth tokens are stored server-side and never exposed to the client. When an app misbehaves, the chatbot acknowledges the error and continues — a student shouldn't be left staring at a broken screen.

**What We Landed On.** A single-agent architecture where one LLM routes to sandboxed iframe apps via a typed postMessage protocol, with app state living entirely in the iframe and the platform maintaining conversation context in a persistent database. This keeps the platform simple, the apps independent, and the security boundary clear. It's not the most sophisticated architecture possible, but it's one we can reason about, test, and trust — which matters more when the users are children.

## Architecture

```
Browser (Chatbox + Vite)               Express API Server           External Services
┌──────────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Chatbox UI (sidebar,    │     │  POST /api/chat      │     │  OpenAI GPT-4o  │
│  theme, dark mode)       │────>│  (SSE streaming)     │────>│  (function call) │
│                          │<────│                      │<────│                  │
│  /chatbridge (chat UI)   │     │  POST /api/chat/     │     │  Supabase        │
│                          │     │   :id/tool-result    │     │  (Postgres)      │
│  /apps/chess      (iframe)│     │                      │     │                  │
│  /apps/flashcards (iframe)│     │  GET /api/apps       │     │  GitHub API      │
│  /apps/math       (iframe)│     │  GET /api/bootstrap  │     │                  │
│  /apps/github     (iframe)│     │                      │     │                  │
└──────────────────────────┘     └──────────────────────┘     └─────────────────┘
         │        ▲
         │ postMessage (TOOL_INVOKE / TOOL_RESULT / READY / USER_ACTION / APP_COMPLETE)
         ▼        │
    ┌──────────────┐
    │  App iframe   │
    │  (chess,      │
    │  flashcards,  │
    │  math, github)│
    └──────────────┘
```

**Two processes run in dev:**
- **Vite** (`:1212`) — serves the Chatbox React SPA with our ChatBridge routes
- **Express** (`:3001`) — API server (chat, apps, auth). Vite proxies `/api/*` to Express.

## What Changed From Upstream Chatbox

- Added `vite.web.config.ts` — standalone Vite config (bypasses electron-vite)
- Added `server/` — Express API server with OpenAI streaming, Supabase, app registry, GitHub OAuth
- Added `/chatbridge` route — our chat UI with inline iframe app rendering
- Added `/apps/{chess,flashcards,math,github}` routes — four plugin apps as TanStack routes
- Modified `__root.tsx` — strips Chatbox layout when rendering inside iframes
- Modified `index.tsx` — fast-path for iframe apps (skips Chatbox init/splash)
- Kept: Chatbox sidebar, theme system, dark mode, conversation list UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Chatbox (React 18, Vite, TanStack Router, Tailwind CSS, Mantine) |
| Backend | Express.js API server |
| AI/LLM | OpenAI GPT-4o with function calling |
| Database | Supabase (Postgres) |
| Real-time | SSE (chat streaming), postMessage (iframe communication) |
| Chess | chess.js (logic) + react-chessboard v4 (UI) — client-side only |
| Flashcards | LLM-generated card content, interactive flip/rate UI |
| Math Quiz | Procedurally generated problems, adjustable difficulty |
| GitHub | GitHub REST API + OAuth2 popup flow |

## Third-Party Apps

All apps are **interactive and bidirectional** — students can control them through chat or by clicking in the UI. UI interactions are sent back to the chatbot via USER_ACTION, and the chatbot responds with encouragement and educational feedback.

### Chess (Complex State, Bidirectional)
Interactive chess game with built-in AI opponent. Tools: `new_game`, `get_board_state`, `make_move`, `get_hint`. Board moves auto-send to LLM. Signals completion on checkmate/draw.

### Flashcards (K-12 Educational, Interactive)
Study flashcards on any subject. The LLM generates age-appropriate card content. Tools: `create_deck`, `flip_card`, `next_card`, `prev_card`, `get_progress`. Students flip cards and rate themselves (knew it / still learning). Progress tracked with completion signal.

### Math Quiz (K-12 Educational, Interactive)
Practice math with procedurally generated problems in addition, subtraction, multiplication, division, and fractions. Adjustable difficulty levels for K-12 students. Tools: `start_quiz`, `submit_answer`, `get_hint`, `skip_problem`, `get_score`. Students answer in the UI, get instant feedback, and the chatbot explains incorrect answers.

### GitHub Issue Tracker (OAuth2 Authentication)
Browse, create, and search GitHub issues. Public repos work without auth. OAuth2 popup flow for write operations. Tools: `list_issues`, `create_issue`, `get_issue`, `search_issues`.

## Setup

### Prerequisites
- Node.js 20+
- pnpm 10+
- Supabase project
- OpenAI API key
- GitHub OAuth app (optional, for GitHub write operations)

### Environment Variables

Create `.env` in the project root:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-...
GITHUB_CLIENT_ID=your-github-client-id       # optional
GITHUB_CLIENT_SECRET=your-github-client-secret # optional
```

### Database Setup

Run the SQL in your Supabase dashboard:
```sql
CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, name TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), title TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID REFERENCES conversations(id), role TEXT NOT NULL, content TEXT, tool_calls JSONB, tool_call_id TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, iframe_url TEXT, auth_type TEXT DEFAULT 'none', enabled BOOLEAN DEFAULT true, api_key TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE app_tools (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), app_id TEXT REFERENCES apps(id), name TEXT NOT NULL, description TEXT, parameters_schema JSONB);
CREATE TABLE app_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID REFERENCES conversations(id), app_id TEXT REFERENCES apps(id), state_snapshot JSONB, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE app_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id), app_id TEXT REFERENCES apps(id), access_token_enc TEXT, refresh_token_enc TEXT, expires_at TIMESTAMPTZ);
CREATE TABLE tool_invocations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID, app_id TEXT, tool_name TEXT, params JSONB, result JSONB, status TEXT DEFAULT 'pending', duration_ms INTEGER, created_at TIMESTAMPTZ DEFAULT now());
```

### Install & Run

```bash
pnpm install
pnpm run dev:chatbridge
```

This starts both the Vite frontend (`:1212`) and Express API (`:3001`).

Open [http://localhost:1212/chatbridge](http://localhost:1212/chatbridge).

Apps auto-bootstrap on server start (chess, flashcards, math, GitHub registered in Supabase).

## Project Structure

```
server/                              # Express API server
├── index.ts                         # All API routes + GitHub OAuth
├── supabase.ts                      # Supabase client
├── openai.ts                        # OpenAI client + system prompt
└── bootstrap-apps.ts                # App manifest + auto-registration

src/renderer/routes/
├── chatbridge/index.tsx             # Main ChatBridge chat UI
├── apps/
│   ├── chess/index.tsx              # Chess app (iframe)
│   ├── flashcards/index.tsx         # Flashcards app (iframe)
│   ├── math/index.tsx               # Math Quiz app (iframe)
│   └── github/index.tsx             # GitHub app (iframe)
├── __root.tsx                       # Modified: strips layout for iframe apps
└── index.tsx                        # Chatbox home (unchanged)

src/renderer/index.tsx               # Modified: fast-path for iframe app init

vite.web.config.ts                   # Standalone Vite config for web mode
docs/                                # API docs, case study, dev log, demo script
```

## API Documentation

See [docs/API.md](docs/API.md) for the full API reference.

## Additional Documents

- [API Documentation](docs/API.md)
- [AI Cost Analysis](docs/AI_COST_ANALYSIS.md)
- [AI Development Log](docs/AI_DEVELOPMENT_LOG.md)
- [Case Study Analysis](docs/CASE_STUDY_ANALYSIS.md)
- [Scalability Analysis](docs/SCALABILITY.md)
- [Demo Script](docs/DEMO_SCRIPT.md)

## Original Chatbox

This project is a fork of [chatboxai/chatbox](https://github.com/chatboxai/chatbox) (GPLv3). The original Chatbox UI (sidebar, theme, settings) is preserved as the shell for our ChatBridge integration.

## License

GPLv3 (inherited from Chatbox)
