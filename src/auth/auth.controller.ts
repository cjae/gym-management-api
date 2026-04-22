import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiBasicAuth,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiConflictResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { BasicAuthGuard } from './guards/basic-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AllowWhileMustChangePassword } from './decorators/allow-while-must-change-password.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { CreateDeletionRequestDto } from './dto/create-deletion-request.dto';
import { DeletionRequestResponseDto } from './dto/deletion-request-response.dto';
import { AuthMeResponseDto } from './dto/auth-me-response.dto';
import { MessageResponseDto } from '../common/dto/message-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @UseGuards(BasicAuthGuard)
  @ApiBasicAuth()
  @ApiCreatedResponse({
    type: TokenResponseDto,
    description: 'User registered successfully',
  })
  @ApiConflictResponse({ description: 'Email already registered' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @UseGuards(BasicAuthGuard)
  @ApiBasicAuth()
  @ApiOkResponse({ type: TokenResponseDto, description: 'Login successful' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
  }

  @Post('refresh')
  @UseGuards(BasicAuthGuard, JwtRefreshAuthGuard)
  @ApiBasicAuth()
  @ApiOkResponse({
    type: TokenResponseDto,
    description: 'Tokens refreshed successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  refresh(
    @CurrentUser('id') userId: string,
    @CurrentUser('jti') jti: string,
    // Body parsed by ValidationPipe; token extracted by Passport strategy
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body() dto: RefreshTokenDto,
  ) {
    return this.authService.refreshToken(userId, jti);
  }

  @Post('forgot-password')
  @UseGuards(BasicAuthGuard)
  @ApiBasicAuth()
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Reset email sent if account exists',
  })
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @UseGuards(BasicAuthGuard)
  @ApiBasicAuth()
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Password reset successfully',
  })
  @ApiBadRequestResponse({ description: 'Invalid or expired reset token' })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @AllowWhileMustChangePassword()
  @ApiBearerAuth()
  @ApiOkResponse({
    type: AuthMeResponseDto,
    description: 'Current user profile with onboarding flag',
  })
  getProfile(@CurrentUser('id') userId: string) {
    return this.authService.getProfile(userId);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    type: AuthMeResponseDto,
    description: 'Updated user profile',
  })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @Post('me/onboarding')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    type: AuthMeResponseDto,
    description: 'Onboarding completed; personalization stored.',
  })
  @ApiBadRequestResponse({ description: 'Onboarding already completed' })
  completeOnboarding(
    @CurrentUser('id') userId: string,
    @Body() dto: OnboardingDto,
  ) {
    return this.authService.completeOnboarding(userId, dto);
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @AllowWhileMustChangePassword()
  @ApiBearerAuth()
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Password changed successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Current password is incorrect' })
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @AllowWhileMustChangePassword()
  @ApiBearerAuth()
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Logged out successfully',
  })
  logout(
    @CurrentUser('jti') jti: string,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
  ) {
    return this.authService.logout(
      jti,
      userId,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('delete-request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({
    type: DeletionRequestResponseDto,
    description: 'Deletion request submitted',
  })
  @ApiConflictResponse({ description: 'Pending request already exists' })
  requestDeletion(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDeletionRequestDto,
  ) {
    return this.authService.requestDeletion(userId, dto);
  }

  @Get('delete-request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    type: DeletionRequestResponseDto,
    description: 'Current deletion request status',
  })
  getDeletionRequest(@CurrentUser('id') userId: string) {
    return this.authService.getDeletionRequest(userId);
  }

  @Delete('delete-request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    type: MessageResponseDto,
    description: 'Deletion request cancelled',
  })
  @ApiNotFoundResponse({ description: 'No pending deletion request found' })
  cancelDeletionRequest(@CurrentUser('id') userId: string) {
    return this.authService.cancelDeletionRequest(userId);
  }
}
