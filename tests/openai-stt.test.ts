import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { languageCode, pcmToWav, transcribeOpenAi, verboseJsonToTranscript } from '../src/main/stt/openai.ts'

const ctx = { audioStartMs: 2000, sampleCount: 16000 * 6, language: 'korean' }

test('verbose_json words become sentence segments on the editor clock', () => {
  const t = verboseJsonToTranscript(
    {
      text: '이 로그인 버튼이 작아. 한 키워줘.',
      language: 'ko',
      duration: 6,
      words: [
        { word: '이', start: 0.2, end: 0.4 },
        { word: '로그인', start: 0.4, end: 0.9 },
        { word: '버튼이', start: 0.9, end: 1.4 },
        { word: '작아.', start: 1.5, end: 2.2 },
        { word: '한', start: 2.9, end: 3.1 },
        { word: '키워줘.', start: 3.2, end: 4.0 }
      ],
      segments: [{ text: '이 로그인 버튼이 작아. 한 키워줘.', start: 0.2, end: 4.0 }]
    },
    ctx,
    'whisper-1@api.example'
  )
  assert.equal(t.segments.length, 2)
  assert.equal(t.segments[0].text, '이 로그인 버튼이 작아.')
  assert.equal(t.segments[0].start, 2200)
  assert.equal(t.segments[0].words?.length, 4)
  assert.equal(t.segments[1].text, '한 키워줘.')
  assert.equal(t.language, 'ko')
  assert.equal(t.model, 'whisper-1@api.example')
  assert.equal(t.durationMs, 6000)
})

test('without words, segment timestamps are used as-is', () => {
  const t = verboseJsonToTranscript(
    { text: 'x', segments: [{ text: ' 여기 크게 해줘', start: 1, end: 2.5 }, { text: ' 저기 작게', start: 3, end: 5 }] },
    ctx,
    'm'
  )
  assert.deepEqual(
    t.segments.map((s) => [s.start, s.end, s.text]),
    [
      [3000, 4500, '여기 크게 해줘'],
      [5000, 7000, '저기 작게']
    ]
  )
})

test('pcmToWav writes a 16-bit mono 16 kHz RIFF header', () => {
  const wav = pcmToWav(new Float32Array([0, 0.5, -0.5, 1]))
  const dv = new DataView(wav.buffer)
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF')
  assert.equal(dv.getUint16(22, true), 1)
  assert.equal(dv.getUint32(24, true), 16000)
  assert.equal(dv.getUint32(40, true), 8)
  assert.equal(dv.getInt16(46, true), Math.round(0.5 * 0x7fff))
  assert.equal(dv.getInt16(50, true), 0x7fff)
})

test('languageCode maps whisper names to ISO codes', () => {
  assert.equal(languageCode('korean'), 'ko')
  assert.equal(languageCode('en'), 'en')
  assert.equal(languageCode(undefined), undefined)
})

test('transcribeOpenAi posts multipart audio with the bearer key and parses the reply (mock server)', async () => {
  let seen: { auth?: string; contentType?: string; body: string } | null = null
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen = { auth: req.headers.authorization, contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString('latin1') }
      assert.equal(req.url, '/v1/audio/transcriptions')
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          text: '로그인 버튼 키워줘.',
          language: 'ko',
          duration: 1,
          words: [
            { word: '로그인', start: 0.1, end: 0.5 },
            { word: '버튼', start: 0.5, end: 0.8 },
            { word: '키워줘.', start: 0.8, end: 1.0 }
          ]
        })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  try {
    const t = await transcribeOpenAi(new Float32Array(16000), {
      apiBase: `http://127.0.0.1:${port}/v1/`,
      apiKey: 'test-key',
      model: 'whisper-1',
      language: 'korean',
      audioStartMs: 500
    })
    assert.ok(seen)
    const s = seen as { auth?: string; contentType?: string; body: string }
    assert.equal(s.auth, 'Bearer test-key')
    assert.match(s.contentType ?? '', /multipart\/form-data/)
    assert.match(s.body, /name="model"\r\n\r\nwhisper-1/)
    assert.match(s.body, /name="response_format"\r\n\r\nverbose_json/)
    assert.match(s.body, /name="language"\r\n\r\nko/)
    assert.match(s.body, /filename="audio.wav"/)
    assert.ok(s.body.includes('RIFF'))
    assert.equal(t.segments.length, 1)
    assert.equal(t.segments[0].start, 600)
    assert.equal(t.text, '로그인 버튼 키워줘.')
  } finally {
    server.close()
  }
})

test('transcribeOpenAi refuses to run without a key and surfaces HTTP errors', async () => {
  await assert.rejects(
    transcribeOpenAi(new Float32Array(10), { apiBase: 'http://127.0.0.1:1', apiKey: '', model: 'm', audioStartMs: 0 }),
    /BACKSEAT_STT_API_KEY/
  )
  const server = createServer((_req, res) => {
    res.statusCode = 401
    res.end('{"error":"bad key"}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  try {
    await assert.rejects(
      transcribeOpenAi(new Float32Array(10), { apiBase: `http://127.0.0.1:${port}`, apiKey: 'k', model: 'm', audioStartMs: 0 }),
      /STT API 401/
    )
  } finally {
    server.close()
  }
})
