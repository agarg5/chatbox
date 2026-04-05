# ChatBridge Demo Script (4 Minutes)

## Setup Before Recording

- Have the app running at the deployed URL (or localhost:1212/chatbridge)
- Clear any existing conversations (fresh sidebar)
- Browser in dark mode, fullscreen

---

## INTRO (0:00 - 0:15)

**[Show the landing page with empty chat]**

> "This is ChatBridge — an AI chat platform designed for K-12 education where third-party apps can plug in, register tools, render custom UI, and communicate bidirectionally with the chatbot. Let me show you how students would use it."

---

## DEMO 1: Flashcards — Interactive Study (0:15 - 1:00)

**[Type in chat: "Quiz me on the solar system"]**

> "When a student asks to study a topic, the AI generates flashcard content and sends it to the flashcards app. Watch — it creates a deck of cards with questions and answers."

**[Wait for flashcard deck to appear. Point to the card showing a question.]**

> "The student can flip the card by clicking it or by saying 'flip' in chat. Let me click it."

**[Click the card to flip it — show the answer]**

> "Now I rate myself — 'Knew It' or 'Still Learning'. This sends a USER_ACTION back to the chatbot, and it responds with encouragement."

**[Click "Knew It" — watch the chatbot respond and next card appear]**

> "The chatbot tracks progress and gives educational feedback. When the deck is done, it celebrates the score and offers to study more. This is fully bidirectional — just like chess."

---

## DEMO 2: Math Quiz — Interactive Practice (1:00 - 1:45)

**[Click "New Chat"]**

**[Type: "Let's practice multiplication"]**

> "The AI starts a math quiz with problems generated at an appropriate difficulty level. The student sees the problem and can type their answer right in the app."

**[Wait for quiz UI. Type an answer in the input field and click Check]**

> "Instant feedback — correct or incorrect. If wrong, the chatbot explains how to solve it. The student can also ask for a hint through chat."

**[Type in chat: "Can I get a hint?"]**

> "The AI calls the get_hint tool and the app shows a helpful tip. This is the tutoring experience — the chatbot is aware of what problem the student is on and can help."

---

## DEMO 3: Chess Game (1:45 - 2:30)

**[Click "New Chat"]**

**[Type: "Let's play chess"]**

> "The AI immediately starts a game — no clarifying questions. A full chess board appears with move validation."

**[Make a move by dragging e2 to e4]**

> "I play directly on the board. The AI opponent responds, and the chatbot comments on the position. I can ask for advice mid-game."

**[Type: "What should I do next?"]**

> "It analyzes the board state and suggests a move. The bidirectional communication is key — board moves feed back to the chatbot, and the chatbot can invoke tools to control the board."

---

## DEMO 4: GitHub + OAuth (2:30 - 3:00)

**[Click "New Chat"]**

**[Type: "Show me the issues in facebook/react"]**

> "The GitHub app reads public repos without auth. For write operations like creating issues, it triggers an OAuth2 popup flow. This demonstrates the authenticated app pattern — the platform handles the OAuth lifecycle, token storage, and credential passing."

**[Point to the GitHub panel showing issues]**

---

## DEMO 5: Architecture Overview (3:00 - 3:40)

> "Under the hood: the LLM discovers available tools from Supabase at runtime. When it decides to use one, it returns a function call via SSE. The client bridges that to the app's iframe via postMessage. The app executes and returns the result, which gets sent back to continue the conversation."

> "Apps are sandboxed in iframes — they can't access the parent DOM. Communication is through a typed protocol: TOOL_INVOKE, TOOL_RESULT, READY, USER_ACTION, APP_COMPLETE. Any developer can build a new app by implementing this protocol and registering tools via the REST API."

---

## CLOSING (3:40 - 4:00)

> "ChatBridge is built on a Chatbox fork with Express, GPT-4o function calling, and Supabase. Four apps — chess for strategy, flashcards and math quiz for K-12 learning, and GitHub for the OAuth pattern — all through a clean plugin interface designed for the TutorMeAI case study. Thanks for watching!"

---

## Backup Talking Points

- **Error handling**: Tool invocations have timeouts (10s standard, 30s for chess). Apps show error states if they fail to load.
- **Context retention**: The LLM receives all past tool results in conversation history, enabling follow-up questions.
- **K-12 focus**: All educational apps are interactive and bidirectional — students control them through chat AND through the UI.
- **Completion signaling**: When activities end (checkmate, deck complete, quiz done), apps signal completion and the chatbot discusses results.
