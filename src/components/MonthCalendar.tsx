import { useEffect, useMemo, useState } from "react";
import { format, parseISO, differenceInCalendarDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CalTask {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: string;
  assignee: string | null;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** 任务在某天的颜色 tone */
function tonePerTask(t: CalTask, day: Date): "done" | "overdue" | "soon" | "doing" | "todo" {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = parseISO(t.end_date); end.setHours(0, 0, 0, 0);
  if (t.status === "done") return "done";
  if (end < today) return "overdue";
  const dl = differenceInCalendarDays(end, today);
  if (dl <= 1) return "soon";
  if (t.status === "doing") return "doing";
  return "todo";
}

const TONE_BG: Record<string, string> = {
  done: "bg-success/80 text-primary-foreground",
  overdue: "bg-destructive text-destructive-foreground animate-pulse",
  soon: "bg-warning text-warning-foreground",
  doing: "bg-accent text-primary-foreground",
  todo: "bg-gold/80 text-foreground",
};

interface Props {
  tasks: CalTask[];
  onTaskClick?: (task: CalTask) => void;
}

export const MonthCalendar = ({ tasks, onTaskClick }: Props) => {
  const [cursor, setCursor] = useState<Date>(() => new Date());

  const days = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const arr: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) { arr.push(d); d = addDays(d, 1); }
    return arr;
  }, [cursor]);

  const tasksOnDay = (day: Date) =>
    tasks.filter((t) => {
      const s = parseISO(t.start_date);
      const e = parseISO(t.end_date);
      const day0 = new Date(day); day0.setHours(0, 0, 0, 0);
      return day0 >= new Date(s.toDateString()) && day0 <= new Date(e.toDateString());
    });

  const today = new Date();

  // 月度统计
  const monthStats = useMemo(() => {
    const inMonth = tasks.filter((t) => {
      const s = parseISO(t.start_date), e = parseISO(t.end_date);
      return (s <= endOfMonth(cursor)) && (e >= startOfMonth(cursor));
    });
    const overdue = inMonth.filter((t) => tonePerTask(t, today) === "overdue").length;
    const soon = inMonth.filter((t) => tonePerTask(t, today) === "soon").length;
    const done = inMonth.filter((t) => t.status === "done").length;
    return { total: inMonth.length, overdue, soon, done };
  }, [tasks, cursor]);

  return (
    <div className="space-y-3">
      {/* 月份导航 + 统计 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setCursor(subMonths(cursor, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-display text-lg font-bold tabular-nums min-w-[120px] text-center">
            {format(cursor, "yyyy 年 MM 月")}
          </div>
          <Button variant="outline" size="icon" onClick={() => setCursor(addMonths(cursor, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>回到今日</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground">合计 <b className="text-foreground">{monthStats.total}</b></span>
          {monthStats.overdue > 0 && (
            <span className="px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> 超期 {monthStats.overdue}
            </span>
          )}
          {monthStats.soon > 0 && (
            <span className="px-2 py-0.5 rounded bg-warning/15 text-warning-foreground border border-warning/40">临期 {monthStats.soon}</span>
          )}
          <span className="px-2 py-0.5 rounded bg-success/15 text-success border border-success/30 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> 完成 {monthStats.done}
          </span>
        </div>
      </div>

      {/* 表头 */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-md overflow-hidden border border-border">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={cn(
            "bg-muted/60 px-2 py-1.5 text-center font-mono text-[11px] tracking-wider",
            i >= 5 ? "text-accent" : "text-muted-foreground",
          )}>{w}</div>
        ))}
        {days.map((day) => {
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          const dayTasks = tasksOnDay(day);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "bg-card min-h-[92px] p-1.5 flex flex-col gap-1 transition-colors",
                !inMonth && "bg-muted/20",
                isToday && "ring-2 ring-accent ring-inset",
              )}
            >
              <div className={cn(
                "flex items-center justify-between text-[11px] font-mono tabular-nums",
                inMonth ? "text-foreground" : "text-muted-foreground/50",
                isToday && "text-accent font-bold",
              )}>
                <span>{format(day, "d")}</span>
                {dayTasks.length > 0 && (
                  <span className="text-[9px] text-muted-foreground">{dayTasks.length}</span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayTasks.slice(0, 3).map((t) => {
                  const tone = tonePerTask(t, day);
                  return (
                    <button
                      key={t.id}
                      onClick={() => onTaskClick?.(t)}
                      className={cn(
                        "text-[10px] leading-tight rounded px-1.5 py-0.5 truncate text-left transition-transform hover:scale-[1.02]",
                        TONE_BG[tone],
                      )}
                      title={`${t.title} · ${t.start_date} → ${t.end_date}${t.assignee ? ` · ${t.assignee}` : ""}`}
                    >
                      {t.title}
                    </button>
                  );
                })}
                {dayTasks.length > 3 && (
                  <div className="text-[9px] text-muted-foreground font-mono">+{dayTasks.length - 3}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-4 text-[11px] font-mono text-muted-foreground pt-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-destructive" /> 超期</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-warning" /> 临期 (≤1d)</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-accent" /> 进行中</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gold/80" /> 待办</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-success/80" /> 已完成</span>
      </div>
    </div>
  );
};
