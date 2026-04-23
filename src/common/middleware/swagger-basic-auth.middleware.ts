import * as crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal Basic Auth middleware used to gate the Swagger UI. Separate from
 * the passport-based `BasicStrategy` because the Swagger routes are mounted
 * directly on the Express adapter (before Nest's guard chain runs) and we
 * don't want to couple the docs gate to the public-endpoint credentials
 * pipeline.
 *
 * Comparison is timing-safe via the same hash-then-`timingSafeEqual` pattern
 * used by `BasicStrategy`.
 */
export function createSwaggerBasicAuthMiddleware(
  expectedUser: string,
  expectedPass: string,
) {
  return function swaggerBasicAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      return unauthorized(res);
    }

    let username = '';
    let password = '';
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx === -1) {
        return unauthorized(res);
      }
      username = decoded.slice(0, idx);
      password = decoded.slice(idx + 1);
    } catch {
      return unauthorized(res);
    }

    const userOk = timingSafeEqualStrings(username, expectedUser);
    const passOk = timingSafeEqualStrings(password, expectedPass);

    if (userOk && passOk) {
      return next();
    }

    return unauthorized(res);
  };
}

function unauthorized(res: Response) {
  res.setHeader('WWW-Authenticate', 'Basic realm="Swagger UI"');
  res.status(401).send('Unauthorized');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}
