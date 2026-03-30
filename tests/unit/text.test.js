import { describe, it, expect, vi, beforeEach } from 'vitest';

const { timelineInstances } = vi.hoisted(() => ({
  timelineInstances: [],
}));

vi.mock('gsap', () => {
  return {
    gsap: {
      timeline: vi.fn(() => {
        const timelineMock = {
          fromTo: vi.fn().mockReturnThis(),
          to: vi.fn().mockReturnThis(),
          call: vi.fn().mockReturnThis(),
        };
        timelineInstances.push(timelineMock);
        return timelineMock;
      }),
      killTweensOf: vi.fn(),
    },
  };
});

import { createLineElement, buildNarrationTimeline, clearNarrationLayer } from '../../src/text.js';
import { gsap } from 'gsap';

describe('text.js', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    vi.clearAllMocks();
    timelineInstances.length = 0;
  });

  describe('createLineElement', () => {
    it('creates a paragraph element with narration-line class', () => {
      const el = createLineElement('Hello world', container);

      expect(el.tagName).toBe('P');
      expect(el.className).toBe('narration-line');
      expect(el.textContent).toBe('Hello world');
    });

    it('appends element to container', () => {
      createLineElement('Test', container);

      expect(container.children.length).toBe(1);
    });

    it('handles empty string', () => {
      const el = createLineElement('', container);

      expect(el.textContent).toBe('');
    });

    it('preserves HTML special characters as text content', () => {
      const el = createLineElement('<b>bold</b> & "quoted"', container);

      expect(el.textContent).toBe('<b>bold</b> & "quoted"');
      expect(el.children.length).toBe(0);
    });

    it('appends multiple elements sequentially', () => {
      createLineElement('First', container);
      createLineElement('Second', container);
      createLineElement('Third', container);

      expect(container.children.length).toBe(3);
      expect(container.children[2].textContent).toBe('Third');
    });

    it('applies absolute positioning when x and y are provided', () => {
      const el = createLineElement('Positioned', container, { x: 10, y: 70 });

      expect(el.style.position).toBe('absolute');
      expect(el.style.left).toBe('10%');
      expect(el.style.top).toBe('70%');
      expect(el.classList.contains('narration-line--positioned')).toBe(true);
    });

    it('applies vertical centering transform when positioned', () => {
      const el = createLineElement('Left text', container, { x: 10, y: 50 });

      expect(el.style.transform).toBe('translateY(-50%)');
    });

    it('does not apply positioning when x/y are not provided', () => {
      const el = createLineElement('Default', container);

      expect(el.style.position).toBe('');
      expect(el.classList.contains('narration-line--positioned')).toBe(false);
    });

    it('does not apply positioning when options is empty object', () => {
      const el = createLineElement('Default', container, {});

      expect(el.style.position).toBe('');
    });

    it('does not apply positioning when x or y is missing', () => {
      const onlyX = createLineElement('Only X', container, { x: 10, y: null });
      const onlyY = createLineElement('Only Y', container, { x: null, y: 10 });

      expect(onlyX.style.position).toBe('');
      expect(onlyY.style.position).toBe('');
      expect(onlyX.classList.contains('narration-line--positioned')).toBe(false);
      expect(onlyY.classList.contains('narration-line--positioned')).toBe(false);
    });

    it('handles x=0 and y=0 as valid positions', () => {
      const el = createLineElement('Origin', container, { x: 0, y: 0 });

      expect(el.style.position).toBe('absolute');
      expect(el.style.left).toBe('0%');
      expect(el.style.top).toBe('0%');
    });

    it('ignores unknown options while preserving positioned styles', () => {
      const el = createLineElement('Fallback', container, { x: 50, y: 50, unused: 'center' });

      expect(el.style.getPropertyValue('text-align')).toBe('');
      expect(el.style.transform).toBe('translateY(-50%)');
    });
  });

  describe('buildNarrationTimeline', () => {
    it('creates a paused GSAP timeline from lines config', () => {
      const lines = [
        { text: 'Line one', enter: 500, exit: 4000 },
        { text: 'Line two', enter: 2000, exit: 6000 },
      ];

      const { timeline: tl } = buildNarrationTimeline(lines, container);

      expect(gsap.timeline).toHaveBeenCalledWith({ paused: true });
      expect(container.children.length).toBe(2);
      expect(tl.fromTo).toHaveBeenCalledTimes(2);
      expect(tl.to).toHaveBeenCalledTimes(2);
    });

    it('creates independent GSAP timelines per invocation', () => {
      const lines = [{ text: 'First', enter: 0, exit: 1000 }];
      const firstResult = buildNarrationTimeline(lines, container);

      const secondContainer = document.createElement('div');
      const secondResult = buildNarrationTimeline(lines, secondContainer);

      expect(firstResult.timeline).not.toBe(secondResult.timeline);
      expect(timelineInstances).toHaveLength(2);
    });

    it('creates independent GSAP timelines per invocation', () => {
      const lines = [{ text: 'First', enter: 0, exit: 1000 }];
      const firstResult = buildNarrationTimeline(lines, container);

      const secondContainer = document.createElement('div');
      const secondResult = buildNarrationTimeline(lines, secondContainer);

      expect(firstResult.timeline).not.toBe(secondResult.timeline);
      expect(timelineInstances).toHaveLength(2);
    });

    it('uses reduced motion styles when flag is true', () => {
      const lines = [{ text: 'Reduced', enter: 0, exit: 1000 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container, { reducedMotion: true });

      const fromToCall = tl.fromTo.mock.calls[0];
      expect(fromToCall[1]).toEqual({ opacity: 0 });
      expect(fromToCall[2]).toMatchObject({ duration: 0.3, ease: 'none' });
    });

    it('uses ghost-drift styles when reduced motion is false', () => {
      const lines = [{ text: 'Drift', enter: 0, exit: 1000 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container, { reducedMotion: false });

      const fromToCall = tl.fromTo.mock.calls[0];
      expect(fromToCall[1]).toEqual({ opacity: 0, y: -20, filter: 'blur(4px)' });
      expect(fromToCall[2]).toMatchObject({ duration: 1.2, ease: 'power3.out' });
    });

    it('clears existing content before building', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      const lines = [{ text: 'New line', enter: 0, exit: 1000 }];
      buildNarrationTimeline(lines, container);

      expect(container.children.length).toBe(1);
    });

    it('handles empty lines array', () => {
      const { timeline: tl } = buildNarrationTimeline([], container);

      expect(container.children.length).toBe(0);
      expect(tl.fromTo).not.toHaveBeenCalled();
    });

    it('converts enter/exit ms to seconds for GSAP', () => {
      const lines = [{ text: 'Timed', enter: 2000, exit: 5000 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container);

      const fromToCall = tl.fromTo.mock.calls[0];
      expect(fromToCall[3]).toBe(2);

      const toCall = tl.to.mock.calls[0];
      expect(toCall[2]).toBe(5);
    });

    it('converts zero enter/exit to 0 seconds', () => {
      const lines = [{ text: 'Instant', enter: 0, exit: 0 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container);

      expect(tl.fromTo.mock.calls[0][3]).toBe(0);
      expect(tl.to.mock.calls[0][2]).toBe(0);
    });

    it('passes negative enter/exit values through to timeline positions', () => {
      const lines = [{ text: 'Negative', enter: -500, exit: -100 }];
      const { timeline: tl } = buildNarrationTimeline(lines, container);

      expect(tl.fromTo.mock.calls[0][3]).toBe(-0.5);
      expect(tl.to.mock.calls[0][2]).toBe(-0.1);
    });

    it('uses reduced motion exit animation with short duration', () => {
      const lines = [{ text: 'Exit test', enter: 0, exit: 3000 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container, { reducedMotion: true });

      const toCall = tl.to.mock.calls[0];
      expect(toCall[1]).toMatchObject({ opacity: 0, duration: 0.3, ease: 'none' });
    });

    it('uses ghost-drift exit animation with y offset and blur', () => {
      const lines = [{ text: 'Exit drift', enter: 0, exit: 3000 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container, { reducedMotion: false });

      const toCall = tl.to.mock.calls[0];
      expect(toCall[1]).toMatchObject({
        opacity: 0,
        y: 120,
        x: 0,
        filter: 'blur(14px)',
        duration: 1.8,
        ease: 'power2.in',
      });
    });

    it('passes position data to createLineElement', () => {
      const lines = [
        { text: 'Positioned', enter: 0, exit: 1000, x: 10, y: 70 },
        { text: 'Centered', enter: 500, exit: 2000, x: 50, y: 50 },
      ];

      buildNarrationTimeline(lines, container);

      const first = container.children[0];
      expect(first.style.position).toBe('absolute');
      expect(first.style.left).toBe('10%');
      expect(first.style.top).toBe('70%');

      const second = container.children[1];
      expect(second.style.left).toBe('50%');
    });

    it('handles lines without position data (backward-compatible)', () => {
      const lines = [{ text: 'No position', enter: 0, exit: 1000 }];

      buildNarrationTimeline(lines, container);

      const el = container.children[0];
      expect(el.style.position).toBe('');
      expect(el.classList.contains('narration-line--positioned')).toBe(false);
    });

    it('skips lines with missing enter timing', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const lines = [
        { text: 'Valid', enter: 0, exit: 1000 },
        { text: 'No enter', exit: 2000 },
        { text: 'Also valid', enter: 1000, exit: 3000 },
      ];

      const { timeline: tl } = buildNarrationTimeline(lines, container);

      expect(container.children.length).toBe(2);
      expect(tl.fromTo).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        'Narration line 1 has invalid enter/exit timing:',
        expect.objectContaining({ text: 'No enter' }),
      );
      errorSpy.mockRestore();
    });

    it('skips lines with missing exit timing', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const lines = [{ text: 'No exit', enter: 500 }];

      const { timeline: tl } = buildNarrationTimeline(lines, container);

      expect(container.children.length).toBe(0);
      expect(tl.fromTo).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('skips lines with non-numeric enter/exit values', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const lines = [{ text: 'Bad timing', enter: 'foo', exit: 'bar' }];

      buildNarrationTimeline(lines, container);

      expect(container.children.length).toBe(0);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('handles mixed positioned and non-positioned lines', () => {
      const lines = [
        { text: 'Positioned', enter: 0, exit: 1000, x: 10, y: 70 },
        { text: 'Default', enter: 500, exit: 2000 },
      ];

      buildNarrationTimeline(lines, container);

      expect(container.children[0].classList.contains('narration-line--positioned')).toBe(true);
      expect(container.children[1].classList.contains('narration-line--positioned')).toBe(false);
    });

    it('returns empty captionEntries when no captions provided', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 1000 }];

      const { captionEntries } = buildNarrationTimeline(lines, container);

      expect(captionEntries).toEqual([]);
    });

    it('does not schedule caption callbacks when captions is an empty array', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 1000 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions: [],
        captionContainer,
      });

      expect(captionEntries).toEqual([]);
      expect(tl.call).not.toHaveBeenCalled();
    });

    it('ignores non-array captions payloads', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 1000 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions: null,
        captionContainer,
      });

      expect(captionEntries).toEqual([]);
      expect(tl.call).not.toHaveBeenCalled();
    });

    it('places caption callbacks at correct timeline positions', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 5000 }];
      const captions = [
        { text: 'Caption A', start: 500, end: 2000 },
        { text: 'Caption B', start: 3000, end: 4500 },
      ];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
        captionDelay: 1000,
        isCaptionEnabled: () => true,
      });

      // 2 captions × 2 calls each (show + hide) = 4 tl.call() invocations
      expect(tl.call).toHaveBeenCalledTimes(4);

      // Caption A: (1000 + 500) / 1000 = 1.5s start, (1000 + 2000) / 1000 = 3.0s end
      expect(tl.call.mock.calls[0][2]).toBe(1.5);
      expect(tl.call.mock.calls[1][2]).toBe(3.0);

      // Caption B: (1000 + 3000) / 1000 = 4.0s start, (1000 + 4500) / 1000 = 5.5s end
      expect(tl.call.mock.calls[2][2]).toBe(4.0);
      expect(tl.call.mock.calls[3][2]).toBe(5.5);

      expect(captionEntries).toHaveLength(2);
      expect(captionEntries[0].text).toBe('Caption A');
      expect(captionEntries[0].startSec).toBe(1.5);
      expect(captionEntries[0].endSec).toBe(3.0);
      expect(captionEntries[1].text).toBe('Caption B');
    });

    it('caption show callback respects isCaptionEnabled gating', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 5000 }];
      const captions = [{ text: 'Gated', start: 0, end: 2000 }];
      const captionContainer = document.createElement('div');
      const isEnabled = vi.fn().mockReturnValue(false);

      const { timeline: tl } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
        isCaptionEnabled: isEnabled,
      });

      // Execute the show callback (first tl.call)
      const showCallback = tl.call.mock.calls[0][0];
      showCallback();

      // Should not create a DOM element because isCaptionEnabled returns false
      expect(captionContainer.children.length).toBe(0);

      // Now enable
      isEnabled.mockReturnValue(true);
      showCallback();

      expect(captionContainer.children.length).toBe(1);
      expect(captionContainer.children[0].textContent).toBe('Gated');
    });

    it('caption show callback is unconditional when isCaptionEnabled is omitted', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 2000 }];
      const captions = [{ text: 'Ungated', start: 0, end: 1000 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
      });

      const showCallback = tl.call.mock.calls[0][0];
      showCallback();

      expect(captionContainer.children.length).toBe(1);
      expect(captionContainer.children[0].textContent).toBe('Ungated');
    });

    it('caption hide callback removes the element and nullifies entry.el', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 5000 }];
      const captions = [{ text: 'Removable', start: 0, end: 2000 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
        isCaptionEnabled: () => true,
      });

      // Execute show callback
      const showCallback = tl.call.mock.calls[0][0];
      showCallback();
      expect(captionContainer.children.length).toBe(1);
      expect(captionEntries[0].el).not.toBeNull();

      // Execute hide callback
      const hideCallback = tl.call.mock.calls[1][0];
      hideCallback();
      expect(captionContainer.children.length).toBe(0);
      expect(captionEntries[0].el).toBeNull();
    });

    it('caption hide callback is safe when entry.el is already null', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 5000 }];
      const captions = [{ text: 'Already gone', start: 0, end: 2000 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
        isCaptionEnabled: () => true,
      });

      // entry.el starts null, skip show, call hide directly
      expect(captionEntries[0].el).toBeNull();
      const hideCallback = tl.call.mock.calls[1][0];
      expect(() => hideCallback()).not.toThrow();
    });

    it('removes previous caption element when show callback fires twice', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 5000 }];
      const captions = [{ text: 'Duplicate-safe', start: 0, end: 2000 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
        isCaptionEnabled: () => true,
      });

      const showCallback = tl.call.mock.calls[0][0];
      showCallback();
      const firstEl = captionEntries[0].el;
      expect(captionContainer.children.length).toBe(1);

      showCallback();
      expect(captionContainer.children.length).toBe(1);
      expect(captionEntries[0].el).not.toBe(firstEl);
      expect(firstEl.isConnected).toBe(false);
    });

    it('uses captionDelay default of 0 when not provided', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 1000 }];
      const captions = [{ text: 'Delayless', start: 500, end: 900 }];
      const captionContainer = document.createElement('div');

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions,
        captionContainer,
      });

      expect(tl.call.mock.calls[0][2]).toBe(0.5);
      expect(tl.call.mock.calls[1][2]).toBe(0.9);
      expect(captionEntries[0].startSec).toBe(0.5);
      expect(captionEntries[0].endSec).toBe(0.9);
    });

    it('does not place caption callbacks when captionContainer is missing', () => {
      const lines = [{ text: 'Line', enter: 0, exit: 1000 }];
      const captions = [{ text: 'Orphan', start: 0, end: 1000 }];

      const { timeline: tl, captionEntries } = buildNarrationTimeline(lines, container, {
        captions,
      });

      expect(tl.call).not.toHaveBeenCalled();
      expect(captionEntries).toEqual([]);
    });
  });

  describe('clearNarrationLayer', () => {
    it('removes all children from container', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      clearNarrationLayer(container);

      expect(container.children.length).toBe(0);
    });

    it('kills GSAP tweens on children collection', () => {
      container.appendChild(document.createElement('p'));
      container.appendChild(document.createElement('p'));

      clearNarrationLayer(container);

      expect(gsap.killTweensOf).toHaveBeenCalledWith(container.children);
    });

    it('handles empty container', () => {
      clearNarrationLayer(container);

      expect(container.children.length).toBe(0);
    });
  });
});
