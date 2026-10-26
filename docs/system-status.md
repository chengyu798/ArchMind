# 智能体后端项目功能总结

## 一、当前系统检查结论

- 后端主链路已形成闭环：用户认证 → 会话 → 文件上传 → 文件入库 → 私有知识库检索 → Agent 问答 → 引用来源 → 报告生成。
- 当前文档已同步到代码现状：文件格式已扩展到 `docx` / `pptx`，Agent 已接入 LangGraph 状态流，长期记忆、模型设置、RAG 参数设置、文件预览和来源片段定位也已经实现。
- 后续重点不再是“能不能跑通”，而是补齐回归测试、迁移体系、异步任务可靠性、检索质量、模型 provider 完整适配和部署运维能力。

---

## 二、已实现的后端功能

### 1. 用户认证

- 用户注册（用户名、密码、昵称必填，邮箱选填）
- 用户登录（JWT Token 签发）
- 获取当前用户信息
- 密码哈希存储（pbkdf2_sha256）
- API 访问通过 Bearer Token 做当前用户识别

接口：

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

---

### 2. 会话管理

- 创建会话
- 查询当前用户的会话列表
- 查询指定会话详情（含历史消息）
- 修改会话标题
- 删除会话（同步删除所有关联消息）
- 前端支持根据首轮问题自动生成会话标题，也支持用户手动修改
- 聊天时会截取最近历史消息作为短期上下文传入 Agent

接口：

```text
POST   /api/chat/sessions
GET    /api/chat/sessions
GET    /api/chat/sessions/{session_id}
PATCH  /api/chat/sessions/{session_id}
DELETE /api/chat/sessions/{session_id}
```

---

### 3. Agent 聊天对话

- 聊天接口已接入 `UserAgentService`，不再是单一 RAG 管线
- Agent 基于 LangChain `create_agent` 构建
- 已通过 `AgentWorkflow` 接入 LangGraph `StateGraph`，显式编排 `prepare_context` → `generate_answer` → `finalize`
- 当前主 Agent 已注册工具：用户知识库检索、真实天气查询
- 报告生成通过运行时上下文和动态提示词切换到报告模式
- 知识库工具返回来源 ID、文件名、文件 ID、文件类型、位置和内容；系统提示词要求基于资料回答时追加“引用来源”
- 同步聊天：用户提问 → Agent 决策是否调用工具 → 生成回答 → 保存用户消息和助手回复
- 流式聊天：SSE 返回 `start`、`message`、`workflow_step`、`tool_call`、`tool_result`、`done`、`error` 等事件
- 前端当前主要展示最终回答和引用来源，工具调用过程暂时隐藏
- 基于用户 ID 做会话、消息、文件、检索和报告的数据隔离
- 知识库工具通过 `ToolRuntime` 读取后端创建的不可变 `AgentContext`，模型工具参数不包含用户 ID；缺少可信上下文时拒绝检索
- 已增加空回答兜底：Agent 未返回有效文本时会保存并返回重试提示
- 用户表达偏好或关注点后，会自动抽取长期记忆并注入后续 Agent 上下文

接口：

```text
POST /api/chat/sessions/{session_id}/messages
POST /api/chat/sessions/{session_id}/messages/stream
```

---

### 4. 文件上传与管理

- 用户上传文件
- 文件类型白名单校验
- 文件大小限制（50MB）
- MD5 去重：同一用户重复上传相同内容时返回已有文件记录
- 文件列表查询
- 文件详情查询
- 文件内容预览（解析为文本并截断展示）
- 删除文件（同步删除本地文件、SQLite 记录和 ChromaDB 向量）
- 上传格式已与入库解析能力对齐：当前支持 `txt`、`md`、`pdf`、`csv`、`docx`、`pptx`

接口：

```text
POST   /api/files/upload
GET    /api/files
GET    /api/files/{file_id}
GET    /api/files/{file_id}/preview
POST   /api/files/{file_id}/index
DELETE /api/files/{file_id}
```

---

### 5. 文件入库与向量检索

