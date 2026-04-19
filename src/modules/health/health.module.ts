import { Module } from '@nestjs/common';
import { HealthController } from './controllers/health.controller';
import { HcmIntegrationModule } from '../hcm-integration/hcm-integration.module';

@Module({
  imports: [HcmIntegrationModule],
  controllers: [HealthController],
})
export class HealthModule {}
