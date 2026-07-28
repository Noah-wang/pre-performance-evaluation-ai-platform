/**
 * 排查某个项目的资料为什么在报告"全面核验"里被判为"未完成解析"。
 *
 * 用法（在部署了 Supabase 的服务器上执行）：
 *   SUPABASE_URL="https://supabase.example.com" \
 *   SUPABASE_SERVICE_ROLE_KEY="..." \
 *   DIAGNOSE_PROJECT_ID="<项目 UUID>" \
 *   node scripts/ops/diagnose-material-index.mjs
 *
 * 可选：DIAGNOSE_FILE_KEYWORD="绩效目标申报表" 只看某一份资料。
 */
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectId = process.env.DIAGNOSE_PROJECT_ID;
const keyword = process.env.DIAGNOSE_FILE_KEYWORD ?? "";

if (!supabaseUrl || !serviceKey || !projectId) {
  throw new Error("缺少 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 或 DIAGNOSE_PROJECT_ID。");
}

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

const query = async (path) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
};

const preview = (value, max = 260) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const materials = await query(
  `materials?project_id=eq.${projectId}&file_path=not.is.null&select=id,name,file_name,status,updated_at`,
);
const knowledgeFiles = await query(
  `knowledge_files?source_type=eq.material&select=id,project_id,source_id,file_name,status,chunk_count,error_message,indexed_at,updated_at&limit=1000`,
);

const knowledgeBySource = new Map(
  knowledgeFiles.filter((file) => file.source_id).map((file) => [String(file.source_id), file]),
);

const targets = materials.filter((material) =>
  !keyword || `${material.file_name ?? ""}${material.name ?? ""}`.includes(keyword)
);

console.log(`项目 ${projectId}：共 ${materials.length} 份带文件的资料，本次检查 ${targets.length} 份\n`);

for (const material of targets) {
  const fileName = material.file_name || material.name || "(未命名)";
  const indexRow = knowledgeBySource.get(String(material.id));
  console.log("=".repeat(72));
  console.log(`资料：${fileName}`);
  console.log(`  material.id=${material.id}  资料状态=${material.status ?? "-"}`);

  if (!indexRow) {
    console.log("  ❌ knowledge_files 里没有对应索引记录 —— 这份资料从未成功建立索引。");
    console.log("     → 在“文件库”点重建索引，或调用 ingest-project-knowledge（materialId, force=true）。");
    continue;
  }

  console.log(
    `  knowledge_files: status=${indexRow.status} chunk_count=${indexRow.chunk_count ?? 0}`
    + ` indexed_at=${indexRow.indexed_at ?? "-"}`,
  );
  console.log(`  error_message: ${indexRow.error_message ?? "(空)"}`);

  if (String(indexRow.project_id) !== String(projectId)) {
    console.log(
      `  ❌ 索引记录挂在另一个项目上（project_id=${indexRow.project_id}）。`
      + " 文件库按资料 ID 显示状态，报告按 project_id 取证据，因此两边会不一致。",
    );
  }

  const chunks = await query(
    `knowledge_chunks?file_id=eq.${indexRow.id}&select=chunk_index,project_id,content&order=chunk_index.asc&limit=5`,
  );
  const chunkCount = await fetch(
    `${supabaseUrl}/rest/v1/knowledge_chunks?file_id=eq.${indexRow.id}&select=id`,
    { headers: { ...headers, Prefer: "count=exact", Range: "0-0" } },
  ).then((response) => response.headers.get("content-range") ?? "?");

  console.log(`  knowledge_chunks 实际条数: ${chunkCount}`);
  if (!chunks.length) {
    console.log("  ❌ 没有任何正文片段 —— 报告会判定为“未完成解析”。");
    continue;
  }
  const strayProject = chunks.find((chunk) => String(chunk.project_id) !== String(projectId));
  if (strayProject) {
    console.log(`  ❌ 片段的 project_id=${strayProject.project_id}，与当前项目不一致，报告检索取不到。`);
  }
  console.log("  前几个片段正文预览（用于判断 OCR 是否成功）：");
  for (const chunk of chunks) {
    console.log(`    [片段${Number(chunk.chunk_index) + 1}] ${preview(chunk.content)}`);
  }
}
