import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthConfig, getAuthConfigName } from '../common/config/auth.config';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { safeUserSelect } from '../common/constants/safe-user-select';
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
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
      },
    });

    this.eventEmitter.emit('activity.registration', {
      type: 'registration',
      description: `${user.firstName} ${user.lastName} registered as a new member`,
      timestamp: new Date().toISOString(),
      metadata: { memberId: user.id },
    });

    return this.generateTokens(user.id, user.email, user.role, false);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

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
    if (!user || user.status !== 'ACTIVE')
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
      data: dto,
      select: safeUserSelect,
    });
  }

  async logout(jti: string) {
    // Calculate when the token expires (30m from now is the max for access tokens)
    // We store until 7d to also cover refresh tokens that share the same jti pattern
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.invalidatedToken.create({
      data: { jti, expiresAt },
    });

    return { message: 'Logged out successfully.' };
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
