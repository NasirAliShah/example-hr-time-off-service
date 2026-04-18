import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffBalance } from './entities/time-off-balance.entity';
import { BalanceService } from './services/balance.service';
import { HcmIntegrationModule } from '../hcm-integration/hcm-integration.module';
import { ConfigModule } from '../../config/config.module';

@Module({
  imports: [TypeOrmModule.forFeature([TimeOffBalance]), HcmIntegrationModule, ConfigModule],
  providers: [BalanceService],
  exports: [TypeOrmModule, BalanceService],
})
export class BalanceModule {}
