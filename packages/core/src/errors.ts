export { SearchkeepError, type ErrorCode } from './config.js';

/** Message safe to show to users and log: never includes secrets. */
export function safeMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/(apikey|api_key|key|token|assertion|secret)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[redacted key]')
    .slice(0, 500);
}
