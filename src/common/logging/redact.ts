/**
 * Secret redaction for logs (Step 06).
 *
 * Bodies are never logged by the access logger; this module guarantees that
 * when any structured field IS logged, secret material is masked first.
 *
 * Redacted categories:
 * - header/key names matching authorization, api keys, secrets, peppers,
 *   passwords, tokens, cookies/sessions, CSRF, private keys, client secrets,
 *   database URLs / connection strings (case-insensitive, `_`/`-` variants);
 * - free-text occurrences of issued API keys (`ppk_…`), bearer tokens, and
 *   credential-bearing connection-string userinfo.
 */

/** Marker substituted for any secret value. */
export const REDACTED = '[redacted]';

const SENSITIVE_KEY_PATTERN =
  /(authori[sz]ation|api[_-]?key|apikey|x-api[_-]?key|secret|pepper|password|passwd|pwd|token|cookie|set-cookie|session|csrf|private[_-]?key|client[_-]?secret|database[_-]?url|db[_-]?url|connection[_-]?string)/i;

const SECRET_STRING_PATTERNS: RegExp[] = [
  /ppk_[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9\-._~+/=]+/g,
  /(postgres(?:ql)?:\/\/)[^/\s@]+@/gi,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Scrub secret substrings out of free text (messages, URLs, header values).
 * Pure string replacement — safe to run on already-redacted input.
 */
export function scrubSecretStrings(value: string): string {
  let out = value;
  for (const pattern of SECRET_STRING_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Deep-redact any value for logging. Object keys matching the sensitive
 * pattern have their whole value replaced; strings are scrubbed for embedded
 * key material. Circular structures and excessive depth are capped instead
 * of throwing.
 */
export function redactValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    return scrubSecretStrings(value);
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return '[binary]';
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return '[omitted]';
  }
  if (depth > 12) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    return value.map((entry) => redactValue(entry, seen, depth + 1));
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(entry, seen, depth + 1);
    }
    return out;
  }
  return '[omitted]';
}

/**
 * Redact a header map for logging. Sensitive header names
 * (`authorization`, `cookie`, `x-api-key`, …) are replaced wholesale;
 * other values are scrubbed for embedded key material.
 */
export function redactHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
    } else if (typeof value === 'string') {
      out[key] = scrubSecretStrings(value);
    } else {
      out[key] = redactValue(value);
    }
  }
  return out;
}

/**
 * Redact sensitive query parameters from a request URL for logging.
 * Parameter names matching the sensitive pattern have their value replaced;
 * other values are scrubbed for embedded key material. The path, parameter
 * order, and encoding are otherwise preserved.
 */
export function redactUrl(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex === -1) {
    return scrubSecretStrings(rawUrl);
  }
  const path = rawUrl.slice(0, queryIndex);
  const rest = rawUrl.slice(queryIndex + 1);
  const hashIndex = rest.indexOf('#');
  const query = hashIndex === -1 ? rest : rest.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : rest.slice(hashIndex);
  const redactedQuery = query
    .split('&')
    .map((pair) => {
      if (pair.length === 0) {
        return pair;
      }
      const eq = pair.indexOf('=');
      if (eq === -1) {
        return SENSITIVE_KEY_PATTERN.test(pair) ? `${pair}=${REDACTED}` : pair;
      }
      const name = pair.slice(0, eq);
      const val = pair.slice(eq + 1);
      if (SENSITIVE_KEY_PATTERN.test(name)) {
        return `${name}=${REDACTED}`;
      }
      return `${name}=${scrubSecretStrings(val)}`;
    })
    .join('&');
  return `${scrubSecretStrings(path)}?${redactedQuery}${scrubSecretStrings(fragment)}`;
}
