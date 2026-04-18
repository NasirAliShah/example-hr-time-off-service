import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { TimeOffRequestService } from './services/time-off-request.service';
import { TimeOffController } from './controllers/time-off.controller';
import { ManagerController } from './controllers/manager.controller';
import { BalanceModule } from '../balance/balance.module';
import { HcmIntegrationModule } from '../hcm-integration/hcm-integration.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalanceModule,
    HcmIntegrationModule,
  ],
  controllers: [TimeOffController, ManagerController],
  providers: [TimeOffRequestService],
  exports: [TypeOrmModule, TimeOffRequestService],
})
export class TimeOffModule {}
