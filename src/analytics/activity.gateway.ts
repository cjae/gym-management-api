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

@WebSocketGateway({ namespace: '/activity', cors: true })
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
      const token = client.handshake.auth?.token;
      if (!token) {
        client.disconnect();
        return;
      }

      const authConfig =
        this.configService.get<AuthConfig>(getAuthConfigName())!;
      const payload = await this.jwtService.verifyAsync(token, {
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
}
