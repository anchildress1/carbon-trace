/**
 * Declarative key-action map for global keyboard shortcuts.
 *
 * Each entry maps a KeyboardEvent.key value to an action descriptor:
 *   action         – action string passed to the handler
 *   preventDefault – whether to call e.preventDefault()
 *   allowOnButton  – if false, the key is suppressed when focus is on a
 *                    <button> so native button activation takes precedence
 */
const KEY_MAP = {
  ' ': { action: 'togglePause', preventDefault: true, allowOnButton: false },
  Enter: { action: 'advance', preventDefault: true, allowOnButton: false },
  ArrowRight: { action: 'advance', preventDefault: true, allowOnButton: true },
  ArrowLeft: { action: 'retreat', preventDefault: true, allowOnButton: true },
  Escape: { action: 'pause', preventDefault: false, allowOnButton: true },
};

/**
 * Process a keydown event against the key map.
 *
 * @param {KeyboardEvent} e
 * @param {(action: string) => void} actionHandler
 * @returns {boolean} true if the key was handled
 */
export function handleKeydown(e, actionHandler) {
  const binding = KEY_MAP[e.key];
  if (!binding) return false;

  if (!binding.allowOnButton && e.target instanceof Element && e.target.closest('button'))
    return false;

  if (binding.preventDefault) e.preventDefault();
  actionHandler(binding.action);
  return true;
}

/**
 * Register global keyboard handling.
 *
 * @param {(action: string) => void} actionHandler
 * @returns {() => void} cleanup function that removes the listener
 */
export function initKeyboard(actionHandler) {
  const listener = (e) => handleKeydown(e, actionHandler);
  document.addEventListener('keydown', listener);
  return () => document.removeEventListener('keydown', listener);
}
