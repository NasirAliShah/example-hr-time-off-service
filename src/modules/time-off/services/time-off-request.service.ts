import { Injectable, BadRequestException, NotFoundException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TimeOffRequest, RequestStatus } from '../entities/time-off-request.entity';
import { SubmitRequestDto } from '../dto/submit-request.dto';
import { ApproveRequestDto } from '../dto/approve-request.dto';
import { RejectRequestDto } from '../dto/reject-request.dto';
import { RequestResponseDto } from '../dto/request-response.dto';
import { BalanceService } from '../../balance/services/balance.service';
import { HcmIntegrationService } from '../../hcm-integration/services/hcm-integration.service';
import { getLogger } from '../../../common/logger';
import { Logger } from 'winston';

@Injectable()
export class TimeOffRequestService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly requestRepository: Repository<TimeOffRequest>,
    private readonly balanceService: BalanceService,
    private readonly hcmIntegrationService: HcmIntegrationService,
    private readonly dataSource: DataSource,
  ) {
    this.logger = getLogger('TimeOffRequestService');
  }

  async submitRequest(
    employeeId: string,
    dto: SubmitRequestDto,
  ): Promise<RequestResponseDto> {
    this.logger.info('Submitting time-off request', { employeeId, dto });

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate < startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    if (dto.days <= 0) {
      throw new BadRequestException('Days must be greater than 0');
    }

    const balance = await this.balanceService.getBalance(employeeId, dto.locationId);
    
    if (balance.available < dto.days) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${balance.available} days, Requested: ${dto.days} days`,
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.balanceService.reserveBalance(employeeId, dto.locationId, dto.days);

      const request = this.requestRepository.create({
        id: this.generateId(),
        employeeId,
        locationId: dto.locationId,
        days: dto.days,
        startDate,
        endDate,
        status: RequestStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
      });

      const savedRequest = await queryRunner.manager.save(request);

      await queryRunner.commitTransaction();

      this.logger.info('Time-off request submitted successfully', {
        requestId: savedRequest.id,
        employeeId,
        days: dto.days,
      });

      return this.mapToDto(savedRequest);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to submit request', {
        employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async approveRequest(
    requestId: string,
    managerId: string,
    dto: ApproveRequestDto,
  ): Promise<RequestResponseDto> {
    this.logger.info('Approving time-off request', { requestId, managerId });

    const request = await this.requestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== RequestStatus.PENDING_APPROVAL) {
      throw new ConflictException(`Cannot approve request with status: ${request.status}`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      request.status = RequestStatus.APPROVED;
      request.managerId = managerId;
      request.managerComment = dto.comment || '';
      request.approvedAt = new Date();

      await queryRunner.manager.save(request);

      try {
        const deductResult = await this.hcmIntegrationService.deductBalance(
          request.employeeId,
          request.locationId,
          request.days,
          request.id,
        );

        request.status = RequestStatus.CONFIRMED;
        request.hcmConfirmationId = deductResult.confirmationId;
        request.confirmedAt = new Date();

        await queryRunner.manager.save(request);

        await this.balanceService.deductBalance(
          request.employeeId,
          request.locationId,
          request.days,
        );

        await queryRunner.commitTransaction();

        this.logger.info('Time-off request confirmed successfully', {
          requestId,
          confirmationId: deductResult.confirmationId,
        });
      } catch (hcmError) {
        request.status = RequestStatus.FAILED;
        await queryRunner.manager.save(request);
        await queryRunner.commitTransaction();

        this.logger.error('Failed to confirm time-off request with HCM', {
          requestId,
          error: hcmError instanceof Error ? hcmError.message : String(hcmError),
        });

        throw new ServiceUnavailableException(
          `Request approved but HCM confirmation failed: ${hcmError instanceof Error ? hcmError.message : String(hcmError)}`,
        );
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.mapToDto(request);
  }

  async rejectRequest(
    requestId: string,
    managerId: string,
    dto: RejectRequestDto,
  ): Promise<RequestResponseDto> {
    this.logger.info('Rejecting time-off request', { requestId, managerId });

    const request = await this.requestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    if (request.status !== RequestStatus.PENDING_APPROVAL) {
      throw new ConflictException(`Cannot reject request with status: ${request.status}`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      request.status = RequestStatus.REJECTED;
      request.managerId = managerId;
      request.managerComment = dto.comment || '';

      await queryRunner.manager.save(request);

      await this.balanceService.releaseBalance(
        request.employeeId,
        request.locationId,
        request.days,
      );

      await queryRunner.commitTransaction();

      this.logger.info('Time-off request rejected successfully', { requestId });

      return this.mapToDto(request);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to reject request', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getRequestHistory(employeeId: string): Promise<RequestResponseDto[]> {
    this.logger.info('Getting request history', { employeeId });

    const requests = await this.requestRepository.find({
      where: { employeeId },
      order: { createdAt: 'DESC' },
    });

    return requests.map((request) => this.mapToDto(request));
  }

  async getPendingRequests(managerId?: string): Promise<RequestResponseDto[]> {
    this.logger.info('Getting pending requests', { managerId });

    const queryBuilder = this.requestRepository
      .createQueryBuilder('request')
      .where('request.status = :status', { status: RequestStatus.PENDING_APPROVAL })
      .orderBy('request.submittedAt', 'ASC');

    if (managerId) {
      queryBuilder.andWhere('request.managerId = :managerId', { managerId });
    }

    const requests = await queryBuilder.getMany();

    return requests.map((request) => this.mapToDto(request));
  }

  async getRequestById(requestId: string): Promise<RequestResponseDto> {
    this.logger.info('Getting request by ID', { requestId });

    const request = await this.requestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    return this.mapToDto(request);
  }

  private mapToDto(request: TimeOffRequest): RequestResponseDto {
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      managerId: request.managerId || null,
      days: request.days,
      startDate: request.startDate.toISOString().split('T')[0],
      endDate: request.endDate.toISOString().split('T')[0],
      status: request.status,
      managerComment: request.managerComment || null,
      hcmConfirmationId: request.hcmConfirmationId || null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      submittedAt: request.submittedAt || null,
      approvedAt: request.approvedAt || null,
      confirmedAt: request.confirmedAt || null,
    };
  }

  private generateId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
