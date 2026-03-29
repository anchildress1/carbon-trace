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

    it('fires on next tick with zero delay', () => {
      const cb = vi.fn();
      new PausableTimer(cb, 0);

      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(cb).toHaveBeenCalledOnce();
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
      const dateSpy = vi.spyOn(Date, 'now');
      dateSpy.mockReturnValue(0);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      // Simulate pause exactly at expiry
      dateSpy.mockReturnValue(500);
      timer.pause();

      expect(timer.isPaused).toBe(true);
      expect(cb).not.toHaveBeenCalled();

      timer.resume();
      expect(cb).toHaveBeenCalledOnce();

      dateSpy.mockRestore();
    });

    it('fires callback immediately when elapsed exceeds delay', () => {
      const dateSpy = vi.spyOn(Date, 'now');
      dateSpy.mockReturnValue(0);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      // Simulate pause after delay would have elapsed
      dateSpy.mockReturnValue(600);
      timer.pause();

      timer.resume();
      expect(cb).toHaveBeenCalledOnce();

      dateSpy.mockRestore();
    });

    it('immediate-fire resume clears active/paused state', () => {
      const dateSpy = vi.spyOn(Date, 'now');
      dateSpy.mockReturnValue(0);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      dateSpy.mockReturnValue(750);
      timer.pause();
      timer.resume();

      expect(cb).toHaveBeenCalledOnce();
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);

      dateSpy.mockRestore();
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

  describe('uses Date.now() for timing', () => {
    it('computes remaining time using Date.now', () => {
      const dateSpy = vi.spyOn(Date, 'now');
      dateSpy.mockReturnValue(1000);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 500);

      dateSpy.mockReturnValue(1200);
      timer.pause();

      expect(timer.isPaused).toBe(true);

      // Resume and verify it fires at the correct remaining time (300ms)
      timer.resume();
      vi.advanceTimersByTime(299);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledOnce();

      dateSpy.mockRestore();
    });
  });

  describe('edge cases', () => {
    it('cancel after callback has fired is a no-op', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, 100);

      vi.advanceTimersByTime(100);
      expect(cb).toHaveBeenCalledOnce();

      expect(() => timer.cancel()).not.toThrow();
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);
    });

    it('multiple pause/resume cycles converge correctly', () => {
      const dateSpy = vi.spyOn(Date, 'now');
      dateSpy.mockReturnValue(0);

      const cb = vi.fn();
      const timer = new PausableTimer(cb, 1000);

      // Pause at 200ms (remaining = 800ms)
      dateSpy.mockReturnValue(200);
      timer.pause();

      // Resume
      dateSpy.mockReturnValue(300);
      timer.resume();

      // Pause at 300ms into resume (remaining = 800-300 = 500ms)
      dateSpy.mockReturnValue(600);
      timer.pause();

      // Resume
      dateSpy.mockReturnValue(700);
      timer.resume();

      // Should fire after 500ms from this resume
      vi.advanceTimersByTime(499);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledOnce();

      dateSpy.mockRestore();
    });

    it('propagates callback errors and resets internal timer state', () => {
      const timer = new PausableTimer(() => {
        throw new Error('kaboom');
      }, 50);

      expect(() => vi.advanceTimersByTime(50)).toThrow('kaboom');
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);
    });

    it('callback can call cancel on its own timer without invalid state', () => {
      let timer;
      const cb = vi.fn(() => {
        timer.cancel();
      });
      timer = new PausableTimer(cb, 10);

      vi.advanceTimersByTime(10);

      expect(cb).toHaveBeenCalledOnce();
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);
    });

    it('callback can call pause on its own timer without entering paused state', () => {
      let timer;
      const cb = vi.fn(() => {
        timer.pause();
      });
      timer = new PausableTimer(cb, 10);

      vi.advanceTimersByTime(10);

      expect(cb).toHaveBeenCalledOnce();
      expect(timer.isActive).toBe(false);
      expect(timer.isPaused).toBe(false);
    });

    it('handles very large delay values without overflow behavior', () => {
      const cb = vi.fn();
      const timer = new PausableTimer(cb, Number.MAX_SAFE_INTEGER);

      // JS runtimes may clamp huge delays; what matters is stable behavior.
      expect(cb.mock.calls.length).toBeLessThanOrEqual(1);
      expect(() => vi.advanceTimersByTime(1_000_000)).not.toThrow();
      expect(cb.mock.calls.length).toBeLessThanOrEqual(1);

      timer.cancel();
      expect(timer.isActive).toBe(false);
    });
  });
});
