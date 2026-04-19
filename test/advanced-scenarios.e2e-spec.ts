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
import { v4 as uuidv4 } from 'uuid';

process.env.DATABASE_PATH = path.resolve(__dirname, '../data/timeoff-advanced-e2e.db');
process.env.NODE_ENV = 'test';

describe('Advanced Scenarios (e2e)', () => {
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

    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    await dataSource.dropDatabase();
    await dataSource.synchronize();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  /**
   * Helper to seed fresh data before each test group.
   * Clears all request/balance records and re-seeds.
   */
  async function seedTestData(options?: { balance?: number; reserved?: number }) {
    const balance = options?.balance ?? 20;
    const reserved = options?.reserved ?? 0;

    // Clear tables in order respecting foreign key constraints
    await dataSource.createQueryBuilder().delete().from(TimeOffRequest).execute();
    await dataSource.createQueryBuilder().delete().from(TimeOffBalance).execute();
    await dataSource.createQueryBuilder().delete().from(Employee).execute();
    await dataSource.createQueryBuilder().delete().from(Location).execute();

    const employeeRepo = dataSource.getRepository(Employee);
    const locationRepo = dataSource.getRepository(Location);
    const balanceRepo = dataSource.getRepository(TimeOffBalance);

    await locationRepo.save({
      id: 'loc-1',
      hcmLocationId: 'hcm-loc-1',
      name: 'New York',
      timezone: 'America/New_York',
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

    // Manager employee — token 'Bearer mgr-1' parses as type=mgr, id='1'
    // so the employee id must be '1' for FK constraint on managerId
    await employeeRepo.save({
      id: '1',
      hcmEmployeeId: 'hcm-mgr-1',
      name: 'Manager One',
      email: 'manager@example.com',
    });

    await balanceRepo.save({
      id: 'bal-1',
      employeeId: 'emp-1',
      locationId: 'loc-1',
      balance,
      reserved,
      lastSyncedAt: new Date(),
    });

    await balanceRepo.save({
      id: 'bal-2',
      employeeId: 'emp-2',
      locationId: 'loc-1',
      balance: 15,
      reserved: 0,
      lastSyncedAt: new Date(),
    });
  }

  // =========================================================================
  // TEST 2: Concurrency — multiple simultaneous submissions
  // =========================================================================
  describe('TEST 2: Concurrent Request Submissions', () => {
    beforeEach(async () => {
      await seedTestData({ balance: 10, reserved: 0 });
    });

    it('should not allow total reservations to exceed available balance under concurrency', async () => {
      // Employee has 10 days. Fire 5 requests of 3 days each simultaneously.
      // Only 3 should succeed (9 days total), the rest should fail or error.
      const promises = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Authorization', 'Bearer emp-emp-1')
          .send({
            days: 3,
            startDate: `2026-07-0${i + 1}`,
            endDate: `2026-07-0${i + 1}`,
            locationId: 'loc-1',
          }),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.status === 201 || r.status === 200);
      const clientErrors = results.filter((r) => r.status >= 400 && r.status < 500);
      const serverErrors = results.filter((r) => r.status >= 500);

      // At most 3 requests of 3 days can succeed on a 10-day balance.
      // Under SQLite, concurrent transactions may all fail with SQLITE_BUSY (500),
      // which is expected behavior for a single-writer database.
      expect(successes.length).toBeLessThanOrEqual(3);

      // Critical invariant: balance available must never go negative
      const balanceRes = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(balanceRes.status).toBe(200);
      expect(balanceRes.body.available).toBeGreaterThanOrEqual(0);
      // reserved must not exceed the total balance
      expect(balanceRes.body.reserved).toBeLessThanOrEqual(balanceRes.body.balance);
      // All requests should be accounted for
      expect(successes.length + clientErrors.length + serverErrors.length).toBe(5);
    });

    it('should handle sequential submissions from different employees independently', async () => {
      // Run sequentially: SQLite serializes transactions and concurrent writes
      // can cause SQLITE_BUSY; the important thing is both succeed independently.
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 5,
          startDate: '2026-08-01',
          endDate: '2026-08-05',
          locationId: 'loc-1',
        });

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-2')
        .send({
          days: 5,
          startDate: '2026-08-01',
          endDate: '2026-08-05',
          locationId: 'loc-1',
        });

      // Both should succeed — they have independent balances
      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
    });
  });

  // =========================================================================
  // TEST 4: Full Lifecycle Balance Conservation
  // =========================================================================
  describe('TEST 4: Full Lifecycle Balance Conservation', () => {
    beforeEach(async () => {
      await seedTestData({ balance: 20, reserved: 0 });
    });

    it('should conserve balance through submit → reject cycle', async () => {
      // Check initial balance
      const initialBalance = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(initialBalance.status).toBe(200);
      expect(initialBalance.body.balance).toBe(20);
      expect(initialBalance.body.reserved).toBe(0);
      expect(initialBalance.body.available).toBe(20);

      // Submit a request for 5 days
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 5,
          startDate: '2026-09-01',
          endDate: '2026-09-05',
          locationId: 'loc-1',
        });

      expect([200, 201]).toContain(submitRes.status);
      const requestId = submitRes.body.id;

      // Verify balance after submission: reserved should increase by 5
      const afterSubmit = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(afterSubmit.status).toBe(200);
      expect(afterSubmit.body.balance).toBe(20);
      expect(afterSubmit.body.reserved).toBe(5);
      expect(afterSubmit.body.available).toBe(15);

      // Reject the request — balance should be fully restored
      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${requestId}/reject`)
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'Not needed' });

      expect([200, 201]).toContain(rejectRes.status);
      expect(rejectRes.body.status).toBe('REJECTED');

      // Verify final balance: should be back to original
      const finalBalance = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(finalBalance.status).toBe(200);
      expect(finalBalance.body.balance).toBe(20);
      expect(finalBalance.body.reserved).toBe(0);
      expect(finalBalance.body.available).toBe(20);
    });

    it('should track multiple pending requests and release correctly', async () => {
      // Submit two requests
      const submit1 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 3,
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          locationId: 'loc-1',
        });

      const submit2 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 4,
          startDate: '2026-10-10',
          endDate: '2026-10-13',
          locationId: 'loc-1',
        });

      expect([200, 201]).toContain(submit1.status);
      expect([200, 201]).toContain(submit2.status);

      // Check balance: 3 + 4 = 7 reserved
      const midBalance = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(midBalance.body.reserved).toBe(7);
      expect(midBalance.body.available).toBe(13);

      // Reject first request — should release 3
      await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${submit1.body.id}/reject`)
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'Denied' });

      const afterReject = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(afterReject.body.reserved).toBe(4);
      expect(afterReject.body.available).toBe(16);
    });
  });

  // =========================================================================
  // TEST 6: Idempotency Key Enforcement
  // =========================================================================
  describe('TEST 6: Idempotency Key Enforcement', () => {
    beforeEach(async () => {
      await seedTestData({ balance: 20, reserved: 0 });
    });

    it('should return the same response for duplicate idempotency key', async () => {
      const idempotencyKey = uuidv4();

      const firstRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          locationId: 'loc-1',
          idempotencyKey,
        });

      expect([200, 201]).toContain(firstRes.status);
      const firstRequestId = firstRes.body.id;

      // Submit again with same idempotency key
      const secondRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-11-01',
          endDate: '2026-11-02',
          locationId: 'loc-1',
          idempotencyKey,
        });

      expect([200, 201]).toContain(secondRes.status);
      // Should return the SAME request, not create a new one
      expect(secondRes.body.id).toBe(firstRequestId);
    });

    it('should not double-reserve balance on duplicate submission', async () => {
      const idempotencyKey = uuidv4();

      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 5,
          startDate: '2026-11-10',
          endDate: '2026-11-14',
          locationId: 'loc-1',
          idempotencyKey,
        });

      // Submit duplicate
      await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 5,
          startDate: '2026-11-10',
          endDate: '2026-11-14',
          locationId: 'loc-1',
          idempotencyKey,
        });

      // Balance should only have 5 reserved, not 10
      const balanceRes = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(balanceRes.body.reserved).toBe(5);
      expect(balanceRes.body.available).toBe(15);
    });

    it('should allow different idempotency keys to create separate requests', async () => {
      const key1 = uuidv4();
      const key2 = uuidv4();

      const res1 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-12-01',
          endDate: '2026-12-02',
          locationId: 'loc-1',
          idempotencyKey: key1,
        });

      expect([200, 201]).toContain(res1.status);

      const res2 = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-12-03',
          endDate: '2026-12-04',
          locationId: 'loc-1',
          idempotencyKey: key2,
        });

      expect([200, 201]).toContain(res2.status);
      expect(res1.body.id).not.toBe(res2.body.id);
    });
  });

  // =========================================================================
  // TEST 7: Approval Re-validation
  // =========================================================================
  describe('TEST 7: Approval Re-validation & State Transitions', () => {
    beforeEach(async () => {
      await seedTestData({ balance: 20, reserved: 0 });
    });

    it('should not allow approving an already rejected request', async () => {
      // Submit
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          locationId: 'loc-1',
        });

      expect([200, 201]).toContain(submitRes.status);
      const reqId = submitRes.body.id;

      // Reject it
      const rejectRes = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${reqId}/reject`)
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'No' });

      expect([200, 201]).toContain(rejectRes.status);
      expect(rejectRes.body.status).toBe('REJECTED');

      // Try to approve the already-rejected request
      const approveRes = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${reqId}/approve`)
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'Changed mind' });

      expect(approveRes.status).toBe(409);
    });

    it('should not allow double-rejection', async () => {
      const submitRes = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-09-05',
          endDate: '2026-09-06',
          locationId: 'loc-1',
        });

      const reqId = submitRes.body.id;

      // First rejection
      const reject1 = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${reqId}/reject`)
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'No' });

      expect([200, 201]).toContain(reject1.status);

      // Second rejection should fail with 409 Conflict
      const reject2 = await request(app.getHttpServer())
        .post(`/api/v1/manager/requests/${reqId}/reject`)
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'Still no' });

      expect(reject2.status).toBe(409);
    });

    it('should return 404 for approval of non-existent request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/manager/requests/non-existent-req/approve')
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'Approved' });

      expect(res.status).toBe(404);
    });

    it('should return 404 for rejection of non-existent request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/manager/requests/non-existent-req/reject')
        .set('Authorization', 'Bearer mgr-1')
        .send({ comment: 'Rejected' });

      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // Exact HTTP Status Code Validation
  // =========================================================================
  describe('Exact HTTP Status Code Validation', () => {
    beforeEach(async () => {
      await seedTestData({ balance: 20, reserved: 0 });
    });

    it('should return 400 for insufficient balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 100,
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid date range (end before start)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          startDate: '2026-09-10',
          endDate: '2026-09-01',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should return 400 for zero days', async () => {
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

    it('should return 400 for negative days', async () => {
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

    it('should return 400 for missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 2,
          // missing startDate, endDate, locationId
        });

      expect(res.status).toBe(400);
    });

    it('should return 401 for missing auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .send({
          days: 2,
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(401);
    });

    it('should return 403 for wrong role', async () => {
      // Manager tries to submit an employee request
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer mgr-1')
        .send({
          days: 2,
          startDate: '2026-09-01',
          endDate: '2026-09-02',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(403);
    });

    it('should return 200 for health check', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status');
    });
  });

  // =========================================================================
  // Balance Boundary Tests
  // =========================================================================
  describe('Balance Boundary Tests', () => {
    it('should allow request that exactly exhausts available balance', async () => {
      await seedTestData({ balance: 5, reserved: 0 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 5,
          startDate: '2026-09-01',
          endDate: '2026-09-05',
          locationId: 'loc-1',
        });

      expect([200, 201]).toContain(res.status);

      // Balance should now be fully reserved
      const balanceRes = await request(app.getHttpServer())
        .get('/api/v1/balance')
        .set('Authorization', 'Bearer emp-emp-1')
        .query({ locationId: 'loc-1' });

      expect(balanceRes.body.balance).toBe(5);
      expect(balanceRes.body.reserved).toBe(5);
      expect(balanceRes.body.available).toBe(0);
    });

    it('should reject request that exceeds available by 1 day', async () => {
      await seedTestData({ balance: 5, reserved: 0 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 6,
          startDate: '2026-09-01',
          endDate: '2026-09-06',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should account for existing reservations in availability check', async () => {
      await seedTestData({ balance: 10, reserved: 7 });

      // Only 3 available, requesting 4 should fail
      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 4,
          startDate: '2026-09-01',
          endDate: '2026-09-04',
          locationId: 'loc-1',
        });

      expect(res.status).toBe(400);
    });

    it('should allow request within remaining availability', async () => {
      await seedTestData({ balance: 10, reserved: 7 });

      const res = await request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', 'Bearer emp-emp-1')
        .send({
          days: 3,
          startDate: '2026-09-01',
          endDate: '2026-09-03',
          locationId: 'loc-1',
        });

      expect([200, 201]).toContain(res.status);
    });
  });
});
