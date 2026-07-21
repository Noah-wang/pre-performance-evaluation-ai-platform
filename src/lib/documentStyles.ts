import { cn } from "@/lib/utils";

export const reportDocumentPageClasses = cn(
  "mx-auto flex w-full max-w-[720px] flex-col rounded-sm border border-border bg-white shadow-sm",
);

export const reportDocumentPageInnerClasses = cn(
  "px-6 py-10 sm:px-10 sm:py-14 lg:px-14",
);

export const reportDocumentBodyClasses = cn(
  "font-serif text-[15px] leading-[2] text-black",
  "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:leading-[2]",
  "[&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:leading-[2]",
  "[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:leading-[2]",
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:text-[15px] [&_h4]:font-bold [&_h4]:leading-[2]",
  "[&_p]:my-0 [&_p]:min-h-7 [&_p]:leading-[2]",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-8",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-8",
  "[&_li]:my-1 [&_li]:leading-[2]",
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-black/25 [&_blockquote]:pl-4 [&_blockquote]:text-black/80",
  "[&_table]:my-5 [&_table]:w-full [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-black [&_th]:bg-black/5 [&_th]:px-2.5 [&_th]:py-2 [&_th]:font-bold [&_th]:text-left",
  "[&_td]:border [&_td]:border-black [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top",
  "[&_img]:mx-auto [&_img]:my-5 [&_img]:h-auto [&_img]:max-w-full",
);
