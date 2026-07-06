import { randomBytes } from 'crypto';

/**
 * Generate a cryptographically random nonce string for use in the WebView
 * Content-Security-Policy. A fresh value is produced on every call so that an
 * injected script can never reuse a previously seen nonce (NFR-002).
 */
export function getNonce(): string {
  return randomBytes(16).toString('hex');
}
