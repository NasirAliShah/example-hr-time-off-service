import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncService } from './sync.service';
import { SyncLog, SyncType, SyncStatus } from '../entities/sync-log.entity';
import { TimeOffBalance } from '../../balance/entities/time-off-balance.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Location } from '../../locations/entities/location.entity';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';
import { BalanceService } from '../../balance/services/balance.service';

describe('SyncService', () => {
  let service: SyncService;
  let syncLogRepository: Repository<SyncLog>;
  let balanceRepository: Repository<TimeOffBalance>;
  let employeeRepository: Repository<Employee>;
  let locationRepository: Repository<Location>;
  let hcmIntegrationService: HcmIntegrationService;

  const mockSyncLogRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  const mockBalanceRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockEmployeeRepository = {
    findOne: jest.fn(),
  };

  const mockLocationRepository = {
    findOne: jest.fn(),
  };

  const mockHcmIntegrationService = {
    batchSync: jest.fn(),
  };

  const mockBalanceService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: getRepositoryToken(SyncLog),
          useValue: mockSyncLogRepository,
        },
        {
          provide: getRepositoryToken(TimeOffBalance),
          useValue: mockBalanceRepository,
        },
        {
          provide: getRepositoryToken(Employee),
          useValue: mockEmployeeRepository,
        },
        {
          provide: getRepositoryToken(Location),
          useValue: mockLocationRepository,
        },
        {
          provide: HcmIntegrationService,
          useValue: mockHcmIntegrationService,
        },
        {
          provide: BalanceService,
          useValue: mockBalanceService,
        },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    syncLogRepository = module.get<Repository<SyncLog>>(getRepositoryToken(SyncLog));
    balanceRepository = module.get<Repository<TimeOffBalance>>(getRepositoryToken(TimeOffBalance));
    employeeRepository = module.get<Repository<Employee>>(getRepositoryToken(Employee));
    locationRepository = module.get<Repository<Location>>(getRepositoryToken(Location));
    hcmIntegrationService = module.get<HcmIntegrationService>(HcmIntegrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('batchSync', () => {
    it('should sync balances successfully', async () => {
      const mockHcmResponse = {
        balances: [
          { employeeId: 'emp-1', locationId: 'loc-1', balance: 20, lastUpdated: '2026-04-18' },
          { employeeId: 'emp-2', locationId: 'loc-1', balance: 18, lastUpdated: '2026-04-18' },
        ],
        timestamp: '2026-04-18T00:00:00Z',
        count: 2,
      };

      const mockLocalBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
        lastSyncedAt: new Date(),
      };

      const mockEmployee = { id: 'emp-1', hcmEmployeeId: 'hcm-emp-1', name: 'John Doe', email: 'john@example.com' };
      const mockLocation = { id: 'loc-1', hcmLocationId: 'hcm-loc-1', name: 'New York', timezone: 'America/New_York' };

      mockHcmIntegrationService.batchSync.mockResolvedValue(mockHcmResponse);
      mockEmployeeRepository.findOne.mockResolvedValue(mockEmployee);
      mockLocationRepository.findOne.mockResolvedValue(mockLocation);
      mockBalanceRepository.findOne.mockResolvedValue(mockLocalBalance);
      mockBalanceRepository.save.mockResolvedValue(mockLocalBalance);
      mockSyncLogRepository.create.mockImplementation((data) => data);
      mockSyncLogRepository.save.mockResolvedValue({});

      const result = await service.batchSync();

      expect(hcmIntegrationService.batchSync).toHaveBeenCalled();
      expect(result.totalRecords).toBe(2);
      expect(result.successCount).toBeGreaterThan(0);
    });

    it('should detect and resolve conflicts', async () => {
      const mockHcmResponse = {
        balances: [
          { employeeId: 'emp-1', locationId: 'loc-1', balance: 25, lastUpdated: '2026-04-18' },
        ],
        timestamp: '2026-04-18T00:00:00Z',
        count: 1,
      };

      const mockLocalBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
        lastSyncedAt: new Date(),
      };

      const mockEmployee = { id: 'emp-1', hcmEmployeeId: 'hcm-emp-1', name: 'John Doe', email: 'john@example.com' };
      const mockLocation = { id: 'loc-1', hcmLocationId: 'hcm-loc-1', name: 'New York', timezone: 'America/New_York' };

      mockHcmIntegrationService.batchSync.mockResolvedValue(mockHcmResponse);
      mockEmployeeRepository.findOne.mockResolvedValue(mockEmployee);
      mockLocationRepository.findOne.mockResolvedValue(mockLocation);
      mockBalanceRepository.findOne.mockResolvedValue(mockLocalBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockLocalBalance, balance: 25 });
      mockSyncLogRepository.create.mockImplementation((data) => data);
      mockSyncLogRepository.save.mockResolvedValue({});

      const result = await service.batchSync();

      expect(result.conflictCount).toBe(1);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].delta).toBe(5);
    });

    it('should create new balance records for new employees', async () => {
      const mockHcmResponse = {
        balances: [
          { employeeId: 'emp-new', locationId: 'loc-1', balance: 20, lastUpdated: '2026-04-18' },
        ],
        timestamp: '2026-04-18T00:00:00Z',
        count: 1,
      };

      const mockEmployee = { id: 'emp-new', hcmEmployeeId: 'hcm-emp-new', name: 'New Employee', email: 'new@example.com' };
      const mockLocation = { id: 'loc-1', hcmLocationId: 'hcm-loc-1', name: 'New York', timezone: 'America/New_York' };

      mockHcmIntegrationService.batchSync.mockResolvedValue(mockHcmResponse);
      mockEmployeeRepository.findOne.mockResolvedValue(mockEmployee);
      mockLocationRepository.findOne.mockResolvedValue(mockLocation);
      mockBalanceRepository.findOne.mockResolvedValue(null);
      mockBalanceRepository.create.mockImplementation((data) => data);
      mockBalanceRepository.save.mockResolvedValue({});
      mockSyncLogRepository.create.mockImplementation((data) => data);
      mockSyncLogRepository.save.mockResolvedValue({});

      const result = await service.batchSync();

      expect(balanceRepository.create).toHaveBeenCalled();
      expect(result.successCount).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      const mockHcmResponse = {
        balances: [
          { employeeId: 'emp-1', locationId: 'loc-1', balance: 20, lastUpdated: '2026-04-18' },
        ],
        timestamp: '2026-04-18T00:00:00Z',
        count: 1,
      };

      const mockEmployee = { id: 'emp-1', hcmEmployeeId: 'hcm-emp-1', name: 'John Doe', email: 'john@example.com' };
      const mockLocation = { id: 'loc-1', hcmLocationId: 'hcm-loc-1', name: 'New York', timezone: 'America/New_York' };

      mockHcmIntegrationService.batchSync.mockResolvedValue(mockHcmResponse);
      mockEmployeeRepository.findOne.mockResolvedValue(mockEmployee);
      mockLocationRepository.findOne.mockResolvedValue(mockLocation);
      mockBalanceRepository.findOne.mockRejectedValue(new Error('Database error'));
      mockSyncLogRepository.create.mockImplementation((data) => data);
      mockSyncLogRepository.save.mockResolvedValue({});

      const result = await service.batchSync();

      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should throw error if HCM batch sync fails', async () => {
      mockHcmIntegrationService.batchSync.mockRejectedValue(new Error('HCM unavailable'));
      mockSyncLogRepository.create.mockImplementation((data) => data);
      mockSyncLogRepository.save.mockResolvedValue({});

      await expect(service.batchSync()).rejects.toThrow('HCM unavailable');
    });
  });

  describe('getSyncLog', () => {
    it('should return sync logs for a given sync ID', async () => {
      const syncId = 'sync-123';
      const mockLogs = [
        {
          id: 'log-1',
          type: SyncType.BATCH_SYNC,
          status: SyncStatus.SUCCESS,
          details: { syncId },
        },
      ];

      mockSyncLogRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getSyncLog(syncId);

      expect(syncLogRepository.find).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('getRecentSyncLogs', () => {
    it('should return recent sync logs', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          type: SyncType.BATCH_SYNC,
          status: SyncStatus.SUCCESS,
        },
        {
          id: 'log-2',
          type: SyncType.BATCH_SYNC,
          status: SyncStatus.CONFLICT,
        },
      ];

      mockSyncLogRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getRecentSyncLogs(100);

      expect(syncLogRepository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
        take: 100,
      });
      expect(result).toHaveLength(2);
    });
  });
});
