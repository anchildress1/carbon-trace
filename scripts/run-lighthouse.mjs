import { spawn } from 'node:child_process';

const mode = process.argv[2];
if (mode !== 'desktop' && mode !== 'mobile') {
  throw new Error('Usage: node scripts/run-lighthouse.mjs <desktop|mobile>');
}

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

const previewHost = '127.0.0.1';
const previewUrl = `http://${previewHost}:${previewPort}`;
const config = mode === 'desktop' ? '.lighthouserc.json' : '.lighthouserc.mobile.json';
const startServerCommand = `BROWSER=none pnpm exec vite preview --host ${previewHost} --port ${previewPort} --strictPort`;

const args = [
  'exec',
  'lhci',
  'autorun',
  `--config=${config}`,
  `--collect.url=${previewUrl}`,
  `--collect.startServerCommand=${startServerCommand}`,
];

const child = spawn('pnpm', args, {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
