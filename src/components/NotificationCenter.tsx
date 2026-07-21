import { useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCheck, AlertTriangle, Trash2, Loader2, RefreshCw, Inbox, ListChecks, FileSearch, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";

type TabKey = "all" | "task" | "material" | "system";

const TASK_CATS = ["task"];
const MATERIAL_CATS = ["material", "materials"];
const matchTab = (cat: string, tab: TabKey) => {
  if (tab === "all") return true;
  if (tab === "task") return TASK_CATS.includes(cat);
  if (tab === "material") return MATERIAL_CATS.includes(cat);
  // system = 其他所有
  return !TASK_CATS.includes(cat) && !MATERIAL_CATS.includes(cat);
};

interface Notif {
  id: string;
  category: string;
  severity: "info" | "warning" | "danger" | string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

interface DeliverySettings {
  siteEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  emailTarget: string;
  smsTarget: string;
  lookAheadDays: number;
}

interface DeliveryLog {
  id: string;
  notificationId: string;
  channel: "site" | "email" | "sms";
  target: string;
  status: "success" | "skipped" | "mock" | "failed";
  reason?: string;
  createdAt: string;
}

const SEV_BG: Record<string, string> = {
  danger: "bg-destructive/10 border-destructive/30",
  warning: "bg-warning/10 border-warning/40",
  info: "bg-accent/8 border-accent/30",
};
const SEV_DOT: Record<string, string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-accent",
};

export const NotificationCenter = () => {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [settings, setSettings] = useState<DeliverySettings>({
    siteEnabled: true,
    emailEnabled: false,
    smsEnabled: false,
    emailTarget: user?.email ?? "",
    smsTarget: "",
    lookAheadDays: 3,
  });
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLog[]>([]);

  const settingsKey = user?.id ? `notif_strategy:${user.id}` : "";
  const logsKey = user?.id ? `notif_delivery_logs:${user.id}` : "";

  const unread = items.filter((i) => !i.read_at).length;
  const filtered = useMemo(() => items.filter((i) => matchTab(i.category, tab)), [items, tab]);
  const counts = useMemo(() => {
    const c = { all: 0, task: 0, material: 0, system: 0 };
    items.forEach((i) => {
      if (i.read_at) return;
      c.all++;
      if (TASK_CATS.includes(i.category)) c.task++;
      else if (MATERIAL_CATS.includes(i.category)) c.material++;
      else c.system++;
    });
    return c;
  }, [items]);
  const receiptStats = useMemo(() => {
    const summary = {
      site: { success: 0, skipped: 0, mock: 0, failed: 0 },
      email: { success: 0, skipped: 0, mock: 0, failed: 0 },
      sms: { success: 0, skipped: 0, mock: 0, failed: 0 },
    };
    deliveryLogs.forEach((log) => {
      summary[log.channel][log.status] += 1;
    });
    return summary;
  }, [deliveryLogs]);

  const persistSettings = (next: DeliverySettings) => {
    setSettings(next);
    if (settingsKey) window.localStorage.setItem(settingsKey, JSON.stringify(next));
  };

  const persistLogs = (next: DeliveryLog[]) => {
    setDeliveryLogs(next);
    if (logsKey) window.localStorage.setItem(logsKey, JSON.stringify(next));
  };

  const sendSmsReceipt = async (notification: Notif, target: string) => {
    const { data, error } = await supabase.functions.invoke("send-sms", {
      body: {
        phone: target,
        title: notification.title,
        body: notification.body ?? "请登录系统查看详情。",
        notificationId: notification.id,
      },
    });
    if (error) throw error;
    if (!(data as any)?.ok) {
      throw new Error((data as any)?.message || (data as any)?.error || "短信网关返回失败");
    }
    return (data as any)?.requestId as string | undefined;
  };

  const syncDeliveryReceipts = async (notifications: Notif[], strategy: DeliverySettings) => {
    if (!logsKey) return;
    const existing = (() => {
      try {
        return JSON.parse(window.localStorage.getItem(logsKey) ?? "[]") as DeliveryLog[];
      } catch {
        return [] as DeliveryLog[];
      }
    })();
    const known = new Set(existing.map((log) => `${log.notificationId}:${log.channel}`));
    const next = [...existing];
    for (const notification of notifications) {
      const candidates: Array<{ channel: DeliveryLog["channel"]; enabled: boolean; target: string; reason?: string }> = [
        { channel: "site", enabled: strategy.siteEnabled, target: "站内通知", reason: "未启用站内信" },
        { channel: "email", enabled: strategy.emailEnabled, target: strategy.emailTarget || user?.email || "", reason: "未配置邮件地址" },
        { channel: "sms", enabled: strategy.smsEnabled, target: strategy.smsTarget, reason: "未配置短信号码" },
      ];
      for (const candidate of candidates) {
        const receiptKey = `${notification.id}:${candidate.channel}`;
        if (known.has(receiptKey)) continue;
        const hasTarget = Boolean(candidate.target);
        let status: DeliveryLog["status"] = "skipped";
        let reason: string | undefined = candidate.reason;

        if (candidate.enabled && hasTarget) {
          if (candidate.channel === "site") {
            status = "success";
            reason = undefined;
          } else if (candidate.channel === "sms") {
            try {
              const requestId = await sendSmsReceipt(notification, candidate.target);
              status = "success";
              reason = requestId ? `腾讯云 RequestId：${requestId}` : undefined;
            } catch (error) {
              status = "failed";
              reason = String((error as Error).message ?? error);
            }
          } else {
            status = "mock";
            reason = "待接入第三方邮件网关";
          }
        }

        next.push({
          id: receiptKey,
          notificationId: notification.id,
          channel: candidate.channel,
          target: candidate.target || "未配置",
          status,
          reason,
          createdAt: new Date().toISOString(),
        });
        known.add(receiptKey);
      }
    }
    persistLogs(next.slice(0, 300));
  };

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("id,category,severity,title,body,link,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setLoading(false);
    if (error) { toast.error("加载通知失败"); return; }
    setItems((data ?? []) as Notif[]);
  };

  useEffect(() => {
    if (!user) return;
    if (settingsKey) {
      try {
        const raw = window.localStorage.getItem(settingsKey);
        if (raw) {
          setSettings({
            ...settings,
            ...JSON.parse(raw),
            emailTarget: JSON.parse(raw).emailTarget || user.email || "",
          });
        } else {
          persistSettings({ ...settings, emailTarget: user.email ?? "" });
        }
      } catch {
        persistSettings({ ...settings, emailTarget: user.email ?? "" });
      }
    }
    if (logsKey) {
      try {
        setDeliveryLogs(JSON.parse(window.localStorage.getItem(logsKey) ?? "[]"));
      } catch {
        setDeliveryLogs([]);
      }
    }
    load();
    // 实时订阅
    const ch = supabase
      .channel(`notif:${user.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const n = payload.new as Notif;
        setItems((prev) => [n, ...prev].slice(0, 30));
        toast.warning(n.title, { description: n.body ?? undefined });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user || items.length === 0) return;
    void syncDeliveryReceipts(items, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, settings, user?.id]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    setItems((p) => p.map((i) => (i.id === id ? { ...i, read_at: new Date().toISOString() } : i)));
  };

  const markAllRead = async () => {
    if (!user || unread === 0) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id).is("read_at", null);
    setItems((p) => p.map((i) => i.read_at ? i : { ...i, read_at: new Date().toISOString() }));
    toast.success("已全部标记为已读");
  };

  const removeOne = async (id: string) => {
    await supabase.from("notifications").delete().eq("id", id);
    setItems((p) => p.filter((i) => i.id !== id));
  };

  const handleClick = (n: Notif) => {
    if (!n.read_at) markRead(n.id);
    if (n.link) { setOpen(false); nav(n.link); }
  };

  const triggerScan = async () => {
    setScanning(true);
    const { data, error } = await supabase.functions.invoke("check-task-deadlines", {
      body: { lookAheadDays: settings.lookAheadDays },
    });
    setScanning(false);
    if (error) { toast.error("扫描失败：" + error.message); return; }
    const inserted = (data as any)?.inserted ?? 0;
    const dedup = (data as any)?.deduplicated ?? 0;
    toast.success(`扫描完成：新增 ${inserted} 条，去重 ${dedup} 条`);
    setTimeout(load, 300);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold font-mono grid place-items-center shadow-[0_0_8px_hsl(var(--destructive)/0.6)]">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0 max-h-[520px] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-accent" />
            <span className="font-display font-semibold text-sm">通知中心</span>
            {unread > 0 && <span className="font-mono text-[10px] text-muted-foreground">{unread} 未读</span>}
          </div>
          <div className="flex items-center gap-1">
            <Collapsible open={strategyOpen} onOpenChange={setStrategyOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" title="渠道策略与回执">
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
            <Button variant="ghost" size="sm" onClick={triggerScan} disabled={scanning} title="立即扫描临期任务">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={markAllRead} disabled={unread === 0} title="全部已读">
              <CheckCheck className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Collapsible open={strategyOpen} onOpenChange={setStrategyOpen}>
          <CollapsibleContent className="border-b border-border bg-muted/20">
            <div className="p-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-card p-3 space-y-3">
                  <div className="text-xs font-medium">提醒渠道策略</div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs">站内信</Label>
                      <div className="text-[11px] text-muted-foreground">系统内即时提醒</div>
                    </div>
                    <Switch checked={settings.siteEnabled} onCheckedChange={(value) => persistSettings({ ...settings, siteEnabled: value })} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Label className="text-xs">邮件提醒</Label>
                      <Input value={settings.emailTarget} onChange={(event) => persistSettings({ ...settings, emailTarget: event.target.value, emailEnabled: true })} placeholder="请输入接收邮箱" className="mt-1 h-8 text-xs" />
                    </div>
                    <Switch checked={settings.emailEnabled} onCheckedChange={(value) => persistSettings({ ...settings, emailEnabled: value })} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Label className="text-xs">短信提醒</Label>
                      <Input value={settings.smsTarget} onChange={(event) => persistSettings({ ...settings, smsTarget: event.target.value, smsEnabled: true })} placeholder="请输入手机号码" className="mt-1 h-8 text-xs" />
                    </div>
                    <Switch checked={settings.smsEnabled} onCheckedChange={(value) => persistSettings({ ...settings, smsEnabled: value })} />
                  </div>
                  <div>
                    <Label className="text-xs">预警提前天数</Label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={settings.lookAheadDays}
                      onChange={(event) => persistSettings({ ...settings, lookAheadDays: Math.max(1, Math.min(30, Number(event.target.value) || 3)) })}
                      className="mt-1 h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-card p-3 space-y-2">
                  <div className="text-xs font-medium">回执统计</div>
                  {([
                    { key: "site", label: "站内信" },
                    { key: "email", label: "邮件" },
                    { key: "sms", label: "短信" },
                  ] as const).map(({ key, label }) => (
                      <div key={key} className="rounded-md bg-muted/30 px-3 py-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span>{label}</span>
                          <span className="font-mono text-muted-foreground">成功 {receiptStats[key].success} / 模拟 {receiptStats[key].mock} / 失败 {receiptStats[key].failed} / 跳过 {receiptStats[key].skipped}</span>
                        </div>
                      </div>
                  ))}
                  <div className="text-[11px] text-muted-foreground leading-relaxed">
                    站内信会实时写入系统；短信启用后会调用腾讯云短信网关真实外发；邮件当前仍为模拟回执，后续可接入邮件网关。
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* 分类 Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="w-full h-9 rounded-none border-b border-border bg-card/40 p-0 grid grid-cols-4">
            {([
              { k: "all" as TabKey,      label: "全部", Icon: Inbox },
              { k: "task" as TabKey,     label: "任务", Icon: ListChecks },
              { k: "material" as TabKey, label: "资料", Icon: FileSearch },
              { k: "system" as TabKey,   label: "系统", Icon: Settings2 },
            ]).map(({ k, label, Icon }) => (
              <TabsTrigger
                key={k}
                value={k}
                className="relative h-full rounded-none data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-accent gap-1.5 text-xs"
              >
                <Icon className="h-3 w-3" />
                {label}
                {counts[k] > 0 && (
                  <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold font-mono grid place-items-center">
                    {counts[k] > 99 ? "99+" : counts[k]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex-1 overflow-auto divide-y divide-border">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />加载中…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {tab === "all" ? "暂无通知" : "该分类暂无通知"}
            </div>
          ) : filtered.map((n) => (
            <div
              key={n.id}
              className={cn(
                "p-3 group cursor-pointer hover:bg-accent/5 transition-colors border-l-2",
                !n.read_at ? SEV_BG[n.severity] ?? "bg-accent/5 border-accent/30" : "border-transparent",
              )}
              onClick={() => handleClick(n)}
            >
              <div className="flex items-start gap-2">
                <span className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", SEV_DOT[n.severity] ?? "bg-muted")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn("text-sm leading-snug", !n.read_at && "font-semibold")}>
                      {n.severity === "danger" && <AlertTriangle className="h-3.5 w-3.5 text-destructive inline mr-1 -mt-0.5" />}
                      {n.title}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeOne(n.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  </div>
                  {n.body && <div className="text-xs text-muted-foreground mt-1 leading-snug">{n.body}</div>}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground/80 tabular-nums">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: zhCN })}
                    </span>
                    {!n.read_at && (
                      <button
                        onClick={(e) => { e.stopPropagation(); markRead(n.id); }}
                        className="text-[10px] font-mono text-accent hover:underline"
                      >
                        <Check className="h-2.5 w-2.5 inline" /> 标记已读
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-border text-[10px] font-mono text-muted-foreground/70 text-center">
          每天 09:00 自动扫描临期任务（未来 {settings.lookAheadDays} 天 + 已超期）
        </div>
      </PopoverContent>
    </Popover>
  );
};
