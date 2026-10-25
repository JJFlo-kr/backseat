// How a shortcut is written for the user. Pure (no Electron, no DOM): main passes process.platform, renderers get
// it from EditorInit.platform. Electron accelerators say 'CommandOrControl'; people read 'Cmd' on macOS and 'Ctrl'
// everywhere else.

/** The primary modifier as shown to the user. */
export function modKeyLabel(platform: string): 'Cmd' | 'Ctrl' {
  return platform === 'darwin' ? 'Cmd' : 'Ctrl'
}

/**
 * 'CommandOrControl+Shift+A' -> 'Cmd+Shift+A' on macOS, 'Ctrl+Shift+A' elsewhere. An explicit 'Control' stays 'Ctrl'
 * and an explicit 'Command' stays 'Cmd': on a Mac those are different keys.
 */
export function acceleratorLabel(accelerator: string, platform: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      if (/^(commandorcontrol|cmdorctrl)$/i.test(part)) return modKeyLabel(platform)
      if (/^(control|ctrl)$/i.test(part)) return 'Ctrl'
      if (/^(command|cmd)$/i.test(part)) return 'Cmd'
      return part
    })
    .join('+')
}
