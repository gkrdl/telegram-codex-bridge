export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function markdownToTelegramHtml(markdown) {
  const placeholders = [];
  let text = String(markdown ?? '');

  text = text.replace(/```([A-Za-z0-9_-]*)\n?([\s\S]*?)```/g, (_match, language, code) => {
    const className = language ? ` class="language-${escapeTelegramHtml(language)}"` : '';
    return stash(placeholders, `<pre><code${className}>${escapeTelegramHtml(code)}</code></pre>`);
  });

  text = escapeTelegramHtml(text);

  text = text.replace(/`([^`\n]+)`/g, (_match, code) => `<code>${code}</code>`);
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

  return restore(text, placeholders);
}

function stash(placeholders, value) {
  const key = `@@TG_HTML_${placeholders.length}@@`;
  placeholders.push([key, value]);
  return key;
}

function restore(text, placeholders) {
  return placeholders.reduce((result, [key, value]) => result.replaceAll(key, value), text);
}
