import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errText } from '../src/shared/errors.ts'

test('errText shows only the message of an error thrown in the main process', () => {
  assert.equal(errText(new Error("Error invoking remote method 'uiux:confirm-report': Error: no report to confirm")), 'no report to confirm')
  assert.equal(errText(new Error("Error invoking remote method 'uiux:x': TypeError: bad")), 'bad')
  assert.equal(errText(new Error('plain')), 'plain')
  assert.equal(errText('text'), 'text')
})
