# 智能体后端项目需求与实施路线图

## 1. 项目目标

本项目计划从当前的 Python 智能体后端原型，逐步演进为一个支持用户登录、会话管理、文件上传入库、RAG 问答、工具调用、Agent 记忆、本地模型、混合检索、Skill 扩展、MCP 接入和前端交互页面的完整智能体应用系统。

当前项目已经具备 LangChain Agent、工具调用、ChromaDB 向量库、RAG 检索、YAML 配置和提示词加载等基础能力。后续建设重点是将这些实验性能力产品化、服务化、模块化，并补齐真实业务场景所需的用户系统、文件系统、记忆系统、工具系统和前端交互。

## 2. 主要技术栈

### 2.1 后端技术栈

- Python
- FastAPI
- LangChain
- LangGraph
- ChromaDB
- Ollama
- SQLite
- Skill
- MCP

### 2.2 前端技术栈

- React
- TypeScript

### 2.3 技术职责划分

| 技术 | 职责 |
| --- | --- |
| Python | 后端主开发语言 |
| FastAPI | HTTP API、用户登录、文件上传、会话接口、前后端交互 |
| LangChain | LLM 调用、tool 封装、retriever、RAG chain 编排 |
| LangGraph | Agent 状态流、多步骤任务编排、会话状态、复杂工具调用流程 |
| ChromaDB | 向量数据库，存储文档切片向量和元数据 |
| SQLite | 用户、会话、消息、文件、工具调用、记忆元数据等结构化数据 |
| Ollama | 本地模型推理和本地 embedding 支持 |
| React + TypeScript | 主前端交互页面，适合构建聊天、上传、管理等复杂交互 |
| Skill | 封装可复用 Agent 能力，如报告生成、文件问答、数据分析等 |
| MCP | 接入外部工具、第三方系统、本地资源或业务系统能力 |

## 3. 目标系统能力

后续系统需要逐步支持以下能力：

1. 完善系统提示词、RAG 提示词、报告提示词、工具使用提示词等提示词体系。
2. 完善配置文件，支持模型、向量库、上传、工具、MCP、Skill、鉴权等模块化配置。
3. 接入真实工具 API，并基于当前业务场景创建符合需求的 tools。
4. 实现 Agent 记忆系统和会话管理。
5. 实现用户登录和用户数据隔离。
6. 改造知识库入库方式，从直接读取本地目录变为用户上传文件后写入向量数据库。
7. 支持多种文件上传与解析，包括 md、pdf、txt、doc、ppt、csv、图片等。
8. 支持本地模型 Ollama。
9. 采用混合检索模式，提高检索准确率。
10. 构建前端交互页面，支持聊天、文件上传、知识库管理、模型设置等功能。

## 4. 推荐总体架构

```text
frontend/
  react-app/ 或 vue-app/
    登录页
    聊天页
    文件上传页
    知识库管理页
    会话历史页
    模型设置页
    Skill 管理页
    MCP 配置页

backend/
  app/
    api/           FastAPI 路由层
    auth/          用户登录、鉴权、权限控制
    db/            SQLite 连接、表结构、数据访问
    schemas/       Pydantic 请求和响应模型
    agent/         Agent 编排入口
    graph/         LangGraph 状态图
    tools/         业务 tools 和外部 API tools
    rag/           文档解析、切分、检索、入库
    memory/        Agent 记忆系统
    models/        LLM 和 embedding 模型工厂
    skills/        Skill 加载、注册、执行
    mcp/           MCP client、server registry、tool adapter
    config/        YAML 配置
    prompts/       Prompt 模板
    utils/         通用工具

storage/
  sqlite.db
  chroma_db/
  uploaded_files/
```

## 5. 数据存储规划

### 5.1 SQLite

SQLite 用于存储结构化业务数据，包括：

- 用户信息
- 登录凭证或认证相关信息
- 会话记录
- 消息记录
- 用户上传文件元数据
- 文档切片元数据
- 工具调用记录
- Agent 长期记忆元数据
- MCP server 配置
- Skill 配置

