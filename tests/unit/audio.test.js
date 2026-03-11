import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHowlInstance = {
  play: vi.fn(),
  stop: vi.fn(),
  fade: vi.fn(),
  mute: vi.fn(),
  volume: vi.fn().mockReturnValue(0.15),
};

vi.mock('howler', () => ({
  Howl: vi.fn(() => ({ ...mockHowlInstance })),
}));

import { playAmbient, crossfadeAmbient, playNarration, stopAll, setMuted } from '../../src/audio.js';
import { Howl } from 'howler';

describe('audio.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopAll();
  });

  describe('playAmbient', () => {
    it('creates a Howl with correct options', () => {
      playAmbient('test.mp3', 0.15, true);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['test.mp3'],
          volume: 0.15,
          loop: true,
          html5: true,
        }),
      );
    });

    it('plays the ambient sound', () => {
      const howl = playAmbient('test.mp3', 0.15, true);

      expect(howl.play).toHaveBeenCalled();
    });

    it('stops previous ambient before playing new one', () => {
      const first = playAmbient('first.mp3', 0.1, true);
      playAmbient('second.mp3', 0.2, true);

      expect(first.stop).toHaveBeenCalled();
    });
  });

  describe('crossfadeAmbient', () => {
    it('creates new ambient and fades it in', () => {
      crossfadeAmbient('new.mp3', 0.2, 800);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['new.mp3'],
          volume: 0,
          loop: true,
        }),
      );
    });

    it('fades out old ambient when present', () => {
      const old = playAmbient('old.mp3', 0.15, true);
      vi.clearAllMocks();

      crossfadeAmbient('new.mp3', 0.2, 800);

      expect(old.fade).toHaveBeenCalled();
    });
  });

  describe('playNarration', () => {
    it('creates a Howl for narration', () => {
      playNarration('narration.mp3');

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['narration.mp3'],
          volume: 1,
          html5: true,
        }),
      );
    });

    it('stops previous narration before playing new one', () => {
      const first = playNarration('first.mp3');
      playNarration('second.mp3');

      expect(first.stop).toHaveBeenCalled();
    });
  });

  describe('stopAll', () => {
    it('stops both ambient and narration', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);
      const narration = playNarration('narration.mp3');

      stopAll();

      expect(ambient.stop).toHaveBeenCalled();
      expect(narration.stop).toHaveBeenCalled();
    });

    it('handles no active audio gracefully', () => {
      expect(() => stopAll()).not.toThrow();
    });
  });

  describe('setMuted', () => {
    it('mutes active ambient and narration', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);
      const narration = playNarration('narration.mp3');

      setMuted(true);

      expect(ambient.mute).toHaveBeenCalledWith(true);
      expect(narration.mute).toHaveBeenCalledWith(true);
    });

    it('unmutes active audio', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);

      setMuted(true);
      setMuted(false);

      expect(ambient.mute).toHaveBeenCalledWith(false);
    });

    it('handles no active audio gracefully', () => {
      stopAll();
      expect(() => setMuted(true)).not.toThrow();
    });
  });
});
