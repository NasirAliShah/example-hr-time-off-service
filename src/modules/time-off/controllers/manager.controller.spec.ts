import { Test, TestingModule } from '@nestjs/testing';
import { ManagerController } from './manager.controller';
import { TimeOffRequestService } from '../services/time-off-request.service';
import { AuthenticatedUser } from '../../../common';

describe('ManagerController', () => {
  let controller: ManagerController;
  let timeOffRequestService: TimeOffRequestService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManagerController],
      providers: [
        {
          provide: TimeOffRequestService,
          useValue: {
            getPendingRequests: jest.fn(),
            approveRequest: jest.fn(),
            rejectRequest: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ManagerController>(ManagerController);
    timeOffRequestService = module.get<TimeOffRequestService>(TimeOffRequestService);
  });

  describe('getPendingRequests', () => {
    it('should get pending requests for manager', async () => {
      const user: AuthenticatedUser = { id: 'mgr-1', type: 'manager', token: 'mgr-1' };
      const mockRequests: any[] = [
        {
          id: 'req-1',
          employeeId: 'emp-1',
          status: 'PENDING_APPROVAL',
          days: 2,
        },
      ];

      jest
        .spyOn(timeOffRequestService, 'getPendingRequests')
        .mockResolvedValue(mockRequests);

      const result = await controller.getPendingRequests(user);

      expect(result).toEqual(mockRequests);
      expect(timeOffRequestService.getPendingRequests).toHaveBeenCalledWith('mgr-1');
    });

    it('should return empty array if no pending requests', async () => {
      const user: AuthenticatedUser = { id: 'mgr-1', type: 'manager', token: 'mgr-1' };

      jest.spyOn(timeOffRequestService, 'getPendingRequests').mockResolvedValue([]);

      const result = await controller.getPendingRequests(user);

      expect(result).toEqual([]);
    });
  });

  describe('approveRequest', () => {
    it('should approve a request', async () => {
      const user: AuthenticatedUser = { id: 'mgr-1', type: 'manager', token: 'mgr-1' };
      const requestId = 'req-1';
      const dto = { comment: 'Approved' };

      const mockResponse: any = {
        id: requestId,
        status: 'APPROVED',
        approvedAt: new Date(),
      };

      jest.spyOn(timeOffRequestService, 'approveRequest').mockResolvedValue(mockResponse);

      const result = await controller.approveRequest(user, requestId, dto);

      expect(result).toEqual(mockResponse);
      expect(timeOffRequestService.approveRequest).toHaveBeenCalledWith(
        requestId,
        'mgr-1',
        dto,
      );
    });

    it('should handle approval errors', async () => {
      const user: AuthenticatedUser = { id: 'mgr-1', type: 'manager', token: 'mgr-1' };
      const requestId = 'req-1';
      const dto = { comment: 'Approved' };

      jest
        .spyOn(timeOffRequestService, 'approveRequest')
        .mockRejectedValue(new Error('Request not found'));

      await expect(controller.approveRequest(user, requestId, dto)).rejects.toThrow();
    });
  });

  describe('rejectRequest', () => {
    it('should reject a request', async () => {
      const user: AuthenticatedUser = { id: 'mgr-1', type: 'manager', token: 'mgr-1' };
      const requestId = 'req-1';
      const dto = { comment: 'Cannot approve' };

      const mockResponse: any = {
        id: requestId,
        status: 'REJECTED',
        rejectedAt: new Date(),
      };

      jest.spyOn(timeOffRequestService, 'rejectRequest').mockResolvedValue(mockResponse);

      const result = await controller.rejectRequest(user, requestId, dto);

      expect(result).toEqual(mockResponse);
      expect(timeOffRequestService.rejectRequest).toHaveBeenCalledWith(
        requestId,
        'mgr-1',
        dto,
      );
    });

    it('should handle rejection errors', async () => {
      const user: AuthenticatedUser = { id: 'mgr-1', type: 'manager', token: 'mgr-1' };
      const requestId = 'req-1';
      const dto = { comment: 'Cannot approve' };

      jest
        .spyOn(timeOffRequestService, 'rejectRequest')
        .mockRejectedValue(new Error('Request not found'));

      await expect(controller.rejectRequest(user, requestId, dto)).rejects.toThrow();
    });
  });
});
