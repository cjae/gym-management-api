import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { AuditLogService } from './audit-logs.service';
import { NO_AUDIT_KEY } from './decorators/no-audit.decorator';
import type { AuditAction } from '@prisma/client';

interface JwtUser {
  sub: string;
  email: string;
  role: string;
}

interface AuditRequest {
  method: string;
  user?: JwtUser;
  params: Record<string, string>;
  body: Record<string, unknown>;
  ip: string;
  headers: Record<string, string>;
  url: string;
}

const AUDITABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDITABLE_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

const METHOD_ACTION_MAP: Record<string, AuditAction> = {
  POST: 'CREATE' as AuditAction,
  PUT: 'UPDATE' as AuditAction,
  PATCH: 'UPDATE' as AuditAction,
  DELETE: 'DELETE' as AuditAction,
};

const CONTROLLER_RESOURCE_MAP: Record<string, string> = {
  UsersController: 'User',
  SubscriptionPlansController: 'SubscriptionPlan',
  SubscriptionsController: 'Subscription',
  PaymentsController: 'Payment',
  AttendanceController: 'Attendance',
  TrainersController: 'Trainer',
  LegalController: 'Legal',
  SalaryController: 'Salary',
  EntrancesController: 'Entrance',
  QrController: 'QrCode',
  BillingController: 'Billing',
  UploadsController: 'Upload',
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly reflector: Reflector,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> | Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    const { method, user } = request;

    // Skip if not an auditable method
    if (!AUDITABLE_METHODS.has(method)) {
      return next.handle();
    }

    // Skip if no user or non-auditable role
    if (!user || !AUDITABLE_ROLES.has(user.role)) {
      return next.handle();
    }

    // Skip if @NoAudit() decorator is present
    const noAudit = this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (noAudit) {
      return next.handle();
    }

    const controllerName = context.getClass().name;
    const resource = this.getResourceName(controllerName);
    const resourceId = request.params?.id;
    const action = METHOD_ACTION_MAP[method];
    const route = `${method} ${request.url}`;
    const userAgent = request.headers?.['user-agent'];

    // For UPDATE/DELETE, fetch old data before handler runs
    const needsOldData =
      (method === 'PUT' || method === 'PATCH' || method === 'DELETE') &&
      resourceId;

    const oldDataPromise = needsOldData
      ? this.auditLogService.fetchOldData(resource, resourceId)
      : Promise.resolve(null);

    return from(oldDataPromise).pipe(
      switchMap((oldData) =>
        next.handle().pipe(
          tap({
            next: (responseBody) => {
              this.auditLogService
                .log({
                  userId: user.sub,
                  action,
                  resource,
                  resourceId,
                  oldData: oldData ?? undefined,
                  newData: responseBody as Record<string, unknown> | undefined,
                  ipAddress: request.ip,
                  userAgent,
                  route,
                })
                .catch((error: Error) => {
                  this.logger.error(
                    `Failed to write audit log: ${error.message}`,
                    error.stack,
                  );
                });
            },
          }),
        ),
      ),
    );
  }

  private getResourceName(controllerName: string): string {
    return (
      CONTROLLER_RESOURCE_MAP[controllerName] ??
      controllerName.replace(/Controller$/, '')
    );
  }
}
