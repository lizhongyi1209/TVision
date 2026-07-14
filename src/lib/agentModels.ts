// Model roster for the "Agent" multimodal-chat feature (first phase — see
// PLAN-AGENT: text + image understanding only, no tool calls / agent loop /
// skills yet). Zero-dependency module shared between client (model dropdown)
// and server (route whitelist) — same reasoning as visionModels.ts.

/** How a model's "思考深度" is controlled upstream — confirmed live against
 *  /pg/chat/completions (see route.ts): "effort" models take a plain
 *  reasoning_effort:"low"|"medium"|"high" field; claude-fable-5 rejects that
 *  field outright (errors with "empty tools are only allowed...") and instead
 *  wants Anthropic's native `thinking:{type:"enabled",budget_tokens:N}` shape,
 *  which also requires max_tokens to exceed budget_tokens. */
export type ReasoningStyle = "effort" | "claude-thinking";

export type ReasoningLevel = "low" | "medium" | "high";

export const REASONING_LEVELS: ReasoningLevel[] = ["low", "medium", "high"];

export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "high";

export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  low: "思考·低",
  medium: "思考·中",
  high: "思考·高",
};

export interface AgentModelInfo {
  /** Raw upstream model id, sent as-is in the chat-completions request body. */
  id: string;
  /** Friendly display name shown in the model dropdown. */
  label: string;
  reasoningStyle: ReasoningStyle;
}

export const AGENT_MODELS: AgentModelInfo[] = [
  { id: "claude-fable-5", label: "Claude Fable 5", reasoningStyle: "claude-thinking" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", reasoningStyle: "effort" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", reasoningStyle: "effort" },
];

export const DEFAULT_AGENT_MODEL = AGENT_MODELS[0].id;

export function isValidAgentModel(id: string): boolean {
  return AGENT_MODELS.some((m) => m.id === id);
}

export function isValidReasoningLevel(v: string): v is ReasoningLevel {
  return (REASONING_LEVELS as string[]).includes(v);
}

// claude-fable-5's budget_tokens per level — chosen so low/medium/high land
// roughly where the "effort" models' own low/medium/high presets do.
const CLAUDE_THINKING_BUDGETS: Record<ReasoningLevel, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

/** Extra body fields (and, for claude-thinking, an overridden max_tokens) to
 *  merge into the upstream chat-completions request for the given model +
 *  reasoning level. Unknown model ids get no extra params (caller already
 *  whitelist-checks the model before reaching here). */
export function buildReasoningParams(
  modelId: string,
  level: ReasoningLevel,
): { body: Record<string, unknown>; maxTokens?: number } {
  const model = AGENT_MODELS.find((m) => m.id === modelId);
  if (!model) return { body: {} };

  if (model.reasoningStyle === "claude-thinking") {
    const budget = CLAUDE_THINKING_BUDGETS[level];
    return {
      body: { thinking: { type: "enabled", budget_tokens: budget } },
      // thinking requires max_tokens > budget_tokens — same headroom used
      // during upstream testing.
      maxTokens: budget + 8192,
    };
  }

  return { body: { reasoning_effort: level } };
}
