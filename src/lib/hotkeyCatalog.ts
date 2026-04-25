// ── Hotkey catalog (Phase 2F) ────────────────────────────────────────────────
// Single source of truth for hotkey labels and combinations across the app.
// Pages and components that surface keyboard hints should import HOTKEY_ROWS
// rather than hard-coding key labels, so renames stay in one place.

export type HotkeyEntry = {
  keys: string[];
  label: string;
  event: string;
};

export const HOTKEY_ROWS: {
  dashboard: HotkeyEntry[];
  overlay: HotkeyEntry[];
  companion: HotkeyEntry[];
} = {
  dashboard: [
    { keys: ['Ctrl', 'Shift', 'H'], label: 'Toggle overlay', event: 'share_guard_toggle_shortcut' },
    { keys: ['Ctrl', 'Shift', 'S'], label: 'Screenshot + solve', event: 'hotkey_screenshot_solve' },
    { keys: ['Ctrl', 'Shift', 'C'], label: 'Copy answer', event: 'hotkey_copy_answer' },
    {
      keys: ['Ctrl', 'Shift', 'T'],
      label: 'Click-through toggle',
      event: 'hotkey_toggle_click_through',
    },
    { keys: ['Ctrl', 'Shift', 'Up'], label: 'Scroll up', event: 'hotkey_scroll_up' },
    { keys: ['Ctrl', 'Shift', 'Down'], label: 'Scroll down', event: 'hotkey_scroll_down' },
    { keys: ['Ctrl', 'Shift', 'Enter'], label: 'Generate', event: 'hotkey_generate_answer' },
    { keys: ['Ctrl', 'Shift', 'N'], label: 'Next suggestion', event: 'hotkey_next_suggestion' },
    { keys: ['Ctrl', 'Shift', 'G'], label: 'Switch to Groq', event: 'hotkey_provider_groq' },
    { keys: ['Ctrl', 'Shift', 'O'], label: 'Switch to OpenAI', event: 'hotkey_provider_openai' },
    {
      keys: ['Ctrl', 'Shift', 'A'],
      label: 'Switch to Anthropic',
      event: 'hotkey_provider_anthropic',
    },
    { keys: ['Esc'], label: 'Dismiss overlay', event: 'hotkey_dismiss' },
  ],
  overlay: [
    { keys: ['Ctrl', 'Shift', 'Enter'], label: 'Generate', event: 'hotkey_generate_answer' },
    { keys: ['Ctrl', 'Shift', 'N'], label: 'Next', event: 'hotkey_next_suggestion' },
    { keys: ['Ctrl', 'Shift', 'C'], label: 'Copy', event: 'hotkey_copy_answer' },
    { keys: ['Esc'], label: 'Dismiss', event: 'hotkey_dismiss' },
  ],
  companion: [
    { keys: ['Ctrl', 'Shift', 'H'], label: 'Toggle', event: 'share_guard_toggle_shortcut' },
    { keys: ['Ctrl', 'Shift', 'S'], label: 'Screenshot', event: 'hotkey_screenshot_solve' },
  ],
};
