import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DEICTIC, DEICTIC_WORDS, deicticRegex, type DeicticLang } from '../src/shared/align.ts'

const hit = (re: RegExp, s: string): boolean => {
  re.lastIndex = 0
  return re.test(s)
}

test('every language has pointing words and the default regex knows all of them', () => {
  for (const [lang, words] of Object.entries(DEICTIC_WORDS)) {
    assert.ok(words.length >= 2, lang)
    for (const w of words) assert.ok(hit(DEFAULT_DEICTIC, w), `${lang}: ${w}`)
  }
})

test('pointing words are found inside real sentences of each language', () => {
  const cases: [DeicticLang, string][] = [
    ['ko', '이거 좀 키워줘'],
    ['ko', '여기에 버튼 하나 추가'],
    ['en', 'Make this bigger'],
    ['en', 'Put it over THERE.'],
    ['ja', 'ここを大きくしてください'],
    ['ja', 'これは消して'],
    ['zh', '把这个按钮放大'],
    ['zh', '這裡改成藍色'],
    ['es', 'Pon esto más grande'],
    ['es', 'aquí falta un botón'],
    ['pt', 'Deixa isso maior'],
    ['pt', 'coloca aqui'],
    ['de', 'Mach das größer'],
    ['de', 'hier fehlt was'],
    ['fr', 'Agrandis ça'],
    ['fr', 'mets-le là'],
    ['fr', 'ici, en bleu']
  ]
  for (const [lang, s] of cases) {
    assert.ok(hit(DEFAULT_DEICTIC, s), `default: ${s}`)
    assert.ok(hit(deicticRegex([lang]), s), `${lang}: ${s}`)
  }
})

test('spaced languages match whole words only, accents included', () => {
  for (const s of ['thistle', 'where', 'Thatcher', 'nowhere else', 'dass es geht', 'Datei', 'aquíes', 'cellar', 'issoe', 'esbozo']) {
    assert.equal(hit(DEFAULT_DEICTIC, s), false, s)
  }
  assert.equal(hit(deicticRegex(['pt']), 'ali-baba'), true)
  assert.equal(hit(deicticRegex(['es']), 'aquí,'), true)
  assert.equal(hit(deicticRegex(['fr']), 'voilà'), false)
  assert.equal(hit(deicticRegex(['fr']), 'là-bas'), true)
})

test('a single language regex ignores other languages', () => {
  assert.equal(hit(deicticRegex(['ko']), 'make this bigger'), false)
  assert.equal(hit(deicticRegex(['en']), '이거 키워줘'), false)
  assert.equal(hit(deicticRegex(['ja']), '把这个按钮放大'), false)
})
