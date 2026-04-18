import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('location')
@Index('idx_location_hcm_id', ['hcmLocationId'])
export class Location {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column('varchar', { length: 255, unique: true })
  hcmLocationId: string;

  @Column('varchar', { length: 255 })
  name: string;

  @Column('varchar', { length: 50, default: 'UTC' })
  timezone: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
