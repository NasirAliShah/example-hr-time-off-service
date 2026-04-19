import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncLog, SyncType, SyncStatus } from '../entities/sync-log.entity';
import { TimeOffBalance } from '../../balance/entities/time-off-balance.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { Location } from '../../locations/entities/location.entity';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';
import { BalanceService } from '../../balance/services/balance.service';
import { SyncResultDto } from '../dto/sync-result.dto';
import { getLogger } from '../../../common/logger';
import { Logger } from 'winston';

@Injectable()
export class SyncService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(SyncLog)
    private readonly syncLogRepository: Repository<SyncLog>,
    @InjectRepository(TimeOffBalance)
    private readonly balanceRepository: Repository<TimeOffBalance>,
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    private readonly hcmIntegrationService: HcmIntegrationService,
    private readonly balanceService: BalanceService,
  ) {
    this.logger = getLogger('SyncService');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledBatchSync(): Promise<void> {
    this.logger.info('Starting scheduled batch sync');
    
    try {
      const result = await this.batchSync();
      
      this.logger.info('Scheduled batch sync completed', {
        syncId: result.syncId,
        totalRecords: result.totalRecords,
        successCount: result.successCount,
        conflictCount: result.conflictCount,
        errorCount: result.errorCount,
      });
    } catch (error) {
      this.logger.error('Scheduled batch sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async batchSync(): Promise<SyncResultDto> {
    const syncId = this.generateId();
    const timestamp = new Date();
    
    this.logger.info('Starting batch sync', { syncId });

    const result: SyncResultDto = {
      syncId,
      timestamp,
      totalRecords: 0,
      successCount: 0,
      conflictCount: 0,
      errorCount: 0,
      conflicts: [],
      errors: [],
    };

    try {
      const hcmResponse = await this.hcmIntegrationService.batchSync();
      result.totalRecords = hcmResponse.count;

      for (const hcmBalance of hcmResponse.balances) {
        try {
          await this.syncBalance(
            hcmBalance.employeeId,
            hcmBalance.locationId,
            hcmBalance.balance,
            syncId,
            result,
          );
        } catch (error) {
          result.errorCount++;
          result.errors.push({
            employeeId: hcmBalance.employeeId,
            locationId: hcmBalance.locationId,
            error: error instanceof Error ? error.message : String(error),
          });

          await this.logSync({
            id: this.generateId(),
            type: SyncType.BATCH_SYNC,
            status: SyncStatus.ERROR,
            employeeId: hcmBalance.employeeId,
            locationId: hcmBalance.locationId,
            oldBalance: undefined,
            newBalance: hcmBalance.balance,
            delta: undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
            details: { syncId },
          });
        }
      }

      this.logger.info('Batch sync completed', {
        syncId,
        totalRecords: result.totalRecords,
        successCount: result.successCount,
        conflictCount: result.conflictCount,
        errorCount: result.errorCount,
      });

      return result;
    } catch (error) {
      this.logger.error('Batch sync failed', {
        syncId,
        error: error instanceof Error ? error.message : String(error),
      });

      await this.logSync({
        id: this.generateId(),
        type: SyncType.BATCH_SYNC,
        status: SyncStatus.ERROR,
        employeeId: undefined,
        locationId: undefined,
        oldBalance: undefined,
        newBalance: undefined,
        delta: undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        details: { syncId },
      });

      throw error;
    }
  }

  private async syncBalance(
    employeeId: string,
    locationId: string,
    hcmBalance: number,
    syncId: string,
    result: SyncResultDto,
  ): Promise<void> {
    // Check if employee and location exist before syncing
    const employee = await this.employeeRepository.findOne({ where: { id: employeeId } });
    const location = await this.locationRepository.findOne({ where: { id: locationId } });

    if (!employee || !location) {
      this.logger.debug('Skipping sync for non-existent employee or location', {
        employeeId,
        locationId,
        employeeExists: !!employee,
        locationExists: !!location,
      });
      return;
    }

    let localBalance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!localBalance) {
      localBalance = this.balanceRepository.create({
        id: this.generateId(),
        employeeId,
        locationId,
        balance: hcmBalance,
        reserved: 0,
        lastSyncedAt: new Date(),
      });
      await this.balanceRepository.save(localBalance);

      result.successCount++;

      await this.logSync({
        id: this.generateId(),
        type: SyncType.BATCH_SYNC,
        status: SyncStatus.SUCCESS,
        employeeId,
        locationId,
        oldBalance: undefined,
        newBalance: hcmBalance,
        delta: hcmBalance,
        errorMessage: undefined,
        details: { syncId, action: 'created' },
      });

      this.logger.debug('Created new balance record', {
        employeeId,
        locationId,
        balance: hcmBalance,
      });

      return;
    }

    if (localBalance.balance !== hcmBalance) {
      const delta = hcmBalance - localBalance.balance;
      const oldBalance = localBalance.balance;
      const oldReserved = localBalance.reserved;

      this.logger.warn('Balance conflict detected', {
        employeeId,
        locationId,
        localBalance: oldBalance,
        hcmBalance,
        delta,
      });

      result.conflictCount++;
      result.conflicts.push({
        employeeId,
        locationId,
        localBalance: oldBalance,
        hcmBalance,
        delta,
      });

      localBalance.balance = hcmBalance;
      localBalance.lastSyncedAt = new Date();

      // Validate reserved against new balance to prevent negative available.
      // If reserved > new balance, cap reserved at new balance.
      if (localBalance.reserved > hcmBalance) {
        this.logger.warn('Reserved balance exceeds new HCM balance, capping reserved', {
          employeeId,
          locationId,
          oldReserved: localBalance.reserved,
          newBalance: hcmBalance,
          cappedReserved: hcmBalance,
        });
        localBalance.reserved = Math.max(0, hcmBalance);
      }

      await this.balanceRepository.save(localBalance);

      await this.logSync({
        id: this.generateId(),
        type: SyncType.BATCH_SYNC,
        status: SyncStatus.CONFLICT,
        employeeId,
        locationId,
        oldBalance,
        newBalance: hcmBalance,
        delta,
        errorMessage: oldReserved > hcmBalance
          ? `Reserved (${oldReserved}) exceeded new balance (${hcmBalance}), reserved capped`
          : undefined,
        details: { syncId, action: 'updated', reason: 'conflict_resolved' },
      });

      this.logger.info('Balance conflict resolved, HCM wins', {
        employeeId,
        locationId,
        oldBalance,
        newBalance: hcmBalance,
        reserved: localBalance.reserved,
      });
    } else {
      result.successCount++;

      localBalance.lastSyncedAt = new Date();
      await this.balanceRepository.save(localBalance);

      await this.logSync({
        id: this.generateId(),
        type: SyncType.BATCH_SYNC,
        status: SyncStatus.SUCCESS,
        employeeId,
        locationId,
        oldBalance: hcmBalance,
        newBalance: hcmBalance,
        delta: 0,
        errorMessage: undefined,
        details: { syncId, action: 'synced' },
      });

      this.logger.debug('Balance in sync', {
        employeeId,
        locationId,
        balance: hcmBalance,
      });
    }
  }

  async getSyncLog(syncId: string): Promise<SyncLog[]> {
    this.logger.info('Getting sync log', { syncId });

    const logs = await this.syncLogRepository.find({
      where: { details: { syncId } as any },
      order: { createdAt: 'DESC' },
    });

    return logs;
  }

  async getRecentSyncLogs(limit: number = 100): Promise<SyncLog[]> {
    this.logger.info('Getting recent sync logs', { limit });

    const logs = await this.syncLogRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return logs;
  }

  private async logSync(data: Partial<SyncLog>): Promise<void> {
    const log = this.syncLogRepository.create(data);
    await this.syncLogRepository.save(log);
  }

  private generateId(): string {
    return `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
