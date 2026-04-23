import { Test, TestingModule } from '@nestjs/testing';
import { ActivityGateway } from './activity.gateway';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';

describe('ActivityGateway', () => {
  let gateway: ActivityGateway;
  let jwtService: JwtService;

  const mockPrisma = {
    invalidatedToken: { findUnique: jest.fn() },
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({ jwtSecret: 'test-secret' }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityGateway,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    gateway = module.get<ActivityGateway>(ActivityGateway);
    jwtService = module.get<JwtService>(JwtService);
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should disconnect client with no token', async () => {
      const mockClient = {
        handshake: { auth: {} },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as unknown as Socket);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client with non-admin role', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'MEMBER',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue(null);

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as unknown as Socket);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should accept ADMIN connections', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'ADMIN',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue(null);

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as unknown as Socket);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should reject invalidated tokens', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'ADMIN',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue({
        jti: 'jti-1',
      });

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as unknown as Socket);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('event broadcasting', () => {
    it('should broadcast activity events to connected clients', () => {
      const mockServer = { emit: jest.fn() };
      gateway.server = mockServer as unknown as ActivityGateway['server'];

      const payload = {
        type: 'registration' as const,
        description: 'John Doe registered as a new member',
        timestamp: new Date().toISOString(),
        metadata: { memberId: 'u1' },
      };

      gateway.handleRegistration(payload);

      expect(mockServer.emit).toHaveBeenCalledWith('activity', payload);
    });
  });

  // M10 — WebSocket gateway must not accept connections from any origin.
  // The `@WebSocketGateway` decorator stores its options via `Reflect.defineMetadata`
  // under the `GATEWAY_OPTIONS` key, which we read back here to verify CORS shape.
  describe('CORS configuration (M10)', () => {
    it('does not use wildcard origin', () => {
      const opts = Reflect.getMetadata(GATEWAY_OPTIONS, ActivityGateway) as {
        cors?: { origin?: unknown; credentials?: boolean } | boolean;
      };

      expect(opts).toBeDefined();
      expect(opts.cors).not.toBe(true);
      expect(opts.cors).not.toEqual({ origin: '*' });
      expect(
        typeof opts.cors === 'object' && opts.cors && opts.cors.origin,
      ).toBeDefined();
      // Origin must be an explicit allowlist (array of strings), not '*'.
      const origin = (opts.cors as { origin: unknown }).origin;
      expect(Array.isArray(origin)).toBe(true);
      expect(origin as string[]).not.toContain('*');
      expect((origin as string[]).length).toBeGreaterThan(0);
      // Credentials should be explicitly allowed for authenticated WS sessions.
      expect((opts.cors as { credentials?: boolean }).credentials).toBe(true);
    });
  });
});
