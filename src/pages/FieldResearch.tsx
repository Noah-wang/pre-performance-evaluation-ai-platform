import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EditPermissionNotice } from "@/components/EditPermissionNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { SignaturePad } from "@/components/SignaturePad";
import { AMapView, MapPoint } from "@/components/AMapView";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useIsMobile } from "@/hooks/use-mobile";
import { reverseGeocode } from "@/lib/amap";
import { Plus, Trash2, MapPin, Calendar, Camera, PenLine, ImageIcon, X, Navigation, Map as MapIcon, ClipboardList, Mic, Download, Smartphone, CheckCircle2, Save } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { EmptyState, SectionHeader, StatusPill } from "@/components/ui-kit";
import { AudioRecorder } from "@/components/AudioRecorder";
import { useConfirm } from "@/hooks/useConfirm";

interface Project { id: string; name: string; }
interface Record {
  id: string; project_id: string; location: string; research_date: string;
  participants: string | null; findings: string | null; conclusion: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  gps_lng: number | null; gps_lat: number | null; gps_accuracy: number | null;
}
interface Photo { id: string; record_id: string; file_path: string; caption: string | null; watermarked?: boolean; }
interface Sig { id: string; record_id: string; expert_name: string; signature_data: string; signed_at: string; }
interface FieldAudioEntry {
  id: string;
  created_at: string;
  duration_sec: number | null;
  transcript: string | null;
  transcript_status: string;
  parent_audio_id: string | null;
  segment_index: number;
  segment_total: number;
}

interface AudioGroupSummary {
  id: string;
  label: string;
  recordedAt: string;
  totalDuration: number;
  transcript: string | null;
  completedSegments: number;
  totalSegments: number;
}

const mobileMarkerPattern = (label: string) => new RegExp(`【${label}】([^\\n]+)`);

const readMobileMarker = (text: string | null | undefined, label: string) => {
  if (!text) return null;
  const match = text.match(mobileMarkerPattern(label));
  return match?.[1]?.trim() ?? null;
};

const appendMobileMarker = (text: string | null | undefined, label: string, value: string) => {
  const base = text?.trim() ?? "";
  if (readMobileMarker(base, label)) return base;
  return `${base ? `${base}\n` : ""}【${label}】${value}`;
};

const stripMobileMarkers = (text: string | null | undefined) => {
  if (!text) return "";
  return text
    .split("\n")
    .filter((line) => !/^【移动端(签到|签退|采集完成)】/.test(line.trim()))
    .join("\n")
    .trim();
};

const mergeConclusionWithMarkers = (plainText: string | null | undefined, rawText: string | null | undefined) => {
  const markerLines = (rawText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^【移动端(签到|签退|采集完成)】/.test(line));
  const plain = plainText?.trim() ?? "";
  return [...(plain ? [plain] : []), ...markerLines].join("\n") || null;
};

const stripTranscriptTimecodes = (text: string | null | undefined) =>
  (text ?? "")
    .replace(/^\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]\s*/gm, "")
    .trim();

const formatAudioDuration = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60).toString().padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const buildAudioGroupSummaries = (entries: FieldAudioEntry[]): AudioGroupSummary[] => {
  const grouped = new Map<string, FieldAudioEntry[]>();
  entries.forEach((entry) => {
    const key = entry.parent_audio_id ?? entry.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  });

  return Array.from(grouped.entries())
    .map(([id, list], index) => {
      const sorted = list.sort((a, b) => a.segment_index - b.segment_index);
      const transcript = sorted
        .map((item) => stripTranscriptTimecodes(item.transcript))
        .filter(Boolean)
        .join("\n");
      const totalDuration = sorted.reduce((sum, item) => sum + (item.duration_sec ?? 0), 0);
      const completedSegments = sorted.filter((item) => item.transcript_status === "done" && stripTranscriptTimecodes(item.transcript)).length;
      return {
        id,
        label: sorted.length > 1 ? `长录音 ${index + 1}` : `录音 ${index + 1}`,
        recordedAt: sorted[0]?.created_at ?? new Date().toISOString(),
        totalDuration,
        transcript: transcript || null,
        completedSegments,
        totalSegments: sorted.length,
      };
    })
    .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
};