- 用户手动触发单文件入库
- 入库任务已后台异步执行，避免大文件阻塞请求
- 支持解析 `txt`、`md`、`pdf`、`csv`、`docx`、`pptx` 文件
- `docx` / `pptx` 当前通过轻量 XML 文本抽取实现
- 文档切片（chunk_size=200, chunk_overlap=20）
- 写入 ChromaDB（含 user_id、file_id、filename、file_type、chunk_index、row_index、slide_number 等 metadata）
- 用户级向量检索（仅检索当前用户的文档）
- 已接入轻量混合检索：向量相似度召回 + 关键词召回 + 加权合并排序
- 支持通过设置接口调整检索召回数量和切片参数
- 支持按文件名、文件 ID、位置定位来源片段
- 文件删除时同步删除 ChromaDB 向量
- 文件状态流转：`uploaded` → `indexing` → `indexed` / `failed`

接口：

```text
POST /api/files/{file_id}/index
POST /api/knowledge/search
GET  /api/knowledge/sources/lookup
GET  /api/settings/rag
PATCH /api/settings/rag
```

---

### 6. 报告生成

- 已新增报告生成接口
- 报告基于当前用户的文件数量、入库状态、会话数量、消息数量、最近文件和最近会话生成
- 报告生成复用 Agent 能力和报告提示词
- 报告生成会注入当前用户长期记忆
- 已支持报告历史保存、列表查询、详情查看和删除
- 前端支持将报告导出为 Markdown 文件

接口：

```text
GET    /api/reports
POST   /api/reports/generate
GET    /api/reports/{report_id}
DELETE /api/reports/{report_id}
```

---

### 7. 长期记忆系统

- 用户消息中出现偏好、后续要求、重点关注等表达时，后端会自动抽取长期记忆
- 长期记忆按用户隔离，保存到 `user_memories` 表
- 支持记忆权重累加，重复表达相同记忆时提高权重
- Agent 聊天和报告生成都会读取当前用户长期记忆并注入上下文
- 支持查看、手动新增、编辑、删除当前用户的长期记忆
- 当前抽取方式为规则匹配，适合轻量场景，后续仍需增强语义抽取和去重质量

接口：

```text
GET    /api/memories
POST   /api/memories
PATCH  /api/memories/{memory_id}
DELETE /api/memories/{memory_id}
```

---

### 8. 工具系统

当前主 Agent 已注册工具：

| 工具 | 说明 |
|---|---|
| `search_user_knowledge` | 只接收检索问题，通过后端可信上下文绑定当前用户，返回来源 ID、文件名、文件 ID、位置和内容 |
| `get_weather` | 调用 Open-Meteo 公开接口查询真实天气 |

当前仍保留但未注册进主 Agent 的预留工具：

| 工具 | 当前状态 |
|---|---|
| `get_current_month` | 代码存在，可用于时间上下文，但当前主 Agent 未注册 |
| `get_user_id` | 主 Agent 不注册身份查询工具，当前用户 ID 由后端运行时上下文注入 |
| `fill_context_for_report` | 代码存在，但报告模式当前通过 runtime context 和动态提示词切换实现 |

---

### 9. 模型与设置

- 模型配置集中在 `app/config/model.yaml`
- 云端聊天模型可通过 DashScope / DeepSeek / OpenAI-compatible 接入；默认 Embedding 来自 DashScope
- 已接入 `langchain-ollama`，模型工厂支持 Ollama 聊天模型和 embedding 模型
- 已通过 `ChatOpenAI` 适配 DeepSeek / OpenAI-compatible 聊天模型 provider
- Embedding 模型仅由开发者在后端配置 DashScope / Ollama，页面和模型设置 API 不再提供 Embedding 配置
- 模型 API Key 已从配置文件中移除，改为环境变量读取
- 后端支持查看和更新模型配置
- 后端支持查看和更新 RAG 检索参数（k、chunk_size、chunk_overlap）
- 前端已提供模型和检索设置页；聊天模型验证成功后立即用于后续消息和报告，失败时保留原配置，进行中的回答继续使用原实例
- 更换 Embedding 仍需开发者修改后端配置、重启并重新入库；切片参数需要重新入库后完全生效

接口：

```text
GET   /api/settings/model
PATCH /api/settings/model
GET   /api/settings/rag
PATCH /api/settings/rag
```

