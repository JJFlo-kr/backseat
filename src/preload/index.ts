import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AboutInfo,
  BackseatApi,
  CopyResult,
  DeliveryStatus,
  EditorInit,
  ExportPayload,
  SaveResult,
  SelectionResult,
  SelectorInit,
  SendOptions,
  SendResult,
  SendTargetView,
  SttProgress,
  TranscribeRequest,
  TranscribeResult,
  VideoSave
} from '../shared/types'
import type { UiuxJob } from '../shared/uiux/types'

const api: BackseatApi = {
  selector: {
    onInit(cb) {
      ipcRenderer.on(IPC.selectorInit, (_e, init: SelectorInit) => cb(init))
    },
    done(result: SelectionResult) {
      ipcRenderer.send(IPC.selectorDone, result)
    },
    cancel() {
      ipcRenderer.send(IPC.selectorCancel)
    }
  },
  editor: {
    onInit(cb) {
      ipcRenderer.on(IPC.editorInit, (_e, init: EditorInit) => cb(init))
    },
    save(payload: ExportPayload): Promise<SaveResult> {
      return ipcRenderer.invoke(IPC.editorSave, payload)
    },
    copy(payload: ExportPayload): Promise<CopyResult> {
      return ipcRenderer.invoke(IPC.editorCopy, payload)
    },
    saveVideo(video: VideoSave): Promise<SaveResult> {
      return ipcRenderer.invoke(IPC.editorSaveVideo, video)
    },
    send(payload: ExportPayload, opts?: SendOptions): Promise<SendResult> {
      return ipcRenderer.invoke(IPC.editorSend, payload, opts ?? {})
    },
    transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
      return ipcRenderer.invoke(IPC.editorTranscribe, req)
    },
    onSttProgress(cb) {
      ipcRenderer.on(IPC.editorSttProgress, (_e, p: SttProgress) => cb(p))
    },
    pin(): Promise<boolean> {
      return ipcRenderer.invoke(IPC.editorPin)
    },
    targets(): Promise<SendTargetView[]> {
      return ipcRenderer.invoke(IPC.editorTargets)
    },
    onDeliveryUpdate(cb) {
      ipcRenderer.on(IPC.deliveryUpdate, (_e, s: DeliveryStatus) => cb(s))
    },
    newCapture() {
      ipcRenderer.send(IPC.editorNewCapture)
    },
    close() {
      ipcRenderer.send(IPC.editorClose)
    }
  },
  uiux: {
    listProjects: () => ipcRenderer.invoke(IPC.uiuxListProjects),
    createProject: (fields) => ipcRenderer.invoke(IPC.uiuxCreateProject, fields),
    saveProject: (profile) => ipcRenderer.invoke(IPC.uiuxSaveProject, profile),
    projectState: (projectId) => ipcRenderer.invoke(IPC.uiuxProjectState, projectId),
    saveUserOverview: (projectId, input) => ipcRenderer.invoke(IPC.uiuxSaveUserOverview, projectId, input),
    saveRules: (projectId, rules) => ipcRenderer.invoke(IPC.uiuxSaveRules, projectId, rules),
    setPath: (projectId, folder) => ipcRenderer.invoke(IPC.uiuxSetPath, projectId, folder),
    pickFolder: () => ipcRenderer.invoke(IPC.uiuxPickFolder),
    requestJob: (projectId, req) => ipcRenderer.invoke(IPC.uiuxRequestJob, projectId, req),
    deliverJob: (jobId, how) => ipcRenderer.invoke(IPC.uiuxDeliverJob, jobId, how),
    cancelJob: (jobId) => ipcRenderer.invoke(IPC.uiuxCancelJob, jobId),
    extendJob: (jobId, minutes) => ipcRenderer.invoke(IPC.uiuxExtendJob, jobId, minutes),
    listJobs: (projectId) => ipcRenderer.invoke(IPC.uiuxListJobs, projectId),
    jobOutcome: (jobId) => ipcRenderer.invoke(IPC.uiuxJobOutcome, jobId),
    onJobUpdate(cb) {
      ipcRenderer.on(IPC.uiuxJobUpdate, (_e, job: UiuxJob) => cb(job))
    },
    proposalPreview: (jobId, proposalId) => ipcRenderer.invoke(IPC.uiuxProposalPreview, jobId, proposalId),
    importOverview: (projectId) => ipcRenderer.invoke(IPC.uiuxImportOverview, projectId),
    exportOverview: (projectId, format, pngDataUrl) => ipcRenderer.invoke(IPC.uiuxExportOverview, projectId, format, pngDataUrl),
    saveOverviewEdits: (projectId, edits) => ipcRenderer.invoke(IPC.uiuxSaveOverviewEdits, projectId, edits),
    skills: (projectId) => ipcRenderer.invoke(IPC.uiuxSkills, projectId),
    proposals: (projectId) => ipcRenderer.invoke(IPC.uiuxProposals, projectId),
    exportProfile: (projectId) => ipcRenderer.invoke(IPC.uiuxExportProfile, projectId),
    importProfile: () => ipcRenderer.invoke(IPC.uiuxImportProfile)
  },
  about: {
    getInfo(): Promise<AboutInfo> {
      return ipcRenderer.invoke(IPC.aboutInfo)
    },
    open(url: string): Promise<void> {
      return ipcRenderer.invoke(IPC.aboutOpen, url)
    },
    openDoc(doc: 'license' | 'notices'): Promise<void> {
      return ipcRenderer.invoke(IPC.aboutOpenDoc, doc)
    }
  }
}

contextBridge.exposeInMainWorld('backseat', api)
