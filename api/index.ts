// Vercel Serverless Function — wraps our Express server
// All /api/* routes are handled here

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";

// --- Supabase ---
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- OpenAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are ChatBridge, a helpful AI tutor assistant for K-12 students with access to interactive educational apps.

You have four integrated apps:
1. **Chess** — Interactive chess game. Tools: chess__new_game, chess__get_board_state, chess__make_move, chess__get_hint. Use when the student wants to play chess.
2. **Flashcards** — Interactive study flashcards. Tools: flashcards__create_deck, flashcards__flip_card, flashcards__next_card, flashcards__prev_card, flashcards__get_progress. Use when the student wants to study, review, or quiz themselves on any subject.
3. **Math Quiz** — Interactive math practice. Tools: math__start_quiz, math__submit_answer, math__get_hint, math__skip_problem, math__get_score. Use when the student wants to practice math.
4. **GitHub** — GitHub issue tracker. Tools: github__list_issues, github__create_issue, github__get_issue, github__search_issues. Use for GitHub issues. Reading public repos works without auth. Creating issues requires OAuth — if the tool returns AUTH_REQUIRED, tell the user to click "Connect GitHub" in the GitHub panel.

Tool names are namespaced as {appId}__{toolName}.

IMMEDIATE ACTION RULES:
- When the student says "let's play chess" or similar, IMMEDIATELY call chess__new_game with color "white" and difficulty 5 as defaults.
- When the student says "quiz me on [topic]" or "make flashcards about [topic]", IMMEDIATELY call flashcards__create_deck. YOU generate the card content — create 8-12 age-appropriate cards with clear questions and concise answers.
- When the student says "math quiz" or "practice multiplication" or similar, IMMEDIATELY call math__start_quiz with the appropriate topic and difficulty 3, count 10 as defaults.
- Do NOT ask clarifying questions first — just start the activity. The student can adjust later.

FLASHCARD CONTENT GENERATION:
When creating flashcards, generate educational content appropriate for K-12 students. Keep questions clear, answers concise (1-2 sentences max), and cover a good range of the topic.

ROUTING RULES:
- Only invoke a tool when the student's request clearly matches that app's purpose.
- If a query is ambiguous, ask the student to clarify.
- NEVER invoke tools for general knowledge questions or anything unrelated to the available apps. Answer those directly.

RESPONDING TO USER_ACTION:
- When a student interacts with an app, respond encouragingly. For flashcards: brief encouragement. For math: cheer if correct, explain if incorrect. For chess: comment on strategy.

COMPLETION HANDLING:
- When a flashcard deck is finished, celebrate their score and offer to study again or try a different topic.
- When a math quiz is done, congratulate them and highlight areas for improvement.
- When a chess game ends, discuss the game result and offer to play again.

ERROR HANDLING:
- If a tool call fails or times out, acknowledge the error and suggest trying again.
- If an app returns AUTH_REQUIRED, explain that the user needs to connect their account.

CONTEXT:
- Remember previous tool results in the conversation.
- You can have multiple apps active in one conversation.
- Be encouraging, patient, and supportive — you're a tutor helping students learn.

