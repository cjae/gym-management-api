import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { BasicStrategy as Strategy } from 'passport-http';
import * as crypto from 'crypto';
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
    // Fail-closed runtime guard: if EITHER credential is blank we reject.
    // Boot-time config enforcement (see auth.config.ts) throws outside
    // dev/test when these envs are missing, but we still defend at runtime
    // so a dev/test misconfiguration can't accidentally grant access.
    if (!this.expectedUser || !this.expectedPass) {
      throw new UnauthorizedException('Basic auth not configured');
    }

    // Timing-safe comparison: hash both candidate and expected values to
    // fixed 32-byte digests, then `crypto.timingSafeEqual`. Hashing first
    // ensures equal-length buffers so `timingSafeEqual` never early-returns
    // on length mismatch, and side-steps the short-circuit in `&&` between
    // the two comparisons.
    const userOk = timingSafeEqualStrings(username, this.expectedUser);
    const passOk = timingSafeEqualStrings(password, this.expectedPass);

    if (userOk && passOk) {
      return true;
    }

    throw new UnauthorizedException('Invalid credentials');
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aHash = crypto.createHash('sha256').update(a).digest();
  const bHash = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}