const FieldResearch = () => {
  const { user } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const isMobile = useIsMobile();
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get("mode");
  const mobileMode = modeParam === "mobile" || (modeParam !== "desktop" && isMobile);
  const [projects, setProjects] = useState<Project[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [active, setActive] = useState<Record | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [audioEntries, setAudioEntries] = useState<FieldAudioEntry[]>([]);
  const [audioCount, setAudioCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    project_id: "", location: "", research_date: format(new Date(), "yyyy-MM-dd"),
    participants: "", findings: "", conclusion: "",
    gps_lng: null as number | null, gps_lat: null as number | null, gps_accuracy: null as number | null,
  });
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [sigName, setSigName] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState({ findings: "", conclusion: "" });
  const [savingNote, setSavingNote] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const { loading: geoLoading, getCurrent } = useGeolocation();

  const loadProjects = async () => {
    const { data } = await supabase.from("projects").select("id,name").order("created_at", { ascending: false });
    setProjects((data as Project[]) ?? []);
    if (data && data.length && !form.project_id) setForm(f => ({ ...f, project_id: data[0].id }));
  };
  const loadRecords = async () => {
    const { data, error } = await supabase.from("field_records").select("*").order("research_date", { ascending: false });
    if (error) toast.error(error.message);
    else { setRecords((data as Record[]) ?? []); if (data && data.length && !active) setActive(data[0] as Record); }
  };
  const loadDetail = async (id: string) => {
    const [{ data: p }, { data: s }, { data: aRows, count: aCount }] = await Promise.all([
      supabase.from("field_photos").select("*").eq("record_id", id).order("created_at"),
      supabase.from("field_signatures").select("*").eq("record_id", id).order("signed_at"),
      supabase
        .from("field_audios")
        .select("id,created_at,duration_sec,transcript,transcript_status,parent_audio_id,segment_index,segment_total", { count: "exact" })
        .eq("record_id", id)
        .order("created_at", { ascending: true }),
    ]);
    setPhotos((p as Photo[]) ?? []);
    setSigs((s as Sig[]) ?? []);
    const nextAudioEntries = (aRows as FieldAudioEntry[]) ?? [];
    setAudioEntries(nextAudioEntries);
    setAudioCount(aCount ?? nextAudioEntries.length);
  };

  useEffect(() => { loadProjects(); loadRecords(); }, []);
  useEffect(() => {
    if (active) loadDetail(active.id);
    else {
      setPhotos([]);
      setSigs([]);
      setAudioEntries([]);
      setAudioCount(0);
    }
  }, [active?.id]);

  const captureGps = async () => {
    const c = await getCurrent();
    if (!c) return;
    setForm(f => ({ ...f, gps_lng: c.lng, gps_lat: c.lat, gps_accuracy: c.accuracy }));
    const addr = await reverseGeocode(c.lng, c.lat);
    if (addr) {
      setForm(f => ({ ...f, location: f.location.trim() ? f.location : addr }));
      toast.success("已自动填充地址");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.project_id || !form.location.trim()) return toast.error("项目和地点必填");
    const mobileSignIn = format(new Date(), "yyyy-MM-dd HH:mm");
    const seededConclusion = mobileMode
      ? appendMobileMarker(form.conclusion.trim() || null, "移动端签到", mobileSignIn)
      : form.conclusion.trim() || null;
    const { data, error } = await supabase.from("field_records").insert({
      project_id: form.project_id, location: form.location.trim(), research_date: form.research_date,
      participants: form.participants.trim() || null,
      findings: form.findings.trim() || null,
      conclusion: seededConclusion,
      gps_lng: form.gps_lng, gps_lat: form.gps_lat, gps_accuracy: form.gps_accuracy,
      created_by: user.id,
    }).select().single();
    if (error) toast.error(error.message);
    else {
      toast.success(mobileMode ? "签到建档成功，可以继续拍照、录音和签字" : "调研记录已创建");
      setOpen(false);
      setForm({ ...form, location: "", participants: "", findings: "", conclusion: "", gps_lng: null, gps_lat: null, gps_accuracy: null });
      await loadRecords();
      setActive(data as Record);
    }
  };

  const removeRecord = async (r: Record) => {
    if (!(await confirm({ title: `删除"${r.location}"调研记录？`, description: "该调研记录的所有照片、录音、签章将一并删除，此操作不可撤销。", destructive: true, confirmText: "删除记录" }))) return;
    const { error } = await supabase.from("field_records").delete().eq("id", r.id);
    if (error) toast.error(error.message);
    else { toast.success("已删除"); setActive(null); loadRecords(); }
  };

  const uploadPhoto = async () => {
    if (!user || !active || !photoFile) return;
    try {
      // 硬水印烧录：GPS + 时间 + 用户 + 项目 + 地点 烧进像素
      const { burnWatermark } = await import("@/lib/photoWatermark");
      const burned = await burnWatermark(photoFile, {
        gpsLng: active.gps_lng,
        gpsLat: active.gps_lat,
        takenAt: new Date(),
        userLabel: user.email ?? "未知用户",
        projectLabel: projectName(active.project_id),
        locationLabel: active.location,
      });
      const path = `${user.id}/${active.id}/${Date.now()}-wm.jpg`;
      const up = await supabase.storage.from("field-photos").upload(path, burned.blob, {
        contentType: "image/jpeg",
      });
      if (up.error) throw up.error;
      const { error } = await supabase.from("field_photos").insert({
        record_id: active.id, file_path: path,
        caption: photoCaption.trim() || null,
        created_by: user.id,
        watermarked: true,
        gps_lng: active.gps_lng, gps_lat: active.gps_lat,
        taken_at: new Date().toISOString(),
        exif_json: burned.exif as any,
      });
      if (error) throw error;
      toast.success("照片已烧录水印并上传");
      setPhotoOpen(false); setPhotoCaption(""); setPhotoFile(null); loadDetail(active.id);
    } catch (e: any) {
      toast.error(e?.message ?? "上传失败");
    }
  };

  const removePhoto = async (p: Photo) => {
    if (!(await confirm({ title: "删除这张照片？", destructive: true, confirmText: "删除" }))) return;
    await supabase.storage.from("field-photos").remove([p.file_path]);
    await supabase.from("field_photos").delete().eq("id", p.id);
    loadDetail(active!.id);
  };

  const [photoUrls, setPhotoUrls] = useState<{ [key: string]: string }>({});
  useEffect(() => {
    (async () => {
      const next: { [key: string]: string } = {};
      for (const p of photos) {
        const { data } = await supabase.storage.from("field-photos").createSignedUrl(p.file_path, 3600);
        if (data?.signedUrl) next[p.file_path] = data.signedUrl;
      }
      setPhotoUrls(next);
    })();
  }, [photos]);
  const photoUrl = (path: string) => photoUrls[path] ?? "";

  const saveSig = async (dataUrl: string) => {
    if (!user || !active) return;
    if (!sigName.trim()) return toast.error("请输入专家姓名");
    const { error } = await supabase.from("field_signatures").insert({
      record_id: active.id, expert_name: sigName.trim(), signature_data: dataUrl, created_by: user.id,
    });
    if (error) toast.error(error.message);
    else { toast.success("签字已保存"); setSigName(""); loadDetail(active.id); }
  };

  const removeSig = async (s: Sig) => {
    await supabase.from("field_signatures").delete().eq("id", s.id);
    loadDetail(active!.id);
  };

  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? "—";
  const signInStamp = useMemo(() => readMobileMarker(active?.conclusion, "移动端签到") ?? active?.created_at ?? null, [active?.conclusion, active?.created_at]);
  const signOutStamp = useMemo(() => readMobileMarker(active?.conclusion, "移动端签退"), [active?.conclusion]);
  const completionStamp = useMemo(() => readMobileMarker(active?.conclusion, "移动端采集完成"), [active?.conclusion]);
  const visibleConclusion = useMemo(() => stripMobileMarkers(active?.conclusion), [active?.conclusion]);
  const audioSummaries = useMemo(() => buildAudioGroupSummaries(audioEntries), [audioEntries]);

  const mobileProgress = useMemo(() => ({
    checkedIn: Boolean(active),
    located: Boolean(active?.gps_lng != null && active?.gps_lat != null),
    photos: photos.length,
    audios: audioCount,
    signed: sigs.length,
    signedOut: Boolean(signOutStamp),
    completed: Boolean(completionStamp),
  }), [active, audioCount, completionStamp, photos.length, sigs.length, signOutStamp]);

  useEffect(() => {
    if (!active) {
      setNoteDraft({ findings: "", conclusion: "" });
      return;
    }
    setNoteDraft({
      findings: active.findings ?? "",
      conclusion: stripMobileMarkers(active.conclusion),
    });
  }, [active?.id, active?.findings, active?.conclusion]);

  const saveNotes = async () => {
    if (!active) return;
    setSavingNote(true);
    const mergedConclusion = mergeConclusionWithMarkers(noteDraft.conclusion, active.conclusion);
    const { error } = await supabase.from("field_records").update({
      findings: noteDraft.findings.trim() || null,
      conclusion: mergedConclusion,
    }).eq("id", active.id);
    setSavingNote(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const next = {
      ...active,
      findings: noteDraft.findings.trim() || null,
      conclusion: mergedConclusion,
      updated_at: new Date().toISOString(),
    };
    setActive(next);
    setRecords((prev) => prev.map((item) => item.id === next.id ? next : item));
    toast.success("现场记录已保存");
  };

  const markMobileComplete = async () => {
    if (!active) return;
    if (completionStamp) {
      toast.info("该记录已标记为采集完成");
      return;
    }
    const stamp = format(new Date(), "yyyy-MM-dd HH:mm");
    const withSignOut = appendMobileMarker(active.conclusion, "移动端签退", stamp);
    const appended = appendMobileMarker(withSignOut, "移动端采集完成", stamp);
    const { error } = await supabase.from("field_records").update({ conclusion: appended }).eq("id", active.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("已标记为移动端采集完成");
    await loadRecords();
    const nextUpdatedAt = new Date().toISOString();
    setActive((prev) => prev ? { ...prev, conclusion: appended, updated_at: nextUpdatedAt } : prev);
    setRecords((prev) => prev.map((item) => item.id === active.id ? { ...item, conclusion: appended, updated_at: nextUpdatedAt } : item));
  };

  const activeMapPoints: MapPoint[] = useMemo(() =>
    active && active.gps_lng != null && active.gps_lat != null
      ? [{
        id: active.id,
        lng: Number(active.gps_lng),
        lat: Number(active.gps_lat),
        title: active.location,
        subtitle: `精度约 ${Math.round(Number(active.gps_accuracy ?? 0))} 米`,
      }]
      : [],
    [active]
  );

  const exportRecordDoc = async () => {
    if (!active) return;
    const { createTextDocxBlob } = await import("@/lib/generatedDocx");
    const { saveAs } = await import("file-saver");
    const text = [
      `项目名称：${projectName(active.project_id)}`,
      `踏勘地点：${active.location}`,
      `踏勘日期：${active.research_date}`,
      `参与人员：${active.participants || "未填写"}`,
      `签到时间：${signInStamp ? format(new Date(signInStamp), "yyyy-MM-dd HH:mm") : "未记录"}`,
      `签退时间：${signOutStamp ? format(new Date(signOutStamp), "yyyy-MM-dd HH:mm") : "未记录"}`,
      active.gps_lng != null && active.gps_lat != null
        ? `定位信息：经度 ${Number(active.gps_lng).toFixed(6)}，纬度 ${Number(active.gps_lat).toFixed(6)}，精度约 ${Math.round(Number(active.gps_accuracy ?? 0))} 米`
        : "定位信息：未采集",
      "",
      "一、现场踏勘情况",
      active.findings || "未填写。",
      "",
      "二、初步核验意见",
      visibleConclusion || "未填写。",
      "",
      "三、现场录音纪要",
      audioSummaries.length
        ? audioSummaries.map((audio, index) => [
          `${index + 1}. ${audio.label}（录音时间：${format(new Date(audio.recordedAt), "yyyy-MM-dd HH:mm")}，总时长：${formatAudioDuration(audio.totalDuration)}）`,
          audio.transcript || `转写状态：已完成 ${audio.completedSegments}/${audio.totalSegments} 段，暂无可展示文字。`,
        ].join("\n")).join("\n\n")
        : "暂无录音。",
      "",
      "四、现场照片取证",
      photos.length
        ? photos.map((photo, index) => `${index + 1}. ${photo.caption || "现场照片"}${photo.watermarked ? "（已烧录 GPS/时间水印）" : ""}`).join("\n")
        : "暂无照片。",
      "",
      "五、专家签字情况",
      sigs.length
        ? sigs.map((sig, index) => `${index + 1}. ${sig.expert_name}，签署时间：${format(new Date(sig.signed_at), "yyyy-MM-dd HH:mm")}`).join("\n")
        : "暂无电子签字。",
      "",
      "六、记录说明",
      "本记录由系统根据现场调研表单、照片取证、GPS 定位和电子签字信息自动生成，可作为事前绩效评估现场核验资料归档。",
    ].join("\n");
    const blob = await createTextDocxBlob("现场踏勘记录", text);
    saveAs(blob, `${projectName(active.project_id)}-现场踏勘记录.docx`);
    toast.success("现场踏勘记录已导出");
  };

  return (
    <div>
      <PageHeader
        eyebrow="PHASE II · 05 · 现场调研"
        title="现场调研记录"
        subtitle={mobileMode ? "移动端采集模式 · 签到建档 · 定位取证 · 录音签字" : "现场踏勘 · 照片取证 · 专家电子签字 · GPS 定位与地图"}
        actions={
          <div className="flex items-center gap-2">
            {!mobileMode && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="hero"><Plus className="h-4 w-4" />新建调研记录</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="font-display text-xl">新建现场调研记录</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <Label>评估对象</Label>
                  <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                    <SelectTrigger><SelectValue placeholder="请选择" /></SelectTrigger>
                    <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>调研地点</Label>
                    <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={200} />
                  </div>
                  <div>
                    <Label>调研日期</Label>
                    <Input type="date" value={form.research_date} onChange={(e) => setForm({ ...form, research_date: e.target.value })} />
                  </div>
                </div>
                <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono tracking-wider uppercase text-accent">
                      <Navigation className="h-3.5 w-3.5" />GPS 定位
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={captureGps} disabled={geoLoading}>
                      <MapPin className="h-3.5 w-3.5" />{geoLoading ? "定位中…" : "获取当前位置"}
                    </Button>
                  </div>
                  {form.gps_lng != null && form.gps_lat != null && (
                    <div className="mt-2 text-xs font-mono text-foreground tabular-nums">
                      经度 {form.gps_lng.toFixed(6)} · 纬度 {form.gps_lat.toFixed(6)}
                      <span className="ml-2 text-muted-foreground">±{Math.round(form.gps_accuracy ?? 0)}m</span>
                    </div>
                  )}
                </div>
                <div>
                  <Label>参与人员</Label>
                  <Input value={form.participants} onChange={(e) => setForm({ ...form, participants: e.target.value })}
                    placeholder="如：张明、李华、王芳（专家）" />
                </div>
                <div>
                  <Label>问题/发现</Label>
                  <Textarea value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} rows={3} />
                </div>
                <div>
                  <Label>初步结论</Label>
                  <Textarea value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} rows={2} />
                </div>
                <DialogFooter><Button type="submit" variant="hero">保存</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
            )}
          </div>
        }
      />

      <EditPermissionNotice />

      {mobileMode && (
        <div className="space-y-4 mb-6">
          <Card className="surface-card p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="section-eyebrow mb-2">MOBILE H5 · 现场采集</div>
                <div className="text-sm text-muted-foreground">适合手机端一步步完成：签到建档、定位、拍照、录音、签字、提交。</div>
              </div>
              <StatusPill tone="info" dot={false}>H5 轻量流程</StatusPill>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill tone={mobileProgress.checkedIn ? "success" : "neutral"} dot={false}>1. 签到建档</StatusPill>
              <StatusPill tone={mobileProgress.located ? "success" : "neutral"} dot={false}>2. GPS 定位</StatusPill>
              <StatusPill tone={mobileProgress.photos > 0 ? "success" : "neutral"} dot={false}>3. 现场照片 {mobileProgress.photos}</StatusPill>
              <StatusPill tone={mobileProgress.audios > 0 ? "success" : "neutral"} dot={false}>4. 录音 {mobileProgress.audios}</StatusPill>
              <StatusPill tone={mobileProgress.signed > 0 ? "success" : "neutral"} dot={false}>5. 签字 {mobileProgress.signed}</StatusPill>
              <StatusPill tone={mobileProgress.signedOut ? "success" : "neutral"} dot={false}>6. 签退</StatusPill>
              <StatusPill tone={mobileProgress.completed ? "success" : "warning"} dot={false}>7. 完成提交</StatusPill>
            </div>
          </Card>

          <Card className="surface-card p-4">
            <SectionHeader eyebrow="STEP 1" title="签到建档" icon={ClipboardList} />
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>评估对象</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                  <SelectTrigger><SelectValue placeholder="请选择项目" /></SelectTrigger>
                  <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>调研地点</Label>
                  <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={200} />
                </div>
                <div>
                  <Label>调研日期</Label>
                  <Input type="date" value={form.research_date} onChange={(e) => setForm({ ...form, research_date: e.target.value })} />
                </div>
              </div>
              <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-mono tracking-wider uppercase text-accent">定位签到</div>
                  <Button type="button" size="sm" variant="outline" onClick={captureGps} disabled={geoLoading}>
                    <Navigation className="h-3.5 w-3.5" />
                    {geoLoading ? "定位中…" : "获取当前位置"}
                  </Button>
                </div>
                {form.gps_lng != null && form.gps_lat != null && (
                  <div className="mt-2 text-xs font-mono tabular-nums text-foreground">
                    {form.gps_lng.toFixed(6)}, {form.gps_lat.toFixed(6)} · ±{Math.round(form.gps_accuracy ?? 0)}m
                  </div>
                )}
              </div>
              <div>
                <Label>参与人员</Label>
                <Input value={form.participants} onChange={(e) => setForm({ ...form, participants: e.target.value })} placeholder="如：项目负责人、专家、工作组成员" />
              </div>
              <Button type="submit" variant="hero" className="w-full">
                <CheckCircle2 className="h-4 w-4" />
                签到建档
              </Button>
            </form>
          </Card>

          {active && (
            <Card className="surface-card p-4">
              <SectionHeader eyebrow="STEP 2" title="当前采集状态" icon={Smartphone} />
              <div className="space-y-3 text-sm">
                <div>
                  <Label>切换调研记录</Label>
                  <Select value={active.id} onValueChange={(value) => setActive(records.find((item) => item.id === value) ?? null)}>
                    <SelectTrigger>
                      <SelectValue placeholder="请选择调研记录" />
                    </SelectTrigger>
                    <SelectContent>
                      {records.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.research_date} · {item.location}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="font-medium">{projectName(active.project_id)} · {active.location}</div>
                <div className="grid grid-cols-1 gap-1 text-muted-foreground">
                  <div>签到时间：{signInStamp ? new Date(signInStamp).toLocaleString("zh-CN", { hour12: false }) : "未记录"}</div>
                  <div>签退时间：{signOutStamp ? new Date(signOutStamp).toLocaleString("zh-CN", { hour12: false }) : "未签退"}</div>
                  <div>完成时间：{completionStamp ? new Date(completionStamp).toLocaleString("zh-CN", { hour12: false }) : "未提交"}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={exportRecordDoc}>
                  <Download className="h-4 w-4" />导出现场踏勘记录
                </Button>
                <Button size="sm" variant="outline" onClick={() => document.getElementById("field-photo-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  拍照取证
                </Button>
                <Button size="sm" variant="outline" onClick={() => document.getElementById("field-audio-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  录音转写
                </Button>
                <Button size="sm" variant="outline" onClick={() => document.getElementById("field-sign-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  专家签字
                </Button>
                <Button size="sm" variant="hero" onClick={markMobileComplete}>
                  标记完成提交
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      <div className={`grid gap-6 ${mobileMode ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-[320px_1fr]"}`}>
        {!mobileMode && (
        <Card className="surface-card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent">RESEARCH RECORDS</div>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">[{records.length.toString().padStart(2, "0")}]</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
            {records.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">暂无记录</div>}
            {records.map(r => {
              const isActive = active?.id === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setActive(r)}
                  className={`group relative w-full text-left p-3 transition-all ${isActive ? "bg-accent/8" : "hover:bg-accent/4"}`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r bg-accent shadow-[0_0_8px_hsl(var(--accent)/0.6)]" />
                  )}
                  <div className={`font-medium text-sm truncate flex items-center gap-1 ${isActive ? "text-accent" : "text-foreground"}`}>
                    {r.gps_lng != null && <Navigation className="h-3 w-3 text-accent shrink-0" />}
                    <span className="truncate">{r.location}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-muted-foreground tabular-nums">
                    <Calendar className="h-3 w-3" />{r.research_date}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gold truncate">{projectName(r.project_id)}</div>
                </button>
              );
            })}
          </div>
        </Card>
        )}

        {!active && (
          <Card className="surface-card p-0">
            <EmptyState
              icon={ClipboardList}
              title="请选择调研记录"
              hint="在左侧列表中选择一条记录查看详情，或新建调研记录"
            />
          </Card>
        )}

        {active && (
          <div className="space-y-5">
            <Card className="surface-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="section-eyebrow mb-2">{projectName(active.project_id)}</div>
                  <div className="flex items-center gap-2 text-foreground">
                    <MapPin className="h-5 w-5 text-accent" />
                    <h2 className="font-display text-2xl font-bold tracking-tight truncate">{active.location}</h2>
                  </div>
                <div className="mt-1.5 text-[11px] font-mono text-muted-foreground tabular-nums flex items-center gap-3">
                    <span><Calendar className="inline h-3 w-3 mr-1" />{active.research_date}</span>
                    {active.gps_lng != null && active.gps_lat != null && (
                      <span>📍 {Number(active.gps_lng).toFixed(6)}, {Number(active.gps_lat).toFixed(6)} ±{Math.round(Number(active.gps_accuracy ?? 0))}m</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={exportRecordDoc}>
                    <Download className="h-4 w-4" />导出现场踏勘记录
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => removeRecord(active)} className="h-8 w-8">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              {(active.participants || active.findings || active.conclusion) && (
                <div className="mt-4 pt-4 border-t border-border space-y-2 text-sm">
                  <div className="flex flex-wrap gap-2 pb-1">
                    <StatusPill tone={active.gps_lng != null && active.gps_lat != null ? "success" : "neutral"} dot={false}>GPS {active.gps_lng != null && active.gps_lat != null ? "已采集" : "未采集"}</StatusPill>
                    <StatusPill tone={photos.length > 0 ? "success" : "neutral"} dot={false}>照片 {photos.length}</StatusPill>
                    <StatusPill tone={audioCount > 0 ? "success" : "neutral"} dot={false}>录音 {audioCount}</StatusPill>
                    <StatusPill tone={sigs.length > 0 ? "success" : "neutral"} dot={false}>签字 {sigs.length}</StatusPill>
                    {signOutStamp && <StatusPill tone="success" dot={false}>已签退</StatusPill>}
                    {completionStamp && <StatusPill tone="success" dot={false}>移动端已完成</StatusPill>}
                  </div>
                  {mobileMode && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted-foreground">
                      <div>签到时间：{signInStamp ? new Date(signInStamp).toLocaleString("zh-CN", { hour12: false }) : "未记录"}</div>
                      <div>签退时间：{signOutStamp ? new Date(signOutStamp).toLocaleString("zh-CN", { hour12: false }) : "未记录"}</div>
                      <div>完成时间：{completionStamp ? new Date(completionStamp).toLocaleString("zh-CN", { hour12: false }) : "未记录"}</div>
                    </div>
                  )}
                  {active.participants && <div><span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mr-2">参与</span>{active.participants}</div>}
                  {active.findings && <div><span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mr-2">发现</span>{active.findings}</div>}
                  {visibleConclusion && <div><span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mr-2">结论</span>{visibleConclusion}</div>}
                  {audioCount > 0 && (
                    <div>
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mr-2">录音纪要</span>
                      <div className="mt-2 space-y-2">
                        {audioSummaries.map((audio) => (
                          <div key={audio.id} className="rounded-md border border-border/70 bg-muted/25 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{audio.label}</span>
                              <span>{format(new Date(audio.recordedAt), "yyyy-MM-dd HH:mm")}</span>
                              <span>时长 {formatAudioDuration(audio.totalDuration)}</span>
                              <span>已转写 {audio.completedSegments}/{audio.totalSegments} 段</span>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                              {audio.transcript || "当前录音已上传，转写文本暂未生成。"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {mobileMode && (
              <Card className="surface-card p-6">
                <SectionHeader eyebrow="STEP 3" title="现场记录补充" icon={ClipboardList} />
                <div className="space-y-3">
                  <div>
                    <Label>现场发现</Label>
                    <Textarea
                      rows={4}
                      value={noteDraft.findings}
                      onChange={(e) => setNoteDraft((prev) => ({ ...prev, findings: e.target.value }))}
                      placeholder="记录现场看到的问题、实施情况、对象反馈等。"
                    />
                  </div>
                  <div>
                    <Label>初步核验意见</Label>
                    <Textarea
                      rows={4}
                      value={noteDraft.conclusion}
                      onChange={(e) => setNoteDraft((prev) => ({ ...prev, conclusion: e.target.value }))}
                      placeholder="记录初步判断、待补材料、后续建议等。"
                    />
                  </div>
                  <Button variant="hero" onClick={saveNotes} disabled={savingNote} className="w-full">
                    <Save className="h-4 w-4" />
                    {savingNote ? "保存中…" : "保存现场记录"}
                  </Button>
                </div>
              </Card>
            )}

            {activeMapPoints.length > 0 && (
              <Card className="surface-card p-6">
                <SectionHeader eyebrow="LOCATION · 调研点位置" title="坐标定位" icon={MapIcon} />
                <AMapView points={activeMapPoints} height={260} />
              </Card>
            )}

            <Card id="field-photo-section" className="surface-card p-6">
              <SectionHeader
                eyebrow="EVIDENCE · 现场照片"
                title="照片取证"
                count={photos.length}
                icon={Camera}
                actions={
                  <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
                    <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" />上传照片</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle className="font-display text-xl">上传现场照片</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <Input
                          className="hidden"
                          ref={photoInputRef} type="file" accept="image/*"
                          onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                        />
                        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()}>
                            选择照片
                          </Button>
                          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                            {photoFile ? photoFile.name : "未选择文件"}
                          </span>
                          {photoFile && (
                            <button
                              type="button"
                              className="text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setPhotoFile(null);
                                if (photoInputRef.current) photoInputRef.current.value = "";
                              }}
                            >
                              清除
                            </button>
                          )}
                        </div>
                        <Textarea placeholder="照片说明（可选）" value={photoCaption} onChange={(e) => setPhotoCaption(e.target.value)} rows={2} />
                        <DialogFooter>
                          <Button variant="hero" onClick={uploadPhoto} disabled={!photoFile}>上传</Button>
                        </DialogFooter>
                      </div>
                    </DialogContent>
                  </Dialog>
                }
              />
              {photos.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                  <ImageIcon className="h-8 w-8 opacity-30" />暂无照片
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {photos.map(p => (
                    <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted shadow-xs hover:shadow-md transition-shadow">
                      <img src={photoUrl(p.file_path)} alt={p.caption ?? ""} className="h-full w-full object-cover cursor-pointer transition-transform group-hover:scale-105"
                        onClick={() => setLightbox(photoUrl(p.file_path))} />
                      {p.watermarked && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-success/90 text-success-foreground text-[9px] font-mono uppercase tracking-wider shadow">
                          ✓ 取证水印
                        </div>
                      )}
                      {p.caption && <div className="absolute bottom-0 inset-x-0 bg-foreground/80 text-[10px] text-background px-2 py-1 truncate">{p.caption}</div>}
                      <button onClick={() => removePhoto(p)} className="absolute top-1.5 right-1.5 hidden group-hover:flex h-6 w-6 items-center justify-center rounded-md bg-destructive text-destructive-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card id="field-audio-section" className="surface-card p-6">
              <SectionHeader eyebrow="VOICE · 现场口述录音" title="语音收集（人工） + AI 自动转写" icon={Mic} />
              <AudioRecorder
                recordId={active.id}
                projectId={active.project_id}
                projectName={projectName(active.project_id)}
                location={active.location}
                researchDate={active.research_date}
                context={`${projectName(active.project_id)} · ${active.location} · ${active.research_date}`}
                onChange={() => loadDetail(active.id)}
                onAudiosChange={(rows) => {
                  setAudioEntries(rows.map((item) => ({
                    id: item.id,
                    created_at: item.created_at,
                    duration_sec: item.duration_sec,
                    transcript: item.transcript,
                    transcript_status: item.transcript_status,
                    parent_audio_id: item.parent_audio_id,
                    segment_index: item.segment_index,
                    segment_total: item.segment_total,
                  })));
                  setAudioCount(rows.length);
                }}
              />
            </Card>

            <Card id="field-sign-section" className="surface-card p-6">
              <SectionHeader eyebrow="SIGNATURES · 专家电子签字" title="电子签字存证" count={sigs.length} icon={PenLine} />
              {sigs.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {sigs.map(s => (
                    <div key={s.id} className="rounded-lg border border-accent/30 bg-card p-3 relative">
                      <img src={s.signature_data} alt={s.expert_name} className="h-20 mx-auto object-contain" />
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-display text-foreground font-bold">{s.expert_name}</span>
                        <span className="text-muted-foreground font-mono tabular-nums">{format(new Date(s.signed_at), "MM-dd HH:mm")}</span>
                      </div>
                      <button onClick={() => removeSig(s)} className="absolute top-1.5 right-1.5 text-destructive opacity-50 hover:opacity-100">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <Input placeholder="专家姓名" value={sigName} onChange={(e) => setSigName(e.target.value)} maxLength={100} />
                <SignaturePad onSave={saveSig} />
              </div>
            </Card>
          </div>
        )}
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} className="fixed inset-0 z-50 bg-foreground/90 backdrop-blur-sm flex items-center justify-center p-8 cursor-pointer animate-fade-in">
          <img src={lightbox} alt="" className="max-h-full max-w-full object-contain rounded-lg shadow-2xl" />
        </div>
      )}
      <ConfirmDialog />
    </div>
  );
};

export default FieldResearch;
