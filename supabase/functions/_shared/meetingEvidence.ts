export interface MeetingEvidenceInput {
  analysisText?: string;
  minuteText?: string;
  transcriptText?: string;
  maxPoints?: number;
  maxChars?: number;
}

interface MeetingSentence {
  text: string;
  score: number;
  order: number;
}

const SUBSTANTIVE_TERMS =
  /建议|应当|应|需要|需|认为|指出|关注|完善|补充|明确|核实|风险|问题|不足|安全|预算|资金|成本|测算|方案|机制|目标|指标|进度|管理|采购|服务|结论|可行|必要|合规|持续/i;

const LOW_VALUE_TEXT =
  /^(?:好的?|可以|嗯+|啊+|对|是的|收到|谢谢|大家好|各位好.*(?:开始会议|会议开始)|开始会议|会议开始|没有了|就这样|测试|测试一下)[。！!？?\s]*$/i;

const normalizeSentence = (value: unknown) =>
  String(value ?? "")
    .replace(/\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]/g, " ")
    .replace(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g, " ")
    .replace(/^\s*(?:主持人|发言人|业务专家|管理专家|财务专家|专家|记录人|参会人|[\u4e00-\u9fa5]{1,8}(?:老师|主任|组长|主管))\s*[：:]\s*/i, "")
    .replace(/^\s*(?:会议主题|会议日期|纪要原文|录音转写|会议分析|逐段转写)\s*[：:]\s*/i, "")
    .replace(/^\s*(?:总体意见|其他问题和建议|主要意见|会议结论摘要)\s*[：:]\s*/i, "")
    .replace(/^\s*(?:[-*•·]+|\d+[.．、)]|[一二三四五六七八九十]+[、.．])\s*/, "")
    .replace(/[{}\[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const splitMeetingSentences = (value: unknown) =>
  String(value ?? "")
    .replace(/\r/g, "\n")
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(normalizeSentence)
    .filter((sentence) =>
      sentence.length >= 8
      && !LOW_VALUE_TEXT.test(sentence)
      && !/^(?:summary|opinions|sourceType|evidence)\s*[:：]/i.test(sentence)
    );

const comparableKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/(?:项目|会议|专家|表示|认为|指出|建议)/g, "");

const isNearDuplicate = (left: string, right: string) => {
  const a = comparableKey(left);
  const b = comparableKey(right);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 10;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  let common = 0;
  for (const char of new Set(shorter)) {
    if (longer.includes(char)) common += 1;
  }
  return common / Math.max(1, new Set(shorter).size) >= 0.82;
};

const sentenceScore = (text: string, sourceWeight: number) => {
  const termMatches = text.match(new RegExp(SUBSTANTIVE_TERMS.source, "gi"))?.length ?? 0;
  const actionMatches = text.match(/建议|应当|应|需要|需|完善|补充|明确|核实/g)?.length ?? 0;
  const dataMatches = text.match(/\d+(?:\.\d+)?(?:%|万元|元|项|个|年|月|日|分)?/g)?.length ?? 0;
  const lengthScore = text.length >= 18 && text.length <= 120 ? 3 : text.length <= 180 ? 1 : -2;
  return sourceWeight + termMatches * 2 + actionMatches * 2 + dataMatches + lengthScore;
};

const trimPoint = (value: string, max = 150) => {
  const clean = normalizeSentence(value)
    .replace(/^(?:但|同时|此外|另外)[，,\s]*/, "")
    .replace(/[；;。．]+$/, "");
  if (clean.length <= max) return clean;
  const clipped = clean.slice(0, max);
  const boundary = Math.max(
    clipped.lastIndexOf("，"),
    clipped.lastIndexOf("、"),
    clipped.lastIndexOf("。"),
  );
  return `${clipped.slice(0, boundary >= 60 ? boundary : max).replace(/[，、。\s]+$/, "")}……`;
};

export const summarizeMeetingEvidence = ({
  analysisText = "",
  minuteText = "",
  transcriptText = "",
  maxPoints = 5,
  maxChars = 520,
}: MeetingEvidenceInput) => {
  const sources = [
    { text: analysisText, weight: 10 },
    { text: minuteText, weight: 6 },
    { text: transcriptText, weight: 4 },
  ];
  const candidates: MeetingSentence[] = [];
  let order = 0;

  for (const source of sources) {
    for (const sentence of splitMeetingSentences(source.text)) {
      candidates.push({
        text: sentence,
        score: sentenceScore(sentence, source.weight),
        order: order++,
      });
    }
  }

  const selected: MeetingSentence[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.order - b.order)) {
    if (selected.some((item) => isNearDuplicate(item.text, candidate.text))) continue;
    selected.push(candidate);
    if (selected.length >= Math.max(1, maxPoints)) break;
  }

  const points: string[] = [];
  let usedChars = 0;
  for (const item of selected.sort((a, b) => a.order - b.order)) {
    const point = trimPoint(item.text);
    const nextLength = usedChars + point.length + (points.length ? 1 : 0);
    if (points.length && nextLength > maxChars) continue;
    points.push(point);
    usedChars = nextLength;
  }

  return points.length ? `${points.join("；")}。` : "";
};
