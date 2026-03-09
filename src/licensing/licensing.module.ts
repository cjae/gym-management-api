import { Global, Module } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { LicenseCron } from './licensing.cron';
import { LicenseGuard } from './licensing.guard';

@Global()
@Module({
  providers: [LicensingService, LicenseCron, LicenseGuard],
  exports: [LicensingService, LicenseGuard],
})
export class LicensingModule {}
