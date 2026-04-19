import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module';
import { EmployeeModule } from './modules/employees/employees.module';
import { LocationModule } from './modules/locations/locations.module';
import { BalanceModule } from './modules/balance/balance.module';
import { TimeOffModule } from './modules/time-off/time-off.module';
import { HcmIntegrationModule } from './modules/hcm-integration/hcm-integration.module';
import { SyncModule } from './modules/sync/sync.module';
import { HealthModule } from './modules/health/health.module';
import { DatabaseConfig } from './config/database.config';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(DatabaseConfig),
    EmployeeModule,
    LocationModule,
    BalanceModule,
    TimeOffModule,
    HcmIntegrationModule,
    SyncModule,
    HealthModule,
  ],
})
export class AppModule {}
