import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Columns3,
  Heading1, Heading2, ImagePlus, Italic, List, ListOrdered, Minus,
  Plus, Redo2, Rows3, Strikethrough, Table2, Trash2, UnderlineIcon, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { textToEditableHtml } from "@/lib/richText";
import { toast } from "sonner";
import {
  reportDocumentBodyClasses,
  reportDocumentPageClasses,
} from "@/lib/documentStyles";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (text: string) => void;
  editable?: boolean;
  variant?: "default" | "document";
}

const ToolButton = ({
  active,
  title,
  onClick,
  disabled,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <Button
    type="button"
    size="icon"
    variant={active ? "secondary" : "ghost"}
    className="h-8 w-8"
    title={title}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </Button>
);

export const RichTextEditor = ({
  value,
  onChange,
  onSelectionChange,
  editable = true,
  variant = "default",
}: Props) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const editorBodyClasses = variant === "document"
    ? cn(
      "report-editor px-6 py-10 outline-none sm:px-10 sm:py-14 lg:px-14",
      reportDocumentBodyClasses,
      "[&_.selectedCell]:bg-accent/10",
    )
    : [
      "report-editor min-h-[640px] px-10 py-8 outline-none",
      "text-[15px] leading-[2] text-foreground font-display",
      "[&_h1]:text-[15px] [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-4",
      "[&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3",
      "[&_h3]:text-[15px] [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2",
      "[&_h4]:text-[15px] [&_h4]:font-bold [&_h4]:mt-4 [&_h4]:mb-2",
      "[&_p]:my-2 [&_p]:min-h-6",
      "[&_ul]:list-disc [&_ul]:pl-8 [&_ol]:list-decimal [&_ol]:pl-8",
      "[&_blockquote]:border-l-4 [&_blockquote]:border-accent/50 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
      "[&_img]:max-w-full [&_img]:h-auto [&_img]:mx-auto [&_img]:my-5 [&_img]:rounded-md",
      "[&_table]:w-full [&_table]:border-collapse [&_table]:my-5",
      "[&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:p-2 [&_th]:font-semibold",
      "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top",
      "[&_.selectedCell]:bg-accent/10",
    ].join(" ");
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: textToEditableHtml(value),
    editable,
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to } = current.state.selection;
      if (from === to) return;
      const text = current.state.doc.textBetween(from, to, "\n").trim();
      if (text.length > 0) onSelectionChangeRef.current?.(text);
    },
    editorProps: {
      attributes: {
        class: editorBodyClasses,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    if (!editor) return;
    const next = textToEditableHtml(value);
    if (next !== editor.getHTML()) editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const addImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("请选择图片文件");
    if (file.size > 4 * 1024 * 1024) return toast.error("单张图片请控制在 4MB 以内");
    const reader = new FileReader();
    reader.onload = () => editor.chain().focus().setImage({ src: String(reader.result), alt: file.name }).run();
    reader.readAsDataURL(file);
  };

  const inTable = editor.isActive("table");

  return (
    <div className={cn(
      "overflow-hidden border border-border bg-background shadow-sm",
      variant === "document" ? "rounded-sm" : "rounded-xl",
    )}>
      <div
        data-html2canvas-ignore="true"
        className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-border bg-card/95 px-3 py-2 backdrop-blur"
      >
        <ToolButton title="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="h-4 w-4" /></ToolButton>
        <ToolButton title="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 className="h-4 w-4" /></ToolButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolButton title="一级标题" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 className="h-4 w-4" /></ToolButton>
        <ToolButton title="二级标题" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 className="h-4 w-4" /></ToolButton>
        <ToolButton title="粗体" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolButton>
        <ToolButton title="斜体" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolButton>
        <ToolButton title="下划线" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolButton>
        <ToolButton title="删除线" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></ToolButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolButton title="左对齐" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft className="h-4 w-4" /></ToolButton>
        <ToolButton title="居中" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter className="h-4 w-4" /></ToolButton>
        <ToolButton title="右对齐" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight className="h-4 w-4" /></ToolButton>
        <ToolButton title="两端对齐" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}><AlignJustify className="h-4 w-4" /></ToolButton>
        <ToolButton title="项目符号" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolButton>
        <ToolButton title="编号列表" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolButton title="插入图片" onClick={() => imageInputRef.current?.click()}><ImagePlus className="h-4 w-4" /></ToolButton>
        <ToolButton title="插入 3×3 表格" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="h-4 w-4" /></ToolButton>
        {inTable && (
          <>
            <ToolButton title="增加行" onClick={() => editor.chain().focus().addRowAfter().run()}><Rows3 className="h-4 w-4" /><Plus className="h-2.5 w-2.5 -ml-1" /></ToolButton>
            <ToolButton title="删除行" onClick={() => editor.chain().focus().deleteRow().run()}><Rows3 className="h-4 w-4" /><Minus className="h-2.5 w-2.5 -ml-1" /></ToolButton>
            <ToolButton title="增加列" onClick={() => editor.chain().focus().addColumnAfter().run()}><Columns3 className="h-4 w-4" /><Plus className="h-2.5 w-2.5 -ml-1" /></ToolButton>
            <ToolButton title="删除列" onClick={() => editor.chain().focus().deleteColumn().run()}><Columns3 className="h-4 w-4" /><Minus className="h-2.5 w-2.5 -ml-1" /></ToolButton>
            <ToolButton title="删除表格" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="h-4 w-4 text-destructive" /></ToolButton>
          </>
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            addImage(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {variant === "document" ? (
        <div className="bg-muted/15 p-3 sm:p-4">
          <div className={reportDocumentPageClasses}>
            <EditorContent editor={editor} />
          </div>
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
};
