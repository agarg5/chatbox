# ChatBridge API Documentation

## Table of Contents

- [Overview](#overview)
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Chat API](#chat-api)
  - [Send Message (POST /api/chat)](#send-message)
  - [List Conversations (GET /api/chat)](#list-conversations)
  - [Get Conversation (GET /api/chat/:conversationId)](#get-conversation)
  - [Submit Tool Results (POST /api/chat/:conversationId/tool-result)](#submit-tool-results)
- [App Registry API](#app-registry-api)
  - [Register App (POST /api/apps/register)](#register-app)
  - [List Apps (GET /api/apps)](#list-apps)
  - [Get App Details (GET /api/apps/:appId)](#get-app-details)
  - [Get App Tools (GET /api/apps/:appId/tools)](#get-app-tools)
  - [Invoke Tool (POST /api/apps/:appId/invoke)](#invoke-tool)
  - [Signal Completion (POST /api/apps/:appId/complete)](#signal-completion)
- [Session Context API](#session-context-api)
  - [Get Session Context (GET /api/sessions/:conversationId/context)](#get-session-context)
- [Bootstrap API](#bootstrap-api)
- [GitHub OAuth API](#github-oauth-api)
  - [Start OAuth Flow (GET /api/auth/github/start)](#start-oauth-flow)
  - [OAuth Callback (GET /api/auth/github/callback)](#oauth-callback)
- [SSE Event Types](#sse-event-types)
- [postMessage Protocol](#postmessage-protocol)
- [Error Codes](#error-codes)
- [Third-Party App Developer Guide](#third-party-app-developer-guide)

---

## Overview

ChatBridge is an AI chat platform where third-party apps can register tools, render UI via iframes, and communicate bidirectionally with the AI chatbot. The platform uses OpenAI GPT-4o with function calling to intelligently route user requests to the appropriate app tools.

The API has two communication layers:

1. **REST API** -- For app registration, tool invocation, and server-side integrations.
2. **postMessage Protocol** -- For real-time communication between iframe-based apps and the platform.

All chat responses are streamed via Server-Sent Events (SSE). Tool names are namespaced by app using the `{appId}__{toolName}` convention (double underscore separator).

---

## Base URL

```
Development: http://localhost:3000
Production:  https://chatbridge.vercel.app
```

---

## Authentication

### Platform Authentication

ChatBridge uses NextAuth.js with a GitHub OAuth provider for platform-level authentication. Currently, a demo user (`demo@chatbridge.dev`) is used as the default when no auth session is present.

### Per-App Authentication (OAuth2 Popup Flow)

Apps that require user-specific credentials (e.g., GitHub Issue Tracker) use a popup-based OAuth flow:

1. The platform opens a popup window to `/api/auth/github/start`.
2. The user authorizes the app on GitHub.
3. GitHub redirects back to `/api/auth/github/callback`.
4. The callback page sends the access token to the parent window via `window.opener.postMessage()` and closes itself.

### App API Keys

Each registered app receives a unique API key (`cb_live_...`) upon registration. This key can be used to authenticate server-side API calls from the app.

---

## Chat API

### Send Message

Send a message to the AI chatbot and receive a streamed response.

```
POST /api/chat
Content-Type: application/json
```

**Request Body:**

| Field            | Type   | Required | Description                                      |
|------------------|--------|----------|--------------------------------------------------|
| `message`        | string | Yes      | The user's message                               |
| `conversationId` | string | No       | Existing conversation ID. Omit to start a new conversation. |

**Example:**

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Let'\''s play chess! I want to be white."
  }'
```

**Response:** Server-Sent Events stream (`text/event-stream`). See [SSE Event Types](#sse-event-types) for the full event schema.

**Example SSE stream:**

```
data: {"type":"text_delta","content":"Sure"}
data: {"type":"text_delta","content":", let me start a new game for you!"}
data: {"type":"tool_call","toolName":"chess__new_game","params":{"color":"white"},"invocationId":"call_abc123","appId":"chess","rawToolName":"new_game"}
```

When a new conversation is created, the title is auto-generated from the first 50 characters of the message.

---

### List Conversations

Retrieve all conversations, ordered by most recently updated.

```
GET /api/chat
```

**Example:**

```bash
curl http://localhost:3000/api/chat
```

**Response (200):**

```json
{
  "conversations": [
    {
      "id": "a1b2c3d4-...",
      "title": "Let's play chess!",
      "created_at": "2026-03-20T12:00:00Z",
      "updated_at": "2026-03-20T12:05:00Z"
    }
  ]
}
```

---

### Get Conversation

Retrieve a conversation's full message history.

```
GET /api/chat/:conversationId
```

**Example:**

```bash
curl http://localhost:3000/api/chat/a1b2c3d4-5678-90ab-cdef-1234567890ab
```

**Response (200):**

```json
{
  "id": "a1b2c3d4-...",
  "title": "Let's play chess!",
  "created_at": "2026-03-20T12:00:00Z",
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "Let's play chess!",
      "tool_calls": null,
      "tool_call_id": null,
      "created_at": "2026-03-20T12:00:01Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Sure! I've started a new game.",
      "tool_calls": [
        {
          "id": "call_abc",
          "type": "function",
          "function": {
            "name": "chess__new_game",
            "arguments": "{\"color\":\"white\"}"
          }
        }
      ],
      "tool_call_id": null,
      "created_at": "2026-03-20T12:00:03Z"
    },
    {
      "id": "msg_003",
      "role": "tool",
      "content": "{\"gameId\":\"game_1\",\"fen\":\"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\"}",
      "tool_calls": null,
      "tool_call_id": "call_abc",
      "created_at": "2026-03-20T12:00:04Z"
    }
  ]
}
```

**Error (404):**

```json
{
  "error": "NOT_FOUND",
  "message": "Conversation 'xyz' not found"
}
```

---

### Submit Tool Results

After the client receives `tool_call` SSE events and the iframe app processes them, submit the tool results back so the LLM can continue generating a response.

```
POST /api/chat/:conversationId/tool-result
Content-Type: application/json
```

**Request Body:**

| Field         | Type  | Required | Description                                |
|---------------|-------|----------|--------------------------------------------|
| `toolResults` | array | Yes      | Array of tool result objects                |

Each item in `toolResults`:

| Field        | Type   | Required | Description                                     |
|--------------|--------|----------|-------------------------------------------------|
| `toolCallId` | string | Yes      | The `invocationId` from the `tool_call` SSE event |
| `result`     | object | Yes      | The tool's result payload                        |

**Example:**

```bash
curl -N -X POST http://localhost:3000/api/chat/a1b2c3d4-.../tool-result \
  -H "Content-Type: application/json" \
  -d '{
    "toolResults": [
      {
        "toolCallId": "call_abc123",
        "result": {
          "gameId": "game_1",
          "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
          "status": "in_progress"
        }
      }
    ]
  }'
```

**Response:** SSE stream (`text/event-stream`) -- the LLM continues responding with the tool results in context. The stream format is identical to `POST /api/chat`.

---

## App Registry API

### Register App

Register a new third-party app with its tool definitions.

```
POST /api/apps/register
Content-Type: application/json
```

**Request Body:**

| Field         | Type   | Required | Description                                |
|---------------|--------|----------|--------------------------------------------|
| `name`        | string | Yes      | Display name of the app                     |
| `description` | string | No       | Short description of the app                |
| `iframeUrl`   | string | Yes      | URL to load in the iframe (can be relative) |
| `auth`        | object | No       | Auth config. Default: `{ "type": "none" }`  |
| `auth.type`   | string | No       | One of: `"none"`, `"api_key"`, `"oauth2"`   |
| `tools`       | array  | No       | Array of tool definitions                   |

Each item in `tools`:

| Field         | Type   | Required | Description                                    |
|---------------|--------|----------|------------------------------------------------|
| `name`        | string | Yes      | Tool name (will be namespaced as `{appId}__{name}`) |
| `description` | string | No       | Description shown to the LLM                   |
| `parameters`  | object | No       | JSON Schema for tool parameters                |

**Example:**

```bash
curl -X POST http://localhost:3000/api/apps/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weather",
    "description": "Get weather forecasts for any location",
    "iframeUrl": "/apps/weather",
    "auth": { "type": "none" },
    "tools": [
      {
        "name": "get_current_weather",
        "description": "Get the current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "City name, e.g. San Francisco"
            }
          },
          "required": ["location"]
        }
      },
      {
        "name": "get_forecast",
        "description": "Get a multi-day weather forecast",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" },
            "days": { "type": "integer", "minimum": 1, "maximum": 14 }
          },
          "required": ["location"]
        }
      }
    ]
  }'
```

**Response (201):**

```json
{
  "id": "weather",
  "apiKey": "cb_live_a1b2c3d4e5f6...",
  "name": "Weather",
  "description": "Get weather forecasts for any location",
  "iframeUrl": "/apps/weather",
  "auth": { "type": "none" },
  "tools": [ ... ],
  "createdAt": "2026-03-20T12:00:00Z"
}
```

The `id` is auto-generated as a URL-safe slug from the app name (lowercased, non-alphanumeric characters replaced with hyphens).

**Error (400):**

```json
{
  "error": "INVALID_SCHEMA",
  "message": "name and iframeUrl are required"
}
```

**Error (409):**

```json
{
  "error": "APP_EXISTS",
  "message": "App with name 'Weather' already registered"
}
```

---

### List Apps

Retrieve all registered apps with their tool counts.

```
GET /api/apps
```

**Example:**

```bash
curl http://localhost:3000/api/apps
```

**Response (200):**

```json
{
  "apps": [
    {
      "id": "chess",
      "name": "Chess",
      "description": "Play chess against an AI opponent",
      "iframeUrl": "/apps/chess",
      "auth": { "type": "none" },
      "enabled": true,
      "toolCount": 4
    },
    {
      "id": "weather",
      "name": "Weather",
      "description": "Get weather forecasts for any location",
      "iframeUrl": "/apps/weather",
      "auth": { "type": "none" },
      "enabled": true,
      "toolCount": 2
    },
    {
      "id": "github",
      "name": "GitHub Issue Tracker",
      "description": "Manage GitHub issues",
      "iframeUrl": "/apps/github",
      "auth": { "type": "oauth2" },
      "enabled": true,
      "toolCount": 4
    }
  ]
}
```

---

### Get App Details

Retrieve full details for a specific app, including all tool definitions.

```
GET /api/apps/:appId
```

**Example:**

```bash
curl http://localhost:3000/api/apps/chess
```

**Response (200):**

```json
{
  "id": "chess",
  "name": "Chess",
  "description": "Play chess against an AI opponent",
  "iframeUrl": "/apps/chess",
  "auth": { "type": "none" },
  "enabled": true,
  "tools": [
    {
      "name": "new_game",
      "description": "Start a new chess game",
      "parameters": {
        "type": "object",
        "properties": {
          "color": { "type": "string", "enum": ["white", "black"] },
          "difficulty": { "type": "integer", "minimum": 1, "maximum": 10 }
        },
        "required": ["color"]
      }
    },
    {
      "name": "get_board_state",
      "description": "Get the current board position and game status",
      "parameters": { "type": "object", "properties": {} }
    },
    {
      "name": "make_move",
      "description": "Make a chess move",
      "parameters": {
        "type": "object",
        "properties": {
          "from": { "type": "string", "description": "Square to move from, e.g. 'e2'" },
          "to": { "type": "string", "description": "Square to move to, e.g. 'e4'" }
        },
        "required": ["from", "to"]
      }
    },
    {
      "name": "get_hint",
      "description": "Get a suggested move for the current position",
      "parameters": { "type": "object", "properties": {} }
    }
  ],
  "createdAt": "2026-03-20T12:00:00Z"
}
```

**Error (404):**

```json
{
  "error": "NOT_FOUND",
  "message": "App 'xyz' not found"
}
```

---

### Get App Tools

Retrieve just the tool definitions for a specific app.

```
GET /api/apps/:appId/tools
```

**Example:**

```bash
curl http://localhost:3000/api/apps/weather/tools
```

**Response (200):**

```json
{
  "appId": "weather",
  "tools": [
    {
      "name": "get_current_weather",
      "description": "Get the current weather for a location",
      "parameters": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      }
    },
    {
      "name": "get_forecast",
      "description": "Get a multi-day weather forecast",
      "parameters": {
        "type": "object",
        "properties": {
          "location": { "type": "string" },
          "days": { "type": "integer", "minimum": 1, "maximum": 14 }
        },
        "required": ["location"]
      }
    }
  ]
}
```

**Error (404):**

```json
{
  "error": "NOT_FOUND",
  "message": "App 'xyz' not found"
}
```

---

### Invoke Tool

Directly invoke a tool on an app via the REST API. This creates a pending invocation record. Primarily used by server-side apps or external integrations (iframe apps use the postMessage protocol instead).

```
POST /api/apps/:appId/invoke
Content-Type: application/json
```

**Request Body:**

| Field            | Type   | Required | Description                              |
|------------------|--------|----------|------------------------------------------|
| `toolName`       | string | Yes      | Tool name (without the app namespace)    |
| `params`         | object | No       | Parameters to pass to the tool           |
| `conversationId` | string | No       | Associated conversation ID               |

**Example:**

```bash
curl -X POST http://localhost:3000/api/apps/chess/invoke \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "new_game",
    "params": { "color": "white", "difficulty": 5 },
    "conversationId": "a1b2c3d4-..."
  }'
```

**Response (201):**

```json
{
  "invocationId": "inv_a1b2c3d4e5f6...",
  "appId": "chess",
  "toolName": "new_game",
  "status": "pending"
}
```

**Error (400):**

```json
{ "error": "MISSING_FIELD", "message": "toolName is required" }
```

**Error (403):**

```json
{ "error": "APP_DISABLED", "message": "App 'chess' is currently disabled" }
```

**Error (404):**

```json
{ "error": "TOOL_NOT_FOUND", "message": "Tool 'invalid_tool' not found for app 'chess'" }
```

---

### Signal Completion

Signal that an app has completed its task (e.g., a chess game ended). Updates or creates an app session record in the database.

```
POST /api/apps/:appId/complete
Content-Type: application/json
```

**Request Body:**

| Field            | Type   | Required | Description                                 |
|------------------|--------|----------|---------------------------------------------|
| `result`         | object | Yes      | Completion result payload                   |
| `conversationId` | string | No       | Associated conversation ID (for session tracking) |

**Example:**

```bash
curl -X POST http://localhost:3000/api/apps/chess/complete \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "a1b2c3d4-...",
    "result": {
      "outcome": "checkmate",
      "winner": "white",
      "totalMoves": 42,
      "finalFen": "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 42"
    }
  }'
```

**Response (200):**

```json
{
  "status": "accepted",
  "appId": "chess"
}
```

If a `conversationId` is provided, the endpoint updates the existing `app_sessions` record to `"completed"` status, or creates a new completed session record if none exists.

**Error (400):**

```json
{ "error": "MISSING_FIELD", "message": "result is required" }
```

**Error (404):**

```json
{ "error": "NOT_FOUND", "message": "App 'xyz' not found" }
```

---

## Session Context API

### Get Session Context

Retrieve full session context for a conversation, including active apps, recent tool invocations, and app completions. Useful for debugging or providing context to the LLM.

```
GET /api/sessions/:conversationId/context
```

**Example:**

```bash
curl http://localhost:3000/api/sessions/a1b2c3d4-.../context
```

**Response (200):**

```json
{
  "conversationId": "a1b2c3d4-...",
  "userId": "user_001",
  "messageCount": 12,
  "activeApps": [
    {
      "appId": "chess",
      "status": "active",
      "stateSnapshot": { "fen": "rnbqkbnr/...", "moveCount": 15 },
      "lastInvocation": {
        "toolName": "chess__make_move",
        "params": { "from": "e2", "to": "e4" },
        "result": { "fen": "...", "status": "in_progress" },
        "timestamp": "2026-03-20T12:05:00Z"
      }
    }
  ],
  "recentToolInvocations": [
    {
      "id": "inv_001",
      "appId": "chess",
      "toolName": "chess__new_game",
      "status": "success",
      "durationMs": 245,
      "timestamp": "2026-03-20T12:00:03Z"
    }
  ],
  "appCompletions": [
    {
      "appId": "weather",
      "result": { "temperature": 72, "condition": "sunny" },
      "timestamp": "2026-03-20T11:55:00Z"
    }
  ]
}
```

**Error (404):**

```json
{
  "error": "NOT_FOUND",
  "message": "Conversation 'xyz' not found"
}
```

---

## Bootstrap API

Trigger registration of all default apps (Chess, Weather, GitHub Issue Tracker) from their manifest files. Typically called once on initial setup.

```
GET /api/bootstrap
```

**Example:**

```bash
curl http://localhost:3000/api/bootstrap
```

**Response (200):**

```json
{ "status": "ok" }
```

---

## GitHub OAuth API

These endpoints implement the popup-based OAuth2 flow for the GitHub Issue Tracker app.

### Start OAuth Flow

Redirects the user to GitHub's authorization page. Should be opened in a popup window via `window.open()`.

```
GET /api/auth/github/start
```

**Flow:**

1. Generates a random `state` parameter for CSRF protection.
2. Sets a `github_oauth_state` cookie (httpOnly, 10-minute expiry).
3. Redirects to `https://github.com/login/oauth/authorize` with:
   - `client_id` from `GITHUB_CLIENT_ID` env var
   - `redirect_uri` pointing to `/api/auth/github/callback`
   - `scope`: `repo read:user`

**Example (JavaScript):**

```javascript
const popup = window.open(
  '/api/auth/github/start',
  'github-auth',
  'width=600,height=700'
);
```

### OAuth Callback

Handles the GitHub OAuth callback. Exchanges the authorization code for an access token and sends it to the parent window.

```
GET /api/auth/github/callback
```

**Query Parameters (set by GitHub):**

| Parameter | Description                          |
|-----------|--------------------------------------|
| `code`    | Authorization code from GitHub       |
| `state`   | CSRF state parameter                 |
| `error`   | Error code if authorization failed   |

**Behavior:**

1. Validates the `state` parameter against the cookie.
2. Exchanges the `code` for an access token via GitHub's token endpoint.
3. Returns an HTML page that sends the token to the parent window via `postMessage` and closes itself.

**Parent window receives:**

```javascript
// Success
{ type: 'GITHUB_AUTH', token: 'gho_abc123...' }

// Error
{ type: 'GITHUB_AUTH_ERROR', error: 'Authorization failed: ...' }
```

**Example listener:**

```javascript
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;

  if (event.data.type === 'GITHUB_AUTH') {
    const token = event.data.token;
    // Store token and retry the tool invocation
  }

  if (event.data.type === 'GITHUB_AUTH_ERROR') {
    console.error('GitHub auth failed:', event.data.error);
  }
});
```

---

## SSE Event Types

All chat endpoints that return streamed responses use Server-Sent Events with the following event types:

### `text_delta`

A chunk of the assistant's text response.

```json
{ "type": "text_delta", "content": "Sure, let me " }
```

### `tool_call`

The LLM has decided to invoke a tool. The client should forward this to the appropriate iframe via postMessage.

```json
{
  "type": "tool_call",
  "toolName": "chess__new_game",
  "params": { "color": "white", "difficulty": 5 },
  "invocationId": "call_abc123",
  "appId": "chess",
  "rawToolName": "new_game"
}
```

| Field          | Description                                          |
|----------------|------------------------------------------------------|
| `toolName`     | Fully namespaced tool name (`{appId}__{toolName}`)   |
| `params`       | Parsed parameters object                             |
| `invocationId` | Unique ID for this invocation (use in tool-result)   |
| `appId`        | The app that owns this tool                          |
| `rawToolName`  | Tool name without the app namespace                  |

### `done`

The assistant's response is complete (no tool calls were made).

```json
{
  "type": "done",
  "conversationId": "a1b2c3d4-...",
  "messageId": "msg_456"
}
```

### `error`

An error occurred during streaming.

```json
{
  "type": "error",
  "error": "Rate limit exceeded"
}
```

---

## postMessage Protocol

The platform and iframe apps communicate via `window.postMessage()`. All messages follow a `{ type, ...payload }` structure.

### Platform -> Iframe

#### `TOOL_INVOKE`

Sent when the LLM wants to invoke one of the app's tools.

```json
{
  "type": "TOOL_INVOKE",
  "toolName": "new_game",
  "params": { "color": "white", "difficulty": 5 },
  "invocationId": "call_abc123"
}
```

#### `CONTEXT_UPDATE`

Sent when session context changes (e.g., conversation switch).

```json
{
  "type": "CONTEXT_UPDATE",
  "sessionId": "a1b2c3d4-...",
  "userId": "user_001"
}
```

### Iframe -> Platform

#### `READY`

Sent by the iframe when it has finished loading and is ready to receive messages.

```json
{
  "type": "READY"
}
```

#### `TOOL_RESULT`

Response to a `TOOL_INVOKE` message with the tool's result.

```json
{
  "type": "TOOL_RESULT",
  "invocationId": "call_abc123",
  "result": {
    "gameId": "game_1",
    "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    "status": "in_progress"
  }
}
```

#### `APP_COMPLETE`

Sent when the app's task is fully finished (e.g., chess game ended).

```json
{
  "type": "APP_COMPLETE",
  "result": {
    "outcome": "checkmate",
    "winner": "white",
    "totalMoves": 42,
    "finalFen": "..."
  }
}
```

#### `APP_ERROR`

Sent when the app encounters an unrecoverable error.

```json
{
  "type": "APP_ERROR",
  "error": {
    "code": "INVALID_MOVE",
    "message": "The move e2-e5 is not legal in the current position"
  }
}
```

### Message Flow Diagram

```
User: "Let's play chess"
         |
         v
   [POST /api/chat] --> OpenAI (streaming)
         |
         | SSE: text_delta "Sure, let me start a game!"
         | SSE: tool_call { chess__new_game, invocationId }
         |
         v
   [Client receives tool_call]
         |
         | postMessage: TOOL_INVOKE { new_game, params }
         v
   [Chess Iframe]
         |
         | postMessage: TOOL_RESULT { invocationId, result }
         v
   [Client collects result]
         |
         | POST /api/chat/:id/tool-result { toolResults }
         v
   [Server continues with OpenAI] --> SSE stream
         |
         | SSE: text_delta "I've started a new game..."
         | SSE: done { conversationId, messageId }
```

### Origin Validation

Always validate the `origin` of incoming messages:

```javascript
window.addEventListener('message', (event) => {
  // Only accept messages from the platform origin
  if (event.origin !== 'http://localhost:3000') return;

  const { type, ...payload } = event.data;
  // Handle message...
});
```

---

## Error Codes

| Code                 | HTTP Status | Description                                        |
|----------------------|-------------|----------------------------------------------------|
| `INVALID_SCHEMA`     | 400         | Request body failed validation                     |
| `INVALID_JSON`       | 400         | Request body is not valid JSON                     |
| `MISSING_FIELD`      | 400         | A required field is missing                        |
| `APP_EXISTS`         | 409         | An app with the same name is already registered    |
| `NOT_FOUND`          | 404         | The requested resource was not found               |
| `TOOL_NOT_FOUND`     | 404         | The specified tool does not exist for this app     |
| `APP_DISABLED`       | 403         | The app is currently disabled                      |
| `DB_ERROR`           | 500         | A database operation failed                        |
| `INVOCATION_NOT_FOUND` | 404       | Tool invocation ID not found                       |
| `INVOCATION_EXPIRED` | 408         | Tool call timed out                                |

All error responses follow this structure:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description of the error"
}
```

---

## Third-Party App Developer Guide

This guide walks through building and registering a new app for ChatBridge.

### 1. Create Your App Page

Your app is a standalone web page that will be loaded inside an iframe. Create a new route in the Next.js app (or host it externally).

```
src/app/apps/my-app/page.tsx
```

```tsx
'use client';

import { useEffect, useState } from 'react';

export default function MyApp() {
  const [data, setData] = useState(null);

  useEffect(() => {
    // Signal to the platform that the app is ready
    window.parent.postMessage({ type: 'READY' }, '*');

    // Listen for tool invocations from the platform
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'TOOL_INVOKE') {
        handleToolInvoke(event.data);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  async function handleToolInvoke(message: {
    toolName: string;
    params: Record<string, unknown>;
    invocationId: string;
  }) {
    const { toolName, params, invocationId } = message;

    try {
      let result;

      switch (toolName) {
        case 'my_tool':
          result = await doSomething(params);
          break;
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }

      // Send the result back to the platform
      window.parent.postMessage({
        type: 'TOOL_RESULT',
        invocationId,
        result,
      }, '*');

    } catch (error) {
      // Report errors to the platform
      window.parent.postMessage({
        type: 'APP_ERROR',
        error: {
          code: 'TOOL_FAILED',
          message: error.message,
        },
      }, '*');
    }
  }

  return <div>{/* Your app UI */}</div>;
}
```

### 2. Define Your App Manifest

Create a manifest file that describes your app and its tools.

```json
{
  "name": "My App",
  "description": "Does something useful",
  "iframeUrl": "/apps/my-app",
  "auth": { "type": "none" },
  "tools": [
    {
      "name": "my_tool",
      "description": "Performs a specific action. Call this when the user asks to do X.",
      "parameters": {
        "type": "object",
        "properties": {
          "input": {
            "type": "string",
            "description": "The input to process"
          }
        },
        "required": ["input"]
      }
    }
  ]
}
```

**Tips for tool descriptions:**
- Be specific about when the LLM should use this tool.
- Describe what the tool returns.
- Document parameter constraints and expected formats.

### 3. Register Your App

```bash
curl -X POST http://localhost:3000/api/apps/register \
  -H "Content-Type: application/json" \
  -d @my-app-manifest.json
```

Save the returned `apiKey` for future authenticated API calls.

### 4. Handle the Tool Lifecycle

The complete lifecycle for a tool invocation:

1. User sends a message in the chat.
2. The LLM decides to call your tool and returns a `tool_call` SSE event.
3. The platform sends a `TOOL_INVOKE` postMessage to your iframe.
4. Your app processes the invocation and sends back a `TOOL_RESULT`.
5. The platform forwards the result to the LLM via `/api/chat/:id/tool-result`.
6. The LLM incorporates the result into its response.

### 5. Signal Task Completion (Optional)

If your app has a concept of "done" (e.g., a game ending), signal it:

```javascript
window.parent.postMessage({
  type: 'APP_COMPLETE',
  result: {
    outcome: 'success',
    summary: 'Task completed successfully',
    // ... any relevant data
  },
}, '*');
```

### 6. OAuth Integration (Optional)

If your app needs user-specific credentials:

1. Set `auth.type` to `"oauth2"` in your manifest.
2. When a tool is invoked without a valid token, return an `AUTH_REQUIRED` result.
3. The platform will prompt the user to connect their account.
4. After authorization, the platform retries the tool invocation with a valid token.

### Existing App Examples

| App                    | Source Path           | Auth   | Tools |
|------------------------|-----------------------|--------|-------|
| Chess                  | `/apps/chess`         | none   | `new_game`, `get_board_state`, `make_move`, `get_hint` |
| Weather Dashboard      | `/apps/weather`       | none   | `get_current_weather`, `get_forecast` |
| GitHub Issue Tracker   | `/apps/github`        | oauth2 | `list_issues`, `create_issue`, `get_issue`, `search_issues` |
