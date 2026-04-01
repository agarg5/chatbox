# Case Study Analysis

TutorMeAI's core challenge isn't building a chatbot — it's building a platform boundary that lets unknown third-party code run safely inside a conversation while keeping the chatbot aware of what's happening. This is fundamentally a trust problem wrapped in an engineering problem.

## Key Problems

The first problem is **sandboxing untrusted code in a K-12 context**. When a third-party app runs inside the chat, it has proximity to student data: conversation history, user identity, and the ability to render arbitrary UI. A malicious or poorly-built app could exfiltrate student information, display inappropriate content, or impersonate the chatbot. In an education setting with minors, the consequences of getting this wrong aren't just technical — they're legal (COPPA, FERPA) and reputational.

The second problem is **bidirectional state awareness**. The chatbot needs to know what's happening inside an app it doesn't control. When a student plays chess and asks "what should I do here?", the chatbot must query the board state from an app that manages its own internal logic. This means defining a communication protocol that's flexible enough for any app — from a simple calculator to a multi-step physics simulation — without requiring the platform to understand each app's domain.

The third problem is **completion signaling**. How does the platform know when a third-party interaction is "done"? A chess game has a clear end state (checkmate), but a drawing canvas or a flashcard set might not. The platform must define a contract that works across these different patterns without being so rigid that it limits what apps can do.

## Tradeoffs

We chose **iframes with postMessage** over Web Components or server-side rendering for app sandboxing. Iframes provide real browser-level isolation — the app can't access the parent DOM, cookies, or JavaScript context. The tradeoff is performance (each iframe is a separate page load) and communication complexity (postMessage is asynchronous and untyped). For a K-12 platform where safety matters more than milliseconds, this is the right call.

We chose **LLM function calling** for tool discovery rather than a custom routing layer. This means the chatbot decides when to invoke an app based on natural language intent, not explicit user commands. The tradeoff is non-determinism — the LLM might invoke the wrong app for an ambiguous query. We mitigate this with explicit routing rules in the system prompt and by requiring the LLM to ask for clarification on ambiguous requests rather than guessing.

For authentication, we designed **three tiers**: no auth (chess), API-key/public (weather), and OAuth (GitHub). This mirrors real platform ecosystems where different apps have different trust levels. The tradeoff is complexity — each tier has different security implications and token management requirements.

## Ethical Decisions

In a K-12 context, we default to restrictive rather than permissive. Apps run in sandboxed iframes with `allow-scripts allow-same-origin` but no access to camera, microphone, or geolocation. The platform validates tool schemas at registration time rather than trusting apps to self-describe accurately at runtime. OAuth tokens are stored server-side and never exposed to the client.

We also considered what happens when an app misbehaves mid-conversation. Rather than silently failing, the chatbot acknowledges the error and continues the conversation. A student shouldn't be left staring at a broken screen wondering what happened.

## What We Landed On

A single-agent architecture where one LLM routes to sandboxed iframe apps via a typed postMessage protocol, with app state living entirely in the iframe and the platform maintaining conversation context in a persistent database. This keeps the platform simple, the apps independent, and the security boundary clear. It's not the most sophisticated architecture possible, but it's one we can reason about, test, and trust — which matters more when the users are children.
