// What 전송 does around the delivery itself: settle the recording, and stop and ask when its transcription
// failed. The editor stays open afterwards whatever happened (user decision 2026-10-25: resend, change the
// destination or copy by hand in place). Pure (no DOM): tests/sendflow.test.ts.
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
}

export async function runSend(steps: SendSteps): Promise<SendOutcome> {
  // A recording whose speech never became text must not be sent silently as if it had (Codex review F12).
  let stt = await steps.settle()
  while (stt === 'failed') {
    const choice = await steps.chooseOnSttFailure()
    if (choice === 'cancel') return { result: null, canceled: true }
    if (choice === 'image') break
    stt = await steps.retryTranscription()
  }
  // The editor is never closed or left busy afterwards: a pinned or not window stays usable (Codex review F05).
  return { result: await steps.deliver(), canceled: false }
}