---

### 10. 健康检查

- 已提供基础健康检查接口，用于确认后端服务进程可访问

接口：

```text
GET /api/health
```

---

### 11. 数据库

SQLite 存储结构化数据，表结构：

| 表名 | 用途 |
|---|---|
| `users` | 用户信息（用户名、昵称、邮箱、密码哈希） |
| `sessions` | 聊天会话（绑定 user_id） |
| `messages` | 聊天消息（绑定 session_id） |
| `user_memories` | 用户长期记忆（绑定 user_id，含类型、内容、权重） |
| `uploaded_files` | 上传文件元数据（绑定 user_id，含 md5、大小、状态） |
| `reports` | 报告历史（绑定 user_id，含标题、周期、关注点、内容） |

ChromaDB 存储文档向量和检索元数据。

当前数据库初始化主要通过 `Base.metadata.create_all` 和少量手动补列逻辑完成，尚未接入正式迁移工具。

---

### 12. 配置体系

配置文件：

```text
agent.yaml      - 项目基础配置
model.yaml      - 模型配置（provider、model_name、providers）
rag.yaml        - RAG 检索和切分配置
chroma.yaml     - ChromaDB 基础配置
prompt.yaml     - 提示词文件路径
tools.yaml      - 工具配置
auth.yaml       - JWT 鉴权配置
upload.yaml     - 上传文件限制配置
database.yaml   - SQLite 数据库路径配置
skills.yaml     - Skill 配置（预留）
mcp.yaml        - MCP 配置（预留）
sql.yaml        - 历史/空配置，当前未作为主流程配置使用
```

---

### 13. 日志系统

关键操作均已添加 logger 记录，覆盖：

- 用户登录和注册
- 会话创建、查询、更新、删除
- 聊天消息发送和保存
- Agent 状态流执行
- Agent 流式事件生成
- 工具调用监控
- 知识库检索和来源定位
- 文件上传、预览、入库、删除
- 长期记忆抽取、查询、新增、编辑、删除
- 模型设置和 RAG 设置读取、更新
- 报告生成
- 异常和错误信息

---

### 14. 回归检查

- 后端已有 62 项自动化回归检查，覆盖模型即时切换、真实 JWT、用户隔离、知识检索、同步/SSE 工具调用、报告身份绑定及注册/管理员权限
- 前端已有 5 项 Markdown 渲染检查，覆盖标题/加粗/列表、表格/代码、流式片段、引用卡片及 HTML/危险链接处理
- 后续继续补齐完整上传入库、异步任务恢复及浏览器端到端流程

运行方式：

```text
uv run pytest
npm --prefix frontend test
npm --prefix frontend run build
```

---

## 三、已实现的前端功能

技术栈：React + TypeScript + Vite

| 页面/功能 | 说明 |
|---|---|
| 登录/注册页 | 支持登录和注册双模式，token 持久化 |
| 会话面板 | 新建会话、切换会话、删除会话、会话列表；侧栏隐藏会话日期与索引数量，四个功能入口采用底部两行两列图标布局 |
| 会话标题 | 首轮问题自动提炼标题，悬停标题后通过铅笔图标手动编辑 |
| 聊天区域 | 流式及历史助手消息支持 Markdown 渲染；滚动条位于主区域最右侧，左侧刻度按对话轮次导航并高亮当前浏览位置，不再展示消息数量 |
| 聊天输入框 | 支持多行输入、Enter 发送、Shift+Enter 换行；模型选择内置于输入框底部，可展开/收起，管理员可直接即时切换模型 |
| 引用来源 | 结构化引用来源卡片，支持点击打开原文片段预览 |
| 文件管理页 | 单独页面展示文件名、状态、上传时间、入库时间、大小和操作 |
| 文件预览 | 支持查看已上传文件解析后的文本内容，长文本会截断 |
| 文件入库 | 上传、入库、重试、删除、状态轮询 |
| 报告生成页 | 支持填写主题、周期、关注重点并生成报告 |
| 报告历史 | 支持历史报告列表、打开详情、删除和 Markdown 导出 |
| 长期记忆管理 | 支持查看、手动新增、编辑、删除用户长期记忆 |
| 模型和检索设置页 | 管理员可即时切换聊天模型和 provider，调整 k、chunk_size、chunk_overlap；Embedding 仅在后端维护 |
| 视觉主题 | 已改为暖色调界面 |
| 错误提示 | Toast 弹窗提示上传、入库、标题、报告、记忆、设置等错误 |
| 状态反馈 | 上传中、生成中、入库中、失败、空状态等反馈 |

