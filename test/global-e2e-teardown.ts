import * as path from 'path';
import * as fs from 'fs';

const PID_FILE = path.resolve(__dirname, '../data/.mock-hcm.pid');

export default async function globalTeardown() {
  console.log('\n[E2E Global Teardown] Stopping mock HCM server...');

  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (pid) {
        try {
          // Kill the process group (negative PID kills the group for detached processes)
          process.kill(-pid, 'SIGTERM');
        } catch {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // Process may already be dead
          }
        }
      }
      fs.unlinkSync(PID_FILE);
      console.log(`[E2E Global Teardown] Mock HCM server stopped (PID: ${pid})`);
    } else {
      console.log('[E2E Global Teardown] No PID file found, server may not have been started');
    }
  } catch (err) {
    console.error('[E2E Global Teardown] Error stopping mock HCM server:', err);
  }
}
