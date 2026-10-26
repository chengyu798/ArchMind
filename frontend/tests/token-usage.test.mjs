import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, cacheDir, TokenUsageFooter, MessageBubble, ChatComposer, streamMessage;
const originalFetch = globalThis.fetch;
before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'archmind-token-tests-'));
  server = await createServer({ cacheDir, optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false, ws: false } });
  ({ TokenUsageFooter } = await server.ssrLoadModule('/src/TokenUsageFooter.tsx'));
  ({ MessageBubble } = await server.ssrLoadModule('/src/App.tsx'));
  ({ ChatComposer } = await server.ssrLoadModule('/src/ChatComposer.tsx'));
  ({ streamMessage } = await server.ssrLoadModule('/src/api.ts'));
});
after(async () => { globalThis.fetch = originalFetch; await server?.close(); await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
const usage = { input_tokens: 1200, output_tokens: 30, total_tokens: 1230, model_calls: 2, reported_calls: 2 };
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

test('completed assistant response displays input, output and total usage', () => {
  const html = render(MessageBubble, { message: { role: 'assistant', content: '完成', token_usage: usage } });
  assert.match(html, /输入 1,200/); assert.match(html, /输出 30/); assert.match(html, /合计 1,230 Token/);
});
test('streaming and user messages do not show a completion footer', () => {
  for (const props of [{ message: { role: 'assistant', content: '生成中', token_usage: usage }, streaming: true }, { message: { role: 'user', content: '问题', token_usage: usage } }]) {
    assert.doesNotMatch(render(MessageBubble, props), /message-token-usage/);
  }
});
test('historical or incomplete usage is explicit and never estimated', () => {
  assert.match(render(TokenUsageFooter, {}), /Token 用量未记录/);
  const missing = render(TokenUsageFooter, { usage: { ...usage, input_tokens: null, output_tokens: null, total_tokens: null, reported_calls: 0 } });
  assert.match(missing, /服务商未返回完整用量/); assert.doesNotMatch(missing, /合计 0/);
  assert.match(render(TokenUsageFooter, { usage: { ...usage, input_tokens: 0, output_tokens: 0, total_tokens: 0 } }), /合计 0 Token/);
});
test('shortcut hint is removed while keyboard handlers remain available', () => {
  const html = render(ChatComposer, { value: '', onChange() {}, onSend() {}, streaming: false, model: null, canChangeModel: false, onSwitchModel: async () => {} });
  assert.doesNotMatch(html, /composer-shortcut|Enter 发送|Shift \+ Enter/);
  assert.match(html, /aria-label="输入问题"/); assert.match(html, /aria-label="发送消息"/);
});
test('SSE done event retains usage and message id across split network chunks', async () => {
  const events = [];
  const body = 'event: message\ndata: {"content":"完成"}\n\nevent: done\ndata: ' + JSON.stringify({ message_id: 17, token_usage: usage }) + '\n\n';
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(body); for (let index = 0; index < bytes.length; index += 11) controller.enqueue(bytes.slice(index, index + 11)); controller.close(); } }));
  await streamMessage('test', 1, 'test', (event) => events.push(event));
  assert.deepEqual(events, [{ type: 'message', content: '完成' }, { type: 'done', message_id: 17, token_usage: usage }]);
  globalThis.fetch = originalFetch;
});
test('SSE errors keep reported usage associated with the failed assistant message', async () => {
  const events = [];
  globalThis.fetch = async () => new Response('event: error\ndata: ' + JSON.stringify({ content: '生成错误', message_id: 18, token_usage: usage }) + '\n\n');
  await streamMessage('test', 1, 'test', (event) => events.push(event));
  assert.deepEqual(events[0], { type: 'error', content: '生成错误', message_id: 18, token_usage: usage }); globalThis.fetch = originalFetch;
});