建议的数据表包括：

```text
users
sessions
messages
uploaded_files
document_chunks
tool_calls
agent_memories
mcp_servers
skills
```

### 5.2 ChromaDB

ChromaDB 用于存储文档切片向量和检索元数据。

每个 chunk 的 metadata 建议包含：

```text
user_id
file_id
session_id 可选
filename
file_type
chunk_index
page_number 可选
source
created_at
embedding_model
```

需要注意：不同 embedding 模型的向量维度可能不同，不应混写到同一个 collection 中。切换 embedding 模型时，需要使用新的 collection 或重建向量库。

### 5.3 文件存储

用户上传的原始文件建议保存在本地目录中，第一阶段可以使用：

```text
storage/uploaded_files/{user_id}/{file_id}/原始文件
```

后续如果需要部署到云环境，可以迁移到对象存储。

## 6. 分阶段实施路线

### 阶段 1：提示词与配置体系完善

目标：补齐当前系统中未完成的提示词和配置能力。

主要任务：

- 完善 system prompt。
- 完善 RAG prompt。
- 完善 report prompt。
- 增加 tool 使用策略 prompt。
- 增加 memory 相关 prompt。
- 拆分并整理配置文件。
- 将 API key 从配置文件中移出，改为环境变量读取。

建议配置文件：

```text
model.yaml
rag.yaml
chroma.yaml
prompt.yaml
tools.yaml
upload.yaml
auth.yaml
mcp.yaml
skills.yaml
```

### 阶段 2：FastAPI 后端服务化

目标：将当前命令行 Agent 原型改造成可被前端调用的 HTTP 服务。

推荐接口：

```text
POST /auth/register
POST /auth/login
GET  /users/me

POST /chat/sessions
GET  /chat/sessions
GET  /chat/sessions/{session_id}
POST /chat/sessions/{session_id}/messages

POST /files/upload
GET  /files
GET  /files/{file_id}
DELETE /files/{file_id}

POST /knowledge/search
```

第一版聊天接口需要支持流式输出，方便前端构建类 ChatGPT 的交互体验。

### 阶段 3：用户登录与会话管理

目标：实现基础用户系统，确保用户数据隔离。

主要任务：

- 用户注册。
- 用户登录。
- JWT 鉴权。
- 获取当前用户信息。
- 创建会话。
- 查询会话列表。
- 查询会话消息。
- 保存用户消息和 AI 回复。
- 记录工具调用过程。

第一版权限模型可以保持简单：每个用户只能访问自己的会话、文件、记忆和向量数据。

### 阶段 4：真实工具 API 与业务 tools

目标：将当前模拟工具升级为真实业务工具。

每个 tool 应该明确：

- tool 名称
- tool 描述
- 入参 schema
- 返回格式
- 是否需要登录用户信息
- 是否需要外部 API
- 是否允许 Agent 自动调用
- 失败时的返回策略
- 日志记录策略

建议目录结构：

```text
app/tools/
  weather.py
  user_profile.py
  report_data.py
  document_tools.py
  external_api.py
```

Agent 不应直接关心外部 API 的细节，而是通过封装后的 tool 访问业务能力。

### 阶段 5：文件上传与向量库入库

目标：从“读取固定目录文件”升级为“用户上传文件后入库”。

推荐流程：

```text
用户上传文件
→ FastAPI 接收文件
→ 保存原始文件
→ SQLite 写入文件元数据
→ 文件解析
→ 文档切分
→ 调用 embedding 模型
→ 写入 ChromaDB
→ 更新文件入库状态
```

需要支持的状态：

```text
uploaded
parsing
indexed
failed
```

文件删除时，需要同时删除：

- SQLite 文件记录
- SQLite chunk 元数据
- ChromaDB 中对应 file_id 的向量
- 本地原始文件

### 阶段 6：多格式文件解析

