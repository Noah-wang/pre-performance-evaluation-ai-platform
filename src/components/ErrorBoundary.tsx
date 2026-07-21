import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/errorReporter";

interface Props {
  children: ReactNode;
  /** 可选：定位错误来自哪个区域 */
  scope?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.scope ? ":" + this.props.scope : ""}]`, error, info);
    this.setState({ info });
    // 主动上报（带组件堆栈），不依赖 console.error 拦截
    reportError(error, this.props.scope, { componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null, info: null, copied: false });
  reload = () => window.location.reload();
  goHome = () => { window.location.href = "/"; };

  copyDetails = async () => {
    const { error, info } = this.state;
    const text = [
      `Time: ${new Date().toISOString()}`,
      `URL:  ${window.location.href}`,
      `Scope: ${this.props.scope ?? "global"}`,
      `Message: ${error?.message ?? ""}`,
      `Stack:`,
      error?.stack ?? "",
      `Component:`,
      info?.componentStack ?? "",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1500);
    } catch {
      /* noop */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info, copied } = this.state;
    return (
      <div className="min-h-[60vh] w-full flex items-center justify-center p-6 animate-fade-in-up">
        <div className="w-full max-w-2xl">
          {/* 顶部装饰条 */}
          <div className="flex items-center gap-2 mb-4 font-mono text-[10px] tracking-[0.22em] text-destructive/80">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
            <span>SYSTEM EXCEPTION · 系统异常</span>
            <span className="text-border">/</span>
            <span className="text-muted-foreground">CODE 0x{((Date.now() & 0xffff)).toString(16).toUpperCase().padStart(4, "0")}</span>
          </div>

          <div className="rounded-xl border border-destructive/30 bg-card/80 backdrop-blur-xl shadow-glow overflow-hidden">
            <div className="p-6 border-b border-border bg-destructive/5">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-12 h-12 rounded-lg bg-destructive/15 grid place-items-center">
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="font-display text-xl font-bold text-foreground mb-1">
                    页面渲染出错了
                  </h1>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    我们已捕获该异常，您的数据是安全的。可以尝试重试当前操作，或返回工作台。
                    {this.props.scope && (
                      <span className="block mt-1 font-mono text-[11px] text-muted-foreground/70">
                        SCOPE · {this.props.scope}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* 错误详情 */}
            <div className="p-6 space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Error Message
                </div>
                <div className="font-mono text-sm text-destructive break-all">
                  {error.name}: {error.message}
                </div>
              </div>
              {(error.stack || info?.componentStack) && (
                <details className="rounded-md border border-border bg-muted/20 p-3 group">
                  <summary className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer select-none">
                    Stack Trace · 点击展开
                  </summary>
                  <pre className="mt-2 text-[11px] font-mono text-muted-foreground/90 overflow-auto max-h-56 whitespace-pre-wrap break-all">
                    {error.stack}
                    {info?.componentStack && `\n\n--- Component Stack ---${info.componentStack}`}
                  </pre>
                </details>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="p-4 border-t border-border bg-muted/20 flex flex-wrap items-center gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={this.copyDetails}>
                {copied ? <Check className="h-4 w-4 mr-1.5 text-success" /> : <Copy className="h-4 w-4 mr-1.5" />}
                {copied ? "已复制" : "复制错误详情"}
              </Button>
              <Button variant="outline" size="sm" onClick={this.goHome}>
                <Home className="h-4 w-4 mr-1.5" />
                返回工作台
              </Button>
              <Button variant="outline" size="sm" onClick={this.reset}>
                重试
              </Button>
              <Button size="sm" onClick={this.reload}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                刷新页面
              </Button>
            </div>
          </div>

          <p className="text-center text-[11px] font-mono text-muted-foreground/60 mt-4">
            如问题持续出现，请将『错误详情』反馈给系统管理员
          </p>
        </div>
      </div>
    );
  }
}
