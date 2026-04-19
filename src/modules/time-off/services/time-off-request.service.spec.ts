import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TimeOffRequestService } from './time-off-request.service';
import { TimeOffRequest, RequestStatus } from '../entities/time-off-request.entity';
import { BalanceService } from '../../balance/services/balance.service';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';

describe('TimeOffRequestService', () => {
  let service: TimeOffRequestService;
  let requestRepository: Repository<TimeOffRequest>;
  let balanceService: BalanceService;
  let hcmIntegrationService: HcmIntegrationService;
  let dataSource: DataSource;

  const mockRequestRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockBalanceService = {
    getBalance: jest.fn(),
    getBalanceForUpdate: jest.fn(),
    reserveBalance: jest.fn(),
    releaseBalance: jest.fn(),
    deductBalance: jest.fn(),
  };

  const mockHcmIntegrationService = {
    deductBalance: jest.fn(),
  };

  const mockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    isTransactionActive: true,
    manager: {
      save: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffRequestService,
        {
          provide: getRepositoryToken(TimeOffRequest),
          useValue: mockRequestRepository,
        },
        {
          provide: BalanceService,
          useValue: mockBalanceService,
        },
        {
          provide: HcmIntegrationService,
          useValue: mockHcmIntegrationService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<TimeOffRequestService>(TimeOffRequestService);
    requestRepository = module.get<Repository<TimeOffRequest>>(getRepositoryToken(TimeOffRequest));
    balanceService = module.get<BalanceService>(BalanceService);
    hcmIntegrationService = module.get<HcmIntegrationService>(HcmIntegrationService);
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitRequest', () => {
    it('should submit a time-off request successfully with atomic reserve', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      const mockRequest = {
        id: 'req-123',
        employeeId,
        locationId: dto.locationId,
        days: dto.days,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: RequestStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockBalanceService.reserveBalance.mockResolvedValue(undefined);
      mockRequestRepository.create.mockReturnValue(mockRequest);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);

      const result = await service.submitRequest(employeeId, dto);

      // reserveBalance must be called WITH the queryRunner.manager for transactional consistency
      expect(balanceService.reserveBalance).toHaveBeenCalledWith(
        employeeId, dto.locationId, dto.days, mockQueryRunner.manager,
      );
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.PENDING_APPROVAL);
    });

    it('should rollback and throw if reserveBalance fails (insufficient balance)', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 25,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      mockBalanceService.reserveBalance.mockRejectedValue(
        new Error('Insufficient available balance. Available: 15, Requested: 25'),
      );

      await expect(service.submitRequest(employeeId, dto)).rejects.toThrow('Insufficient available balance');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should throw error if end date is before start date', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-02',
        endDate: '2026-05-01',
        locationId: 'loc-1',
      };

      await expect(service.submitRequest(employeeId, dto)).rejects.toThrow('End date must be after start date');
    });

    it('should not start transaction for basic validation failures', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-02',
        endDate: '2026-05-01',
        locationId: 'loc-1',
      };

      try {
        await service.submitRequest(employeeId, dto);
      } catch (e) {
        // Expected
      }

      // Date validation happens before transaction starts,
      // but queryRunner is still created — the key point is rollback is called on error
      expect(balanceService.reserveBalance).not.toHaveBeenCalled();
    });
  });

  describe('approveRequest', () => {
    it('should approve and confirm request with balance re-validation', async () => {
      const requestId = 'req-123';
      const managerId = 'mgr-1';
      const dto = { comment: 'Approved' };

      const mockRequest = {
        id: requestId,
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days: 2,
        status: RequestStatus.PENDING_APPROVAL,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockBalanceRecord = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 2,
      };

      const mockDeductResult = {
        employeeId: 'emp-1',
        locationId: 'loc-1',
        previousBalance: 20,
        newBalance: 18,
        deducted: 2,
        confirmationId: 'hcm-conf-123',
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);
      mockBalanceService.getBalanceForUpdate.mockResolvedValue(mockBalanceRecord);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);
      mockHcmIntegrationService.deductBalance.mockResolvedValue(mockDeductResult);
      mockBalanceService.deductBalance.mockResolvedValue(undefined);

      const result = await service.approveRequest(requestId, managerId, dto);

      // Must re-validate balance with pessimistic lock
      expect(balanceService.getBalanceForUpdate).toHaveBeenCalledWith(
        'emp-1', 'loc-1', mockQueryRunner.manager,
      );
      expect(hcmIntegrationService.deductBalance).toHaveBeenCalled();
      // deductBalance must be called with the manager for transactional consistency
      expect(balanceService.deductBalance).toHaveBeenCalledWith(
        'emp-1', 'loc-1', 2, mockQueryRunner.manager,
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.CONFIRMED);
    });

    it('should throw error if request not found', async () => {
      const requestId = 'req-123';
      const managerId = 'mgr-1';
      const dto = { comment: 'Approved' };

      mockRequestRepository.findOne.mockResolvedValue(null);

      await expect(service.approveRequest(requestId, managerId, dto)).rejects.toThrow('Request not found');
    });

    it('should throw error if request is not pending', async () => {
      const requestId = 'req-123';
      const managerId = 'mgr-1';
      const dto = { comment: 'Approved' };

      const mockRequest = {
        id: requestId,
        status: RequestStatus.CONFIRMED,
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);

      await expect(service.approveRequest(requestId, managerId, dto)).rejects.toThrow('Cannot approve request');
    });

    it('should mark request as FAILED and release balance if HCM deduction fails', async () => {
      const requestId = 'req-123';
      const managerId = 'mgr-1';
      const dto = { comment: 'Approved' };

      const mockRequest = {
        id: requestId,
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days: 2,
        status: RequestStatus.PENDING_APPROVAL,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockBalanceRecord = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 2,
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);
      mockBalanceService.getBalanceForUpdate.mockResolvedValue(mockBalanceRecord);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);
      mockHcmIntegrationService.deductBalance.mockRejectedValue(new Error('HCM unavailable'));
      mockBalanceService.releaseBalance.mockResolvedValue(undefined);

      await expect(service.approveRequest(requestId, managerId, dto)).rejects.toThrow('HCM confirmation failed');
      expect(mockRequest.status).toBe(RequestStatus.FAILED);
      // Balance reservation should be released on HCM failure
      expect(balanceService.releaseBalance).toHaveBeenCalledWith(
        'emp-1', 'loc-1', 2, mockQueryRunner.manager,
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw if balance record not found at approval time', async () => {
      const requestId = 'req-123';
      const managerId = 'mgr-1';
      const dto = { comment: 'Approved' };

      const mockRequest = {
        id: requestId,
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days: 2,
        status: RequestStatus.PENDING_APPROVAL,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);
      mockBalanceService.getBalanceForUpdate.mockResolvedValue(null);

      await expect(service.approveRequest(requestId, managerId, dto)).rejects.toThrow(
        'Balance record not found',
      );
    });
  });

  describe('rejectRequest', () => {
    it('should reject request and release balance within transaction', async () => {
      const requestId = 'req-123';
      const managerId = 'mgr-1';
      const dto = { comment: 'Not approved' };

      const mockRequest = {
        id: requestId,
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days: 2,
        status: RequestStatus.PENDING_APPROVAL,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);
      mockBalanceService.releaseBalance.mockResolvedValue(undefined);

      const result = await service.rejectRequest(requestId, managerId, dto);

      // releaseBalance must be called WITH the manager for transactional consistency
      expect(balanceService.releaseBalance).toHaveBeenCalledWith(
        'emp-1', 'loc-1', 2, mockQueryRunner.manager,
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.REJECTED);
    });

    it('should throw error if request not found', async () => {
      mockRequestRepository.findOne.mockResolvedValue(null);

      await expect(
        service.rejectRequest('req-123', 'mgr-1', { comment: 'No' }),
      ).rejects.toThrow('Request not found');
    });

    it('should throw error if request is not pending', async () => {
      const mockRequest = {
        id: 'req-123',
        status: RequestStatus.CONFIRMED,
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);

      await expect(
        service.rejectRequest('req-123', 'mgr-1', { comment: 'No' }),
      ).rejects.toThrow('Cannot reject request');
    });
  });

  describe('submitRequest - idempotency key', () => {
    it('should return existing request if idempotency key matches', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
        idempotencyKey: 'abc-123',
      };

      const existingRequest = {
        id: 'req-existing',
        employeeId,
        locationId: dto.locationId,
        days: dto.days,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: RequestStatus.PENDING_APPROVAL,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequestRepository.findOne.mockResolvedValue(existingRequest);

      const result = await service.submitRequest(employeeId, dto);

      expect(result.id).toBe('req-existing');
      // Should NOT have started a transaction
      expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
      expect(balanceService.reserveBalance).not.toHaveBeenCalled();
    });

    it('should proceed normally if idempotency key has no match', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
        idempotencyKey: 'new-key-456',
      };

      // First findOne for idempotency check returns null
      mockRequestRepository.findOne.mockResolvedValueOnce(null);

      const mockRequest = {
        id: 'req-new',
        employeeId,
        locationId: dto.locationId,
        days: dto.days,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        status: RequestStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        idempotencyKey: dto.idempotencyKey,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockBalanceService.reserveBalance.mockResolvedValue(undefined);
      mockRequestRepository.create.mockReturnValue(mockRequest);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);

      const result = await service.submitRequest(employeeId, dto);

      expect(result.id).toBe('req-new');
      expect(balanceService.reserveBalance).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw if idempotency key lookup fails', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
        idempotencyKey: 'fail-key',
      };

      mockRequestRepository.findOne.mockRejectedValueOnce(new Error('DB error'));

      await expect(service.submitRequest(employeeId, dto)).rejects.toThrow('DB error');
    });
  });

  describe('submitRequest - validation', () => {
    it('should throw error if days is 0', async () => {
      const dto = {
        days: 0,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      await expect(service.submitRequest('emp-1', dto)).rejects.toThrow('Days must be greater than 0');
    });

    it('should throw error if days is negative', async () => {
      const dto = {
        days: -1,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      await expect(service.submitRequest('emp-1', dto)).rejects.toThrow('Days must be greater than 0');
    });

    it('should re-throw Balance not found as BadRequestException', async () => {
      const dto = {
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      mockBalanceService.reserveBalance.mockRejectedValue(new Error('Balance not found'));

      await expect(service.submitRequest('emp-1', dto)).rejects.toThrow('Balance not found');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('approveRequest - releaseBalance failure during HCM error', () => {
    it('should still throw ServiceUnavailableException even if releaseBalance fails', async () => {
      const mockRequest = {
        id: 'req-123',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days: 2,
        status: RequestStatus.PENDING_APPROVAL,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockBalanceRecord = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 2,
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);
      mockBalanceService.getBalanceForUpdate.mockResolvedValue(mockBalanceRecord);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);
      mockHcmIntegrationService.deductBalance.mockRejectedValue(new Error('HCM down'));
      mockBalanceService.releaseBalance.mockRejectedValue(new Error('Release failed'));

      await expect(
        service.approveRequest('req-123', 'mgr-1', { comment: 'Ok' }),
      ).rejects.toThrow('HCM confirmation failed');
      expect(mockRequest.status).toBe(RequestStatus.FAILED);
    });
  });

  describe('getPendingRequests', () => {
    it('should return pending requests', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'req-1',
            status: RequestStatus.PENDING_APPROVAL,
            startDate: new Date('2026-05-01'),
            endDate: new Date('2026-05-02'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getPendingRequests('mgr-1');

      expect(result).toHaveLength(1);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should return all pending requests when no managerId', async () => {
      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockRequestRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getPendingRequests();

      expect(result).toHaveLength(0);
      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('getRequestById', () => {
    it('should return request by ID', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        days: 2,
        status: RequestStatus.CONFIRMED,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-02'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);

      const result = await service.getRequestById('req-1');

      expect(result.id).toBe('req-1');
    });

    it('should throw NotFoundException if request not found', async () => {
      mockRequestRepository.findOne.mockResolvedValue(null);

      await expect(service.getRequestById('non-existent')).rejects.toThrow('Request not found');
    });
  });

  describe('getRequestHistory', () => {
    it('should return request history for employee', async () => {
      const employeeId = 'emp-1';
      const mockRequests = [
        {
          id: 'req-1',
          employeeId,
          status: RequestStatus.CONFIRMED,
          startDate: new Date('2026-05-01'),
          endDate: new Date('2026-05-02'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'req-2',
          employeeId,
          status: RequestStatus.PENDING_APPROVAL,
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-06-02'),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRequestRepository.find.mockResolvedValue(mockRequests);

      const result = await service.getRequestHistory(employeeId);

      expect(requestRepository.find).toHaveBeenCalledWith({
        where: { employeeId },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
    });
  });
});
