// What the editor's send bar and target chip say (requests 2 and 3, plan 2026-10-25 §7): only steps main
// confirmed are shown as done, every stop reason has a reason and a next step, nothing reads as "the AI got /
// understood / finished it", and the legacy SendResult never claims more than send.ts checked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STEP_ORDER, STOP_REASONS, preflight, summaryParts, voiceMissing, chipView, targetText, viewFromAgent, initialTarget,
  deliveryView, statusOf, mergeUpdate
} from '../src/renderer/editor/delivery.ts'
import { createTranslator, mergeBundles, type Translate } from '../src/shared/i18n.ts'
import { BUNDLES } from '../src/shared/bundles.ts'
import type { AgentTarget, DeliveryStatus, DeliveryStep, SendResult, SendTargetView } from '../src/shared/types.ts'

const ko: Translate = createTranslator('ko', mergeBundles('ko', BUNDLES))
const en: Translate = createTranslator('en', mergeBundles('en', BUNDLES))

const CLAUDE: SendTargetView = {
  source: 'mcp-verified', label: 'Claude Code', project: 'backseat', kind: 'claude-code', estimated: false, method: 'mcp',
  identity: { hwnd: 11, pid: 22, processStartMs: 33, title: 'backseat — claude', process: 'WindowsTerminal.exe' }
}
const CODEX: SendTargetView = { source: 'recent-agent', label: 'Codex · ChatGPT 앱', kind: 'codex', estimated: true, method: 'paste-image', identity: { hwnd: 44, pid: 55, processStartMs: 66, title: 'ChatGPT', process: 'ChatGPT.exe' } }

const status = (reached: DeliveryStep[], extra: Partial<DeliveryStatus> = {}): DeliveryStatus => ({ sendId: '20261025-120000-ab12', reached, ...extra })

/** Text that would read as more than the app can know: delivered / understood / done. */
const OVERCLAIM_KO = /완료|이해|전달됨|전달했|처리했|끝났|받았/
const OVERCLAIM_EN = /\b(delivered|understood|done|completed?|finished|received|read it)\b/i

test('every step and stop reason has its own words in ko and en (no raw keys)', () => {
  for (const tr of [ko, en]) {
    const labels = STEP_ORDER.map((s) => tr(`editor.step.${s}`))
    assert.equal(new Set(labels).size, STEP_ORDER.length)
    for (const l of labels) assert.ok(!l.startsWith('editor.'), l)
    for (const reason of STOP_REASONS) {
      const v = deliveryView(status(['saved', 'clipboard'], { stoppedAt: { step: 'inputVerified', reason } }), {}, tr)
      assert.ok(v.headline && !v.headline.startsWith('editor.'), `${reason}: ${v.headline}`)
      assert.ok(v.detail && !v.detail.startsWith('editor.'), `${reason} needs a next step: ${v.detail}`)
    }
  }
})

test('only confirmed steps are done; the step that stopped is marked as stopped', () => {
  const v = deliveryView(status(['saved', 'clipboard', 'targetVerified'], { stoppedAt: { step: 'inputVerified', reason: 'passwordField' } }), {}, ko)
  assert.deepEqual(v.steps.map((s) => [s.step, s.state]), [['saved', 'done'], ['clipboard', 'done'], ['targetVerified', 'done'], ['inputVerified', 'stopped']])
  assert.equal(v.headline, '비밀번호 칸이라 붙여넣지 않았어요')
  assert.equal(v.detail, '클립보드에 준비됨 · 입력란을 클릭한 뒤 Ctrl+V')
  assert.equal(v.primary, 'copy')
  // steps come in the contract's order whatever order main listed them in
  const w = deliveryView(status(['pasted', 'saved', 'clipboard']), {}, ko)
  assert.deepEqual(w.steps.map((s) => s.step), ['saved', 'clipboard', 'pasted'])
})

test('a paste is an attempt: the user is told to submit it; an MCP target waits for the fetch', () => {
  const plain = deliveryView(status(['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted']), {}, ko)
  assert.equal(plain.headline, '붙여넣기를 시도했어요 · 제출은 직접 해주세요')
  assert.equal(plain.tone, 'ok')
  assert.equal(plain.detail, '')
  const mcp = deliveryView(status(['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'], { target: CLAUDE }), {}, ko)
  assert.equal(mcp.tone, 'wait')
  assert.equal(mcp.detail, 'AI가 자료를 가져가면 여기에 표시됩니다')
  assert.equal(en(`editor.delivery.pasted`), 'Paste attempted · please submit it yourself')
})

