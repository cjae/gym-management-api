import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { LicensingService } from '../licensing/licensing.service';
import { AuditLogService } from '../audit-logs/audit-logs.service';
import { AuthConfig, getAuthConfigName } from '../common/config/auth.config';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { safeUserSelect } from '../common/constants/safe-user-select';
import { generateReferralCode } from '../common/utils/referral-code.util';
import { sanitizeText } from '../common/utils/sanitize-text';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'crypto';

// Precomputed dummy bcrypt hash used to keep login response time constant
// when the email does not exist. Without this, an attacker can enumerate
// valid emails by timing: a user-not-found path skips bcrypt.compare and
// returns ~100ms faster than a wrong-password path.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync(
  'dummy-password-for-timing-parity',
  10,
);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly licensingService: LicensingService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing && !existing.deletedAt)
      throw new ConflictException('Email already registered');

    const maxMembers = await this.licensingService.getMemberLimit();
    if (maxMembers !== null) {
      const currentCount = await this.prisma.user.count({
        where: { role: 'MEMBER', deletedAt: null },
      });
      if (currentCount >= maxMembers) {
        throw new ForbiddenException(
          'Member limit reached for your subscription tier.',
        );
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const now = new Date();

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const user = await this.prisma.user.create({
          data: {
            email: dto.email,
            password: hashedPassword,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            tosAcceptedAt: now,
            waiverAcceptedAt: now,
            referralCode: generateReferralCode(),
          },
        });

        // Handle referral (soft fail — invalid codes don't block registration)
        if (dto.referralCode) {
          try {
            const referrer = await this.prisma.user.findUnique({
              where: { referralCode: dto.referralCode },
            });
            if (
              referrer &&
              referrer.status === 'ACTIVE' &&
              !referrer.deletedAt &&
              referrer.id !== user.id
            ) {
              await this.prisma.$transaction([
                this.prisma.user.update({
                  where: { id: user.id },
                  data: { referredById: referrer.id },
                }),
                this.prisma.referral.create({
                  data: {
                    referrerId: referrer.id,
                    referredId: user.id,
                  },
                }),
              ]);
            }
          } catch {
            // Soft fail — don't block registration for referral issues
          }
        }

        this.eventEmitter.emit('activity.registration', {
          type: 'registration',
          description: `${user.firstName} ${user.lastName} registered as a new member`,
          timestamp: new Date().toISOString(),
          metadata: { memberId: user.id },
        });

        this.emailService
          .sendSelfRegistrationWelcomeEmail(user.email, user.firstName)
          .catch(() => {
            // Non-blocking — don't fail registration if email fails
          });

        return this.generateTokens(user.id, user.email, user.role, false);
      } catch (error: unknown) {
        if (
          error instanceof Object &&
          'code' in error &&
          error.code === 'P2002' &&
          'meta' in error &&
          error.meta instanceof Object &&
          'target' in error.meta &&
          Array.isArray(error.meta.target) &&
          error.meta.target.includes('referralCode')
        ) {
          if (attempt === 2) throw error;
          continue;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException('Failed to create user');
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.deletedAt) {
      // Run bcrypt against a dummy hash so the unknown-email path takes
      // roughly the same time as the wrong-password path. Defeats email
      // enumeration via response timing. Result is discarded.
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      this.auditLogService
        .log({
          userId: null,
          action: AuditAction.LOGIN_FAILED,
          resource: 'Auth',
          ipAddress,
          userAgent,
          route: 'POST /api/v1/auth/login',
          metadata: { email: dto.email },
        })
        .catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      this.auditLogService
        .log({
          userId: user.id,
          action: AuditAction.LOGIN_FAILED,
          resource: 'Auth',
          ipAddress,
          userAgent,
          route: 'POST /api/v1/auth/login',
          metadata: { email: dto.email },
        })
        .catch(() => {});
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        'Account is ' + user.status.toLowerCase(),
      );
    }

    this.auditLogService
      .log({
        userId: user.id,
        action: AuditAction.LOGIN,
        resource: 'Auth',
        ipAddress,
        userAgent,
        route: 'POST /api/v1/auth/login',
      })
      .catch(() => {});

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.mustChangePassword,
    );
  }

  async refreshToken(
    userId: string,
    oldRefreshJti: string,
    rawRefreshToken: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt)
      throw new UnauthorizedException('User not found or inactive');

    // Look up the refresh token record by hash (M4). Rows inserted at issuance
    // time carry the familyId for family-wide revocation on reuse.
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    // Unknown refresh token — either legacy (pre-migration) issuance or a
    // token whose row was never persisted. Fall through to the legacy
    // InvalidatedToken rotation path so existing sessions keep working during
    // the rollout window.
    if (!stored) {
      return this.legacyRefreshRotation(
        user.id,
        user.email,
        user.role,
        user.mustChangePassword,
        oldRefreshJti,
      );
    }

    // REUSE DETECTED (M4): this token has already been rotated. Treat the
    // whole family as compromised — revoke every sibling and bump the user's
    // session cutoff so every outstanding access/refresh token (including any
    // new pair the attacker may have minted) is rejected on next use.
    if (stored.usedAt !== null || stored.revokedAt !== null) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        this.prisma.user.update({
          where: { id: user.id },
          data: { sessionsInvalidatedAt: new Date() },
        }),
      ]);

      this.auditLogService
        .log({
          userId: user.id,
          action: AuditAction.AUTH_REFRESH_REUSE,
          resource: 'Auth',
          route: 'POST /api/v1/auth/refresh',
          metadata: {
            familyId: stored.familyId,
            reusedJti: oldRefreshJti,
          },
        })
        .catch(() => {});

      // Same 401 the legitimate-user-with-expired-token path would get — do
      // not leak "reuse detected" to clients.
      throw new UnauthorizedException('Refresh token has already been used');
    }

    // Atomic claim: flip usedAt from null → now only if still null. Losers
    // of any parallel race fall into the reuse path on their next attempt.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });

    if (claim.count === 0) {
      // We lost the race — another parallel /auth/refresh beat us. Treat as
      // reuse on the *next* attempt; for this one, fail with the same 401.
      throw new UnauthorizedException('Refresh token has already been used');
    }

    // Old InvalidatedToken blocklist entry preserved for backwards compat —
    // still effective for immediate single-JTI revocation.
    try {
      const invalidatedExpiresAt = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      );
      await this.prisma.invalidatedToken.create({
        data: { jti: oldRefreshJti, expiresAt: invalidatedExpiresAt },
      });
    } catch (error: unknown) {
      // Blocklist insert is best-effort; the updateMany claim above is the
      // authoritative single-use gate. A P2002 here means someone else already
      // recorded this JTI as invalidated — not a reuse condition we can prove.
      if (
        !(error instanceof Object && 'code' in error && error.code === 'P2002')
      ) {
        throw error;
      }
    }

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.mustChangePassword,
      {
        familyId: stored.familyId,
        replacesRefreshTokenId: stored.id,
      },
    );
  }

  // Legacy rotation path for tokens issued before the RefreshToken table
  // existed. Keeps the previous InvalidatedToken-based single-use gate so
  // clients with pre-migration refresh tokens can still rotate into the new
  // family-aware scheme. Remove after the 7-day refresh lifetime elapses.
  private async legacyRefreshRotation(
    userId: string,
    email: string,
    role: string,
    mustChangePassword: boolean,
    oldRefreshJti: string,
  ) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.invalidatedToken.create({
        data: { jti: oldRefreshJti, expiresAt },
      });
    } catch (error: unknown) {
      if (
        error instanceof Object &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new UnauthorizedException('Refresh token has already been used');
      }
      throw error;
    }

    return this.generateTokens(userId, email, role, mustChangePassword);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always return success to prevent email enumeration
    if (!user)
      return {
        message:
          'If an account with that email exists, a reset link has been sent.',
      };

    const token = randomBytes(32).toString('hex');
    const hashedToken = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: hashedToken,
        expiresAt,
      },
    });

    await this.emailService.sendPasswordResetEmail(
      user.email,
      user.firstName,
      token,
    );

    this.auditLogService
      .log({
        userId: user.id,
        action: AuditAction.PASSWORD_RESET_REQUEST,
        resource: 'Auth',
        route: 'POST /api/v1/auth/forgot-password',
        metadata: { email: dto.email },
      })
      .catch(() => {});

    return {
      message:
        'If an account with that email exists, a reset link has been sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hashedToken = this.hashToken(dto.token);
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    const userId = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: mark the token used only if it is still unused and not expired.
      // Returning count === 1 guarantees we are the sole winner of any race.
      const claim = await tx.passwordResetToken.updateMany({
        where: {
          token: hashedToken,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (claim.count === 0) {
        // Same user-facing error for missing / already-used / expired — no enumeration delta.
        throw new BadRequestException('Invalid or expired reset token');
      }

      // Safe to re-read now that we have exclusively claimed the token.
      const claimed = await tx.passwordResetToken.findUnique({
        where: { token: hashedToken },
        select: { userId: true },
      });
      if (!claimed) {
        throw new BadRequestException('Invalid or expired reset token');
      }

      await tx.user.update({
        where: { id: claimed.userId },
        data: { password: hashedPassword, mustChangePassword: false },
      });

      return claimed.userId;
    });

    this.auditLogService
      .log({
        userId,
        action: AuditAction.PASSWORD_RESET,
        resource: 'Auth',
        route: 'POST /api/v1/auth/reset-password',
      })
      .catch(() => {});

    return { message: 'Password has been reset successfully.' };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const passwordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!passwordValid)
      throw new UnauthorizedException('Current password is incorrect');

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, mustChangePassword: false },
    });

    this.auditLogService
      .log({
        userId,
        action: AuditAction.PASSWORD_CHANGE,
        resource: 'Auth',
        route: 'PATCH /api/v1/auth/change-password',
      })
      .catch(() => {});

    return { message: 'Password changed successfully.' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: safeUserSelect,
    });
    if (!user) throw new UnauthorizedException('User not found');
    return this.withOnboardingFlag(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.getProfile(userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        injuryNotes:
          dto.injuryNotes === undefined
            ? undefined
            : dto.injuryNotes === null
              ? null
              : sanitizeText(dto.injuryNotes),
      },
      select: safeUserSelect,
    });
    return this.withOnboardingFlag(updated);
  }

  async completeOnboarding(userId: string, dto: OnboardingDto) {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, onboardingCompletedAt: null },
      data: {
        experienceLevel: dto.experienceLevel,
        bodyweightKg: dto.bodyweightKg,
        heightCm: dto.heightCm,
        sessionMinutes: dto.sessionMinutes,
        preferredTrainingDays: dto.preferredTrainingDays,
        sleepHoursAvg: dto.sleepHoursAvg,
        primaryMotivation: dto.primaryMotivation,
        injuryNotes:
          dto.injuryNotes != null ? sanitizeText(dto.injuryNotes) : null,
        onboardingCompletedAt: new Date(),
      },
    });

    if (result.count === 0) {
      const existing = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!existing) throw new UnauthorizedException('User not found');
      throw new BadRequestException(
        'Onboarding already completed — use PATCH /auth/me to update personalization.',
      );
    }

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: safeUserSelect,
    });
    return this.withOnboardingFlag(updated);
  }

  private withOnboardingFlag<T extends { onboardingCompletedAt?: Date | null }>(
    user: T,
  ): T & { onboardingCompleted: boolean } {
    return {
      ...user,
      onboardingCompleted: Boolean(user.onboardingCompletedAt),
    };
  }

  async logout(
    jti: string,
    userId?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    // Calculate when the token expires (30m from now is the max for access tokens)
    // We store until 7d to also cover refresh tokens that share the same jti pattern
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Bump the user's sessionsInvalidatedAt BEFORE writing the JTI blocklist
    // entry. This closes the race between logout and a parallel /auth/refresh
    // that's already minted a new token: the new token's stamped
    // `sessionsInvalidatedAt` predates the user's current value, so it fails
    // the JwtStrategy version check on its next request. See M3.
    //
    // We also revoke every outstanding refresh token in every family so the
    // attacker can't continue rotating on stolen tokens.
    if (userId) {
      const now = new Date();
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: userId },
          data: { sessionsInvalidatedAt: now },
        }),
        this.prisma.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
    }

    // InvalidatedToken is retained for immediate single-JTI revocation; the
    // session-version check above is the authoritative gate.
    try {
      await this.prisma.invalidatedToken.create({
        data: { jti, expiresAt },
      });
    } catch (error: unknown) {
      // A duplicate write (e.g. double-tap logout) is idempotent — not a failure.
      if (
        !(error instanceof Object && 'code' in error && error.code === 'P2002')
      ) {
        throw error;
      }
    }

    if (userId) {
      this.auditLogService
        .log({
          userId,
          action: AuditAction.LOGOUT,
          resource: 'Auth',
          ipAddress,
          userAgent,
          route: 'POST /api/v1/auth/logout',
        })
        .catch(() => {});
    }

    return { message: 'Logged out successfully.' };
  }

  async requestDeletion(userId: string, dto: { reason?: string }) {
    const existing = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (existing) {
      throw new ConflictException(
        'You already have a pending deletion request',
      );
    }

    return this.prisma.accountDeletionRequest.create({
      data: { userId, reason: dto.reason },
    });
  }

  async getDeletionRequest(userId: string) {
    return this.prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelDeletionRequest(userId: string) {
    // Atomic claim: only the caller who flips PENDING → CANCELLED wins the
    // race against a concurrent admin approve/reject. If count === 0 the
    // request is no longer PENDING, so we report the same "not found" error
    // the previous check-then-write used — no double-transition possible.
    const result = await this.prisma.accountDeletionRequest.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    if (result.count === 0) {
      throw new NotFoundException('No pending deletion request found');
    }

    return { message: 'Deletion request cancelled successfully.' };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    mustChangePassword: boolean,
    rotation?: {
      familyId: string;
      replacesRefreshTokenId: string;
    },
  ) {
    const authConfig = this.configService.get<AuthConfig>(getAuthConfigName())!;
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    // Stamp the current session-version cutoff into both tokens. Any
    // subsequent logout / reuse-detection event bumps the user row's
    // `sessionsInvalidatedAt` beyond this stamp, causing both strategies to
    // reject this pair on the next request. See M3.
    const userRow = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { sessionsInvalidatedAt: true },
    });
    const sessionsInvalidatedAt =
      userRow?.sessionsInvalidatedAt?.getTime() ?? 0;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
          role,
          jti: accessJti,
          mustChangePassword,
          sessionsInvalidatedAt,
        },
        { expiresIn: '30m' },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
          role,
          jti: refreshJti,
          mustChangePassword,
          sessionsInvalidatedAt,
        },
        { expiresIn: '7d', secret: authConfig.jwtRefreshSecret },
      ),
    ]);

    // Persist the refresh token row (M4). Login/register start a new family;
    // /auth/refresh rotations carry the family forward and link back via
    // `replacedById`, so the full rotation chain is auditable.
    const refreshTokenRow = await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: rotation?.familyId ?? randomUUID(),
        tokenHash: this.hashToken(refreshToken),
        jti: refreshJti,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    if (rotation?.replacesRefreshTokenId) {
      // Best-effort link — unique constraint on replacedById means a second
      // rotation attempt against the same predecessor will fail, which is
      // the desired behavior (only one successor per ancestor).
      await this.prisma.refreshToken
        .update({
          where: { id: rotation.replacesRefreshTokenId },
          data: { replacedById: refreshTokenRow.id },
        })
        .catch(() => {
          // Swallowed intentionally — the usedAt claim above already gates
          // single-use, so a failed replacement link is non-fatal.
        });
    }

    const ACCESS_TOKEN_EXPIRY_SECONDS = 1800; // 30m
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      mustChangePassword,
    };
  }
}
