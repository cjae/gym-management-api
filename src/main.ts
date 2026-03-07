import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, getAppConfigName } from './common/config/app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>(getAppConfigName())!;

  app.use(helmet());
  app.enableCors({ origin: [appConfig.adminUrl], credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const config = new DocumentBuilder()
    .setTitle('Gym Management API')
    .setDescription(
      'API for gym management platform — subscriptions, attendance, payments, trainers, and more.',
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .addBasicAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(appConfig.port);
}
bootstrap();
