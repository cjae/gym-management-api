import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LicensingService } from './licensing.service';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly licensingService: LicensingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const url: string = request.url;

    if (url.startsWith('/api/health')) return true;

    const active = await this.licensingService.isActive();
    if (!active) {
      throw new ServiceUnavailableException(
        "This gym's subscription is inactive. Contact your administrator.",
      );
    }

    return true;
  }
}
