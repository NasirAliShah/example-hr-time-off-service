import { Test, TestingModule } from '@nestjs/testing';
import { TimeOffController } from './time-off.controller';
import { TimeOffRequestService } from '../services/time-off-request.service';
import { BalanceService } from '../../balance/services/balance.service';
import { AuthenticatedUser } from '../../../common';

describe('TimeOffController', () => {
  let controller: TimeOffController;
  let timeOffRequestService: TimeOffRequestService;
  let balanceService: BalanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TimeOffController],
      providers: [
        {
          provide: TimeOffRequestService,
          useValue: {
            submitRequest: jest.fn(),
            getRequestHistory: jest.fn(),
          },
        },
        {
          provide: BalanceService,
          useValue: {
            getBalance: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<TimeOffController>(TimeOffController);
    timeOffRequestService = module.get<TimeOffRequestService>(TimeOffRequestService);
    balanceService = module.get<BalanceService>(BalanceService);
  });

  describe('submitRequest', () => {
    it('should submit a time-off request', async () => {
      const user: AuthenticatedUser = { id: 'emp-1', type: 'employee', token: 'emp-1' };
      const dto = {
        days: 2,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        locationId: 'loc-1',
      };

      const mockResponse: any = {
        id: 'req-123',
        status: 'PENDING_APPROVAL',
        days: 2,
        availableBalance: 18,
      };

      jest.spyOn(timeOffRequestService, 'submitRequest').mockResolvedValue(mockResponse);

      const result = await controller.submitRequest(user, dto);

      expect(result).toEqual(mockResponse);
      expect(timeOffRequestService.submitRequest).toHaveBeenCalledWith('emp-1', dto);
    });

    it('should handle errors during submission', async () => {
      const user: AuthenticatedUser = { id: 'emp-1', type: 'employee', token: 'emp-1' };
      const dto = {
        days: 2,
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        locationId: 'loc-1',
      };

      jest
        .spyOn(timeOffRequestService, 'submitRequest')
        .mockRejectedValue(new Error('Insufficient balance'));

      await expect(controller.submitRequest(user, dto)).rejects.toThrow();
    });
  });

  describe('getRequestHistory', () => {
    it('should get request history for employee', async () => {
      const user: AuthenticatedUser = { id: 'emp-1', type: 'employee', token: 'emp-1' };
      const mockRequests: any[] = [
        {
          id: 'req-1',
          status: 'CONFIRMED',
          days: 2,
        },
      ];

      jest
        .spyOn(timeOffRequestService, 'getRequestHistory')
        .mockResolvedValue(mockRequests);

      const result = await controller.getRequestHistory(user);

      expect(result).toEqual(mockRequests);
      expect(timeOffRequestService.getRequestHistory).toHaveBeenCalledWith('emp-1');
    });

    it('should return empty array if no requests', async () => {
      const user: AuthenticatedUser = { id: 'emp-2', type: 'employee', token: 'emp-2' };

      jest.spyOn(timeOffRequestService, 'getRequestHistory').mockResolvedValue([]);

      const result = await controller.getRequestHistory(user);

      expect(result).toEqual([]);
    });
  });

  describe('getBalance', () => {
    it('should get employee balance', async () => {
      const user: AuthenticatedUser = { id: 'emp-1', type: 'employee', token: 'emp-1' };
      const mockBalance: any = {
        balance: 20,
        reserved: 2,
        available: 18,
        isCached: false,
        lastSyncedAt: new Date(),
      };

      jest.spyOn(balanceService, 'getBalance').mockResolvedValue(mockBalance);

      const result = await controller.getBalance(user, 'loc-1');

      expect(result).toEqual(mockBalance);
      expect(balanceService.getBalance).toHaveBeenCalledWith('emp-1', 'loc-1');
    });

    it('should throw error if locationId is missing', async () => {
      const user: AuthenticatedUser = { id: 'emp-1', type: 'employee', token: 'emp-1' };

      await expect(controller.getBalance(user, '')).rejects.toThrow();
    });

    it('should handle balance service errors', async () => {
      const user: AuthenticatedUser = { id: 'emp-1', type: 'employee', token: 'emp-1' };

      jest
        .spyOn(balanceService, 'getBalance')
        .mockRejectedValue(new Error('Balance not found'));

      await expect(controller.getBalance(user, 'loc-1')).rejects.toThrow();
    });
  });
});
