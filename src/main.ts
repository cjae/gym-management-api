import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, getAppConfigName } from './common/config/app.config';

const SWAGGER_DESCRIPTION = `API for gym management platform — subscriptions, attendance, payments, trainers, and more.

## WebSocket: Activity Feed

Real-time activity events are available via Socket.IO at the \`/activity\` namespace.

**Connection:**
\`\`\`
const socket = io("/activity", { auth: { token: "<JWT>" } });
// For entrance-specific events:
const socket = io("/activity", { auth: { token: "<JWT>" }, query: { entranceId: "<UUID>" } });
\`\`\`

**Authentication:** Pass a valid JWT in \`auth.token\`. Only ADMIN and SUPER_ADMIN roles are accepted. Invalidated tokens are rejected.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| entranceId | string (optional) | Join an entrance-specific room to receive targeted \`check_in_result_entrance\` events |

### Event: \`activity\`
Emitted for general gym activity (admin dashboard feed).

| Field | Type | Description |
|-------|------|-------------|
| type | \`"registration" \\| "check_in" \\| "payment" \\| "subscription"\` | Event type |
| description | string | Human-readable description |
| timestamp | string (ISO 8601) | When the event occurred |
| metadata | object (optional) | Additional context (memberId, amount, etc.) |

### Event: \`check_in_result\`
Emitted after a member scans the QR code at the entrance. Used by the entrance screen to show check-in feedback.

| Field | Type | Description |
|-------|------|-------------|
| type | \`"check_in_result"\` | Always \`"check_in_result"\` |
| member | object | \`{ id, firstName, lastName, displayPicture }\` |
| success | boolean | Whether the check-in was accepted |
| message | string | Human-readable result message |
| entranceId | string (optional) | The entrance where the check-in occurred |
| timestamp | string (ISO 8601) | When the event occurred |

### Event: \`check_in_result_entrance\`
Emitted only to clients in the entrance-specific room (joined via \`entranceId\` query param). Same payload as \`check_in_result\`, scoped to a single entrance. Use this for entrance display screens that only need their own check-ins.

### Event: \`qr_rotated\`
Emitted when the gym entrance QR code is rotated. Clients displaying the QR should refresh.

| Field | Type | Description |
|-------|------|-------------|
| type | \`"qr_rotated"\` | Always \`"qr_rotated"\` |
| timestamp | string (ISO 8601) | When the rotation occurred |`;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>(getAppConfigName())!;

  app.set('query parser', 'extended');
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
    .setDescription(SWAGGER_DESCRIPTION)
    .setVersion('0.0.1')
    .addBearerAuth()
    .addBasicAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(appConfig.port);
}
void bootstrap();