目标：逐步支持多种文件类型。

建议分批实现。

第一批：

```text
txt
md
pdf
```

第二批：

```text
doc
docx
ppt
pptx
csv
```

第三批：

```text
图片
扫描版 PDF
OCR
```

建议抽象统一解析接口：

```text
BaseFileParser
  parse(file_path) -> list[Document]
```

不同文件类型使用不同 parser 实现，避免所有解析逻辑堆在一个函数里。

### 阶段 7：Agent 记忆系统

目标：让 Agent 同时具备会话上下文和跨会话长期记忆。

建议记忆分为三类：

1. 会话短期记忆  
   来自当前 session 的历史消息，用于多轮对话上下文。

2. 用户长期记忆  
   跨 session 保存用户偏好、常用需求、报告风格、业务背景等。

3. 业务记忆  
   与文件、报告、工具调用或业务对象绑定的记忆。

注意事项：

- 聊天历史不等于长期记忆。
- 不应把所有用户消息自动写入长期记忆。
- 长期记忆写入需要规则控制，必要时需要用户确认。
- 长期记忆可以结构化存入 SQLite，也可以进行向量化检索。

### 阶段 8：LangGraph 状态流改造

目标：将复杂 Agent 流程从简单 agent 调用升级为可控状态图。

推荐状态包括：

```text
user_input
user_context
session_history
memory_context
retrieved_docs
tool_results
final_answer
```

推荐流程：

```text
用户输入
→ 加载用户信息
→ 加载会话历史
→ 加载相关记忆
→ 判断是否需要 RAG
→ 判断是否需要调用工具
→ 执行本地 tools 或 MCP tools
→ 生成最终回答
→ 保存消息和工具调用记录
→ 判断是否需要写入长期记忆
```

LangGraph 适合承载后续复杂的多步骤 Agent 流程，而 LangChain 继续负责模型、tool、retriever 等基础能力。

### 阶段 9：Ollama 本地模型支持

目标：支持本地 LLM 和本地 embedding 模型。

建议通过统一模型工厂支持不同 provider：

```text
DashScope
DeepSeek
OpenAI compatible API
Ollama
```

示例配置：

```yaml
provider: ollama

ollama:
  base_url: http://localhost:11434
  chat_model: qwen2.5
  embedding_model: nomic-embed-text
```

注意事项：

- Ollama 服务需要本地启动。
- 本地模型性能依赖机器配置。
- 不同 embedding 模型不要混用同一个 Chroma collection。
- 模型切换时需要考虑已有知识库是否需要重建。

### 阶段 10：混合检索

目标：从纯向量检索升级为混合检索，提高召回率和准确率。

推荐检索流程：

```text
用户问题
→ 向量检索 dense retrieval
→ 关键词检索 sparse retrieval
→ 结果合并去重
→ rerank 可选
→ 取最终 top_n
→ 注入 prompt
→ LLM 生成答案
```

第一版可以采用：

```text
ChromaDB 向量检索
+
SQLite FTS 关键词检索
+
简单加权排序
```

后续再增加：

- BM25
- reranker 模型
- query rewrite
- metadata filter
- 多路召回融合

### 阶段 11：Skill 体系

目标：将可复用 Agent 能力封装成独立 skill。

建议每个 skill 包含：

```text
skill.yaml
prompt.md
tools.py
README.md 可选
```

示例 skill：

```text
report_generator
file_qa
data_analysis
weather_assistant
knowledge_search
```

第一版 skill 可以只负责：

- 声明适用场景
- 加载指定 prompt
- 注册指定 tools
- 提供执行入口

后续再扩展 skill 的安装、启用、禁用、版本管理和权限控制。

### 阶段 12：MCP 接入

目标：通过 MCP 接入外部工具和系统能力。

MCP 适合连接：

- 数据库
- 文件系统
- 浏览器
- 第三方 API
- 企业内部系统
- 外部知识库

建议模块：

