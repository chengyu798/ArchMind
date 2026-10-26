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

export type TokenUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  model_calls: number;
  reported_calls: number;
};

export type Message = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  token_usage?: TokenUsage | null;
  usage_breakdown?: { answer: TokenUsage | null; compaction: TokenUsage | null } | null;
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
  | { type: 'error'; content: string; message_id?: number; token_usage?: TokenUsage | null; usage_breakdown?: Message['usage_breakdown'] }
  | { type: 'done'; message_id?: number; token_usage?: TokenUsage | null; usage_breakdown?: Message['usage_breakdown'] }
  | { type: 'context_status'; stage: string; warning?: string | null }
  | { type: 'start' };

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
  providers: string[];
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


export type SummaryItem = {
  id: string; text: string; status: string; verification: string;
  source_message_ids: number[]; supersedes: string[];
  references: { file_id: number; chunk_index: number | null }[];
};
export type StructuredSummary = {
  goals: SummaryItem[]; constraints: SummaryItem[]; facts: SummaryItem[]; decisions: SummaryItem[];
  work_state: { completed: SummaryItem[]; pending: SummaryItem[]; open_questions: SummaryItem[] };
};
export type ContextSummary = {
  id: number; version: number; schema_version: number; status: string;
  covered_through_message_id: number; content: StructuredSummary | null;
  context_tokens_before: number; context_tokens_after: number; summary_tokens: number;
  generation_token_usage: TokenUsage | null; error_message: string; created_at: string;
};
export type ContextStatus = {
  capacity: number; input_tokens: number; occupancy: number; trigger_ratio: number;
  target_min_ratio: number; target_max_ratio: number; output_tokens: number; safety_tokens: number;
  token_count_method: string; processing: boolean;
  active_summary: ContextSummary | null; last_compaction: ContextSummary | null;
};
export type HistoryResult = { messages: Pick<Message, 'id' | 'role' | 'content' | 'created_at'>[]; tools: { id: number; name: string; result: string; status: string }[]; truncated: boolean };
