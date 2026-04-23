import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_WHILE_MUST_CHANGE_PASSWORD_KEY } from '../decorators/allow-while-must-change-password.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { mustChangePassword?: boolean } }>();

    if (request.user?.mustChangePassword === true) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_WHILE_MUST_CHANGE_PASSWORD_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Password change required. Please change your temporary password to continue.',
        );
      }
    }

    return true;
  }
}
