import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  BackseatApi,
  CopyResult,
  EditorInit,
  ExportPayload,
  SaveResult,
  SelectionResult,
  SelectorInit,
  SendOptions,
  SendResult,
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
    close() {
      ipcRenderer.send(IPC.editorClose)
    }
  }
}

contextBridge.exposeInMainWorld('backseat', api)
