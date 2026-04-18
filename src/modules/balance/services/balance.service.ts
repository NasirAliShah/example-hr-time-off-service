import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TimeOffBalance } from '../entities/time-off-balance.entity';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';
import { ConfigService } from '../../../config/config.service';
import { getLogger } from '../../../common/logger';
import { Logger } from 'winston';
import * as NodeCache from 'node-cache';

interface BalanceDto {
  balance: number;
  reserved: number;
  available: number;
  lastSyncedAt: Date | null;
  isCached: boolean;
  warning?: string;
}

@Injectable()
export class BalanceService {
  private readonly logger: Logger;
  private readonly cache: NodeCache;

  constructor(
    @InjectRepository(TimeOffBalance)
    private readonly balanceRepository: Repository<TimeOffBalance>,
    private readonly hcmIntegrationService: HcmIntegrationService,
    private readonly configService: ConfigService,
  ) {
    this.logger = getLogger('BalanceService');
    this.cache = new NodeCache({ stdTTL: this.configService.cacheTtl });
  }

  async getBalance(employeeId: string, locationId: string): Promise<BalanceDto> {
    const cacheKey = `balance:${employeeId}:${locationId}`;
    
    const cached = this.cache.get<BalanceDto>(cacheKey);
    if (cached) {
      this.logger.debug('Returning cached balance', { employeeId, locationId });
      return { ...cached, isCached: true };
    }

    let localBalance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!localBalance) {
      localBalance = this.balanceRepository.create({
        id: this.generateId(),
        employeeId,
        locationId,
        balance: 0,
        reserved: 0,
      });
      await this.balanceRepository.save(localBalance);
    }

    const shouldSync = this.shouldSyncBalance(localBalance.lastSyncedAt);
    
    if (shouldSync) {
      try {
        const hcmBalance = await this.hcmIntegrationService.checkBalance(employeeId, locationId);
        
        if (hcmBalance.balance !== localBalance.balance) {
          this.logger.warn('Balance mismatch detected, updating from HCM', {
            employeeId,
            locationId,
            local: localBalance.balance,
            hcm: hcmBalance.balance,
          });
          
          localBalance.balance = hcmBalance.balance;
          localBalance.lastSyncedAt = new Date();
          await this.balanceRepository.save(localBalance);
        } else {
          localBalance.lastSyncedAt = new Date();
          await this.balanceRepository.save(localBalance);
        }
      } catch (error) {
        this.logger.error('Failed to sync balance with HCM', {
          employeeId,
          locationId,
          error: error instanceof Error ? error.message : String(error),
        });
        
        const result: BalanceDto = {
          balance: localBalance.balance,
          reserved: localBalance.reserved,
          available: localBalance.balance - localBalance.reserved,
          lastSyncedAt: localBalance.lastSyncedAt,
          isCached: false,
          warning: 'Balance may be stale (HCM unavailable)',
        };
        
        return result;
      }
    }

    const result: BalanceDto = {
      balance: localBalance.balance,
      reserved: localBalance.reserved,
      available: localBalance.balance - localBalance.reserved,
      lastSyncedAt: localBalance.lastSyncedAt,
      isCached: false,
    };

    this.cache.set(cacheKey, result);
    
    return result;
  }

  async reserveBalance(employeeId: string, locationId: string, days: number): Promise<void> {
    this.logger.info('Reserving balance', { employeeId, locationId, days });

    const balance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new Error('Balance not found');
    }

    if (balance.balance - balance.reserved < days) {
      throw new Error('Insufficient available balance');
    }

    balance.reserved += days;
    await this.balanceRepository.save(balance);

    this.invalidateCache(employeeId, locationId);
    
    this.logger.info('Balance reserved successfully', {
      employeeId,
      locationId,
      reserved: days,
      totalReserved: balance.reserved,
      available: balance.balance - balance.reserved,
    });
  }

  async releaseBalance(employeeId: string, locationId: string, days: number): Promise<void> {
    this.logger.info('Releasing balance', { employeeId, locationId, days });

    const balance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new Error('Balance not found');
    }

    balance.reserved = Math.max(0, balance.reserved - days);
    await this.balanceRepository.save(balance);

    this.invalidateCache(employeeId, locationId);
    
    this.logger.info('Balance released successfully', {
      employeeId,
      locationId,
      released: days,
      totalReserved: balance.reserved,
      available: balance.balance - balance.reserved,
    });
  }

  async updateBalance(employeeId: string, locationId: string, newBalance: number): Promise<void> {
    this.logger.info('Updating balance', { employeeId, locationId, newBalance });

    let balance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      balance = this.balanceRepository.create({
        id: this.generateId(),
        employeeId,
        locationId,
        balance: newBalance,
        reserved: 0,
        lastSyncedAt: new Date(),
      });
    } else {
      balance.balance = newBalance;
      balance.lastSyncedAt = new Date();
    }

    await this.balanceRepository.save(balance);

    this.invalidateCache(employeeId, locationId);
    
    this.logger.info('Balance updated successfully', {
      employeeId,
      locationId,
      newBalance,
      reserved: balance.reserved,
      available: balance.balance - balance.reserved,
    });
  }

  async deductBalance(employeeId: string, locationId: string, days: number): Promise<void> {
    this.logger.info('Deducting balance', { employeeId, locationId, days });

    const balance = await this.balanceRepository.findOne({
      where: { employeeId, locationId },
    });

    if (!balance) {
      throw new Error('Balance not found');
    }

    balance.balance -= days;
    balance.reserved = Math.max(0, balance.reserved - days);
    balance.lastSyncedAt = new Date();
    
    await this.balanceRepository.save(balance);

    this.invalidateCache(employeeId, locationId);
    
    this.logger.info('Balance deducted successfully', {
      employeeId,
      locationId,
      deducted: days,
      newBalance: balance.balance,
      reserved: balance.reserved,
      available: balance.balance - balance.reserved,
    });
  }

  private shouldSyncBalance(lastSyncedAt: Date | null): boolean {
    if (!lastSyncedAt) {
      return true;
    }

    const now = new Date();
    const diffMs = now.getTime() - lastSyncedAt.getTime();
    const cacheTtlMs = this.configService.cacheTtl * 1000;

    return diffMs > cacheTtlMs;
  }

  private invalidateCache(employeeId: string, locationId: string): void {
    const cacheKey = `balance:${employeeId}:${locationId}`;
    this.cache.del(cacheKey);
    this.logger.debug('Cache invalidated', { employeeId, locationId });
  }

  private generateId(): string {
    return `bal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
