const USER_MESSAGES = {
  AUTH_INVALID_CREDENTIALS: 'Usuário ou senha incorretos.',
  AUTH_REQUIRED: 'Entre na sua conta para continuar.',
  ACCOUNT_UNAVAILABLE: 'Esta conta não está disponível.',
  CSRF_INVALID: 'Sua sessão precisa ser atualizada. Recarregue a página e tente novamente.',
  FORBIDDEN: 'Você não tem permissão para realizar esta ação.',
  INVITE_UNAVAILABLE: 'Este convite não é válido ou não está mais disponível.',
  MEDIA_UNAVAILABLE: 'Não foi possível estabelecer a conexão de voz agora.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
  RECOVERY_INVALID: 'Não foi possível validar essas informações.',
  REALTIME_DISABLED: 'A comunicação de voz está temporariamente indisponível.',
  ROOM_UNAVAILABLE: 'Esta sala não está disponível agora.',
  VALIDATION_ERROR: 'Revise as informações preenchidas e tente novamente.',
  INTERNAL_ERROR: 'Não foi possível concluir esta ação agora. Tente novamente em alguns instantes.',
} as const;

export type AppErrorCode = keyof typeof USER_MESSAGES;

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(USER_MESSAGES[code]);
    this.name = 'AppError';
  }

  get userMessage(): string {
    return USER_MESSAGES[this.code];
  }
}
