import { ConfigModule } from '@nestjs/config';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import paymentConfig from '../config/payment.config';
import sentryConfig from '../config/sentry.config';

export const ConfigLoaderModule = ConfigModule.forRoot({
  load: [appConfig, authConfig, mailConfig, paymentConfig, sentryConfig],
  isGlobal: true,
  cache: true,
});
