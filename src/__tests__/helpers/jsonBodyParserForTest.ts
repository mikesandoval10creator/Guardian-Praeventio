import type { NextFunction, Request, Response } from 'express';

const DEFAULT_JSON_BODY_LIMIT_BYTES = 100 * 1024;

type ParserError = Error & {
  status?: number;
  type?: string;
};

interface BodyParserOptions {
  limit?: string | number;
}

function parserError(status: number, type: string, message: string): ParserError {
  const error = new Error(message) as ParserError;
  error.status = status;
  error.type = type;
  return error;
}

function parseLimit(limit: string | number | undefined): number {
  if (limit === undefined) return DEFAULT_JSON_BODY_LIMIT_BYTES;
  if (typeof limit === 'number') return limit;

  const match = limit.match(/^(\d+)(b|kb|mb)?$/i);
  if (!match) throw new Error(`unsupported test body limit: ${limit}`);

  const multiplier = match[2]?.toLowerCase() === 'mb'
    ? 1024 * 1024
    : match[2]?.toLowerCase() === 'kb'
    ? 1024
    : 1;
  return Number(match[1]) * multiplier;
}

function collectBody(
  req: Request,
  limit: number,
  onBody: (body: Buffer) => void,
  next: NextFunction,
): void {
  let settled = false;
  let received = 0;
  const chunks: Buffer[] = [];

  const cleanup = (): void => {
    req.off('data', onData);
    req.off('end', onEnd);
    req.off('error', onError);
    req.off('aborted', onAborted);
  };

  const finishWithError = (error: ParserError): void => {
    if (settled) return;
    settled = true;
    cleanup();
    // Drain rejected bodies so the Supertest socket can close deterministically.
    req.resume();
    next(error);
  };

  const onData = (chunk: Buffer | string): void => {
    if (settled) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > limit) {
      finishWithError(parserError(413, 'entity.too.large', 'request entity too large'));
      return;
    }
    chunks.push(buffer);
  };

  const onEnd = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
    try {
      onBody(Buffer.concat(chunks));
    } catch (error) {
      next(error as Error);
    }
  };

  const onError = (error: Error): void => {
    finishWithError(error as ParserError);
  };

  const onAborted = (): void => {
    finishWithError(parserError(400, 'request.aborted', 'request aborted'));
  };

  req.on('data', onData);
  req.on('end', onEnd);
  req.on('error', onError);
  req.on('aborted', onAborted);
}

/**
 * Test-only JSON parser that avoids raw-body's AsyncResource wrapper.
 * Express's production parser remains authoritative.
 */
export function jsonBodyParserForTest(req: Request, _res: Response, next: NextFunction): void {
  if (req.body !== undefined || !req.is('application/json')) {
    next();
    return;
  }

  collectBody(req, DEFAULT_JSON_BODY_LIMIT_BYTES, body => {
    try {
      const raw = body.toString('utf8');
      req.body = raw.length === 0 ? {} : JSON.parse(raw);
      next();
    } catch {
      next(parserError(400, 'entity.parse.failed', 'invalid JSON'));
    }
  }, next);
}

/** Test-only replacement for express.raw({ type: 'application/json', limit }). */
export function rawBodyParserForTest(options: BodyParserOptions = {}) {
  const limit = parseLimit(options.limit);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.body !== undefined || !req.is('application/json')) {
      next();
      return;
    }

    collectBody(req, limit, body => {
      req.body = body;
      next();
    }, next);
  };
}
