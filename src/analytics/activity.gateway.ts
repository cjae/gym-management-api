import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { AuthConfig, getAuthConfigName } from '../common/config/auth.config';

export interface ActivityEvent {
  type: 'registration' | 'check_in' | 'payment' | 'subscription';
  description: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CheckInResultEvent {
  type: 'check_in_result';
  member: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayPicture: string | null;
  };
  success: boolean;
  message: string;
  entranceId?: string;
  timestamp: string;
}

export interface QrRotatedEvent {
  type: 'qr_rotated';
  timestamp: string;
}

// WebSocket CORS origin allowlist. `@WebSocketGateway` options are static so
// we read the env at module load. Mirrors the HTTP CORS config in `main.ts`
// (which uses `ADMIN_URL`). Native mobile clients connect without an Origin
// header and are unaffected by CORS — only browser clients are gated here.
// Comma-separated values in `ADMIN_URL` are supported for multi-origin setups.
const wsOrigins = (process.env.ADMIN_URL || 'http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: '/activity',
  cors: { origin: wsOrigins, credentials: true },
})
export class ActivityGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ActivityGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth as Record<string, string>)?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const authConfig =
        this.configService.get<AuthConfig>(getAuthConfigName())!;
      const payload: { sub: string; role: string; jti: string } =
        await this.jwtService.verifyAsync(token, {
          secret: authConfig.jwtSecret,
        });

      // Check token not invalidated
      const invalidated = await this.prisma.invalidatedToken.findUnique({
        where: { jti: payload.jti },
      });
      if (invalidated) {
        client.disconnect();
        return;
      }

      // Only allow ADMIN and SUPER_ADMIN
      if (!['ADMIN', 'SUPER_ADMIN'].includes(payload.role)) {
        client.disconnect();
        return;
      }

      // Join entrance-specific room if entranceId provided
      const entranceId = client.handshake.query?.entranceId as
        | string
        | undefined;
      if (entranceId) {
        await client.join(`entrance:${entranceId}`);
        this.logger.log(`Screen joined entrance room: ${entranceId}`);
      }

      this.logger.log(`Admin connected: ${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  @OnEvent('activity.registration')
  handleRegistration(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('activity.check_in')
  handleCheckIn(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('activity.payment')
  handlePayment(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('activity.subscription')
  handleSubscription(payload: ActivityEvent) {
    this.server.emit('activity', payload);
  }

  @OnEvent('check_in.result')
  handleCheckInResult(payload: CheckInResultEvent) {
    // Always broadcast to all admins
    this.server.emit('check_in_result', payload);

    // Also emit to entrance-specific room
    if (payload.entranceId) {
      this.server
        .to(`entrance:${payload.entranceId}`)
        .emit('check_in_result_entrance', payload);
    }
  }

  @OnEvent('qr.rotated')
  handleQrRotated(payload: QrRotatedEvent) {
    this.server.emit('qr_rotated', payload);
  }
}
