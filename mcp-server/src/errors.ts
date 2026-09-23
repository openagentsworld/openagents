export class OpenAgentsError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly recovery: string;

  constructor(code: string, message: string, options: { retryable?: boolean; recovery?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OpenAgentsError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.recovery = options.recovery ?? 'Check the request and try again.';
  }
}

export interface SafeError {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  recovery: string;
}

export function redactSensitiveText(value: unknown, secrets: string[] = []): string {
  let text = value instanceof Error ? value.message : String(value ?? 'Unknown error');
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/\boa_sub_[A-Za-z0-9_-]+\b/g, '[REDACTED_SUBMISSION_TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+\b/gi, 'Bearer [REDACTED]')
    .replace(/\b[a-f0-9]{48}\b/gi, '[REDACTED_AUTH_TOKEN]');
}

export function normalizeError(error: unknown, secrets: string[] = []): SafeError {
  if (error instanceof OpenAgentsError) {
    return {
      ok: false,
      code: error.code,
      message: redactSensitiveText(error.message, secrets),
      retryable: error.retryable,
      recovery: redactSensitiveText(error.recovery, secrets)
    };
  }
  return {
    ok: false,
    code: 'OPENAGENTS_INTERNAL_ERROR',
    message: redactSensitiveText(error, secrets),
    retryable: false,
    recovery: 'Restart the MCP server. If the problem continues, inspect its redacted stderr log.'
  };
}
