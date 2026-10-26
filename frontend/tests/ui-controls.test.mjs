import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { createElement as h, useState, act } from 'react';

let dom, server, cacheDir, root, host, createRoot, SelectField, NumberField, useConfirmDialog, ChatComposer, App;
const nativeFetch = globalThis.fetch;
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'localStorage']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: true });
  ({ createRoot } = await import('react-dom/client'));
  cacheDir = await mkdtemp(join(tmpdir(), 'archmind-ui-tests-'));
  server = await createServer({ cacheDir, server: { middlewareMode: true, hmr: false, ws: false } });
  ({ SelectField, NumberField, useConfirmDialog } = await server.ssrLoadModule('/src/UIControls.tsx'));
  ({ ChatComposer } = await server.ssrLoadModule('/src/ChatComposer.tsx'));
  ({ App } = await server.ssrLoadModule('/src/App.tsx'));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; host?.remove(); localStorage.clear(); globalThis.fetch = nativeFetch;
  assert.equal(document.querySelectorAll('[role="listbox"], [role="alertdialog"]').length, 0, 'portals cleaned up');
});
after(async () => { await server?.close(); await rm(cacheDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); dom.window.close(); });
async function mount(element) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(element)); }
async function click(element) { assert.ok(element, 'click target exists'); await act(async () => { element.focus(); element.click(); }); }
async function key(element, name, extra = {}) { await act(async () => element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }))); }
async function fill(element, value) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function navigate(name) { await click(document.querySelector('[aria-label="打开用户菜单"]')); await click(button(name)); }
const button = (name) => [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === name);
const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }];
function Selector({ disabled = false, onChange = () => {} }) {
  const [value, setValue] = useState('a');
  return h(SelectField, { label: '测试选项', value, options, disabled, onChange: (next) => { setValue(next); onChange(next); } });
}

