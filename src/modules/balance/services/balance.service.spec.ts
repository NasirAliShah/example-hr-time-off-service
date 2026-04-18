import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    });
  });

  describe('reserveBalance', () => {
    it('should reserve balance successfully', async () => {
      const employeeId = 'emp-1';
      const locationId = 'loc-1';
      const days = 2;

      const mockBalance = {
        id: 'bal-1',
        employeeId,
        locationId,
        balance: 20,
        reserved: 0,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, reserved: 2 });

      await service.reserveBalance(employeeId, locationId, days);

      expect(balanceRepository.save).toHaveBeenCalled();
    });

    it('should throw error if insufficient balance', async () => {
      const employeeId = 'emp-1';
      const locationId = 'loc-1';
      const days = 25;

      const mockBalance = {
        id: 'bal-1',
        employeeId,
        locationId,
        balance: 20,
        reserved: 0,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);

      await expect(service.reserveBalance(employeeId, locationId, days)).rejects.toThrow('Insufficient available balance');
    });
  });

  describe('releaseBalance', () => {
    it('should release reserved balance', async () => {
      const employeeId = 'emp-1';
      const locationId = 'loc-1';
      const days = 2;

      const mockBalance = {
        id: 'bal-1',
        employeeId,
        locationId,
        balance: 20,
        reserved: 2,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, reserved: 0 });

      await service.releaseBalance(employeeId, locationId, days);

      expect(balanceRepository.save).toHaveBeenCalled();
    });
  });

  describe('deductBalance', () => {
    it('should deduct balance and release reservation', async () => {
      const employeeId = 'emp-1';
      const locationId = 'loc-1';
      const days = 2;

      const mockBalance = {
        id: 'bal-1',
        employeeId,
        locationId,
        balance: 20,
        reserved: 2,
      };

      mockBalanceRepository.findOne.mockResolvedValue(mockBalance);
      mockBalanceRepository.save.mockResolvedValue({ ...mockBalance, balance: 18, reserved: 0 });

      await service.deductBalance(employeeId, locationId, days);

      expect(balanceRepository.save).toHaveBeenCalled();
    });
  });
});
