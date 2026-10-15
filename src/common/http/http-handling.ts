/**
 * HTTP transport hardening.
 *
 * Applies body-size limits from `APP_CONFIG.requestBodyLimit`, restricts
 * accepted content types for body-bearing requests, and converts
 * body-parser failures (malformed JSON, oversized payloads) into the
 * stable v1 error envelope instead of Express' default HTML errors.
 *
 * Must be called once during bootstrap (`main.ts`) and in e2e tests that
 * assert transport behaviour:
 *
 * ```ts
 * const app = moduleFixture.createNestApplication({ bodyParser: false });
 * setupHttpHandling(app, { requestBodyLimit: '1mb' });
 * await app.init();
 * ```
 *
 * Transport validation only — no domain rules here.
 */
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';
import { REQUEST_ID_HEADER, resolveRequestId } from '../errors/request-id';

const JSON_CONTENT_TYPES = ['application/json', 'application/*+json'];
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

type BodyParserFailure = Error & {
  status?: number;
  type?: string;
  body?: unknown;
};

type LimitConfig = {
  requestBodyLimit: string;
};

function isBodyBearingRequest(req: Request): boolean {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
    return false;
  }
  const length = req.headers['content-length'];
  if (
    typeof length === 'string' &&
    length.trim() !== '' &&
    length.trim() !== '0'
  ) {
    return true;
  }
  const transferEncoding = req.headers['transfer-encoding'];
  return typeof transferEncoding === 'string' && transferEncoding.length > 0;
}

function isSupportedContentType(req: Request): boolean {
  const raw = req.headers['content-type'];
  if (typeof raw !== 'string' || raw.trim() === '') {
    // No content type with an actual body is ambiguous — reject so the
    // caller states intent explicitly instead of guessing JSON.
    return false;
  }
  const mime = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime === 'application/json' || mime === FORM_CONTENT_TYPE) {
    return true;
  }
  return mime.endsWith('+json');
}

function sendTransportError(
  res: Response,
  requestId: string,
  status: number,
  code: 'validation_failed' | 'payload_too_large',
  message: string,
  reason: string,
): void {
  res.setHeader(REQUEST_ID_HEADER, requestId);
  res.status(status).json({
    error: {
      code,
      message,
      status,
      details: [{ path: '(body)', reason }],
      requestId,
    },
  });
}

/**
 * Reject body-bearing requests with missing/unsupported content types
 * before any parser runs. Read-only check — does not consume the stream.
 */
function contentTypeGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isBodyBearingRequest(req)) {
    next();
    return;
  }
  if (!isSupportedContentType(req)) {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    sendTransportError(
      res,
      requestId,
      400,
      'validation_failed',
      'Unsupported content type. Use application/json.',
      'unsupported_content_type',
    );
    return;
  }
  next();
}

/**
 * Convert Express body-parser errors into the v1 envelope.
 * Handles malformed JSON (`entity.parse.failed`) and oversized payloads
 * (`entity.too.large`). Delegates anything else to Nest.
 */
function bodyParserErrorAdapter(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const failure = err as BodyParserFailure | undefined;
  const failureType = failure?.type ?? '';
  const status = failure?.status;
  if (failure instanceof SyntaxError || failureType === 'entity.parse.failed') {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    sendTransportError(
      res,
      requestId,
      400,
      'validation_failed',
      'Malformed JSON payload',
      'malformed_json',
    );
    return;
  }
  if (failureType === 'entity.too.large' || status === 413) {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    sendTransportError(
      res,
      requestId,
      413,
      'payload_too_large',
      'Request payload too large',
      'payload_too_large',
    );
    return;
  }
  next(err);
}

export function setupHttpHandling(
  app: INestApplication,
  config: LimitConfig,
): void {
  const limit = config.requestBodyLimit;
  app.use(contentTypeGuard);
  app.use(json({ limit, type: JSON_CONTENT_TYPES }));
  app.use(urlencoded({ limit, extended: false }));
  app.use(bodyParserErrorAdapter);
}