test('custom select supports arrows, Home/End, Enter, and selected semantics', async () => {
  await mount(h(Selector)); const trigger = document.querySelector('[role="combobox"]');
  await click(trigger); await key(trigger, 'End'); await key(trigger, 'Enter');
  assert.equal(trigger.textContent, 'Gamma'); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await key(trigger, 'ArrowUp'); await key(trigger, 'Home'); await key(trigger, 'ArrowDown'); await key(trigger, 'Enter');
  assert.equal(trigger.textContent, 'Beta'); assert.equal(document.activeElement, trigger);
  await click(trigger); assert.equal(document.querySelector('[aria-selected="true"]').textContent, 'Beta✓');
});
test('Escape and outside pointer dismiss without changing the selection; disabled cannot open', async () => {
  const changed = []; await mount(h(Selector, { onChange: (value) => changed.push(value) }));
  const trigger = document.querySelector('[role="combobox"]');
  await click(trigger); await key(trigger, 'ArrowDown'); await key(trigger, 'Escape');
  assert.equal(document.querySelector('[role="listbox"]'), null); assert.deepEqual(changed, []);
  await click(trigger); await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await act(async () => root.render(h(Selector, { disabled: true }))); await click(trigger);
  assert.equal(trigger.disabled, true); assert.equal(document.querySelector('[role="listbox"]'), null);
});
test('typeahead and portalled mouse selection preserve form focus without submitting', async () => {
  await mount(h(Selector)); const trigger = document.querySelector('[role="combobox"]'); trigger.focus();
  await key(trigger, 'b'); await key(trigger, 'Enter'); assert.equal(trigger.textContent, 'Beta');
  await click(trigger); await click(document.querySelector('[role="option"]'));
  assert.equal(trigger.textContent, 'Alpha'); assert.equal(document.activeElement, trigger);
});
test('number control enforces bounds on blur, keyboard, and buttons', async () => {
  function Counter() { const [value, onChange] = useState(3); return h(NumberField, { label: '数量', value, onChange, min: 1, max: 5 }); }
  await mount(h(Counter)); const input = document.querySelector('input');
  await fill(input, '99'); await act(async () => { input.focus(); input.blur(); }); assert.equal(input.value, '5');
  assert.equal(document.querySelector('[aria-label="增加数量"]').disabled, true);
  await key(input, 'ArrowDown'); assert.equal(input.value, '4');
  await fill(input, '0'); await act(async () => { input.focus(); input.blur(); }); assert.equal(input.value, '1');
  await click(document.querySelector('[aria-label="减少数量"]')); assert.equal(input.value, '1');
  await fill(input, ''); await act(async () => { input.focus(); input.blur(); }); assert.equal(input.value, '1');
});
function Confirmation({ onResult }) {
  const { confirm, confirmDialog } = useConfirmDialog();
  return h('div', null, h('button', { onClick: async () => onResult(await confirm({ title: '删除测试记录？', description: '仅测试数据。' })) }, '打开确认'), confirmDialog);
}
test('confirmation initially focuses Cancel, traps Tab, cancels on Escape and restores focus', async () => {
  const results = []; await mount(h(Confirmation, { onResult: (value) => results.push(value) }));
  const opener = button('打开确认'); await click(opener);
  assert.equal(document.activeElement, button('取消'));
  await key(button('取消'), 'Tab', { shiftKey: true }); assert.equal(document.activeElement, button('确认删除'));
  await key(button('确认删除'), 'Tab'); assert.equal(document.activeElement, button('取消'));
  await key(button('取消'), 'Escape'); assert.deepEqual(results, [false]); assert.equal(document.activeElement, opener);
});
test('confirmation calls the caller only after explicit confirm; backdrop cancels', async () => {
  const results = []; await mount(h(Confirmation, { onResult: (value) => results.push(value) }));
  await click(button('打开确认')); assert.deepEqual(results, []);
  await click(button('确认删除')); assert.deepEqual(results, [true]);
  await click(button('打开确认')); await click(document.querySelector('.ui-dialog-backdrop')); assert.deepEqual(results, [true, false]);
});
test('unmount cancels a pending confirmation instead of leaving an unresolved promise', async () => {
  const results = []; await mount(h(Confirmation, { onResult: (value) => results.push(value) }));
  await click(button('打开确认')); await act(async () => root.render(h('div'))); assert.deepEqual(results, [false]);
});
const model = { chat_provider: 'deepseek', chat_model: 'test-chat', providers: ['dashscope', 'deepseek', 'ollama'] };
test('composer provider menu stays open through portal selection and Escape closes only nested menu', async () => {
  const calls = []; await mount(h(ChatComposer, { value: '', onChange() {}, onSend() {}, streaming: false, model, canChangeModel: true, onSwitchModel: async (...args) => calls.push(args) }));
  await click(document.querySelector('.composer-model-trigger'));
  const trigger = document.querySelector('[role="combobox"]'); await click(trigger);
  const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent.includes('ollama'));
  await act(async () => option.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
  await click(option); assert.ok(document.querySelector('.composer-model-panel')); assert.equal(trigger.textContent, 'ollama');
  await click(trigger); await key(trigger, 'Escape'); assert.ok(document.querySelector('.composer-model-panel')); assert.equal(document.querySelector('[role="listbox"]'), null);
  await act(async () => document.querySelector('.composer-model-panel form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(calls, [['ollama', 'test-chat']]); assert.equal(document.querySelector('.composer-model-panel'), null);
});
test('composer failed model switch remains editable and shows the error', async () => {
  await mount(h(ChatComposer, { value: '', onChange() {}, onSend() {}, streaming: false, model, canChangeModel: true, onSwitchModel: async () => { throw new Error('测试连接失败'); } }));
  await click(document.querySelector('.composer-model-trigger'));
  await act(async () => document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(document.querySelector('[role="alert"]').textContent, '测试连接失败'); assert.equal(button('切换模型').disabled, false);
});

function mockApi({ admin = true, failDelete = false } = {}) {
  const time = '2026-10-23T10:00:00Z'; const calls = [];
  const session = { id: 1, user_id: 1, title: '测试会话', created_at: time, updated_at: time };
  const fixtures = {
    '/api/auth/me': { id: 1, username: 'test', nickname: '测试用户', is_admin: admin, created_at: time },
    '/api/chat/sessions': [session], '/api/chat/sessions/1': { ...session, messages: [] },
    '/api/files': [{ id: 2, filename: 'test.txt', file_type: 'txt', file_size: 10, status: 'indexed', created_at: time, updated_at: time }],
    '/api/memories': [{ id: 3, memory_type: 'preference', content: '测试偏好', weight: 1, updated_at: time }],
    '/api/memories/3': { id: 3, memory_type: 'preference', content: '测试偏好', weight: 1, updated_at: time },
    '/api/reports': [{ id: 4, title: '测试报告', period: '本月', content: '测试内容', status: 'completed', created_at: time }],
    '/api/settings/model': { ...model, embedding_provider: 'dashscope', embedding_model: 'test-embedding' },
    '/api/settings/rag': { k: 3, chunk_size: 200, chunk_overlap: 20, separators: [] },
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (init.method === 'DELETE') return failDelete ? new Response('{"detail":"测试拒绝删除"}', { status: 500 }) : new Response(null, { status: 204 });
    if (init.method === 'PATCH') return Response.json({ ...fixtures[url], ...JSON.parse(init.body) });
    assert.ok(url in fixtures, `mock fixture for ${url}`); return Response.json(fixtures[url]);
  };
  localStorage.setItem('token', 'test-token'); return calls;
}
test('all four delete paths cancel without issuing DELETE; session buttons are separate', async () => {
  const calls = mockApi(); await mount(h(App));
  const removeSession = document.querySelector('[aria-label="删除会话：测试会话"]');
  assert.equal(removeSession.parentElement.tagName, 'DIV'); await click(removeSession); await click(button('取消'));
  for (const page of ['文档管理', '长期记忆', '报告生成']) {
    await navigate(page); await click(button('删除')); assert.ok(document.querySelector('[role="alertdialog"]')); await click(button('取消'));
  }
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0);
});
test('confirmed session deletion sends exactly one DELETE and reports API errors', async () => {
  const calls = mockApi({ failDelete: true }); await mount(h(App));
  await click(document.querySelector('[aria-label="删除会话：测试会话"]')); await click(button('确认删除'));
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1); assert.match(document.body.textContent, /会话删除失败：测试拒绝删除/);
  assert.ok(document.querySelector('[aria-label="删除会话：测试会话"]'));
});
test('ordinary users cannot edit provider or retrieval controls', async () => {
  mockApi({ admin: false }); await mount(h(App)); await navigate('系统设置');
  assert.ok([...document.querySelectorAll('[role="combobox"], [role="spinbutton"], .ui-number button')].every((element) => element.disabled));
  assert.equal(button('保存检索参数').disabled, true); assert.equal(document.querySelector('select'), null);
});
test('retrieval save uses custom number values and preserves the API payload', async () => {
  const calls = mockApi(); await mount(h(App)); await navigate('系统设置');
  await click(document.querySelector('[aria-label="增加召回数量 k"]'));
  await act(async () => button('保存检索参数').closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const saved = calls.find((call) => call.url === '/api/settings/rag' && call.method === 'PATCH');
  assert.deepEqual(JSON.parse(saved.body), { k: 4, chunk_size: 200, chunk_overlap: 20 });
});

test('all four confirmed delete actions target the correct API resource', async () => {
  const calls = mockApi(); await mount(h(App));
  await click(document.querySelector('[aria-label="删除会话：测试会话"]')); await click(button('确认删除'));
  for (const page of ['文档管理', '长期记忆', '报告生成']) {
    await navigate(page); await click(button('删除')); await click(button('确认删除'));
  }
  assert.deepEqual(calls.filter((call) => call.method === 'DELETE').map((call) => call.url), ['/api/chat/sessions/1', '/api/files/2', '/api/memories/3', '/api/reports/4']);
});
test('editing memory uses Chinese option labels but saves the stable backend category', async () => {
  const calls = mockApi(); await mount(h(App)); await navigate('长期记忆'); await click(button('编辑'));
  const trigger = document.querySelector('[aria-label="记忆类型"]'); await click(trigger); await key(trigger, 'End'); await key(trigger, 'Enter');
  assert.equal(trigger.textContent, '约束'); await click(button('保存'));
  const saved = calls.find((call) => call.url === '/api/memories/3' && call.method === 'PATCH');
  assert.deepEqual(JSON.parse(saved.body), { memory_type: 'constraint', content: '测试偏好' });
});

test('avatar contains all destinations, closes after navigation and displays real profile fields', async () => {
  mockApi(); await mount(h(App));
  assert.equal(document.querySelector('.sidebar-nav'), null);
  assert.equal(document.querySelector('[role="menu"]'), null);
  await click(document.querySelector('[aria-label="打开用户菜单"]'));
  assert.deepEqual([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent), ['用户主页信息', '系统设置', '长期记忆', '报告生成', '文档管理', '退出登录']);
  await click(button('用户主页信息'));
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.match(document.querySelector('.user-profile-card').textContent, /账号test/);
  assert.match(document.querySelector('.user-profile-card').textContent, /邮箱未设置/);
  await click(document.querySelector('.sidebar-item'));
  assert.equal(document.querySelector('.user-profile-card'), null);
});
test('avatar menu supports keyboard navigation, Escape, outside click and focus departure', async () => {
  mockApi(); await mount(h(App)); const trigger = document.querySelector('[aria-label="打开用户菜单"]');
  await key(trigger, 'ArrowDown'); assert.equal(document.activeElement, button('用户主页信息'));
  await key(document.activeElement, 'End'); assert.equal(document.activeElement, button('退出登录'));
  await key(document.activeElement, 'ArrowDown'); assert.equal(document.activeElement, button('用户主页信息'));
  await key(document.activeElement, 'Escape'); assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await click(trigger); await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
  assert.equal(document.querySelector('[role="menu"]'), null);
  await click(trigger); await act(async () => document.querySelector('.btn-new-session').focus());
  assert.equal(document.querySelector('[role="menu"]'), null);
});
test('logout in the avatar menu clears the authenticated session', async () => {
  mockApi(); await mount(h(App)); await navigate('退出登录');
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(document.querySelector('[aria-label="打开用户菜单"]'), null);
});
test('composer groups context next to model and keeps send outside that group', async () => {
  await mount(h(ChatComposer, { value: '', onChange() {}, onSend() {}, streaming: false, model, canChangeModel: true, onSwitchModel: async () => {}, contextControl: h('button', { className: 'context-trigger' }, '上下文 0.3%') }));
  const group = document.querySelector('.composer-controls');
  assert.ok(group.querySelector('.composer-model-picker'));
  assert.ok(group.querySelector('.context-trigger'));
  assert.equal(group.contains(document.querySelector('.composer-send')), false);
});
