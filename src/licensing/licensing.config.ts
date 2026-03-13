import { registerAs } from '@nestjs/config';

export type LicensingConfig = {
  licenseKey: string;
  licenseServerUrl: string;
};

export const getLicensingConfigName = () => 'licensing';

export const getLicensingConfig = (): LicensingConfig => ({
  licenseKey: process.env.LICENSE_KEY ?? '',
  licenseServerUrl: process.env.LICENSE_SERVER_URL ?? '',
});

export default registerAs(getLicensingConfigName(), getLicensingConfig);
