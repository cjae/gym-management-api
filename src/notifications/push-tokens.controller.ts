import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { RemovePushTokenDto } from './dto/remove-push-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Push Tokens')
@ApiBearerAuth()
@Controller('push-tokens')
@UseGuards(JwtAuthGuard)
export class PushTokensController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  register(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notificationsService.registerPushToken(
      userId,
      dto.token,
      dto.platform,
    );
  }

  @Delete()
  remove(@CurrentUser('id') userId: string, @Body() dto: RemovePushTokenDto) {
    return this.notificationsService.removePushToken(dto.token, userId);
  }
}
