import { supabase } from "./supabase";

interface AppManifest {
  id: string;
  name: string;
  description: string;
  iframeUrl: string;
  authType: "none" | "api_key" | "oauth2";
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

const APP_MANIFESTS: AppManifest[] = [
  {
    id: "chess",
    name: "Chess",
    description: "Play chess against an AI opponent",
    iframeUrl: "/apps/chess",
    authType: "none",
    tools: [
      {
        name: "new_game",
        description: "Start a new chess game",
        parameters: {
          type: "object",
          properties: {
            color: {
              type: "string",
              enum: ["white", "black"],
              description: "Which color the user plays as",
            },
            difficulty: {
              type: "integer",
              minimum: 1,
              maximum: 10,
              description: "AI difficulty level (1-10)",
            },
          },
          required: ["color"],
        },
      },
      {
        name: "get_board_state",
        description: "Get the current board position, move history, and game status",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "make_move",
        description: "Make a chess move on the board",
        parameters: {
          type: "object",
          properties: {
            from: { type: "string", description: "Square to move from, e.g. 'e2'" },
            to: { type: "string", description: "Square to move to, e.g. 'e4'" },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "get_hint",
        description: "Get a suggested move for the current position",
        parameters: { type: "object", properties: {} },
      },
    ],
  },
  {
    id: "weather",
    name: "Weather Dashboard",
    description: "Get current weather and forecasts for any location",
    iframeUrl: "/apps/weather",
    authType: "none",
    tools: [
      {
        name: "get_current_weather",
        description: "Get current weather conditions for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name, e.g. 'San Francisco'" },
          },
          required: ["location"],
        },
      },
      {
        name: "get_forecast",
        description: "Get weather forecast for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City name, e.g. 'New York'" },
            days: {
              type: "integer",
              minimum: 1,
              maximum: 7,
              description: "Number of days to forecast (default 7)",
            },
          },
          required: ["location"],
        },
      },
    ],
  },
  {
    id: "github",
    name: "GitHub Issue Tracker",
    description: "Browse, create, and search GitHub issues. Requires GitHub authentication.",
    iframeUrl: "/apps/github",
    authType: "oauth2",
    tools: [
      {
        name: "list_issues",
        description: "List issues for a GitHub repository",
        parameters: {
          type: "object",
          properties: {
            repo: { type: "string", description: "Repository in 'owner/repo' format" },
            state: { type: "string", enum: ["open", "closed", "all"], description: "Filter by issue state" },
            labels: { type: "string", description: "Comma-separated label names to filter by" },
          },
          required: ["repo"],
        },
      },
      {
        name: "create_issue",
        description: "Create a new issue in a GitHub repository",
        parameters: {
          type: "object",
          properties: {
            repo: { type: "string", description: "Repository in 'owner/repo' format" },
            title: { type: "string", description: "Issue title" },
            body: { type: "string", description: "Issue body (markdown)" },
            labels: { type: "array", items: { type: "string" }, description: "Labels to apply" },
          },
          required: ["repo", "title"],
        },
      },
      {
        name: "get_issue",
        description: "Get details of a specific issue",
        parameters: {
          type: "object",
          properties: {
            repo: { type: "string", description: "Repository in 'owner/repo' format" },
            issue_number: { type: "integer", description: "Issue number" },
          },
          required: ["repo", "issue_number"],
        },
      },
      {
        name: "search_issues",
        description: "Search for issues across GitHub",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "GitHub search query string" },
          },
          required: ["query"],
        },
      },
    ],
  },
];

export async function bootstrapApps() {
  for (const manifest of APP_MANIFESTS) {
    const { data: existing } = await supabase
      .from("apps")
      .select("id")
      .eq("id", manifest.id)
      .single();

    if (existing) continue;

    await supabase.from("apps").insert({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      iframe_url: manifest.iframeUrl,
      auth_type: manifest.authType,
      enabled: true,
    });

    if (manifest.tools.length > 0) {
      await supabase.from("app_tools").insert(
        manifest.tools.map((t) => ({
          app_id: manifest.id,
          name: t.name,
          description: t.description,
          parameters_schema: t.parameters,
        }))
      );
    }

    console.log(`[bootstrap] Registered app: ${manifest.name}`);
  }
}
