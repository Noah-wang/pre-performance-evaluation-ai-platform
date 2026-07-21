import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, Loader2, Sparkles, Trash2, Play, Pause, Download, FileText, Layers } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StatusPill } from "@/components/ui-kit";
import { useConfirm } from "@/hooks/useConfirm";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { safeStorageFileName } from "@/lib/storagePath";

interface FieldAudio {
  id: string;
  record_id: string;
  file_path: string;
  duration_sec: number | null;
  transcript: string | null;
  transcript_status: string;
  created_at: string;
  created_by?: string;
  segment_index: number;
  segment_total: number;
  parent_audio_id: string | null;
}

interface AudioRecorderProps {
  recordId: string;
  projectId: string;
  projectName: string;
  location: string;
  researchDate: string;
  context?: string;
  onChange?: () => void;
  onAudiosChange?: (audios: FieldAudio[]) => void;
}

// 长录音自动按 90 秒切片，避免单文件过大触发转写失败
const SEGMENT_SEC = 90;
interface TimedSentence {
  seconds: number;
  text: string;
  estimated: boolean;
}

const mapAudioTranscribeError = (message?: string) => {
  if (!message) return "转写失败，请稍后重试";
  if (/Failed to fetch|network/i.test(message)) return "转写服务连接失败，请检查网络或稍后重试";
  if (/non-2xx|Edge Function/i.test(message)) return "转写服务返回错误，请检查转写模型配置后重试";
  if (/input_audio|audio|音频输入|不支持音频|模型不支持|modalit/i.test(message)) {
    return "当前 AI 模型不支持语音转写，请切换为支持音频的转写模型或配置本地 ASR";
  }
  if (/quota|额度|402|payment/i.test(message)) return "AI 额度不足，请检查转写服务额度";
  if (/过大|12MB|18_000_000|too large/i.test(message)) return "录音文件过大，请缩短录音或降低音频大小后重试";
  return message;
};

const formatTimecode = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600).toString().padStart(2, "0");
  const m = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return h === "00" ? `${m}:${s}` : `${h}:${m}:${s}`;
};

const parseTimestamp = (value: string) => {
  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
};

const splitSentences = (text: string) =>
  (text.replace(/\r/g, "").match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? [])
    .map((item) => item.trim())
    .filter(Boolean);

const timedSentences = (transcript: string, duration: number, offset = 0): TimedSentence[] => {
  const explicit = transcript
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]\s*(.+)$/);
      if (!match) return null;
      const seconds = parseTimestamp(match[1]);
      return seconds == null ? null : { seconds: offset + seconds, text: match[2].trim(), estimated: false };
    })
    .filter((item): item is TimedSentence => Boolean(item?.text));
  if (explicit.length) return explicit;

  const sentences = splitSentences(transcript);
  const interval = sentences.length ? Math.max(duration, 1) / sentences.length : 0;
  return sentences.map((text, index) => ({
    seconds: offset + Math.floor(index * interval),
    text,
    estimated: true,
  }));
};