Be concise, conversational, and encouraging.`;

// --- App manifests ---
const APP_MANIFESTS = [
  {
    id: "chess", name: "Chess", description: "Play chess against an AI opponent",
    iframeUrl: "/apps/chess", authType: "none",
    tools: [
      { name: "new_game", description: "Start a new chess game", parameters: { type: "object", properties: { color: { type: "string", enum: ["white", "black"] }, difficulty: { type: "integer", minimum: 1, maximum: 10 } }, required: ["color"] } },
      { name: "get_board_state", description: "Get the current board position, move history, and game status", parameters: { type: "object", properties: {} } },
      { name: "make_move", description: "Make a chess move on the board", parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
      { name: "get_hint", description: "Get a suggested move for the current position", parameters: { type: "object", properties: {} } },
    ],
  },
  {
    id: "flashcards", name: "Flashcards", description: "Interactive flashcard study tool for any subject. Create decks, flip cards, and track progress.",
    iframeUrl: "/apps/flashcards", authType: "none",
    tools: [
      { name: "create_deck", description: "Create a flashcard deck on a topic. YOU must generate the card content (front=question, back=answer). Generate 8-12 age-appropriate cards for K-12 students.", parameters: { type: "object", properties: { topic: { type: "string", description: "The study topic" }, cards: { type: "array", items: { type: "object", properties: { front: { type: "string", description: "The question or prompt" }, back: { type: "string", description: "The answer" } }, required: ["front", "back"] }, description: "Array of flashcard objects" } }, required: ["topic", "cards"] } },
      { name: "flip_card", description: "Flip the current flashcard to show the other side", parameters: { type: "object", properties: {} } },
      { name: "next_card", description: "Move to the next flashcard", parameters: { type: "object", properties: {} } },
      { name: "prev_card", description: "Move to the previous flashcard", parameters: { type: "object", properties: {} } },
      { name: "get_progress", description: "Get the student's current study progress and score", parameters: { type: "object", properties: {} } },
    ],
  },
  {
    id: "math", name: "Math Quiz", description: "Interactive math quiz with addition, subtraction, multiplication, division, and fractions. Adjustable difficulty for K-12 students.",
    iframeUrl: "/apps/math", authType: "none",
    tools: [
      { name: "start_quiz", description: "Start a math quiz. IMMEDIATELY start when the student asks for math practice.", parameters: { type: "object", properties: { topic: { type: "string", enum: ["addition", "subtraction", "multiplication", "division", "fractions", "mixed"], description: "Math topic to practice" }, difficulty: { type: "integer", minimum: 1, maximum: 5, description: "Difficulty level (1=easy, 5=hard)" }, count: { type: "integer", minimum: 3, maximum: 20, description: "Number of problems (default 10)" } }, required: ["topic"] } },
      { name: "submit_answer", description: "Submit an answer to the current math problem", parameters: { type: "object", properties: { answer: { type: "string", description: "The student's answer" } }, required: ["answer"] } },
      { name: "get_hint", description: "Get a hint for the current math problem", parameters: { type: "object", properties: {} } },
      { name: "skip_problem", description: "Skip the current problem", parameters: { type: "object", properties: {} } },
      { name: "get_score", description: "Get the student's current quiz score and progress", parameters: { type: "object", properties: {} } },
    ],
  },
  {
    id: "github", name: "GitHub Issue Tracker", description: "Browse, create, and search GitHub issues.",
    iframeUrl: "/apps/github", authType: "oauth2",
    tools: [
      { name: "list_issues", description: "List issues for a GitHub repository", parameters: { type: "object", properties: { repo: { type: "string" }, state: { type: "string", enum: ["open", "closed", "all"] }, labels: { type: "string" } }, required: ["repo"] } },
      { name: "create_issue", description: "Create a new issue in a GitHub repository", parameters: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, body: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, required: ["repo", "title"] } },
      { name: "get_issue", description: "Get details of a specific issue", parameters: { type: "object", properties: { repo: { type: "string" }, issue_number: { type: "integer" } }, required: ["repo", "issue_number"] } },
      { name: "search_issues", description: "Search for issues across GitHub", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    ],
  },
];

async function bootstrapApps() {
  const manifestIds = APP_MANIFESTS.map((m) => m.id);
  // Disable apps not in manifest (e.g. weather)
  await supabase.from("apps").update({ enabled: false }).not("id", "in", `(${manifestIds.join(",")})`);
  for (const m of APP_MANIFESTS) {
    const { data: existing } = await supabase.from("apps").select("id").eq("id", m.id).single();
    if (existing) { await supabase.from("apps").update({ enabled: true }).eq("id", m.id); continue; }
    await supabase.from("apps").insert({ id: m.id, name: m.name, description: m.description, iframe_url: m.iframeUrl, auth_type: m.authType, enabled: true });
    if (m.tools.length > 0) {
      await supabase.from("app_tools").insert(m.tools.map((t) => ({ app_id: m.id, name: t.name, description: t.description, parameters_schema: t.parameters })));
    }
  }
}

// --- Helpers ---
async function buildMessages(conversationId: string) {
  const { data: history } = await supabase.from("messages").select("role, content, tool_calls, tool_call_id").eq("conversation_id", conversationId).order("created_at", { ascending: true });
  const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];
  const toolResponseIds = new Set((history || []).filter((m: any) => m.role === "tool" && m.tool_call_id).map((m: any) => m.tool_call_id));
  for (const msg of history || []) {
    if (msg.role === "tool") { messages.push({ role: "tool", content: msg.content || "", tool_call_id: msg.tool_call_id || "" }); }
    else if (msg.role === "assistant" && msg.tool_calls) {
      const tcArray = msg.tool_calls as Array<{ id: string }>;
      if (tcArray.every((tc) => toolResponseIds.has(tc.id))) { messages.push({ role: "assistant", content: msg.content, tool_calls: msg.tool_calls }); }
      else { messages.push({ role: "assistant", content: msg.content || "(Tool call was interrupted)" }); }
    } else { messages.push({ role: msg.role, content: msg.content || "" }); }
  }
  return messages;
}

async function loadOpenAITools() {
  const { data: enabledApps } = await supabase.from("apps").select("id").eq("enabled", true);
  const appIds = (enabledApps || []).map((a: any) => a.id);
  if (appIds.length === 0) return [];
  const { data: appTools } = await supabase.from("app_tools").select("app_id, name, description, parameters_schema").in("app_id", appIds);
  return (appTools || []).map((t: any) => ({ type: "function" as const, function: { name: `${t.app_id}__${t.name}`, description: t.description || "", parameters: t.parameters_schema || { type: "object", properties: {} } } }));
}

async function streamOpenAI(res: express.Response, conversationId: string, messages: any[], openaiTools: any[]) {
  const send = (event: Record<string, unknown>) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };
  try {
    const completion = await openai.chat.completions.create({ model: "gpt-4o", messages, stream: true, ...(openaiTools.length > 0 ? { tools: openaiTools } : {}) });
    let fullContent = "";
    const toolCalls: Array<{ index: number; id: string; function: { name: string; arguments: string } }> = [];
    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) { fullContent += delta.content; send({ type: "text_delta", content: delta.content }); }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) { toolCalls[tc.index] = { index: tc.index, id: tc.id || "", function: { name: "", arguments: "" } }; }
          if (tc.id) toolCalls[tc.index].id = tc.id;
          if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
        }
      }
    }
    if (toolCalls.length > 0) {
      const formatted = toolCalls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.function.name, arguments: tc.function.arguments } }));
      await supabase.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: fullContent || null, tool_calls: formatted });
      send({ type: "conversation_id", conversationId });
      for (const tc of toolCalls) {
        const [appId, toolName] = tc.function.name.split("__");
        let params = {}; try { params = JSON.parse(tc.function.arguments); } catch {}
        send({ type: "tool_call", toolName: tc.function.name, params, invocationId: tc.id, appId, rawToolName: toolName });
        await supabase.from("tool_invocations").insert({ conversation_id: conversationId, app_id: appId, tool_name: tc.function.name, params, status: "pending" });
      }
    } else {
      const { data: assistantMsg } = await supabase.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: fullContent }).select("id").single();
      send({ type: "done", conversationId, messageId: assistantMsg?.id });
    }
  } catch (error) { send({ type: "error", error: error instanceof Error ? error.message : "Unknown error" }); }
  res.end();
}

// --- Express app ---
const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());

// POST /api/chat
app.post("/api/chat", async (req, res) => {
  const { conversationId, message } = req.body;
  const convId = conversationId || uuidv4();
  if (!conversationId) {
    const { data: existingUser } = await supabase.from("users").select("id").eq("email", "demo@chatbridge.dev").single();
    let userId: string;
    if (existingUser) { userId = existingUser.id; } else { const { data: newUser } = await supabase.from("users").insert({ email: "demo@chatbridge.dev", name: "Demo User" }).select("id").single(); userId = newUser!.id; }
    const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
    await supabase.from("conversations").insert({ id: convId, user_id: userId, title });
  }
  await supabase.from("messages").insert({ conversation_id: convId, role: "user", content: message });
  res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache"); res.setHeader("Connection", "keep-alive");
  const messages = await buildMessages(convId);
  const openaiTools = await loadOpenAITools();
  await streamOpenAI(res, convId, messages, openaiTools);
});

// GET /api/chat
app.get("/api/chat", async (_req, res) => {
  const { data, error } = await supabase.from("conversations").select("id, title, created_at, updated_at").order("updated_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data });
});

// DELETE /api/chat/:conversationId
app.delete("/api/chat/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  const { data: conversation } = await supabase.from("conversations").select("id").eq("id", conversationId).single();
  if (!conversation) return res.status(404).json({ error: "NOT_FOUND", message: `Conversation '${conversationId}' not found` });
  await supabase.from("tool_invocations").delete().eq("conversation_id", conversationId);
  await supabase.from("app_sessions").delete().eq("conversation_id", conversationId);
  await supabase.from("messages").delete().eq("conversation_id", conversationId);
  const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
  if (error) return res.status(500).json({ error: "DB_ERROR", message: error.message });
  res.json({ status: "deleted", conversationId });
});

// GET /api/chat/:conversationId
app.get("/api/chat/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  const { data: conversation, error: convError } = await supabase.from("conversations").select("*").eq("id", conversationId).single();
  if (convError || !conversation) return res.status(404).json({ error: "NOT_FOUND" });
  const { data: messages } = await supabase.from("messages").select("id, role, content, tool_calls, tool_call_id, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true });
  res.json({ id: conversation.id, title: conversation.title, created_at: conversation.created_at, messages: messages || [] });
});

// POST /api/chat/:conversationId/tool-result
app.post("/api/chat/:conversationId/tool-result", async (req, res) => {
  const { conversationId } = req.params;
  const { toolResults } = req.body;
  for (const tr of toolResults) { await supabase.from("messages").insert({ conversation_id: conversationId, role: "tool", content: JSON.stringify(tr.result), tool_call_id: tr.toolCallId }); }
  res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache"); res.setHeader("Connection", "keep-alive");
  const messages = await buildMessages(conversationId);
  const openaiTools = await loadOpenAITools();
  await streamOpenAI(res, conversationId, messages, openaiTools);
});

// GET /api/apps
app.get("/api/apps", async (_req, res) => {
  const { data: apps, error } = await supabase.from("apps").select("id, name, description, iframe_url, auth_type, enabled").order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  const { data: toolCounts } = await supabase.from("app_tools").select("app_id");
  const countMap: Record<string, number> = {};
  for (const t of toolCounts || []) { countMap[t.app_id] = (countMap[t.app_id] || 0) + 1; }
  res.json({ apps: (apps || []).map((a: any) => ({ id: a.id, name: a.name, description: a.description, iframeUrl: a.iframe_url, auth: { type: a.auth_type }, enabled: a.enabled, toolCount: countMap[a.id] || 0 })) });
});

// POST /api/apps/register
app.post("/api/apps/register", async (req, res) => {
  const { name, description, iframeUrl, auth, tools } = req.body;
  if (!name || !iframeUrl) return res.status(400).json({ error: "INVALID_SCHEMA", message: "name and iframeUrl are required" });
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const { data: existing } = await supabase.from("apps").select("id").eq("id", id).single();
  if (existing) return res.status(409).json({ error: "APP_EXISTS" });
  const apiKey = `cb_live_${randomBytes(24).toString("hex")}`;
  await supabase.from("apps").insert({ id, name, description: description || null, iframe_url: iframeUrl, auth_type: auth?.type || "none", api_key: apiKey, enabled: true });
  if (tools?.length > 0) { await supabase.from("app_tools").insert(tools.map((t: any) => ({ app_id: id, name: t.name, description: t.description || null, parameters_schema: t.parameters || { type: "object", properties: {} } }))); }
  res.status(201).json({ id, apiKey, name, iframeUrl, auth: auth || { type: "none" }, tools: tools || [], createdAt: new Date().toISOString() });
});

// GET /api/apps/:appId
app.get("/api/apps/:appId", async (req, res) => {
  const { appId } = req.params;
  const { data: appData } = await supabase.from("apps").select("*").eq("id", appId).single();
  if (!appData) return res.status(404).json({ error: "NOT_FOUND" });
  const { data: tools } = await supabase.from("app_tools").select("name, description, parameters_schema").eq("app_id", appId);
  res.json({ id: appData.id, name: appData.name, description: appData.description, iframeUrl: appData.iframe_url, auth: { type: appData.auth_type || "none" }, enabled: appData.enabled, tools: (tools || []).map((t: any) => ({ name: t.name, description: t.description, parameters: t.parameters_schema })), createdAt: appData.created_at });
});

// GET /api/apps/:appId/tools
app.get("/api/apps/:appId/tools", async (req, res) => {
  const { appId } = req.params;
  const { data: appData } = await supabase.from("apps").select("id").eq("id", appId).single();
  if (!appData) return res.status(404).json({ error: "NOT_FOUND" });
  const { data: tools } = await supabase.from("app_tools").select("name, description, parameters_schema").eq("app_id", appId);
  res.json({ appId, tools: (tools || []).map((t: any) => ({ name: t.name, description: t.description, parameters: t.parameters_schema })) });
});

// GET /api/sessions/:conversationId/context
app.get("/api/sessions/:conversationId/context", async (req, res) => {
  const { conversationId } = req.params;
  const { data: conversation } = await supabase.from("conversations").select("id, user_id, created_at").eq("id", conversationId).single();
  if (!conversation) return res.status(404).json({ error: "NOT_FOUND" });
  const { count: messageCount } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
  const { data: appSessions } = await supabase.from("app_sessions").select("app_id, status, state_snapshot, updated_at").eq("conversation_id", conversationId);
  const { data: recentInvocations } = await supabase.from("tool_invocations").select("id, app_id, tool_name, status, duration_ms, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20);
  res.json({ conversationId, userId: conversation.user_id, messageCount: messageCount || 0, activeApps: (appSessions || []).map((s: any) => ({ appId: s.app_id, status: s.status, stateSnapshot: s.state_snapshot })), recentToolInvocations: (recentInvocations || []).map((inv: any) => ({ id: inv.id, appId: inv.app_id, toolName: inv.tool_name, status: inv.status, durationMs: inv.duration_ms, timestamp: inv.created_at })) });
});

// GitHub OAuth
app.get("/api/auth/github/start", (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "GITHUB_CLIENT_ID not configured" });
  const state = randomBytes(24).toString("hex");
  const baseUrl = process.env.APP_URL || "https://chatbridge-seven.vercel.app";
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: `${baseUrl}/api/auth/github/callback`, scope: "repo read:user", state });
  res.cookie("github_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600000, path: "/" });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get("/api/auth/github/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;
  if (oauthError) return res.status(400).send(`<p>GitHub error: ${oauthError}</p>`);
  if (!code || !state) return res.status(400).send("<p>Missing code or state</p>");
  const baseUrl = process.env.APP_URL || "https://chatbridge-seven.vercel.app";
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${baseUrl}/api/auth/github/callback` }) });
  const tokenData = await tokenResponse.json();
  if (tokenData.error) return res.status(400).send(`<p>Token error: ${tokenData.error_description || tokenData.error}</p>`);
  res.clearCookie("github_oauth_state", { path: "/" });
  res.send(`<!DOCTYPE html><html><body><p>Authorization successful.</p><script>if(window.opener){window.opener.postMessage({type:'GITHUB_TOKEN',token:${JSON.stringify(tokenData.access_token)}},window.location.origin)}window.close()</script></body></html>`);
});

// Bootstrap
app.get("/api/bootstrap", async (_req, res) => { await bootstrapApps(); res.json({ status: "ok" }); });

export default app;
