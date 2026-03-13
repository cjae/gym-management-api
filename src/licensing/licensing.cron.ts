import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LicensingService } from './licensing.service';

@Injectable()
export class LicenseCron {
  private readonly logger = new Logger(LicenseCron.name);

  constructor(private readonly licensingService: LicensingService) {}

  @Cron('0 3 * * *', { timeZone: 'Africa/Nairobi' })
  async handleLicenseValidation(): Promise<void> {
    this.logger.log('Running daily license validation...');
    await this.licensingService.validateLicense();
  }
}
