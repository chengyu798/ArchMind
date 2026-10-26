import { ContextPanel } from './ContextPanel';
import { TokenUsageFooter } from './TokenUsageFooter';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { ConversationTimeline } from './ConversationTimeline';
import { MarkdownContent } from './MarkdownContent';
import {
  type ChatSession,
  type FilePreviewResponse,
  type Memory,
  type Message,
  type ModelSettings,
  type RagSettings,
  type Report,
  type SourceLookupResponse,
  type StreamEvent,
  type UploadedFile,
  type User,
  createSession,
  createMemory,
  deleteFile,
  deleteMemory,
  deleteReport,
  deleteSession,
  getMe,
  getModelSettings,
  getRagSettings,
  getReport,
  getSession,
  getJob,
  generateReport,
  indexFile,
  listFiles,
  listMemories,
  listReports,
  listSessions,
  login,
  lookupSource,
  previewFile,
  streamMessage,
  updateMemory,
  updateModelSettings,
  updateRagSettings,
  updateSession,
  uploadFile,
} from './api';
import { UserMenu, UserProfile } from './UserMenu';
import { NumberField, SelectField, useConfirmDialog } from './UIControls';

const DEFAULT_SESSION_TITLE = '新会话';
const STREAM_INTERVAL_MS = 32;
const INDEXABLE_FILE_ACCEPT = '.txt,.md,.pdf,.csv,.docx,.pptx';
const MEMORY_TYPE_OPTIONS = [
  { value: 'preference', label: '偏好' },
  { value: 'focus', label: '关注点' },
  { value: 'profile', label: '个人信息' },
  { value: 'constraint', label: '约束' },
];

type NavTab = 'profile' | 'sessions' | 'files' | 'reports' | 'memories' | 'settings';

type Citation = {
  sourceId: string;
  filename: string;
  location: string;
  fileId?: number;
};

type SourcePreview = {
  citation: Citation;
  detail: SourceLookupResponse | null;
  loading: boolean;
  error: string;
};

type FilePreview = {
  file: UploadedFile;
  detail: FilePreviewResponse | null;
  loading: boolean;
  error: string;
};

type ParsedMessageContent = {
  body: string;
  citations: Citation[];
};

type FileStatusMeta = {
  label: string;
  tone: 'pending' | 'running' | 'success' | 'failed';
};

const FILE_STATUS: Record<UploadedFile['status'], FileStatusMeta> = {
  uploaded: { label: '待入库', tone: 'pending' },
  indexing: { label: '入库中', tone: 'running' },
  indexed: { label: '已入库', tone: 'success' },
  failed: { label: '失败', tone: 'failed' },
};

function parseApiError(err: unknown): string {
  if (!(err instanceof Error)) return '未知错误';
  try {
    const parsed = JSON.parse(err.message);
    return parsed.detail ?? err.message;
  } catch {
    return err.message;
  }
}

function useToken(): [string | null, (token: string | null) => void] {
  const [value, setValue] = useState<string | null>(() => localStorage.getItem('token'));
  const update = (token: string | null) => {
    if (token) { localStorage.setItem('token', token); }
    else { localStorage.removeItem('token'); }
    setValue(token);
  };
  return [value, update];
}

function isTokenCurrent(token: string): boolean {
  return localStorage.getItem('token') === token;
}

function createSessionTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').replace(/[?？!！。.，,;；:：]+$/g, '').trim();
  const cleaned = normalized
    .replace(/^(请问|请帮我|帮我|帮忙|我想知道|能不能|可以帮我|麻烦|如何|怎么)\s*/, '')
    .trim();
  const title = cleaned || normalized || DEFAULT_SESSION_TITLE;
  return title.length > 18 ? `${title.slice(0, 18)}…` : title;
}

