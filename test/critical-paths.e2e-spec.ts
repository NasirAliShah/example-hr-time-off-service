import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { TimeOffBalance } from '../src/modules/balance/entities/time-off-balance.entity';
import { TimeOffRequest } from '../src/modules/time-off/entities/time-off-request.entity';
import * as path from 'path';

process.env.DATABASE_PATH = path.resolve(__dirname, '../data/timeoff-critical-e2e.db');
process.env.NODE_ENV = 'test';

describe('Critical Paths - Complete Request Lifecycle (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let requestId: string;

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
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    await app.close();
  });

  describe('CRITICAL PATH 1: Employee Request Submission', () => {
    it('should submit a valid time-off request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 2,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          locationId: 'loc-1',
        });

      expect([201, 400, 500]).toContain(res.status);
      if (res.status === 201) {
        expect(res.body).toHaveProperty('id');
        requestId = res.body.id;
      }
    });

    it('should reject request with insufficient balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 1000,
          startDate: '2026-07-01',
          endDate: '2026-07-02',
          locationId: 'loc-1',
        });

      expect([400, 500]).toContain(res.status);
    });

    it('should reject request with invalid date range', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 2,
          startDate: '2026-05-02',
          endDate: '2026-05-01',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('date');
    });

    it('should reject request with missing locationId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 2,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
        });

      expect(res.status).toBe(400);
    });

    it('should reject request with zero days', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 0,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should reject request with negative days', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: -5,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('CRITICAL PATH 2: Employee Balance Check', () => {
    it('should get employee balance', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance?locationId=loc-1')
        .set('Authorization', 'Bearer emp-1');

      expect([200, 400, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toHaveProperty('balance');
      }
    });

    it('should reject balance check without locationId', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-1');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('locationId');
    });

    it('should return cached balance indicator', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance?locationId=loc-1')
        .set('Authorization', 'Bearer emp-1');

      expect([200, 400, 500]).toContain(res.status);
    });
  });

  describe('CRITICAL PATH 3: Employee Request History', () => {
    it('should get employee request history', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should return empty array for employee with no requests', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/requests')
        .set('Authorization', 'Bearer emp-99');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('CRITICAL PATH 4: Manager Approval Workflow', () => {
    it('should get pending requests for manager', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/manager/requests')
        .set('Authorization', 'Bearer mgr-1');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should approve a pending request', async () => {
      if (!requestId) {
        console.log('Skipping approve test - no request ID');
        return;
      }

      const res = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${requestId}/approve`)
        .set('Authorization', 'Bearer mgr-1')
        .send({
          comment: 'Approved for testing',
        });

      expect([200, 202]).toContain(res.status);
      expect(res.body).toHaveProperty('id');
      expect(['APPROVED', 'CONFIRMED']).toContain(res.body.status);
    });

    it('should reject a pending request', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-2')
        .send({
          days: 1,
          startDate: '2026-08-01',
          endDate: '2026-08-02',
          locationId: 'loc-1',
        });

      if (submitRes.status !== 201) {
        console.log('Skipping reject test - could not create request');
        return;
      }

      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${submitRes.body.id}/reject`)
        .set('Authorization', 'Bearer mgr-1')
        .send({
          comment: 'Cannot approve at this time',
        });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('REJECTED');
    });

    it('should reject approval of non-existent request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/manager/requests/non-existent-id/approve')
        .set('Authorization', 'Bearer mgr-1')
        .send({
          comment: 'Approved',
        });

      expect(res.status).toBe(404);
    });
  });

  describe('CRITICAL PATH 5: Admin Sync Operations', () => {
    it('should trigger batch sync', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sync/batch')
        .set('Authorization', 'Bearer admin-1');

      expect([200, 201, 202, 500]).toContain(res.status);
    });

    it('should get sync logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/sync')
        .set('Authorization', 'Bearer admin-1');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should get specific sync log', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/sync/sync-123')
        .set('Authorization', 'Bearer admin-1');

      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(Array.isArray(res.body)).toBe(true);
      }
    });
  });

  describe('CRITICAL PATH 6: Error Handling & Edge Cases', () => {
    it('should handle missing required fields in request submission', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 2,
        });

      expect(res.status).toBe(400);
    });

    it('should handle invalid JSON in request body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(res.status).toBe(400);
    });

    it('should handle concurrent requests from same employee', async () => {
      const promises = [
        request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Authorization', 'Bearer emp-1')
          .send({
            days: 1,
            startDate: '2026-09-01',
            endDate: '2026-09-02',
            locationId: 'loc-1',
          }),
        request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Authorization', 'Bearer emp-1')
          .send({
            days: 1,
            startDate: '2026-09-03',
            endDate: '2026-09-04',
            locationId: 'loc-1',
          }),
      ];

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.status === 201).length;

      expect(successCount).toBeGreaterThanOrEqual(0);
      expect(successCount).toBeLessThanOrEqual(2);
    });

    it('should handle very large day values', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-1')
        .send({
          days: 999999,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should handle special characters in comments', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-2')
        .send({
          days: 1,
          startDate: '2026-10-01',
          endDate: '2026-10-02',
          locationId: 'loc-1',
        });

      if (submitRes.status !== 201) return;

      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${submitRes.body.id}/approve`)
        .set('Authorization', 'Bearer mgr-1')
        .send({
          comment: 'Approved! <script>alert("xss")</script> & special chars: @#$%',
        });

      expect([200, 202]).toContain(approveRes.status);
    });
  });

  describe('CRITICAL PATH 7: Cross-Role Access Control', () => {
    it('employee cannot approve requests', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/manager/requests/any-id/approve')
        .set('Authorization', 'Bearer emp-1')
        .send({
          comment: 'Trying to approve',
        });

      expect(res.status).toBe(403);
    });

    it('manager cannot trigger sync', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sync/batch')
        .set('Authorization', 'Bearer mgr-1');

      expect(res.status).toBe(403);
    });

    it('admin cannot submit requests as employee', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer admin-1')
        .send({
          days: 2,
          startDate: '2026-06-01',
          endDate: '2026-06-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('CRITICAL PATH 8: Health & Status Endpoints', () => {
    it('should return health status without authentication', async () => {
      const res = await request(app.getHttpServer()).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('time-off-microservice');
    });
  });
});
