import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthConfig, getAuthConfigName } from '../../common/config/auth.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: authConfig.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    jti: string;
    mustChangePassword?: boolean;
    // Epoch millis stamped into the token at sign time. Compared against the
    // user row's current `sessionsInvalidatedAt` on every request — any token
    // minted before that cutoff is rejected. See M3.
    sessionsInvalidatedAt?: number;
  }) {
    const invalidated = await this.prisma.invalidatedToken.findUnique({
      where: { jti: payload.jti },
    });

    if (invalidated) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    // Session version check (M3): reject any token whose stamped
    // `sessionsInvalidatedAt` is strictly older than the current value on the
    // user row. Closes the race where logout writes to InvalidatedToken *after*
    // /auth/refresh has already minted a new JTI the blocklist never saw.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { sessionsInvalidatedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    const cutoff = user.sessionsInvalidatedAt?.getTime();
    const stamped = payload.sessionsInvalidatedAt ?? 0;
    if (cutoff !== undefined && stamped < cutoff) {
      throw new UnauthorizedException('Token has been invalidated');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
      mustChangePassword: payload.mustChangePassword === true,
    };
  }
}