function isUntitledSession(title?: string): boolean {
  const value = title?.trim();
  return !value || value === DEFAULT_SESSION_TITLE;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getIndexedTime(file: UploadedFile): string {
  if (file.status === 'indexed') return formatDateTime(file.updated_at);
  if (file.status === 'indexing') return '入库中';
  if (file.status === 'failed') return '入库失败';
  return '待入库';
}

function parseMessageContent(content: string): ParsedMessageContent {
  const markerMatch = content.match(/\n?#{0,3}\s*引用来源\s*[:：]?\s*\n/i);
  if (!markerMatch || markerMatch.index === undefined) {
    return { body: content, citations: [] };
  }

  const body = content.slice(0, markerMatch.index).trimEnd();
  const citationText = content.slice(markerMatch.index + markerMatch[0].length).trim();
  const citations: Citation[] = [];
  const lines = citationText.split('\n').map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const sourceId = line.match(/S\d+/i)?.[0]?.toUpperCase();
    const filename = line.match(/(?:文件名|文件|来源)[:：]\s*([^，,；;\n]+)/)?.[1]?.trim();
    const location = line.match(/(?:位置|片段|行)[:：]\s*([^，,；;\n]+)/)?.[1]?.trim();
    const fileIdMatch = line.match(/(?:文件ID|file_id|fileId)[:：=]\s*(\d+)/i);
    if (sourceId || filename || location || fileIdMatch) {
      citations.push({
        sourceId: sourceId || `S${citations.length + 1}`,
        filename: filename || '未知文件',
        location: location || '未知位置',
        fileId: fileIdMatch ? Number(fileIdMatch[1]) : undefined,
      });
    }
  }

  return { body: body || content, citations };
}

function CitationList({ citations, onOpen }: { citations: Citation[]; onOpen?: (citation: Citation) => void }) {
  if (citations.length === 0) return null;
  return (
    <div className="citation-list" aria-label="引用来源">
      <div className="citation-list-title">引用来源</div>
      <div className="citation-cards">
        {citations.map((citation) => (
          <button
            key={`${citation.sourceId}-${citation.filename}-${citation.location}`}
            type="button"
            className="citation-card"
            onClick={() => onOpen?.(citation)}
          >
            <span>{citation.sourceId}</span>
            <strong title={citation.filename}>{citation.filename}</strong>
            <small>{citation.location}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function SourcePreviewModal({ preview, onClose }: { preview: SourcePreview | null; onClose: () => void }) {
  if (!preview) return null;
  return (
    <div className="source-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="source-modal-header">
          <div>
            <p className="eyebrow">Source Preview</p>
            <h2 id="source-modal-title">{preview.citation.filename}</h2>
            <span>{preview.citation.sourceId} · {preview.citation.location}</span>
          </div>
          <button type="button" className="btn-small" onClick={onClose} aria-label="关闭来源详情">关闭</button>
        </div>
        {preview.loading ? (
          <div className="source-modal-status">正在加载原文片段…</div>
        ) : preview.error ? (
          <div className="source-modal-status source-modal-status--error">{preview.error}</div>
        ) : (
          <>
            <pre className="source-modal-content">{preview.detail?.content || '没有可展示的片段内容'}</pre>
            {preview.detail?.metadata && (
              <div className="source-modal-meta">
                {typeof preview.detail.metadata.file_type === 'string' && <span>{preview.detail.metadata.file_type.toUpperCase()}</span>}
                {typeof preview.detail.metadata.chunk_index === 'number' && <span>片段 {preview.detail.metadata.chunk_index}</span>}
                {typeof preview.detail.metadata.row_index === 'number' && <span>第 {preview.detail.metadata.row_index} 行</span>}
                {typeof preview.detail.metadata.slide_number === 'number' && <span>第 {preview.detail.metadata.slide_number} 页幻灯片</span>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FilePreviewModal({ preview, onClose }: { preview: FilePreview | null; onClose: () => void }) {
  if (!preview) return null;
  return (
    <div className="source-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="source-modal" role="dialog" aria-modal="true" aria-labelledby="file-preview-title" onClick={(e) => e.stopPropagation()}>
        <div className="source-modal-header">
          <div>
            <p className="eyebrow">File Preview</p>
            <h2 id="file-preview-title">{preview.file.filename}</h2>
            <span>{preview.file.file_type.toUpperCase()} · {formatFileSize(preview.file.file_size)}</span>
          </div>
          <button type="button" className="btn-small" onClick={onClose} aria-label="关闭文件预览">关闭</button>
        </div>
        {preview.loading ? (
          <div className="source-modal-status">正在加载文件内容…</div>
        ) : preview.error ? (
          <div className="source-modal-status source-modal-status--error">{preview.error}</div>
        ) : (
          <>
            <pre className="source-modal-content">{preview.detail?.content || '没有可预览的文本内容'}</pre>
            {preview.detail?.truncated && <div className="source-modal-status">文件较长，当前仅展示前半部分内容。</div>}
          </>
        )}
      </section>
    </div>
  );
}

export function MessageBubble({ message, streaming = false, onOpenCitation, onOpenHistory }: { message: Pick<Message, 'role' | 'content' | 'token_usage' | 'usage_breakdown'>; streaming?: boolean; onOpenCitation?: (citation: Citation) => void; onOpenHistory?: (id: number) => void }) {
  const parsed = message.role === 'assistant' ? parseMessageContent(message.content) : { body: message.content, citations: [] };
  return (
    <div className={`message message--${message.role}`}>
      <div className="message-content">
        {message.role === 'assistant' ? <MarkdownContent content={parsed.body} /> : <span>{parsed.body}</span>}
        {streaming && <span className="stream-cursor" aria-hidden="true" />}
      </div>
      <CitationList citations={parsed.citations} onOpen={onOpenCitation} />
      {message.role === 'assistant' && !streaming && <div className="history-references">{Array.from(new Set(Array.from(message.content.matchAll(/\[M(\d+)\]/g), (match) => Number(match[1])))).map((id) => <button type="button" className="btn-small" key={id} onClick={() => onOpenHistory?.(id)}>历史来源 M{id}</button>)}</div>}
      {message.role === 'assistant' && !streaming && <TokenUsageFooter usage={message.token_usage} breakdown={message.usage_breakdown} />}
    </div>
  );
}

function Login({ onLogin, token: _token }: { onLogin: (t: string) => void; token: string | null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'login') {
        const res = await login(username, password);
        onLogin(res.access_token);
      } else {
        const body: Record<string, string> = { username, password, nickname: nickname || username };
        if (email.trim()) { body.email = email.trim(); }
        const raw = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (raw.ok) {
          const res = await login(username, password);
          onLogin(res.access_token);
        } else {
          const text = await raw.text();
          let detail = text;
          try { detail = JSON.parse(text).detail ?? text; } catch { /* ignore */ }
          throw new Error(detail);
        }
      }
    } catch (err: unknown) {
      const msg = parseApiError(err);
      if (mode === 'login') {
        setError('用户名或密码错误');
      } else {
        setError(msg.includes('已存在') ? '用户名或邮箱已被占用' : msg);
      }
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand-mark">
            <img src="/logo.png" alt="ArchMind" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
        <div className="login-heading">
          <h1>ArchMind</h1>
          <p className="login-subtitle">智能知识库对话平台</p>
        </div>

        <label className="field-group">
          <span>用户名</span>
          <input aria-label="用户名" placeholder="请输入用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>

        {mode === 'register' && (
          <>
            <label className="field-group">
              <span>昵称</span>
              <input aria-label="昵称" placeholder="用于界面展示" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
            <label className="field-group">
              <span>邮箱（选填）</span>
              <input aria-label="邮箱" placeholder="name@example.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        )}

        <label className="field-group">
          <span>密码</span>
          <input aria-label="密码" placeholder="请输入密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error && <p className="login-error" role="alert">{error}</p>}

        <button type="submit" className="btn-primary">
          {mode === 'login' ? '登录控制台' : '创建账号'}
        </button>

        <button type="button" className="btn-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? '没有账号？创建账号' : '已有账号？返回登录'}
        </button>
      </form>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return <div className="toast" role="status" aria-live="polite">{message}</div>;
}

function StatusBadge({ status }: { status: UploadedFile['status'] }) {
  const meta = FILE_STATUS[status];
  return <span className={`file-badge file-badge--${meta.tone}`}>{meta.label}</span>;
}

function FileManager({
  files,
  uploadingFile,
  onUpload,
  onIndex,
  onPreview,
  onDelete,
}: {
  files: UploadedFile[];
  uploadingFile: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onIndex: (fileId: number) => void;
  onPreview: (file: UploadedFile) => void;
  onDelete: (fileId: number) => void;
}) {
  const indexedCount = files.filter((file) => file.status === 'indexed').length;
  const indexingCount = files.filter((file) => file.status === 'indexing').length;

  return (
    <section className="file-manager">
      <div className="page-header">
        <div>
          <p className="eyebrow">Knowledge Base</p>
          <h1>入库文件管理</h1>
          <p>集中查看文件名、入库状态、上传时间与入库时间。</p>
        </div>
        <label className={`btn-upload btn-upload--hero ${uploadingFile ? 'btn-upload--loading' : ''}`}>
          {uploadingFile ? '上传中…' : '上传文件'}
          <input type="file" hidden onChange={onUpload} accept={INDEXABLE_FILE_ACCEPT} />
        </label>
      </div>

      <div className="file-stats" aria-label="文件入库统计">
        <div className="stat-card">
          <span>全部文件</span>
          <strong>{files.length}</strong>
        </div>
        <div className="stat-card">
          <span>已入库</span>
          <strong>{indexedCount}</strong>
        </div>
        <div className="stat-card">
          <span>处理中</span>
          <strong>{indexingCount}</strong>
        </div>
      </div>

      <div className="file-table-card">
        {files.length === 0 ? (
          <div className="empty-state">
            <h2>暂无入库文件</h2>
            <p>上传 txt、md、pdf 或 csv 文件后，可以在这里发起入库并跟踪状态。</p>
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>类型 / 大小</th>
                <th>状态</th>
                <th>上传时间</th>
                <th>入库时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>
                    <div className="table-file-name" title={file.filename}>{file.filename}</div>
                  </td>
                  <td>{file.file_type.toUpperCase()} · {formatFileSize(file.file_size)}</td>
                  <td><StatusBadge status={file.status} /></td>
                  <td>{formatDateTime(file.created_at)}</td>
                  <td>{getIndexedTime(file)}</td>
                  <td>
                    <div className="table-actions">
                      <button className="btn-small" onClick={() => onPreview(file)}>预览</button>
                      {file.status === 'uploaded' && (
                        <button className="btn-small btn-small--primary" onClick={() => onIndex(file.id)}>入库</button>
                      )}
                      {file.status === 'failed' && (
                        <button className="btn-small btn-small--primary" onClick={() => onIndex(file.id)}>重试</button>
                      )}
                      <button className="btn-small btn-danger" onClick={() => onDelete(file.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function MemoryPage({ token, onToast }: { token: string; onToast: (message: string) => void }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftType, setDraftType] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [newType, setNewType] = useState('preference');
  const [newContent, setNewContent] = useState('');

  const loadMemories = async () => {
    setLoading(true);
    try {
      const nextMemories = await listMemories(token);
      if (isTokenCurrent(token)) setMemories(nextMemories);
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`记忆加载失败：${parseApiError(err)}`);
    } finally {
      if (isTokenCurrent(token)) setLoading(false);
    }
  };

  useEffect(() => { loadMemories(); }, [token]);

  const startEdit = (memory: Memory) => {
    setEditingId(memory.id);
    setDraftType(memory.memory_type);
    setDraftContent(memory.content);
  };

  const addMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newType.trim() || !newContent.trim()) {
      onToast('记忆类型和内容不能为空');
      return;
    }
    try {
      const created = await createMemory(token, { memory_type: newType.trim(), content: newContent.trim() });
      if (isTokenCurrent(token)) {
        setMemories((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        setNewType('preference');
        setNewContent('');
        onToast('记忆已新增');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`记忆新增失败：${parseApiError(err)}`);
    }
  };

  const saveMemory = async (memoryId: number) => {
    if (!draftType.trim() || !draftContent.trim()) {
      onToast('记忆类型和内容不能为空');
      return;
    }
    try {
      const updated = await updateMemory(token, memoryId, { memory_type: draftType.trim(), content: draftContent.trim() });
      if (isTokenCurrent(token)) {
        setMemories((prev) => prev.map((item) => (item.id === memoryId ? updated : item)));
        setEditingId(null);
        onToast('记忆已更新');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`记忆更新失败：${parseApiError(err)}`);
    }
  };

  const removeMemory = async (memoryId: number) => {
    if (!(await confirm({ title: '删除这条记忆？', description: '删除后，后续对话将不再使用这条记忆。此操作无法撤销。' })) || !isTokenCurrent(token)) return;
    try {
      await deleteMemory(token, memoryId);
      if (isTokenCurrent(token)) {
        setMemories((prev) => prev.filter((item) => item.id !== memoryId));
        onToast('记忆已删除');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`记忆删除失败：${parseApiError(err)}`);
    }
  };

  return (
    <section className="memory-page">
      {confirmDialog}
      <div className="page-header">
        <div>
          <p className="eyebrow">Memory</p>
          <h1>长期记忆管理</h1>
          <p>查看、编辑或删除 Agent 从对话中沉淀的用户偏好和关注点。</p>
        </div>
        <button type="button" className="btn-small btn-small--primary" onClick={loadMemories} disabled={loading}>刷新</button>
      </div>

      <div className="memory-layout">
        <form className="memory-item memory-create" onSubmit={addMemory}>
          <div className="memory-item-header">
            <span>新增记忆</span>
            <small>手动补充偏好或关注点</small>
          </div>
          <SelectField label="新记忆类型" value={newType} onChange={setNewType} options={MEMORY_TYPE_OPTIONS} />
          <textarea aria-label="新记忆内容" value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={3} placeholder="例如：回答时优先给出可执行步骤" />
          <div className="memory-actions">
            <button type="submit" className="btn-small btn-small--primary" disabled={!newContent.trim()}>新增记忆</button>
          </div>
        </form>
        <div className="memory-list-card">
          {memories.length === 0 ? (
            <div className="empty-state">
              <h2>{loading ? '正在加载记忆' : '暂无长期记忆'}</h2>
              <p>当你表达偏好、关注点或后续要求时，系统会自动沉淀为长期记忆。</p>
            </div>
          ) : memories.map((memory) => (
            <article key={memory.id} className="memory-item">
              {editingId === memory.id ? (
                <>
                  <SelectField label="记忆类型" value={draftType} onChange={setDraftType} options={MEMORY_TYPE_OPTIONS} />
                  <textarea aria-label="记忆内容" value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={3} />
                  <div className="memory-actions">
                    <button type="button" className="btn-small btn-small--primary" onClick={() => saveMemory(memory.id)}>保存</button>
                    <button type="button" className="btn-small" onClick={() => setEditingId(null)}>取消</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="memory-item-header">
                    <span>{MEMORY_TYPE_OPTIONS.find((option) => option.value === memory.memory_type)?.label ?? memory.memory_type}</span>
                    <small>权重 {memory.weight} · {formatDateTime(memory.updated_at)}</small>
                  </div>
                  <p>{memory.content}</p>
                  <div className="memory-actions">
                    <button type="button" className="btn-small btn-small--primary" onClick={() => startEdit(memory)}>编辑</button>
                    <button type="button" className="btn-small btn-danger" onClick={() => removeMemory(memory.id)}>删除</button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsPage({ token, user, onToast, onModelChange }: { token: string; user: User; onToast: (message: string) => void; onModelChange: (settings: ModelSettings) => void }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [ragSettings, setRagSettings] = useState<RagSettings | null>(null);
  const [chatProvider, setChatProvider] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [ragK, setRagK] = useState(3);
  const [chunkSize, setChunkSize] = useState(200);
  const [chunkOverlap, setChunkOverlap] = useState(20);
  const [saving, setSaving] = useState(false);
  const [savingRag, setSavingRag] = useState(false);

  const loadSettings = async () => {
    try {
      const [nextSettings, nextRagSettings] = await Promise.all([getModelSettings(token), getRagSettings(token)]);
      if (isTokenCurrent(token)) {
        setSettings(nextSettings);
        onModelChange(nextSettings);
        setChatProvider(nextSettings.chat_provider);
        setChatModel(nextSettings.chat_model);
        setRagSettings(nextRagSettings);
        setRagK(nextRagSettings.k);
        setChunkSize(nextRagSettings.chunk_size);
        setChunkOverlap(nextRagSettings.chunk_overlap);
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`设置加载失败：${parseApiError(err)}`);
    }
  };

  useEffect(() => { loadSettings(); }, [token]);

  const providerNames = settings?.providers ?? [];

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.is_admin) {
      onToast('只有管理员可以修改全局模型设置');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateModelSettings(token, {
        chat_provider: chatProvider,
        chat_model: chatModel.trim(),
      });
      if (isTokenCurrent(token)) {
        setSettings(updated);
        setChatProvider(updated.chat_provider);
        setChatModel(updated.chat_model);
        onModelChange(updated);
        onToast('聊天模型已切换，立即生效');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`模型设置保存失败：${parseApiError(err)}`);
    } finally {
      if (isTokenCurrent(token)) setSaving(false);
    }
  };

  const saveRagSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.is_admin) {
      onToast('只有管理员可以修改全局检索参数');
      return;
    }
    setSavingRag(true);
    try {
      const updated = await updateRagSettings(token, {
        k: ragK,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
      });
      if (isTokenCurrent(token)) {
        setRagSettings(updated);
        onToast('检索参数已保存，重建索引后对新切片生效');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) onToast(`检索参数保存失败：${parseApiError(err)}`);
    } finally {
      if (isTokenCurrent(token)) setSavingRag(false);
    }
  };

  return (
    <section className="settings-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>模型和检索设置</h1>
          <p>切换聊天模型后，后续消息立即使用新模型。</p>
          {!user.is_admin && <p className="settings-note">当前账号不是管理员，只能查看全局设置。</p>}
        </div>
      </div>

      <div className="settings-panels">
        <form className="settings-form" onSubmit={saveSettings}>
          <div className="settings-section-title">
            <strong>聊天模型设置</strong>
            <span>验证成功后立即切换，正在生成的回答会继续完成。</span>
          </div>
          <label>
            <span>模型服务商</span>
            <SelectField label="模型服务商" value={chatProvider} onChange={setChatProvider} disabled={saving || !user.is_admin} options={providerNames.map((provider) => ({ value: provider, label: provider }))} />
          </label>
          <label>
            <span>聊天模型</span>
            <input value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder="例如 deepseek-v4-flash / qwen2.5" disabled={saving || !user.is_admin} required />
          </label>
          <div className="settings-note">
            切换失败时会保留当前模型；此设置对所有用户生效。
          </div>
          <div className="form-actions"><button type="submit" className="btn-primary" disabled={saving || !settings || !chatModel.trim() || !user.is_admin}>{saving ? '验证并切换中…' : '保存并立即切换'}</button></div>
        </form>

        <form className="settings-form" onSubmit={saveRagSettings}>
          <div className="settings-section-title">
            <strong>检索参数</strong>
            <span>调整召回数量和切片大小；切片参数需要重新入库后才会完全生效。</span>
          </div>
          <label>
            <span>召回数量 k</span>
            <NumberField label="召回数量 k" min={1} max={20} value={ragK} onChange={setRagK} disabled={savingRag || !user.is_admin} />
          </label>
          <label>
            <span>切片长度 chunk_size</span>
            <NumberField label="切片长度 chunk_size" min={100} max={3000} value={chunkSize} onChange={setChunkSize} disabled={savingRag || !user.is_admin} />
          </label>
          <label>
            <span>切片重叠 chunk_overlap</span>
            <NumberField label="切片重叠 chunk_overlap" min={0} max={1000} value={chunkOverlap} onChange={setChunkOverlap} disabled={savingRag || !user.is_admin} />
          </label>
          <div className="settings-note">
            当前分隔符数量：{ragSettings?.separators.length ?? 0}；保存后新检索会使用新的 k，已入库切片需要重建索引才会按新 chunk 参数切分。
          </div>
          <div className="form-actions"><button type="submit" className="btn-primary" disabled={savingRag || !ragSettings || !user.is_admin}>{savingRag ? '保存中…' : '保存检索参数'}</button></div>
        </form>
      </div>
    </section>
  );
}

function ReportPage({ token, onToast }: { token: string; onToast: (message: string) => void }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [topic, setTopic] = useState('知识库使用报告');
  const [period, setPeriod] = useState('本月');
  const [focus, setFocus] = useState('文件入库情况、会话问答情况、后续优化建议');
  const [generating, setGenerating] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const loadReportHistory = async () => {
    setLoadingReports(true);
    try {
      const nextReports = await listReports(token);
      if (isTokenCurrent(token)) {
        setReports(nextReports);
        setSelectedReport((current) => current ?? nextReports[0] ?? null);
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) {
        onToast(`报告历史加载失败：${parseApiError(err)}`);
      }
    } finally {
      if (isTokenCurrent(token)) {
        setLoadingReports(false);
      }
    }
  };

  useEffect(() => {
    loadReportHistory();
  }, [token]);

  const pollReportStatus = (reportId: number, jobId?: number | null) => {
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        if (jobId) {
          const job = await getJob(token, jobId);
          if (job.status === 'failed') {
            window.clearInterval(timer);
            const report = await getReport(token, reportId);
            if (isTokenCurrent(token)) {
              setSelectedReport(report);
              setReports((prev) => prev.map((item) => (item.id === report.id ? report : item)));
              onToast(`报告生成失败：${job.error_message || '请稍后重试'}`);
            }
            return;
          }
        }
        const report = await getReport(token, reportId);
        if (!isTokenCurrent(token)) {
          window.clearInterval(timer);
          return;
        }
        setSelectedReport(report);
        setReports((prev) => prev.map((item) => (item.id === report.id ? report : item)));
        if (report.status === 'completed' || report.status === 'failed' || attempts >= 60) {
          window.clearInterval(timer);
          onToast(report.status === 'completed' ? '报告已生成并保存' : '报告生成失败，请稍后重试');
        }
      } catch (err: unknown) {
        if (attempts >= 60) {
          window.clearInterval(timer);
          if (isTokenCurrent(token)) onToast(`报告状态刷新失败：${parseApiError(err)}`);
        }
      }
    }, 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !period.trim()) {
      onToast('报告主题和统计周期不能为空');
      return;
    }
    setGenerating(true);
    try {
      const response = await generateReport(token, { topic: topic.trim(), period: period.trim(), focus: focus.trim() });
      if (isTokenCurrent(token)) {
        setSelectedReport(response.report);
        setReports((prev) => [response.report, ...prev.filter((report) => report.id !== response.report.id)]);
        onToast('报告生成任务已开始');
        pollReportStatus(response.report.id, response.job?.id);
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) {
        onToast(`报告生成失败：${parseApiError(err)}`);
      }
    } finally {
      if (isTokenCurrent(token)) {
        setGenerating(false);
      }
    }
  };

  const handleOpenReport = async (reportId: number) => {
    try {
      const report = await getReport(token, reportId);
      if (isTokenCurrent(token)) {
        setSelectedReport(report);
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) {
        onToast(`报告打开失败：${parseApiError(err)}`);
      }
    }
  };

  const handleDeleteReport = async (reportId: number) => {
    if (!(await confirm({ title: '删除这份报告？', description: '报告内容和历史记录将被删除，此操作无法撤销。' })) || !isTokenCurrent(token)) return;
    try {
      await deleteReport(token, reportId);
      if (isTokenCurrent(token)) {
        setReports((prev) => prev.filter((report) => report.id !== reportId));
        setSelectedReport((current) => (current?.id === reportId ? null : current));
        onToast('报告已删除');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(token)) {
        onToast(`报告删除失败：${parseApiError(err)}`);
      }
    }
  };

  const handleExportReport = () => {
    if (!selectedReport) return;
    const filename = `${selectedReport.title}-${selectedReport.period}`.replace(/[\\/:*?"<>|]/g, '-');
    const markdown = `# ${selectedReport.title}\n\n- 统计周期：${selectedReport.period}\n- 生成时间：${formatDateTime(selectedReport.created_at)}\n- 关注重点：${selectedReport.focus || '无'}\n\n---\n\n${selectedReport.content}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="report-page">
      {confirmDialog}
      <div className="page-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>知识库报告生成</h1>
          <p>基于当前用户的文件、入库状态和会话数据生成结构化报告。</p>
        </div>
      </div>

      <div className="report-layout">
        <div className="report-side">
          <form className="report-form" onSubmit={handleSubmit}>
            <label>
              <span>报告主题</span>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} />
            </label>
            <label>
              <span>统计周期</span>
              <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="例如：本周、本月、2026 年 6 月" />
            </label>
            <label>
              <span>关注重点</span>
              <textarea value={focus} onChange={(e) => setFocus(e.target.value)} rows={5} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={generating}>
                {generating ? '生成中…' : '生成报告'}
              </button>
            </div>
          </form>

          <div className="report-history">
            <div className="report-history-header">
              <strong>历史报告</strong>
              <button type="button" className="btn-small" onClick={loadReportHistory} disabled={loadingReports}>刷新</button>
            </div>
            {reports.length === 0 ? (
              <p className="report-history-empty">暂无历史报告</p>
            ) : (
              <div className="report-history-list">
                {reports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    className={`report-history-item ${selectedReport?.id === report.id ? 'active' : ''}`}
                    onClick={() => handleOpenReport(report.id)}
                  >
                    <span>{report.title}</span>
                    <small>{report.period} · {formatDateTime(report.created_at)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <article className="report-preview">
          {generating ? (
            <div className="empty-state">
              <h2>正在生成报告</h2>
              <p>Agent 会汇总当前文件、入库状态和会话数据，请稍候。</p>
            </div>
          ) : selectedReport ? (
            <>
              <div className="report-preview-header">
                <div>
                  <p className="eyebrow">Saved Report</p>
                  <h2>{selectedReport.title}</h2>
                  <span>{selectedReport.period} · {formatDateTime(selectedReport.created_at)} · {selectedReport.status === 'generating' ? '生成中' : selectedReport.status === 'failed' ? '失败' : '已完成'}</span>
                </div>
                <div className="report-preview-actions">
                  <button type="button" className="btn-small btn-small--primary" onClick={handleExportReport} disabled={selectedReport.status !== 'completed'}>导出 Markdown</button>
                  <button type="button" className="btn-small btn-danger" onClick={() => handleDeleteReport(selectedReport.id)}>删除</button>
                </div>
              </div>
              <div className="report-content">{selectedReport.content}</div>
            </>
          ) : (
            <div className="empty-state">
              <h2>还没有报告</h2>
              <p>填写左侧信息后点击生成，报告会保存并显示在这里。</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

export function App() {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [token, setToken] = useToken();
  const [user, setUser] = useState<User | null>(null);
  const [activeModel, setActiveModel] = useState<ModelSettings | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [contextStage, setContextStage] = useState('');
  const [contextRefresh, setContextRefresh] = useState(0);
  const [historyMessageId, setHistoryMessageId] = useState<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [activeTurn, setActiveTurn] = useState(0);
  const streamBufferRef = useRef('');
  const streamVisibleRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);

  const [navTab, setNavTab] = useState<NavTab>('sessions');
  const [toastMessage, setToastMessage] = useState('');
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const turns = useMemo(() => messages.flatMap((message, index) => message.role === 'user' ? [{ messageIndex: index, question: message.content }] : []), [messages]);

  const updateReadingPosition = () => {
    const viewport = chatScrollRef.current;
    if (!viewport) return;
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 64;
    followLatestRef.current = atBottom;
    let current = 0;
    const top = viewport.getBoundingClientRect().top + 48;
    turns.forEach((turn, index) => {
      const anchor = viewport.querySelector(`[data-message-index="${turn.messageIndex}"]`);
      if (anchor && anchor.getBoundingClientRect().top <= top) current = index;
    });
    setActiveTurn(atBottom ? Math.max(0, turns.length - 1) : current);
  };

  const jumpToTurn = (index: number) => {
    const turn = turns[index];
    if (!turn) return;
    followLatestRef.current = false;
    setActiveTurn(index);
    const anchor = chatScrollRef.current?.querySelector(`[data-message-index="${turn.messageIndex}"]`);
    anchor?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const switchChatModel = async (provider: string, name: string) => {
    if (!token || !user?.is_admin) throw new Error('只有管理员可以修改聊天模型。');
    try {
      const updated = await updateModelSettings(token, { chat_provider: provider, chat_model: name });
      if (!isTokenCurrent(token)) return;
      setActiveModel(updated);
      setToastMessage('聊天模型已切换，立即生效');
    } catch (err) {
      throw new Error(parseApiError(err));
    }
  };

  const stopStreamTimer = () => {
    if (streamTimerRef.current !== null) {
      window.clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  };

  const startStreamTimer = () => {
    if (streamTimerRef.current !== null) return;
    streamTimerRef.current = window.setInterval(() => {
      const buffer = streamBufferRef.current;
      if (!buffer) return;
      const step = buffer.length > 240 ? 6 : buffer.length > 120 ? 4 : buffer.length > 60 ? 2 : 1;
      const next = buffer.slice(0, step);
      streamBufferRef.current = buffer.slice(step);
      streamVisibleRef.current += next;
      setStreamingContent(streamVisibleRef.current);
    }, STREAM_INTERVAL_MS);
  };

  const waitForStreamReveal = () => new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      if (!streamBufferRef.current) {
        window.clearInterval(timer);
        resolve();
      }
    }, STREAM_INTERVAL_MS);
  });

  const resetState = () => {
    stopStreamTimer();
    streamBufferRef.current = '';
    streamVisibleRef.current = '';
    setUser(null);
    setActiveModel(null);
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
    setFiles([]);
    setInput('');
    setStreaming(false);
    setStreamingContent('');
    setNavTab('sessions');
    setEditingTitle(false);
    setTitleDraft('');
    setSourcePreview(null);
    setFilePreview(null);
  };

  useEffect(() => () => stopStreamTimer(), []);

  useEffect(() => {
    resetState();
    if (!token) {
      return;
    }

    getMe(token)
      .then((currentUser) => {
        if (isTokenCurrent(token)) {
          setUser(currentUser);
        }
      })
      .catch(() => {
        if (isTokenCurrent(token)) {
          setToken(null);
          resetState();
        }
      });
  }, [token]);

  const loadSessions = (currentToken = token) => {
    if (!currentToken) return;
    listSessions(currentToken).then((nextSessions) => {
      if (isTokenCurrent(currentToken)) {
        setSessions(nextSessions);
        setActiveSessionId((currentSessionId) => (
          currentSessionId && nextSessions.some((session) => session.id === currentSessionId) ? currentSessionId : null
        ));
      }
    });
  };

  const loadFiles = (currentToken = token) => {
    if (!currentToken) return;
    listFiles(currentToken).then((nextFiles) => {
      if (isTokenCurrent(currentToken)) {
        setFiles(nextFiles);
      }
    });
  };

  useEffect(() => {
    if (!token || !user) return;
    loadSessions(token);
    loadFiles(token);
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) return;
    getModelSettings(token).then((settings) => {
      if (isTokenCurrent(token)) setActiveModel(settings);
    }).catch(() => {
      if (isTokenCurrent(token)) setActiveModel(null);
    });
  }, [token, user, navTab]);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  const switchSession = async (id: number) => {
    if (streaming) { setToastMessage('请等待当前回复完成后再切换会话'); return; }
    setHistoryMessageId(null);
    if (!token) return;
    const currentToken = token;
    setNavTab('sessions');
    setEditingTitle(false);
    setActiveSessionId(id);
    setMessages([]);
    try {
      const detail = await getSession(currentToken, id);
      if (isTokenCurrent(currentToken)) {
        setMessages(detail.messages);
      }
    } catch {
      if (isTokenCurrent(currentToken)) {
        setActiveSessionId(null);
        setMessages([]);
        setToastMessage('会话不存在或已被删除');
        loadSessions(currentToken);
      }
    }
  };

  const renameSession = async (sessionId: number, title: string, showToast = true) => {
    if (!token) return null;
    const nextTitle = title.trim();
    if (!nextTitle) {
      if (showToast) setToastMessage('标题不能为空');
      return null;
    }

    const currentToken = token;
    try {
      const updated = await updateSession(currentToken, sessionId, nextTitle);
      if (!isTokenCurrent(currentToken)) return null;
      setSessions((prev) => prev.map((session) => (session.id === sessionId ? updated : session)));
      if (showToast) setToastMessage('标题已更新');
      return updated;
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken) && showToast) {
        setToastMessage(`标题更新失败：${parseApiError(err)}`);
      }
      return null;
    }
  };

  const handleTitleSave = async () => {
    if (!activeSessionId) return;
    const updated = await renameSession(activeSessionId, titleDraft);
    if (updated) {
      setEditingTitle(false);
    }
  };

  const handleSend = async () => {
    if (!token || !input.trim() || streaming) return;
    const content = input.trim();
    if (!activeSessionId) {
      try {
        const s = await createSession(token, createSessionTitle(content));
        if (!isTokenCurrent(token)) return;
        setSessions((prev) => [s, ...prev]);
        setActiveSessionId(s.id);
        sendAndStream(token, s.id, content);
      } catch (err: unknown) {
        setToastMessage(`创建会话失败：${parseApiError(err)}`);
      }
    } else {
      if (messages.length === 0 && isUntitledSession(activeSession?.title)) {
        void renameSession(activeSessionId, createSessionTitle(content), false);
      }
      sendAndStream(token, activeSessionId, content);
    }
  };

  const sendAndStream = async (t: string, sessionId: number, content: string) => {
    followLatestRef.current = true;
    stopStreamTimer();
    streamBufferRef.current = '';
    streamVisibleRef.current = '';
    setInput('');
    setStreaming(true);
    setStreamingContent('');
    setContextStage('preparing');
    startStreamTimer();

    const userMsg: Message = { id: -1, session_id: sessionId, role: 'user', content, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    let fullContent = '';
    let tokenUsage: Message['token_usage'] = null;
    let assistantMessageId = -2;
    let usageBreakdown: Message['usage_breakdown'] = null;
    try {
      await streamMessage(t, sessionId, content, (event: StreamEvent) => {
        if (!isTokenCurrent(t)) return;
        if (event.type === 'message') {
          fullContent += event.content;
          streamBufferRef.current += event.content;
        } else if (event.type === 'context_status') {
          setContextStage(event.stage);
          if (event.warning) setToastMessage(event.warning);
        } else if (event.type === 'done') {
          usageBreakdown = event.usage_breakdown ?? null;
          tokenUsage = event.token_usage ?? null;
          assistantMessageId = event.message_id ?? -2;
        } else if (event.type === 'error') {
          usageBreakdown = event.usage_breakdown ?? null;
          tokenUsage = event.token_usage ?? null;
          assistantMessageId = event.message_id ?? -2;
          streamBufferRef.current += event.content;
          fullContent += event.content;
        }
      });

      await waitForStreamReveal();
      if (!isTokenCurrent(t)) return;
      setMessages((prev) => [...prev, { id: assistantMessageId, session_id: sessionId, role: 'assistant', content: fullContent, token_usage: tokenUsage, usage_breakdown: usageBreakdown, created_at: new Date().toISOString() }]);
      setStreamingContent('');
      loadSessions(t);
    } catch {
      if (isTokenCurrent(t)) {
        setMessages((prev) => [...prev, { id: -2, session_id: sessionId, role: 'assistant', content: '回复生成失败，请重试。', created_at: new Date().toISOString() }]);
      }
    } finally {
      stopStreamTimer();
      streamBufferRef.current = '';
      streamVisibleRef.current = '';
      if (isTokenCurrent(t)) {
        setStreaming(false);
        setContextStage('');
        setContextRefresh((value) => value + 1);
        setStreamingContent('');
      }
    }
  };

  const handleOpenCitation = async (citation: Citation) => {
    if (!token) return;
    const filename = citation.filename === '未知文件' ? undefined : citation.filename;
    const location = citation.location === '未知位置' ? undefined : citation.location;
    if (!filename && !citation.fileId) {
      setSourcePreview({ citation, detail: null, loading: false, error: '这条引用缺少文件标识，无法定位原文片段。' });
      return;
    }

    const currentToken = token;
    setSourcePreview({ citation, detail: null, loading: true, error: '' });
    try {
      const detail = await lookupSource(currentToken, {
        filename,
        location,
        fileId: citation.fileId,
      });
      if (isTokenCurrent(currentToken)) {
        setSourcePreview({ citation, detail, loading: false, error: '' });
      }
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken)) {
        setSourcePreview({ citation, detail: null, loading: false, error: `来源片段加载失败：${parseApiError(err)}` });
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!token || !e.target.files?.[0]) return;
    const currentToken = token;
    setUploadingFile(true);
    try {
      await uploadFile(currentToken, e.target.files[0]);
      if (isTokenCurrent(currentToken)) {
        loadFiles(currentToken);
        setNavTab('files');
        setToastMessage('文件上传成功');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken)) {
        const msg = parseApiError(err);
        if (msg.includes('大小超出') || msg.includes('413')) {
          setToastMessage('上传失败：文件大小超出限制');
        } else if (msg.includes('类型') || msg.includes('不支持')) {
          setToastMessage('上传失败：不支持的文件格式');
        } else {
          setToastMessage('上传失败：网络不稳定，请重试');
        }
      }
    } finally {
      if (isTokenCurrent(currentToken)) {
        setUploadingFile(false);
      }
      e.target.value = '';
    }
  };

  const pollFileStatus = (currentToken: string, fileId: number) => {
    let attempts = 0;
    const timer = window.setInterval(async () => {
      if (!isTokenCurrent(currentToken)) {
        window.clearInterval(timer);
        return;
      }

      attempts += 1;
      const nextFiles = await listFiles(currentToken);
      if (!isTokenCurrent(currentToken)) {
        window.clearInterval(timer);
        return;
      }

      setFiles(nextFiles);
      const currentFile = nextFiles.find((file) => file.id === fileId);
      if (!currentFile || currentFile.status === 'indexed' || currentFile.status === 'failed' || attempts >= 30) {
        window.clearInterval(timer);
        if (currentFile?.status === 'indexed') {
          setToastMessage('文件已入库');
        } else if (currentFile?.status === 'failed') {
          setToastMessage('文件入库失败，请重试');
        }
      }
    }, 1500);
  };

  const handleIndex = async (fileId: number) => {
    if (!token) return;
    const currentToken = token;
    try {
      const response = await indexFile(currentToken, fileId);
      if (isTokenCurrent(currentToken)) {
        setFiles((prev) => prev.map((file) => (file.id === fileId ? response.file : file)));
        setToastMessage(response.message);
        pollFileStatus(currentToken, fileId);
      }
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken)) {
        setToastMessage(`入库失败：${parseApiError(err)}`);
      }
    }
  };

  const handlePreviewFile = async (file: UploadedFile) => {
    if (!token) return;
    const currentToken = token;
    setFilePreview({ file, detail: null, loading: true, error: '' });
    try {
      const detail = await previewFile(currentToken, file.id);
      if (isTokenCurrent(currentToken)) {
        setFilePreview({ file: detail.file, detail, loading: false, error: '' });
      }
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken)) {
        setFilePreview({ file, detail: null, loading: false, error: `文件预览失败：${parseApiError(err)}` });
      }
    }
  };

  const handleDeleteFile = async (fileId: number) => {
    if (!token) return;
    const currentToken = token;
    if (!(await confirm({ title: '删除这个文件？', description: '文件及其知识库索引将被删除，此操作无法撤销。' })) || !isTokenCurrent(currentToken)) return;
    try {
      await deleteFile(currentToken, fileId);
      if (isTokenCurrent(currentToken)) {
        loadFiles(currentToken);
        setToastMessage('文件已删除');
      }
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken)) setToastMessage(`文件删除失败：${parseApiError(err)}`);
    }
  };

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token) return;
    const currentToken = token;
    if (!(await confirm({ title: '删除这个会话？', description: '此会话中的全部消息将被删除，此操作无法撤销。' })) || !isTokenCurrent(currentToken)) return;
    try {
      await deleteSession(currentToken, sessionId);
      if (!isTokenCurrent(currentToken)) return;
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
      loadSessions(currentToken);
      setToastMessage('会话已删除');
    } catch (err: unknown) {
      if (isTokenCurrent(currentToken)) setToastMessage(`会话删除失败：${parseApiError(err)}`);
    }
  };

  useEffect(() => {
    followLatestRef.current = true;
    const viewport = chatScrollRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    setActiveTurn(Math.max(0, turns.length - 1));
  }, [activeSessionId, navTab]);

  useEffect(() => {
    const viewport = chatScrollRef.current;
    if (viewport && followLatestRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      setActiveTurn(Math.max(0, turns.length - 1));
    }
  }, [messages, streamingContent]);

  if (!token || !user) {
    return <Login onLogin={setToken} token={token} />;
  }

  return (
    <div className="app-layout">
      {confirmDialog}
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage('')} />}
      <SourcePreviewModal preview={sourcePreview} onClose={() => setSourcePreview(null)} />
      <FilePreviewModal preview={filePreview} onClose={() => setFilePreview(null)} />

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/logo.png" alt="ArchMind" className="sidebar-logo" />
          <div>
            <h2>ArchMind</h2>
            <p>智能知识库对话平台</p>
          </div>
        </div>

        <button disabled={streaming} className="btn-new-session" onClick={async () => {
          if (!token) return;
          try {
            const s = await createSession(token, DEFAULT_SESSION_TITLE);
            if (!isTokenCurrent(token)) return;
            setSessions((prev) => [s, ...prev]);
            setActiveSessionId(s.id);
            setMessages([]);
            setEditingTitle(false);
            setNavTab('sessions');
          } catch (err: unknown) {
            setToastMessage(`创建会话失败：${parseApiError(err)}`);
          }
        }}>+ 新建会话</button>

        <div className="sidebar-list">
          {sessions.map((s) => (
            <div key={s.id} className={`sidebar-session ${s.id === activeSessionId && navTab === 'sessions' ? 'active' : ''}`}>
              <button type="button" className="sidebar-item" onClick={() => switchSession(s.id)}>
                <span className="sidebar-item-title">{s.title}</span>
              </button>
              <button type="button" className="btn-delete-session" onClick={(e) => handleDeleteSession(s.id, e)} title="删除会话" aria-label={`删除会话：${s.title}`}>&times;</button>
            </div>
          ))}
          {sessions.length === 0 && <p className="sidebar-empty">暂无会话，点击上方按钮创建</p>}
        </div>

        <UserMenu user={user} activeTab={navTab} onNavigate={setNavTab} onLogout={() => { resetState(); setToken(null); }} />

      </aside>

      {/* Main Content */}
      <main className="main-area">
        <div className="mobile-user-menu"><UserMenu compact user={user} activeTab={navTab} onNavigate={setNavTab} onLogout={() => { resetState(); setToken(null); }} /></div>
        {navTab === 'profile' ? (
          <UserProfile user={user} />
        ) : navTab === 'reports' ? (
          <ReportPage token={token} onToast={setToastMessage} />
        ) : navTab === 'memories' ? (
          <MemoryPage token={token} onToast={setToastMessage} />
        ) : navTab === 'settings' ? (
          <SettingsPage token={token} user={user} onToast={setToastMessage} onModelChange={setActiveModel} />
        ) : navTab === 'files' ? (
          <FileManager files={files} uploadingFile={uploadingFile} onUpload={handleFileUpload} onIndex={handleIndex} onPreview={handlePreviewFile} onDelete={handleDeleteFile} />
        ) : activeSessionId && activeSession ? (
          <>
            {/* Session topbar */}
            <header className="chat-header">
              {editingTitle ? (
                <form className="title-editor" onSubmit={(e) => { e.preventDefault(); handleTitleSave(); }}>
                  <input
                    ref={titleInputRef}
                    aria-label="会话标题"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingTitle(false); }}
                  />
                  <button type="submit" className="btn-small btn-small--primary">保存</button>
                  <button type="button" className="btn-small" onClick={() => setEditingTitle(false)}>取消</button>
                </form>
              ) : (
                <>
                  <div className="chat-title-group">
                    <h1>{activeSession.title}</h1>
                    <button type="button" className="chat-title-edit" aria-label="修改会话标题" onClick={() => { setTitleDraft(activeSession.title); setEditingTitle(true); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15Z" /></svg>
                    </button>
                  </div>
                </>
              )}
            </header>

            {/* Messages */}
            <div className="chat-thread">
              <div className="chat-scroll" ref={chatScrollRef} onScroll={updateReadingPosition}>
                <div className="chat-messages">
                  {messages.map((m, index) => (
                    <div className="chat-message-anchor" data-message-index={index} key={`${m.id}-${m.created_at}`}>
                      <MessageBubble message={m} onOpenCitation={handleOpenCitation} onOpenHistory={setHistoryMessageId} />
                    </div>
                  ))}
                  {streamingContent && (
                    <MessageBubble message={{ role: 'assistant', content: streamingContent }} streaming onOpenCitation={handleOpenCitation} />
                  )}
                  {streaming && !streamingContent && (
                    <div className="message message--assistant">
                      <div className="message-content"><span className="typing-indicator">{contextStage === 'preparing' || contextStage === 'compacting' ? '正在整理上下文…' : '正在生成回复…'}</span></div>
                    </div>
                  )}
                </div>
              </div>
              <ConversationTimeline turns={turns} activeTurn={activeTurn} onJump={jumpToTurn} />
            </div>

            {/* Input */}
            <ChatComposer
              key={activeSessionId}
              value={input}
              onChange={setInput}
              onSend={handleSend}
              streaming={streaming}
              model={activeModel}
              canChangeModel={Boolean(user.is_admin)}
              onSwitchModel={switchChatModel}
              contextControl={<ContextPanel key={activeSessionId} token={token} sessionId={activeSessionId} refreshKey={contextRefresh} stage={contextStage} messageId={historyMessageId} onCloseHistory={() => setHistoryMessageId(null)} />}
            />
          </>
        ) : (
          <div className="chat-empty">
            <p className="eyebrow">ArchMind</p>
            <h2>选择会话或新建会话开始问答</h2>
            <p>建议先上传并入库文件，再围绕资料内容提问；也可以直接询问天气、总结或报告相关问题。</p>
            <div className="empty-actions">
              <button className="btn-small btn-small--primary" onClick={async () => {
                if (!token) return;
                try {
                  const s = await createSession(token, DEFAULT_SESSION_TITLE);
                  if (!isTokenCurrent(token)) return;
                  setSessions((prev) => [s, ...prev]);
                  setActiveSessionId(s.id);
                  setMessages([]);
                } catch (err: unknown) {
                  setToastMessage(`创建会话失败：${parseApiError(err)}`);
                }
              }}>新建会话</button>
              <button className="btn-small" onClick={() => setNavTab('files')}>去上传文件</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
