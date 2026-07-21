import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Seal } from "@/components/Seal";
import { toast } from "sonner";

const emailSchema = z.string().trim().email("邮箱格式不正确").max(255);
const passwordSchema = z.string().min(6, "密码至少 6 位").max(128);

const getSafeRedirect = () => {
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return "/";
  return redirect;
};

/** 把 Supabase 英文错误兜底翻成中文，未命中则返回原文 */
function translateAuthError(msg: string): string {
  const m = (msg || "").toLowerCase();
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "邮箱或密码错误";
  if (m.includes("email not confirmed")) return "邮箱尚未验证，请先到邮箱完成验证";
  if (m.includes("user already registered") || m.includes("already registered") || m.includes("user already exists")) return "该邮箱已注册，请直接登录";
  if (m.includes("for security purposes") || m.includes("rate limit") || m.includes("over_email_send_rate_limit")) {
    const sec = msg.match(/(\d+)\s*seconds?/i)?.[1];
    return sec ? `操作过于频繁，请 ${sec} 秒后再试` : "操作过于频繁，请稍后再试";
  }
  if (m.includes("password should be") || m.includes("password is too short")) return "密码强度不足，请至少使用 6 位";
  if (
    m.includes("pwned") ||
    m.includes("compromised") ||
    m.includes("known to be weak") ||
    m.includes("easy to guess") ||
    m.includes("weak password")
  ) return "该密码过于常见或已在数据泄露事件中出现，请换一个更复杂的密码（建议 8 位以上、含字母+数字）";
  if (m.includes("signup") && m.includes("disabled")) return "当前未开放注册，请联系管理员";
  if (m.includes("network") || m.includes("failed to fetch")) return "网络连接异常，请检查网络后重试";
  if (m.includes("invalid email")) return "邮箱格式不正确";
  return msg || "操作失败，请稍后重试";
}

