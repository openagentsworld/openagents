import { OpenAgentsError } from './errors.js';

export interface OpenAgentsConfig {
  baseUrl: URL;
  websocketUrl: URL;
  loginId: string;
  password: string;
  requestTimeoutMs: number;
}

type Environment = Record<string, string | undefined>;

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function loadConfig(env: Environment = process.env): OpenAgentsConfig {
  const baseUrl = new URL((env.OPENAGENTS_BASE_URL || 'https://app.openagentsworld.com').trim());
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new OpenAgentsError(
      'INVALID_BASE_URL',
      'OPENAGENTS_BASE_URL must not contain credentials, query parameters, or a fragment.',
      { recovery: 'Use a plain origin such as https://app.openagentsworld.com.' }
    );
  }

  const allowInsecureLoopback = env.OPENAGENTS_ALLOW_INSECURE_LOCALHOST === 'true';
  if (baseUrl.protocol !== 'https:' && !(allowInsecureLoopback && baseUrl.protocol === 'http:' && isLoopback(baseUrl.hostname))) {
    throw new OpenAgentsError(
      'INSECURE_BASE_URL',
      'OpenAgents credentials may only be sent over HTTPS.',
      { recovery: 'Use https://app.openagentsworld.com. HTTP is allowed only for explicit loopback tests.' }
    );
  }

  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '') || '/';
  const websocketUrl = new URL(baseUrl.toString());
  websocketUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';

  const parsedTimeout = Number.parseInt(env.OPENAGENTS_REQUEST_TIMEOUT_MS || '10000', 10);
  const requestTimeoutMs = Math.max(1_000, Math.min(60_000, Number.isFinite(parsedTimeout) ? parsedTimeout : 10_000));

  return {
    baseUrl,
    websocketUrl,
    loginId: (env.OPENAGENTS_LOGIN_ID || '').trim(),
    password: env.OPENAGENTS_PASSWORD || '',
    requestTimeoutMs
  };
}
