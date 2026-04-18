import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { Location } from '../../locations/entities/location.entity';

export enum RequestStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity('time_off_request')
@Index('idx_request_employee', ['employeeId'])
@Index('idx_request_location', ['locationId'])
@Index('idx_request_manager', ['managerId'])
@Index('idx_request_status', ['status'])
@Index('idx_request_dates', ['startDate', 'endDate'])
@Index('idx_request_submitted', ['submittedAt'])
@Index('idx_request_hcm_id', ['hcmConfirmationId'])
export class TimeOffRequest {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 36 })
  employeeId: string;

  @Column('varchar', { length: 36 })
  locationId: string;

  @Column('varchar', { length: 36, nullable: true })
  managerId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  days: number;

  @Column('date')
  startDate: Date;

  @Column('date')
  endDate: Date;

  @Column('varchar', { length: 50, default: RequestStatus.DRAFT })
  status: RequestStatus;

  @Column('text', { nullable: true })
  managerComment: string;

  @Column('varchar', { length: 255, nullable: true })
  hcmConfirmationId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column('datetime', { nullable: true })
  submittedAt: Date;

  @Column('datetime', { nullable: true })
  approvedAt: Date;

  @Column('datetime', { nullable: true })
  confirmedAt: Date;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @ManyToOne(() => Location, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'locationId' })
  location: Location;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'managerId' })
  manager: Employee;
}
