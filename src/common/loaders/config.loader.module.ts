import { ConfigModule } from '@nestjs/config';
import appConfig from '../config/app.config';
import authConfig from '../config/auth.config';
import mailConfig from '../config/mail.config';
import paymentConfig from '../config/payment.config';
import sentryConfig from '../config/sentry.config';
import cloudinaryConfig from '../config/cloudinary.config';
import databaseConfig from '../config/database.config';
import licensingConfig from '../../licensing/licensing.config';
import llmConfig from '../config/llm.config';

export const ConfigLoaderModule = ConfigModule.forRoot({
  load: [
    appConfig,
    authConfig,
    databaseConfig,
    mailConfig,
    paymentConfig,
    sentryConfig,
    cloudinaryConfig,
    licensingConfig,
    llmConfig,
  ],
  isGlobal: true,
  cache: true,
});
