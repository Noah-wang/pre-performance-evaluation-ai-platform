import { forwardRef, ReactNode, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface Props extends HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}

export const PageHeader = forwardRef<HTMLDivElement, Props>(
  ({ title, subtitle, eyebrow, actions, className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn("mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-end", className)}
      {...rest}
    >
      <div className="min-w-0 w-full sm:w-auto">
        {eyebrow && <div className="section-eyebrow mb-3">{eyebrow}</div>}
        <h1 className="font-display text-3xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-4xl lg:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
          {actions}
        </div>
      )}
    </div>
  ),
);
PageHeader.displayName = "PageHeader";
