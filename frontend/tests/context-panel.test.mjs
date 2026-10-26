import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createElement as h, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let dom, server, cacheDir, root, host, createRoot, ContextPanel, TokenUsageFooter, streamMessage;
const originalFetch = globalThis.fetch;
const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15, model_calls: 1, reported_calls: 1 };
const item = { id: 'c1', text: '保留金额12345和原始记录', status: 'active', verification: 'user_confirmed', source_message_ids: [17], supersedes: [], references: [] };
const summary = { id: 1, version: 1, schema_version: 1, covered_through_message_id: 17, status: 'ready', summary_tokens: 500, context_tokens_before: 530000, context_tokens_after: 250000, generation_token_usage: usage, error_message: '', content: { goals: [item], constraints: [item], facts: [], decisions: [], work_state: { completed: [], pending: [], open_questions: [] } } };
const state = { capacity: 1048576, input_tokens: 250000, occupancy: 250000 / 1048576, trigger_ratio: .5, target_min_ratio: .2, target_max_ratio: .3, output_tokens: 65536, safety_tokens: 8192, active_summary: summary, last_compaction: summary, processing: false };
let calls;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  for (const name of ['window','document','HTMLElement','HTMLInputElement','Node','Element','Event','MouseEvent','KeyboardEvent','FocusEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  cacheDir = await mkdtemp(join(tmpdir(), 'archmind-context-tests-'));
  server = await createServer({ cacheDir, optimizeDeps: { noDiscovery: true, include: [], entries: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  ({ ContextPanel } = await server.ssrLoadModule('/src/ContextPanel.tsx'));
  ({ TokenUsageFooter } = await server.ssrLoadModule('/src/TokenUsageFooter.tsx'));
  ({ streamMessage } = await server.ssrLoadModule('/src/api.ts'));
});
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; host?.remove(); globalThis.fetch = originalFetch; });
after(async () => { await server?.close(); await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); dom.window.close(); });
function mock({ failHistory = false, context = state } = {}) {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/context/summaries')) return Response.json([summary, { ...summary, id: 2, version: 2, status: 'failed', content: null }]);
    if (url.endsWith('/context')) return Response.json(context);
    if (url.includes('/history?')) return failHistory ? new Response('failed', { status: 500 }) : Response.json({ messages: [{ id: 17, role: 'user', content: '原文金额12345 <script>unsafe()</script>', created_at: '2026-10-23' }], tools: [], truncated: false });
    throw new Error('unmocked URL: ' + url);
  };
}
async function mount(extra = {}) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(h(ContextPanel, { token: 'test', sessionId: 9, refreshKey: 0, stage: '', messageId: null, onCloseHistory() {}, ...extra }))); }
const button = (text) => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === text);
async function click(element) { assert.ok(element); await act(async () => { element.focus(); element.click(); }); }
async function fill(value) { const element = document.querySelector('input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }

test('context panel shows occupancy, reserve, structured groups and source metadata', async () => {
  mock(); await mount(); assert.match(document.body.textContent, /上下文 23\.8%/);
  await click(document.querySelector('[aria-label="查看上下文与摘要"]'));
  for (const text of ['1,048,576','65,536','8,192','当前目标','有效约束','关键事实','已确认决定','待办','待确认','用户确认']) assert.ok(document.body.textContent.includes(text), text);
  assert.ok(document.querySelector('[role="dialog"]')); assert.ok(calls.includes('/api/chat/sessions/9/context/summaries'));
});
test('source links open original messages; raw contents stay escaped', async () => {
  mock(); await mount(); await click(document.querySelector('[aria-label="查看上下文与摘要"]')); await click(button('原文 M17'));
  assert.ok(calls.includes('/api/chat/sessions/9/history?message_id=17'));
  assert.match(document.body.textContent, /原文金额12345/); assert.equal(document.querySelector('script'), null);
});
test('history search encodes the query and permits adjacent original expansion', async () => {
  mock(); await mount(); await click(document.querySelector('[aria-label="查看上下文与摘要"]')); await fill('金额 & 12345');
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.ok(calls.some((url) => url.includes('query=%E9%87%91%E9%A2%9D+%26+12345')));
  await click(button('M17 · 用户 · 查看邻近原文')); assert.ok(calls.some((url) => url.includes('message_id=17')));
});
test('Escape closes the modal and returns focus to its trigger', async () => {
  mock(); await mount(); const trigger = document.querySelector('[aria-label="查看上下文与摘要"]'); await click(trigger);
  await act(async () => document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(document.activeElement, trigger);
});
test('failed history request displays a retryable error without closing the panel', async () => {
  mock({ failHistory: true }); await mount(); await click(document.querySelector('[aria-label="查看上下文与摘要"]')); await click(button('原文 M17'));
  assert.match(document.querySelector('[role="alert"]').textContent, /历史记录加载失败/); assert.ok(document.querySelector('[role="dialog"]'));
});
test('uncompressed sessions show original-history state and current processing label', async () => {
  mock({ context: { ...state, active_summary: null, last_compaction: null } }); await mount({ stage: 'compacting' });
  assert.match(document.querySelector('[aria-label="查看上下文与摘要"]').textContent, /整理上下文/);
  await click(document.querySelector('[aria-label="查看上下文与摘要"]')); assert.match(document.body.textContent, /尚未生成摘要/);
});
test('external history citation opens the scoped history panel directly', async () => {
  mock(); await mount({ messageId: 17 }); assert.ok(document.querySelector('[role="dialog"]'));
  assert.ok(calls.includes('/api/chat/sessions/9/history?message_id=17'));
});
test('reply footer separates summary generation from answer usage', () => {
  const html = renderToStaticMarkup(h(TokenUsageFooter, { usage: { ...usage, total_tokens: 30 }, breakdown: { answer: usage, compaction: usage } }));
  assert.match(html, /合计 30 Token/); assert.match(html, /用量明细/); assert.match(html, /摘要生成：15 Token/);
});
test('SSE context progress is parsed without becoming assistant text', async () => {
  const events = []; globalThis.fetch = async () => new Response('event: context_status\ndata: {"stage":"compacting"}\n\nevent: message\ndata: {"content":"完成"}\n\n');
  await streamMessage('test', 9, 'test', (event) => events.push(event));
  assert.deepEqual(events, [{ type: 'context_status', stage: 'compacting', warning: undefined }, { type: 'message', content: '完成' }]);
});
test('SSE errors retain compaction costs when answer generation fails', async () => {
  const events = []; const breakdown = { answer: null, compaction: usage };
  globalThis.fetch = async () => new Response('event: error\ndata: ' + JSON.stringify({ content: '生成失败', message_id: 18, token_usage: usage, usage_breakdown: breakdown }) + '\n\n');
  await streamMessage('test', 9, 'test', (event) => events.push(event));
  assert.deepEqual(events[0].usage_breakdown, breakdown);
});
