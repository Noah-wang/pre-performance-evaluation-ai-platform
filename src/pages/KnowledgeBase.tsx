import { useEffect, useMemo, useState } from "react";
import {
  Bot, ChevronDown, Database, Download, FileSearch, FileText, Link2, Loader2, RefreshCw, Search,
} from "lucide-react";
import { toast } from "sonner";
import { MarkdownView } from "@/components/MarkdownView";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState, SectionHeader, StatTile, StatusPill } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";

type Project = {
  id: string;
  name: string;
  unit: string | null;
  category: string | null;
};

type MaterialRow = {
  id: string;
  project_id: string | null;
  category: string | null;
  name: string;
  status: string | null;
  file_path: string | null;
  file_name: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string | null;
};

type ReportRow = {
  id: string;
  project_id: string | null;
  title: string | null;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string | null;
};

type ReportVersionRow = {
  id: string;
  report_id: string | null;
  version_no: number | null;
  title: string | null;
  source: string | null;
  created_at: string;
};

type KnowledgeFileRow = {
  id: string;
  project_id: string | null;
  source_type: string | null;
  source_id: string | null;
  status: string;
  chunk_count: number | null;
  error_message: string | null;
  indexed_at: string | null;
  updated_at: string | null;
};

type LibraryItem = {
  id: string;
  source: "material" | "report" | "report_version";
  sourceLabel: string;
  project_id: string | null;
  title: string;
  fileName: string;
  category: string;
  status: string;
  summary: string;
  createdAt: string;
  filePath?: string | null;
};

type KnowledgeHit = {
  rank: number;
  file_id: string;
  title: string;
  file_name: string;
  category: string | null;
  chunk_index: number;
  content: string;
  similarity: number;
  vector_similarity?: number;
  keyword_similarity?: number;
  matched_terms?: string[];
  match_reason?: string;
  source_location?: string;
};

const PROJECT_ALL = "__all__";
const SOURCE_ALL = "__all_sources__";

const MATERIAL_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  approved: { label: "已通过", tone: "success" },
  received: { label: "已收", tone: "warning" },
  rejected: { label: "已驳回", tone: "danger" },
  missing: { label: "缺失", tone: "danger" },
};

const REPORT_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "草稿", tone: "warning" },
  finalized: { label: "已定稿", tone: "success" },
  archived: { label: "已归档", tone: "success" },
};

const formatDate = (value: string) => {
  try {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return value;
  }
};

const statusMeta = (item: LibraryItem) => {
  if (item.source === "material") {
    return MATERIAL_STATUS[item.status] ?? { label: item.status || "未标记", tone: "neutral" as const };
  }
  if (item.source === "report") {
    return REPORT_STATUS[item.status] ?? { label: item.status || "报告", tone: "info" as const };
  }
  return { label: "版本记录", tone: "info" as const };
};

const compactSnippet = (value: string, max = 120) => {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
};

const linkCitations = (value: string, hitCount: number) =>
  String(value ?? "").replace(/\[(\d+)\]/g, (match, rawIndex) => {
    const index = Number(rawIndex);
    return Number.isInteger(index) && index >= 1 && index <= hitCount ? `[${index}](#rag-hit-${index})` : match;
  });

const formatPercent = (value?: number) =>
  `${(Math.max(0, Math.min(1, Number(value) || 0)) * 100).toFixed(1)}%`;

