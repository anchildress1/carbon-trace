import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PausableTimer } from '../../src/pausable-timer.js';

describe('PausableTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('auto-starts and fires callback after delay', () => {
      const cb = vi.fn();
      new PausableTimer(cb, 1000);

      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('is active immediately after creation', () => {
      const timer = new PausableTimer(vi.fn(), 500);

      expect(timer.isActive).toBe(true);
      expect(timer.isPaused).toBe(false);
    });
  });

  describe('pause', () => {
    it('saves remaining time and clears the timeout', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      vi.advanceTimersByTime(300);
      timer.pause();

      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('is a no-op when already paused', () => {
      const timer = new PausableTimer(vi.fn(), 1000);
      vi.advanceTimersByTime(300);
      timer.pause();
      timer.pause();

      expect(timer.isPaused).toBe(true);
    });

    it('is a no-op after callback has fired', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 100);

      vi.advanceTimersByTime(100);
      expect(cb).toHaveBeenCalledOnce();

      timer.pause();
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);
    });
  });

  describe('resume', () => {
    it('reschedules with remaining time', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      vi.advanceTimersByTime(300);
      timer.pause();
      timer.resume();

      expect(timer.isActive).toBe(true);
      expect(timer.isPaused).toBe(false);

      // Should fire around 700ms after resume
      vi.advanceTimersByTime(699);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('is a no-op after cancel', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      timer.cancel();
      timer.resume();

      expect(timer.isActive).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('is a no-op after callback has fired', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 100);

      vi.advanceTimersByTime(100);
      expect(cb).toHaveBeenCalledOnce();

      timer.resume();
      vi.advanceTimersByTime(5000);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('is a no-op when not paused', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      timer.resume();
      expect(timer.isActive).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('fires callback immediately when remaining is zero', () => {
      const perfSpy = vi.spyOn(performance, 'now');
      perfSpy.mockReturnValue(0);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      // Simulate pause exactly at expiry
      perfSpy.mockReturnValue(500);
      timer.pause();

      expect(timer.isPaused).toBe(true);
      expect(cb).not.toHaveBeenCalled();

      timer.resume();
      expect(cb).toHaveBeenCalledOnce();

      perfSpy.mockRestore();
    });

    it('fires callback immediately when elapsed exceeds delay', () => {
      const perfSpy = vi.spyOn(performance, 'now');
      perfSpy.mockReturnValue(0);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      // Simulate pause after delay would have elapsed
      perfSpy.mockReturnValue(600);
      timer.pause();

      timer.resume();
      expect(cb).toHaveBeenCalledOnce();

      perfSpy.mockRestore();
    });
  });

  describe('cancel', () => {
    it('prevents callback from firing', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      timer.cancel();

      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);

      vi.advanceTimersByTime(5000);
      expect(cb).not.toHaveBeenCalled();
    });

    it('clears paused state', () => {
      const timer = new PausableTimer(vi.fn(), 1000);
      vi.advanceTimersByTime(300);
      timer.pause();
      timer.cancel();

      expect(timer.isPaused).toBe(false);
      expect(timer.isActive).toBe(false);
    });

    it('is safe to call multiple times', () => {
      const timer = new PausableTimer(vi.fn(), 1000);
      timer.cancel();
      timer.cancel();

      expect(timer.isActive).toBe(false);
    });
  });

  describe('lifecycle states', () => {
    it('isActive and isPaused reflect correct state at each stage', () => {
      const timer = new PausableTimer(vi.fn(), 1000);

      // Active, not paused
      expect(timer.isActive).toBe(true);
      expect(timer.isPaused).toBe(false);

      // Paused
      vi.advanceTimersByTime(200);
      timer.pause();
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(true);

      // Resumed
      timer.resume();
      expect(timer.isActive).toBe(true);
      expect(timer.isPaused).toBe(false);

      // Fired
      vi.advanceTimersByTime(1000);
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);
    });
  });

  describe('callback fires exactly once', () => {
    it('does not double-fire after pause/resume cycle', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      vi.advanceTimersByTime(500);
      timer.pause();
      timer.resume();
      vi.advanceTimersByTime(500);

      expect(cb).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(5000);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('does not fire after cancel even with resume attempt', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      vi.advanceTimersByTime(300);
      timer.pause();
      timer.cancel();
      timer.resume();

      vi.advanceTimersByTime(5000);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('uses performance.now()', () => {
    it('computes remaining time using performance.now', () => {
      const perfSpy = vi.spyOn(performance, 'now');
      perfSpy.mockReturnValue(1000);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      perfSpy.mockReturnValue(1200);
      timer.pause();

      // Remaining should be ~300ms (500 - 200 elapsed)
      expect(timer.isPaused).toBe(true);

      perfSpy.mockRestore();
    });
  });
});
