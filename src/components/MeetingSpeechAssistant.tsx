import { useEffect, useMemo, useRef, useState } from "react";
import fixWebmDuration from "fix-webm-duration";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ui-kit";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { Mic, MicOff, Copy, Trash2, Save, Radio, Download, FileAudio, Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";

interface TranscriptEntry {
  id: string;
  speaker: string;
  text: string;
  created_at: string;
}

interface MeetingRecording {
  id: string;
  blob?: Blob;
  url: string;
  mimeType: string;
  speaker: string;
  created_at: string;
  duration_sec: number;
  status: "ready" | "transcribing" | "done" | "failed";
  transcript?: string;
  file_path?: string;
  file_name?: string | null;
}

interface MeetingSpeechAssistantProps {
  meetingId: string;
  projectId: string;
  meetingTitle: string;
  initialContent: string;
  onAppendToMinute: (content: string) => void;
}

const DEFAULT_SPEAKER = "发言人";

const cacheKey = (meetingId: string) => `meeting-speech-assistant:${meetingId}`;

const formatClock = (date: string) => {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "00:00:00";
  return value.toLocaleTimeString("zh-CN", { hour12: false });
};

const stripDenseTimecodes = (value: string) =>
  value
    .replace(/\s*\[(?:\d{1,2}:)?\d{2}:\d{2}\]\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？；：、])/g, "$1")
    .trim();

const formatTimeline = (entries: TranscriptEntry[]) =>
  entries.map((entry) => `[${formatClock(entry.created_at)}] ${entry.speaker}：${stripDenseTimecodes(entry.text)}`).join("\n");

const normalizeSpeakerList = (value: string) =>
  Array.from(new Set(
    value
      .split(/[，,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));

const blobToBase64 = async (blob: Blob) => {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(index, index + chunk)));
  }
  return btoa(binary);
};

const pickMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
};

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const rest = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
};

const extensionForMime = (mimeType: string) => {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
};

const MEETING_AUDIO_BUCKET = "meeting-audios";

const statusFromDb = (value: string | null | undefined): MeetingRecording["status"] => {
  if (value === "done" || value === "failed" || value === "transcribing") return value;
  return "ready";
};

const fixRecordingDuration = async (blob: Blob, durationMs: number) => {
  if (!blob.type.includes("webm")) return blob;
  try {
    const fixed = await fixWebmDuration(blob, durationMs, { logger: false });
    return fixed.type ? fixed : new Blob([fixed], { type: blob.type });
  } catch (error) {
    console.warn("fix webm duration failed", error);
    return blob;
  }
};

const RecordingAudioPlayer = ({ url, durationSec }: { url: string; durationSec: number }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [metadataDuration, setMetadataDuration] = useState(0);

  const duration = Math.max(1, Math.round(
    Number.isFinite(metadataDuration) && metadataDuration > 0 ? metadataDuration : durationSec,
  ));
  const safeCurrentTime = Math.min(duration, Math.max(0, currentTime));

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setMetadataDuration(0);
  }, [url]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      toast.error("录音播放失败，请下载后查看");
    }
  };

  const handleSeek = (value: string) => {
    const next = Number(value);
    setCurrentTime(next);
    if (audioRef.current) audioRef.current.currentTime = next;
  };

  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/25 p-3">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (Number.isFinite(nextDuration) && nextDuration > 0) {
            setMetadataDuration(nextDuration);
          }
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(duration);
        }}
      />
      <div className="flex items-center gap-3">
        <Button type="button" size="icon" variant="outline" className="h-9 w-9 rounded-full" onClick={togglePlay}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <span className="w-12 text-center font-mono text-xs text-foreground">{formatDuration(safeCurrentTime)}</span>
        <input
          aria-label="录音播放进度"
          className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={safeCurrentTime}
          onChange={(event) => handleSeek(event.target.value)}
        />
        <span className="w-12 text-center font-mono text-xs text-muted-foreground">{formatDuration(duration)}</span>
      </div>
    </div>
  );
};

