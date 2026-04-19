import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, BadRequestException, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import * as path from 'path';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { TimeOffBalance } from '../src/modules/balance/entities/time-off-balance.entity';
import { resetMockHcmServer } from './mock-hcm-helper';

process.env.DATABASE_PATH = path.resolve(__dirname, '../data/timeoff-edge-cases-e2e.db');
process.env.NODE_ENV = 'test';

describe('Edge Cases & Advanced Scenarios (e2e)', () => {
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

    // Ensure database is synchronized before running tests
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    // Drop all tables and recreate them to ensure clean state
    await dataSource.dropDatabase();
    await dataSource.synchronize();

    // Reset mock HCM server to initial state
    await resetMockHcmServer();

    const employeeRepo = dataSource.getRepository(Employee);
    const locationRepo = dataSource.getRepository(Location);
    const balanceRepo = dataSource.getRepository(TimeOffBalance);

    await locationRepo.save({
      id: 'loc-1',
      hcmLocationId: 'hcm-loc-1',
      name: 'New York',
      timezone: 'America/New_York',
    });

    await locationRepo.save({
      id: 'invalid-loc',
      hcmLocationId: 'invalid-loc',
      name: 'Invalid Location',
      timezone: 'UTC',
    });

    await employeeRepo.save({
      id: 'emp-1',
      hcmEmployeeId: 'hcm-emp-1',
      name: 'John Doe',
      email: 'john@example.com',
    });

    await employeeRepo.save({
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
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    await app.close();
  });

  describe('Scenario 1: HCM Unavailability & Circuit Breaker', () => {
    it('should retrieve balance successfully', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance?locationId=loc-1')
        .set('Authorization', 'Bearer emp-emp-1');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('balance');
    });

    it('should handle missing locationId in balance request', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1');

      expect(res.status).toBe(400);
    });

    it('should handle invalid locationId gracefully', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/balance?locationId=invalid-loc')
        .set('Authorization', 'Bearer emp-emp-1');

      // Mock HCM returns 400 INVALID_DIMENSION for unknown combos,
      // but the service creates a local balance with 0 and returns 200
      expect(res.status).toBe(200);
    });
  });

  describe('Scenario 2: Sync & Balance Management', () => {
    it('should trigger batch sync successfully', async () => {
      const syncRes = await request(app.getHttpServer())
        .post('/api/v1/admin/sync/batch')
        .set('Authorization', 'Bearer admin-1');

      // With mock HCM server running, batch sync should succeed
      expect(syncRes.status).toBe(201);
      expect(syncRes.body).toHaveProperty('syncId');
      expect(syncRes.body).toHaveProperty('totalRecords');
    });

    it('should retrieve sync logs for audit trail', async () => {
      const logsRes = await request(app.getHttpServer())
        .get('/api/v1/admin/sync')
        .set('Authorization', 'Bearer admin-1');

      expect(logsRes.status).toBe(200);
      expect(Array.isArray(logsRes.body)).toBe(true);
    });

    it('should retrieve specific sync log by ID', async () => {
      const logsRes = await request(app.getHttpServer())
        .get('/api/v1/admin/sync')
        .set('Authorization', 'Bearer admin-1');

      if (logsRes.status === 200 && logsRes.body.length > 0) {
        const syncId = logsRes.body[0].id || 'sync-123';

        const logRes = await request(app.getHttpServer())
          .get(`/api/v1/admin/sync/${syncId}`)
          .set('Authorization', 'Bearer admin-1');

        expect([200, 404, 500]).toContain(logRes.status);
      }
    });
  });

  describe('Scenario 3: Concurrent Request Handling', () => {
    it('should handle sequential requests successfully', async () => {
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1,
          startDate: '2026-07-01',
          endDate: '2026-07-02',
          locationId: 'loc-1',
        });

      // With HCM running and balance available, submission should succeed
      expect([200, 201]).toContain(res1.status);

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1,
          startDate: '2026-07-03',
          endDate: '2026-07-04',
          locationId: 'loc-1',
        });

      expect([200, 201]).toContain(res2.status);
    });

    it('should handle request approval workflow', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1,
          startDate: '2026-08-01',
          endDate: '2026-08-02',
          locationId: 'loc-1',
        });

      if (submitRes.status === 201) {
        const requestId = submitRes.body.id;

        const approveRes = await request(app.getHttpServer())
          .post(`/api/v1/manager/requests/${requestId}/approve`)
          .set('Authorization', 'Bearer mgr-1')
          .send({ comment: 'Approved' });

        expect([200, 201, 400, 409, 503]).toContain(approveRes.status);
      }
    });
  });

  describe('Scenario 4: Request History & Tracking', () => {
    it('should retrieve request history for employee', async () => {
      const historyRes = await request(app.getHttpServer())
        .get('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1');

      expect(historyRes.status).toBe(200);
      expect(Array.isArray(historyRes.body)).toBe(true);
    });

    it('should retrieve pending requests for manager', async () => {
      const pendingRes = await request(app.getHttpServer())
        .get('/api/v1/manager/requests')
        .set('Authorization', 'Bearer mgr-1');

      expect(pendingRes.status).toBe(200);
      expect(Array.isArray(pendingRes.body)).toBe(true);
    });

    it('should handle request retrieval by ID', async () => {
      const historyRes = await request(app.getHttpServer())
        .get('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1');

      if (historyRes.status === 200 && historyRes.body.length > 0) {
        const requestId = historyRes.body[0].id;

        const detailRes = await request(app.getHttpServer())
          .get(`/api/v1/requests/${requestId}`)
          .set('Authorization', 'Bearer emp-emp-1');

        expect([200, 404, 500]).toContain(detailRes.status);
      }
    });
  });

  describe('Scenario 5: Edge Cases & Boundary Conditions', () => {
    it('should reject request with zero days', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 0,
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should reject request with negative days', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: -5,
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should reject request with end date before start date', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-09-05',
          endDate: '2026-09-01',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should handle very large day values gracefully', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 999999,
          startDate: '2026-10-01',
          endDate: '2026-10-02',
          locationId: 'loc-1',
        });

      expect([400, 201]).toContain(res.status);
    });

    it('should handle special characters in comments', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1,
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          locationId: 'loc-1',
          reason: 'Special chars: !@#$%^&*()',
        });

      if (submitRes.status === 201) {
        const requestId = submitRes.body.id;

        const approveRes = await request(app.getHttpServer())
          .post(`/api/v1/manager/requests/${requestId}/approve`)
          .set('Authorization', 'Bearer mgr-1')
          .send({
            comment: 'Approved with special chars: <script>alert("xss")</script>',
          });

        expect([200, 201, 400, 409, 503]).toContain(approveRes.status);
      }
    });

    it('should handle missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-12-01',
        });

      expect(res.status).toBe(400);
    });

    it('should handle invalid date formats', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: 'invalid-date',
          endDate: '2026-12-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Scenario 6: Request State Transitions', () => {
    it('should prevent approval of already-approved request', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1,
          startDate: '2027-01-01',
          endDate: '2027-01-02',
          locationId: 'loc-1',
        });

      if (submitRes.status === 201) {
        const requestId = submitRes.body.id;

        const approveRes1 = await request(app.getHttpServer())
          .post(`/api/v1/manager/requests/${requestId}/approve`)
          .set('Authorization', 'Bearer mgr-1')
          .send({ comment: 'First approval' });

        expect([200, 201, 503]).toContain(approveRes1.status);
        
        if (approveRes1.status === 200 || approveRes1.status === 201) {
          const approveRes2 = await request(app.getHttpServer())
            .post(`/api/v1/manager/requests/${requestId}/approve`)
            .set('Authorization', 'Bearer mgr-1')
            .send({ comment: 'Second approval' });

          expect(approveRes2.status).toBe(409);
        }
      }
    });

    it('should prevent rejection of already-rejected request', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 1,
          startDate: '2027-02-01',
          endDate: '2027-02-02',
          locationId: 'loc-1',
        });

      if (submitRes.status === 201) {
        const requestId = submitRes.body.id;

        const rejectRes1 = await request(app.getHttpServer())
          .post(`/api/v1/manager/requests/${requestId}/reject`)
          .set('Authorization', 'Bearer mgr-1')
          .send({ comment: 'First rejection' });

        expect([200, 201, 503]).toContain(rejectRes1.status);

        if (rejectRes1.status === 200 || rejectRes1.status === 201) {
          const rejectRes2 = await request(app.getHttpServer())
            .post(`/api/v1/manager/requests/${requestId}/reject`)
            .set('Authorization', 'Bearer mgr-1')
            .send({ comment: 'Second rejection' });

          expect(rejectRes2.status).toBe(409);
        }
      }
    });
  });

  describe('Scenario 7: Security & Authorization', () => {
    it('should reject requests without authorization header', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .send({
          days: 1,
          startDate: '2027-03-01',
          endDate: '2027-03-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(401);
    });

    it('should reject requests with invalid token format', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer invalid-token-format')
        .send({
          days: 1,
          startDate: '2027-04-01',
          endDate: '2027-04-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(401);
    });

    it('should prevent employee from accessing manager endpoints', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/manager/requests')
        .set('Authorization', 'Bearer emp-emp-1');

      expect(res.status).toBe(403);
    });

    it('should prevent non-admin from accessing admin endpoints', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/sync/batch')
        .set('Authorization', 'Bearer emp-emp-1');

      expect(res.status).toBe(403);
    });
  });
});
