import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    invalidatedToken: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('mock-token'),
  };

  const mockEmailService = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue({
      jwtSecret: 'test-secret',
      jwtRefreshSecret: 'test-refresh-secret',
      basicAuthUser: '',
      basicAuthPassword: '',
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('should create a new user and return tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'MEMBER',
      });

      const result = await service.register({
        email: 'test@test.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.mustChangePassword).toBe(false);
    });

    it('should throw ConflictException if email exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: '1' });

      await expect(
        service.register({
          email: 'test@test.com',
          password: 'password123',
          firstName: 'Test',
          lastName: 'User',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        password: hashedPassword,
        role: 'MEMBER',
        mustChangePassword: false,
      });

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
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '2',
        email: 'admin@gym.co.ke',
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        mustChangePassword: true,
      });

      const result = await service.login({
        email: 'admin@gym.co.ke',
        password: 'password123',
      });
      expect(result.mustChangePassword).toBe(true);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      const hashedPassword = await bcrypt.hash('password123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        password: hashedPassword,
      });

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('should create a reset token and send email for existing user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        firstName: 'Test',
      });
      mockPrisma.passwordResetToken.create.mockResolvedValue({});

      const result = await service.forgotPassword({ email: 'test@test.com' });

      expect(result.message).toContain('reset link has been sent');
      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalledWith({
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
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'nonexistent@test.com',
      });

      expect(result.message).toContain('reset link has been sent');
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password and clear mustChangePassword flag', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: '1',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: null,
      });
      mockPrisma.$transaction.mockResolvedValue([]);

      const result = await service.resetPassword({
        token: 'valid-token',
        newPassword: 'newPassword123',
      });

      expect(result.message).toContain('reset successfully');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          mustChangePassword: false,
        }),
      });
    });

    it('should throw BadRequestException for expired token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: '1',
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });

      await expect(
        service.resetPassword({
          token: 'expired-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for already used token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'token-id',
        userId: '1',
        token: 'used-token',
        expiresAt: new Date(Date.now() + 3600000),
        usedAt: new Date(),
      });

      await expect(
        service.resetPassword({
          token: 'used-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

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
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashedPassword,
        mustChangePassword: true,
      });
      mockPrisma.user.update.mockResolvedValue({});

      const result = await service.changePassword('1', {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
      });

      expect(result.message).toContain('changed successfully');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          mustChangePassword: false,
        }),
      });
    });

    it('should throw UnauthorizedException for wrong current password', async () => {
      const hashedPassword = await bcrypt.hash('oldPassword123', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        password: hashedPassword,
      });

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
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      });
      mockPrisma.invalidatedToken.create.mockResolvedValue({});

      const result = await service.refreshToken('1', 'old-refresh-jti');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockPrisma.invalidatedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'old-refresh-jti',
          expiresAt: expect.any(Date) as Date,
        },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.refreshToken('nonexistent', 'some-jti'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is suspended', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'SUSPENDED',
        mustChangePassword: false,
      });

      await expect(
        service.refreshToken('1', 'some-jti'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'INACTIVE',
        mustChangePassword: false,
      });

      await expect(
        service.refreshToken('1', 'some-jti'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return mustChangePassword from user record', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'admin@gym.co.ke',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: true,
      });
      mockPrisma.invalidatedToken.create.mockResolvedValue({});

      const result = await service.refreshToken('1', 'old-jti');
      expect(result.mustChangePassword).toBe(true);
    });

    it('should throw UnauthorizedException on token replay (duplicate JTI)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      });
      mockPrisma.invalidatedToken.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.refreshToken('1', 'already-used-jti'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('getProfile', () => {
    it('should return user profile without password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
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
      });

      const result = await service.getProfile('1');
      expect(result).toHaveProperty('email', 'test@test.com');
      expect(result).not.toHaveProperty('password');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: '1' },
        select: expect.objectContaining({
          id: true,
          email: true,
          gender: true,
          displayPicture: true,
        }),
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getProfile('nonexistent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('updateProfile', () => {
    it('should update user profile fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
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
      });
      mockPrisma.user.update.mockResolvedValue({
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
      });

      const result = await service.updateProfile('1', {
        firstName: 'Updated',
        gender: 'MALE' as any,
      });
      expect(result.firstName).toBe('Updated');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { firstName: 'Updated', gender: 'MALE' },
        select: expect.objectContaining({
          id: true,
          gender: true,
          displayPicture: true,
        }),
      });
    });
  });

  describe('logout', () => {
    it('should invalidate token and return success', async () => {
      mockPrisma.invalidatedToken.create.mockResolvedValue({});

      const result = await service.logout('test-jti');

      expect(result.message).toContain('Logged out successfully');
      expect(mockPrisma.invalidatedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'test-jti',
          expiresAt: expect.any(Date) as Date,
        },
      });
    });
  });
});
