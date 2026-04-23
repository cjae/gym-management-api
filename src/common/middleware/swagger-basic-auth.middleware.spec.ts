import { createSwaggerBasicAuthMiddleware } from './swagger-basic-auth.middleware';
import type { NextFunction, Request, Response } from 'express';

function makeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.setHeader = jest.fn();
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.send = jest.fn().mockImplementation((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res as Response & { statusCode?: number; body?: unknown };
}

function makeReq(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as Request;
}

function basic(user: string, pass: string) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

describe('createSwaggerBasicAuthMiddleware', () => {
  const mw = createSwaggerBasicAuthMiddleware('admin', 's3cret');

  it('calls next() on matching credentials', () => {
    const req = makeReq(basic('admin', 's3cret'));
    const res = makeRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeUndefined();
  });

  it('rejects missing Authorization header with 401 + WWW-Authenticate', () => {
    const req = makeReq();
    const res = makeRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="Swagger UI"',
    );
  });

  it('rejects non-Basic scheme', () => {
    const req = makeReq('Bearer sometoken');
    const res = makeRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed base64 payload (missing colon)', () => {
    const req = makeReq(
      'Basic ' + Buffer.from('noseparator').toString('base64'),
    );
    const res = makeRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong password', () => {
    const req = makeReq(basic('admin', 'nope'));
    const res = makeRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong username', () => {
    const req = makeReq(basic('someoneelse', 's3cret'));
    const res = makeRes();
    const next: NextFunction = jest.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
