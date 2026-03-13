import { Module } from '@nestjs/common';
import { GymClassesService } from './gym-classes.service';
import { GymClassesController } from './gym-classes.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [GymClassesController],
  providers: [GymClassesService],
  exports: [GymClassesService],
})
export class GymClassesModule {}
