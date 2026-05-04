import './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, getAppConfigName } from './common/config/app.config';
import { AuthConfig, getAuthConfigName } from './common/config/auth.config';
import { createSwaggerBasicAuthMiddleware } from './common/middleware/swagger-basic-auth.middleware';
import { SocketIoAdapter } from './common/adapters/socket-io.adapter';

const SWAGGER_DESCRIPTION = `API for gym management platform — subscriptions, attendance, payments, trainers, classes and more.

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
  const authConfig = configService.get<AuthConfig>(getAuthConfigName())!;
  const logger = new Logger('Bootstrap');

  // Trust the reverse proxy (Nginx, Heroku router, etc) so `req.ip` is the
  // real client IP. Without this, `@nestjs/throttler` buckets every request
  // under the proxy's IP and rate limits become shared/bypassable.
  app.set('trust proxy', appConfig.trustProxyHops);

  app.set('query parser', 'extended');
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // Explicit, restrictive CSP. This is an API-only service (JSON responses),
  // so the CSP does not protect the API contract itself — it exists to
  // harden Swagger UI (gated behind Basic Auth in prod, see below) and any
  // error / 404 HTML pages Express may surface.
  //
  // Directive choices:
  //   default-src 'self'        — block anything not explicitly allowed
  //   script-src 'self'         — no inline scripts; Swagger UI loads its
  //                               init JS as an external /api/docs/*.js file,
  //                               so this works without 'unsafe-inline'
  //   style-src 'self' 'unsafe-inline'
  //                             — Swagger UI's HTML template contains a
  //                               <style> block and the widget injects inline
  //                               styles at runtime, both of which require
  //                               'unsafe-inline'
  //   img-src 'self' data:      — Swagger UI embeds small SVG/PNG icons
  //                               inline via data: URIs
  //   font-src 'self' data:     — Swagger UI bundles fonts as data URIs
  //   connect-src 'self'        — fetch/XHR only to this origin
  //   object-src 'none'         — no Flash / plugins
  //   frame-ancestors 'none'    — block iframing (clickjacking)
  //   base-uri 'self'           — block <base> tag injection
  //   form-action 'self'        — restrict where forms can submit
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  const corsOrigins = appConfig.adminUrl
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useWebSocketAdapter(new SocketIoAdapter(app));
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

  // Swagger UI exposes the full API surface (routes, DTOs, example payloads)
  // and is a high-value target for attackers mapping the system. Gate it
  // behind Basic Auth in all non-dev environments. If Basic Auth creds are
  // missing in prod (shouldn't happen — config factory throws — but defense
  // in depth) skip mounting Swagger entirely rather than serving it open.
  const isProdLike =
    appConfig.nodeEnv !== 'development' && appConfig.nodeEnv !== 'test';
  const hasBasicAuthCreds = Boolean(
    authConfig.basicAuthUser && authConfig.basicAuthPassword,
  );

  if (isProdLike && !hasBasicAuthCreds) {
    logger.warn(
      'Swagger UI disabled: BASIC_AUTH_USER / BASIC_AUTH_PASSWORD not configured',
    );
  } else {
    if (isProdLike) {
      const swaggerAuth = createSwaggerBasicAuthMiddleware(
        authConfig.basicAuthUser,
        authConfig.basicAuthPassword,
      );
      app.use(['/api/docs', '/api/docs-json'], swaggerAuth);
    }

    const config = new DocumentBuilder()
      .setTitle('Gym Management API')
      .setDescription(SWAGGER_DESCRIPTION)
      .setVersion('0.0.1')
      .addBearerAuth()
      .addBasicAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(appConfig.port);
}
void bootstrap();