---

## 四、技术栈总览

| 分类 | 技术 |
|---|---|
| 后端框架 | FastAPI |
| LLM 编排 | LangChain |
| Agent 能力 | LangChain `create_agent` + LangGraph `StateGraph` |
| 向量数据库 | ChromaDB |
| 业务数据库 | SQLite（SQLAlchemy ORM） |
| 模型服务 | DashScope 为当前主用；Ollama 已接入；DeepSeek/OpenAI-compatible 聊天模型已适配 |
| 真实工具 API | Open-Meteo |
| 前端 | React + TypeScript + Vite |
| 依赖管理 | uv（后端）、npm（前端） |

---

## 五、仍未完整接入或保留的旧代码

| 文件 | 当前状态 |
|---|---|
| `app/rag/rag_summarize.py` | 旧版无用户隔离 RAG 服务，当前主聊天未使用 |
| `app/rag/user_rag_service.py` | 用户级 RAG 服务仍保留，但当前主聊天通过 Agent 工具直接检索向量库 |
| `app/agent/agent_tools.py` | 旧版模拟工具，当前主 Agent 使用 `app/agent/tools/` 下的新工具 |
| `app/agent/tools/context_tools.py` | 上下文工具代码保留，但当前未注册进主 Agent |
| `app/agent/tools/report_tools.py` | 报告上下文工具代码保留，但当前报告模式通过 runtime context 切换 |
| `app/config/mcp.yaml` | MCP 配置预留，尚未接入产品能力 |
| `app/config/skills.yaml` | Skill 配置预留，尚未接入产品能力 |
| `app/config/sql.yaml` | 历史/空配置，当前主流程未使用 |

---

## 六、后续需要完善或新增的功能

### P0：稳定当前产品闭环

| 项目 | 说明 |
|---|---|
| 用户隔离回归测试 | 已覆盖真实 JWT、SQLite/Chroma 检索过滤、会话/文件/记忆/报告/任务越权、同步及 SSE 工具身份伪造、并发 Agent 调用、注册与管理员权限；后续补浏览器 E2E 和完整上传入库流程 |
| 数据库迁移体系 | 当前依赖 `create_all` 和手动补列；后续建议接入 Alembic 或版本化迁移脚本，避免表结构漂移 |
| 异步入库可靠性 | 当前使用 FastAPI BackgroundTasks；后续补充任务进度、失败原因、重试策略、服务重启保护和更清晰的前端状态 |
| 配置和文案一致性 | 持续校验 `upload.yaml`、前端 accept、空状态文案、回归脚本和 system-status 是否一致 |
| system-status 持续更新 | 每次完成阶段功能后同步更新本文件 |

### P1：核心能力扩展

| 项目 | 说明 |
|---|---|
| 长期记忆质量增强 | 已支持规则抽取和手动新增；后续可加入 LLM 语义抽取、记忆合并、分类体系、启用/停用和隐私提示 |
| 文件解析增强 | 已支持 txt/md/pdf/csv/docx/pptx；后续扩展 doc、ppt、xlsx、图片 OCR、扫描版 PDF OCR，并增强 docx/pptx 复杂版式兼容性 |
| 引用来源增强 | 已支持点击预览原文片段；后续可做高亮定位、页码/段落/行号更精确映射、引用可信度展示和流式回答中的引用稳定解析 |
| 报告能力增强 | 当前基于统计摘要生成；后续可加入时间范围过滤、真实知识库内容引用、模板选择、图表、PDF/Word 导出 |
| 工具体系扩展 | 接入外部搜索、业务数据、日历/待办、更多真实 API，并在前端可选展示工具调用轨迹 |

### P2：检索与模型优化

