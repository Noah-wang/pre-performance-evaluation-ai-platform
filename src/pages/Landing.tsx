import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Sparkles,
  Shield,
  MapPin,
  FileSignature,
  Search,
  Bell,
  Calculator,
  Archive,
  Database,
  Users,
  FileText,
  ClipboardList,
  Mic,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Workflow,
  Target,
  Zap,
  Wand2,
  ShieldCheck,
  Activity,
  GitPullRequest,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Seal } from "@/components/Seal";
import mockEvaluationPlan from "@/assets/landing/mock-evaluation-plan.jpg";
import mockExperts from "@/assets/landing/mock-experts.jpg";
import mockMaterials from "@/assets/landing/mock-materials.jpg";
import mockMeetings from "@/assets/landing/mock-meetings.jpg";
import mockField from "@/assets/landing/mock-field.jpg";
import mockReport from "@/assets/landing/mock-report.jpg";
import mockArchive from "@/assets/landing/mock-archive.jpg";

const navItems = [
  { href: "#intro", label: "介绍" },
  { href: "#whatsnew", label: "最新" },
  { href: "#flow", label: "流程" },
  { href: "#features", label: "功能" },
  { href: "#preview", label: "演示" },
  { href: "#ai", label: "AI 能力" },
  { href: "#howto", label: "上手" },
  { href: "#tech", label: "技术" },
];

// 落地页产品截图演示 —— 真实页面 + macOS 窗口框 + 渐变背景
// 覆盖三阶段全链路：方案 → 专家 → 资料 → 会议 → 调研 → 报告 → 归档
const productShots = [
  {
    image: mockEvaluationPlan,
    tag: "PHASE I · 工作组与方案",
    title: "AI 一键生成评估方案",
    desc: "结合项目信息、工作组、指标体系，由 Gemini 2.5 Pro 流式撰写不少于 800 字的标准实施方案，Markdown 富文本实时渲染。",
    accent: "cyan",
  },
  {
    image: mockExperts,
    tag: "PHASE I · 专家库",
    title: "三类专家智能抽取 · 一键任命",
    desc: "业务 / 管理 / 财务分类入库，按需随机抽取 5 人评审组，AI 自动起草带文号与盖章位的任命书，可直接入档。",
    accent: "gold",
  },
  {
    image: mockMaterials,
    tag: "PHASE II · 资料管理",
    title: "AI 智能匹配资料清单",
    desc: "按指标体系自动生成必要资料清单，AI 比对已上传文件并标记已核验 / 缺失 / 待审，一键下载缺失清单分发给被评单位。",
    accent: "cyan",
  },
  {
    image: mockMeetings,
    tag: "PHASE II · 评估会议",
    title: "三类专家意见自动汇总",
    desc: "上传纪要后 AI 提取业务、管理、财务专家观点，并按必要性、可行性、经济性、效率性、效益性生成正式专家组评估意见。",
    accent: "gold",
  },
  {
    image: mockField,
    tag: "PHASE II · 现场调研",
    title: "GPS + 照片 + 录音 + 签章四重存证",
    desc: "高德地图自动定位、现场照片上传、录音 AI 转写、专家电子签字，全部留痕至档案中。",
    accent: "cyan",
  },
  {
    image: mockReport,
    tag: "PHASE III · 评估报告",
    title: "结构化报告 + AI 整改清单",
    desc: "AI 按指标维度生成优秀 / 良好 / 合格 / 不合格结论报告，附整改建议可逐条勾选采纳，一键导出带公章的 PDF。",
    accent: "gold",
  },
  {
    image: mockArchive,
    tag: "PHASE III · 项目库",
    title: "结果应用与年度归档",
    desc: "评估完成项目自动入库，KPI 看板一目了然，支持按年度批量打包 ZIP，附带报告 / 整改 / 调研全套材料。",
    accent: "cyan",
  },
];

