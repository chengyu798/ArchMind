# 项目说明（简历用）

## 智能知识库对话系统 ｜ 独立完成 ｜ 2026.05 — 至今

**项目简介**：面向个人知识管理场景，从零搭建融合 RAG 检索增强生成与流式对话的全栈智能问答系统，支持文件上传构建私有向量知识库，提供从入库到前端交互的完整闭环。

**技术栈**：Python、LangChain、FastAPI、ChromaDB、SQLite、React、TypeScript、Vite

**主要工作**：

**文件入库与多存储层一致性**：设计文档入库流水线，支持 PDF、Markdown、TXT 格式解析与递归语义分块，经 ChromaDB 向量持久化与 MD5 去重后落库。文件状态在 uploaded → indexing → indexed → failed 间流转，删除时联动清理本地文件、SQLite 元数据与 ChromaDB 向量，保证三端数据一致。

**用户级 RAG 检索与流式对话**：基于 ChromaDB metadata filter 实现以 user_id 为维度的向量检索，确保多用户数据隔离。对话接口采用 SSE 流式响应，检索结果经 RAG 提示词模板拼接后由 LLM 逐 token 生成回答，前端实时渲染，完整回答自动落库。同时保留同步接口兼顾批量调用场景。

**多用户认证与会话管理**：基于 FastAPI 搭建 RESTful API，集成 JWT 认证实现用户注册、登录及会话 CRUD。SQLite 承载用户、会话、消息、文件元数据四类业务表，所有数据层以 user_id 隔离。模型 API Key 通过环境变量注入，与配置文件解耦。

**模块化后端与前端交互界面**：后端采用分层架构，配置、认证、路由、数据库、RAG 服务各自独立。前端以 React + TypeScript + Vite 构建，实现登录注册、会话与知识库面板切换、文件上传状态反馈、流式对话渲染、历史消息回显等功能，通过 Vite 代理解决跨域问题。
