import { forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowDown } from "lucide-react";

const stages = [
  {
    title: "PHASE I",
    cnTitle: "准备阶段",
    accent: "cyan",
    nodes: [
      { n: "01", label: "确定评估对象", url: "/projects" },
      { n: "02", label: "编制评估方案", url: "/projects" },
      { n: "03", label: "组建工作组", url: "/work-groups" },
      { n: "04", label: "时间计划安排", url: "/work-groups" },
      { n: "05", label: "抽取专家组", url: "/experts" },
    ],
  },
  {
    title: "PHASE II",
    cnTitle: "实施阶段",
    accent: "gold",
    nodes: [
      { n: "06", label: "收集评估资料", url: "/materials" },
      { n: "07", label: "现场调研踏勘", url: "/field-research" },
      { n: "08", label: "评估会议", url: "/evaluations" },
    ],
  },
  {
    title: "PHASE III",
    cnTitle: "总结应用",
    accent: "cyan",
    nodes: [
      { n: "09", label: "撰写评估报告", url: "/reports" },
      { n: "10", label: "结果应用入库", url: "/archive" },
    ],
  },
];

const stageAccentClass = (accent: "cyan" | "gold") =>
  accent === "cyan"
    ? "bg-accent/10 text-accent border border-accent/30"
    : "bg-gold/10 text-gold border border-gold/30";

const nodeAccentClass = (accent: "cyan" | "gold") =>
  accent === "cyan" ? "bg-accent/15 text-accent" : "bg-gold/20 text-gold";

export const WorkflowDiagram = forwardRef<HTMLDivElement>((_props, ref) => {
  const nav = useNavigate();
  return (
    <div
      ref={ref}
      className="surface-card my-6 p-4 sm:p-6 lg:p-8 animate-fade-in-up overflow-hidden"
      style={{ animationDelay: "240ms" }}
    >
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="section-eyebrow mb-3">WORKFLOW · 流程图</div>
          <h2 className="font-display text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            事前绩效评估工作流程
          </h2>
          <p className="mt-2 text-[11px] font-mono tracking-[0.16em] text-muted-foreground sm:text-xs">
            PRE-PERFORMANCE EVALUATION · 3 PHASES · 10 STEPS
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-mono text-muted-foreground sm:text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan" />
            进行中
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gold" />
            关键节点
          </span>
        </div>
      </div>

      <div className="space-y-5 lg:hidden">
        {stages.map((stage, si) => (
          <div key={stage.title} className="rounded-2xl border border-border/70 bg-card/40 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span
                className={[
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.18em] uppercase sm:text-[11px]",
                  stageAccentClass(stage.accent),
                ].join(" ")}
              >
                <span className="font-display text-xs not-italic">{stage.title}</span>
                <span className="opacity-50">·</span>
                <span className="font-sans tracking-normal normal-case">{stage.cnTitle}</span>
              </span>
              <span className="text-xs text-muted-foreground">{stage.nodes.length} 个环节</span>
            </div>

            <div className="space-y-3">
              {stage.nodes.map((node, i) => (
                <div key={node.n}>
                  <button
                    onClick={() => nav(node.url)}
                    className={[
                      "group relative flex w-full items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left",
                      "transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-glow",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "mt-0.5 inline-flex min-w-10 items-center justify-center rounded-md px-2 py-1 font-mono text-[10px] font-bold tabular-nums sm:text-[11px]",
                        nodeAccentClass(stage.accent),
                      ].join(" ")}
                    >
                      {node.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground/90 transition-colors group-hover:text-accent sm:text-[15px]">
                        {node.label}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-accent" />
                  </button>

                  {i < stage.nodes.length - 1 && (
                    <div className="flex h-6 items-center pl-5">
                      <div className="flex flex-col items-center gap-1">
                        <div className="h-3 w-px bg-border" />
                        <ArrowDown className="h-3.5 w-3.5 text-accent/60" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {si < stages.length - 1 && (
              <div className="mt-4 flex items-center justify-center gap-2 text-[11px] font-mono text-muted-foreground">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
                <span>进入下一阶段</span>
                <div className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hidden space-y-8 lg:block">
        {stages.map((stage, si) => (
          <div key={stage.title}>
            <div className="flex items-center gap-3 mb-4">
              <span
                className={[
                  "inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.18em] uppercase px-3 py-1.5 rounded-md",
                  stageAccentClass(stage.accent),
                ].join(" ")}
              >
                <span className="font-display text-xs not-italic">{stage.title}</span>
                <span className="opacity-50">·</span>
                <span className="font-sans">{stage.cnTitle}</span>
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-border via-border to-transparent" />
            </div>
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max items-center gap-3 pr-2">
              {stage.nodes.map((node, i) => (
                <div key={node.n} className="flex items-center gap-2">
                  <button
                    onClick={() => nav(node.url)}
                    className={[
                      "group relative flex flex-col items-start gap-1 px-4 py-3 rounded-lg",
                      "border border-border bg-card hover:bg-card",
                      "hover:border-accent/60 hover:shadow-glow transition-all duration-300",
                      "min-w-[150px] hover:-translate-y-0.5",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <span
                        className={[
                          "font-mono text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded",
                          nodeAccentClass(stage.accent),
                        ].join(" ")}
                      >
                        {node.n}
                      </span>
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-muted group-hover:bg-accent transition-colors" />
                    </div>
                    <span className="text-sm font-medium text-foreground/90 group-hover:text-accent transition-colors text-left">
                      {node.label}
                    </span>
                  </button>
                  {i < stage.nodes.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                  )}
                </div>
              ))}
              </div>
            </div>
            {si < stages.length - 1 && (
              <div className="flex justify-center mt-6">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-px h-4 bg-gradient-to-b from-transparent to-accent/40" />
                  <ArrowDown className="h-4 w-4 text-accent/60" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
WorkflowDiagram.displayName = "WorkflowDiagram";
