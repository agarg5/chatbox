import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { randomBytes } from "crypto";
import { supabase } from "./supabase";
import { openai, SYSTEM_PROMPT } from "./openai";
import { bootstrapApps } from "./bootstrap-apps";

const app = express();
app.use(cors());
app.use(express.json());

// --- Helper: build OpenAI messages from conversation history ---
async function buildMessages(conversationId: string) {
  const { data: history } = await supabase
    .from("messages")
    .select("role, content, tool_calls, tool_call_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const messages: any[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const toolResponseIds = new Set(
    (history || [])
      .filter((m: any) => m.role === "tool" && m.tool_call_id)
      .map((m: any) => m.tool_call_id)
  );

  for (const msg of history || []) {
    if (msg.role === "tool") {
      messages.push({
        role: "tool",
        content: msg.content || "",
        tool_call_id: msg.tool_call_id || "",
      });
    } else if (msg.role === "assistant" && msg.tool_calls) {
      const tcArray = msg.tool_calls as Array<{ id: string }>;
      const allResolved = tcArray.every((tc) => toolResponseIds.has(tc.id));
      if (allResolved) {
        messages.push({
          role: "assistant",
          content: msg.content,
          tool_calls: msg.tool_calls,
        });
      } else {
        messages.push({
          role: "assistant",
          content: msg.content || "(Tool call was interrupted)",
        });
      }
    } else {
      messages.push({
        role: msg.role,
        content: msg.content || "",
      });
    }
  }

  return messages;
}

// --- Helper: load OpenAI tools from DB ---
async function loadOpenAITools() {
  const { data: enabledApps } = await supabase
    .from("apps")
    .select("id")
    .eq("enabled", true);

  const appIds = (enabledApps || []).map((a: any) => a.id);
  if (appIds.length === 0) return [];

  const { data: appTools } = await supabase
    .from("app_tools")
    .select("app_id, name, description, parameters_schema")
    .in("app_id", appIds);

  return (appTools || []).map((t: any) => ({
    type: "function" as const,
    function: {
      name: `${t.app_id}__${t.name}`,
      description: t.description || "",
      parameters: t.parameters_schema || { type: "object", properties: {} },
    },
  }));
}

// --- Helper: stream OpenAI and write SSE ---
async function streamOpenAI(
  res: express.Response,
  conversationId: string,
  messages: any[],
  openaiTools: any[]
) {
  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      stream: true,
      ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
    });

    let fullContent = "";
    const toolCalls: Array<{
      index: number;
      id: string;
      function: { name: string; arguments: string };
    }> = [];

    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;
        send({ type: "text_delta", content: delta.content });
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) {
            toolCalls[tc.index] = {
              index: tc.index,
              id: tc.id || "",
              function: { name: "", arguments: "" },
            };
          }
          if (tc.id) toolCalls[tc.index].id = tc.id;
          if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
        }
      }
    }

    if (toolCalls.length > 0) {
      const formattedToolCalls = toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: fullContent || null,
        tool_calls: formattedToolCalls,
      });

      send({ type: "conversation_id", conversationId });

      for (const tc of toolCalls) {
        const [appId, toolName] = tc.function.name.split("__");
        let params = {};
        try {
          params = JSON.parse(tc.function.arguments);
        } catch {}

        send({
          type: "tool_call",
          toolName: tc.function.name,
          params,
          invocationId: tc.id,
          appId,
          rawToolName: toolName,
        });

        await supabase.from("tool_invocations").insert({
          conversation_id: conversationId,
          app_id: appId,
          tool_name: tc.function.name,
          params,
          status: "pending",
        });
      }
    } else {
      const { data: assistantMsg } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: fullContent,
        })
        .select("id")
        .single();

      send({
        type: "done",
        conversationId,
        messageId: assistantMsg?.id,
      });
    }
  } catch (error) {
    send({
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }

  res.end();
}

// ============================================================
// ROUTES
// ============================================================

// --- POST /api/chat ---
app.post("/api/chat", async (req, res) => {
  const { conversationId, message } = req.body;
  const convId = conversationId || uuidv4();
  const isNew = !conversationId;

  if (isNew) {
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", "demo@chatbridge.dev")
      .single();

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { data: newUser } = await supabase
        .from("users")
        .insert({ email: "demo@chatbridge.dev", name: "Demo User" })
        .select("id")
        .single();
      userId = newUser!.id;
    }

    const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
    await supabase.from("conversations").insert({ id: convId, user_id: userId, title });
  }

  await supabase.from("messages").insert({
    conversation_id: convId,
    role: "user",
    content: message,
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const messages = await buildMessages(convId);
  const openaiTools = await loadOpenAITools();
  await streamOpenAI(res, convId, messages, openaiTools);
});

// --- GET /api/chat ---
app.get("/api/chat", async (_req, res) => {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data });
});

