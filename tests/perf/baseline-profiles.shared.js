export const PERF_GUARDRAILS = Object.freeze({
  pageLoadPromptVisibleMs: 12000,
  clickToBeginMs: 2500,
  navLatencyMs: 4500,
  pauseResumeMs: 1800,
  maxLongTaskMs: 2000,
  minAverageFps: 20,
  maxP95FrameMs: 45,
  maxDroppedFramePercent: 75,
});

export function attachJson(testInfo, name, data) {
  return testInfo.attach(name, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(data, null, 2)),
  });
}
