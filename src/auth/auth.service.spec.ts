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
import { OnboardingDto } from './dto/onboarding.dto';

// bcrypt is a native binding whose exports are non-configurable, so
// jest.spyOn / Object.defineProperty can't replace its members at runtime.
// Wrap the compare function in a Jest mock via the module factory so we can
// inspect call args while delegating to the real implementation.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    compare: jest.fn((password: string, hash: string) =>
      actual.compare(password, hash),
    ),
  };
});

const bcryptCompareMock = bcrypt.compare as unknown as jest.Mock;

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

    it('runs bcrypt.compare against a dummy hash when email does not exist (timing parity)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      bcryptCompareMock.mockClear();

      await expect(
        service.login({ email: 'nobody@test.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);

      // bcrypt.compare MUST be called even on unknown email so the response
      // time matches the wrong-password branch (prevents email enumeration).
      expect(bcryptCompareMock).toHaveBeenCalledTimes(1);
      const [submittedPassword, hashArg] = bcryptCompareMock.mock.calls[0];
      expect(submittedPassword).toBe('whatever');
      // The dummy hash must be a valid bcrypt hash (starts with $2a/$2b/$2y).
      expect(hashArg).toMatch(/^\$2[aby]\$/);
    });

    it('runs bcrypt.compare against a dummy hash when user is soft-deleted (timing parity)', async () => {
      const realUserHash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'deleted@test.com',
        password: realUserHash,
        role: 'MEMBER',
        status: 'ACTIVE',
        deletedAt: new Date(),
      } as any);
      bcryptCompareMock.mockClear();

      await expect(
        service.login({
          email: 'deleted@test.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcryptCompareMock).toHaveBeenCalledTimes(1);
      const [, hashArg] = bcryptCompareMock.mock.calls[0];
      // Must compare against the dummy hash, NOT the real user's hash —
      // we short-circuit on deletedAt before reaching real-user bcrypt.
      expect(hashArg).toMatch(/^\$2[aby]\$/);
      expect(hashArg).not.toBe(realUserHash);
    });

    it('still emits LOGIN_FAILED audit with userId=null for unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@test.com', password: 'x' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          action: 'LOGIN_FAILED',
          metadata: { email: 'nobody@test.com' },
        }),
      );
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
    // Interactive $transaction: the service passes a callback that receives a tx client.
    // We route tx.* back to the same prisma mock so assertions still work.
    const wireInteractiveTransaction = () => {
      prisma.$transaction.mockImplementation((arg: any) => {
        if (typeof arg === 'function') {
          return arg(prisma);
        }
        return Promise.resolve([]);
      });
    };

    it('atomically claims the token and updates the password', async () => {
      wireInteractiveTransaction();
      prisma.passwordResetToken.updateMany.mockResolvedValue({
        count: 1,
      } as any);
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        userId: '1',
      } as any);
      prisma.user.update.mockResolvedValue({} as any);

      const result = await service.resetPassword({
        token: 'valid-token',
        newPassword: 'newPassword123',
      });

      expect(result.message).toContain('reset successfully');
      expect(prisma.$transaction).toHaveBeenCalled();

      // Atomic claim: gated on usedAt null AND expiresAt in the future.
      const updateManyCall = prisma.passwordResetToken.updateMany.mock
        .calls[0][0] as any;
      expect(updateManyCall.where).toMatchObject({
        usedAt: null,
      });
      expect(updateManyCall.where.expiresAt).toEqual({ gt: expect.any(Date) });
      expect(updateManyCall.data.usedAt).toBeInstanceOf(Date);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          mustChangePassword: false,
        }) as Record<string, unknown>,
      });
    });

    it('rejects replay with the same error (claim returns count 0 on second call)', async () => {
      wireInteractiveTransaction();
      // First call: successful claim.
      prisma.passwordResetToken.updateMany
        .mockResolvedValueOnce({ count: 1 } as any)
        // Second call: token is already used, so updateMany matches nothing.
        .mockResolvedValueOnce({ count: 0 } as any);
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        userId: '1',
      } as any);
      prisma.user.update.mockResolvedValue({} as any);

      await service.resetPassword({
        token: 'replay-token',
        newPassword: 'newPassword123',
      });

      await expect(
        service.resetPassword({
          token: 'replay-token',
          newPassword: 'anotherPassword123',
        }),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset token'),
      );

      // Only the first call's password update ran.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException for expired token (claim matches nothing)', async () => {
      wireInteractiveTransaction();
      prisma.passwordResetToken.updateMany.mockResolvedValue({
        count: 0,
      } as any);

      await expect(
        service.resetPassword({
          token: 'expired-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for already-used token (claim matches nothing)', async () => {
      wireInteractiveTransaction();
      prisma.passwordResetToken.updateMany.mockResolvedValue({
        count: 0,
      } as any);

      await expect(
        service.resetPassword({
          token: 'used-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid token', async () => {
      wireInteractiveTransaction();
      prisma.passwordResetToken.updateMany.mockResolvedValue({
        count: 0,
      } as any);

      await expect(
        service.resetPassword({
          token: 'invalid-token',
          newPassword: 'newPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('simulated race: second parallel caller gets count 0 and no password change', async () => {
      wireInteractiveTransaction();
      // Both calls would have seen an unused+unexpired token via findUnique under the old flow,
      // but updateMany's atomic where-clause means only ONE call can win.
      prisma.passwordResetToken.updateMany
        .mockResolvedValueOnce({ count: 1 } as any) // winner
        .mockResolvedValueOnce({ count: 0 } as any); // loser
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        userId: '1',
      } as any);
      prisma.user.update.mockResolvedValue({} as any);

      const results = await Promise.allSettled([
        service.resetPassword({
          token: 'shared-token',
          newPassword: 'winnerPassword1',
        }),
        service.resetPassword({
          token: 'shared-token',
          newPassword: 'loserPassword1',
        }),
      ]);

      // bcrypt.hash is genuinely async and either call can reach $transaction first,
      // so we don't pin "which" call wins — only that exactly one wins and one loses.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const loser = rejected[0];
      if (loser.status === 'rejected') {
        expect(loser.reason).toBeInstanceOf(BadRequestException);
      }

      // Only one password write happened.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
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
    // Wire $transaction so the reuse-detection path (which uses array-form)
    // resolves without needing real DB.
    const wireArrayTransaction = () => {
      prisma.$transaction.mockImplementation((arg: any) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        if (typeof arg === 'function') return arg(prisma);
        return Promise.resolve([]);
      });
    };

    it('atomically claims the refresh-token row and issues a new pair in the same family (M4)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      // generateTokens fetches sessionsInvalidatedAt after the claim.
      prisma.user.findUnique.mockResolvedValueOnce({
        sessionsInvalidatedAt: null,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'fam-1',
        usedAt: null,
        revokedAt: null,
      } as any);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' } as any);
      prisma.refreshToken.update.mockResolvedValue({} as any);
      prisma.invalidatedToken.create.mockResolvedValue({} as any);

      const result = await service.refreshToken('1', 'old-jti', 'raw-token');

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');

      // Atomic claim was gated on usedAt null AND revokedAt null.
      const claim = prisma.refreshToken.updateMany.mock.calls[0][0] as any;
      expect(claim.where).toMatchObject({
        id: 'rt-1',
        usedAt: null,
        revokedAt: null,
      });
      expect(claim.data.usedAt).toBeInstanceOf(Date);

      // New token row persisted in the SAME family as the predecessor.
      const create = prisma.refreshToken.create.mock.calls[0][0] as any;
      expect(create.data.familyId).toBe('fam-1');
      expect(create.data.userId).toBe('1');
      expect(create.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);

      // Replacement link: old row → new row.
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { replacedById: 'rt-2' },
      });
    });

    it('detects reuse on an already-used refresh token, revokes the family, and bumps sessionsInvalidatedAt (M4)', async () => {
      wireArrayTransaction();
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'fam-compromised',
        usedAt: new Date(), // already used → this second presentation is the attacker
        revokedAt: null,
      } as any);

      await expect(
        service.refreshToken('1', 'reused-jti', 'stolen-token'),
      ).rejects.toThrow(
        new UnauthorizedException('Refresh token has already been used'),
      );

      // Entire family revoked.
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            familyId: 'fam-compromised',
            revokedAt: null,
          }) as Record<string, unknown>,
          data: expect.objectContaining({
            revokedAt: expect.any(Date) as Date,
          }) as Record<string, unknown>,
        }),
      );

      // User's sessionsInvalidatedAt bumped so outstanding access tokens
      // across every session are rejected.
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          sessionsInvalidatedAt: expect.any(Date) as Date,
        }) as Record<string, unknown>,
      });

      // New pair NOT issued on reuse.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();

      // AUTH_REFRESH_REUSE audit log emitted.
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: '1',
          action: 'AUTH_REFRESH_REUSE',
          metadata: expect.objectContaining({
            familyId: 'fam-compromised',
            reusedJti: 'reused-jti',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('surfaces the SAME 401 error message on reuse as on legitimate expiry (no leak)', async () => {
      wireArrayTransaction();
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'fam-1',
        usedAt: new Date(),
        revokedAt: null,
      } as any);

      // We assert the EXACT same string mobile clients would see from the
      // legacy "P2002" path — must not diverge, otherwise attackers can
      // distinguish "reuse detected" from "already rotated".
      await expect(service.refreshToken('1', 'jti', 'raw')).rejects.toThrow(
        'Refresh token has already been used',
      );
    });

    it('falls through to legacy rotation when no RefreshToken row exists (backwards compat)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.user.findUnique.mockResolvedValueOnce({
        sessionsInvalidatedAt: null,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      prisma.invalidatedToken.create.mockResolvedValue({} as any);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-new' } as any);

      const result = await service.refreshToken('1', 'legacy-jti', 'legacy');

      expect(result).toHaveProperty('accessToken');
      expect(prisma.invalidatedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'legacy-jti',
          expiresAt: expect.any(Date) as Date,
        },
      });
    });

    it('throws UnauthorizedException if user not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.refreshToken('nonexistent', 'some-jti', 'raw'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if user is suspended', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'SUSPENDED',
        mustChangePassword: false,
      } as any);

      await expect(
        service.refreshToken('1', 'some-jti', 'raw'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'INACTIVE',
        mustChangePassword: false,
      } as any);

      await expect(
        service.refreshToken('1', 'some-jti', 'raw'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('carries mustChangePassword from the user record into the rotated tokens', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'admin@gym.co.ke',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        mustChangePassword: true,
      } as any);
      prisma.user.findUnique.mockResolvedValueOnce({
        sessionsInvalidatedAt: null,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'fam-1',
        usedAt: null,
        revokedAt: null,
      } as any);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' } as any);
      prisma.refreshToken.update.mockResolvedValue({} as any);
      prisma.invalidatedToken.create.mockResolvedValue({} as any);

      const result = await service.refreshToken('1', 'old-jti', 'raw');
      expect(result.mustChangePassword).toBe(true);
    });

    it('returns the same 401 when the atomic claim loses a parallel race (count 0)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        familyId: 'fam-1',
        usedAt: null,
        revokedAt: null,
      } as any);
      // Another request beat us to the claim — count === 0 means no rows matched.
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 } as any);

      await expect(service.refreshToken('1', 'jti', 'raw')).rejects.toThrow(
        new UnauthorizedException('Refresh token has already been used'),
      );

      // No new pair issued — we lost the race.
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('legacy path still throws UnauthorizedException on P2002 (backwards compat)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        role: 'MEMBER',
        status: 'ACTIVE',
        mustChangePassword: false,
      } as any);
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      prisma.invalidatedToken.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.refreshToken('1', 'already-used-jti', 'raw'),
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

    it('clears injuryNotes when explicitly null', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
      } as any);
      prisma.user.update.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        injuryNotes: null,
      } as any);

      await service.updateProfile('1', {
        injuryNotes: null as unknown as string,
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ injuryNotes: null }) as Record<
            string,
            unknown
          >,
        }),
      );
    });
  });

  describe('completeOnboarding', () => {
    const validPayload: OnboardingDto = {
      experienceLevel: 'INTERMEDIATE',
      bodyweightKg: 72.5,
      heightCm: 175,
      sessionMinutes: 60,
      preferredTrainingDays: ['MON', 'WED', 'FRI'],
      sleepHoursAvg: 7.5,
      primaryMotivation: 'STRENGTH',
      injuryNotes: 'Mild right shoulder impingement',
    } as OnboardingDto;

    it('stamps onboardingCompletedAt and persists all fields', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: '1',
        email: 'test@test.com',
        onboardingCompletedAt: new Date(),
      } as any);

      const before = Date.now();
      await service.completeOnboarding('1', validPayload);
      const after = Date.now();

      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
      const call = prisma.user.updateMany.mock.calls[0][0];
      const data = call.data as Record<string, unknown>;
      expect(data).toMatchObject({
        experienceLevel: 'INTERMEDIATE',
        bodyweightKg: 72.5,
        heightCm: 175,
        sessionMinutes: 60,
        preferredTrainingDays: ['MON', 'WED', 'FRI'],
        sleepHoursAvg: 7.5,
        primaryMotivation: 'STRENGTH',
        injuryNotes: 'Mild right shoulder impingement',
      });
      const stamped = data.onboardingCompletedAt as Date;
      expect(stamped).toBeInstanceOf(Date);
      expect(stamped.getTime()).toBeGreaterThanOrEqual(before);
      expect(stamped.getTime()).toBeLessThanOrEqual(after);
    });

    it('uses atomic updateMany scoped to incomplete onboarding', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: '1' } as any);

      await service.completeOnboarding('1', validPayload);

      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '1', onboardingCompletedAt: null },
        }),
      );
    });

    it('throws BadRequestException when onboarding is already completed', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 } as any);
      prisma.user.findUnique.mockResolvedValue({ id: '1' } as any);

      await expect(
        service.completeOnboarding('1', validPayload),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the user does not exist', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 } as any);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.completeOnboarding('missing', validPayload),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('sanitizes injuryNotes by collapsing newlines and tabs', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 } as any);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: '1' } as any);

      await service.completeOnboarding('1', {
        ...validPayload,
        injuryNotes: 'Shoulder\n\tpain\ron left side',
      } as OnboardingDto);

      const call = prisma.user.updateMany.mock.calls[0][0];
      const data = call.data as { injuryNotes: string };
      expect(data.injuryNotes).not.toMatch(/[\n\r\t]/);
      expect(data.injuryNotes).toContain('Shoulder');
      expect(data.injuryNotes).toContain('pain');
      expect(data.injuryNotes).toContain('on left side');
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

      const result = await service.requestDeletion('1', {
        reason: 'Moving away',
      });
      expect(result.id).toBe('dr-1');
      expect(result.status).toBe('PENDING');
    });

    it('should throw ConflictException if pending request exists', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'dr-1',
        status: 'PENDING',
      } as any);

      await expect(service.requestDeletion('1', {})).rejects.toThrow(
        ConflictException,
      );
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
    it('should cancel a pending deletion request via atomic claim', async () => {
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 1,
      } as any);

      const result = await service.cancelDeletionRequest('1');
      expect(result.message).toContain('cancelled');
      expect(prisma.accountDeletionRequest.updateMany).toHaveBeenCalledWith({
        where: { userId: '1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    });

    it('should throw NotFoundException when no pending request exists', async () => {
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 0,
      } as any);

      await expect(service.cancelDeletionRequest('1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw a clean NotFoundException when admin approved concurrently (M9 race)', async () => {
      // Admin approved PENDING → APPROVED at the same moment member hits
      // cancel. The atomic claim sees 0 rows match (status is no longer
      // PENDING) and we surface the same "not found" error the old
      // check-then-write reported — no double transition, no 500.
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 0,
      } as any);

      await expect(service.cancelDeletionRequest('1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