// --- GET /api/chat/:conversationId ---
app.get("/api/chat/:conversationId", async (req, res) => {
  const { conversationId } = req.params;

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: `Conversation '${conversationId}' not found`,
    });
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content, tool_calls, tool_call_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  res.json({
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.created_at,
    messages: messages || [],
  });
});

// --- POST /api/chat/:conversationId/tool-result ---
app.post("/api/chat/:conversationId/tool-result", async (req, res) => {
  const { conversationId } = req.params;
  const { toolResults } = req.body;

  for (const tr of toolResults) {
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "tool",
      content: JSON.stringify(tr.result),
      tool_call_id: tr.toolCallId,
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const messages = await buildMessages(conversationId);
  const openaiTools = await loadOpenAITools();
  await streamOpenAI(res, conversationId, messages, openaiTools);
});

// --- GET /api/apps ---
app.get("/api/apps", async (_req, res) => {
  const { data: apps, error } = await supabase
    .from("apps")
    .select("id, name, description, iframe_url, auth_type, enabled")
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const { data: toolCounts } = await supabase.from("app_tools").select("app_id");
  const countMap: Record<string, number> = {};
  for (const t of toolCounts || []) {
    countMap[t.app_id] = (countMap[t.app_id] || 0) + 1;
  }

  res.json({
    apps: (apps || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      iframeUrl: a.iframe_url,
      auth: { type: a.auth_type },
      enabled: a.enabled,
      toolCount: countMap[a.id] || 0,
    })),
  });
});

// --- POST /api/apps/register ---
app.post("/api/apps/register", async (req, res) => {
  const { name, description, iframeUrl, auth, tools } = req.body;

  if (!name || !iframeUrl) {
    return res.status(400).json({
      error: "INVALID_SCHEMA",
      message: "name and iframeUrl are required",
    });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const { data: existing } = await supabase.from("apps").select("id").eq("id", id).single();
  if (existing) {
    return res.status(409).json({
      error: "APP_EXISTS",
      message: `App with name '${name}' already registered`,
    });
  }

  const apiKey = `cb_live_${randomBytes(24).toString("hex")}`;

  const { error: appError } = await supabase.from("apps").insert({
    id,
    name,
    description: description || null,
    iframe_url: iframeUrl,
    auth_type: auth?.type || "none",
    api_key: apiKey,
    enabled: true,
  });

  if (appError) return res.status(500).json({ error: "DB_ERROR", message: appError.message });

  if (tools?.length > 0) {
    const toolRows = tools.map((t: any) => ({
      app_id: id,
      name: t.name,
      description: t.description || null,
      parameters_schema: t.parameters || { type: "object", properties: {} },
    }));

    const { error: toolsError } = await supabase.from("app_tools").insert(toolRows);
    if (toolsError) {
      await supabase.from("apps").delete().eq("id", id);
      return res.status(400).json({
        error: "INVALID_SCHEMA",
        message: `Tool error: ${toolsError.message}`,
      });
    }
  }

  res.status(201).json({
    id,
    apiKey,
    name,
    description: description || null,
    iframeUrl,
    auth: auth || { type: "none" },
    tools: tools || [],
    createdAt: new Date().toISOString(),
  });
});

// --- GET /api/apps/:appId ---
app.get("/api/apps/:appId", async (req, res) => {
  const { appId } = req.params;

  const { data: appData, error: appError } = await supabase
    .from("apps")
    .select("*")
    .eq("id", appId)
    .single();

  if (appError || !appData) {
    return res.status(404).json({ error: "NOT_FOUND", message: `App '${appId}' not found` });
  }

  const { data: tools } = await supabase
    .from("app_tools")
    .select("name, description, parameters_schema")
    .eq("app_id", appId);

  res.json({
    id: appData.id,
    name: appData.name,
    description: appData.description,
    iframeUrl: appData.iframe_url,
    auth: { type: appData.auth_type || "none" },
    enabled: appData.enabled,
    tools: (tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters_schema,
    })),
    createdAt: appData.created_at,
  });
});

