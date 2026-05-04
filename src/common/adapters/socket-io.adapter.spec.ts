import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocketIoAdapter } from './socket-io.adapter';
import { getAppConfigName } from '../config/app.config';

function makeAdapter(adminUrl: string): SocketIoAdapter {
  const mockConfigService = {
    get: (key: string) =>
      key === getAppConfigName() ? { adminUrl } : undefined,
  } as unknown as ConfigService;

  const mockApp = {
    get: (token: unknown) =>
      token === ConfigService ? mockConfigService : undefined,
  } as unknown as INestApplication;

  return new SocketIoAdapter(mockApp);
}

describe('SocketIoAdapter', () => {
  beforeEach(() => jest.restoreAllMocks());

  describe('corsOrigins', () => {
    it('parses a single origin', () => {
      expect(makeAdapter('http://localhost:3002').corsOrigins).toEqual([
        'http://localhost:3002',
      ]);
    });

    it('splits comma-separated origins', () => {
      expect(
        makeAdapter('http://localhost:3002,https://admin.example.com')
          .corsOrigins,
      ).toEqual(['http://localhost:3002', 'https://admin.example.com']);
    });

    it('does not contain a wildcard', () => {
      expect(makeAdapter('http://localhost:3002').corsOrigins).not.toContain(
        '*',
      );
    });
  });

  // M10 — verify the origins and credentials are forwarded to the underlying
  // Socket.IO server, not just stored on the adapter.
  describe('createIOServer (M10)', () => {
    it('passes corsOrigins and credentials:true to the parent', () => {
      const adapter = makeAdapter('http://localhost:3002');

      const spy = jest
        .spyOn(IoAdapter.prototype, 'createIOServer')
        .mockReturnValue({} as never);

      adapter.createIOServer(0);

      const [, opts] = spy.mock.calls[0];
      const cors = (
        opts as { cors: { origin: string[]; credentials: boolean } }
      ).cors;
      expect(cors.origin).toEqual(adapter.corsOrigins);
      expect(cors.credentials).toBe(true);
    });
  });
});
