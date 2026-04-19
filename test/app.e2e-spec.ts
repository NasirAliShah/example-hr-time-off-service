import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { TimeOffBalance } from '../src/modules/balance/entities/time-off-balance.entity';
import * as path from 'path';
import { resetMockHcmServer, setMockHcmBalance } from './mock-hcm-helper';

process.env.DATABASE_PATH = path.resolve(__dirname, '../data/timeoff-e2e.db');
process.env.NODE_ENV = 'test';

describe('Time-Off Microservice (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    dataSource = app.get(DataSource);

    // Ensure database is synchronized before seeding
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    // Drop all tables and recreate them to ensure clean state
    await dataSource.dropDatabase();
    await dataSource.synchronize();

    const employeeRepo = dataSource.getRepository(Employee);
    const locationRepo = dataSource.getRepository(Location);
    const balanceRepo = dataSource.getRepository(TimeOffBalance);

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

    await employeeRepo.save({
      id: '1',
      hcmEmployeeId: 'hcm-mgr-1',
      name: 'Manager',
      email: 'manager@example.com',
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

    // Sync mock HCM server balances with local DB seed data
    await resetMockHcmServer();
    await setMockHcmBalance('emp-1', 'loc-1', 20);
    await setMockHcmBalance('emp-2', 'loc-1', 15);
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    await app.close();
  });

  describe('Health Check', () => {
    it('/health (GET)', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
          expect(res.body.service).toBe('time-off-microservice');
        });
    });
  });

  describe('Time-Off Request Flow', () => {
    let requestId: string;

    beforeAll(async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          locationId: 'loc-1',
        });
      
      if (submitRes.status === 201) {
        requestId = submitRes.body.id;
      }
    });

    it('should get employee balance', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance?locationId=loc-1')
        .set('Authorization', 'Bearer emp-emp-1');
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('balance');
    });

    it('should get request history', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1');
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should get pending requests for manager', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/manager/requests')
        .set('Authorization', 'Bearer mgr-1');
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should approve a request', async () => {
      if (!requestId) {
        console.log('Skipping approve test - no request ID available');
        return;
      }
      
      const res = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${requestId}/approve`)
        .set('Authorization', 'Bearer mgr-1')
        .send({
          comment: 'Approved for testing',
        });
      
      // With mock HCM server running, approval should succeed (HCM deduction works)
      expect([200, 201, 202]).toContain(res.status);
    });
  });

  describe('Admin Sync Operations', () => {
    it('should trigger batch sync', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sync/batch')
        .set('Authorization', 'Bearer admin-1');
      
      // With mock HCM server running, batch sync should succeed
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('syncId');
      expect(res.body).toHaveProperty('totalRecords');
    });

    it('should get recent sync logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/sync')
        .set('Authorization', 'Bearer admin-1');
      
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should reject request with insufficient balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1000,
          startDate: '2026-07-01',
          endDate: '2026-07-02',
          locationId: 'loc-1',
        });
      
      expect(res.status).toBe(400);
    });

    it('should reject request without authorization', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance?locationId=loc-1');
      
      expect(res.status).toBe(401);
    });

    it('should reject invalid date range', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-05-02',
          endDate: '2026-05-01',
          locationId: 'loc-1',
        });
      
      expect(res.status).toBe(400);
    });
  });
});
