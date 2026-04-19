import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { BalanceService } from './balance.service';
import { TimeOffBalance } from '../entities/time-off-balance.entity';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';
import { ConfigService } from '../../../config/config.service';

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepository: Repository<TimeOffBalance>;
  let hcmIntegrationService: HcmIntegrationService;

  const mockBalanceRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockHcmIntegrationService = {
    checkBalance: jest.fn(),
  };

  const mockConfigService = {
    cacheTtl: 300,
  };

  // Mock EntityManager that returns its own repository
  const mockManagerRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  const mockEntityManager = {
    getRepository: jest.fn().mockReturnValue(mockManagerRepo),
  } as unknown as EntityManager;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        {
          provide: getRepositoryToken(TimeOffBalance),
          useValue: mockBalanceRepository,
        },
        {
          provide: HcmIntegrationService,
          useValue: mockHcmIntegrationService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    balanceRepository = module.get<Repository<TimeOffBalance>>(getRepositoryToken(TimeOffBalance));
    hcmIntegrationService = module.get<HcmIntegrationService>(HcmIntegrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('should return balance from database', async () => {
      const employeeId = 'emp-1';
      const locationId = 'loc-1';

      const mockBalance = {
        id: 'bal-1',
        employeeId,
        locationId,
        balance: 20,
        reserved: 2,
        lastSyncedAt: new Date(),
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);

      const result = await service.getBalance(employeeId, locationId);

      expect(result.balance).toBe(20);
      expect(result.reserved).toBe(2);
      expect(result.available).toBe(18);
      expect(result.isCached).toBe(false);
    });

    it('should create new balance if not found', async () => {
      const employeeId = 'emp-new';
      const locationId = 'loc-1';

      mockBalanceRepository.findOne.mockResolvedValue(null);
      mockBalanceRepository.create.mockReturnValue({
        id: 'bal-new',
        employeeId,
        locationId,
        balance: 0,
        reserved: 0,
        lastSyncedAt: null,
      });
      mockBalanceRepository.save.mockResolvedValue({});

      const result = await service.getBalance(employeeId, locationId);

      expect(balanceRepository.create).toHaveBeenCalled();
      expect(balanceRepository.save).toHaveBeenCalled();
      expect(result.balance).toBe(0);
      expect(result.available).toBe(0);
    });
  });

  describe('getBalance - cache and sync', () => {
    it('should return cached balance when available', async () => {
      const employeeId = 'emp-cache';
      const locationId = 'loc-1';

      // First call to populate cache
      const mockBalance = {
        id: 'bal-c',
        employeeId,
        locationId,
        balance: 15,
        reserved: 3,
        lastSyncedAt: new Date(), // recent sync - won't trigger HCM
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);

      const first = await service.getBalance(employeeId, locationId);
      expect(first.isCached).toBe(false);

      // Second call should hit cache
      const second = await service.getBalance(employeeId, locationId);
      expect(second.isCached).toBe(true);
      expect(second.balance).toBe(15);
    });

    it('should sync with HCM when balance is stale and values mismatch', async () => {
      const employeeId = 'emp-stale';
      const locationId = 'loc-1';

      const mockBalance = {
        id: 'bal-s',
        employeeId,
        locationId,
        balance: 15,
        reserved: 0,
        lastSyncedAt: new Date(Date.now() - 999999999), // very old
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockHcmIntegrationService.checkBalance.mockResolvedValue({
        employeeId,
        locationId,
        balance: 20, // different from local
      });
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, balance: 20 });

      const result = await service.getBalance(employeeId, locationId);

      expect(mockHcmIntegrationService.checkBalance).toHaveBeenCalled();
      expect(result.balance).toBe(20);
    });

    it('should sync with HCM when balance matches (just update timestamp)', async () => {
      const employeeId = 'emp-match';
      const locationId = 'loc-1';

      const mockBalance = {
        id: 'bal-m',
        employeeId,
        locationId,
        balance: 20,
        reserved: 0,
        lastSyncedAt: new Date(Date.now() - 999999999),
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockHcmIntegrationService.checkBalance.mockResolvedValue({
        employeeId,
        locationId,
        balance: 20, // same as local
      });
      mockBalanceRepository.save.mockResolvedValue(mockBalance);

      const result = await service.getBalance(employeeId, locationId);

      expect(mockHcmIntegrationService.checkBalance).toHaveBeenCalled();
      expect(result.balance).toBe(20);
    });

    it('should handle HCM sync failure gracefully and return local balance', async () => {
      const employeeId = 'emp-fail';
      const locationId = 'loc-1';

      const mockBalance = {
        id: 'bal-f',
        employeeId,
        locationId,
        balance: 10,
        reserved: 2,
        lastSyncedAt: new Date(Date.now() - 999999999),
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockHcmIntegrationService.checkBalance.mockRejectedValue(new Error('HCM down'));

      const result = await service.getBalance(employeeId, locationId);

      expect(result.balance).toBe(10);
      expect(result.warning).toBeDefined();
    });
  });

  describe('getBalanceForUpdate', () => {
    it('should fetch balance with pessimistic write lock', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
      };

      mockManagerRepo.findOne.mockResolvedValue(mockBalance);

      const result = await service.getBalanceForUpdate('emp-1', 'loc-1', mockEntityManager);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(TimeOffBalance);
      expect(mockManagerRepo.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(result).toEqual(mockBalance);
    });

    it('should return null when balance record does not exist', async () => {
      mockManagerRepo.findOne.mockResolvedValue(null);

      const result = await service.getBalanceForUpdate('emp-new', 'loc-1', mockEntityManager);

      expect(result).toBeNull();
    });

    it('should propagate database errors', async () => {
      mockManagerRepo.findOne.mockRejectedValue(new Error('DB lock timeout'));

      await expect(
        service.getBalanceForUpdate('emp-1', 'loc-1', mockEntityManager),
      ).rejects.toThrow('DB lock timeout');
    });

    it('should fall back to plain read when locking is not supported (SQLite)', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
      };

      // First call (with lock) throws, second call (plain read) succeeds
      mockManagerRepo.findOne
        .mockRejectedValueOnce(new Error('Locking not supported on given driver.'))
        .mockResolvedValueOnce(mockBalance);

      const result = await service.getBalanceForUpdate('emp-1', 'loc-1', mockEntityManager);

      expect(result).toEqual(mockBalance);
      expect(mockManagerRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('should re-throw non-locking errors from inner try', async () => {
      mockManagerRepo.findOne.mockRejectedValue(new Error('Some other DB error'));

      await expect(
        service.getBalanceForUpdate('emp-1', 'loc-1', mockEntityManager),
      ).rejects.toThrow('Some other DB error');
    });
  });

  describe('updateBalance', () => {
    it('should update existing balance', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 15,
        reserved: 2,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, balance: 25 });

      await service.updateBalance('emp-1', 'loc-1', 25);

      expect(mockBalanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ balance: 25 }),
      );
    });

    it('should create new balance if not found', async () => {
      mockBalanceRepository.findOne.mockResolvedValue(null);
      const newBalance = {
        id: 'bal-new',
        employeeId: 'emp-new',
        locationId: 'loc-1',
        balance: 10,
        reserved: 0,
      };
      mockBalanceRepository.create.mockReturnValue(newBalance);
      mockBalanceRepository.save.mockResolvedValue(newBalance);

      await service.updateBalance('emp-new', 'loc-1', 10);

      expect(mockBalanceRepository.create).toHaveBeenCalled();
      expect(mockBalanceRepository.save).toHaveBeenCalled();
    });

    it('should update balance using provided EntityManager', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 15,
        reserved: 2,
      };

      // getBalanceForUpdate is called when manager is provided
      mockManagerRepo.findOne
        .mockRejectedValueOnce(new Error('Locking not supported on given driver.'))
        .mockResolvedValueOnce(mockBalance);
      mockManagerRepo.save.mockResolvedValue({ ...mockBalance, balance: 30 });

      await service.updateBalance('emp-1', 'loc-1', 30, mockEntityManager);

      expect(mockManagerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ balance: 30 }),
      );
    });

    it('should throw error on update failure', async () => {
      mockBalanceRepository.findOne.mockRejectedValue(new Error('DB error'));

      await expect(
        service.updateBalance('emp-1', 'loc-1', 20),
      ).rejects.toThrow('DB error');
    });
  });

  describe('reserveBalance', () => {
    it('should reserve balance successfully without manager (default repo)', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, reserved: 2 });

      await service.reserveBalance('emp-1', 'loc-1', 2);

      expect(balanceRepository.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
      });
      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reserved: 2 }),
      );
    });

    it('should reserve balance using provided EntityManager', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
      };

      mockManagerRepo.findOne.mockResolvedValue(mockBalance);
      mockManagerRepo.save.mockResolvedValue({ ...mockBalance, reserved: 3 });

      await service.reserveBalance('emp-1', 'loc-1', 3, mockEntityManager);

      expect(mockEntityManager.getRepository).toHaveBeenCalledWith(TimeOffBalance);
      expect(mockManagerRepo.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', locationId: 'loc-1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(mockManagerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reserved: 3 }),
      );
      // Default repo should NOT have been used
      expect(mockBalanceRepository.save).not.toHaveBeenCalled();
    });

    it('should throw error if insufficient balance', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 0,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);

      await expect(
        service.reserveBalance('emp-1', 'loc-1', 25),
      ).rejects.toThrow('Insufficient available balance');
    });

    it('should throw error if balance not found', async () => {
      mockBalanceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.reserveBalance('emp-1', 'loc-1', 2),
      ).rejects.toThrow('Balance not found');
    });

    it('should account for existing reservations when checking availability', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 18,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);

      await expect(
        service.reserveBalance('emp-1', 'loc-1', 5),
      ).rejects.toThrow('Insufficient available balance');
    });
  });

  describe('releaseBalance', () => {
    it('should release reserved balance without manager', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 2,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, reserved: 0 });

      await service.releaseBalance('emp-1', 'loc-1', 2);

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reserved: 0 }),
      );
    });

    it('should release balance using provided EntityManager', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 5,
      };

      mockManagerRepo.findOne.mockResolvedValue(mockBalance);
      mockManagerRepo.save.mockResolvedValue({ ...mockBalance, reserved: 3 });

      await service.releaseBalance('emp-1', 'loc-1', 2, mockEntityManager);

      expect(mockManagerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reserved: 3 }),
      );
      expect(mockBalanceRepository.save).not.toHaveBeenCalled();
    });

    it('should not go below zero on reserved', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 1,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, reserved: 0 });

      await service.releaseBalance('emp-1', 'loc-1', 5);

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reserved: 0 }),
      );
    });

    it('should throw error if balance not found', async () => {
      mockBalanceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.releaseBalance('emp-1', 'loc-1', 2),
      ).rejects.toThrow('Balance not found');
    });
  });

  describe('deductBalance', () => {
    it('should deduct balance and release reservation without manager', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 2,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, balance: 18, reserved: 0 });

      await service.deductBalance('emp-1', 'loc-1', 2);

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ balance: 18, reserved: 0 }),
      );
    });

    it('should deduct balance using provided EntityManager', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 20,
        reserved: 3,
      };

      mockManagerRepo.findOne.mockResolvedValue(mockBalance);
      mockManagerRepo.save.mockResolvedValue({ ...mockBalance, balance: 17, reserved: 0 });

      await service.deductBalance('emp-1', 'loc-1', 3, mockEntityManager);

      expect(mockManagerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ balance: 17, reserved: 0 }),
      );
      expect(mockBalanceRepository.save).not.toHaveBeenCalled();
    });

    it('should throw error if deduction would make balance negative', async () => {
      const mockBalance = {
        id: 'bal-1',
        employeeId: 'emp-1',
        locationId: 'loc-1',
        balance: 3,
        reserved: 2,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);

      await expect(
        service.deductBalance('emp-1', 'loc-1', 5),
      ).rejects.toThrow('Cannot deduct 5 days. Current balance: 3');
    });

    it('should throw error if balance not found', async () => {
      mockBalanceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.deductBalance('emp-1', 'loc-1', 2),
      ).rejects.toThrow('Balance not found');
    });
  });
});
