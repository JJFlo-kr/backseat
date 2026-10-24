// Types and constants of the UI Automation layer, without koffi: shared by the worker, the main process and
// the pure delivery decisions (src/main/delivery.ts).

export const UIA_PROP = {
  processId: 30002,
  controlType: 30003,
  hasKeyboardFocus: 30008,
  isKeyboardFocusable: 30009,
  isEnabled: 30010,
  className: 30012,
  isPassword: 30019,
  nativeWindowHandle: 30020,
  frameworkId: 30024,
  isOffscreen: 30022,
  isTextPatternAvailable: 30040,
  isValuePatternAvailable: 30043,
  valueIsReadOnly: 30046
} as const

export const UIA_CONTROL = { edit: 50004, document: 50030, text: 50020, pane: 50033, custom: 50025, group: 50026, window: 50032 } as const

/** The focused element as far as delivery cares. No Name / Value on purpose. */
export interface FocusInfo {
  pid: number
  controlType: number
  className: string
  frameworkId: string
  isPassword: boolean
  hasKeyboardFocus: boolean
  isEnabled: boolean
  isKeyboardFocusable: boolean
  valuePattern: boolean
  /** null when the element has no Value pattern. */
  valueReadOnly: boolean | null
  textPattern: boolean
  nativeHwnd: number
}

/** pasted = the key was pressed. timeout: past the caller's deadline, so no key was pressed. */
export type PasteCheck = { pasted: true } | { pasted: false; reason: 'foreground' | 'focus' | 'password' | 'none' | 'timeout' }

export interface SoleInput {
  /** Usable text inputs found in the window (enabled, focusable, on screen, not password, not read-only). */
  candidates: number
  /** Password fields in the window: any at all means a sign-in view, and nothing is focused. */
  passwordFields: number
  /** SetFocus was called on the only candidate. */
  focused: boolean
}
