import { describe, it, expect, vi, beforeEach } from 'vitest';

let lastHowlOptions = null;

const mockHowlInstance = {
  play: vi.fn(),
  stop: vi.fn(),
  fade: vi.fn(),
  mute: vi.fn(),
  unload: vi.fn(),
  volume: vi.fn().mockReturnValue(0.15),
};

vi.mock('howler', () => ({
  Howl: vi.fn((opts) => {
    lastHowlOptions = opts;
    return { ...mockHowlInstance };
  }),
}));

import { playAmbient, crossfadeAmbient, playNarration, stopAll, setMuted } from '../../src/audio.js';
import { Howl } from 'howler';

describe('audio.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopAll();
  });

  describe('playAmbient', () => {
    it('creates a Howl with correct options and error handlers', () => {
      playAmbient('test.mp3', 0.15, true);

      expect(Howl).toHaveBeenCalledWith(
        expect.objectContaining({
          src: ['test.mp3'],
          volume: 0.15,
          loop: true,
          html5: true,
          mute: false,
          onloaderror: expect.any(Function),
          onplayerror: expect.any(Function),
        }),
      );
    });

    it('plays the ambient sound', () => {
      const howl = playAmbient('test.mp3', 0.15, true);

      expect(howl.play).toHaveBeenCalled();
    });

    it('unloads previous ambient before playing new one', () => {
      const first = playAmbient('first.mp3', 0.1, true);
      playAmbient('second.mp3', 0.2, true);

      expect(first.unload).toHaveBeenCalled();
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

    it('unloads previous narration before playing new one', () => {
      const first = playNarration('first.mp3');
      playNarration('second.mp3');

      expect(first.unload).toHaveBeenCalled();
    });
  });

  describe('error handlers', () => {
    it('logs warning on ambient load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playAmbient('bad.mp3', 0.1, true);
      lastHowlOptions.onloaderror(1, 'network error');
      expect(warnSpy).toHaveBeenCalledWith('Failed to load ambient: bad.mp3', 'network error');
      warnSpy.mockRestore();
    });

    it('logs warning on ambient play error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playAmbient('bad.mp3', 0.1, true);
      lastHowlOptions.onplayerror(1, 'decode error');
      expect(warnSpy).toHaveBeenCalledWith('Failed to play ambient: bad.mp3', 'decode error');
      warnSpy.mockRestore();
    });

    it('logs warning on narration load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      playNarration('bad.mp3');
      lastHowlOptions.onloaderror(1, 'not found');
      expect(warnSpy).toHaveBeenCalledWith('Failed to load narration: bad.mp3', 'not found');
      warnSpy.mockRestore();
    });

    it('logs warning on crossfade load error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      crossfadeAmbient('bad.mp3', 0.2, 800);
      lastHowlOptions.onloaderror(1, 'timeout');
      expect(warnSpy).toHaveBeenCalledWith('Failed to load ambient: bad.mp3', 'timeout');
      warnSpy.mockRestore();
    });
  });

  describe('stopAll', () => {
    it('unloads both ambient and narration', () => {
      const ambient = playAmbient('ambient.mp3', 0.1, true);
      const narration = playNarration('narration.mp3');

      stopAll();

      expect(ambient.unload).toHaveBeenCalled();
      expect(narration.unload).toHaveBeenCalled();
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
