/**
 * 统一的 Markdown 渲染组件
 * - 用于 AI 生成的评估方案 / 报告 / 整改意见等长文本
 * - 主题化：标题、列表、引用块、表格、代码、分隔线 全部走设计 token
 * - 中文优化：行高 1.85、首行不缩进（政务公文风）、段落间距舒适
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { isRichTextHtml, sanitizeRichText } from "@/lib/richText";
import { reportDocumentBodyClasses } from "@/lib/documentStyles";

interface Props {
  content: string;
  className?: string;
  /** 末尾光标（流式生成时显示） */
  cursor?: boolean;
  variant?: "default" | "document";
}

export const MarkdownView = ({ content, className, cursor, variant = "default" }: Props) => {
  const defaultClasses = cn(
    "markdown-body text-sm leading-[1.85] text-foreground",
    "[&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3",
    "[&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-2.5",
    "[&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-4 [&_h3]:mb-2",
    "[&_h4]:text-sm [&_h4]:font-bold [&_h4]:mt-3 [&_h4]:mb-1.5",
    "[&_p]:my-2.5 [&_p]:tracking-normal",
    "[&_ul]:my-2.5 [&_ul]:pl-6 [&_ul]:list-disc [&_ul]:marker:text-accent",
    "[&_ol]:my-2.5 [&_ol]:pl-6 [&_ol]:list-decimal [&_ol]:marker:text-accent [&_ol]:marker:font-mono",
    "[&_li]:my-1 [&_li]:pl-1",
    "[&_blockquote]:my-3 [&_blockquote]:pl-4 [&_blockquote]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-accent/60 [&_blockquote]:bg-muted/40 [&_blockquote]:text-foreground/80 [&_blockquote]:italic",
    "[&_strong]:font-semibold [&_strong]:text-foreground",
    "[&_em]:italic [&_em]:text-foreground/85",
    "[&_hr]:my-5 [&_hr]:border-border",
    "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
    "[&_th]:border [&_th]:border-border [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:bg-muted/60 [&_th]:font-semibold [&_th]:text-left",
    "[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top",
    "[&_img]:max-w-full [&_img]:h-auto [&_img]:mx-auto [&_img]:my-4 [&_img]:rounded-md",
  );
  const sharedClasses = cn(
    variant === "document" ? reportDocumentBodyClasses : defaultClasses,
    className,
  );

  if (isRichTextHtml(content)) {
    return (
      <div className={sharedClasses}>
        <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(content) }} />
        {cursor && <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5 align-middle" />}
      </div>
    );
  }

  return (
    <div
      className={cn(
        sharedClasses,
        "[&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-accent",
        "[&_pre]:my-3 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:overflow-x-auto",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground",
        "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-accent/80",
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      {cursor && (
        <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  );
};
