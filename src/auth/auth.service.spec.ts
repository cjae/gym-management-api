import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit-logs/audit-logs.service';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-token'),
  };

  const mockEmailService = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendSelfRegistrationWelcomeEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({
      jwtSecret: 'test-secret',
      jwtRefreshSecret: 'test-refresh-secret',
      basicAuthUser: '',
      basicAuthPassword: '',
    }),
  };

  const mockEventEmitter = { emit: jest.fn() };

  const mockLicensingService = {
    getMemberLimit: jest.fn().mockResolvedValue(null),
  };

  const mockAuditLogService = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockDeep<PrismaClient>() },
        { provide: JwtService, useValue: mockJwtService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: LicensingService, useValue: mockLicensingService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new user and return tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'MEMBER',
      } as any);

      const result = await service.register({
        email: 'test@test.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        acceptTos: true,
        acceptWaiver: true,
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.mustChangePassword).toBe(false);
    });

    it('should throw ConflictException if email exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: '1' } as any);

      await expect(
        service.register({
          email: 'test@test.com',
          password: 'password123',
          firstName: 'Test',
          lastName: 'User',
          acceptTos: true,
          acceptWaiver: true,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        password: hashedPassword,
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);

      const result = await service.login({
        email: 'test@test.com',
        password: 'password123',
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.mustChangePassword).toBe(false);
    });

    it('should return mustChangePassword true for seeded admin', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '2',
        email: 'admin@gym.co.ke',
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: true,
      } as any);

      const result = await service.login({
        email: 'admin@gym.co.ke',
        password: 'password123',
      });
      expect(result.mustChangePassword).toBe(true);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        password: hashedPassword,
      } as any);

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is suspended', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        password: hashedPassword,
        role: 'MEMBER',
        status: 'SUSPENDED',
      } as any);

      await expect(
        service.login({ email: 'test@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        password: hashedPassword,
        role: 'MEMBER',
        status: 'INACTIVE',
      } as any);

      await expect(
        service.login({ email: 'test@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('should create a reset token and send email for existing user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Test',
      } as any);
      prisma.passwordResetToken.create.mockResolvedValue({} as any);

      const result = await service.forgotPassword({ email: 'test@test.com' });

      expect(result.message).toContain('reset link has been sent');

      expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          token: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
        }) as Record<string, unknown>,
      });
      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@test.com',
        'Test',
        expect.any(String),
      );
    });

    it('should return success even if email does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nonexistent@test.com',
      });

      expect(result.message).toContain('reset link has been sent');

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password and clear mustChangePassword flag', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: '1',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
      } as any);
      prisma.$transaction.mockResolvedValue([] as any);

      const result = await service.resetPassword({
        token: 'valid-token',
        newPassword: 'newPassword123',
      });

      expect(result.message).toContain('reset successfully');

      expect(prisma.$transaction).toHaveBeenCalled();

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          mustChangePassword: false,
        }) as Record<string, unknown>,
      });
    });

    it('should throw BadRequestException for expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: '1',
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      } as any);

      await expect(
        service.resetPassword({
          token: 'expired-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for already used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: '1',
        token: 'used-token',
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: new Date(),
      } as any);

      await expect(
        service.resetPassword({
          token: 'used-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'invalid-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePassword', () => {
    it('should change password and clear mustChangePassword flag', async () => {
      const hashedPassword = await bcrypt.hash('oldPassword123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashedPassword,
        mustChangePassword: true,
      } as any);
      prisma.user.update.mockResolvedValue({} as any);

      const result = await service.changePassword('1', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
      });

      expect(result.message).toContain('changed successfully');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          mustChangePassword: false,
        }) as Record<string, unknown>,
      });
    });

    it('should throw UnauthorizedException for wrong current password', async () => {
      const hashedPassword = await bcrypt.hash('oldPassword123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashedPassword,
      } as any);

      await expect(
        service.changePassword('1', {
          currentPassword: 'wrongPassword',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refreshToken', () => {
    it('should invalidate old JTI and return new tokens', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.invalidatedToken.create.mockResolvedValue({} as any);

      const result = await service.refreshToken('1', 'old-refresh-jti');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');

      expect(prisma.invalidatedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'old-refresh-jti',
          expiresAt: expect.any(Date) as Date,
        },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.refreshToken('nonexistent', 'some-jti'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is suspended', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'SUSPENDED',
        mustChangePassword: false,
      } as any);

      await expect(service.refreshToken('1', 'some-jti')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'INACTIVE',
        mustChangePassword: false,
      } as any);

      await expect(service.refreshToken('1', 'some-jti')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return mustChangePassword from user record', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'admin@gym.co.ke',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: true,
      } as any);
      prisma.invalidatedToken.create.mockResolvedValue({} as any);

      const result = await service.refreshToken('1', 'old-jti');
      expect(result.mustChangePassword).toBe(true);
    });

    it('should throw UnauthorizedException on token replay (duplicate JTI)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.invalidatedToken.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.refreshToken('1', 'already-used-jti'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getProfile', () => {
    it('should return user profile without password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        role: 'MEMBER',
        status: 'ACTIVE',
        gender: null,
        displayPicture: null,
        mustChangePassword: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.getProfile('1');
      expect(result).toHaveProperty('email', 'test@test.com');
      expect(result).not.toHaveProperty('password');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        select: expect.objectContaining({
          id: true,
          email: true,
          gender: true,
          displayPicture: true,
        }) as Record<string, unknown>,
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('nonexistent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('updateProfile', () => {
    it('should update user profile fields', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        role: 'MEMBER',
        status: 'ACTIVE',
        gender: 'MALE',
        displayPicture: null,
        mustChangePassword: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      prisma.user.update.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Updated',
        lastName: 'User',
        phone: null,
        role: 'MEMBER',
        status: 'ACTIVE',
        gender: 'MALE',
        displayPicture: null,
        mustChangePassword: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.updateProfile('1', {
        firstName: 'Updated',
        gender: 'MALE' as unknown as undefined,
      });
      expect(result.firstName).toBe('Updated');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { firstName: 'Updated', gender: 'MALE' },
        select: expect.objectContaining({
          id: true,
          gender: true,
          displayPicture: true,
        }) as Record<string, unknown>,
      });
    });
  });

  describe('logout', () => {
    it('should invalidate token and return success', async () => {
      prisma.invalidatedToken.create.mockResolvedValue({} as any);

      const result = await service.logout('test-jti');

      expect(result.message).toContain('Logged out successfully');

      expect(prisma.invalidatedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'test-jti',
          expiresAt: expect.any(Date) as Date,
        },
      });
    });
  });

  describe('requestDeletion', () => {
    it('should create a deletion request', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);
      prisma.accountDeletionRequest.create.mockResolvedValue({
        id: 'dr-1',
        userId: '1',
        reason: 'Moving away',
        status: 'PENDING',
        reviewedById: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.requestDeletion('1', { reason: 'Moving away' });
      expect(result.id).toBe('dr-1');
      expect(result.status).toBe('PENDING');
    });

    it('should throw ConflictException if pending request exists', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'dr-1',
        status: 'PENDING',
      } as any);

      await expect(
        service.requestDeletion('1', {}),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getDeletionRequest', () => {
    it('should return the latest deletion request for user', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'dr-1',
        userId: '1',
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.getDeletionRequest('1');
      expect(result).toBeDefined();
      expect(result!.id).toBe('dr-1');
    });

    it('should return null if no deletion request exists', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);

      const result = await service.getDeletionRequest('1');
      expect(result).toBeNull();
    });
  });

  describe('cancelDeletionRequest', () => {
    it('should cancel a pending deletion request', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'dr-1',
        userId: '1',
        status: 'PENDING',
      } as any);
      prisma.accountDeletionRequest.update.mockResolvedValue({
        id: 'dr-1',
        status: 'CANCELLED',
      } as any);

      const result = await service.cancelDeletionRequest('1');
      expect(result.message).toContain('cancelled');
    });

    it('should throw NotFoundException if no pending request', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelDeletionRequest('1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
