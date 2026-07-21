import { supabase } from "@/integrations/supabase/client";

interface TemplateRow {
  template_key: string;
  content: string;
  enabled: boolean;
}

let cache: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

async function loadAll(): Promise<Record<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase
      .from("doc_templates")
      .select("template_key, content, enabled");
    const map: Record<string, string> = {};
    (data as TemplateRow[] | null)?.forEach((r) => {
      if (r.enabled) map[r.template_key] = r.content;
    });
    cache = map;
    return map;
  })();
  return inflight;
}

/** Invalidate the in-memory cache (call after admin saves a template). */
export function clearTemplateCache() {
  cache = null;
  inflight = null;
}

/** Render a template by key with {{variable}} substitution. Falls back to provided default. */
export async function renderTemplate(
  key: string,
  vars: Record<string, string | number | undefined> = {},
  fallback = "",
): Promise<string> {
  const map = await loadAll();
  const tpl = map[key] ?? fallback;
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** Synchronous render once templates are pre-loaded. */
export function renderTemplateSync(
  tpl: string,
  vars: Record<string, string | number | undefined> = {},
): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export async function preloadTemplates() {
  await loadAll();
}
