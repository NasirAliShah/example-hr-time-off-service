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

    it('should reject checkBalance when circuit is OPEN', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        try { await service.checkBalance('emp-1', 'loc-1'); } catch (e) {}
      }

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toThrow('HCM_UNAVAILABLE');
    });

    it('should reject deductBalance when circuit is OPEN', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        try { await service.checkBalance('emp-1', 'loc-1'); } catch (e) {}
      }

      await expect(service.deductBalance('emp-1', 'loc-1', 2, 'req-1')).rejects.toThrow('HCM_UNAVAILABLE');
    });

    it('should reject batchSync when circuit is OPEN', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      for (let i = 0; i < 3; i++) {
        try { await service.checkBalance('emp-1', 'loc-1'); } catch (e) {}
      }

      await expect(service.batchSync()).rejects.toThrow('HCM_UNAVAILABLE');
    });

    it('should transition to HALF_OPEN after timeout and then CLOSED on success', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      // Trip the breaker
      for (let i = 0; i < 3; i++) {
        try { await service.checkBalance('emp-1', 'loc-1'); } catch (e) {}
      }
      expect(service.getCircuitState()).toBe('OPEN');

      // Simulate timeout passing by manipulating internal state via reflection
      (service as any).lastFailureTime = Date.now() - 70000; // 70s > 60s timeout

      // Next call should transition to HALF_OPEN and succeed
      mockAxiosInstance.get.mockResolvedValue({
        data: { employeeId: 'emp-1', locationId: 'loc-1', balance: 20 },
      });

      const result = await service.checkBalance('emp-1', 'loc-1');
      expect(result.balance).toBe(20);
      expect(service.getCircuitState()).toBe('CLOSED');
    });

    it('should return failure count', () => {
      expect(service.getFailureCount()).toBe(0);
    });

    it('should reset circuit manually', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('err'));
      for (let i = 0; i < 3; i++) {
        try { await service.checkBalance('emp-1', 'loc-1'); } catch (e) {}
      }
      expect(service.getCircuitState()).toBe('OPEN');

      service.resetCircuit();
      expect(service.getCircuitState()).toBe('CLOSED');
      expect(service.getFailureCount()).toBe(0);
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

    it('should throw on deduction failure and record failure', async () => {
      const axiosError = new Error('HCM error') as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 500, data: { error: 'Internal' } };
      // Make axios.isAxiosError return true
      mockedAxios.isAxiosError.mockReturnValue(true);

      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(service.deductBalance('emp-1', 'loc-1', 2, 'req-1')).rejects.toThrow();
      expect(service.getFailureCount()).toBe(1);
    });
  });

  describe('batchSync', () => {
    it('should batch sync successfully', async () => {
      const mockResponse = {
        data: {
          count: 5,
          timestamp: '2026-04-18T12:00:00Z',
          balances: [
            { employeeId: 'emp-1', locationId: 'loc-1', balance: 20 },
          ],
        },
      };

      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await service.batchSync();

      expect(result.count).toBe(5);
    });

    it('should throw on batch sync failure', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(service.batchSync()).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle axios error with response', async () => {
      const axiosError = new Error('Request failed') as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 400, data: { error: 'Bad request' } };
      axiosError.request = {};
      mockedAxios.isAxiosError.mockReturnValue(true);

      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toThrow();
    });

    it('should handle axios error without response (no response)', async () => {
      const axiosError = new Error('timeout') as any;
      axiosError.isAxiosError = true;
      axiosError.response = undefined;
      axiosError.request = {};
      mockedAxios.isAxiosError.mockReturnValue(true);

      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toThrow();
    });

    it('should handle axios error without request (setup error)', async () => {
      const axiosError = new Error('setup fail') as any;
      axiosError.isAxiosError = true;
      axiosError.response = undefined;
      axiosError.request = undefined;
      mockedAxios.isAxiosError.mockReturnValue(true);

      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toThrow();
    });

    it('should handle non-axios errors', async () => {
      mockedAxios.isAxiosError.mockReturnValue(false);
      mockAxiosInstance.get.mockRejectedValue(new Error('Unknown error'));

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toThrow('Unknown error');
    });

    it('should handle non-Error thrown values', async () => {
      mockedAxios.isAxiosError.mockReturnValue(false);
      mockAxiosInstance.get.mockRejectedValue('string error');

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toBe('string error');
    });
  });

  describe('retry logic', () => {
    it('should not retry non-transient errors (e.g. 400)', async () => {
      const axiosError = new Error('Bad Request') as any;
      axiosError.isAxiosError = true;
      axiosError.response = { status: 400, data: {} };
      mockedAxios.isAxiosError.mockReturnValue(true);

      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(service.checkBalance('emp-1', 'loc-1')).rejects.toThrow();
      // Should only be called once — no retries for 400
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });
  });
});
