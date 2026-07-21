/**
 * 全局异常上报：拦截 console.error / window.onerror / unhandledrejection
 * 写入 public.app_errors（受 RLS 保护，普通用户只能写自己的）
 *
 * 设计要点：
 * - 节流去重：同一条 message 在 60 秒内只上报一次
 * - 静默失败：上报本身出错不能再触发 console.error，否则死循环
 * - 不阻塞原 console.error：保留原行为
 * - 忽略已知噪音：ResizeObserver / Network 类提示
 */
import { supabase } from "@/integrations/supabase/client";

const NOISE_PATTERNS = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured/i,
  /Failed to fetch/i, // 网络断连噪音
  /\[ErrorBoundary[^\]]*\]/, // ErrorBoundary 自己的诊断日志
];

const recent = new Map<string, number>(); // message → ts(ms)
const DEDUPE_MS = 60_000;
let installed = false;
let reporting = false; // 防递归

function shouldSkip(msg: string): boolean {
  if (!msg) return true;
  if (NOISE_PATTERNS.some((re) => re.test(msg))) return true;
  const last = recent.get(msg);
  if (last && Date.now() - last < DEDUPE_MS) return true;
  recent.set(msg, Date.now());
  // 简单清理：超过 200 条时清掉最老的
  if (recent.size > 200) {
    const oldest = [...recent.entries()].sort((a, b) => a[1] - b[1])[0];
    recent.delete(oldest[0]);
  }
  return false;
}

function stringify(args: unknown[]): { message: string; stack?: string } {
  let message = "";
  let stack: string | undefined;
  for (const a of args) {
    if (a instanceof Error) {
      message += (message ? " | " : "") + `${a.name}: ${a.message}`;
      stack = stack ?? a.stack;
    } else if (typeof a === "string") {
      message += (message ? " " : "") + a;
    } else {
      try {
        message += (message ? " " : "") + JSON.stringify(a);
      } catch {
        message += (message ? " " : "") + String(a);
      }
    }
  }
  return { message: message.slice(0, 2000), stack: stack?.slice(0, 8000) };
}

async function report(payload: {
  message: string;
  stack?: string;
  scope?: string;
  meta?: Record<string, unknown>;
}) {
  if (reporting) return;
  if (shouldSkip(payload.message)) return;
  reporting = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // 未登录用户不上报（RLS 也会拒绝）
    await supabase.from("app_errors").insert([{
      user_id: user.id,
      scope: payload.scope ?? null,
      message: payload.message,
      stack: payload.stack ?? null,
      url: window.location.href,
      route: window.location.pathname,
      user_agent: navigator.userAgent.slice(0, 500),
      meta: (payload.meta ?? {}) as any,
    }]);
  } catch {
    // 静默失败 —— 不能再 console.error 否则递归
  } finally {
    reporting = false;
  }
}

/** 主动上报（供 ErrorBoundary 调用） */
export function reportError(error: Error, scope?: string, extra?: Record<string, unknown>) {
  void report({
    message: `${error.name}: ${error.message}`,
    stack: error.stack,
    scope,
    meta: extra,
  });
}

/** 安装全局拦截器；幂等 */
export function installErrorReporter() {
  if (installed) return;
  installed = true;

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origError(...args); // 先调原版，开发体验不变
    const { message, stack } = stringify(args);
    void report({ message, stack, scope: "console.error" });
  };

  window.addEventListener("error", (ev) => {
    void report({
      message: `${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`,
      stack: ev.error?.stack,
      scope: "window.onerror",
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    const msg = r instanceof Error ? `${r.name}: ${r.message}` : String(r);
    void report({
      message: `Unhandled Promise Rejection: ${msg}`,
      stack: r instanceof Error ? r.stack : undefined,
      scope: "unhandledrejection",
    });
  });
}
