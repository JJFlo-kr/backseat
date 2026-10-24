import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AboutInfo,
  BackseatApi,
  CopyResult,
  EditorInit,
  ExportPayload,
  SaveResult,
  SelectionResult,
  SelectorInit,
  SendOptions,
  SendResult,
  SttProgress,
  TranscribeRequest,
  TranscribeResult,
  VideoSave
} from '../shared/types'

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
    close() {
      ipcRenderer.send(IPC.editorClose)
    }
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
