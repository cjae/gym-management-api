import { registerAs } from '@nestjs/config';

export type LicensingConfig = {
  licenseKey: string;
  licenseServerUrl: string;
  /**
   * When true (default), the exact member count is sent to the license
   * server for tier-cap enforcement. When false, the count is bucketed
   * (e.g. "<100", "<500") before being sent — recommended for
   * privacy-conscious deployments that still want tier enforcement but
   * don't want to leak their exact customer base size.
   */
  telemetryMemberCount: boolean;
  /**
   * Version string sent in the phone-home payload. Falls back to
   * `npm_package_version` (set by yarn/npm at runtime) and finally to
   * '0.0.0-unknown' so the server always gets a value.
   */
  appVersion: string;
};

export const getLicensingConfigName = () => 'licensing';

const parseTelemetryFlag = (raw: string | undefined): boolean => {
  if (raw === undefined) return true; // default: send exact count
  return raw.toLowerCase() !== 'false';
};

export const getLicensingConfig = (): LicensingConfig => ({
  licenseKey: process.env.LICENSE_KEY ?? '',
  licenseServerUrl: process.env.LICENSE_SERVER_URL ?? '',
  telemetryMemberCount: parseTelemetryFlag(
    process.env.LICENSE_TELEMETRY_MEMBER_COUNT,
  ),
  appVersion:
    process.env.APP_VERSION ??
    process.env.npm_package_version ??
    '0.0.0-unknown',
});

export default registerAs(getLicensingConfigName(), getLicensingConfig);
