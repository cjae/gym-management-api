import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { SentryUserInterceptor } from './sentry-user.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryUserInterceptor,
    },
  ],
})
export class SentryUserModule {}