// 最近一次大版本更新（v1.0.0）—— 真实交付的能力，落地到落地页让客户感知
const whatsNew = [
  {
    icon: Wand2,
    tag: "v1.0",
    title: "Markdown 富文本渲染",
    desc: "评估方案 / 报告 / 整改 / 会议摘要均自动渲染标题、列表、表格、引用、加粗等格式，告别原始符号 #** 干扰阅读。",
  },
  {
    icon: ShieldCheck,
    tag: "v1.0",
    title: "统一确认弹窗",
    desc: "全平台 7 个高危删除入口（项目、工作组、专家、资料、调研、会议、归档）替换为可主题化的 AlertDialog，破坏性操作红色警示、可取消、可追溯。",
  },
  {
    icon: GitPullRequest,
    tag: "v1.0",
    title: "AI 整改清单 + 采纳追踪",
    desc: "AI 按指标维度自动生成整改建议，支持逐条勾选采纳、保存采纳记录，最终随报告 PDF 一同导出。",
  },
  {
    icon: Activity,
    tag: "v1.0",
    title: "全链路异常监控",
    desc: "前端未捕获异常 / Promise rejection / console.error 自动上报至 app_errors 表，管理员可在归档页直接查看故障堆栈。",
  },
  {
    icon: Sparkles,
    tag: "v1.0",
    title: "资料智能匹配指标",
    desc: "上传资料后由 AI 自动识别归属指标、判定是否满足要求，缺漏自动列入「待补交」通知。",
  },
  {
    icon: Search,
    tag: "v1.0",
    title: "无障碍 + 引用转发优化",
    desc: "全局搜索 ⌘K 弹窗符合 ARIA 规范，所有 ui-kit 组件均支持 ref 转发，控制台零警告。",
  },
];

const painPoints = [
  {
    pain: "纸质材料堆积，归档检索困难",
    solution: "数字化资料库 · 按指标自动归集 · 一键打包 ZIP 归档",
  },
  {
    pain: "专家抽取流程不透明、易争议",
    solution: "随机算法抽取 + 抽签记录留痕，全程可追溯",
  },
  {
    pain: "评估报告撰写耗时长、质量参差",
    solution: "AI 多模型辅助生成方案 / 报告 / 整改，Markdown 富文本直接交付",
  },
  {
    pain: "现场调研无凭证，事后难核实",
    solution: "GPS 定位 + 高德地图 + 录音转写 + 电子签章四重存证",
  },
  {
    pain: "工作组任务进度难协同",
    solution: "甘特日历 + 任务超期自动通知，进度一目了然",
  },
  {
    pain: "误删数据、操作无提示，事故难追责",
    solution: "全平台统一确认弹窗 + 行级权限 + 异常自动上报，操作可审计",
  },
];

const phases = [
  {
    code: "PHASE I",
    title: "准备阶段",
    accent: "cyan",
    steps: [
      { n: "01", label: "确定评估对象" },
      { n: "02", label: "编制评估方案" },
      { n: "03", label: "组建工作组" },
      { n: "04", label: "时间计划安排" },
      { n: "05", label: "抽取专家组" },
    ],
  },
  {
    code: "PHASE II",
    title: "实施阶段",
    accent: "gold",
    steps: [
      { n: "06", label: "收集评估资料" },
      { n: "07", label: "现场调研踏勘" },
      { n: "08", label: "评估会议" },
    ],
  },
  {
    code: "PHASE III",
    title: "总结应用",
    accent: "cyan",
    steps: [
      { n: "09", label: "撰写评估报告" },
      { n: "10", label: "结果应用入库" },
    ],
  },
];

const modules = [
  {
    icon: Target,
    name: "评估对象管理",
    desc: "项目全生命周期",
    points: ["基本信息与预算", "自定义字段扩展", "评估费用阶梯计算", "结论分级归档"],
  },
  {
    icon: Users,
    name: "工作组与任务",
    desc: "组织协同与进度",
    points: ["成员角色管理", "甘特日历视图", "任务状态流转", "超期自动通知"],
  },
  {
    icon: ClipboardList,
    name: "专家库",
    desc: "专家智能抽取",
    points: ["按专业筛选", "随机抽取算法", "抽取记录留痕", "AI 通知函生成"],
  },
  {
    icon: Database,
    name: "评估资料",
    desc: "AI 匹配与审核",
    points: ["按指标分类", "AI 自动匹配指标", "缺失自动标记", "审核状态跟踪"],
  },
  {
    icon: Layers,
    name: "指标体系",
    desc: "多级指标模板库",
    points: ["层级树结构", "权重与评分方法", "模板复用", "项目绑定指标"],
  },
  {
    icon: MapPin,
    name: "现场调研",
    desc: "踏勘四重存证",
    points: ["GPS + 高德地图", "现场照片上传", "录音转写文字", "专家电子签字"],
  },
  {
    icon: Mic,
    name: "评估会议",
    desc: "纪要与意见分析",
    points: ["纪要在线编辑", "AI 提取专家意见", "录音上传", "Markdown 摘要"],
  },
  {
    icon: FileText,
    name: "评估报告",
    desc: "AI 多模型撰写",
    points: ["Gemini / GPT-5 可选", "流式生成实时预览", "Markdown 富文本", "Word / PDF 导出"],
  },
  {
    icon: GitPullRequest,
    name: "整改建议",
    desc: "AI 按指标生成",
    points: ["逐条勾选采纳", "采纳记录留痕", "随报告一并导出", "支持二次润色"],
  },
  {
    icon: Archive,
    name: "归档项目库",
    desc: "结果应用与检索",
    points: ["项目快照", "批量年度 ZIP", "结论分类", "全文检索"],
  },
  {
    icon: Workflow,
    name: "工作流概览",
    desc: "三阶段十环节看板",
    points: ["流程节点跳转", "进度可视化", "数据统计", "首页一键直达"],
  },
];

