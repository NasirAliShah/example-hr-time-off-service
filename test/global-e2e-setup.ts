import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const MOCK_HCM_PORT = 3001;
const PID_FILE = path.resolve(__dirname, '../data/.mock-hcm.pid');
const SERVER_PATH = path.resolve(__dirname, '../mock-hcm-server/server.js');

function waitForServer(url: string, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() >= deadline) return reject(new Error('Mock HCM server did not start in time'));
      setTimeout(check, 200);
    };
    check();
  });
}

export default async function globalSetup() {
  console.log('\n[E2E Global Setup] Starting mock HCM server...');

  // Ensure data directory exists for PID file
  const dataDir = path.dirname(PID_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const child = spawn('node', [SERVER_PATH], {
    env: { ...process.env, PORT: String(MOCK_HCM_PORT) },
    stdio: 'ignore',
    detached: true,
  });

  child.unref();

  // Save PID so teardown can kill it
  fs.writeFileSync(PID_FILE, String(child.pid));

  await waitForServer(`http://localhost:${MOCK_HCM_PORT}/health`);
  console.log(`[E2E Global Setup] Mock HCM server is ready (PID: ${child.pid})`);
}
