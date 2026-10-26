import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server;
let MessageBubble;
let cacheDir;

before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'archmind-markdown-tests-'));
  server = await createServer({ cacheDir, server: { middlewareMode: true, hmr: false } });
  ({ MessageBubble } = await server.ssrLoadModule('/src/App.tsx'));
});

after(async () => {
  await server?.close();
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
});

function render(content, role = 'assistant', streaming = false) {
  return renderToStaticMarkup(createElement(MessageBubble, { message: { role, content }, streaming }));
}

test('assistant replies render headings, bold text and lists', () => {
  const html = render('## 我可以帮你\n\n- **总结文件**：提炼核心要点\n- **检索资料**：查找信息');
  assert.match(html, /<h2>我可以帮你<\/h2>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li><strong>总结文件<\/strong>：提炼核心要点<\/li>/);
  assert.doesNotMatch(html, /\*\*总结文件\*\*/);
});

test('tables, code blocks and inline code preserve their structure', () => {
  const html = render('| 功能 | 状态 |\n| --- | --- |\n| 问答 | 正常 |\n\n使用 `print`：\n\n```python\nprint("**literal**")\n```');
  assert.match(html, /<table>/);
  assert.match(html, /<th>功能<\/th>/);
  assert.match(html, /<code>print<\/code>/);
  assert.match(html, /<pre><code class="language-python">/);
  assert.match(html, /\*\*literal\*\*/);
});

test('raw HTML and script URLs cannot become executable content', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[危险链接](javascript:alert)\n\n[正常链接](https://example.com)');
  assert.doesNotMatch(html, /<script|<img|href="javascript:|onerror=/);
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
});

test('partial streamed Markdown remains renderable and completes correctly', () => {
  for (const content of ['**总结', '**总结文件**\n\n```py\nprint(1)', '| 功能 | 状态 |\n| --- |']) {
    assert.match(render(content, 'assistant', true), /class="stream-cursor"/);
  }
  assert.match(render('**总结文件**'), /<strong>总结文件<\/strong>/);
});

test('user messages keep literal Markdown and citation cards stay separate', () => {
  const userHtml = render('请解释 **加粗** 和 `代码`', 'user');
  assert.match(userHtml, /\*\*加粗\*\*/);
  assert.doesNotMatch(userHtml, /<strong>|class="markdown-body"/);
  const assistantHtml = render('**结论**：已找到资料。\n\n## 引用来源\nS1，文件名：说明.md，文件ID：7，位置：第 0 个片段');
  assert.match(assistantHtml, /<strong>结论<\/strong>/);
  assert.match(assistantHtml, /aria-label="引用来源"/);
  assert.match(assistantHtml, /class="citation-card"/);
});
