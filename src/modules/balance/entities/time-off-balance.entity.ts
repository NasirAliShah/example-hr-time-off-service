import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { Location } from '../../locations/entities/location.entity';

@Entity('time_off_balance')
@Index('idx_balance_employee', ['employeeId'])
@Index('idx_balance_location', ['locationId'])
@Index('idx_balance_synced', ['lastSyncedAt'])
@Unique('unique_emp_loc', ['employeeId', 'locationId'])
export class TimeOffBalance {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 36 })
  employeeId: string;

  @Column('varchar', { length: 36 })
  locationId: string;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  reserved: number;

  @Column('datetime', { nullable: true })
  lastSyncedAt: Date;

  @Column('varchar', { length: 255, nullable: true })
  hcmVersion: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;

  @ManyToOne(() => Location, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'locationId' })
  location: Location;

  get available(): number {
    return this.balance - this.reserved;
  }
}
