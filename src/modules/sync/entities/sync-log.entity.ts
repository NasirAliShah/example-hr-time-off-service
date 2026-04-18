import { Entity, PrimaryColumn, Column, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { Location } from '../../locations/entities/location.entity';

export enum SyncType {
  REAL_TIME_CHECK = 'REAL_TIME_CHECK',
  REAL_TIME_DEDUCT = 'REAL_TIME_DEDUCT',
  BATCH_SYNC = 'BATCH_SYNC',
  WEBHOOK = 'WEBHOOK',
}

export enum SyncStatus {
  SUCCESS = 'SUCCESS',
  CONFLICT = 'CONFLICT',
  ERROR = 'ERROR',
  RETRY = 'RETRY',
}

@Entity('sync_log')
@Index('idx_sync_type', ['type'])
@Index('idx_sync_status', ['status'])
@Index('idx_sync_employee', ['employeeId'])
@Index('idx_sync_location', ['locationId'])
@Index('idx_sync_created', ['createdAt'])
@Index('idx_sync_type_created', ['type', 'createdAt'])
export class SyncLog {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 50 })
  type: SyncType;

  @Column('varchar', { length: 50 })
  status: SyncStatus;

  @Column('varchar', { length: 36, nullable: true })
  employeeId: string;

  @Column('varchar', { length: 36, nullable: true })
  locationId: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  oldBalance: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  newBalance: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  delta: number;

  @Column('text', { nullable: true })
  errorMessage: string;

  @Column('simple-json', { nullable: true })
  details: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @ManyToOne(() => Location, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'locationId' })
  location: Location;
}
