import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

function releasePortOnWindowsIfInUse(port: number) {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = new Set<number>();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid && pid !== process.pid) {
          pids.add(pid);
        }
      }
    }
    for (const pid of pids) {
      try {
        console.log(`[Frontend] Releasing previous process (PID ${pid}) occupying port ${port}...`);
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        // Ignore if already exited
      }
    }
  } catch {
    // Port is free
  }
}

releasePortOnWindowsIfInUse(5175);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