const mapTranscribeError = (message?: string) => {
  if (!message) return "会议转写失败，请稍后重试";
  if (/Failed to fetch|network/i.test(message)) return "会议转写服务连接失败，请检查本地网络或稍后重试";
  if (/permission|denied|notallowed/i.test(message)) return "浏览器未授予麦克风权限，请先允许录音";
  if (/non-2xx|Edge Function/i.test(message)) return "会议转写服务返回错误，请检查转写模型配置后重试";
  if (/input_audio|audio|音频输入|不支持音频|模型不支持|modalit/i.test(message)) {
    return "当前 AI 模型不支持语音转写，请切换为支持音频的转写模型或配置本地 ASR";
  }
  if (/quota|额度|402|payment/i.test(message)) return "AI 额度不足，请检查转写服务额度";
  if (/过大|12MB|18_000_000|too large/i.test(message)) return "录音片段过大，请缩短录音或降低音频大小后重试";
  return message;
};

export const MeetingSpeechAssistant = ({
  meetingId,
  projectId,
  meetingTitle,
  initialContent,
  onAppendToMinute,
}: MeetingSpeechAssistantProps) => {
  const { user } = useAuth();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingUrlsRef = useRef<Set<string>>(new Set());
  const activeSpeakerRef = useRef(DEFAULT_SPEAKER);

  const [listening, setListening] = useState(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [interimText, setInterimText] = useState("");
  const [speakerInput, setSpeakerInput] = useState(DEFAULT_SPEAKER);
  const [activeSpeaker, setActiveSpeaker] = useState(DEFAULT_SPEAKER);
  const [manualText, setManualText] = useState("");
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [recordings, setRecordings] = useState<MeetingRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcribingId, setTranscribingId] = useState("");

  const recordingSupported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

  useEffect(() => {
    const raw = localStorage.getItem(cacheKey(meetingId));
    if (!raw) {
      setEntries([]);
      setManualText("");
      setInterimText("");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { entries?: TranscriptEntry[]; activeSpeaker?: string; speakerInput?: string };
      setEntries(parsed.entries ?? []);
      if (parsed.activeSpeaker) setActiveSpeaker(parsed.activeSpeaker);
      if (parsed.speakerInput) setSpeakerInput(parsed.speakerInput);
      setManualText("");
      setInterimText("");
    } catch {
      setEntries([]);
    }
  }, [meetingId]);

  useEffect(() => {
    let cancelled = false;
    const loadRecordings = async () => {
      if (!meetingId) {
        setRecordings([]);
        return;
      }
      setLoadingRecordings(true);
      const { data, error } = await (supabase as any)
        .from("meeting_recordings")
        .select("id,file_path,file_name,mime_type,speaker,duration_sec,transcript,transcript_status,created_at")
        .eq("meeting_id", meetingId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setLoadingRecordings(false);
      if (error) {
        toast.error(error.message);
        setRecordings([]);
        return;
      }
      const rows = (data ?? []) as any[];
      const next = await Promise.all(rows.map(async (row) => {
        const { data: signed } = await supabase.storage
          .from(MEETING_AUDIO_BUCKET)
          .createSignedUrl(row.file_path, 60 * 60);
        return {
          id: row.id,
          url: signed?.signedUrl ?? "",
          file_path: row.file_path,
          file_name: row.file_name,
          mimeType: row.mime_type || "audio/webm",
          speaker: row.speaker || DEFAULT_SPEAKER,
          created_at: row.created_at,
          duration_sec: Math.max(1, Math.round(Number(row.duration_sec) || 1)),
          status: statusFromDb(row.transcript_status),
          transcript: row.transcript ?? undefined,
        } satisfies MeetingRecording;
      }));
      if (!cancelled) setRecordings(next);
    };
    loadRecordings();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    localStorage.setItem(cacheKey(meetingId), JSON.stringify({ entries, activeSpeaker, speakerInput }));
  }, [meetingId, entries, activeSpeaker, speakerInput]);

  useEffect(() => () => {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    recordingUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    recordingUrlsRef.current.clear();
  }, []);

  const speakers = useMemo(() => {
    const list = normalizeSpeakerList(speakerInput);
    if (!list.length) return [DEFAULT_SPEAKER];
    return list;
  }, [speakerInput]);

  useEffect(() => {
    if (!speakers.includes(activeSpeaker)) {
      setActiveSpeaker(speakers[0]);
    }
  }, [speakers, activeSpeaker]);

  const transcriptTimeline = useMemo(() => formatTimeline(entries), [entries]);
  const formattedForMinute = useMemo(() => {
    if (!entries.length) return "";
    return [
      `【会议语音转写】${meetingTitle}`,
      "",
      "文字稿",
      transcriptTimeline,
    ].join("\n");
  }, [entries, meetingTitle, transcriptTimeline]);

  const appendEntry = (text: string, speaker = activeSpeakerRef.current) => {
    const clean = stripDenseTimecodes(text).replace(/\s+/g, " ").trim();
    if (!clean) return;
    setEntries((current) => [...current, {
      id: crypto.randomUUID(),
      speaker,
      text: clean,
      created_at: new Date().toISOString(),
    }]);
  };

  const getRecordingBlob = async (recording: MeetingRecording) => {
    if (recording.blob?.size) return recording.blob;
    if (!recording.file_path) return null;
    const { data, error } = await supabase.storage
      .from(MEETING_AUDIO_BUCKET)
      .download(recording.file_path);
    if (error) throw error;
    return data;
  };

  const transcribeRecording = async (recording: MeetingRecording) => {
    setProcessingCount((current) => current + 1);
    setTranscribingId(recording.id);
    setInterimText(`正在转写录音文件 · ${recording.speaker} · ${formatDuration(recording.duration_sec)}`);
    setRecordings((current) => current.map((item) => (
      item.id === recording.id ? { ...item, status: "transcribing" } : item
    )));
    try {
      if (recording.file_path) {
        await (supabase as any)
          .from("meeting_recordings")
          .update({ transcript_status: "transcribing" })
          .eq("id", recording.id);
      }
      const blob = await getRecordingBlob(recording);
      if (!blob?.size) throw new Error("录音文件为空，请重新录制");
      const audioBase64 = await blobToBase64(blob);
      const { data, error } = await supabase.functions.invoke("transcribe-audio", {
        body: {
          audioBase64,
          mimeType: recording.mimeType || "audio/webm",
          context: `会议主题：${meetingTitle}；当前发言人标签：${recording.speaker}；请忠实逐字转写，只输出音频中实际听到的内容，不要润色、总结、补写或根据会议主题推测。听不清的地方标注为“[听不清]”。`,
        },
      });
      if (error) throw error;
      const transcript = String((data as { transcript?: string } | null)?.transcript ?? "").trim();
      if (transcript) {
        appendEntry(transcript, recording.speaker);
        if (recording.file_path) {
          await (supabase as any)
            .from("meeting_recordings")
            .update({ transcript_status: "done", transcript })
            .eq("id", recording.id);
        }
        setRecordings((current) => current.map((item) => (
          item.id === recording.id ? { ...item, status: "done", transcript } : item
        )));
        toast.success("录音已转写完成");
      } else {
        if (recording.file_path) {
          await (supabase as any)
            .from("meeting_recordings")
            .update({ transcript_status: "failed" })
            .eq("id", recording.id);
        }
        setRecordings((current) => current.map((item) => (
          item.id === recording.id ? { ...item, status: "failed" } : item
        )));
        toast.error("AI 未返回可用转写内容");
      }
    } catch (error) {
      const message = await extractFunctionErrorMessage(error);
      if (recording.file_path) {
        await (supabase as any)
          .from("meeting_recordings")
          .update({ transcript_status: "failed" })
          .eq("id", recording.id);
      }
      setRecordings((current) => current.map((item) => (
        item.id === recording.id ? { ...item, status: "failed" } : item
      )));
      toast.error(mapTranscribeError(message));
    } finally {
      setProcessingCount((current) => Math.max(0, current - 1));
      setTranscribingId("");
      setInterimText("");
    }
  };

  const startRecognition = async () => {
    if (!user) {
      toast.error("请先登录后再录音");
      return;
    }
    if (!recordingSupported) {
      toast.error("当前浏览器不支持会议语音转写，请改用 Chrome 或 Edge");
      return;
    }
    if (listening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setListening(false);
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        const chunks = chunksRef.current;
        chunksRef.current = [];
        const rawBlob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (!rawBlob.size) {
          setInterimText("");
          toast.error("录音文件为空，请重新录制");
          return;
        }
        const durationMs = Math.max(1000, Date.now() - recordingStartedAtRef.current);
        const duration = Math.max(1, Math.round(durationMs / 1000));
        const blob = await fixRecordingDuration(rawBlob, durationMs);
        const url = URL.createObjectURL(blob);
        recordingUrlsRef.current.add(url);
        const localId = crypto.randomUUID();
        const extension = extensionForMime(blob.type || "audio/webm");
        const fileName = `${meetingTitle || "会议录音"}-${formatClock(new Date().toISOString())}.${extension}`;
        const filePath = `${user.id}/${meetingId}/${Date.now()}-${localId}.${extension}`;
        let savedId = localId;
        let savedPath: string | undefined;
        let savedFileName: string | null = fileName;
        const upload = await supabase.storage.from(MEETING_AUDIO_BUCKET).upload(filePath, blob, {
          contentType: blob.type || "audio/webm",
          upsert: false,
        });
        if (upload.error) {
          toast.error(`录音已生成，但保存到资料库失败：${upload.error.message}`);
        } else {
          savedPath = filePath;
          const { data: saved, error: saveError } = await (supabase as any).from("meeting_recordings").insert({
            meeting_id: meetingId,
            project_id: projectId,
            file_path: filePath,
            file_name: fileName,
            mime_type: blob.type || "audio/webm",
            speaker: activeSpeakerRef.current,
            duration_sec: duration,
            transcript_status: "ready",
            created_by: user.id,
          }).select("id,created_at").single();
          if (saveError) {
            await supabase.storage.from(MEETING_AUDIO_BUCKET).remove([filePath]);
            savedPath = undefined;
            toast.error(`录音已生成，但保存记录失败：${saveError.message}`);
          } else {
            savedId = saved.id;
          }
        }
        const recording: MeetingRecording = {
          id: savedId,
          blob,
          url,
          file_path: savedPath,
          file_name: savedFileName,
          mimeType: blob.type || "audio/webm",
          speaker: activeSpeakerRef.current,
          created_at: new Date().toISOString(),
          duration_sec: duration,
          status: "ready",
        };
        setRecordings((current) => [recording, ...current]);
        setRecordingSeconds(0);
        setInterimText("录音文件已生成，可先播放确认，再点击“转文本”。");
        toast.success(savedPath ? "录音文件已生成并保存" : "录音文件已生成");
      };
      recorder.start(1000);
      setListening(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.max(0, Math.round((Date.now() - recordingStartedAtRef.current) / 1000)));
      }, 500);
      setInterimText(`正在录音 · 当前发言人：${activeSpeakerRef.current}`);
      toast.success("已开始录音，结束后会生成音频文件");
    } catch (error: any) {
      toast.error(mapTranscribeError(error?.message));
    }
  };

  const stopRecognition = () => {
    setInterimText("正在保存录音文件…");
    mediaRecorderRef.current?.requestData();
    mediaRecorderRef.current?.stop();
  };

  const downloadRecording = (recording: MeetingRecording) => {
    const anchor = document.createElement("a");
    anchor.href = recording.url;
    anchor.download = `${meetingTitle || "会议录音"}-${formatClock(recording.created_at)}.${extensionForMime(recording.mimeType)}`;
    anchor.click();
  };

  const removeRecording = (recording: MeetingRecording) => {
    const previous = recordings;
    if (recording.url.startsWith("blob:")) {
      URL.revokeObjectURL(recording.url);
      recordingUrlsRef.current.delete(recording.url);
    }
    setRecordings((current) => current.filter((item) => item.id !== recording.id));
    Promise.resolve()
      .then(async () => {
        if (recording.file_path) {
          const [removeStorage, removeRow] = await Promise.all([
            supabase.storage.from(MEETING_AUDIO_BUCKET).remove([recording.file_path]),
            (supabase as any).from("meeting_recordings").delete().eq("id", recording.id),
          ]);
          if (removeStorage.error) throw removeStorage.error;
          if (removeRow.error) throw removeRow.error;
        }
        toast.success("录音文件已删除");
      })
      .catch((error) => {
        setRecordings(previous);
        toast.error(error?.message ?? "录音删除失败");
      });
  };

  const addManualEntry = () => {
    if (!manualText.trim()) {
      toast.error("请输入补充内容");
      return;
    }
    appendEntry(manualText);
    setManualText("");
    toast.success("已加入会议记录");
  };

  const copyTranscript = async () => {
    if (!formattedForMinute) return toast.error("暂无可复制内容");
    await navigator.clipboard.writeText(formattedForMinute);
    toast.success("会议转写已复制");
  };

  const clearTranscript = () => {
    setEntries([]);
    setManualText("");
    setInterimText("");
    localStorage.removeItem(cacheKey(meetingId));
    toast.success("已清空本次会议转写");
  };

  const injectIntoMinute = () => {
    if (!formattedForMinute) {
      toast.error("暂无可写入纪要的转写内容");
      return;
    }
    const next = initialContent.trim()
      ? `${initialContent.trim()}\n\n${formattedForMinute}`
      : formattedForMinute;
    onAppendToMinute(next);
    toast.success("已写入纪要草稿，请保存纪要");
  };

  return (
    <Card className="surface-card overflow-hidden p-0">
      <div className="border-b border-border bg-gradient-to-br from-primary/10 via-background to-accent/5 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary">VOICE TO TEXT · 录音转文字</div>
            <div className="mt-1 font-display text-xl font-semibold text-foreground">会议录音与文字稿生成</div>
            <div className="mt-1 text-sm text-muted-foreground">
              先生成音频文件，再点击“转文本”调用 AI，适合会议结束后确认录音、重试转写和写入纪要。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={recordingSupported ? "success" : "warning"} dot={false}>
              {recordingSupported ? "麦克风可用" : "浏览器不支持录音"}
            </StatusPill>
            <StatusPill tone={listening ? "info" : "neutral"} dot={listening}>
              {listening ? `录音中 ${formatDuration(recordingSeconds)}` : "等待录音"}
            </StatusPill>
            <StatusPill tone={processingCount > 0 ? "warning" : "neutral"} dot={processingCount > 0}>
              AI 转写 {processingCount}
            </StatusPill>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          {[
            { n: "1", title: "开始录音", desc: "采集会议声音", active: listening },
            { n: "2", title: "生成音频", desc: `${recordings.length} 个录音文件`, active: recordings.length > 0 },
            { n: "3", title: "转成文字", desc: `${entries.length} 条文字记录`, active: entries.length > 0 || processingCount > 0 },
          ].map((step) => (
            <div
              key={step.n}
              className={`rounded-xl border p-3 transition ${
                step.active ? "border-primary/35 bg-primary/10 text-foreground" : "border-border bg-background/70 text-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full border border-current font-mono text-[11px]">{step.n}</span>
                <span className="font-medium">{step.title}</span>
              </div>
              <div className="mt-1 pl-8">{step.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-foreground">录音控制</div>
                <div className="text-xs text-muted-foreground">选择发言人后开始录音</div>
              </div>
              <Radio className={`h-5 w-5 ${listening ? "text-destructive animate-pulse" : "text-muted-foreground"}`} />
            </div>

            <div className="mt-4 rounded-xl border border-border bg-background/80 p-4 text-center">
              <div className="text-xs text-muted-foreground">当前录音时长</div>
              <div className="mt-1 font-mono text-4xl font-semibold tracking-tight text-foreground">
                {formatDuration(recordingSeconds)}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {listening ? `正在录制：${activeSpeaker}` : "点击开始录音后，结束时自动生成音频文件"}
              </div>
            </div>

            <div className="mt-4">
              <Label>发言人标签</Label>
              <Input
                value={speakerInput}
                onChange={(event) => setSpeakerInput(event.target.value)}
                placeholder="例如：主持人, 财务专家, 业务专家"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {speakers.map((speaker) => (
                  <button
                    key={speaker}
                    type="button"
                    onClick={() => setActiveSpeaker(speaker)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      activeSpeaker === speaker ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:border-accent/40"
                    }`}
                  >
                    {speaker}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              {listening ? (
                <Button size="lg" variant="outline" onClick={stopRecognition}>
                  <MicOff className="h-4 w-4" />
                  结束录音并生成文件
                </Button>
              ) : (
                <Button size="lg" variant="hero" onClick={startRecognition} disabled={!recordingSupported}>
                  <Mic className="h-4 w-4" />
                  开始录音
                </Button>
              )}
              <Button variant="outline" onClick={injectIntoMinute} disabled={!entries.length}>
                <Save className="h-4 w-4" />
                写入纪要草稿
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">当前状态</div>
              <StatusPill tone={interimText ? "info" : "neutral"} dot={!!interimText}>
                {interimText ? "处理中" : "空闲"}
              </StatusPill>
            </div>
            <div className="mt-2 rounded-md bg-background/80 p-3 text-sm leading-7 text-foreground">
              {interimText || "录音完成后，音频文件会显示在右侧。点击“转文本”后这里显示进度。"}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-foreground">录音文件</div>
                <div className="text-xs text-muted-foreground">可以播放确认、下载备份，或单独点击“转文本”。</div>
              </div>
              <StatusPill tone="info" dot={false}>{recordings.length} 个文件</StatusPill>
            </div>

            {recordings.length ? (
              <div className="mt-3 space-y-2">
                {recordings.map((recording) => (
                  <div key={recording.id} className="rounded-xl border border-border bg-background/80 p-3">
                    <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <FileAudio className="h-4 w-4 text-primary" />
                          <span className="font-medium text-foreground">{recording.speaker}</span>
                          <span className="text-xs text-muted-foreground">{formatClock(recording.created_at)}</span>
                          <StatusPill tone="neutral" dot={false}>{formatDuration(recording.duration_sec)}</StatusPill>
                          <StatusPill tone={recording.status === "done" ? "success" : recording.status === "failed" ? "danger" : recording.status === "transcribing" ? "warning" : "neutral"} dot={recording.status === "transcribing"}>
                            {recording.status === "done" ? "已转写" : recording.status === "failed" ? "转写失败" : recording.status === "transcribing" ? "转写中" : "待转写"}
                          </StatusPill>
                        </div>
                        <RecordingAudioPlayer url={recording.url} durationSec={recording.duration_sec} />
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="hero"
                          disabled={!!transcribingId}
                          onClick={() => transcribeRecording(recording)}
                        >
                          {transcribingId === recording.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileAudio className="h-4 w-4" />}
                          转文本
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => downloadRecording(recording)}>
                          <Download className="h-4 w-4" />
                          下载
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeRecording(recording)} disabled={transcribingId === recording.id}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 grid min-h-[190px] place-items-center rounded-xl border border-dashed border-border bg-background/60 p-6 text-center">
                <div>
                  <FileAudio className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div className="mt-3 text-sm font-medium text-foreground">暂无录音文件</div>
                  <div className="mt-1 text-sm text-muted-foreground">点击左侧“开始录音”，结束后会在这里生成音频。</div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-foreground">文字稿</div>
                <div className="text-xs text-muted-foreground">只保留一份转写文本，可复制、清空或写入纪要。</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={copyTranscript} disabled={!entries.length}>
                  <Copy className="h-4 w-4" />
                  复制文字稿
                </Button>
                <Button size="sm" variant="ghost" onClick={clearTranscript} disabled={!entries.length}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                  清空
                </Button>
              </div>
            </div>

            <Textarea
              readOnly
              rows={12}
              value={transcriptTimeline}
              className="mt-3 text-sm leading-7"
              placeholder="暂无转写内容"
            />

            <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
              <Label>手动补充文字</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <Textarea
                  rows={3}
                  value={manualText}
                  onChange={(event) => setManualText(event.target.value)}
                  placeholder="AI 未识别到的内容，可以手动补充到当前发言人名下。"
                />
                <Button variant="outline" onClick={addManualEntry}>
                  <Save className="h-4 w-4" />
                  加入文字稿
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
