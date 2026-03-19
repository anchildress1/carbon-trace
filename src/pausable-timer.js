export class PausableTimer {
  #id = null;
  #callback;
  #delay;
  #start = null;
  #remaining = null;

  constructor(callback, delay) {
    this.#callback = callback;
    this.#delay = delay;
    this.#start = performance.now();
    this.#id = setTimeout(() => {
      this.#id = null;
      this.#start = null;
      this.#remaining = null;
      this.#callback();
    }, delay);
  }

  pause() {
    if (this.#id === null) return;
    const elapsed = performance.now() - this.#start;
    this.#remaining = Math.max(0, this.#delay - elapsed);
    clearTimeout(this.#id);
    this.#id = null;
    this.#start = null;
  }

  resume() {
    if (this.#remaining === null || this.#remaining <= 0) return;
    this.#delay = this.#remaining;
    this.#start = performance.now();
    this.#id = setTimeout(() => {
      this.#id = null;
      this.#start = null;
      this.#remaining = null;
      this.#callback();
    }, this.#remaining);
    this.#remaining = null;
  }

  cancel() {
    if (this.#id !== null) clearTimeout(this.#id);
    this.#id = null;
    this.#start = null;
    this.#delay = null;
    this.#remaining = null;
  }

  get isActive() {
    return this.#id !== null;
  }

  get isPaused() {
    return this.#remaining !== null && this.#remaining > 0;
  }
}
