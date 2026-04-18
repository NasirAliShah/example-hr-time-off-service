import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('idempotency_log')
@Index(['idempotencyKey'], { unique: true })
export class IdempotencyLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 50 })
  method: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint: string;

  @Column({ type: 'text' })
  requestBody: string;

  @Column({ type: 'text' })
  responseBody: string;

  @Column({ type: 'int' })
  statusCode: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', default: () => "datetime('now', '+24 hours')" })
  expiresAt: Date;
}
