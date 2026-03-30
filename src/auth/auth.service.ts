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
import { safeUserSelect } from '../common/constants/safe-user-select';
import { generateReferralCode } from '../common/utils/referral-code.util';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'crypto';

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

  async refreshToken(userId: string, oldRefreshJti: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt)
      throw new UnauthorizedException('User not found or inactive');

    // Invalidate old refresh token (rotation)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.invalidatedToken.create({
        data: { jti: oldRefreshJti, expiresAt },
      });
    } catch (error: unknown) {
      // Unique constraint violation = token replay
      if (
        error instanceof Object &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new UnauthorizedException('Refresh token has already been used');
      }
      throw error;
    }

    return this.generateTokens(
      user.id,
      user.email,
      user.role,
      user.mustChangePassword,
    );
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
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token: hashedToken },
    });

    if (!resetToken)
      throw new BadRequestException('Invalid or expired reset token');
    if (resetToken.usedAt)
      throw new BadRequestException('Invalid or expired reset token');
    if (resetToken.expiresAt < new Date())
      throw new BadRequestException('Invalid or expired reset token');

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword, mustChangePassword: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    this.auditLogService
      .log({
        userId: resetToken.userId,
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
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.getProfile(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
      },
      select: safeUserSelect,
    });
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

    await this.prisma.invalidatedToken.create({
      data: { jti, expiresAt },
    });

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
    const request = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (!request) {
      throw new NotFoundException('No pending deletion request found');
    }

    await this.prisma.accountDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
    });

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
  ) {
    const authConfig = this.configService.get<AuthConfig>(getAuthConfigName())!;
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email, role, jti: accessJti },
        { expiresIn: '30m' },
      ),
      this.jwtService.signAsync(
        { sub: userId, email, role, jti: refreshJti },
        { expiresIn: '7d', secret: authConfig.jwtRefreshSecret },
      ),
    ]);
    const ACCESS_TOKEN_EXPIRY_SECONDS = 1800; // 30m
    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      mustChangePassword,
    };
  }
}
