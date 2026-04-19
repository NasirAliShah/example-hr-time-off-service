import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Employee } from '../modules/employees/entities/employee.entity';
import { Location } from '../modules/locations/entities/location.entity';
import { TimeOffBalance } from '../modules/balance/entities/time-off-balance.entity';
import { TimeOffRequest } from '../modules/time-off/entities/time-off-request.entity';
import { SyncLog } from '../modules/sync/entities/sync-log.entity';

export const DatabaseConfig: TypeOrmModuleOptions = {
  type: 'sqlite',
  database: process.env.DATABASE_PATH || './data/timeoff.db',
  entities: [Employee, Location, TimeOffBalance, TimeOffRequest, SyncLog],
  synchronize: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
  logging: process.env.NODE_ENV === 'development',
  logger: 'advanced-console',
  // SQLite specific options for better concurrency handling
  extra: {
    busyTimeout: 5000,
    // WAL mode allows concurrent reads during writes, improving throughput
    // and reducing SQLITE_BUSY errors under concurrent load
    pragmas: {
      journal_mode: 'WAL',
    },
  },
};
