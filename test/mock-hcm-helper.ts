import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import axios from 'axios';

const MOCK_HCM_PORT = 3001;
const MOCK_HCM_URL = `http://localhost:${MOCK_HCM_PORT}`;
const SERVER_PATH = path.resolve(__dirname, '../mock-hcm-server/server.js');

let serverProcess: ChildProcess | null = null;

/**
 * Start the mock HCM server as a child process.
 * Waits until the /health endpoint responds before resolving.
 */
export async function startMockHcmServer(): Promise<void> {
  if (serverProcess) {
    return; // Already running
  }

  return new Promise<void>((resolve, reject) => {
    const child = fork(SERVER_PATH, [], {
      env: { ...process.env, PORT: String(MOCK_HCM_PORT) },
      stdio: 'pipe',
    });

    serverProcess = child;

    child.on('error', (err) => {
      serverProcess = null;
      reject(new Error(`Failed to start mock HCM server: ${err.message}`));
    });

    // Wait for server to be ready by polling /health
    const maxWaitMs = 10000;
    const pollIntervalMs = 200;
    let elapsed = 0;

    const poll = setInterval(async () => {
      try {
        const res = await axios.get(`${MOCK_HCM_URL}/health`, { timeout: 1000 });
        if (res.status === 200) {
          clearInterval(poll);
          resolve();
        }
      } catch {
        elapsed += pollIntervalMs;
        if (elapsed >= maxWaitMs) {
          clearInterval(poll);
          stopMockHcmServer();
          reject(new Error('Mock HCM server did not start within 10s'));
        }
      }
    }, pollIntervalMs);
  });
}

/**
 * Stop the mock HCM server child process.
 */
export function stopMockHcmServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

/**
 * Reset the mock HCM server to initial state (balances, error injection, latency).
 */
export async function resetMockHcmServer(): Promise<void> {
  await axios.post(`${MOCK_HCM_URL}/api/test/reset`);
}

/**
 * Set a specific balance on the mock HCM server.
 */
export async function setMockHcmBalance(
  employeeId: string,
  locationId: string,
  balance: number,
): Promise<void> {
  await axios.post(`${MOCK_HCM_URL}/api/test/set-balance`, {
    employeeId,
    locationId,
    balance,
  });
}

/**
 * Enable/disable error injection on the mock HCM server.
 */
export async function setMockHcmErrorInjection(
  enabled: boolean,
  errorType?: 'timeout' | 'unavailable' | 'conflict',
  probability?: number,
): Promise<void> {
  await axios.post(`${MOCK_HCM_URL}/api/test/error-injection`, {
    enabled,
    errorType,
    probability,
  });
}

export { MOCK_HCM_URL };
