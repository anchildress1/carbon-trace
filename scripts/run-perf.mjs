import { spawn } from 'node:child_process';
import { preview } from 'vite';
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

let previewServer = null;
let isStopping = false;

async function startPreviewServer() {
  previewServer = await preview({
    // This plain-JavaScript config needs no intermediate config bundle.
    configLoader: 'native',
    preview: {
      host: '127.0.0.1',
      port: previewPort,
      strictPort: true,
      open: false,
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

  await previewServer?.close();
  previewServer = null;
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

  await startPreviewServer();

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
