import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
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
    });
  }

  async validate(payload: {
    sub: string;
    email: string;
    role: string;
    jti: string;
  }) {
    const invalidated = await this.prisma.invalidatedToken.findUnique({
      where: { jti: payload.jti },
    });

    if (invalidated) {
      throw new UnauthorizedException('Refresh token has been invalidated');
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
    };
  }
}
