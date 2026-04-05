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
    id: "flashcards",
    name: "Flashcards",
    description:
      "Interactive flashcard study tool for any subject. Create decks, flip cards, and track progress. Great for vocabulary, science, history, and more.",
    iframeUrl: "/apps/flashcards",
    authType: "none",
    tools: [
      {
        name: "create_deck",
        description:
          "Create a flashcard deck on a topic. YOU must generate the card content (front=question, back=answer). Generate 5-15 age-appropriate cards for K-12 students.",
        parameters: {
          type: "object",
          properties: {
            topic: { type: "string", description: "The study topic, e.g. 'Solar System'" },
            cards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  front: { type: "string", description: "The question or prompt" },
                  back: { type: "string", description: "The answer" },
                },
                required: ["front", "back"],
              },
              description: "Array of flashcard objects with front (question) and back (answer)",
            },
          },
          required: ["topic", "cards"],
        },
      },
      {
        name: "flip_card",
        description: "Flip the current flashcard to show the other side",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "next_card",
        description: "Move to the next flashcard",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "prev_card",
        description: "Move to the previous flashcard",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_progress",
        description: "Get the student's current study progress and score",
        parameters: { type: "object", properties: {} },
      },
    ],
  },
  {
    id: "math",
    name: "Math Quiz",
    description:
      "Interactive math quiz with problems in addition, subtraction, multiplication, division, and fractions. Adjustable difficulty for K-12 students.",
    iframeUrl: "/apps/math",
    authType: "none",
    tools: [
      {
        name: "start_quiz",
        description:
          "Start a math quiz. IMMEDIATELY start the quiz with sensible defaults when the student asks for math practice.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              enum: ["addition", "subtraction", "multiplication", "division", "fractions", "mixed"],
              description: "Math topic to practice",
            },
            difficulty: {
              type: "integer",
              minimum: 1,
              maximum: 5,
              description: "Difficulty level (1=easy, 5=hard). Controls number size.",
            },
            count: {
              type: "integer",
              minimum: 3,
              maximum: 20,
              description: "Number of problems (default 10)",
            },
          },
          required: ["topic"],
        },
      },
      {
        name: "submit_answer",
        description: "Submit an answer to the current math problem",
        parameters: {
          type: "object",
          properties: {
            answer: { type: "string", description: "The student's answer" },
          },
          required: ["answer"],
        },
      },
      {
        name: "get_hint",
        description: "Get a hint for the current math problem",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "skip_problem",
        description: "Skip the current problem and move to the next one",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_score",
        description: "Get the student's current quiz score and progress",
        parameters: { type: "object", properties: {} },
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
  const manifestIds = APP_MANIFESTS.map((m) => m.id);

  // Disable apps that are no longer in the manifest (e.g. weather)
  await supabase
    .from("apps")
    .update({ enabled: false })
    .not("id", "in", `(${manifestIds.join(",")})`);

  for (const manifest of APP_MANIFESTS) {
    const { data: existing } = await supabase
      .from("apps")
      .select("id")
      .eq("id", manifest.id)
      .single();

    if (existing) {
      // Ensure it's enabled
      await supabase.from("apps").update({ enabled: true }).eq("id", manifest.id);
      continue;
    }

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
