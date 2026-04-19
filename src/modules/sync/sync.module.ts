import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncLog } from './entities/sync-log.entity';
import { SyncService } from './services/sync.service';
import { AdminController } from './controllers/admin.controller';
import { TimeOffBalance } from '../balance/entities/time-off-balance.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Location } from '../locations/entities/location.entity';
import { HcmIntegrationModule } from '../hcm-integration/hcm-integration.module';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncLog, TimeOffBalance, Employee, Location]),
    HcmIntegrationModule,
    BalanceModule,
  ],
  controllers: [AdminController],
  providers: [SyncService],
  exports: [TypeOrmModule, SyncService],
})
export class SyncModule {}
