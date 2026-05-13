const COMMANDS = new Set([
  '/new',
  '/continue',
  '/once',
  '/attach',
  '/sessions',
  '/forget',
  '/status',
  '/help',
]);

export function routeMessage(text, chatState = {}) {
  const message = String(text ?? '').trim();
  if (!message) {
    return { action: 'reply', text: 'Send a command or a prompt for Codex.' };
  }

  const [command, ...rest] = message.split(/\s+/);
  const lowerCommand = command.toLowerCase();
  const prompt = rest.join(' ').trim();

  if (COMMANDS.has(lowerCommand)) {
    switch (lowerCommand) {
      case '/new':
        return prompt ? { action: 'new', prompt } : { action: 'reply', text: 'Usage: /new <prompt>' };
      case '/continue':
        if (!chatState.activeSessionId) {
          return {
            action: 'reply',
            text: 'No active Codex session is attached. Use /new, /attach, or send a new message to start one.',
          };
        }
        return prompt
          ? { action: 'resume', sessionId: chatState.activeSessionId, prompt }
          : { action: 'reply', text: 'Usage: /continue <prompt>' };
      case '/once':
        return prompt ? { action: 'once', prompt } : { action: 'reply', text: 'Usage: /once <prompt>' };
      case '/attach':
        return prompt ? { action: 'attach', sessionId: prompt } : { action: 'reply', text: 'Usage: /attach <session-id-or-title>' };
      case '/sessions':
        return { action: 'sessions' };
      case '/forget':
        return { action: 'forget' };
      case '/status':
        return { action: 'status' };
      case '/help':
        return { action: 'help' };
    }
  }

  if (chatState.activeSessionId) {
    return { action: 'resume', sessionId: chatState.activeSessionId, prompt: message };
  }

  return { action: 'new', prompt: message };
}

export function helpText() {
  return [
    'Telegram Codex Bridge commands:',
    '/new <prompt> - start a new persistent Codex session',
    '/continue <prompt> - continue the active session',
    '/once <prompt> - run a one-off ephemeral Codex task',
    '/sessions - list recent Codex sessions',
    '/attach <session-id-or-title> - attach this chat to a session',
    '/forget - detach the active session',
    '/status - show bridge status',
  ].join('\n');
}
