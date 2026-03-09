import { ConfigModule } from '@nestjs/config';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import paymentConfig from '../config/payment.config';
import sentryConfig from '../config/sentry.config';
import cloudinaryConfig from '../config/cloudinary.config';
import licensingConfig from '../../licensing/licensing.config';

export const ConfigLoaderModule = ConfigModule.forRoot({
  load: [
    appConfig,
    authConfig,
    mailConfig,
    paymentConfig,
    sentryConfig,
    cloudinaryConfig,
    licensingConfig,
  ],
  isGlobal: true,
  cache: true,
});