test('fetched by the expected agent / by another one / not fetched in time', () => {
  const by = { agentId: 'a1', name: 'Claude Code', cwd: 'D:\\backseat', at: '2026-10-25T12:00:00Z', tool: 'backseat_get' }
  const ok = deliveryView(status(['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted', 'fetched'], { fetchedBy: { ...by, expected: true } }), {}, ko)
  assert.equal(ok.headline, 'AI가 자료를 가져갔어요 · Claude Code')
  assert.equal(ok.tone, 'ok')
  assert.equal(ok.steps.at(-1)?.step, 'fetched')
  const other = deliveryView(status(['saved', 'pasted', 'fetched'], { fetchedBy: { ...by, name: 'Cursor', expected: false } }), {}, ko)
  assert.equal(other.headline, '다른 에이전트가 자료를 가져갔어요 · Cursor')
  assert.equal(other.tone, 'warn')
  const late = deliveryView(status(['saved', 'clipboard', 'pasted'], { fetchTimedOut: true, target: CLAUDE }), {}, ko)
  assert.equal(late.headline, '수신 미확인')
  assert.equal(late.primary, 'resend')
})

test('no target: clipboard only by choice is fine, by necessity asks for a destination', () => {
  const chosen = deliveryView(status(['saved', 'clipboard'], { stoppedAt: { step: 'targetVerified', reason: 'noTarget' } }), { clipboardOnly: true }, ko)
  assert.equal(chosen.headline, '클립보드에 준비했어요')
  assert.equal(chosen.tone, 'ok')
  assert.equal(chosen.primary, null)
  assert.deepEqual(chosen.steps.map((s) => s.state), ['done', 'done', 'stopped'])
  const none = deliveryView(status(['saved', 'clipboard'], { stoppedAt: { step: 'targetVerified', reason: 'noTarget' } }), {}, ko)
  assert.equal(none.headline, '보낼 곳이 없어 클립보드에 준비했어요')
  assert.equal(none.primary, 'retarget')
  const expired = deliveryView(status([], { stoppedAt: { step: 'targetVerified', reason: 'targetExpired' } }), {}, ko)
  assert.equal(expired.tone, 'error')
  assert.equal(expired.primary, 'retarget')
  const err = deliveryView(status(['saved'], { stoppedAt: { step: 'clipboard', reason: 'error' } }), { error: 'EBUSY' }, ko)
  assert.equal(err.headline, '보내다 멈췄어요: EBUSY')
  assert.equal(err.detail, '다시 보내기를 눌러 보세요')
  assert.equal(err.primary, 'resend')
})

test('nothing in the send bar or the steps claims delivery, understanding or completion', () => {
  const keys = Object.keys(BUNDLES.ko).filter((k) => /^editor\.(step|delivery|stop|summary|chip|action)\./.test(k))
  assert.ok(keys.length > 40)
  for (const k of keys) {
    assert.doesNotMatch(BUNDLES.ko[k], OVERCLAIM_KO, `ko ${k}: ${BUNDLES.ko[k]}`)
    assert.doesNotMatch(BUNDLES.en[k], OVERCLAIM_EN, `en ${k}: ${BUNDLES.en[k]}`)
  }
})

test('legacy SendResult: claims only what send.ts checked, never the input field', () => {
  const pasted: SendResult = { ok: true, delivered: 'pasted', sessionDir: 'C:\\x\\sessions\\20261025-1', message: '' }
  const s = statusOf(pasted, { clipboardOnly: false, target: CODEX })
  assert.deepEqual(s.reached, ['saved', 'clipboard', 'targetVerified', 'pasted'])
  assert.equal(s.sendId, '20261025-1')
  assert.equal(s.stoppedAt, undefined)
  const clipChosen = statusOf({ ok: true, delivered: 'clipboard', sessionDir: 'd', message: '' }, { clipboardOnly: true, target: null })
  assert.deepEqual(clipChosen.stoppedAt, { step: 'targetVerified', reason: 'noTarget' })
  const focusFailed = statusOf({ ok: true, delivered: 'clipboard', sessionDir: 'd', message: '' }, { clipboardOnly: false, target: CODEX })
  assert.deepEqual(focusFailed.stoppedAt, { step: 'targetVerified', reason: 'targetChanged' })
  const expired = statusOf({ ok: false, delivered: 'file-only', targetExpired: true, message: '' }, { clipboardOnly: false, target: CODEX })
  assert.deepEqual(expired.reached, [])
  assert.deepEqual(expired.stoppedAt, { step: 'targetVerified', reason: 'targetExpired' })
  const failed = statusOf({ ok: false, delivered: 'file-only', sessionDir: 'd', message: 'x', error: 'x' }, { clipboardOnly: false, target: CODEX })
  assert.deepEqual(failed.reached, ['saved'])
  assert.deepEqual(failed.stoppedAt, { step: 'clipboard', reason: 'error' })
  const real = status(['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'])
  assert.equal(statusOf({ ok: true, delivered: 'pasted', message: '', status: real }, { clipboardOnly: false, target: null }), real)
})

test('delivery:update merges into the same send only', () => {
  const cur = status(['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'], { target: CLAUDE })
  const upd = status(['fetched'], { fetchedBy: { agentId: 'a', name: 'Claude Code', cwd: 'D:\\backseat', at: 'now', tool: 'backseat_get', expected: true } })
  const m = mergeUpdate(cur, upd)
  assert.ok(m)
  assert.deepEqual(m.reached, ['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted', 'fetched'])
  assert.equal(m.target, CLAUDE)
  assert.equal(mergeUpdate(cur, { ...upd, sendId: 'another' }), null)
  assert.equal(mergeUpdate(null, upd), null)
})

