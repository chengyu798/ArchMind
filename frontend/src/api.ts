import type { BackgroundJob, ChatSession, FileIndexTaskResponse, FilePreviewResponse, Memory, ModelSettings, RagSettings, Report, ReportGenerateRequest, ReportGenerateResponse, SendMessageResponse, SessionDetail, SourceLookupResponse, StreamEvent, TokenResponse, UploadedFile, User } from './types';

export type { BackgroundJob, ChatSession, FilePreviewResponse, Memory, Message, ModelSettings, RagSettings, Report, ReportGenerateRequest, ReportGenerateResponse, SendMessageResponse, SessionDetail, SourceLookupResponse, StreamEvent, TokenResponse, UploadedFile, User } from './types';

const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `请求失败：${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function login(username: string, password: string) {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getMe(token: string) {
  return request<User>('/auth/me', {}, token);
}

export function createSession(token: string, title: string) {
  return request<ChatSession>('/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ title }),
  }, token);
}

export function listSessions(token: string) {
  return request<ChatSession[]>('/chat/sessions', {}, token);
}

export function getSession(token: string, sessionId: number) {
  return request<SessionDetail>(`/chat/sessions/${sessionId}`, {}, token);
}

export function deleteSession(token: string, sessionId: number) {
  return request<void>(`/chat/sessions/${sessionId}`, { method: 'DELETE' }, token);
}

export function updateSession(token: string, sessionId: number, title: string) {
  return request<ChatSession>(`/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  }, token);
}

export function sendMessage(token: string, sessionId: number, content: string) {
  return request<SendMessageResponse>(`/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  }, token);
}

export function uploadFile(token: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return request<UploadedFile>('/files/upload', {
    method: 'POST',
    body: formData,
  }, token);
}

export function listFiles(token: string) {
  return request<UploadedFile[]>('/files', {}, token);
}

export function indexFile(token: string, fileId: number) {
  return request<FileIndexTaskResponse>(`/files/${fileId}/index`, { method: 'POST' }, token);
}

export function deleteFile(token: string, fileId: number) {
  return request<void>(`/files/${fileId}`, { method: 'DELETE' }, token);
}

export function previewFile(token: string, fileId: number) {
  return request<FilePreviewResponse>(`/files/${fileId}/preview`, {}, token);
}

export function listReports(token: string) {
  return request<Report[]>('/reports', {}, token);
}

export function getReport(token: string, reportId: number) {
  return request<Report>(`/reports/${reportId}`, {}, token);
}

export function deleteReport(token: string, reportId: number) {
  return request<void>(`/reports/${reportId}`, { method: 'DELETE' }, token);
}

export function generateReport(token: string, payload: ReportGenerateRequest) {
  return request<ReportGenerateResponse>('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export function lookupSource(token: string, params: { filename?: string; location?: string; fileId?: number }) {
  const query = new URLSearchParams();
  if (params.filename) query.set('filename', params.filename);
  if (params.location) query.set('location', params.location);
  if (params.fileId) query.set('file_id', String(params.fileId));
  return request<SourceLookupResponse>(`/knowledge/sources/lookup?${query.toString()}`, {}, token);
}

export function listMemories(token: string) {
  return request<Memory[]>('/memories', {}, token);
}

export function createMemory(token: string, payload: { memory_type: string; content: string }) {
  return request<Memory>('/memories', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export function updateMemory(token: string, memoryId: number, payload: { memory_type: string; content: string }) {
  return request<Memory>(`/memories/${memoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, token);
}

export function deleteMemory(token: string, memoryId: number) {
  return request<void>(`/memories/${memoryId}`, { method: 'DELETE' }, token);
}

export function getModelSettings(token: string) {
  return request<ModelSettings>('/settings/model', {}, token);
}

export function updateModelSettings(token: string, payload: {
  chat_provider: string;
  chat_model: string;
  embedding_provider: string;
  embedding_model: string;
}) {
  return request<ModelSettings>('/settings/model', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, token);
}

export function getRagSettings(token: string) {
  return request<RagSettings>('/settings/rag', {}, token);
}

export function updateRagSettings(token: string, payload: {
  k: number;
  chunk_size: number;
  chunk_overlap: number;
}) {
  return request<RagSettings>('/settings/rag', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }, token);
}

export function getJob(token: string, jobId: number) {
  return request<BackgroundJob>(`/jobs/${jobId}`, {}, token);
}

export async function streamMessage(
  token: string,
  sessionId: number,
  content: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const eventLine = event.split('\n').find((line) => line.startsWith('event: '));
      const dataLine = event.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) {
        continue;
      }

      const type = (eventLine?.slice(7) || 'message') as StreamEvent['type'];
      const payload = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      if (type === 'message') {
        const content = typeof payload.content === 'string' ? payload.content : '';
        if (content) onEvent({ type, content });
      } else if (type === 'tool_call') {
        onEvent({ type, name: String(payload.name || '工具调用'), args: payload.args });
      } else if (type === 'tool_result') {
        onEvent({ type, name: String(payload.name || '工具结果'), content: String(payload.content || '') });
      } else if (type === 'workflow_step') {
        onEvent({ type, name: String(payload.name || 'workflow') });
      } else if (type === 'error') {
        onEvent({ type, content: String(payload.content || '生成回复失败') });
      } else if (type === 'start' || type === 'done') {
        onEvent({ type });
      }
    }
  }
}
