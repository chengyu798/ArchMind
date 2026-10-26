import { useEffect, useRef, useState } from 'react';
import { getContextStatus, getContextSummaries, getConversationHistory } from './api';
import type { ContextStatus, ContextSummary, HistoryResult, SummaryItem } from './types';
import './ContextPanel.css';

type Props = { token: string; sessionId: number; refreshKey: number; stage: string; messageId: number | null; onCloseHistory: () => void };
const names = { active: '有效', completed: '已完成', superseded: '已替代', pending: '待处理' };
const verify = { user_confirmed: '用户确认', user_stated: '用户表述', tool_observed: '工具证据', assistant_inferred: '助手推断', unverified: '待确认' };

export function ContextPanel({ token, sessionId, refreshKey, stage, messageId, onCloseHistory }: Props) {
  const [status, setStatus] = useState<ContextStatus | null>(null);
  const [versions, setVersions] = useState<ContextSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [searching, setSearching] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const searchSequence = useRef(0);
  const format = (number: number) => number.toLocaleString('zh-CN');
  useEffect(() => {
    let valid = true;
    getContextStatus(token, sessionId).then((value) => { if (valid) { setStatus(value); setError(''); } }).catch(() => { if (valid) setError('上下文状态暂时无法加载，请稍后重试。'); });
    return () => { valid = false; };
  }, [token, sessionId, refreshKey]);
  useEffect(() => {
    if (!open) return;
    let valid = true;
    getContextSummaries(token, sessionId).then((value) => { if (valid) setVersions(value); }).catch(() => { if (valid) setError('摘要版本加载失败'); });
    return () => { valid = false; };
  }, [open, token, sessionId, refreshKey]);
  useEffect(() => {
    if (messageId === null) return;
    setOpen(true);
    const sequence = ++searchSequence.current; setSearching(true);
    getConversationHistory(token, sessionId, '', messageId).then((value) => { if (searchSequence.current === sequence) setHistory(value); }).catch(() => { if (searchSequence.current === sequence) setError('原始消息不存在或无法访问'); }).finally(() => { if (searchSequence.current === sequence) setSearching(false); });
    return () => { ++searchSequence.current; };
  }, [messageId, token, sessionId]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const focus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); };
    document.addEventListener('focusin', focus);
    return () => { document.removeEventListener('focusin', focus); previous?.isConnected && previous.focus(); };
  }, [open]);
  const close = () => { setOpen(false); onCloseHistory(); trigger.current?.focus(); };
  const search = async (id?: number) => {
    if (id === undefined && !query.trim()) return;
    const sequence = ++searchSequence.current; setSearching(true); setError('');
    try { const value = await getConversationHistory(token, sessionId, query.trim(), id); if (searchSequence.current === sequence) setHistory(value); }
    catch { if (searchSequence.current === sequence) setError('历史记录加载失败'); }
    finally { if (searchSequence.current === sequence) setSearching(false); }
  };
  const summary = versions.find((value) => value.version === selected) ?? status?.active_summary;
  const items = (label: string, values: SummaryItem[]) => <section className="context-summary-group" key={label}><h3>{label}</h3>{values.length ? values.map((item) => <div className={`context-summary-item ${item.status === 'superseded' ? 'is-superseded' : ''}`} key={item.id}><p>{item.text}</p><div className="context-item-meta"><span>{names[item.status as keyof typeof names] ?? item.status} · {verify[item.verification as keyof typeof verify] ?? item.verification}</span>{item.source_message_ids.slice(0, 3).map((id) => <button type="button" key={id} onClick={() => search(id)}>原文 M{id}</button>)}{item.source_message_ids.length > 3 && <details><summary>更多来源（{item.source_message_ids.length - 3}）</summary>{item.source_message_ids.slice(3).map((id) => <button type="button" key={id} onClick={() => search(id)}>原文 M{id}</button>)}</details>}</div></div>) : <p className="context-muted">暂无</p>}</section>;
  return (
    <div className="context-control">
      <button type="button" ref={trigger} className="context-trigger" aria-label="查看上下文与摘要" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="context-indicator" aria-hidden="true" />{stage === 'compacting' || stage === 'preparing' ? '整理上下文…' : status ? `上下文 ${(status.occupancy * 100).toFixed(1)}%` : '上下文'}
      </button>
      {open && <div className="context-backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialog} className="context-dialog" role="dialog" aria-modal="true" aria-label="会话上下文" onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); close(); }
          if (event.key === 'Tab') {
            const elements = dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input');
            const first = elements[0], last = elements[elements.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
          <header><div><h2>会话上下文</h2><p>50% 触发整理，目标占用 20%～30%；原始记录始终保留。</p></div><button type="button" className="btn-small" aria-label="关闭上下文面板" onClick={close}>关闭</button></header>
          <div className="context-dialog-body">
            {error && <p className="context-error" role="alert">{error}</p>}
            {status && <section className="context-budget"><div><strong>{format(status.input_tokens)} / {format(status.capacity)} Token</strong><span>{(status.occupancy * 100).toFixed(1)}%</span></div><progress value={status.occupancy} max={1} aria-label="上下文占用" /><p>输入为本地估算；另预留输出 {format(status.output_tokens)}、安全余量 {format(status.safety_tokens)} Token。消耗统计以服务商返回为准。</p></section>}
            {status?.last_compaction?.status === 'failed' && <p className="context-error">最近一次整理未生效：{status.last_compaction.error_message}</p>}
            <div className="context-section-heading"><h3>结构化摘要</h3>{versions.length > 0 && <div className="context-versions">{versions.map((version) => <button type="button" key={version.id} className={`btn-small ${summary?.version === version.version ? 'btn-small--primary' : ''}`} onClick={() => setSelected(version.version)}>第 {version.version} 版 · {version.status === 'ready' ? '已生成' : version.status === 'failed' ? '失败' : version.status === 'invalidated' ? '已失效' : '生成中'}</button>)}</div>}</div>
            {summary?.content ? <><p className="context-muted">覆盖至消息 M{summary.covered_through_message_id} · 摘要 {format(summary.summary_tokens)} Token · 整理前 {format(summary.context_tokens_before)} → 后 {format(summary.context_tokens_after)}</p>{summary.generation_token_usage && <p className="context-muted">摘要生成消耗：输入 {summary.generation_token_usage.input_tokens ?? '—'} / 输出 {summary.generation_token_usage.output_tokens ?? '—'} / 合计 {summary.generation_token_usage.total_tokens ?? '—'} Token</p>}{items('当前目标', summary.content.goals)}{items('有效约束', summary.content.constraints)}{items('关键事实', summary.content.facts)}{items('已确认决定', summary.content.decisions)}{items('已完成', summary.content.work_state.completed)}{items('待办', summary.content.work_state.pending)}{items('待确认', summary.content.work_state.open_questions)}</> : <p className="context-empty">尚未生成摘要，当前会话使用原始对话。</p>}
            <section className="context-history"><h3>历史原文回查</h3><form onSubmit={(event) => { event.preventDefault(); void search(); }}><input aria-label="历史检索关键词" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词，查找原始对话" /><button type="submit" className="btn-small" disabled={searching || !query.trim()}>{searching ? '查询中…' : '搜索'}</button></form>
              {history && <>{history.messages.length === 0 && <p className="context-muted">没有找到匹配的记录。</p>}{history.messages.map((message) => <article className="context-history-message" key={message.id}><button type="button" className="btn-link" onClick={() => search(message.id)}>M{message.id} · {message.role === 'user' ? '用户' : '助手'} · 查看邻近原文</button><p>{message.content}</p></article>)}{history.tools.map((tool) => <details key={tool.id}><summary>工具证据：{tool.name} · {tool.status}</summary><pre>{tool.result}</pre></details>)}{history.truncated && <p className="context-muted">结果已按预算截取，点击消息编号查看原文。</p>}</>}
            </section>
          </div>
        </div>
      </div>}
    </div>
  );
}