| 项目 | 说明 |
|---|---|
| 混合检索增强 | 已支持向量召回 + 关键词召回 + 加权合并；后续可加入 BM25、query rewrite、rerank 和命中解释 |
| 检索参数配置页 | 已支持前端调整 k、chunk_size、chunk_overlap；后续可扩展 rerank、重建索引和参数预设 |
| 模型 provider 完整适配 | 已适配 DashScope、Ollama、DeepSeek/OpenAI-compatible 聊天模型；后续补 provider 健康检查、embedding 能力矩阵和更多 embedding provider |
| 模型运行时切换 | 已支持聊天模型即时切换、连接及工具参数验证、失败保留原配置；后续增加调用耗时统计 |
| LangGraph 可观测性 | 当前已有基础状态流；后续可拆分更多节点，增加 trace、步骤耗时、失败恢复和可视化调试 |

### P3：平台化和部署

| 项目 | 说明 |
|---|---|
| MCP 接入 | 通过 MCP 连接外部工具和系统，并在前端管理 MCP server 配置 |
| Skill 体系 | 封装可复用的 Agent 能力包，支持启用、禁用、参数配置和版本管理 |
| 管理页面 | 扩展为模型、检索、MCP、Skill、日志、用户和数据管理页面 |
| CI/CD 测试覆盖 | 单元测试、集成测试、端到端测试、前端可访问性检查和自动化构建 |
| 部署支持 | Docker Compose、环境变量模板、生产配置、持久化卷、SQLite/ChromaDB 备份与恢复 |
| 运维与安全 | 访问限流、Token 过期/刷新、上传内容安全校验、日志脱敏、监控告警和多环境配置 |


## 2026-10-23：统一前端控件与操作布局

- 排查：长期记忆、模型设置及聊天输入框使用系统原生下拉菜单；会话、文件、记忆、报告删除使用浏览器确认弹窗。设置页 Grid 默认拉伸使表单和按钮异常增高，部分操作缺少键盘入口。
- 修复：共用 SelectField（键盘导航、选中状态、菜单定位）、NumberField（范围限制、自定义加减）、站内确认弹窗（默认取消、焦点限制、Escape/遮罩取消、焦点归还）。四类删除入口统一接入；会话打开与删除拆为独立按钮，并补充删除失败提示。
- 布局：设置表单按内容高度排列、主操作右对齐；记忆改为新增表单与列表分栏，类型显示中文且保留接口分类值；报告生成表单、历史列表和预览区调整滚动及空状态布局。
- 验证：`npm --prefix frontend test` 20/20 通过（本次新增 15 项 UI 交互回归）；`npm --prefix frontend run build` 通过。IAB 在 1280×720 实测设置下拉、记忆键盘选择、聊天模型嵌套菜单、会话删除取消与焦点恢复，并检查报告及记忆布局截图。真实用户数据未删除、模型配置未提交修改；删除确认接口测试使用内存 mock。


## 2026-10-23：聊天回复 Token 用量

- 删除聊天输入框右下角的快捷键提示文字，保留 Enter 发送、Shift+Enter 换行交互。
- 每条助手回复结束后展示输入、输出、合计 Token；按一次回答聚合工具循环中的全部模型调用，读取 LangChain 标准 usage 或服务商 token_usage。OpenAI-compatible 流式请求显式启用 stream_usage；同一模型请求只计一次，服务商未提供的数字不估算。
- messages 增加可空 token_usage JSON 字段，启动时对旧数据库做幂等增量迁移；同步接口、SSE 完成/错误事件和历史会话都保留用量。旧消息显示未记录，缺失用量显示未返回完整用量。
- 验证：后端 `python -m pytest -q` 74 项通过，前端 `npm --prefix frontend test` 26 项通过，前端构建通过；新增后端 12 项与前端 6 项用量回归，覆盖多次工具循环、缺失用量、重复回调、并发隔离、同步/流式落库、错误响应、迁移和 SSE 分块解析。
- 实际页面验证：新建 Token 用量验证会话，deepseek-v4-flash 返回输入 1205、输出 111、合计 1316 Token；刷新并重开会话后数值一致，快捷键小字不再展示。
