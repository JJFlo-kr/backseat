// Every export of src/main/native/win32.ts as a harmless stub, for mock.module(): a module that imports a
// name the mock lacks fails to load. Override what a test needs.
import type { WindowInfo } from '../../src/shared/types.ts'

export function fakeWin32(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    win32Available: () => true,
    listTopLevelWindows: (): WindowInfo[] => [],
    processParents: () => new Map<number, number>(),
    isWindow: () => true,
    getForegroundWindow: (): WindowInfo | null => null,
    focusWindow: async () => true,
    sendCtrlV: () => true,
    sendEnter: () => true,
    getCursorPos: () => null,
    setCursorPos: () => true,
    sendWheelDelta: () => 0,
    sendWheel: () => 0,
    postWheel: () => true,
    windowAtPoint: () => 0,
    WHEEL_DELTA: 120,
    processStartMs: () => 0,
    liveWindow: () => null,
    foregroundHwnd: () => 0,
    windowTitle: () => '',
    describeWindow: (): WindowInfo | null => null,
    closeWindow: () => true,
    processNameOf: () => '',
    tapKeys: () => true,
    ...overrides
  }
}
