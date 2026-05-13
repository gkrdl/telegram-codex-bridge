export class TelegramClient {
  constructor({ token, fetchImpl = fetch }) {
    this.token = token;
    this.fetch = fetchImpl;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates({ offset, timeoutSeconds = 25 }) {
    const url = new URL(`${this.baseUrl}/getUpdates`);
    if (offset !== undefined) {
      url.searchParams.set('offset', String(offset));
    }
    url.searchParams.set('timeout', String(timeoutSeconds));
    url.searchParams.set('allowed_updates', JSON.stringify(['message']));
    const response = await this.fetch(url);
    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Telegram getUpdates failed: ${body.description || response.status}`);
    }
    return body.result;
  }

  async sendMessage(chatId, text) {
    const response = await this.fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: truncateTelegramText(text),
        disable_web_page_preview: true,
      }),
    });
    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Telegram sendMessage failed: ${body.description || response.status}`);
    }
    return body.result;
  }
}

export function getMessageText(update) {
  return update?.message?.text || update?.message?.caption || '';
}

export function getSenderId(update) {
  return update?.message?.from?.id ? String(update.message.from.id) : '';
}

export function getChatId(update) {
  return update?.message?.chat?.id ? String(update.message.chat.id) : '';
}

function truncateTelegramText(text) {
  const value = String(text || '').trim() || '(empty response)';
  return value.length <= 3900 ? value : `${value.slice(0, 3900)}\n...[truncated]`;
}
