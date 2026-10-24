// What 전송 does around the delivery itself: settle the recording, stop and ask when its transcription
// failed, and decide what the editor does afterwards. Pure (no DOM): tests/sendflow.test.ts.
import type { SendResult } from '../../shared/types'

/** none: no recording; ok: the recording has a transcript; failed: there is audio but no transcript. */
export type SttOutcome = 'none' | 'ok' | 'failed'
/** The user's answer when the transcription failed: try again, send without the speech text, or stop. */
export type TranscriptChoice = 'retry' | 'image' | 'cancel'

export interface SendSteps {
  /** End a running recording and wait for its transcription. */
  settle(): Promise<SttOutcome>
  chooseOnSttFailure(): Promise<TranscriptChoice>
  retryTranscription(): Promise<SttOutcome>
  deliver(): Promise<SendResult>
}

export interface SendOutcome {
  /** null when nothing was delivered (the user cancelled). */
  result: SendResult | null
  canceled: boolean
  /** Close the editor once the status has been readable for a moment. */
  close: boolean
  /** Keep the buttons disabled: only while the editor is about to close (no double send). */
  stayBusy: boolean
}

export async function runSend(steps: SendSteps, pinned: () => boolean): Promise<SendOutcome> {
  // A recording whose speech never became text must not be sent silently as if it had (Codex review F12).
  let stt = await steps.settle()
  while (stt === 'failed') {
    const choice = await steps.chooseOnSttFailure()
    if (choice === 'cancel') return { result: null, canceled: true, close: false, stayBusy: false }
    if (choice === 'image') break
    stt = await steps.retryTranscription()
  }
  const result = await steps.deliver()
  // A pinned reference window stays open and usable after a paste (Codex review F05).
  const close = result.ok && result.delivered === 'pasted' && !pinned()
  return { result, canceled: false, close, stayBusy: close }
}
