const DIMENSIONS = 384;
const DEFAULT_DASHSCOPE_EMBEDDING_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings";

const STOPWORDS = new Set([
  "项目", "资料", "文件", "相关", "情况", "说明", "进行", "以及", "可以", "需要", "提供",
  "预算", "绩效", "评估", "工作", "单位", "管理", "建设", "实施", "报告", "意见",
]);

const hashToken = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const tokenizeForEmbedding = (text: string) =>
  (text ?? "")
    .toLowerCase()
    .match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g)
    ?.filter((token) => !STOPWORDS.has(token)) ?? [];

export const createTextEmbedding = (text: string) => {
  const vector = new Array(DIMENSIONS).fill(0);
  const tokens = tokenizeForEmbedding(text);

  for (const token of tokens) {
    const weight = Math.min(3, Math.max(1, token.length / 2));
    const h1 = hashToken(token);
    const h2 = hashToken(`${token}:bi`);
    vector[h1 % DIMENSIONS] += weight;
    vector[h2 % DIMENSIONS] += weight * 0.5;
    vector[(h1 ^ h2) % DIMENSIONS] -= weight * 0.25;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
};

const readEnv = (key: string) => {
  const value = Deno.env.get(key)?.trim();
  return value ? value : null;
};

const normalizeVector = (values: number[]) => {
  const vector = new Array(DIMENSIONS).fill(0);
  if (!values.length) return createTextEmbedding("");

  for (let index = 0; index < values.length; index += 1) {
    const target = index % DIMENSIONS;
    vector[target] += Number(values[index]) || 0;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
};

const externalEmbeddingEndpoint = () =>
  readEnv("AI_EMBEDDING_BASE_URL")
  ?? readEnv("AI_EMBEDDING_URL")
  ?? (readEnv("DASHSCOPE_API_KEY") ? DEFAULT_DASHSCOPE_EMBEDDING_ENDPOINT : null);

const externalEmbeddingKey = () =>
  readEnv("AI_EMBEDDING_API_KEY")
  ?? readEnv("AI_API_KEY_EMBEDDING")
  ?? readEnv("DASHSCOPE_API_KEY")
  ?? readEnv("AI_API_KEY");

export const createTextEmbeddingAsync = async (text: string) => {
  const endpoint = externalEmbeddingEndpoint();
  const apiKey = externalEmbeddingKey();
  const model = readEnv("AI_EMBEDDING_MODEL") ?? "text-embedding-v4";

  if (!endpoint || !apiKey) return createTextEmbedding(text);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: text.slice(0, 12000),
        dimensions: DIMENSIONS,
      }),
    });
    if (!response.ok) throw new Error(`embedding ${response.status}: ${await response.text()}`);
    const json = await response.json();
    const raw = json.data?.[0]?.embedding;
    if (!Array.isArray(raw) || !raw.length) throw new Error("embedding response missing data[0].embedding");
    return normalizeVector(raw.map((value: unknown) => Number(value)));
  } catch (error) {
    console.warn("external embedding failed; falling back to local hash embedding", error);
    return createTextEmbedding(text);
  }
};

export const vectorLiteral = (embedding: number[]) =>
  `[${embedding.map((value) => Number.isFinite(value) ? value : 0).join(",")}]`;

export const chunkText = (text: string, targetLength = 900, overlap = 120) => {
  const compact = (text ?? "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!compact) return [];

  const paragraphs = compact
    .split(/\n{2,}|(?<=[。！？；])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n" + paragraph).length <= targetLength) {
      current = current ? `${current}\n${paragraph}` : paragraph;
      continue;
    }
    if (current) chunks.push(current);
    current = paragraph.length > targetLength
      ? paragraph.slice(0, targetLength)
      : paragraph;

    let remaining = paragraph.slice(targetLength);
    while (remaining.length > targetLength) {
      const prefix = paragraph.slice(Math.max(0, targetLength - overlap), targetLength);
      chunks.push(`${prefix}${remaining.slice(0, targetLength)}`);
      remaining = remaining.slice(targetLength);
    }
    if (remaining.trim()) current = remaining.trim();
  }

  if (current) chunks.push(current);
  return chunks.slice(0, 200);
};
