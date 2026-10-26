import type { TokenUsage, Message } from './types';
import './TokenUsageFooter.css';

export function TokenUsageFooter({ usage, breakdown }: { usage?: TokenUsage | null; breakdown?: Message['usage_breakdown'] }) {
  if (!usage) return <div className="message-token-usage" aria-label="Token 用量">Token 用量未记录</div>;
  const format = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN');
  const incomplete = [usage.input_tokens, usage.output_tokens, usage.total_tokens].some((value) => value == null);
  return (
    <div className="message-token-usage" aria-label="Token 用量">
      <span>输入 {format(usage.input_tokens)}</span>
      <span>输出 {format(usage.output_tokens)}</span>
      <span>合计 {format(usage.total_tokens)} Token</span>
      {breakdown?.compaction && <details><summary>用量明细</summary><p>聊天调用：{format(breakdown.answer?.total_tokens ?? null)} Token · 摘要生成：{format(breakdown.compaction.total_tokens)} Token</p></details>}
      {incomplete && <span>服务商未返回完整用量</span>}
    </div>
  );
}
