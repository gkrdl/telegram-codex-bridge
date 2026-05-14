export class TelegramClient {
  constructor({ token, fetchImpl = fetch, requestTimeoutMs = 15000, pollTimeoutSlackMs = 10000 }) {
    this.token = token;
    this.fetch = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.pollTimeoutSlackMs = pollTimeoutSlackMs;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async getUpdates({ offset, timeoutSeconds = 25 }) {
    const url = new URL(`${this.baseUrl}/getUpdates`);
    if (offset !== undefined) {
      url.searchParams.set('offset', String(offset));
    }
    url.searchParams.set('timeout', String(timeoutSeconds));
    url.searchParams.set('allowed_updates', JSON.stringify(['message']));
    const response = await this.fetch(url, {
      signal: AbortSignal.timeout((timeoutSeconds * 1000) + this.pollTimeoutSlackMs),
    });
    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Telegram getUpdates failed: ${body.description || response.status}`);
    }
    return body.result;
  }

  async sendMessage(chatId, text, options = {}) {
    const response = await this.fetch(`${this.baseUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      body: JSON.stringify({
        chat_id: chatId,
        text: truncateTelegramText(text),
        ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        disable_web_page_preview: true,
      }),
    });
    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Telegram sendMessage failed: ${body.description || response.status}`);
    }
    return body.result;
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    const response = await this.fetch(`${this.baseUrl}/editMessageText`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: truncateTelegramText(text),
        ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        disable_web_page_preview: true,
      }),
    });
    const body = await response.json();
    if (!body.ok) {
      throw new Error(`Telegram editMessageText failed: ${body.description || response.status}`);
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
