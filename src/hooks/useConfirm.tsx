/**
 * 全局通用确认对话框 Hook —— 替代原生 window.confirm()
 *
 * 用法：
 *   const { confirm, ConfirmDialog } = useConfirm();
 *   const ok = await confirm({ title: "删除该资料？", description: "此操作不可撤销", destructive: true });
 *   if (!ok) return;
 *
 *   // 在组件 return 末尾挂一次：
 *   <ConfirmDialog />
 *
 * 设计要点：
 * - Promise 化：业务代码从原生 confirm 几乎零成本迁移
 * - 一致 UI：所有确认弹窗复用 shadcn AlertDialog，自动主题化
 * - destructive 模式：红色按钮表达破坏性操作
 * - 浏览器自动化友好：不再被 headless 环境自动 dismiss
 */
import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 破坏性操作（删除/清空），渲染红色确认按钮 */
  destructive?: boolean;
}

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ title: "" });
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handle = (result: boolean) => {
    setOpen(false);
    resolverRef.current?.(result);
    resolverRef.current = null;
  };

  const ConfirmDialog = useCallback(
    () => (
      <AlertDialog open={open} onOpenChange={(o) => !o && handle(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts.title}</AlertDialogTitle>
            {opts.description && (
              <AlertDialogDescription className="whitespace-pre-line">
                {opts.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handle(false)}>
              {opts.cancelText ?? "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handle(true)}
              className={cn(
                opts.destructive &&
                  buttonVariants({ variant: "destructive" }),
              )}
            >
              {opts.confirmText ?? "确认"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, opts],
  );

  return { confirm, ConfirmDialog };
}
