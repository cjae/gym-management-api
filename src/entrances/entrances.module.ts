import { Module } from '@nestjs/common';
import { EntrancesService } from './entrances.service';
import { EntrancesController } from './entrances.controller';

@Module({
  controllers: [EntrancesController],
  providers: [EntrancesService],
  exports: [EntrancesService],
})
export class EntrancesModule {}
