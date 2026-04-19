import { setupDatabase, teardownDatabase } from './setup';

beforeAll(async () => {
  await setupDatabase();
});

afterAll(async () => {
  await teardownDatabase();
});
