import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import * as Sentry from '@sentry/nestjs';

interface JwtUser {
  id: string;
  email: string;
  role: string;
  jti: string;
  mustChangePassword: boolean;
}

interface AuthenticatedRequest extends Request {
  user?: JwtUser;
}

@Injectable()
export class SentryUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (user) {
      // Only id + role. Email is PII and must not be copied into Sentry's
      // 3rd-party pipeline. Omitting `email`/`username` here prevents the
      // Sentry JS SDK from populating those fields on the event payload.
      Sentry.setUser({
        id: user.id,
        role: user.role,
      });
    }
    return next.handle();
  }
}
