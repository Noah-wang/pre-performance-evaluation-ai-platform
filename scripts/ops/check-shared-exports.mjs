/**
 * 校验 edge function 从 _shared 导入的名称都真实存在。
 *
 * 这类断裂 tsc 查不出（Deno 模块解析与前端 tsconfig 不同），构建也不覆盖，
 * 只有部署后 worker 启动才报 "does not provide an export named X"，
 * 表现成前端的"AI 服务调用失败"，排查要绕一大圈。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const FN_DIR = "supabase/functions";
const dirs = readdirSync(FN_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => d.name);

let problems = 0;
for (const dir of dirs) {
  const entry = join(FN_DIR, dir, "index.ts");
  if (!existsSync(entry)) continue;
  const code = readFileSync(entry, "utf8");
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\.\/_shared\/([\w.-]+)"/g)) {
    const target = join(FN_DIR, "_shared", m[2]);
    if (!existsSync(target)) {
      console.error(`✗ ${dir}: 找不到 ${m[2]}`);
      problems += 1;
      continue;
    }
    const src = readFileSync(target, "utf8");
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      const ok = new RegExp(
        `export\\s+(?:const|function|class|interface|type|enum)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`,
      ).test(src);
      if (!ok) {
        console.error(`✗ ${dir} 从 ${m[2]} 导入的 ${name} 不存在`);
        problems += 1;
      }
    }
  }
}
console.log(problems ? `\n发现 ${problems} 处导入断裂` : "所有 _shared 导入均有对应导出 ✅");
process.exit(problems ? 1 : 0);
