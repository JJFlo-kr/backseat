// IPC channel names. main <-> renderer only ever use these constants.
export const IPC = {
  // main -> selector window
  selectorInit: 'selector:init',
  // selector window -> main (send)
  selectorDone: 'selector:done',
  selectorCancel: 'selector:cancel',

  // main -> editor window
  editorInit: 'editor:init',
  // editor window -> main (invoke)
  editorSave: 'editor:save',
  editorCopy: 'editor:copy',
  editorSaveVideo: 'editor:save-video',
  // editor window -> main (send)
  editorClose: 'editor:close'
} as const
