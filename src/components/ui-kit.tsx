import { forwardRef, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

/* ============== StatusPill ============== */
type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent" | "gold";

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-accent/10 text-accent border-accent/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/15 text-warning-foreground border-warning/40",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  accent: "bg-cyan/10 text-cyan border-cyan/30",
  gold: "bg-gold/15 text-gold-soft border-gold/40",
};

interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}

export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ tone = "neutral", dot = true, children, className, ...rest }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium border whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  ),
);
StatusPill.displayName = "StatusPill";

/* ============== StatTile ============== */
interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}

export const StatTile = forwardRef<HTMLDivElement, StatTileProps>(
  ({ label, value, hint, icon: Icon, tone = "info", className, ...rest }, ref) => {
    const accentMap: Record<Tone, string> = {
      neutral: "from-muted/40 to-transparent text-foreground",
      info: "from-accent/15 to-transparent text-accent",
      success: "from-success/15 to-transparent text-success",
      warning: "from-warning/15 to-transparent text-warning-foreground",
      danger: "from-destructive/15 to-transparent text-destructive",
      accent: "from-cyan/15 to-transparent text-cyan",
      gold: "from-gold/20 to-transparent text-gold",
    };
    return (
      <div
        ref={ref}
        className={cn("surface-card group relative overflow-hidden p-4 sm:p-5", className)}
        {...rest}
      >
        <div className={cn("absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br blur-2xl opacity-70 group-hover:opacity-100 transition-opacity", accentMap[tone])} />
        <div className="relative flex items-start gap-3">
          {Icon && (
            <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-card shadow-xs sm:h-10 sm:w-10", `text-${tone === "info" ? "accent" : tone}`)}>
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase truncate">
              {label}
            </div>
            <div className="mt-1.5 font-display text-2xl font-bold leading-none text-foreground tabular-nums sm:text-3xl">
              {value}
            </div>
            {hint && <div className="text-[11px] text-muted-foreground mt-1.5">{hint}</div>}
          </div>
        </div>
      </div>
    );
  },
);
StatTile.displayName = "StatTile";

/* ============== SectionHeader ============== */
interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  eyebrow?: string;
  title: string;
  count?: number;
  icon?: LucideIcon;
  actions?: ReactNode;
}

export const SectionHeader = forwardRef<HTMLDivElement, SectionHeaderProps>(
  ({ eyebrow, title, count, icon: Icon, actions, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn("mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end", className)}
      {...rest}
    >
      <div className="min-w-0 w-full sm:w-auto">
        {eyebrow && <div className="section-eyebrow mb-2">{eyebrow}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          {Icon && <Icon className="h-4 w-4 text-accent" />}
          <h3 className="font-display text-lg font-bold text-foreground tracking-tight">{title}</h3>
          {count !== undefined && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              [{count.toString().padStart(2, "0")}]
            </span>
          )}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </div>
  ),
);
SectionHeader.displayName = "SectionHeader";

/* ============== EmptyState ============== */
interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon: Icon, title, hint, action, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col items-center justify-center px-6 py-12 text-center sm:py-16", className)}
      {...rest}
    >
      {Icon && (
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-full bg-accent/10 blur-2xl" />
          <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-card to-muted border border-border grid place-items-center text-muted-foreground shadow-sm">
            <Icon className="h-7 w-7" />
          </div>
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-1.5 text-sm text-muted-foreground max-w-md">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";

/* ============== ToolBar ============== */
interface ToolBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export const ToolBar = forwardRef<HTMLDivElement, ToolBarProps>(
  ({ children, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn("surface-card p-3 mb-6 flex flex-wrap items-center gap-2", className)}
      {...rest}
    >
      {children}
    </div>
  ),
);
ToolBar.displayName = "ToolBar";
