import { Test, TestingModule } from '@nestjs/testing';
import { HcmIntegrationService } from './hcm-integration.service';
import { ConfigService } from '../../../config/config.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HcmIntegrationService', () => {
  let service: HcmIntegrationService;
  let mockAxiosInstance: any;

  const mockConfigService = {
    hcmBaseUrl: 'http://localhost:3001',
    hcmTimeout: 5000,
    hcmApiKey: 'test-key',
    hcmRetryAttempts: 3,
    hcmRetryDelay: 1000,
    circuitBreakerThreshold: 3,
    circuitBreakerTimeout: 60000,
  };

  beforeEach(async () => {
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };
    
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmIntegrationService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<HcmIntegrationService>(HcmIntegrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.resetCircuit();
  });

  describe('checkBalance', () => {
    it('should check balance successfully', async () => {
      const mockResponse = {
        data: {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          balance: 20,
          currency: 'days',
          lastUpdated: '2026-04-18',
        },
      };

      mockAxiosInstance.get.mockResolvedValue(mockResponse);

      const result = await service.checkBalance('emp-1', 'loc-1');

      expect(result.balance).toBe(20);
    });
  });

  describe('deductBalance', () => {
    it('should deduct balance successfully', async () => {
      const mockResponse = {
        data: {
          employeeId: 'emp-1',
          locationId: 'loc-1',
          previousBalance: 20,
          newBalance: 18,
          deducted: 2,
          confirmationId: 'hcm-conf-123',
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await service.deductBalance('emp-1', 'loc-1', 2, 'req-123');

      expect(result.confirmationId).toBe('hcm-conf-123');
    });
  });

  describe('circuit breaker', () => {
    it('should open circuit after threshold failures', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      for (let i = 0; i < 3; i++) {
        try {
          await service.checkBalance('emp-1', 'loc-1');
        } catch (error) {
        }
      }

      expect(service.getCircuitState()).toBe('OPEN');
    });
  });
});
