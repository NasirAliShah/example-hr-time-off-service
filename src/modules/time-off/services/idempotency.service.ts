import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { IdempotencyLog } from '../entities/idempotency-log.entity';
import { getLogger } from '../../../common/logger';
import { Logger } from 'winston';

@Injectable()
export class IdempotencyService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(IdempotencyLog)
    private readonly idempotencyLogRepository: Repository<IdempotencyLog>,
  ) {
    this.logger = getLogger('IdempotencyService');
  }

  async checkDuplicate(idempotencyKey: string): Promise<IdempotencyLog | null> {
    if (!idempotencyKey) {
      return null;
    }

    const existing = await this.idempotencyLogRepository.findOne({
      where: { idempotencyKey },
    });

    if (existing) {
      this.logger.info('Idempotent request detected', { idempotencyKey });
    }

    return existing || null;
  }

  async recordRequest(
    idempotencyKey: string,
    method: string,
    endpoint: string,
    requestBody: any,
    responseBody: any,
    statusCode: number,
  ): Promise<IdempotencyLog | null> {
    if (!idempotencyKey) {
      return null;
    }

    const log = this.idempotencyLogRepository.create({
      idempotencyKey,
      method,
      endpoint,
      requestBody: JSON.stringify(requestBody),
      responseBody: JSON.stringify(responseBody),
      statusCode,
    });

    const saved = await this.idempotencyLogRepository.save(log);

    this.logger.info('Idempotency log recorded', {
      idempotencyKey,
      method,
      endpoint,
      statusCode,
    });

    return saved;
  }

  async cleanupExpired(): Promise<number> {
    const result = await this.idempotencyLogRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    this.logger.info('Cleaned up expired idempotency logs', {
      deletedCount: result.affected,
    });

    return result.affected || 0;
  }
}