```text
MCP Server Registry
MCP Client Manager
MCP Tool Adapter
```

Agent 不应直接处理 MCP 协议细节，而是通过 MCP Tool Adapter 将 MCP 工具统一转换为 Agent 可调用的 tools。

### 阶段 13：前端交互页面

目标：构建完整用户交互界面。

推荐优先使用 React + TypeScript 作为主前端。如果有学习或实验需要，可以再提供 Vue3 版本。

核心页面：

```text
登录页
注册页
聊天页
会话历史页
文件上传页
知识库管理页
模型设置页
Skill 管理页
MCP 配置页
```

聊天页需要支持：

- 流式输出
- 会话切换
- 文件上传后问答
- 展示引用来源
- 展示工具调用过程
- 模型切换
- 错误提示

文件管理页需要支持：

- 文件上传
- 入库状态展示
- 删除文件
- 查看文件解析状态
- 查看文件是否已写入向量库

## 7. 推荐 MVP 范围

第一版不建议同时实现所有能力。推荐 MVP 为：

```text
FastAPI
+ SQLite 用户登录
+ 会话管理
+ React + TypeScript 聊天页
+ 文件上传
+ txt / md / pdf 入 ChromaDB
+ LangChain RAG 问答
+ Ollama 可选支持
```

MVP 跑通后，再逐步增加：

```text
LangGraph 状态流
+ Agent 记忆
+ 真实业务 tools
+ 多格式文件解析
+ 混合检索
+ Skill
+ MCP
+ Vue3 版本或补充页面
```

## 8. 风险与注意事项

### 8.1 API key 管理

API key 不应写死在 YAML、Python 文件或可提交文件中。应通过环境变量或安全配置注入。

### 8.2 用户数据隔离

所有会话、文件、向量检索、记忆都必须绑定 user_id。检索时必须使用 metadata filter，避免用户之间数据串查。

### 8.3 文件上传安全

需要限制：

- 文件大小
- 文件类型
- 文件数量
- 文件名处理
- 解析超时
- 恶意文件内容

### 8.4 Prompt Injection

用户上传文件和外部工具返回内容都可能包含提示词注入。系统应明确区分：

- 系统指令
- 用户指令
- 文档内容
- 工具返回内容

文档内容不能直接覆盖系统指令。

### 8.5 向量库一致性

文件删除、重新入库、embedding 模型切换时，需要保证 SQLite 和 ChromaDB 中的数据一致。

### 8.6 Ollama 模型差异

本地模型能力、上下文长度、tool calling 支持、embedding 维度都可能与云模型不同，需要在模型工厂和配置层进行隔离。

## 9. 建议优先级

推荐优先级如下：

```text
P0：提示词、配置、FastAPI、SQLite、用户登录、会话管理
P1：文件上传、txt/md/pdf/csv 解析、ChromaDB 入库、RAG 问答
P2：前端聊天页、文件管理页、流式输出、引用来源展示
P3：真实业务 tools、LangGraph 状态流、Agent 记忆
P4：Ollama、多格式文件、混合检索
P5：Skill、MCP、Vue3 补充页面、部署和测试完善
```

## 10. 阶段性验收标准

### MVP 验收标准

- 用户可以注册和登录。
- 用户可以创建和切换会话。
- 用户可以上传 txt、md、pdf、csv 文件。
- 文件可以被解析、切分并写入 ChromaDB。
- 用户可以基于自己上传的文件进行问答。
- 回答可以展示引用来源。
- 不同用户之间的文件和检索结果相互隔离。
- 前端可以进行基础聊天和文件上传操作。

### 完整版本验收标准

- 支持多种文件格式上传和解析。
- 支持 Agent 长期记忆和会话短期记忆。
- 支持真实业务 tools。
- 支持 Ollama 本地模型。
- 支持混合检索。
- 支持 Skill 扩展。
- 支持 MCP 接入。
- 前端具备聊天、会话、文件、知识库、模型、Skill、MCP 管理能力。
