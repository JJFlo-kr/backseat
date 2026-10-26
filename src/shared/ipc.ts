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
  editorNewCapture: 'editor:new-capture',

  // editor window -> main (invoke): UI/UX tools (src/main/uiux/service.ts)
  uiuxListProjects: 'uiux:list-projects',
  uiuxCreateProject: 'uiux:create-project',
  uiuxSaveProject: 'uiux:save-project',
  uiuxProjectState: 'uiux:project-state',
  uiuxSaveUserOverview: 'uiux:save-user-overview',
  uiuxSaveRules: 'uiux:save-rules',
  uiuxSetPath: 'uiux:set-path',
  uiuxPickFolder: 'uiux:pick-folder',
  // agent jobs and overview files (src/main/uiux/jobs-app.ts); uiuxJobUpdate is main -> editor
  uiuxRequestJob: 'uiux:request-job',
  uiuxDeliverJob: 'uiux:deliver-job',
  uiuxCancelJob: 'uiux:cancel-job',
  uiuxExtendJob: 'uiux:extend-job',
  uiuxListJobs: 'uiux:list-jobs',
  uiuxJobOutcome: 'uiux:job-outcome',
  uiuxConfirmReport: 'uiux:confirm-report',
  uiuxJobUpdate: 'uiux:job-update',
  uiuxProposalPreview: 'uiux:proposal-preview',
  uiuxImportOverview: 'uiux:import-overview',
  uiuxExportOverview: 'uiux:export-overview',
  uiuxSaveOverviewEdits: 'uiux:save-overview-edits',
  uiuxSkills: 'uiux:skills',
  uiuxProposals: 'uiux:proposals',
  uiuxExportProfile: 'uiux:export-profile',
  uiuxImportProfile: 'uiux:import-profile',

  // about window -> main (invoke)
  aboutInfo: 'about:info',
  aboutOpen: 'about:open',
  aboutOpenDoc: 'about:open-doc'
} as const
