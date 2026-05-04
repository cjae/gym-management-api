import { Global, Module } from '@nestjs/common';
import { LicensingService } from './licensing.service';
import { LicensingController } from './licensing.controller';
import { LicenseCron } from './licensing.cron';
import { LicenseGuard } from './licensing.guard';
import { FeatureGuard } from './feature.guard';

@Global()
@Module({
  controllers: [LicensingController],
  providers: [LicensingService, LicenseCron, LicenseGuard, FeatureGuard],
  exports: [LicensingService, LicenseGuard, FeatureGuard],
})
export class LicensingModule {}
