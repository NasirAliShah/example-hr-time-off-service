import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyLog } from '../entities/idempotency-log.entity';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let repository: any;

  const mockRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: getRepositoryToken(IdempotencyLog),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<IdempotencyService>(IdempotencyService);
    repository = module.get(getRepositoryToken(IdempotencyLog));

    jest.clearAllMocks();
  });

  describe('checkDuplicate', () => {
    it('should return null if idempotencyKey is empty', async () => {
      const result = await service.checkDuplicate('');
      expect(result).toBeNull();
      expect(mockRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return null if no existing log found', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const result = await service.checkDuplicate('key-123');
      expect(result).toBeNull();
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'key-123' },
      });
    });

    it('should return existing log if found', async () => {
      const existingLog = {
        id: '1',
        idempotencyKey: 'key-123',
        method: 'POST',
        endpoint: '/api/v1/requests',
        responseBody: '{}',
        statusCode: 201,
      };
      mockRepository.findOne.mockResolvedValue(existingLog);
      const result = await service.checkDuplicate('key-123');
      expect(result).toEqual(existingLog);
    });
  });

  describe('recordRequest', () => {
    it('should return null if idempotencyKey is empty', async () => {
      const result = await service.recordRequest('', 'POST', '/api', {}, {}, 201);
      expect(result).toBeNull();
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should create and save a log entry', async () => {
      const createdLog = {
        idempotencyKey: 'key-456',
        method: 'POST',
        endpoint: '/api/v1/requests',
        requestBody: '{"days":2}',
        responseBody: '{"id":"req-1"}',
        statusCode: 201,
      };
      mockRepository.create.mockReturnValue(createdLog);
      mockRepository.save.mockResolvedValue({ ...createdLog, id: 'log-1' });

      const result = await service.recordRequest(
        'key-456',
        'POST',
        '/api/v1/requests',
        { days: 2 },
        { id: 'req-1' },
        201,
      );

      expect(result).toEqual({ ...createdLog, id: 'log-1' });
      expect(mockRepository.create).toHaveBeenCalledWith({
        idempotencyKey: 'key-456',
        method: 'POST',
        endpoint: '/api/v1/requests',
        requestBody: '{"days":2}',
        responseBody: '{"id":"req-1"}',
        statusCode: 201,
      });
      expect(mockRepository.save).toHaveBeenCalledWith(createdLog);
    });
  });

  describe('cleanupExpired', () => {
    it('should delete expired logs and return count', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 5 });
      const result = await service.cleanupExpired();
      expect(result).toBe(5);
      expect(mockRepository.delete).toHaveBeenCalled();
    });

    it('should return 0 if no expired logs', async () => {
      mockRepository.delete.mockResolvedValue({ affected: 0 });
      const result = await service.cleanupExpired();
      expect(result).toBe(0);
    });

    it('should return 0 if affected is undefined', async () => {
      mockRepository.delete.mockResolvedValue({});
      const result = await service.cleanupExpired();
      expect(result).toBe(0);
    });
  });
});
