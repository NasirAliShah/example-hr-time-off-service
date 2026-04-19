import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { SyncService } from '../services/sync.service';

describe('AdminController', () => {
  let controller: AdminController;
  let syncService: SyncService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: SyncService,
          useValue: {
            batchSync: jest.fn(),
            getSyncLog: jest.fn(),
            getRecentSyncLogs: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    syncService = module.get<SyncService>(SyncService);
  });

  describe('triggerBatchSync', () => {
    it('should trigger batch sync', async () => {
      const mockResult: any = {
        syncId: 'sync-123',
        status: 'COMPLETED',
        totalRecords: 100,
        conflictsDetected: 0,
        timestamp: new Date(),
        successCount: 100,
        conflictCount: 0,
        errorCount: 0,
        details: {},
      };

      jest.spyOn(syncService, 'batchSync').mockResolvedValue(mockResult);

      const result = await controller.triggerBatchSync();

      expect(result).toEqual(mockResult);
      expect(syncService.batchSync).toHaveBeenCalled();
    });

    it('should handle sync errors', async () => {
      jest
        .spyOn(syncService, 'batchSync')
        .mockRejectedValue(new Error('Sync failed'));

      await expect(controller.triggerBatchSync()).rejects.toThrow();
    });

    it('should pass through HttpException', async () => {
      const { ServiceUnavailableException } = require('@nestjs/common');
      jest.spyOn(syncService, 'batchSync')
        .mockRejectedValue(new ServiceUnavailableException('HCM down'));
      await expect(controller.triggerBatchSync()).rejects.toThrow(ServiceUnavailableException);
    });

    it('should wrap non-Error thrown values as 500', async () => {
      jest.spyOn(syncService, 'batchSync').mockRejectedValue('string error');
      await expect(controller.triggerBatchSync()).rejects.toThrow('Failed to trigger batch sync');
    });
  });

  describe('getSyncStatus', () => {
    it('should get sync status by ID', async () => {
      const syncId = 'sync-123';
      const mockLogs: any[] = [
        {
          id: 'log-1',
          type: 'BATCH_SYNC',
          status: 'SUCCESS',
          employeeId: null,
          locationId: null,
          oldBalance: null,
          newBalance: null,
          delta: null,
          errorMessage: null,
          details: {},
          createdAt: new Date(),
        },
      ];

      jest.spyOn(syncService, 'getSyncLog').mockResolvedValue(mockLogs);

      const result = await controller.getSyncStatus(syncId);

      expect(result).toEqual(mockLogs);
      expect(syncService.getSyncLog).toHaveBeenCalledWith(syncId);
    });

    it('should handle sync log retrieval errors', async () => {
      jest
        .spyOn(syncService, 'getSyncLog')
        .mockRejectedValue(new Error('Sync log not found'));

      await expect(controller.getSyncStatus('sync-123')).rejects.toThrow();
    });

    it('should pass through HttpException', async () => {
      const { NotFoundException } = require('@nestjs/common');
      jest.spyOn(syncService, 'getSyncLog')
        .mockRejectedValue(new NotFoundException('Not found'));
      await expect(controller.getSyncStatus('sync-123')).rejects.toThrow(NotFoundException);
    });

    it('should wrap non-Error thrown values as 500', async () => {
      jest.spyOn(syncService, 'getSyncLog').mockRejectedValue(undefined);
      await expect(controller.getSyncStatus('sync-123')).rejects.toThrow('Failed to get sync status');
    });
  });

  describe('getRecentSyncLogs', () => {
    it('should get recent sync logs', async () => {
      const mockLogs: any[] = [
        {
          id: 'log-1',
          type: 'BATCH_SYNC',
          status: 'SUCCESS',
          employeeId: null,
          locationId: null,
          oldBalance: null,
          newBalance: null,
          delta: null,
          errorMessage: null,
          details: {},
          createdAt: new Date(),
        },
        {
          id: 'log-2',
          type: 'BATCH_SYNC',
          status: 'SUCCESS',
          employeeId: null,
          locationId: null,
          oldBalance: null,
          newBalance: null,
          delta: null,
          errorMessage: null,
          details: {},
          createdAt: new Date(),
        },
      ];

      jest.spyOn(syncService, 'getRecentSyncLogs').mockResolvedValue(mockLogs);

      const result = await controller.getRecentSyncLogs();

      expect(result).toEqual(mockLogs);
      expect(syncService.getRecentSyncLogs).toHaveBeenCalledWith(100);
    });

    it('should return empty array if no logs', async () => {
      jest.spyOn(syncService, 'getRecentSyncLogs').mockResolvedValue([]);

      const result = await controller.getRecentSyncLogs();

      expect(result).toEqual([]);
    });

    it('should handle sync logs retrieval errors', async () => {
      jest
        .spyOn(syncService, 'getRecentSyncLogs')
        .mockRejectedValue(new Error('Failed to retrieve logs'));

      await expect(controller.getRecentSyncLogs()).rejects.toThrow();
    });

    it('should pass through HttpException', async () => {
      const { BadRequestException } = require('@nestjs/common');
      jest.spyOn(syncService, 'getRecentSyncLogs')
        .mockRejectedValue(new BadRequestException('Bad'));
      await expect(controller.getRecentSyncLogs()).rejects.toThrow(BadRequestException);
    });

    it('should wrap non-Error thrown values as 500', async () => {
      jest.spyOn(syncService, 'getRecentSyncLogs').mockRejectedValue(null);
      await expect(controller.getRecentSyncLogs()).rejects.toThrow('Failed to get sync logs');
    });
  });
});
