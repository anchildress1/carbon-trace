import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const previewPortEnv = process.env.PERF_PREVIEW_PORT;
const previewPort = previewPortEnv === undefined ? 4173 : Number.parseInt(previewPortEnv, 10);

if (previewPortEnv !== undefined && !/^\d+$/.test(previewPortEnv)) {
  throw new Error(
    `Invalid PERF_PREVIEW_PORT value: "${previewPortEnv}". Expected an integer between 1 and 65535.`,
  );
}

if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
  throw new Error(
    `Invalid PERF_PREVIEW_PORT value: "${previewPortEnv}". Expected an integer between 1 and 65535.`,
  );
}

const PREVIEW_URL = `http://127.0.0.1:${previewPort}`;
const PREVIEW_ARGS = [
  'exec',
  'vite',
  'preview',
  '--host',
  '127.0.0.1',
  '--port',
  String(previewPort),
  '--strictPort',
];

let previewProcess = null;

let isStopping = false;

async function waitForPreviewServer(timeoutMs = 45_000) {
  if (!previewProcess) {
    throw new Error('Preview server has not been started.');
  }
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

function startPreviewServer() {
  if (previewProcess) {
    return;
  }
  previewProcess = spawn('pnpm', PREVIEW_ARGS, {
    stdio: 'inherit',
    env: {
      ...process.env,
      BROWSER: 'none',
    },
  });
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

  if (!previewProcess || previewProcess.exitCode !== null) {
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
  previewProcess = null;
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
  const chromePath = chromium.executablePath();
  const perfEnv = {
    CHROME_PATH: chromePath,
    PERF_PREVIEW_PORT: String(previewPort),
  };
  await runCommand('pnpm', ['perf:lighthouse:desktop'], perfEnv);
  await runCommand('pnpm', ['perf:lighthouse:mobile'], perfEnv);

  startPreviewServer();
  await waitForPreviewServer();

  await runCommand('pnpm', ['perf:baseline'], {
    PERF_EXTERNAL_SERVER: '1',
    PERF_PREVIEW_PORT: String(previewPort),
  });
  await runCommand('pnpm', ['perf:runtime'], {
    PERF_EXTERNAL_SERVER: '1',
    PERF_PREVIEW_PORT: String(previewPort),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopPreviewServer();
}
