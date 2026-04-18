import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { ConfigService } from '../../../config/config.service';
import { getLogger } from '../../../common/logger';
import { Logger } from 'winston';

interface BalanceResponse {
  employeeId: string;
  locationId: string;
  balance: number;
  currency: string;
  lastUpdated: string;
}

interface DeductResponse {
  employeeId: string;
  locationId: string;
  previousBalance: number;
  newBalance: number;
  deducted: number;
  confirmationId: string;
}

interface BatchSyncResponse {
  balances: Array<{
    employeeId: string;
    locationId: string;
    balance: number;
    lastUpdated: string;
  }>;
  timestamp: string;
  count: number;
}

enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

@Injectable()
export class HcmIntegrationService {
  private readonly logger: Logger;
  private readonly axiosInstance: AxiosInstance;
  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerTimeout: number;

  constructor(private readonly configService: ConfigService) {
    this.logger = getLogger('HcmIntegrationService');
    this.circuitBreakerThreshold = this.configService.circuitBreakerThreshold;
    this.circuitBreakerTimeout = this.configService.circuitBreakerTimeout;

    this.axiosInstance = axios.create({
      baseURL: this.configService.hcmBaseUrl,
      timeout: this.configService.hcmTimeout,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.configService.hcmApiKey,
      },
    });
  }

  async checkBalance(employeeId: string, locationId: string): Promise<BalanceResponse> {
    this.logger.info('Checking balance with HCM', { employeeId, locationId });

    if (this.isCircuitOpen()) {
      this.logger.warn('Circuit breaker is OPEN, using fallback');
      throw new Error('HCM_UNAVAILABLE: Circuit breaker is open');
    }

    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.axiosInstance.get<BalanceResponse>(
          `/api/balance/${employeeId}/${locationId}`,
        );
      });

      this.onSuccess();
      this.logger.info('Balance check successful', {
        employeeId,
        locationId,
        balance: response.data.balance,
      });

      return response.data;
    } catch (error) {
      this.onFailure();
      this.handleError(error, 'checkBalance');
      throw error;
    }
  }

  async deductBalance(
    employeeId: string,
    locationId: string,
    days: number,
    requestId: string,
  ): Promise<DeductResponse> {
    this.logger.info('Deducting balance with HCM', {
      employeeId,
      locationId,
      days,
      requestId,
    });

    if (this.isCircuitOpen()) {
      this.logger.warn('Circuit breaker is OPEN, cannot deduct balance');
      throw new Error('HCM_UNAVAILABLE: Circuit breaker is open');
    }

    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.axiosInstance.post<DeductResponse>(
          `/api/balance/${employeeId}/${locationId}`,
          {
            deduct: days,
            reason: 'TIME_OFF_REQUEST',
            requestId,
          },
        );
      });

      this.onSuccess();
      this.logger.info('Balance deduction successful', {
        employeeId,
        locationId,
        deducted: days,
        newBalance: response.data.newBalance,
        confirmationId: response.data.confirmationId,
      });

      return response.data;
    } catch (error) {
      this.onFailure();
      this.handleError(error, 'deductBalance');
      throw error;
    }
  }

  async batchSync(): Promise<BatchSyncResponse> {
    this.logger.info('Starting batch sync with HCM');

    if (this.isCircuitOpen()) {
      this.logger.warn('Circuit breaker is OPEN, cannot perform batch sync');
      throw new Error('HCM_UNAVAILABLE: Circuit breaker is open');
    }

    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.axiosInstance.post<BatchSyncResponse>('/api/batch/balances', {});
      });

      this.onSuccess();
      this.logger.info('Batch sync successful', {
        count: response.data.count,
        timestamp: response.data.timestamp,
      });

      return response.data;
    } catch (error) {
      this.onFailure();
      this.handleError(error, 'batchSync');
      throw error;
    }
  }

  private async retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = this.configService.hcmRetryAttempts;
    const baseDelay = this.configService.hcmRetryDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;
        const isTransientError = this.isTransientError(error);

        if (isLastAttempt || !isTransientError) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`, {
          error: this.getErrorMessage(error),
        });

        await this.sleep(delay);
      }
    }

    throw new Error('Max retry attempts reached');
  }

  private isTransientError(error: any): boolean {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (!axiosError.response) {
        return true;
      }
      const status = axiosError.response.status;
      return status >= 500 || status === 408 || status === 429;
    }
    return false;
  }

  private isCircuitOpen(): boolean {
    if (this.circuitState === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.circuitBreakerTimeout) {
        this.logger.info('Circuit breaker transitioning to HALF_OPEN');
        this.circuitState = CircuitState.HALF_OPEN;
        return false;
      }
      return true;
    }
    return false;
  }

  private onSuccess(): void {
    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.logger.info('Circuit breaker transitioning to CLOSED');
      this.circuitState = CircuitState.CLOSED;
    }
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.circuitBreakerThreshold) {
      this.logger.error('Circuit breaker threshold reached, opening circuit', {
        failureCount: this.failureCount,
        threshold: this.circuitBreakerThreshold,
      });
      this.circuitState = CircuitState.OPEN;
    }
  }

  private handleError(error: any, operation: string): void {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        this.logger.error(`HCM ${operation} failed with response`, {
          status: axiosError.response.status,
          data: axiosError.response.data,
        });
      } else if (axiosError.request) {
        this.logger.error(`HCM ${operation} failed - no response`, {
          message: axiosError.message,
        });
      } else {
        this.logger.error(`HCM ${operation} failed - request setup`, {
          message: axiosError.message,
        });
      }
    } else {
      this.logger.error(`HCM ${operation} failed`, {
        error: this.getErrorMessage(error),
      });
    }
  }

  private getErrorMessage(error: any): string {
    if (axios.isAxiosError(error)) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  resetCircuit(): void {
    this.circuitState = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.logger.info('Circuit breaker manually reset');
  }
}
