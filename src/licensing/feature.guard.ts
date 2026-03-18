import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from './decorators/requires-feature.decorator';
import { LicensingService } from './licensing.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensingService: LicensingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) return true;

    const hasFeature = await this.licensingService.hasFeature(requiredFeature);
    if (!hasFeature) {
      throw new ForbiddenException(
        'This feature is not available on your current plan.',
      );
    }

    return true;
  }
}
