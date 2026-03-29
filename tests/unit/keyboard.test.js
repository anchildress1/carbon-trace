import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleKeydown, initKeyboard } from '../../src/keyboard.js';

function makeEvent(key, target = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(e, 'target', { value: target });
  vi.spyOn(e, 'preventDefault');
  return e;
}

function makeButton() {
  const btn = document.createElement('button');
  document.body.appendChild(btn);
  return btn;
}

function makeSvgInsideButton() {
  const btn = document.createElement('button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  btn.appendChild(svg);
  document.body.appendChild(btn);
  return svg;
}

describe('handleKeydown', () => {
  let handler;

  beforeEach(() => {
    handler = vi.fn();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  // ── handled keys ───────────────────────────────────────────────────

  describe('handled keys from non-button focus', () => {
    it('Space dispatches togglePause', () => {
      const e = makeEvent(' ');
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('togglePause');
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('Enter dispatches advance', () => {
      const e = makeEvent('Enter');
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('advance');
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('ArrowRight dispatches advance', () => {
      const e = makeEvent('ArrowRight');
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('advance');
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('ArrowLeft dispatches retreat', () => {
      const e = makeEvent('ArrowLeft');
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('retreat');
      expect(e.preventDefault).toHaveBeenCalled();
    });

    it('Escape dispatches pause', () => {
      const e = makeEvent('Escape');
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('pause');
      expect(e.preventDefault).not.toHaveBeenCalled();
    });
  });

  // ── button guard ───────────────────────────────────────────────────

  describe('button guard — Space and Enter suppressed on buttons', () => {
    it('Space on button is suppressed', () => {
      const btn = makeButton();
      const e = makeEvent(' ', btn);
      expect(handleKeydown(e, handler)).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('Enter on button is suppressed', () => {
      const btn = makeButton();
      const e = makeEvent('Enter', btn);
      expect(handleKeydown(e, handler)).toBe(false);
      expect(handler).not.toHaveBeenCalled();
      expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('Space on SVG inside button is suppressed (closest guard)', () => {
      const svg = makeSvgInsideButton();
      const e = makeEvent(' ', svg);
      expect(handleKeydown(e, handler)).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('Enter on SVG inside button is suppressed (closest guard)', () => {
      const svg = makeSvgInsideButton();
      const e = makeEvent('Enter', svg);
      expect(handleKeydown(e, handler)).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('button guard — Arrow keys and Escape still fire on buttons', () => {
    it('ArrowRight on button still fires', () => {
      const btn = makeButton();
      const e = makeEvent('ArrowRight', btn);
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('advance');
    });

    it('ArrowLeft on button still fires', () => {
      const btn = makeButton();
      const e = makeEvent('ArrowLeft', btn);
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('retreat');
    });

    it('Escape on button still fires', () => {
      const btn = makeButton();
      const e = makeEvent('Escape', btn);
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('pause');
    });
  });

  // ── non-Element targets ─────────────────────────────────────────────

  describe('non-Element targets (e.g. Document)', () => {
    it('Space still fires when target is document (no closest method)', () => {
      const e = makeEvent(' ', document);
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('togglePause');
    });

    it('Enter still fires when target is null', () => {
      const e = makeEvent('Enter', null);
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('advance');
    });

    it('Space still fires when target is a plain object', () => {
      const e = makeEvent(' ', {});
      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('togglePause');
    });
  });

  describe('repeat key events', () => {
    it('repeated ArrowRight events are handled', () => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true });
      Object.defineProperty(e, 'target', { value: document.body });
      vi.spyOn(e, 'preventDefault');

      expect(handleKeydown(e, handler)).toBe(true);
      expect(handler).toHaveBeenCalledWith('advance');
      expect(e.preventDefault).toHaveBeenCalled();
    });
  });

  // ── unhandled keys ─────────────────────────────────────────────────

  describe('unhandled keys', () => {
    it.each(['Tab', 'a', 'Delete', 'Home', 'End', 'F1'])(
      '%s returns false with no side effects',
      (key) => {
        const e = makeEvent(key);
        expect(handleKeydown(e, handler)).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
      },
    );
  });
});

describe('initKeyboard', () => {
  let handler;
  let cleanup;

  beforeEach(() => {
    handler = vi.fn();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = null;
    document.body.replaceChildren();
  });

  it('registers a document keydown listener that dispatches handled keys', () => {
    cleanup = initKeyboard(handler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(handler).toHaveBeenCalledWith('advance');
  });

  it('does not dispatch unhandled keys', () => {
    cleanup = initKeyboard(handler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a cleanup function that removes the listener', () => {
    cleanup = initKeyboard(handler);
    cleanup();
    cleanup = null;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('re-initializing keyboard does not stack listeners', () => {
    const firstCleanup = initKeyboard(handler);
    cleanup = initKeyboard(handler);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);

    firstCleanup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
