// AI 语音转写 — 使用 Lovable AI Gemini 多模态识别现场录音
import { callAI } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const readEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  return value ? value : null;
};

const DEFAULT_DASHSCOPE_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const getTranscriptionEndpoint = () =>
  readEnv("AI_TRANSCRIPTION_BASE_URL")
    ?? readEnv("AI_CHAT_BASE_URL_TRANSCRIPTION")
    ?? readEnv("AI_CHAT_BASE_URL")
    ?? (readEnv("DASHSCOPE_API_KEY") ? DEFAULT_DASHSCOPE_ENDPOINT : null)
    ?? "";

const getTranscriptionModel = () => {
  const override = readEnv("AI_MODEL_TRANSCRIPTION");
  if (override) return override;
  const endpoint = getTranscriptionEndpoint().toLowerCase();
  if (endpoint.includes("aliyuncs.com") || readEnv("DASHSCOPE_API_KEY")) return "qwen3-asr-flash";
  return "google/gemini-2.5-flash";
};

const normalizeMimeType = (mimeType?: string) => {
  const clean = mimeType?.split(";")[0]?.trim() || "audio/webm";
  if (clean === "audio/x-wav") return "audio/wav";
  return clean;
};

const isDashScopeAsr = (model: string) =>
  model.toLowerCase().includes("qwen3-asr") || getTranscriptionEndpoint().toLowerCase().includes("aliyuncs.com");

const parseGatewayError = (status: number, detail: string) => {
  if (/audio is empty|empty audio|音频为空|录音为空/i.test(detail)) {
    return {
      status: 400,
      error: "录音内容为空或无法识别，请确认录音有声音后重新转写。",
    };
  }
  if (/provided URL does not appear to be valid|correctly formatted|invalid.*url/i.test(detail)) {
    return {
      status: 502,
      error: "转写音频格式不符合当前 ASR 模型要求，请更新 transcribe-audio 函数，确保音频以 data URL 格式传入。",
    };
  }
  if (/input_audio|audio|modality|modalit|unsupported|不支持/i.test(detail)) {
    return {
      status: 502,
      error: "当前转写模型不支持音频输入，请配置 AI_TRANSCRIPTION_BASE_URL / AI_TRANSCRIPTION_API_KEY，或保留 LOVABLE_API_KEY 使用 Gemini 转写。",
    };
  }
  if (status === 401 || status === 403) {
    return {
      status,
      error: "录音转写服务鉴权失败：请确认转写 API Key 与接口地址属于同一平台。若使用阿里百炼，请配置 DASHSCOPE_API_KEY，并使用 DashScope compatible-mode 转写地址。",
    };
  }
  if (status === 404) {
    return { status: 502, error: "转写模型或接口地址不存在，请检查转写模型配置。" };
  }
  return { status: 500, error: "AI 网关错误" };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { audioBase64, mimeType, context } = await req.json();
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return new Response(JSON.stringify({ error: "缺少 audioBase64" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (audioBase64.length > 18_000_000) {
      return new Response(JSON.stringify({ error: "录音文件过大（请控制在 ~12MB 以内）" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const localAsrBaseUrl = Deno.env.get("LOCAL_ASR_BASE_URL")?.trim();
    if (localAsrBaseUrl) {
      try {
        const localRes = await fetch(`${localAsrBaseUrl.replace(/\/$/, "")}/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64, mimeType, context }),
        });
        if (localRes.ok) {
          const localJson = await localRes.json().catch(() => ({}));
          const transcript = String(localJson.transcript ?? localJson.text ?? "").trim();
          if (transcript) {
            return new Response(JSON.stringify({ transcript, provider: "local_asr" }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          console.warn("local ASR failed:", localRes.status);
        }
      } catch (error) {
        console.warn("local ASR request failed:", error);
      }
    }

    const systemPrompt = `你是一位中文语音转写助手。请严格遵守：
1) 只把音频中真实听到的内容逐字转成简体中文文本
2) 每一句单独一行，并在句首标注该句话在本段音频中的开始时间，格式严格为：[MM:SS] 句子
3) 时间必须从 [00:00] 起，依据音频中的实际语音位置递增，不得重复倒退
4) 不要润色、总结、改写、补全文意，也不要根据上下文或项目背景推测未听到的内容
5) 听不清的词句请标注为“[听不清]”，不要猜测
6) 出现专业术语保持原义
7) 不要输出标题、说明、Markdown 或额外评论，只输出带时间码的转写正文`;

    const userText = context
      ? `背景信息仅用于识别专有名词，不得用于补写音频中没有出现的内容：${context}\n请转写以下录音：`
      : "请转写以下录音：";

    const model = getTranscriptionModel();
    const mime = normalizeMimeType(mimeType);
    const audioData = isDashScopeAsr(model) ? `data:${mime};base64,${audioBase64}` : audioBase64;
    const resp = await callAI("transcription", isDashScopeAsr(model)
      ? {
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: audioData },
                },
              ],
            },
          ],
          stream: false,
          asr_options: {
            language: "zh",
            enable_itn: true,
          },
        }
      : {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userText },
                {
                  type: "input_audio",
                  input_audio: {
                    data: audioData,
                    format: mime.includes("wav") ? "wav" : "webm",
                  },
                },
              ],
            },
          ],
        });

    if (resp.status === 429) {
      return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (resp.status === 402) {
      return new Response(JSON.stringify({ error: "AI 额度不足，请充值后再试" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      const parsed = parseGatewayError(resp.status, t);
      return new Response(JSON.stringify({ error: parsed.error, detail: t }), {
        status: parsed.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const transcript =
      json.choices?.[0]?.message?.content
      ?? json.output?.choices?.[0]?.message?.content?.[0]?.text
      ?? "";
    return new Response(JSON.stringify({ transcript, provider: "ai_gateway" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe-audio error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
