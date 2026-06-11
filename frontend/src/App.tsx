import { useEffect, useRef, useState } from 'react';
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

const DEFAULT_SESSION_TITLE = '新会话';
const STREAM_INTERVAL_MS = 32;
const INDEXABLE_FILE_ACCEPT = '.txt,.md,.pdf,.csv,.docx,.pptx';
const MEMORY_TYPE_OPTIONS = ['preference', 'focus', 'profile', 'constraint'];

type NavTab = 'sessions' | 'files' | 'reports' | 'memories' | 'settings';

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

function MessageBubble({ message, streaming = false, onOpenCitation }: { message: Pick<Message, 'role' | 'content'>; streaming?: boolean; onOpenCitation?: (citation: Citation) => void }) {
  const parsed = message.role === 'assistant' ? parseMessageContent(message.content) : { body: message.content, citations: [] };
  return (
    <div className={`message message--${message.role}`}>
      <div className="message-content">
        <span>{parsed.body}</span>
        {streaming && <span className="stream-cursor" aria-hidden="true" />}
      </div>
      <CitationList citations={parsed.citations} onOpen={onOpenCitation} />
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
    if (!window.confirm('确定删除这条长期记忆吗？')) return;
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
      <div className="page-header">
        <div>
          <p className="eyebrow">Memory</p>
          <h1>长期记忆管理</h1>
          <p>查看、编辑或删除 Agent 从对话中沉淀的用户偏好和关注点。</p>
        </div>
        <button type="button" className="btn-small btn-small--primary" onClick={loadMemories} disabled={loading}>刷新</button>
      </div>

      <div className="memory-list-card">
        <form className="memory-item memory-create" onSubmit={addMemory}>
          <div className="memory-item-header">
            <span>新增记忆</span>
            <small>手动补充偏好或关注点</small>
          </div>
          <select aria-label="新记忆类型" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {MEMORY_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <textarea aria-label="新记忆内容" value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={3} placeholder="例如：回答时优先给出可执行步骤" />
          <div className="memory-actions">
            <button type="submit" className="btn-small btn-small--primary">新增</button>
          </div>
        </form>
        {memories.length === 0 ? (
          <div className="empty-state">
            <h2>{loading ? '正在加载记忆' : '暂无长期记忆'}</h2>
            <p>当你表达偏好、关注点或后续要求时，系统会自动沉淀为长期记忆。</p>
          </div>
        ) : memories.map((memory) => (
          <article key={memory.id} className="memory-item">
            {editingId === memory.id ? (
              <>
                <select aria-label="记忆类型" value={draftType} onChange={(e) => setDraftType(e.target.value)}>
                  {MEMORY_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <textarea aria-label="记忆内容" value={draftContent} onChange={(e) => setDraftContent(e.target.value)} rows={3} />
                <div className="memory-actions">
                  <button type="button" className="btn-small btn-small--primary" onClick={() => saveMemory(memory.id)}>保存</button>
                  <button type="button" className="btn-small" onClick={() => setEditingId(null)}>取消</button>
                </div>
              </>
            ) : (
              <>
                <div className="memory-item-header">
                  <span>{memory.memory_type}</span>
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
    </section>
  );
}

function SettingsPage({ token, user, onToast }: { token: string; user: User; onToast: (message: string) => void }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [ragSettings, setRagSettings] = useState<RagSettings | null>(null);
  const [chatProvider, setChatProvider] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [embeddingProvider, setEmbeddingProvider] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
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
        setChatProvider(nextSettings.chat_provider);
        setChatModel(nextSettings.chat_model);
        setEmbeddingProvider(nextSettings.embedding_provider);
        setEmbeddingModel(nextSettings.embedding_model);
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

  const providerNames = Object.keys(settings?.providers ?? {});
  const embeddingProviderNames = providerNames.filter((provider) => ['dashscope', 'ollama'].includes(provider));

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
        embedding_provider: embeddingProvider,
        embedding_model: embeddingModel.trim(),
      });
      if (isTokenCurrent(token)) {
        setSettings(updated);
        onToast('模型设置已保存，重启后生效');
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
          <p>配置云端或本地 Ollama 模型；当前进程中的模型实例需要重启后才会切换。</p>
          {!user.is_admin && <p className="settings-note">当前账号不是管理员，只能查看全局设置。</p>}
        </div>
      </div>

      <div className="settings-panels">
        <form className="settings-form" onSubmit={saveSettings}>
          <div className="settings-section-title">
            <strong>模型设置</strong>
            <span>切换聊天模型和 embedding 模型，保存后重启服务生效。</span>
          </div>
          <label>
            <span>聊天 Provider</span>
            <select value={chatProvider} onChange={(e) => setChatProvider(e.target.value)}>
              {providerNames.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <label>
            <span>聊天模型</span>
            <input value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder="例如 deepseek-v4-flash / qwen2.5" />
          </label>
          <label>
            <span>Embedding Provider</span>
            <select value={embeddingProvider} onChange={(e) => setEmbeddingProvider(e.target.value)}>
              {embeddingProviderNames.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </label>
          <label>
            <span>Embedding 模型</span>
            <input value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)} placeholder="例如 text-embedding-v4 / nomic-embed-text" />
          </label>
          <div className="settings-note">
            Ollama 使用本机服务地址：{String(settings?.providers?.ollama?.base_url ?? 'http://localhost:11434')}；DeepSeek 当前仅支持聊天模型。
          </div>
          <button type="submit" className="btn-primary" disabled={saving || !settings || !user.is_admin}>{saving ? '保存中…' : '保存模型设置'}</button>
        </form>

        <form className="settings-form" onSubmit={saveRagSettings}>
          <div className="settings-section-title">
            <strong>检索参数</strong>
            <span>调整召回数量和切片大小；切片参数需要重新入库后才会完全生效。</span>
          </div>
          <label>
            <span>召回数量 k</span>
            <input type="number" min="1" max="20" value={ragK} onChange={(e) => setRagK(Number(e.target.value))} />
          </label>
          <label>
            <span>切片长度 chunk_size</span>
            <input type="number" min="100" max="3000" value={chunkSize} onChange={(e) => setChunkSize(Number(e.target.value))} />
          </label>
          <label>
            <span>切片重叠 chunk_overlap</span>
            <input type="number" min="0" max="1000" value={chunkOverlap} onChange={(e) => setChunkOverlap(Number(e.target.value))} />
          </label>
          <div className="settings-note">
            当前分隔符数量：{ragSettings?.separators.length ?? 0}；保存后新检索会使用新的 k，已入库切片需要重建索引才会按新 chunk 参数切分。
          </div>
          <button type="submit" className="btn-primary" disabled={savingRag || !ragSettings || !user.is_admin}>{savingRag ? '保存中…' : '保存检索参数'}</button>
        </form>
      </div>
    </section>
  );
}

function ReportPage({ token, onToast }: { token: string; onToast: (message: string) => void }) {
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
    if (!window.confirm('确定删除这份报告吗？')) return;
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
            <button type="submit" className="btn-primary" disabled={generating}>
              {generating ? '生成中…' : '生成报告'}
            </button>
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
  const [token, setToken] = useToken();
  const [user, setUser] = useState<User | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<UploadedFile[]>([]);

  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  const switchSession = async (id: number) => {
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
    stopStreamTimer();
    streamBufferRef.current = '';
    streamVisibleRef.current = '';
    setInput('');
    setStreaming(true);
    setStreamingContent('');
    startStreamTimer();

    const userMsg: Message = { id: -1, session_id: sessionId, role: 'user', content, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);

    let fullContent = '';
    try {
      await streamMessage(t, sessionId, content, (event: StreamEvent) => {
        if (!isTokenCurrent(t)) return;
        if (event.type === 'message') {
          fullContent += event.content;
          streamBufferRef.current += event.content;
        } else if (event.type === 'error') {
          streamBufferRef.current += event.content;
          fullContent += event.content;
        }
      });

      await waitForStreamReveal();
      if (!isTokenCurrent(t)) return;
      setMessages((prev) => [...prev, { id: -2, session_id: sessionId, role: 'assistant', content: fullContent, created_at: new Date().toISOString() }]);
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
    if (!token || !window.confirm('确定删除这个文件吗？')) return;
    const currentToken = token;
    await deleteFile(currentToken, fileId);
    if (isTokenCurrent(currentToken)) {
      loadFiles(currentToken);
      setToastMessage('文件已删除');
    }
  };

  const handleDeleteSession = async (sessionId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token || !window.confirm('确定删除这个会话吗？')) return;
    const currentToken = token;
    await deleteSession(currentToken, sessionId);
    if (!isTokenCurrent(currentToken)) return;
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
    loadSessions(currentToken);
  };

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingContent]);

  if (!token || !user) {
    return <Login onLogin={setToken} token={token} />;
  }

  const filesCount = `${files.filter(f => f.status === 'indexed').length}/${files.length}`;

  return (
    <div className="app-layout">
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

        <button className="btn-new-session" onClick={async () => {
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
            <button
              key={s.id}
              className={`sidebar-item ${s.id === activeSessionId && navTab === 'sessions' ? 'active' : ''}`}
              onClick={() => switchSession(s.id)}
            >
              <span className="sidebar-item-title">{s.title}</span>
              <span className="sidebar-item-date">{new Date(s.updated_at).toLocaleDateString('zh-CN')}</span>
              <span className="btn-delete-session" onClick={(e) => handleDeleteSession(s.id, e)} title="删除会话" aria-label="删除会话">&times;</span>
            </button>
          ))}
          {sessions.length === 0 && <p className="sidebar-empty">暂无会话，点击上方按钮创建</p>}
        </div>

        <nav className="sidebar-nav">
          <button className={`sidebar-link ${navTab === 'files' ? 'active' : ''}`} onClick={() => setNavTab('files')}>
            文件管理 <span className="sidebar-link-badge">{filesCount} 已索引</span>
          </button>
          <button className={`sidebar-link ${navTab === 'reports' ? 'active' : ''}`} onClick={() => setNavTab('reports')}>
            报告中心
          </button>
          <button className={`sidebar-link ${navTab === 'memories' ? 'active' : ''}`} onClick={() => setNavTab('memories')}>
            长期记忆
          </button>
          <button className={`sidebar-link ${navTab === 'settings' ? 'active' : ''}`} onClick={() => setNavTab('settings')}>
            系统设置
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">{user.nickname.charAt(0).toUpperCase()}</div>
          <div>
            <div className="sidebar-user-name">{user.nickname}</div>
            <div className="sidebar-user-role">{user.is_admin ? '管理员' : '普通用户'}</div>
          </div>
          <button className="btn-logout" style={{marginLeft: 'auto'}} onClick={() => { resetState(); setToken(null); }}>退出</button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-area">
        {navTab === 'reports' ? (
          <ReportPage token={token} onToast={setToastMessage} />
        ) : navTab === 'memories' ? (
          <MemoryPage token={token} onToast={setToastMessage} />
        ) : navTab === 'settings' ? (
          <SettingsPage token={token} user={user} onToast={setToastMessage} />
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
                  <h1>{activeSession.title}</h1>
                  <span className="topbar-badge">{messages.length} 条消息</span>
                  <button className="topbar-btn" onClick={() => { setTitleDraft(activeSession.title); setEditingTitle(true); }}>编辑标题</button>
                </>
              )}
            </header>

            {/* Info strip */}
            <div className="info-strip">
              <div className="info-strip-item">
                <span className="info-strip-dot" />
                模型 <span className="info-strip-val">deepseek-v4</span>
              </div>
              <div className="info-strip-item">
                消息 <span className="info-strip-val">{messages.length}</span>
              </div>
            </div>

            {/* Messages */}
            <div className="chat-messages">
              {messages.map((m) => (
                <MessageBubble key={`${m.id}-${m.created_at}`} message={m} onOpenCitation={handleOpenCitation} />
              ))}
              {streamingContent && (
                <MessageBubble message={{ role: 'assistant', content: streamingContent }} streaming onOpenCitation={handleOpenCitation} />
              )}
              {streaming && !streamingContent && (
                <div className="message message--assistant">
                  <div className="message-content"><span className="typing-indicator">正在检索知识库…</span></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="chat-input-bar">
              <input
                placeholder="输入问题，基于知识库文件回答… Enter 发送"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                disabled={streaming}
              />
              <button type="button" className="btn-send" disabled={streaming || !input.trim()} onClick={handleSend}>
                {streaming ? '生成中' : '发送'}
              </button>
            </div>
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
