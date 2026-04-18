import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('employee')
@Index('idx_employee_hcm_id', ['hcmEmployeeId'])
@Index('idx_employee_email', ['email'])
export class Employee {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 255, unique: true })
  hcmEmployeeId: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('varchar', { length: 255, unique: true })
  email: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
