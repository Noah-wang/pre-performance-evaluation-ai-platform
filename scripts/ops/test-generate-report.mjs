import { writeFile } from "node:fs/promises";

const projectId = process.env.REPORT_TEST_PROJECT_ID;
const endpoint = process.env.REPORT_TEST_ENDPOINT ?? "http://127.0.0.1:54322/generate-report";
const outputPath = process.env.REPORT_TEST_OUTPUT ?? "/tmp/generated-report.txt";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!projectId || !supabaseUrl || !serviceKey) {
  throw new Error("缺少 REPORT_TEST_PROJECT_ID、SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。");
}

const authHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
};
const projectResponse = await fetch(
  `${supabaseUrl}/rest/v1/projects?id=eq.${projectId}&select=*`,
  { headers: authHeaders },
);
if (!projectResponse.ok) throw new Error(await projectResponse.text());
const [project] = await projectResponse.json();
if (!project) throw new Error(`未找到项目 ${projectId}`);

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ project, extra: "" }),
});
console.log(JSON.stringify({
  status: response.status,
  version: response.headers.get("x-report-generator-version"),
  files: response.headers.get("x-rag-grounded-files"),
  targets: response.headers.get("x-report-target-facts"),
}));
if (!response.ok) throw new Error(await response.text());

const reader = response.body.getReader();
const decoder = new TextDecoder();
let pending = "";
let report = "";
const errors = [];

const consumeEvent = (event) => {
  for (const line of event.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6);
    if (raw === "[DONE]") continue;
    try {
      const data = JSON.parse(raw);
      if (data.type === "replace" && typeof data.content === "string") {
        report = data.content;
      } else if (data.choices?.[0]?.delta?.content) {
        report += data.choices[0].delta.content;
      }
      if (data.type === "error") errors.push(data.message);
    } catch {
      // Ignore incomplete/non-JSON heartbeat events.
    }
  }
};

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  pending += decoder.decode(value, { stream: true });
  const events = pending.split("\n\n");
  pending = events.pop() ?? "";
  events.forEach(consumeEvent);
}
if (pending) consumeEvent(pending);

await writeFile(outputPath, report);
console.log(JSON.stringify({ chars: report.length, errors, outputPath }));
if (!report.trim() || errors.length) process.exitCode = 1;
