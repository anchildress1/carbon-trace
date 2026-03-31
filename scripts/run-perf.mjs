import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PREVIEW_URL = 'http://localhost:4173';
const PREVIEW_ARGS = [
  'exec',
  'vite',
  'preview',
  '--host',
  'localhost',
  '--port',
  '4173',
  '--strictPort',
];

const previewProcess = spawn('pnpm', PREVIEW_ARGS, {
  stdio: 'inherit',
  env: {
    ...process.env,
    BROWSER: 'none',
  },
});

let isStopping = false;

async function waitForPreviewServer(timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (previewProcess.exitCode !== null) {
      throw new Error('Preview server exited before it was ready.');
    }

    try {
      const response = await fetch(PREVIEW_URL, { method: 'GET' });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting while the server boots.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for preview server at ${PREVIEW_URL}.`);
}

function runCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (${reason})`));
    });
  });
}

async function stopPreviewServer() {
  if (isStopping) {
    return;
  }
  isStopping = true;

  if (previewProcess.exitCode !== null) {
    return;
  }

  previewProcess.kill('SIGTERM');

  const stopDeadlineMs = 5_000;
  const stopStartedAt = Date.now();
  while (previewProcess.exitCode === null && Date.now() - stopStartedAt < stopDeadlineMs) {
    await delay(100);
  }

  if (previewProcess.exitCode === null) {
    previewProcess.kill('SIGKILL');
  }
}

function attachSignalHandlers() {
  const shutdown = async () => {
    try {
      await stopPreviewServer();
    } finally {
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

attachSignalHandlers();

try {
  await waitForPreviewServer();

  await runCommand('pnpm', ['perf:lighthouse:desktop']);
  await runCommand('pnpm', ['perf:lighthouse:mobile']);
  await runCommand('pnpm', ['perf:baseline'], {
    PERF_EXTERNAL_SERVER: '1',
  });
  await runCommand('pnpm', ['perf:runtime'], {
    PERF_EXTERNAL_SERVER: '1',
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopPreviewServer();
}
