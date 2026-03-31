import { Module } from '@nestjs/common';
import { MemberTagsController } from './member-tags.controller';
import { MemberTagsService } from './member-tags.service';
import { GymSettingsModule } from '../gym-settings/gym-settings.module';

@Module({
  imports: [GymSettingsModule],
  controllers: [MemberTagsController],
  providers: [MemberTagsService],
  exports: [MemberTagsService],
})
export class MemberTagsModule {}