// --- GET /api/apps/:appId/tools ---
app.get("/api/apps/:appId/tools", async (req, res) => {
  const { appId } = req.params;

  const { data: appData } = await supabase.from("apps").select("id").eq("id", appId).single();
  if (!appData) {
    return res.status(404).json({ error: "NOT_FOUND", message: `App '${appId}' not found` });
  }

  const { data: tools } = await supabase
    .from("app_tools")
    .select("name, description, parameters_schema")
    .eq("app_id", appId);

  res.json({
    appId,
    tools: (tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters_schema,
    })),
  });
});

// --- GET /api/sessions/:conversationId/context ---
app.get("/api/sessions/:conversationId/context", async (req, res) => {
  const { conversationId } = req.params;

  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("id, user_id, created_at")
    .eq("id", conversationId)
    .single();

  if (convError || !conversation) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: `Conversation '${conversationId}' not found`,
    });
  }

  const { count: messageCount } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);

  const { data: appSessions } = await supabase
    .from("app_sessions")
    .select("app_id, status, state_snapshot, updated_at")
    .eq("conversation_id", conversationId);

  const { data: recentInvocations } = await supabase
    .from("tool_invocations")
    .select("id, app_id, tool_name, params, result, status, duration_ms, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);

  const activeApps = (appSessions || []).map((session: any) => {
    const lastInvocation = (recentInvocations || []).find(
      (inv: any) => inv.app_id === session.app_id
    );
    return {
      appId: session.app_id,
      status: session.status,
      stateSnapshot: session.state_snapshot,
      ...(lastInvocation
        ? {
            lastInvocation: {
              toolName: lastInvocation.tool_name,
              params: lastInvocation.params,
              result: lastInvocation.result,
              timestamp: lastInvocation.created_at,
            },
          }
        : {}),
    };
  });

  const appCompletions = (appSessions || [])
    .filter((s: any) => s.status === "completed")
    .map((s: any) => ({
      appId: s.app_id,
      result: s.state_snapshot,
      timestamp: s.updated_at,
    }));

  res.json({
    conversationId,
    userId: conversation.user_id,
    messageCount: messageCount || 0,
    activeApps,
    recentToolInvocations: (recentInvocations || []).map((inv: any) => ({
      id: inv.id,
      appId: inv.app_id,
      toolName: inv.tool_name,
      status: inv.status,
      durationMs: inv.duration_ms,
      timestamp: inv.created_at,
    })),
    appCompletions,
  });
});

// --- GET /api/bootstrap ---
app.get("/api/bootstrap", async (_req, res) => {
  await bootstrapApps();
  res.json({ status: "ok" });
});

// ============================================================
// START
// ============================================================
const PORT = process.env.SERVER_PORT || 3001;

app.listen(PORT, async () => {
  console.log(`[server] ChatBridge API running on http://localhost:${PORT}`);
  // Auto-bootstrap apps on startup
  await bootstrapApps();
});
