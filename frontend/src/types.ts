export type User = {
  id: number;
  username: string;
  nickname: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type ChatSession = {
  id: number;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type SessionDetail = ChatSession & {
  messages: Message[];
};

export type SendMessageResponse = {
  session: ChatSession;
  messages: Message[];
};

export type UploadedFile = {
  id: number;
  user_id: number;
  filename: string;
  file_path: string;
  file_type: string;
  file_size: number;
  md5: string;
  status: 'uploaded' | 'indexing' | 'indexed' | 'failed';
  error_message: string;
  created_at: string;
  updated_at: string;
};

export type BackgroundJob = {
  id: number;
  user_id: number;
  job_type: string;
  target_type: string;
  target_id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  error_message: string;
  created_at: string;
  updated_at: string;
};

export type FileIndexResponse = {
  file: UploadedFile;
  chunk_count: number;
};

export type FileIndexTaskResponse = {
  file: UploadedFile;
  message: string;
  job: BackgroundJob | null;
};

export type FilePreviewResponse = {
  file: UploadedFile;
  content: string;
  truncated: boolean;
};

export type StreamEvent =
  | { type: 'message'; content: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; content: string }
  | { type: 'workflow_step'; name: string }
  | { type: 'error'; content: string }
  | { type: 'start' | 'done' };

export type SourceLookupResponse = {
  content: string;
  metadata: Record<string, unknown>;
};

export type Memory = {
  id: number;
  user_id: number;
  memory_type: string;
  content: string;
  weight: number;
  created_at: string;
  updated_at: string;
};

export type ModelSettings = {
  chat_provider: string;
  chat_model: string;
  embedding_provider: string;
  embedding_model: string;
  providers: Record<string, Record<string, unknown>>;
};

export type RagSettings = {
  k: number;
  chunk_size: number;
  chunk_overlap: number;
  separators: string[];
};

export type ReportGenerateRequest = {
  topic: string;
  period: string;
  focus: string;
};

export type Report = {
  id: number;
  user_id: number;
  title: string;
  period: string;
  focus: string;
  content: string;
  status: 'generating' | 'completed' | 'failed';
  error_message: string;
  created_at: string;
  updated_at: string;
};

export type ReportGenerateResponse = {
  report: Report;
  job: BackgroundJob | null;
};
