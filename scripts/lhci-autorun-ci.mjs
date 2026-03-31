import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const lhciArgs = process.argv.slice(2);
const maxAttempts = 2;
const retryDelayMs = 3000;
const retryablePatterns = ['CHROME_INTERSTITIAL_ERROR', 'ERR_CONNECTION_REFUSED'];

function runOnce(args) {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'lhci', 'autorun', ...args], {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let combined = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stderr.write(text);
    });

    child.on('error', (err) => {
      resolve({ code: 1, output: `${combined}\n${err.message}` });
    });

    child.on('exit', (code) => {
      resolve({ code: code ?? 1, output: combined });
    });
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = await runOnce(lhciArgs);

  if (result.code === 0) {
    process.exit(0);
  }

  const isRetryableFailure = retryablePatterns.some((pattern) => result.output.includes(pattern));
  const hasRetryRemaining = attempt < maxAttempts;
  if (!isRetryableFailure || !hasRetryRemaining) {
    process.exit(result.code);
  }

  console.warn(
    `LHCI failed with transient browser/network startup error (attempt ${attempt}/${maxAttempts}). Retrying...`,
  );
  await delay(retryDelayMs);
}