export const AudioRecorder = ({
  recordId,
  projectId,
  projectName,
  location,
  researchDate,
  context,
  onChange,
  onAudiosChange,
}: AudioRecorderProps) => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [audios, setAudios] = useState<FieldAudio[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const segStartTsRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const rotateRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const parentIdRef = useRef<string | null>(null);
  const segIndexRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("field_audios").select("*").eq("record_id", recordId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else {
      const next = (data as FieldAudio[]) ?? [];
      setAudios(next);
      onAudiosChange?.(next);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [recordId]);

  useEffect(() => {
    (async () => {
      const next: Record<string, string> = {};
      for (const a of audios) {
        const { data } = await supabase.storage.from("field-audios").createSignedUrl(a.file_path, 3600);
        if (data?.signedUrl) next[a.id] = data.signedUrl;
      }
      setSignedUrls(next);
    })();
  }, [audios]);

  const buildTranscriptHeader = (title: string, extra?: string[]) => {
    const lines = [
      title,
      `项目：${projectName}`,
      `地点：${location}`,
      `调研日期：${researchDate}`,
      ...(extra ?? []),
    ];
    if (context) lines.push(`背景：${context}`);
    return `${lines.join("\n")}\n----\n\n`;
  };

  const ensureSignedUrl = async (audio: FieldAudio) => {
    if (signedUrls[audio.id]) return signedUrls[audio.id];
    const { data, error } = await supabase.storage.from("field-audios").createSignedUrl(audio.file_path, 3600);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message || "录音链接获取失败，请确认当前账号有权限读取该录音");
    }
    setSignedUrls((prev) => ({ ...prev, [audio.id]: data.signedUrl }));
    return data.signedUrl;
  };

  const buildGroupTranscript = (list: FieldAudio[]) => {
    const totalSec = list.reduce((sum, item) => sum + (item.duration_sec ?? 0), 0);
    const body = list.map((item, index) => {
      const stamp = new Date(item.created_at).toLocaleString("zh-CN", { hour12: false });
      return [
        `## 第 ${index + 1} 段`,
        `录音时间：${stamp}`,
        `时长：${fmt(item.duration_sec ?? 0)}`,
        "",
        item.transcript?.trim() || "—",
      ].join("\n");
    }).join("\n\n");
    return buildTranscriptHeader("现场调研录音转写", [
      `录音段数：${list.length}`,
      `总时长：${fmt(totalSec)}`,
    ]) + body;
  };

  const buildTranscriptDocx = async (list: FieldAudio[], title = "现场调研录音转写") => {
    const {
      AlignmentType,
      Document,
      HeadingLevel,
      Packer,
      Paragraph,
      TextRun,
    } = await import("docx");
    let offset = 0;
    const rows = list.flatMap((item) => {
      const sentences = timedSentences(item.transcript?.trim() || "（无转写内容）", item.duration_sec ?? 0, offset);
      offset += item.duration_sec ?? 0;
      return sentences;
    });
    const hasEstimated = rows.some((row) => row.estimated);
    const font = "SimSun";
    const doc = new Document({
      styles: { default: { document: { run: { font, size: 24 } } } },
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 },
            children: [new TextRun({ text: title, font, bold: true, size: 36 })],
          }),
          ...[
            `项目：${projectName}`,
            `地点：${location}`,
            `调研日期：${researchDate}`,
            `录音段数：${list.length}`,
            `总时长：${formatTimecode(list.reduce((sum, item) => sum + (item.duration_sec ?? 0), 0))}`,
          ].map((text) => new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text, font, size: 22 })],
          })),
          new Paragraph({
            spacing: { before: 100, after: 180 },
            children: [new TextRun({
              text: hasEstimated
                ? "时间标注说明：未含原始时间码的旧转写按录音时长与句子顺序估算。"
                : "时间标注说明：时间码由 AI 根据音频语句位置生成。",
              font,
              size: 18,
              color: "777777",
              italics: true,
            })],
          }),
          ...rows.map((row) => new Paragraph({
            spacing: { line: 360, after: 120 },
            children: [
              new TextRun({ text: `[${formatTimecode(row.seconds)}] `, font: "Consolas", size: 21, bold: true, color: "176B87" }),
              new TextRun({ text: row.text, font, size: 24 }),
            ],
          })),
        ],
      }],
    });
    return Packer.toBlob(doc);
  };

  const upload = async (blob: Blob, duration: number, parentId: string, idx: number, total: number) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/${recordId}/${Date.now()}-${idx}.webm`;
      const up = await supabase.storage.from("field-audios").upload(path, blob, {
        contentType: blob.type, upsert: false,
      });
      if (up.error) throw up.error;
      const { error } = await supabase.from("field_audios").insert({
        record_id: recordId,
        file_path: path,
        duration_sec: Math.round(duration),
        transcript_status: "pending",
        created_by: user.id,
        segment_index: idx,
        segment_total: total,
        parent_audio_id: parentId,
      });
      if (error) throw error;
      load(); onChange?.();
    } catch (e: any) {
      toast.error(e?.message ?? "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const newRecorder = () => {
    const stream = streamRef.current!;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    const mr = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    segStartTsRef.current = Date.now();
    const segIdx = segIndexRef.current;
    const parentId = parentIdRef.current!;
    const isFinal = () => isStoppingRef.current;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      const dur = (Date.now() - segStartTsRef.current) / 1000;
      // 推迟到 stop 完成后处理；total 暂记为占位 0，最终结束时回填
      await upload(blob, dur, parentId, segIdx, isFinal() ? segIdx + 1 : 0);
      if (isFinal()) {
        // 全部停止：回填同 parent 的 segment_total
        await supabase.from("field_audios")
          .update({ segment_total: segIdx + 1 })
          .eq("parent_audio_id", parentId);
        load();
        // 关闭麦克风
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      } else {
        // 自动切片：开下一段
        segIndexRef.current = segIdx + 1;
        const next = newRecorder();
        mediaRecorderRef.current = next;
        next.start();
      }
    };
    return mr;
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      parentIdRef.current = crypto.randomUUID();
      segIndexRef.current = 0;
      isStoppingRef.current = false;

      const mr = newRecorder();
      mr.start();
      mediaRecorderRef.current = mr;
      startTsRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
      }, 200);
      // 自动切片
      rotateRef.current = window.setInterval(() => {
        if (!isStoppingRef.current && mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop(); // 触发 onstop -> 自动启动下一段
        }
      }, SEGMENT_SEC * 1000);
    } catch (e: any) {
      toast.error(e?.message ?? "无法访问麦克风，请在浏览器中授予权限");
    }
  };

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rotateRef.current) { clearInterval(rotateRef.current); rotateRef.current = null; }
    isStoppingRef.current = true;
    setRecording(false);
    mediaRecorderRef.current?.stop();
  };

  const transcribe = async (a: FieldAudio) => {
    setTranscribing(a.id);
    try {
      await supabase.from("field_audios").update({ transcript_status: "transcribing" }).eq("id", a.id);
      load();
      const signedUrl = await ensureSignedUrl(a);
      const res = await fetch(signedUrl);
      const buf = await res.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
      }
      const base64 = btoa(binary);
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: { audioBase64: base64, mimeType: "audio/webm", context },
      });
      if (error) throw error;
      const transcript = (data as any)?.transcript ?? "";
      const timestampedTranscript = transcript
        ? timedSentences(transcript, a.duration_sec ?? 0)
            .map((row) => `[${formatTimecode(row.seconds)}] ${row.text}`)
            .join("\n")
        : "";
      await supabase.from("field_audios").update({
        transcript: timestampedTranscript,
        transcript_status: timestampedTranscript ? "done" : "failed",
      }).eq("id", a.id);
      toast.success("转写完成");
      load();
    } catch (e) {
      const msg = mapAudioTranscribeError(await extractFunctionErrorMessage(e));
      await supabase.from("field_audios").update({
        transcript_status: "failed", transcript: `[转写失败] ${msg}`,
      }).eq("id", a.id);
      toast.error(msg);
      load();
    } finally {
      setTranscribing(null);
    }
  };

  // 一键转写整组（按 parent 顺序）
  const transcribeGroup = async (parentId: string) => {
    const segs = audios
      .filter(x => x.parent_audio_id === parentId && x.transcript_status !== "done")
      .sort((a, b) => a.segment_index - b.segment_index);
    if (segs.length === 0) return toast.info("该录音组已全部转写完成");
    for (const s of segs) await transcribe(s);
    await load();
    await archiveTranscriptGroup(parentId, true);
  };

  const remove = async (a: FieldAudio) => {
    const groupId = a.parent_audio_id ?? a.id;
    const group = audios.filter((item) => (item.parent_audio_id ?? item.id) === groupId);
    const isMulti = group.length > 1;
    const transcriptPaths = user
      ? [
          `${user.id}/${projectId}/field-transcripts/${recordId}-${groupId}.txt`,
          `${user.id}/${projectId}/field-transcripts/${recordId}-${groupId}.docx`,
        ]
      : [];
    const ok = await confirm({
      title: isMulti ? `删除整组录音（共 ${group.length} 段）？` : "删除该录音及其转写文字？",
      description: isMulti
        ? "该长录音的全部分段、转写内容，以及已生成的正式转写文件将一并清除，此操作不可撤销。"
        : "音频、转写文本，以及已生成的正式转写文件将一并清除，此操作不可撤销。",
      destructive: true,
      confirmText: "删除录音",
    });
    if (!ok) return;

    const prevAudios = audios;
    const removedIds = new Set(group.map((item) => item.id));
    const nextAudios = audios.filter((item) => !removedIds.has(item.id));

    try {
      const filePaths = group.map((item) => item.file_path).filter(Boolean);
      if (playingId && group.some((item) => item.id === playingId)) {
        audioRef.current?.pause();
        setPlayingId(null);
      }
      setAudios(nextAudios);
      setSignedUrls((prev) => {
        const next = { ...prev };
        group.forEach((item) => { delete next[item.id]; });
        return next;
      });

      if (filePaths.length) {
        const { error: storageError } = await supabase.storage.from("field-audios").remove(filePaths);
        if (storageError) throw storageError;
      }

      const { error: rowDeleteError } = await supabase
        .from("field_audios")
        .delete()
        .in("id", group.map((item) => item.id));
      if (rowDeleteError) throw rowDeleteError;

      if (transcriptPaths.length) {
        await supabase.storage.from("project-materials").remove(transcriptPaths);
        await supabase.from("materials").delete().eq("project_id", projectId).in("file_path", transcriptPaths);
      }

      await load();
      onChange?.();
      toast.success(isMulti ? "整组录音已删除" : "录音已删除");
    } catch (e: any) {
      setAudios(prevAudios);
      toast.error(e?.message ?? "删除录音失败");
    }
  };

  const togglePlay = async (a: FieldAudio) => {
    try {
      const url = await ensureSignedUrl(a);
      if (playingId === a.id) {
        audioRef.current?.pause();
        setPlayingId(null);
        return;
      }
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      audioRef.current.onended = () => setPlayingId(null);
      await audioRef.current.play();
      setPlayingId(a.id);
    } catch (e: any) {
      toast.error(e?.message ?? "当前浏览器无法直接播放这段录音，请先下载后播放");
    }
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  };

  const downloadAudio = async (a: FieldAudio) => {
    let url = signedUrls[a.id];
    if (!url) {
      try {
        url = await ensureSignedUrl(a);
      } catch (e: any) {
        toast.error(e?.message ?? "链接尚未就绪");
        return;
      }
    }
    const res = await fetch(url);
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = u;
    link.download = `录音-${new Date(a.created_at).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
    link.click();
    URL.revokeObjectURL(u);
  };

  const downloadTranscript = async (a: FieldAudio) => {
    if (!a.transcript) return toast.error("尚无转写文本");
    const blob = await buildTranscriptDocx([a], "现场调研录音转写");
    const u = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = u;
    link.download = `转写-${new Date(a.created_at).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.docx`;
    link.click();
    URL.revokeObjectURL(u);
  };

  const archiveTranscriptGroup = async (parentId: string, silent = false) => {
    if (!user) return false;
    try {
      const { data: freshRows, error: freshErr } = await supabase
        .from("field_audios")
        .select("*")
        .eq("record_id", recordId)
        .order("created_at", { ascending: true });
      if (freshErr) throw freshErr;

      const list = ((freshRows as FieldAudio[] | null) ?? [])
        .filter(x => (x.parent_audio_id ?? x.id) === parentId)
        .sort((a, b) => a.segment_index - b.segment_index);
      if (!list.length) throw new Error("该录音组暂无内容");

      const undone = list.some(item => item.transcript_status !== "done" || !item.transcript?.trim());
      if (undone) throw new Error("请先完成整组转写，再生成正式文件");

      const materialName = `现场调研录音转写（${researchDate} ${location}）`;
      const fileName = safeStorageFileName(`现场调研录音转写_${projectName}_${location}_${researchDate}.docx`, "transcript.docx");
      const path = `${user.id}/${projectId}/field-transcripts/${recordId}-${parentId}-${Date.now()}.docx`;
      const legacyPath = `${user.id}/${projectId}/field-transcripts/${recordId}-${parentId}.txt`;
      const blob = await buildTranscriptDocx(list);

      const { data: existingRows, error: findErr } = await supabase
        .from("materials")
        .select("id,file_path,created_by")
        .eq("project_id", projectId)
        .eq("name", materialName)
        .order("created_at", { ascending: false });
      if (findErr) throw findErr;

      const ownRows = ((existingRows as Array<{ id: string; file_path: string | null; created_by: string | null }> | null) ?? [])
        .filter((item) => item.created_by === user.id);
      const existing = ownRows[0];
      if (existing?.file_path && existing.file_path !== path) {
        await supabase.storage.from("project-materials").remove([existing.file_path]);
      }
      const duplicateOwnRows = ownRows.slice(1);
      if (duplicateOwnRows.length) {
        await supabase
          .from("materials")
          .delete()
          .in("id", duplicateOwnRows.map((item) => item.id));
      }
      await supabase.storage.from("project-materials").remove([legacyPath]);

      const uploadRes = await supabase.storage.from("project-materials").upload(path, blob, {
        upsert: true,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      if (uploadRes.error) throw uploadRes.error;

      const materialPayload = {
        category: "调研论证类",
        name: materialName,
        required: false,
        status: "received",
        file_path: path,
        file_name: fileName,
        review_note: null,
      };

      if (existing?.id) {
        const { error } = await supabase.from("materials").update(materialPayload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("materials").insert({
          project_id: projectId,
          created_by: user.id,
          ...materialPayload,
        });
        if (error) throw error;
      }

      await load();
      onChange?.();
      if (!silent) toast.success("正式转写文件已生成，并入资料库");
      return true;
    } catch (e: any) {
      if (!silent) toast.error(e?.message ?? "正式文件生成失败");
      return false;
    }
  };

  // 按 parent 分组渲染
  const groups = (() => {
    const map = new Map<string, FieldAudio[]>();
    for (const a of audios) {
      const k = a.parent_audio_id ?? a.id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return Array.from(map.entries()).map(([k, list]) => ({
      key: k,
      list: list.sort((a, b) => a.segment_index - b.segment_index),
      latest: list.reduce((p, c) => new Date(p.created_at) > new Date(c.created_at) ? p : c),
    })).sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime());
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {!recording ? (
          <Button onClick={start} variant="hero" disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {uploading ? "上传中…" : "开始录音"}
          </Button>
        ) : (
          <Button onClick={stop} variant="destructive" className="animate-pulse">
            <Square className="h-4 w-4" />停止 · {fmt(elapsed)}
          </Button>
        )}
        {recording && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/30">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-xs font-mono tracking-wider text-destructive">RECORDING · 每 {SEGMENT_SEC}s 自动分段</span>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-md">
          暂无录音 · 长录音将自动按 {SEGMENT_SEC} 秒切片，便于稳定转写
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(g => {
            const isMulti = g.list.length > 1;
            const total = g.list[0]?.segment_total || g.list.length;
            const doneCount = g.list.filter(x => x.transcript_status === "done").length;
            const allDone = g.list.length > 0 && g.list.every(x => x.transcript_status === "done" && !!x.transcript?.trim());
            return (
              <div key={g.key} className="border border-border rounded-md p-3 bg-card/50 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] font-mono text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3 w-3" />
                    {isMulti ? `长录音 · ${g.list.length} 段 / 共约 ${fmt(g.list.reduce((s, x) => s + (x.duration_sec ?? 0), 0))}` : `单条录音 · ${fmt(g.list[0]?.duration_sec ?? 0)}`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {(isMulti || !allDone) && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => transcribeGroup(g.key)} disabled={!!transcribing}>
                        <Sparkles className="h-3 w-3" />一键转写整组（{doneCount}/{total}）
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={allDone ? "hero" : "outline"}
                      className="h-6 text-[10px]"
                      onClick={() => archiveTranscriptGroup(g.key)}
                      disabled={!allDone}
                    >
                      <FileText className="h-3 w-3" />生成正式文件
                    </Button>
                  </div>
                </div>
                {g.list.map(a => {
                  const tone =
                    a.transcript_status === "done" ? "success" as const :
                    a.transcript_status === "transcribing" ? "info" as const :
                    a.transcript_status === "failed" ? "danger" as const : "neutral" as const;
                  const label =
                    a.transcript_status === "done" ? "已转写" :
                    a.transcript_status === "transcribing" ? "转写中" :
                    a.transcript_status === "failed" ? "失败" : "未转写";
                  const isPlaying = playingId === a.id;
                  return (
                    <div key={a.id} className="border border-border/60 rounded p-2 bg-background/30">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => togglePlay(a)}>
                          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        {isMulti && <span className="text-[10px] font-mono text-accent">#{a.segment_index + 1}</span>}
                        <span className="font-mono text-xs tabular-nums text-foreground">{fmt(a.duration_sec ?? 0)}</span>
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {new Date(a.created_at).toLocaleString("zh-CN", { hour12: false })}
                        </span>
                        <StatusPill tone={tone}>{label}</StatusPill>
                        <div className="ml-auto flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadAudio(a)} title="下载录音"><Download className="h-3.5 w-3.5" /></Button>
                          {a.transcript && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => downloadTranscript(a)} title="下载转写"><FileText className="h-3.5 w-3.5" /></Button>
                          )}
                          <Button
                            size="sm" variant={a.transcript_status === "done" ? "ghost" : "outline"}
                            onClick={() => transcribe(a)}
                            disabled={transcribing === a.id || a.transcript_status === "transcribing"}
                          >
                            {transcribing === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            {a.transcript_status === "done" ? "重转" : a.transcript_status === "failed" ? "重新转写" : "AI 转文字"}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(a)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      {a.transcript && (
                        <div className="mt-2 text-sm leading-relaxed text-foreground bg-muted/30 border border-border rounded-md p-3 whitespace-pre-wrap">
                          {a.transcript}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog />
    </div>
  );
};
