import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';

describe('HealthController', () => {
  let controller: HealthController;
  let hcmIntegrationService: HcmIntegrationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HcmIntegrationService,
          useValue: {
            getCircuitState: jest.fn().mockReturnValue('CLOSED'),
            getFailureCount: jest.fn().mockReturnValue(0),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    hcmIntegrationService = module.get<HcmIntegrationService>(HcmIntegrationService);
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      const result = await controller.healthCheck();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('service');
      expect(result.status).toBe('ok');
      expect(result.service).toBe('time-off-microservice');
    });

    it('should include timestamp', async () => {
      const result = await controller.healthCheck();

      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('string');
    });

    it('should return valid ISO timestamp', async () => {
      const result = await controller.healthCheck();

      const timestamp = new Date(result.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThan(0);
    });

    it('should include HCM circuit breaker status', async () => {
      const result = await controller.healthCheck();

      expect(result).toHaveProperty('hcm');
      expect(result.hcm).toHaveProperty('circuitBreaker');
      expect(result.hcm).toHaveProperty('healthy');
    });
  });
});
