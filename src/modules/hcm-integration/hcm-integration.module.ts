import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { HcmIntegrationService } from './services/hcm-integration.service';

@Module({
  imports: [ConfigModule],
  providers: [HcmIntegrationService],
  exports: [HcmIntegrationService],
})
export class HcmIntegrationModule {}
