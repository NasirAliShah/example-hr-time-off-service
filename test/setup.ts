import { DataSource } from 'typeorm';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { TimeOffBalance } from '../src/modules/balance/entities/time-off-balance.entity';
import { TimeOffRequest } from '../src/modules/time-off/entities/time-off-request.entity';
import { SyncLog } from '../src/modules/sync/entities/sync-log.entity';

const AppDataSource = new DataSource({
  type: 'sqlite',
  database: './data/timeoff-e2e.db',
  entities: [Employee, Location, TimeOffBalance, TimeOffRequest, SyncLog],
  synchronize: true,
  dropSchema: true,
});

export async function setupDatabase() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const employeeRepo = AppDataSource.getRepository(Employee);
  const locationRepo = AppDataSource.getRepository(Location);
  const balanceRepo = AppDataSource.getRepository(TimeOffBalance);

  const location = await locationRepo.save({
    id: 'loc-1',
    hcmLocationId: 'hcm-loc-1',
    name: 'New York',
    timezone: 'America/New_York',
  });

  const emp1 = await employeeRepo.save({
    id: 'emp-1',
    hcmEmployeeId: 'hcm-emp-1',
    name: 'John Doe',
    email: 'john@example.com',
  });

  const emp2 = await employeeRepo.save({
    id: 'emp-2',
    hcmEmployeeId: 'hcm-emp-2',
    name: 'Jane Smith',
    email: 'jane@example.com',
  });

  await balanceRepo.save({
    id: 'bal-1',
    employeeId: 'emp-1',
    locationId: 'loc-1',
    balance: 20,
    reserved: 0,
  });

  await balanceRepo.save({
    id: 'bal-2',
    employeeId: 'emp-2',
    locationId: 'loc-1',
    balance: 15,
    reserved: 0,
  });
}

export async function teardownDatabase() {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}
