import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthConfig, getAuthConfigName } from '../../common/config/auth.config';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: authConfig.jwtRefreshSecret,
      algorithms: ['HS256'],
      // Pass the raw request through to `validate` so we can surface the
      // opaque refresh token string (pre-parse) to the service layer for
      // hash-based lookup in the RefreshToken table (M4).
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    payload: {
      sub: string;
      email: string;
      role: string;
      jti: string;
      sessionsInvalidatedAt?: number;
    },
  ) {
    const invalidated = await this.prisma.invalidatedToken.findUnique({
      where: { jti: payload.jti },
    });

    if (invalidated) {
      throw new UnauthorizedException('Refresh token has been invalidated');
    }

    // Session version check (M3): a logout/reuse-detection event on the user
    // row invalidates every refresh token minted before `sessionsInvalidatedAt`.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { sessionsInvalidatedAt: true },
    });

    if (!user) {
      throw new UnauthorizedException('Refresh token has been invalidated');
    }

    const cutoff = user.sessionsInvalidatedAt?.getTime();
    const stamped = payload.sessionsInvalidatedAt ?? 0;
    if (cutoff !== undefined && stamped < cutoff) {
      throw new UnauthorizedException('Refresh token has been invalidated');
    }

    // Stash the raw refresh token on the Passport user so AuthService can
    // look it up by SHA-256 hash and run the reuse-detection / rotation
    // claim. Using the body field `refreshToken` mirrors fromBodyField above.
    const body = (req.body ?? {}) as { refreshToken?: string };
    const rawRefreshToken = body.refreshToken ?? '';

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
      rawRefreshToken,
    };
  }
}