export default function KnowledgeBase() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [reportVersions, setReportVersions] = useState<ReportVersionRow[]>([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileRow[]>([]);
  const [selectedProject, setSelectedProject] = useState(PROJECT_ALL);
  const [selectedSource, setSelectedSource] = useState(SOURCE_ALL);
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [answer, setAnswer] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[]>([]);

  const supabaseAny = supabase as any;

  const loadData = async () => {
    const loadKnowledgeFiles = async () => {
      const fullRes = await supabaseAny.from("knowledge_files")
        .select("id,project_id,source_type,source_id,status,chunk_count,error_message,indexed_at,updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);

      if (!fullRes.error) return fullRes;

      const message = String(fullRes.error.message ?? "");
      const isLegacySchema = message.includes("source_type") || message.includes("source_id") || message.includes("indexed_at");
      if (!isLegacySchema) return fullRes;

      const legacyRes = await supabaseAny.from("knowledge_files")
        .select("id,project_id,status,chunk_count,error_message,updated_at")
        .order("updated_at", { ascending: false })
        .limit(500);

      if (legacyRes.error) return legacyRes;
      return {
        ...legacyRes,
        data: (legacyRes.data ?? []).map((item: any) => ({
          ...item,
          source_type: "knowledge_upload",
          source_id: null,
          indexed_at: null,
        })),
      };
    };

    const [projectRes, materialRes, reportRes, versionRes, knowledgeRes] = await Promise.all([
      supabase.from("projects").select("id,name,unit,category").order("created_at", { ascending: false }),
      supabase.from("materials")
        .select("id,project_id,category,name,status,file_path,file_name,review_note,created_at,updated_at")
        .not("file_path", "is", null)
        .order("updated_at", { ascending: false }),
      supabaseAny.from("reports")
        .select("id,project_id,title,status,conclusion,created_at,updated_at")
        .order("updated_at", { ascending: false }),
      supabaseAny.from("report_versions")
        .select("id,report_id,version_no,title,source,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      loadKnowledgeFiles(),
    ]);

    if (projectRes.error) toast.error(projectRes.error.message);
    if (materialRes.error) toast.error(materialRes.error.message);
    if (reportRes.error) toast.error(reportRes.error.message);
    if (versionRes.error) toast.error(versionRes.error.message);
    if (knowledgeRes.error) toast.error(knowledgeRes.error.message);

    setProjects(projectRes.data ?? []);
    setMaterials((materialRes.data ?? []) as MaterialRow[]);
    setReports((reportRes.data ?? []) as ReportRow[]);
    setReportVersions((versionRes.data ?? []) as ReportVersionRow[]);
    setKnowledgeFiles((knowledgeRes.data ?? []) as KnowledgeFileRow[]);
  };

  useEffect(() => {
    loadData();
  }, []);

  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const reportMap = useMemo(() => new Map(reports.map((report) => [report.id, report])), [reports]);
  const indexedMaterialIds = useMemo(() => new Set(
    knowledgeFiles
      .filter((item) => item.source_type === "material" && item.status === "indexed" && item.source_id)
      .map((item) => item.source_id as string),
  ), [knowledgeFiles]);

  const items = useMemo<LibraryItem[]>(() => {
    const materialItems = materials.map((material) => ({
      id: material.id,
      source: "material" as const,
      sourceLabel: "资料收集审核",
      project_id: material.project_id,
      title: material.name || material.file_name || "项目资料",
      fileName: material.file_name || material.name || "资料文件",
      category: material.category || "项目资料",
      status: material.status || "received",
      summary: material.review_note || "来源于资料收集审核页面上传的项目资料。",
      createdAt: material.updated_at || material.created_at,
      filePath: material.file_path,
    }));

    const reportItems = reports.map((report) => ({
      id: report.id,
      source: "report" as const,
      sourceLabel: "评估报告生成",
      project_id: report.project_id,
      title: report.title || "评估报告",
      fileName: `${report.title || "评估报告"}.docx`,
      category: "项目生成文件",
      status: report.status || "draft",
      summary: report.conclusion ? `结论：${report.conclusion}` : "来源于评估报告（AI）页面生成或保存的报告。",
      createdAt: report.updated_at || report.created_at,
      filePath: null,
    }));

    const versionItems = reportVersions
      .map((version) => {
        const report = version.report_id ? reportMap.get(version.report_id) : null;
        if (!report) return null;
        const title = version.title || report.title || "报告版本";
        return {
          id: version.id,
          source: "report_version" as const,
          sourceLabel: "报告版本记录",
          project_id: report.project_id,
          title,
          fileName: `${title}-第${version.version_no ?? "-"}版.docx`,
          category: "项目生成文件",
          status: version.source || "version",
          summary: `报告版本 ${version.version_no ?? "-"}，来源：${version.source || "系统保存"}`,
          createdAt: version.created_at,
          filePath: null,
        };
      })
      .filter(Boolean) as LibraryItem[];

    return [...materialItems, ...reportItems, ...versionItems]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [materials, reportMap, reportVersions, reports]);

  const visibleItems = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (selectedProject !== PROJECT_ALL && item.project_id !== selectedProject) return false;
      if (selectedSource !== SOURCE_ALL && item.source !== selectedSource) return false;
      if (!needle) return true;
      return [item.title, item.fileName, item.category, item.sourceLabel, item.summary]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [items, keyword, selectedProject, selectedSource]);

  const handleDownload = async (item: LibraryItem) => {
    if (item.source !== "material" || !item.filePath) {
      toast.info("该记录是系统生成内容，请到对应业务页面查看或导出。");
      return;
    }
    const { data, error } = await supabase.storage.from("project-materials").createSignedUrl(item.filePath, 300);
    if (error || !data?.signedUrl) return toast.error(error?.message ?? "下载链接生成失败");
    window.open(data.signedUrl, "_blank");
  };

  const handleSearch = async () => {
    if (selectedProject === PROJECT_ALL) return toast.error("请先选择一个具体项目，再进行文件库问答");
    if (!query.trim()) return toast.error("请输入要检索的问题");
    setSearching(true);
    setAnswer("");
    setHits([]);
    try {
      const { data, error } = await supabase.functions.invoke("search-knowledge", {
        body: {
          query: query.trim(),
          projectId: selectedProject,
          matchCount: 8,
          answer: true,
        },
      });
      if (error) throw error;
      setAnswer(data?.answer ?? "");
      setHits(data?.hits ?? []);
    } catch (error: any) {
      toast.error(await extractFunctionErrorMessage(error));
    } finally {
      setSearching(false);
    }
  };

  const handleRefreshIndex = async () => {
    if (selectedProject === PROJECT_ALL) return toast.error("请先选择一个具体项目");
    setIndexing(true);
    const toastId = toast.loading("正在更新项目索引，未变化的文件会自动跳过...");
    try {
      const { data, error } = await supabase.functions.invoke("ingest-project-knowledge", {
        body: { projectId: selectedProject },
      });
      if (error) throw error;
      await loadData();
      const failed = Number(data?.failed ?? 0);
      const indexed = Number(data?.indexed ?? 0);
      const skipped = Number(data?.skipped ?? 0);
      if (failed > 0) {
        toast.warning(`索引完成，但有 ${failed} 个文件未成功；已更新 ${indexed} 个，跳过 ${skipped} 个未变化文件`, { id: toastId });
      } else {
        toast.success(`索引已更新：新增/重建 ${indexed} 个，跳过 ${skipped} 个未变化文件`, { id: toastId });
      }
    } catch (error: any) {
      toast.error(await extractFunctionErrorMessage(error), { id: toastId });
    } finally {
      setIndexing(false);
    }
  };

  const materialCount = items.filter((item) => item.source === "material").length;
  const generatedCount = items.filter((item) => item.source !== "material").length;
  const indexedCount = visibleItems.filter((item) => item.source === "material" && indexedMaterialIds.has(item.id)).length;
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="ADMIN · RAG"
        title="文件库"
        subtitle="文件库不再单独上传；这里汇总资料收集审核上传文件、项目报告和系统生成记录，AI 生成内容会按项目引用这些资料。"
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatTile label="FILES" value={items.length.toString().padStart(2, "0")} hint="系统文件记录" icon={Database} tone="info" />
        <StatTile label="MATERIALS" value={materialCount.toString().padStart(2, "0")} hint="资料收集审核文件" icon={FileSearch} tone="success" />
        <StatTile label="INDEXED" value={indexedCount.toString().padStart(2, "0")} hint="当前筛选已建索引资料" icon={RefreshCw} tone="accent" />
        <StatTile label="PROJECTS" value={projects.length.toString().padStart(2, "0")} hint="可筛选项目" icon={Link2} tone="gold" />
      </div>

      <Card className="mt-5">
        <CardHeader className="pb-3">
          <SectionHeader
            eyebrow="ASK · 项目资料问答"
            title="按项目调用资料辅助"
            icon={Bot}
            actions={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger className="w-full sm:w-[320px]">
                    <SelectValue placeholder="选择项目" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PROJECT_ALL}>全部项目（仅浏览，不用于问答）</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={handleRefreshIndex}
                  disabled={indexing || selectedProject === PROJECT_ALL}
                  className="gap-2"
                >
                  {indexing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  更新项目索引
                </Button>
              </div>
            }
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 lg:flex-row">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleSearch();
              }}
              placeholder="例如：哪些资料能证明项目必要性？预算测算依据在哪里？"
              className="lg:flex-1"
            />
            <Button onClick={handleSearch} disabled={searching || selectedProject === PROJECT_ALL} className="gap-2">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              检索并回答
            </Button>
          </div>

          {answer && (
            <div className="rounded-lg border border-accent/25 bg-accent/5 p-4">
              <div className="mb-2 text-xs font-mono tracking-[0.18em] text-accent">ANSWER · 检索回答</div>
              <MarkdownView
                content={linkCitations(answer, hits.length)}
                className="text-sm [&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0"
              />
            </div>
          )}

          {hits.length > 0 && (
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">引用片段</div>
                  <div className="text-xs text-muted-foreground">默认显示摘要，点击可展开查看完整命中内容</div>
                </div>
                <StatusPill tone="info">{hits.length} 条</StatusPill>
              </div>
              <Accordion type="multiple" className="divide-y divide-border">
                {hits.map((hit) => (
                  <AccordionItem
                    key={`${hit.file_id}-${hit.chunk_index}`}
                    id={`rag-hit-${hit.rank}`}
                    value={`${hit.file_id}-${hit.chunk_index}`}
                    className="border-b-0 px-4"
                  >
                    <AccordionTrigger className="gap-3 py-3 text-left hover:no-underline [&>svg]:hidden">
                      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">[{hit.rank}] {hit.title || hit.file_name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {hit.category ?? "文件库"} · {hit.source_location ?? `第 ${hit.chunk_index + 1} 个片段`} · 相关度 {formatPercent(hit.similarity)}
                          </div>
                          {(hit.matched_terms?.length || hit.match_reason) && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {hit.matched_terms?.slice(0, 8).map((term) => (
                                <span
                                  key={term}
                                  className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
                                >
                                  命中：{term}
                                </span>
                              ))}
                              {hit.match_reason && (
                                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                                  {hit.match_reason}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">
                            {compactSnippet(hit.content)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusPill tone="info">查看全文</StatusPill>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="mb-3 rounded-md border border-accent/20 bg-accent/5 p-3 text-xs leading-6 text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">来源定位：</span>
                          {hit.source_location ?? `《${hit.title || hit.file_name}》第 ${hit.chunk_index + 1} 个片段`}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">相关度解释：</span>
                          {hit.match_reason || "系统根据语义相似度和关键词命中综合排序。"}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">排序依据：</span>
                          语义 {formatPercent(hit.vector_similarity)} · 关键词 {formatPercent(hit.keyword_similarity)}
                        </div>
                      </div>
                      <div className="max-h-[360px] overflow-y-auto rounded-md border border-border bg-muted/20 p-4 text-sm leading-7 text-foreground">
                        <MarkdownView content={hit.content} />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader className="pb-3">
          <SectionHeader
            eyebrow="LIBRARY · 系统文件"
            title="资料与生成文件清单"
            icon={Database}
            count={visibleItems.length}
            actions={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={selectedSource} onValueChange={setSelectedSource}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SOURCE_ALL}>全部来源</SelectItem>
                    <SelectItem value="material">资料收集审核</SelectItem>
                    <SelectItem value="report">评估报告</SelectItem>
                    <SelectItem value="report_version">报告版本</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索文件名、分类、备注..."
                  className="w-full sm:w-[260px]"
                />
              </div>
            }
          />
        </CardHeader>
        <CardContent>
          {visibleItems.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="暂无文件记录"
              hint="请先在“资料收集审核”上传资料，或在报告/工作方案等页面生成项目文件。"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">文件/记录</TableHead>
                  <TableHead>关联项目</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => {
                  const meta = statusMeta(item);
                  return (
                    <TableRow key={`${item.source}-${item.id}`}>
                      <TableCell>
                        <div className="font-medium">{item.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.fileName}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.project_id ? projectMap.get(item.project_id)?.name ?? "已关联项目" : "未关联项目"}
                      </TableCell>
                      <TableCell>{item.sourceLabel}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                          {item.source === "material" && (
                            indexedMaterialIds.has(item.id)
                              ? <StatusPill tone="success">已索引</StatusPill>
                              : <StatusPill tone="warning">待索引</StatusPill>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(item)}
                            disabled={item.source !== "material"}
                            className="gap-2"
                          >
                            <Download className="h-4 w-4" />
                            下载
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
