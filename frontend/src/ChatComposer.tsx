import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './ChatComposer.css';
import { SelectField } from './UIControls';
import type { ModelSettings } from './types';

type ChatComposerProps = {
  contextControl?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  streaming: boolean;
  model: ModelSettings | null;
  canChangeModel: boolean;
  onSwitchModel: (provider: string, name: string) => Promise<void>;
};

export function ChatComposer({ value, onChange, onSend, streaming, model, canChangeModel, onSwitchModel, contextControl }: ChatComposerProps) {
  const [expanded, setExpanded] = useState(false);
  const [provider, setProvider] = useState('');
  const [modelName, setModelName] = useState('');
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerId = useId();

  useEffect(() => {
    setProvider(model?.chat_provider ?? '');
    setModelName(model?.chat_model ?? '');
  }, [model]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && !pickerRef.current?.contains(event.target) && !event.target.closest('[data-ui-select-popup]')) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded]);

  const send = () => {
    if (streaming || switching || !value.trim()) return;
    setExpanded(false);
    onSend();
  };

  const switchModel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canChangeModel || switching || !provider || !modelName.trim()) return;
    setSwitching(true);
    setError('');
    try {
      await onSwitchModel(provider, modelName.trim());
      setExpanded(false);
      triggerRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '模型切换失败，请重试。');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="chat-input-bar">
      <div className="chat-composer">
        <textarea
          ref={inputRef}
          aria-label="输入问题"
          placeholder="输入问题，基于知识库文件回答…"
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          disabled={streaming}
        />
        <div className="composer-toolbar">
          <div className="composer-controls">
          <div className="composer-model-picker" ref={pickerRef}>
            <button
              ref={triggerRef}
              type="button"
              className={`composer-model-trigger ${expanded ? 'is-expanded' : ''}`}
              aria-label={`选择聊天模型，当前：${model?.chat_model ?? '加载中'}`}
              aria-expanded={expanded}
              aria-controls={pickerId}
              aria-haspopup="dialog"
              disabled={!model || streaming || switching}
              onClick={() => { setExpanded((current) => !current); setError(''); }}
            >
              <span className="composer-model-dot" aria-hidden="true" />
              <span className="composer-model-name">{model?.chat_model ?? '加载模型…'}</span>
              <svg className="composer-model-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {expanded && (
              <section id={pickerId} className="composer-model-panel" role="dialog" aria-label="切换聊天模型">
                <div className="composer-model-heading">
                  <strong>聊天模型</strong>
                  <button type="button" className="composer-model-close" aria-label="收起模型选择" onClick={() => { setExpanded(false); triggerRef.current?.focus(); }}>×</button>
                </div>
                {canChangeModel ? (
                  <form onSubmit={switchModel}>
                    <label><span>模型服务商</span><SelectField label="模型服务商" value={provider} onChange={setProvider} disabled={switching} options={(Array.isArray(model?.providers) ? model.providers : Object.keys(model?.providers ?? {})).map((name) => ({ value: name, label: name }))} /></label>
                    <label><span>模型名称</span><input value={modelName} onChange={(event) => setModelName(event.target.value)} disabled={switching} required /></label>
                    <p>验证成功后立即切换，对所有用户生效。</p>
                    {error && <p className="composer-model-error" role="alert">{error}</p>}
                    <button type="submit" className="btn-small btn-small--primary" disabled={switching || !provider || !modelName.trim()}>{switching ? '验证并切换中…' : '切换模型'}</button>
                  </form>
                ) : <p>当前模型由管理员设置。</p>}
              </section>
            )}
          </div>
          {contextControl}
          </div>
          <div className="composer-send-actions">
            <button type="button" className="composer-send" aria-label={streaming ? '正在生成回复' : '发送消息'} disabled={streaming || switching || !value.trim()} onClick={send}>
              {streaming ? <span aria-hidden="true">···</span> : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