const Auth = () => {
  const nav = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organization, setOrganization] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const redirectPath = getSafeRedirect();

  useEffect(() => {
    const flag = window.location.search.includes("mode=recovery") || window.location.hash.includes("type=recovery");
    setRecoveryMode(flag);
  }, []);

  useEffect(() => {
    if (user && !recoveryMode) nav(redirectPath, { replace: true });
  }, [user, nav, recoveryMode, redirectPath]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
    } catch (err: any) {
      toast.error(err.errors?.[0]?.message ?? "输入有误");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(translateAuthError(error.message));
    } else {
      toast.success("登录成功");
      nav(redirectPath, { replace: true });
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
    } catch (err: any) {
      toast.error(err.errors?.[0]?.message ?? "输入有误");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${redirectPath}`,
        data: { display_name: displayName, organization },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(translateAuthError(error.message));
      return;
    }
    if (data.session) {
      toast.success("注册成功，正在进入工作台…");
      nav(redirectPath, { replace: true });
    } else {
      toast.success("注册成功，请查收邮件完成验证后登录");
    }
  };

  const handleForgotPassword = async () => {
    try {
      emailSchema.parse(email);
    } catch (err: any) {
      toast.error(err.errors?.[0]?.message ?? "请输入有效邮箱");
      return;
    }
    setResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth?mode=recovery`,
    });
    setResetting(false);
    if (error) {
      toast.error(translateAuthError(error.message));
      return;
    }
    toast.success("重置邮件已发送，请到邮箱继续操作");
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      passwordSchema.parse(newPassword);
    } catch (err: any) {
      toast.error(err.errors?.[0]?.message ?? "密码格式不正确");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setResetting(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setResetting(false);
    if (error) {
      toast.error(translateAuthError(error.message));
      return;
    }
    toast.success("密码已更新，请使用新密码登录");
    window.history.replaceState({}, document.title, "/auth");
    setRecoveryMode(false);
    setNewPassword("");
    setConfirmPassword("");
    nav("/", { replace: true });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* 左侧品牌区 */}
      <div className="hidden lg:flex relative overflow-hidden bg-gradient-hero text-primary-foreground p-12 flex-col justify-between">
        <div className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, hsl(var(--cyan) / 0.4), transparent 40%), radial-gradient(circle at 80% 80%, hsl(var(--gold) / 0.25), transparent 40%), linear-gradient(hsl(255 100% 100% / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(255 100% 100% / 0.04) 1px, transparent 1px)",
            backgroundSize: "auto, auto, 40px 40px, 40px 40px",
          }}
        />
        <div className="relative flex items-center gap-3">
          <Seal size={48} text="PE" />
          <div>
            <div className="font-display text-xl font-bold">绩效评估</div>
            <div className="text-[10px] font-mono tracking-[0.22em] text-cyan-glow">ZI ZHENG · HUI MIN</div>
          </div>
        </div>
        <div className="relative">
          <div className="section-eyebrow text-cyan-glow mb-4" style={{ color: "hsl(var(--cyan-glow))" }}>WELCOME</div>
          <h2 className="font-display text-5xl font-bold leading-[1.05] tracking-tight">
            事前绩效评估<br />
            <span className="text-gradient-cyan bg-clip-text" style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--cyan-glow)), hsl(var(--gold-soft)))", WebkitBackgroundClip: "text", color: "transparent" }}>
              数字化管理平台
            </span>
          </h2>
          <p className="mt-5 text-sm text-primary-foreground/70 max-w-md leading-relaxed">
            覆盖三阶段十环节，AI 辅助报告生成、专家智能抽取、现场调研定位、签章存证 — 全流程可追溯。
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-4 text-xs font-mono">
          {[
            { k: "PHASES", v: "03" },
            { k: "STEPS", v: "10" },
            { k: "SECURE", v: "RLS" },
          ].map((s) => (
            <div key={s.k} className="border-l-2 border-cyan/40 pl-3">
              <div className="font-display text-2xl font-bold text-cyan-glow tabular-nums">{s.v}</div>
              <div className="tracking-[0.18em] text-primary-foreground/50 mt-1">{s.k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧表单区 */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Seal size={44} />
            <div>
              <div className="font-display text-lg font-bold">事前绩效评估</div>
              <div className="text-[10px] font-mono tracking-[0.22em] text-accent">ZI ZHENG · HUI MIN</div>
            </div>
          </div>

          <div className="section-eyebrow mb-3">ACCOUNT · 账户</div>
          <h1 className="font-display text-3xl font-bold tracking-tight">{recoveryMode ? "重置密码" : "欢迎回来"}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {recoveryMode ? "请输入新的密码并完成更新" : "登录或注册以进入工作台"}
          </p>

          {recoveryMode ? (
            <form onSubmit={handleUpdatePassword} className="space-y-4 mt-8">
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">New Password · 新密码</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 位" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Confirm Password · 确认密码</Label>
                <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" required />
              </div>
              <Button type="submit" variant="hero" className="w-full" disabled={resetting}>
                {resetting ? "更新中…" : "确认更新密码"}
              </Button>
            </form>
          ) : (
          <Tabs defaultValue="login" className="mt-8">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">登 录</TabsTrigger>
              <TabsTrigger value="signup">注 册</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4 mt-6">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Email · 邮箱</Label>
                  <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Password · 密码</Label>
                  <Input id="password" type="password" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" variant="hero" className="w-full" disabled={loading}>
                  {loading ? "登录中…" : "登 录"}
                </Button>
                <Button type="button" variant="ghost" className="w-full" disabled={resetting} onClick={handleForgotPassword}>
                  {resetting ? "发送中…" : "忘记密码"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4 mt-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Name · 姓名</Label>
                    <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="org" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Org · 单位</Label>
                    <Input id="org" value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={100} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email2" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Email · 邮箱</Label>
                  <Input id="email2" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password2" className="text-xs font-mono tracking-wider uppercase text-muted-foreground">Password · 密码（≥6位）</Label>
                  <Input id="password2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <Button type="submit" variant="hero" className="w-full" disabled={loading}>
                  {loading ? "注册中…" : "注 册 账 号"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          )}

          <p className="mt-8 text-[11px] font-mono text-muted-foreground tracking-wider text-center">
            SECURED BY RLS · 数据全程加密 · 行级权限保护
          </p>
          <p className="mt-3 text-center">
            <a href="/landing" className="text-xs font-mono tracking-wider text-accent hover:underline">
              了解平台介绍 →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
