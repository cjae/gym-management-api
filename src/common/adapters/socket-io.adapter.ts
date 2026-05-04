import { IoAdapter } from '@nestjs/platform-socket.io';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServerOptions } from 'socket.io';
import { AppConfig, getAppConfigName } from '../config/app.config';

export class SocketIoAdapter extends IoAdapter {
  readonly corsOrigins: string[];

  constructor(app: INestApplication) {
    super(app);
    const configService = app.get(ConfigService);
    const appConfig = configService.get<AppConfig>(getAppConfigName())!;
    this.corsOrigins = appConfig.adminUrl
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (this.corsOrigins.length === 0) {
      throw new Error(
        'SocketIoAdapter: ADMIN_URL resolved to an empty origin list — WebSocket connections would be blocked. Check your ADMIN_URL environment variable.',
      );
    }
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    });
  }
}
