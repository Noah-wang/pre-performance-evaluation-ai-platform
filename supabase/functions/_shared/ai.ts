export type AIUseCase =
  | "report"
  | "rectification"
  | "evaluation_plan"
  | "meeting_analysis"
  | "material_match"
  | "material_completeness"
  | "report_rewrite"
  | "transcription"
  | "expert_notice"
  | "knowledge_qa";

const DEFAULT_CHAT_ENDPOINT = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_DASHSCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const DEFAULT_MODELS: Record<AIUseCase, string> = {
  report: "google/gemini-3-flash-preview",
  rectification: "google/gemini-2.5-pro",
  evaluation_plan: "google/gemini-2.5-pro",
  meeting_analysis: "google/gemini-3-flash-preview",
  material_match: "google/gemini-2.5-flash",
  material_completeness: "google/gemini-2.5-flash",
  report_rewrite: "google/gemini-2.5-flash",
  transcription: "google/gemini-2.5-flash",
  expert_notice: "google/gemini-2.5-flash",
  knowledge_qa: "google/gemini-2.5-flash",
};

const MODEL_ENV_KEYS: Record<AIUseCase, string> = {
  report: "AI_MODEL_REPORT",
  rectification: "AI_MODEL_RECTIFICATION",
  evaluation_plan: "AI_MODEL_EVALUATION_PLAN",
  meeting_analysis: "AI_MODEL_MEETING_ANALYSIS",
  material_match: "AI_MODEL_MATERIAL_MATCH",
  material_completeness: "AI_MODEL_MATERIAL_COMPLETENESS",
  report_rewrite: "AI_MODEL_REPORT_REWRITE",
  transcription: "AI_MODEL_TRANSCRIPTION",
  expert_notice: "AI_MODEL_EXPERT_NOTICE",
  knowledge_qa: "AI_MODEL_KNOWLEDGE_QA",
};

type ChatPayload = Record<string, unknown> & {
  model?: string;
};

interface CallAIOptions {
  timeoutMs?: number;
}

const readEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  return value ? value : null;
};

export const getAIEndpoint = (useCase?: AIUseCase) => {
  if (useCase === "transcription") {
    return readEnv("AI_TRANSCRIPTION_BASE_URL")
      ?? readEnv("AI_CHAT_BASE_URL_TRANSCRIPTION")
      ?? readEnv("AI_CHAT_BASE_URL")
      ?? (readEnv("DASHSCOPE_API_KEY") ? DEFAULT_DASHSCOPE_ENDPOINT : null)
      ?? (readEnv("LOVABLE_API_KEY") ? DEFAULT_CHAT_ENDPOINT : null)
      ?? DEFAULT_CHAT_ENDPOINT;
  }
  return readEnv("AI_CHAT_BASE_URL") ?? DEFAULT_CHAT_ENDPOINT;
};

export const getAIKey = (useCase?: AIUseCase) => {
  if (useCase === "transcription") {
    const endpoint = getAIEndpoint(useCase).toLowerCase();
    const isAliyunEndpoint = endpoint.includes("aliyuncs.com") || endpoint.includes("dashscope.aliyun");
    const isLovableEndpoint = endpoint.includes("ai.gateway.lovable.dev");
    const key = isAliyunEndpoint
      ? readEnv("AI_TRANSCRIPTION_API_KEY")
        ?? readEnv("AI_API_KEY_TRANSCRIPTION")
        ?? readEnv("DASHSCOPE_API_KEY")
        ?? readEnv("AI_API_KEY")
        ?? readEnv("LOVABLE_API_KEY")
      : isLovableEndpoint
        ? readEnv("AI_TRANSCRIPTION_API_KEY")
          ?? readEnv("AI_API_KEY_TRANSCRIPTION")
          ?? readEnv("LOVABLE_API_KEY")
          ?? readEnv("AI_API_KEY")
          ?? readEnv("DASHSCOPE_API_KEY")
        : readEnv("AI_TRANSCRIPTION_API_KEY")
          ?? readEnv("AI_API_KEY_TRANSCRIPTION")
          ?? readEnv("DASHSCOPE_API_KEY")
          ?? readEnv("AI_API_KEY")
          ?? readEnv("LOVABLE_API_KEY");
    if (!key) throw new Error("AI_TRANSCRIPTION_API_KEY / DASHSCOPE_API_KEY / LOVABLE_API_KEY / AI_API_KEY 未配置");
    return key;
  }
  const key = readEnv("AI_API_KEY") ?? readEnv("LOVABLE_API_KEY");
  if (!key) throw new Error("AI_API_KEY / LOVABLE_API_KEY 未配置");
  return key;
};

export const resolveAIModel = (useCase: AIUseCase, overrideModel?: string) =>
  overrideModel
  ?? readEnv(MODEL_ENV_KEYS[useCase])
  ?? readEnv("AI_MODEL_DEFAULT")
  ?? DEFAULT_MODELS[useCase];

const shouldDisableThinking = (endpoint: string, model: string) => {
  const lowerEndpoint = endpoint.toLowerCase();
  const lowerModel = model.toLowerCase();
  return lowerEndpoint.includes("aliyuncs.com") || lowerModel.includes("qwen");
};

export const callAI = (useCase: AIUseCase, payload: ChatPayload, options: CallAIOptions = {}) => {
  const endpoint = getAIEndpoint(useCase);
  const apiKey = getAIKey(useCase);
  const model = resolveAIModel(useCase, typeof payload.model === "string" ? payload.model : undefined);
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? 90000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("AI request timeout"), timeoutMs);
  const normalizedPayload = {
    ...payload,
    model,
    ...(payload.enable_thinking === undefined && shouldDisableThinking(endpoint, model)
      ? { enable_thinking: false }
      : {}),
  };

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(normalizedPayload),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
};
