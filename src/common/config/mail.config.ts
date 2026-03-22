import { registerAs } from '@nestjs/config';

export type MailConfig = {
  apiKey: string;
  domain: string;
  from: string;
  enabled: boolean;
  region: 'us' | 'eu';
};

export const getMailConfigName = () => 'mail';

export const getMailConfig = (): MailConfig => {
  const apiKey = process.env.MAILGUN_API_KEY ?? '';
  const domain = process.env.MAILGUN_DOMAIN ?? '';
  const from = process.env.MAIL_FROM || `noreply@${domain}`;
  const region = (process.env.MAILGUN_REGION || 'us').toLowerCase() as
    | 'us'
    | 'eu';
  const enabled = !!(apiKey && domain);

  return { apiKey, domain, from, enabled, region };
};

export default registerAs(getMailConfigName(), getMailConfig);
