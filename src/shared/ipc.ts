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
  editorSend: 'editor:send',
  // editor window -> main (invoke) / main -> editor (send)
  editorTranscribe: 'editor:transcribe',
  editorSttProgress: 'editor:stt-progress',
  editorPin: 'editor:pin',
  // editor window -> main (invoke): send targets for the chip menu
  editorTargets: 'editor:targets',
  // main -> editor: later news for a send (fetched by an MCP agent, or not within the wait window)
  deliveryUpdate: 'delivery:update',
  // editor window -> main (send)
  editorClose: 'editor:close',

  // about window -> main (invoke)
  aboutInfo: 'about:info',
  aboutOpen: 'about:open',
  aboutOpenDoc: 'about:open-doc'
} as const
