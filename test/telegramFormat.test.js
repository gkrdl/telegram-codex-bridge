import test from 'node:test';
import assert from 'node:assert/strict';

import { markdownToTelegramHtml, escapeTelegramHtml } from '../src/telegramFormat.js';

test('escapes Telegram HTML special characters', () => {
  assert.equal(escapeTelegramHtml('<a&b>'), '&lt;a&amp;b&gt;');
});

test('converts common markdown to Telegram HTML', () => {
  assert.equal(
    markdownToTelegramHtml('**bold** `code` [OpenAI](https://openai.com)'),
    '<b>bold</b> <code>code</code> <a href="https://openai.com">OpenAI</a>',
  );
});

test('converts fenced code blocks to pre code blocks', () => {
  assert.equal(
    markdownToTelegramHtml('```js\nconsole.log("<x>")\n```'),
    '<pre><code class="language-js">console.log(&quot;&lt;x&gt;&quot;)\n</code></pre>',
  );
});
