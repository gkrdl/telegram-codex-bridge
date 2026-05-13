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
    'Telegram Codex Bridge 명령어',
    '/new <내용> - 새 Codex 세션을 시작하고 이 채팅에 연결',
    '/continue <내용> - 현재 연결된 세션 이어가기',
    '/once <내용> - 저장하지 않는 1회성 Codex 작업 실행',
    '/sessions - 최근 Codex 세션 목록 보기',
    '/attach <세션ID 또는 제목> - 이 채팅을 기존 세션에 연결',
    '/forget - 현재 세션 연결 해제',
    '/status - 브리지 상태 확인',
    '/help - 사용 가능한 명령어 보기',
    '',
    '일반 메시지는 연결된 세션이 있으면 이어가고, 없으면 새 세션을 시작합니다.',
  ].join('\n');
}