const aiCapabilities = [
  { icon: Brain, title: "AI 评估方案生成", desc: "依据项目背景、工作组、指标体系，一键生成结构化评估方案初稿，Markdown 富文本流式输出。" },
  { icon: FileText, title: "AI 评估报告", desc: "多模型可选（Gemini 2.5 / 3.x、GPT-5 系列），结合资料、调研、会议自动撰写正文与结论。" },
  { icon: GitPullRequest, title: "AI 整改清单", desc: "按指标维度生成可执行整改建议，支持勾选采纳并保存采纳记录，随报告 PDF 一并交付。" },
  { icon: Mic, title: "会议录音转写", desc: "上传录音自动转文字，AI 提取专家意见、生成纪要摘要，结论自动归集到项目。" },
  { icon: Sparkles, title: "资料智能匹配", desc: "上传资料 AI 自动识别归属指标，判定是否满足要求，缺漏自动列入待补交通知。" },
  { icon: Wand2, title: "专家通知函", desc: "依据抽取记录与会议安排自动生成正式通知函，支持一键复制与下载。" },
];

const aiModels = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "openai/gpt-5.2",
];

const highlights = [
  { icon: Shield, title: "全流程留痕", desc: "操作全程审计，关键节点不可篡改" },
  { icon: Users, title: "角色权限", desc: "管理员 / 工作组成员 / 专家，行级安全" },
  { icon: ShieldCheck, title: "统一确认弹窗", desc: "破坏性操作红色警示，告别误删事故" },
  { icon: AlertTriangle, title: "异常监控", desc: "前端异常自动上报，管理员实时洞察" },
  { icon: MapPin, title: "地图定位", desc: "高德地图 + GPS，调研位置精准存证" },
  { icon: FileSignature, title: "电子签章", desc: "现场专家手写签名，PDF 永久封存" },
  { icon: Archive, title: "一键归档 ZIP", desc: "按年度批量打包，子目录清晰" },
  { icon: Search, title: "全局搜索 ⌘K", desc: "项目 / 专家 / 资料 / 报告统一检索" },
  { icon: Bell, title: "通知中心", desc: "任务超期、资料缺失自动推送" },
  { icon: Calculator, title: "费用计算", desc: "依据预算阶梯自动核算评估费用" },
  { icon: Wand2, title: "Markdown 渲染", desc: "AI 长文自动渲染标题、列表、表格" },
  { icon: Activity, title: "零控制台警告", desc: "无障碍 + ref 转发全部合规" },
];

const usageSteps = [
  { n: "01", title: "注册登录", desc: "邮箱注册账号，登录进入工作台" },
  { n: "02", title: "建项目", desc: "录入评估对象基本信息与预算" },
  { n: "03", title: "配工作组", desc: "组建工作组、安排任务、抽取专家" },
  { n: "04", title: "收资料调研", desc: "上传评估资料，开展现场踏勘与会议" },
  { n: "05", title: "出报告归档", desc: "AI 辅助撰写报告与整改，归档入库" },
];

