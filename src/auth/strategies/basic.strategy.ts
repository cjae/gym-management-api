import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { BasicStrategy as Strategy } from 'passport-http';
import { AuthConfig, getAuthConfigName } from '../../common/config/auth.config';

@Injectable()
export class BasicStrategy extends PassportStrategy(Strategy) {
  private readonly expectedUser: string;
  private readonly expectedPass: string;

  constructor(configService: ConfigService) {
    super();
    const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
    this.expectedUser = authConfig.basicAuthUser;
    this.expectedPass = authConfig.basicAuthPassword;
  }

  validate(username: string, password: string): boolean {
    if (!this.expectedUser || !this.expectedPass) {
      throw new UnauthorizedException('Basic auth not configured');
    }

    if (username === this.expectedUser && password === this.expectedPass) {
      return true;
    }

    throw new UnauthorizedException('Invalid credentials');
  }
}
