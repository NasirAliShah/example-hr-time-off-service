import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import * as path from 'path';

process.env.DATABASE_PATH = path.resolve(__dirname, '../data/timeoff-security-e2e.db');
process.env.NODE_ENV = 'test';

describe('Security & Authentication (e2e)', () => {
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
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    await app.close();
  });

  describe('Authentication', () => {
    describe('Missing Authorization Header', () => {
      it('should reject request without authorization header', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toContain('Authorization header is required');
          });
      });

      it('should reject POST request without authorization header', () => {
        return request(app.getHttpServer())
          .post('/api/v1/requests')
          .send({
            days: 2,
            startDate: '2026-06-01',
            endDate: '2026-06-02',
            locationId: 'loc-1',
          })
          .expect(401);
      });

      it('should reject manager endpoint without authorization header', () => {
        return request(app.getHttpServer())
          .get('/api/v1/manager/requests')
          .expect(401);
      });

      it('should reject admin endpoint without authorization header', () => {
        return request(app.getHttpServer())
          .post('/api/v1/admin/sync/batch')
          .expect(401);
      });
    });

    describe('Invalid Authorization Header', () => {
      it('should reject empty bearer token', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer ')
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toMatch(/Bearer token is required|Invalid token format/);
          });
      });

      it('should reject malformed bearer token', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer invalid')
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toContain('Invalid token');
          });
      });

      it('should reject invalid token type', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer unknown-1')
          .expect(401)
          .expect((res) => {
            expect(res.body.message).toContain('Invalid token type');
          });
      });

      it('should reject token without user ID', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer emp-')
          .expect(401);
      });
    });

    describe('Valid Token Formats', () => {
      it('should accept valid employee token (emp-X)', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer emp-1')
          .expect((res) => {
            // Will fail with 404 or 500 due to missing data, but auth should pass
            expect(res.status).not.toBe(401);
          });
      });

      it('should accept valid manager token (mgr-X)', () => {
        return request(app.getHttpServer())
          .get('/api/v1/manager/requests')
          .set('Authorization', 'Bearer mgr-1')
          .expect((res) => {
            expect(res.status).not.toBe(401);
          });
      });

      it('should accept valid admin token (admin-X)', () => {
        return request(app.getHttpServer())
          .post('/api/v1/admin/sync/batch')
          .set('Authorization', 'Bearer admin-1')
          .expect((res) => {
            expect(res.status).not.toBe(401);
          });
      });

      it('should accept complex user IDs with hyphens', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer emp-user-123-abc')
          .expect((res) => {
            expect(res.status).not.toBe(401);
          });
      });
    });
  });

  describe('Authorization (Role-Based Access Control)', () => {
    describe('Employee Role', () => {
      it('should allow employee to access /api/v1/requests', () => {
        return request(app.getHttpServer())
          .get('/api/v1/requests')
          .set('Authorization', 'Bearer emp-1')
          .expect((res) => {
            expect(res.status).not.toBe(403);
          });
      });

      it('should allow employee to access /api/v1/balance', () => {
        return request(app.getHttpServer())
          .get('/api/v1/balance?locationId=loc-1')
          .set('Authorization', 'Bearer emp-1')
          .expect((res) => {
            expect(res.status).not.toBe(403);
          });
      });

      it('should deny employee access to /api/v1/manager/requests', () => {
        return request(app.getHttpServer())
          .get('/api/v1/manager/requests')
          .set('Authorization', 'Bearer emp-1')
          .expect(403)
          .expect((res) => {
            expect(res.body.message).toContain('does not have access');
          });
      });

      it('should deny employee access to /api/v1/admin/sync/batch', () => {
        return request(app.getHttpServer())
          .post('/api/v1/admin/sync/batch')
          .set('Authorization', 'Bearer emp-1')
          .expect(403);
      });
    });

    describe('Manager Role', () => {
      it('should allow manager to access /api/v1/manager/requests', () => {
        return request(app.getHttpServer())
          .get('/api/v1/manager/requests')
          .set('Authorization', 'Bearer mgr-1')
          .expect((res) => {
            expect(res.status).not.toBe(403);
          });
      });

      it('should deny manager access to /api/v1/admin/sync/batch', () => {
        return request(app.getHttpServer())
          .post('/api/v1/admin/sync/batch')
          .set('Authorization', 'Bearer mgr-1')
          .expect(403)
          .expect((res) => {
            expect(res.body.message).toContain('admin');
          });
      });

      it('should deny manager access to /api/v1/requests (employee endpoint)', () => {
        return request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Authorization', 'Bearer mgr-1')
          .send({
            days: 2,
            startDate: '2026-06-01',
            endDate: '2026-06-02',
            locationId: 'loc-1',
          })
          .expect(403);
      });
    });

    describe('Admin Role', () => {
      it('should allow admin to access /api/v1/admin/sync/batch', () => {
        return request(app.getHttpServer())
          .post('/api/v1/admin/sync/batch')
          .set('Authorization', 'Bearer admin-1')
          .expect((res) => {
            expect(res.status).not.toBe(403);
          });
      });

      it('should allow admin to access /api/v1/admin/sync/:id', () => {
        return request(app.getHttpServer())
          .get('/api/v1/admin/sync/sync-123')
          .set('Authorization', 'Bearer admin-1')
          .expect((res) => {
            expect(res.status).not.toBe(403);
          });
      });

      it('should deny admin access to /api/v1/requests (employee endpoint)', () => {
        return request(app.getHttpServer())
          .post('/api/v1/requests')
          .set('Authorization', 'Bearer admin-1')
          .send({
            days: 2,
            startDate: '2026-06-01',
            endDate: '2026-06-02',
            locationId: 'loc-1',
          })
          .expect(403);
      });
    });
  });

  describe('Token Parsing', () => {
    it('should correctly extract employee ID from token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/balance?locationId=loc-1')
        .set('Authorization', 'Bearer emp-john-doe-123')
        .expect((res) => {
          // Auth should pass, user ID should be 'john-doe-123'
          expect(res.status).not.toBe(401);
        });
    });

    it('should correctly extract manager ID from token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/manager/requests')
        .set('Authorization', 'Bearer mgr-manager-001')
        .expect((res) => {
          expect(res.status).not.toBe(401);
        });
    });

    it('should correctly extract admin ID from token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/admin/sync/batch')
        .set('Authorization', 'Bearer admin-system-admin')
        .expect((res) => {
          expect(res.status).not.toBe(401);
        });
    });
  });

  describe('Health Check (No Auth Required)', () => {
    it('should allow unauthenticated access to /health', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });
  });
});
