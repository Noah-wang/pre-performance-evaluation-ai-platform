# 事前绩效评估业务 AI 辅助系统

这是一个面向财政支出项目事前绩效评估工作的业务系统，覆盖“项目导入、资料审核、指标体系、专家管理、会议转写、AI 辅助写稿、整改跟踪、结果归档、知识库问答”等环节。系统目标是把分散的资料、指标、专家意见和报告草稿串联起来，帮助评估人员更快形成可追溯、可编辑、可归档的评估成果。

## 核心能力

- **评估包与项目管理**：支持从财政提供的 Excel 汇总表批量导入项目，也支持手动创建项目、维护预算金额、项目属性、评估结论和备注信息。
- **资料收集与审核**：按标准资料清单管理项目材料，支持上传、预览、替换、审核通过/驳回、单个删除和多选删除。
- **资料与指标匹配**：围绕项目已关联的评估指标体系，识别哪些资料能够支撑指标、哪些指标仍缺少证明材料。
- **绩效目标库**：沉淀项目绩效目标，按一级、二级、三级目标展示层级关系，并支持从历史项目中复用。
- **工作组与专家管理**：支持工作组管理、专家库维护、专家抽取、专家评分汇总和专家意见书导出。
- **会议录音与转写**：先录音生成音频文件，再调用转写服务生成文字稿，便于后续形成会议纪要、预评估意见和正式评估依据。
- **AI 辅助报告**：基于项目资料、会议内容、指标体系和专家意见生成评估报告、整改建议、专家组意见等文档，并支持在线编辑和 Word 导出。
- **RAG 文件库**：把项目资料和系统生成文档纳入知识库，按项目检索引用，辅助问答、写稿和资料核验。
- **权限与可见范围**：管理员可查看全部内容；工作组成员、专家仅查看与自己相关的项目数据。

## 技术栈

- 前端：`Vite`、`React`、`TypeScript`、`Tailwind CSS`、`shadcn/ui`
- 后端：`Supabase`、`PostgreSQL`、`Edge Functions`
- 文档处理：`docx`、`mammoth`、`html2canvas`、`jspdf`
- 表格处理：`xlsx`
- 富文本编辑：`TipTap`
- AI 能力：兼容 OpenAI 风格接口、阿里百炼/DashScope、Lovable AI Gateway 等配置

## 目录结构

```text
.
├── src/                    # 前端页面、组件和业务逻辑
├── supabase/
│   ├── functions/          # Edge Functions：AI、RAG、转写、短信、文档生成等
│   └── migrations/         # 数据库表结构、权限策略和函数迁移
├── docs/                   # 部署、使用、安全、交付说明
├── public/                 # 静态资源
├── scripts/ops/            # 备份、恢复、部署检查脚本
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## 本地开发

安装依赖：

```bash
npm ci
```

复制环境变量模板：

```bash
cp .env.example .env
```

至少需要配置：

```bash
VITE_SUPABASE_URL="https://supabase.example.com"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_xxx"
VITE_SUPABASE_PROJECT_ID="selfhost-example"
```

启动开发环境：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

## Supabase 与 AI 配置

数据库迁移位于 `supabase/migrations/`，Edge Functions 位于 `supabase/functions/`。

自托管或云端部署时，需要在 Supabase Secrets 中配置：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_API_KEY` 或兼容旧配置的 `LOVABLE_API_KEY`
- `AI_CHAT_BASE_URL`
- `AI_MODEL_DEFAULT`
- `AI_API_KEY_EMBEDDING` 或 `DASHSCOPE_API_KEY`
- `AI_TRANSCRIPTION_API_KEY`
- `AI_TRANSCRIPTION_BASE_URL`
- `AMAP_JSCODE`
- `TENCENT_SMS_SECRET_ID`
- `TENCENT_SMS_SECRET_KEY`
- `TENCENT_SMS_SDK_APP_ID`
- `TENCENT_SMS_SIGN_NAME`
- `TENCENT_SMS_TEMPLATE_ID`

`.env`、`.env.*`、构建产物和本地缓存不会提交到仓库。真实密钥请只放在本地环境变量或服务器 Secret 中。

## 部署说明

项目已包含本地部署和交付资料：

- [本地部署与内网联调说明](./docs/本地部署与内网联调.md)
- [系统使用手册](./docs/系统使用手册.md)
- [管理员与安全手册](./docs/管理员与安全手册.md)
- [交付与验收清单](./docs/交付与验收清单.md)

前端容器启动：

```bash
docker compose up -d --build
```

常用运维脚本：

- `scripts/ops/backup-postgres.sh`
- `scripts/ops/restore-postgres.sh`
- `scripts/ops/backup-storage.sh`
- `scripts/ops/restore-storage.sh`
- `scripts/ops/check-local-stack.sh`
- `scripts/ops/check-ai-endpoints.sh`

## 测试

```bash
npm run test
```

构建检查：

```bash
npm run build
```

## 安全说明

- 不要把 `.env`、服务端密钥、短信密钥、AI Key 上传到 GitHub。
- `SUPABASE_SERVICE_ROLE_KEY` 只能用于服务端或 Edge Functions，不能放到前端代码。
- 前端只能使用 Supabase publishable/anon key，并依赖 RLS 和业务权限控制数据访问。
