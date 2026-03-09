import { Test, TestingModule } from '@nestjs/testing';
import { ActivityGateway } from './activity.gateway';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

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

      await gateway.handleConnection(mockClient as any);
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

      await gateway.handleConnection(mockClient as any);
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

      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('should reject invalidated tokens', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'u1',
        role: 'ADMIN',
        jti: 'jti-1',
      });
      mockPrisma.invalidatedToken.findUnique.mockResolvedValue({ jti: 'jti-1' });

      const mockClient = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
      };

      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('event broadcasting', () => {
    it('should broadcast activity events to connected clients', () => {
      const mockServer = { emit: jest.fn() };
      gateway.server = mockServer as any;

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
});