test('summary: 이미지 1장 · 주석 3개 · 메모 · 음성 설명 준비됨; a failed recording is a warning, not a part', () => {
  assert.equal(summaryParts(preflight(true, 3, ' 버튼 키워 ', 'ready'), ko).join(' · '), '이미지 1장 · 주석 3개 · 메모 · 음성 설명 준비됨')
  assert.equal(summaryParts(preflight(true, 1, '', 'none'), en).join(' · '), '1 image · 1 annotation')
  assert.equal(summaryParts(preflight(true, 0, '   ', 'none'), ko).join(' · '), '이미지 1장')
  assert.equal(summaryParts(preflight(true, 2, '', 'recording'), ko).at(-1), '녹음 중')
  assert.equal(summaryParts(preflight(true, 2, '', 'transcribing'), ko).at(-1), '음성을 글로 바꾸는 중')
  const failed = preflight(true, 2, '', 'failed')
  assert.equal(voiceMissing(failed), true)
  assert.deepEqual(summaryParts(failed, ko), ['이미지 1장', '주석 2개'])
  assert.equal(voiceMissing(preflight(true, 2, '', 'ready')), false)
})

test('target chip: verified / chosen / pinned / guess / none / clipboard / closed window', () => {
  assert.deepEqual(chipView(CLAUDE, ko), { label: 'Claude Code · backseat', state: '연결 확인됨', tone: 'ok' })
  assert.deepEqual(chipView(CODEX, ko), { label: 'Codex · ChatGPT 앱', state: '추정 · 최근 사용', tone: 'guess' })
  assert.equal(chipView({ ...CODEX, source: 'foreground-agent' }, ko).state, '추정')
  assert.equal(chipView({ ...CODEX, source: 'picked', estimated: false }, ko).state, '선택함')
  assert.equal(chipView({ ...CODEX, source: 'pinned', estimated: false }, ko).state, '고정')
  assert.deepEqual(chipView(null, ko), { label: '보낼 곳을 선택하세요', state: '', tone: 'none' })
  assert.equal(chipView({ source: 'none', label: '', estimated: true, method: 'clipboard' }, ko).tone, 'none')
  assert.equal(chipView({ source: 'picked', label: 'x', estimated: false, method: 'clipboard' }, ko).label, '클립보드에만 복사')
  assert.equal(chipView(CODEX, ko, { expired: true }).tone, 'warn')
  assert.equal(targetText({ ...CLAUDE, label: 'Claude Code · backseat' }), 'Claude Code · backseat', 'the project is not repeated')
})

test('the chip at open time: main\'s SendTargetView first, else the legacy detection', () => {
  const a: AgentTarget = { kind: 'claude-code', label: 'Claude Code · Windows Terminal', hwnd: 5, title: 't', process: 'WindowsTerminal.exe', method: 'paste-path', confidence: 0.9 }
  assert.equal(initialTarget({ sendTarget: CODEX, target: a }), CODEX)
  assert.equal(initialTarget({ target: a })?.source, 'foreground-agent')
  assert.equal(initialTarget({ target: a })?.estimated, true)
  assert.equal(initialTarget({ target: a, targetPinned: true })?.source, 'pinned')
  const mcp = initialTarget({ target: { ...a, mcp: { id: 'm', name: 'Claude Code', cwd: 'D:\\work\\backseat' } } })
  assert.equal(mcp?.source, 'mcp-verified')
  assert.equal(mcp?.project, 'backseat')
  assert.equal(initialTarget({ target: null }), null)
  assert.equal(viewFromAgent(a, 'picked').identity?.hwnd, 5)
})

test('phase 2: a changed title offers "이 창에 보내기"; Enter after a verified paste is still an attempt', () => {
  const changed = deliveryView(status(['saved', 'clipboard'], { stoppedAt: { step: 'targetVerified', reason: 'targetChanged' } }), {}, ko)
  assert.equal(changed.headline, '보낼 창의 제목이 바뀌어 붙여넣지 않았어요')
  assert.ok(changed.detail.includes(ko('editor.action.confirmTarget')), 'the detail names the button')
  assert.equal(changed.primary, 'confirm')
  const enter = deliveryView(status(['saved', 'clipboard', 'targetVerified', 'inputVerified', 'pasted'], { enterPressed: true }), {}, ko)
  assert.equal(enter.headline, '붙여넣기와 Enter를 시도했어요')
  assert.equal(enter.steps.length, 5)
})

test('phase 2: the picked or pinned window is not open: the chip names it and asks for a new pick', () => {
  const v: SendTargetView = { source: 'none', label: '', estimated: true, method: 'clipboard', unavailable: { source: 'pinned', label: 'Codex · ChatGPT 앱' } }
  assert.deepEqual(chipView(v, ko), { label: 'Codex · ChatGPT 앱 · 열려 있지 않음', state: '보낼 곳을 다시 고르세요', tone: 'warn' })
  assert.equal(chipView(v, ko, { expired: true }).label, 'Codex · ChatGPT 앱 · 열려 있지 않음', 'the name wins over the generic note')
})
