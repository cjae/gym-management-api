import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, getAppConfigName } from './common/config/app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>(getAppConfigName())!;

  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

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
      `API for gym management platform — subscriptions, attendance, payments, trainers, and more.

## WebSocket: Activity Feed

Real-time activity events are available via Socket.IO at the \`/activity\` namespace.

**Connection:**
\`\`\`
const socket = io("/activity", { auth: { token: "<JWT>" } });
\`\`\`

**Authentication:** Pass a valid JWT in \`auth.token\`. Only ADMIN and SUPER_ADMIN roles are accepted. Invalidated tokens are rejected.

**Event:** \`activity\`

**Payload:**
| Field | Type | Description |
|-------|------|-------------|
| type | \`"registration" \\| "check_in" \\| "payment" \\| "subscription"\` | Event type |
| description | string | Human-readable description |
| timestamp | string (ISO 8601) | When the event occurred |
| metadata | object (optional) | Additional context (memberId, amount, etc.) |`,
    )
    .setVersion('0.0.1')
    .addBearerAuth()
    .addBasicAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(appConfig.port);
}
void bootstrap();
