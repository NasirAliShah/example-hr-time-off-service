import { Controller, Get } from '@nestjs/common';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';

@Controller('health')
export class HealthController {
  constructor(private readonly hcmIntegrationService: HcmIntegrationService) {}

  @Get()
  async healthCheck(): Promise<any> {
    const circuitState = this.hcmIntegrationService.getCircuitState();
    const failureCount = this.hcmIntegrationService.getFailureCount();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'time-off-microservice',
      version: '1.0.0',
      hcm: {
        circuitBreaker: circuitState,
        failureCount,
        healthy: circuitState === 'CLOSED',
      },
    };
  }
}
