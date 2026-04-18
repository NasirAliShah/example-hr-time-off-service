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
    it('should submit a time-off request successfully', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 2,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      const mockBalance = {
        balance: 20,
        reserved: 0,
        available: 20,
        lastSyncedAt: new Date(),
        isCached: false,
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

      mockBalanceService.getBalance.mockResolvedValue(mockBalance);
      mockBalanceService.reserveBalance.mockResolvedValue(undefined);
      mockRequestRepository.create.mockReturnValue(mockRequest);
      mockQueryRunner.manager.save.mockResolvedValue(mockRequest);

      const result = await service.submitRequest(employeeId, dto);

      expect(balanceService.getBalance).toHaveBeenCalledWith(employeeId, dto.locationId);
      expect(balanceService.reserveBalance).toHaveBeenCalledWith(employeeId, dto.locationId, dto.days);
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
      expect(result.status).toBe(RequestStatus.PENDING_APPROVAL);
    });

    it('should throw error if insufficient balance', async () => {
      const employeeId = 'emp-1';
      const dto = {
        days: 25,
        startDate: '2026-05-01',
        endDate: '2026-05-02',
        locationId: 'loc-1',
      };

      const mockBalance = {
        balance: 20,
        reserved: 5,
        available: 15,
        lastSyncedAt: new Date(),
        isCached: false,
      };

      mockBalanceService.getBalance.mockResolvedValue(mockBalance);

      await expect(service.submitRequest(employeeId, dto)).rejects.toThrow('Insufficient balance');
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
  });

  describe('approveRequest', () => {
    it('should approve and confirm request successfully', async () => {
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

      const mockDeductResult = {
        employeeId: 'emp-1',
        locationId: 'loc-1',
        previousBalance: 20,
        newBalance: 18,
        deducted: 2,
        confirmationId: 'hcm-conf-123',
      };

      mockRequestRepository.findOne.mockResolvedValue(mockRequest);
      mockRequestRepository.save.mockResolvedValue(mockRequest);
      mockHcmIntegrationService.deductBalance.mockResolvedValue(mockDeductResult);
      mockBalanceService.deductBalance.mockResolvedValue(undefined);

      const result = await service.approveRequest(requestId, managerId, dto);

      expect(requestRepository.findOne).toHaveBeenCalledWith({ where: { id: requestId } });
      expect(hcmIntegrationService.deductBalance).toHaveBeenCalled();
      expect(balanceService.deductBalance).toHaveBeenCalled();
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

    it('should mark request as FAILED if HCM deduction fails', async () => {
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
      mockRequestRepository.save.mockResolvedValue(mockRequest);
      mockHcmIntegrationService.deductBalance.mockRejectedValue(new Error('HCM unavailable'));

      await expect(service.approveRequest(requestId, managerId, dto)).rejects.toThrow('HCM confirmation failed');
      expect(mockRequest.status).toBe(RequestStatus.FAILED);
    });
  });

  describe('rejectRequest', () => {
    it('should reject request and release balance', async () => {
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
      mockRequestRepository.save.mockResolvedValue(mockRequest);
      mockBalanceService.releaseBalance.mockResolvedValue(undefined);

      const result = await service.rejectRequest(requestId, managerId, dto);

      expect(balanceService.releaseBalance).toHaveBeenCalledWith('emp-1', 'loc-1', 2);
      expect(result.status).toBe(RequestStatus.REJECTED);
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
