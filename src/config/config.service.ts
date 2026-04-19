import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get nodeEnv(): string {
    return process.env.NODE_ENV || 'development';
  }

  get port(): number {
    return parseInt(process.env.PORT || '3000', 10);
  }

  get logLevel(): string {
    return process.env.LOG_LEVEL || 'info';
  }

  get databasePath(): string {
    return process.env.DATABASE_PATH || './data/timeoff.db';
  }

  get hcmBaseUrl(): string {
    return process.env.HCM_BASE_URL || 'http://localhost:3001';
  }

  get hcmApiKey(): string {
    return process.env.HCM_API_KEY || 'test-key';
  }

  get hcmTimeout(): number {
    return parseInt(process.env.HCM_TIMEOUT || '5000', 10);
  }

  get hcmRetryAttempts(): number {
    return parseInt(process.env.HCM_RETRY_ATTEMPTS || '3', 10);
  }

  get hcmRetryDelay(): number {
    return parseInt(process.env.HCM_RETRY_DELAY || '1000', 10);
  }

  get cacheTtl(): number {
    return parseInt(process.env.CACHE_TTL || '300', 10);
  }

  get syncInterval(): number {
    return parseInt(process.env.SYNC_INTERVAL || '3600000', 10);
  }

  get syncBatchSize(): number {
    return parseInt(process.env.SYNC_BATCH_SIZE || '100', 10);
  }

  get circuitBreakerThreshold(): number {
    return parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '3', 10);
  }

  get circuitBreakerTimeout(): number {
    return parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '60000', 10);
  }

  get circuitBreakerHalfOpenRequests(): number {
    return parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_REQUESTS || '1', 10);
  }
}