export default function Landing() {
  useEffect(() => {
    document.title = "事前绩效评估管理平台 · 政府财政评估数字化解决方案";
    const meta = document.querySelector('meta[name="description"]') || (() => {
      const m = document.createElement("meta");
      m.setAttribute("name", "description");
      document.head.appendChild(m);
      return m;
    })();
    meta.setAttribute(
      "content",
      "AI 驱动的事前绩效评估管理平台：覆盖三阶段十环节、专家智能抽取、现场调研定位、电子签章存证、AI 报告生成、全流程留痕。"
    );
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky Top Nav */}
      <header className="sticky top-0 z-50 backdrop-blur bg-background/80 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/landing" className="flex items-center gap-2.5 shrink-0">
            <Seal size={36} text="PE" />
            <div className="hidden sm:block">
              <div className="font-display text-sm font-bold leading-none">事前绩效评估</div>
              <div className="text-[9px] font-mono tracking-[0.2em] text-muted-foreground mt-1">
                ZI ZHENG · HUI MIN
              </div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-accent transition-colors rounded-md hover:bg-accent/5"
              >
                {it.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link to="/auth">登录</Link>
            </Button>
            <Button asChild variant="hero" size="sm">
              <Link to="/auth">
                立即体验 <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* 1. Hero */}
      <section
        id="intro"
        className="relative overflow-hidden bg-gradient-hero text-primary-foreground"
      >
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 20%, hsl(var(--cyan) / 0.5), transparent 45%), radial-gradient(circle at 85% 75%, hsl(var(--gold) / 0.3), transparent 45%), linear-gradient(hsl(255 100% 100% / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(255 100% 100% / 0.04) 1px, transparent 1px)",
            backgroundSize: "auto, auto, 48px 48px, 48px 48px",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div className="animate-fade-in-up">
            <div
              className="section-eyebrow mb-5"
              style={{ color: "hsl(var(--cyan-glow))" }}
            >
              GOVERNMENT FISCAL · 财政预算评估
            </div>
            <h1 className="font-display text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight">
              事前绩效评估
              <br />
              <span
                className="bg-clip-text"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, hsl(var(--cyan-glow)), hsl(var(--gold-soft)))",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                }}
              >
                数字化管理平台
              </span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-primary-foreground/75 leading-relaxed max-w-xl">
              覆盖<strong className="text-primary-foreground">三阶段十环节</strong>，AI 辅助报告生成、专家智能抽取、现场调研定位、签章存证 — 全流程可追溯，专为政府财政绩效评估场景打造。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="hero" size="lg">
                <Link to="/auth">
                  立即体验 <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                <a href="#features">查看功能 ↓</a>
              </Button>
            </div>
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
              {[
                { k: "PHASES · 阶段", v: "03" },
                { k: "STEPS · 环节", v: "10" },
                { k: "MODULES · 模块", v: "11" },
                { k: "AI MODELS · 模型", v: "07" },
              ].map((s) => (
                <div key={s.k} className="border-l-2 border-cyan/40 pl-3">
                  <div className="font-display text-2xl font-bold text-cyan-glow tabular-nums">
                    {s.v}
                  </div>
                  <div className="tracking-[0.18em] text-primary-foreground/50 mt-1">
                    {s.k}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Seal + flow preview */}
          <div className="hidden md:flex justify-center animate-fade-in-up" style={{ animationDelay: "120ms" }}>
            <div className="relative">
              <div className="absolute -inset-8 rounded-full bg-cyan/20 blur-3xl" />
              <div className="relative">
                <Seal size={200} text="PE" />
              </div>
              <div className="mt-8 space-y-2">
                {phases.map((p) => (
                  <div
                    key={p.code}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-primary-foreground/15 bg-primary-foreground/5 backdrop-blur"
                  >
                    <span
                      className={`font-mono text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${
                        p.accent === "cyan"
                          ? "bg-cyan/20 text-cyan-glow"
                          : "bg-gold/20 text-gold-soft"
                      }`}
                    >
                      {p.code}
                    </span>
                    <span className="text-sm font-medium">{p.title}</span>
                    <span className="ml-auto text-xs font-mono text-primary-foreground/50 tabular-nums">
                      {p.steps.length} STEPS
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. What's New —— 最近一次大版本更新 */}
      <section id="whatsnew" className="bg-muted/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="mb-12 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="section-eyebrow mb-3">02 · WHAT&apos;S NEW</div>
              <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
                v1.0 最近更新 · 六项能力同步上线
              </h2>
              <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
                围绕"可读性、可控性、可观测性"三大方向，本次版本完成了从 AI 长文渲染到操作安全、异常追踪的全链路升级。
              </p>
            </div>
            <span className="font-mono text-[11px] tracking-[0.18em] uppercase px-3 py-1.5 rounded-md border border-accent/30 bg-accent/5 text-accent">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse mr-1.5 align-middle" />
              SHIPPED · 2026-04
            </span>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {whatsNew.map((w, i) => {
              const Icon = w.icon;
              return (
                <Card
                  key={i}
                  className="p-5 group hover:border-accent/50 hover:shadow-glow transition-all relative"
                >
                  <span className="absolute top-3 right-3 font-mono text-[10px] px-1.5 py-0.5 rounded bg-gold/15 text-gold">
                    {w.tag}
                  </span>
                  <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center mb-3 group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display text-base font-bold mb-1.5">{w.title}</h3>
                  <p className="text-xs text-foreground/70 leading-relaxed">{w.desc}</p>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* 3. Pain vs Solution */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="mb-12">
          <div className="section-eyebrow mb-3">03 · PAIN POINTS</div>
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            传统评估痛点 vs 平台解决方案
          </h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
            从纸质化、流程不透明、报告耗时长等典型痛点出发，平台提供端到端的数字化能力闭环。
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {painPoints.map((p, i) => (
            <Card
              key={i}
              className="p-5 group hover:border-accent/50 hover:shadow-glow transition-all"
            >
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-vermillion shrink-0 mt-0.5" />
                <div className="text-sm text-foreground/85 leading-snug">{p.pain}</div>
              </div>
              <div className="border-t border-dashed border-border pt-3 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
                <div className="text-sm font-medium text-foreground leading-snug">
                  {p.solution}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* 4. Workflow */}
      <section id="flow" className="bg-background border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="mb-12">
            <div className="section-eyebrow mb-3">04 · WORKFLOW</div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              三阶段十环节 · 标准化评估流程
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
              依据财政部门事前绩效评估规范，将评估全流程拆解为可操作的标准节点。
            </p>
          </div>
          <div className="space-y-10">
            {phases.map((stage) => (
              <div key={stage.code}>
                <div className="flex items-center gap-3 mb-5">
                  <span
                    className={[
                      "inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.18em] uppercase px-3 py-1.5 rounded-md border",
                      stage.accent === "cyan"
                        ? "bg-accent/10 text-accent border-accent/30"
                        : "bg-gold/10 text-gold border-gold/30",
                    ].join(" ")}
                  >
                    <span className="font-display text-xs">{stage.code}</span>
                    <span className="opacity-50">·</span>
                    <span>{stage.title}</span>
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-border via-border to-transparent" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {stage.steps.map((step) => (
                    <Card
                      key={step.n}
                      className="p-4 hover:border-accent/50 hover:-translate-y-0.5 transition-all"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={[
                            "font-mono text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded",
                            stage.accent === "cyan"
                              ? "bg-accent/15 text-accent"
                              : "bg-gold/20 text-gold",
                          ].join(" ")}
                        >
                          {step.n}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-foreground/90">
                        {step.label}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Modules */}
      <section id="features" className="bg-muted/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="mb-12">
          <div className="section-eyebrow mb-3">05 · CORE MODULES</div>
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            十一大核心功能模块
          </h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
            每一个评估环节都对应独立的功能模块，相互联动、数据贯通。
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m, i) => {
            const Icon = m.icon;
            return (
              <Card
                key={i}
                className="p-6 group hover:border-accent/50 hover:shadow-glow transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-11 h-11 rounded-lg bg-accent/10 text-accent flex items-center justify-center group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold mb-1">{m.name}</h3>
                <p className="text-xs text-muted-foreground mb-4">{m.desc}</p>
                <ul className="space-y-1.5">
                  {m.points.map((pt) => (
                    <li
                      key={pt}
                      className="text-xs text-foreground/75 flex items-start gap-1.5"
                    >
                      <span className="text-accent mt-1.5 w-1 h-1 rounded-full bg-accent shrink-0" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
        </div>
      </section>

      {/* 6. Product Preview —— 真实页面截图 + macOS 窗口框 */}
      <section id="preview" className="bg-background border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="mb-12">
            <div className="section-eyebrow mb-3">06 · PRODUCT PREVIEW</div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              真实界面演示 · 看看平台到底长什么样
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
              以下截图来自正在运行的生产环境，覆盖三大阶段的核心功能 —— 评估方案、专家会议、现场调研、归档项目库。
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 lg:gap-10">
            {productShots.map((shot, i) => (
              <div
                key={i}
                className="group relative animate-fade-in-up"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* 阶段标签 */}
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className={`font-mono text-[10px] tracking-[0.18em] uppercase px-2.5 py-1 rounded ${
                      shot.accent === "cyan"
                        ? "bg-accent/10 text-accent border border-accent/30"
                        : "bg-gold/10 text-gold border border-gold/30"
                    }`}
                  >
                    {shot.tag}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                    SHOT · {String(i + 1).padStart(2, "0")}
                  </span>
                </div>

                {/* 截图卡片 */}
                <div className="rounded-xl overflow-hidden border border-border bg-card transition-all group-hover:border-accent/40 group-hover:shadow-glow group-hover:-translate-y-1 duration-300">
                  <img
                    src={shot.image}
                    alt={shot.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-auto block"
                  />
                </div>

                {/* 文案 */}
                <div className="mt-5">
                  <h3 className="font-display text-xl font-bold mb-2 tracking-tight">
                    {shot.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {shot.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* 底部 CTA 行 */}
          <div className="mt-14 p-6 rounded-xl border border-border bg-gradient-to-br from-card via-card to-muted/30 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="font-display text-base font-bold mb-1">想亲自体验完整流程？</div>
              <p className="text-xs text-muted-foreground">
                注册账号即可访问所有功能，AI 能力开箱即用，无需配置 API Key。
              </p>
            </div>
            <Button asChild variant="hero" size="sm">
              <Link to="/auth">
                进入工作台 <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 7. AI capabilities */}
      <section
        id="ai"
        className="relative overflow-hidden bg-gradient-hero text-primary-foreground"
      >
        <div
          className="absolute inset-0 opacity-25 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 70% 30%, hsl(var(--cyan) / 0.5), transparent 50%), radial-gradient(circle at 20% 80%, hsl(var(--gold) / 0.3), transparent 50%)",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="mb-12">
            <div
              className="section-eyebrow mb-3"
              style={{ color: "hsl(var(--cyan-glow))" }}
            >
              07 · AI POWERED
            </div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              AI 能力专区 · 六大智能助手
            </h2>
            <p className="mt-3 text-sm text-primary-foreground/70 max-w-2xl">
              内置 Lovable AI Gateway，无需自备 API Key，即可调用主流大模型完成专业文本工作。
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {aiCapabilities.map((c, i) => {
              const Icon = c.icon;
              return (
                <div
                  key={i}
                  className="p-5 rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 backdrop-blur hover:bg-primary-foreground/10 hover:border-cyan/40 transition-all"
                >
                  <div className="w-11 h-11 rounded-lg bg-cyan/15 text-cyan-glow flex items-center justify-center mb-4">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-display text-base font-bold mb-1.5">{c.title}</h3>
                  <p className="text-xs text-primary-foreground/65 leading-relaxed">
                    {c.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 backdrop-blur p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-gold-soft" />
              <span className="font-mono text-[11px] tracking-[0.18em] text-primary-foreground/70">
                INTEGRATED MODELS · 已接入模型
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {aiModels.map((m) => (
                <span
                  key={m}
                  className="font-mono text-[11px] px-2.5 py-1 rounded-md bg-primary-foreground/10 border border-primary-foreground/15 text-primary-foreground/85"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Highlights */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="mb-12">
          <div className="section-eyebrow mb-3">08 · HIGHLIGHTS</div>
          <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
            平台十二大特色亮点
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {highlights.map((h, i) => {
            const Icon = h.icon;
            return (
              <div
                key={i}
                className="p-5 rounded-xl border border-border bg-card hover:border-accent/50 hover:shadow-glow transition-all flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-gold/10 text-gold flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold mb-1">{h.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{h.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 7. How to use */}
      <section id="howto" className="bg-muted/30 border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="mb-12">
            <div className="section-eyebrow mb-3">09 · GET STARTED</div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              五步快速上手
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-2xl">
              零门槛设计，注册即用，无需培训。
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {usageSteps.map((s, i) => (
              <div key={s.n} className="relative">
                <Card className="p-5 h-full hover:border-accent/50 transition-all">
                  <div className="font-mono text-3xl font-bold text-accent/30 mb-3 tabular-nums">
                    {s.n}
                  </div>
                  <h3 className="font-display text-base font-bold mb-1.5">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                </Card>
                {i < usageSteps.length - 1 && (
                  <ArrowRight className="hidden lg:block absolute top-1/2 -right-3 h-4 w-4 text-muted-foreground/40 -translate-y-1/2 z-10" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8. Tech & Security */}
      <section id="tech" className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div>
            <div className="section-eyebrow mb-3">10 · TECH & SECURITY</div>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">
              企业级技术架构 + 政务级安全
            </h2>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              基于云原生架构与行级安全策略（RLS），保障敏感财政数据不被越权访问；前端异常自动上报，确保线上稳定运行。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                "React 18",
                "TypeScript",
                "Vite",
                "Tailwind CSS",
                "PostgreSQL",
                "RLS 行级安全",
                "Edge Functions",
                "高德地图 API",
              ].map((t) => (
                <span
                  key={t}
                  className="font-mono text-[11px] px-2.5 py-1 rounded-md bg-muted border border-border text-foreground/75"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {[
              { icon: Shield, title: "RLS 行级安全", desc: "数据库级别权限隔离，普通用户只能访问自己的数据" },
              { icon: Database, title: "数据加密", desc: "传输 HTTPS + 静态加密，敏感字段单独保护" },
              { icon: AlertTriangle, title: "异常自动上报", desc: "前端 console.error 与未捕获异常实时入库，管理员可监控" },
              { icon: FileSignature, title: "全链路审计", desc: "关键操作留痕，归档项目快照不可篡改" },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="p-4 rounded-lg border border-border bg-card flex items-start gap-3"
                >
                  <div className="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold mb-0.5">{item.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 9. CTA Footer */}
      <section className="relative overflow-hidden bg-gradient-hero text-primary-foreground">
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 50%, hsl(var(--cyan) / 0.4), transparent 60%)",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-20 text-center">
          <Seal size={64} text="PE" className="mb-6 mx-auto" />
          <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight">
            开启评估数字化新阶段
          </h2>
          <p className="mt-5 text-base text-primary-foreground/75 max-w-2xl mx-auto leading-relaxed">
            注册账号即可免费体验全部功能，无需安装、无需培训、无需另购 AI API Key。
          </p>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Button asChild variant="hero" size="lg">
              <Link to="/auth">
                立即登录体验 <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="bg-transparent border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              <a href="#intro">返回顶部 ↑</a>
            </Button>
          </div>

          <div className="mt-14 pt-8 border-t border-primary-foreground/15 grid sm:grid-cols-3 gap-6 text-left text-xs font-mono">
            <div>
              <div className="text-primary-foreground/50 tracking-[0.18em] mb-2">CONTACT · 联系</div>
              <div className="text-primary-foreground/85 font-sans text-sm">北京清樾科技有限公司</div>
              <div className="text-primary-foreground/85 font-sans text-sm mt-1">
                电话：<a href="tel:16606666360" className="hover:text-cyan-glow tabular-nums">166-0666-6360</a>
              </div>
              <div className="text-primary-foreground/85 font-sans text-sm mt-1">
                邮箱：<a href="mailto:contact@tsingyue.tech" className="hover:text-cyan-glow">contact@tsingyue.tech</a>
              </div>
            </div>
            <div>
              <div className="text-primary-foreground/50 tracking-[0.18em] mb-2">PRODUCT · 产品</div>
              <div className="space-y-1">
                <a href="#features" className="block text-primary-foreground/85 font-sans text-sm hover:text-cyan-glow">功能模块</a>
                <a href="#ai" className="block text-primary-foreground/85 font-sans text-sm hover:text-cyan-glow">AI 能力</a>
                <a href="#tech" className="block text-primary-foreground/85 font-sans text-sm hover:text-cyan-glow">技术架构</a>
              </div>
            </div>
            <div>
              <div className="text-primary-foreground/50 tracking-[0.18em] mb-2">SECURED BY</div>
              <div className="text-primary-foreground/85 font-sans text-sm">RLS 行级安全 · 全链路加密</div>
              <div className="text-primary-foreground/50 font-sans text-xs mt-1">© {new Date().getFullYear()} 北京清樾科技有限公司</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
