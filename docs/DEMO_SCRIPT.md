# ChatBridge Demo Script (3 Minutes)

## Setup Before Recording
- Have the app running at the deployed URL (or localhost:3000)
- Clear any existing conversations (fresh sidebar)
- Browser in dark mode, fullscreen

---

## INTRO (0:00 - 0:15)

**[Show the landing page with empty chat]**

> "This is ChatBridge — an AI chat platform where third-party apps can plug in, register their own tools, render custom UI, and communicate bidirectionally with the chatbot. Let me show you how it works."

---

## DEMO 1: Weather Dashboard (0:15 - 0:50)

**[Type in chat: "What's the weather like in San Francisco?"]**

> "When I ask about weather, the AI recognizes it needs the weather app. It calls the `get_current_weather` tool — you can see the tool call happening in the chat."

**[Point to tool call UI showing pending → success]**

> "The weather dashboard opens on the right, showing current conditions and a 7-day forecast. The data comes from Open-Meteo's API — no API keys needed."

**[Point to the weather panel showing temperature, forecast cards]**

> "I can ask follow-up questions that reference the results."

**[Type: "What about Tokyo? Is it warmer there?"]**

> "The AI calls the tool again, compares the results, and gives a natural language answer. It retains context from the previous query."

---

## DEMO 2: Chess Game (0:50 - 1:50)

**[Click "New Chat" in sidebar]**

**[Type: "Let's play chess! I'll be white, difficulty 5"]**

> "Now watch — the AI calls the `new_game` tool, and a full chess board appears. This is react-chessboard with chess.js handling move validation."

**[Wait for board to appear. Make a move by dragging e2 to e4]**

> "I can play directly on the board. The AI opponent responds automatically."

**[Type in chat: "What should I do next?"]**

> "I can ask the chatbot for advice mid-game. It calls `get_board_state` to analyze the position and `get_hint` for a suggestion."

**[Make the suggested move on the board]**

> "The bidirectional communication is key — the chatbot can both read the game state AND tell me what to do. When the game ends, the app signals completion and the chatbot discusses the result."

**[Optional: Type "What's the current board position?" to show get_board_state]**

---

## DEMO 3: Multi-App + Architecture (1:50 - 2:30)

**[Click "New Chat"]**

**[Type: "Check the weather in NYC and then let's play chess"]**

> "ChatBridge handles multiple apps in the same conversation. The AI routes to the right tool based on context. Both apps can be active simultaneously."

**[Point to the app tabs showing weather + chess]**

> "Under the hood, here's what's happening: The LLM discovers available tools from the database. When it decides to use one, it returns a function call. The client bridges that to the app's iframe via postMessage. The app executes, returns the result, and the client sends it back to continue the conversation."

**[Optional: Open browser devtools briefly to show postMessage traffic]**

---

## DEMO 4: Plugin Architecture (2:30 - 2:50)

> "The plugin interface is designed for third-party developers. Apps register via a REST API with a manifest defining their tools. Each tool has a name, description, and JSON schema for parameters."

**[Show the API docs page or the bootstrap manifest briefly]**

> "Any developer can build a new app — just create an iframe page, handle the postMessage protocol, and register your tools. The platform handles discovery, invocation, and bridging to the LLM."

---

## CLOSING (2:50 - 3:00)

> "ChatBridge is built with Next.js, OpenAI GPT-4o with function calling, Supabase for persistence, and deployed on Vercel. Three apps, full bidirectional communication, OAuth support, and a clean plugin interface — all in one week. Thanks for watching!"

---

## Backup Talking Points (if time allows)

- **Error handling**: Tool invocations have timeouts (10s standard, 30s for chess). Apps show error states if they fail to load.
- **Context retention**: The LLM receives all past tool results in conversation history, enabling follow-up questions.
- **OAuth flow**: The GitHub app uses a popup-based OAuth flow — no tokens pass through the iframe.
- **Completion signaling**: When a chess game ends, the app sends APP_COMPLETE with the outcome, and the chatbot discusses it naturally.
