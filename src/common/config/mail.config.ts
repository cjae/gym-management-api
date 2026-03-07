import { registerAs } from '@nestjs/config';

export type MailConfig = {
  apiKey: string;
  domain: string;
  from: string;
  enabled: boolean;
};

export const getMailConfigName = () => 'mail';

export const getMailConfig = (): MailConfig => {
  const apiKey = process.env.MAILGUN_API_KEY ?? '';
  const domain = process.env.MAILGUN_DOMAIN ?? '';
  const from = process.env.MAIL_FROM || `noreply@${domain}`;
  const enabled = !!(apiKey && domain);

  return { apiKey, domain, from, enabled };
};

export default registerAs(getMailConfigName(), getMailConfig);
