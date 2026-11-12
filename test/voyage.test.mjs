import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advance, arrive, candidateRoutes, depart, freshState } from '../index.js'
import {
  SEAS,
  chooseSea,
  fallbackPostcard,
  isPeak,
  nextOffPeak,
  parseArxiv,
  parsePostcardReply,
  sail,
  shortlist,
  wishKeywords,
} from '../voyage.js'

const BJ = (y, m, d, hh, mm = 0) => Date.UTC(y, m - 1, d, hh - 8, mm)
const fixed = (v) => () => v

test('峰谷：工作日 9–12、14–18 点是高峰，午休、晚上、周末是谷时', () => {
  assert.equal(isPeak(BJ(2026, 11, 12, 10)), true) // 周四上午
  assert.equal(isPeak(BJ(2026, 11, 12, 12, 30)), false) // 午休
  assert.equal(isPeak(BJ(2026, 11, 12, 17, 59)), true)
  assert.equal(isPeak(BJ(2026, 11, 12, 18)), false)
  assert.equal(isPeak(BJ(2026, 11, 14, 10)), false) // 周六
})

test('下一个谷时：高峰里往后推到整点谷时，谷时原样返回', () => {
  assert.equal(nextOffPeak(BJ(2026, 11, 12, 10, 20)), BJ(2026, 11, 12, 12))
  assert.equal(nextOffPeak(BJ(2026, 11, 12, 15)), BJ(2026, 11, 12, 18))
  const t = BJ(2026, 11, 12, 20)
  assert.equal(nextOffPeak(t), t)
})

test('纸条切关键词', () => {
  assert.deepEqual(wishKeywords('Rust 游戏引擎，agent'), ['Rust', '游戏引擎', 'agent'])
  assert.deepEqual(wishKeywords(''), [])
  assert.deepEqual(wishKeywords('a b'), [])
})

test('挑海域：跟着纸条时只去能用关键词的海；没去过的海更容易被挑中', () => {
  const r = chooseSea({ wish: 'rust', rng: fixed(0.1) })
  assert.equal(r.followWish, true)
  assert.equal(r.sea.keywordFriendly, true)
  const visitedAllButChat = Object.fromEntries(SEAS.filter((s) => s.id !== 'chat').map((s) => [s.id, 3]))
  let chat = 0
  let x = 0
  const rng = () => ((x = (x * 9301 + 49297) % 233280), x / 233280)
  for (let i = 0; i < 600; i += 1) if (chooseSea({ visited: visitedAllButChat, rng }).sea.id === 'chat') chat += 1
  assert.ok(chat / 600 > 0.25, `没去过的闲聊礁应约占 1/3，实际 ${chat / 600}`)
})

test('优先列出含关键词的条目', () => {
  const items = [
    { title: 'a', note: '' },
    { title: 'Rust engine', note: '' },
    { title: 'c', note: 'rust' },
  ]
  assert.deepEqual(shortlist(items, ['rust']).map((i) => i.title), ['Rust engine', 'c', 'a'])
})

test('读模型回的明信片：抠 JSON、丢掉越界和重复编号、最多 3 件', () => {
  const reply = '好的\n{"place":"星标灯塔下","message":"今天风很大","picks":[{"index":1,"why":"好玩"},{"index":1,"why":"重复"},{"index":9,"why":"越界"},{"index":0,"why":"x"},{"index":2,"why":"y"},{"index":3,"why":"z"}]}'
  const card = parsePostcardReply(reply, 4)
  assert.equal(card.place, '星标灯塔下')
  assert.deepEqual(card.picks.map((p) => p.index), [1, 0, 2])
  assert.equal(parsePostcardReply('不是 JSON', 4), null)
  assert.equal(parsePostcardReply('{"message":"x","picks":[{"index":7}]}', 4), null)
})

test('arXiv Atom 解析', () => {
  const xml = '<feed><entry><id>http://arxiv.org/abs/2611.00001v1</id><published>2026-11-10T00:00:00Z</published><title>A  Whale\n of a Model</title><summary> We study &amp; whales. </summary></entry></feed>'
  assert.deepEqual(parseArxiv(xml), [{ title: 'A Whale of a Model', url: 'https://arxiv.org/abs/2611.00001v1', note: 'We study & whales.', meta: '2026-11-10' }])
})

test('出海：第一片海取不到就绕去下一片；全取不到就起雾', async () => {
  const bili = { code: 0, data: { list: [{ title: '视频', bvid: 'BV1', desc: '简介', owner: { name: 'up' }, stat: { view: 50000 }, tname: '知识' }] } }
  const fetchImpl = async (url) => {
    if (String(url).includes('bilibili')) return new Response(JSON.stringify(bili))
    return new Response('nope', { status: 503 })
  }
  const code = SEAS.find((s) => s.id === 'code')
  const warn = console.warn
  console.warn = () => {}
  try {
    const got = await sail({ sea: code, fetchImpl, rng: fixed(0.5), fallbacks: 4 })
    assert.equal(got.sea.id, 'danmaku')
    assert.equal(got.items[0].url, 'https://www.bilibili.com/video/BV1')
    const none = await sail({ sea: code, fetchImpl: async () => new Response('x', { status: 500 }), rng: fixed(0.5) })
    assert.equal(none.items.length, 0)
  } finally {
    console.warn = warn
  }
})

test('模板明信片取前两件', () => {
  const card = fallbackPostcard({ sea: SEAS[0], items: [{}, {}, {}], rng: fixed(0) })
  assert.deepEqual(card.picks.map((p) => p.index), [0, 1])
  assert.ok(card.message.length > 10)
})

test('时间推进：到点出门、到点结算、谷时靠岸在高峰里等着', () => {
  const t0 = BJ(2026, 11, 12, 20)
  let s = freshState(t0, fixed(0))
  assert.equal(s.whale.status, 'home')
  let step = advance(s, s.whale.departAt + 1, fixed(0))
  assert.equal(step.state.whale.status, 'away')
  s = step.state
  assert.equal(advance(s, s.whale.trip.returnAt - 1).settle, false)
  assert.equal(advance(s, s.whale.trip.returnAt).settle, true)

  const peakNow = BJ(2026, 11, 13, 10) // 周五上午，高峰
  const waiting = { ...s, settings: { ...s.settings, offPeakOnly: true } }
  step = advance(waiting, peakNow)
  assert.equal(step.settle, false)
  assert.equal(step.state.whale.trip.waitingTide, true)
  assert.equal(advance(step.state, BJ(2026, 11, 13, 12, 1)).settle, true)

  const back = arrive(s, { id: 'p1', sea: 'code', read: false }, s.whale.trip.returnAt, fixed(0))
  assert.equal(back.whale.status, 'home')
  assert.equal(back.visited.code, 1)
  assert.equal(back.postcards[0].id, 'p1')
  assert.ok(back.whale.departAt > s.whale.trip.returnAt)
})

test('模型路线：默认路线在前，再补 DeepSeek 账号路线，不重复', () => {
  assert.deepEqual(candidateRoutes({ provider: 'deepseek-official', model: 'deepseek-flash' }), [
    { provider: 'deepseek-official', model: 'deepseek-flash' },
    { provider: 'deepseek-account', model: 'deepseek-flash' },
  ])
  assert.deepEqual(candidateRoutes({ provider: 'deepseek-account', model: 'deepseek-pro' }), [
    { provider: 'deepseek-account', model: 'deepseek-pro' },
    { provider: 'deepseek-account', model: 'deepseek-flash' },
  ])
  assert.deepEqual(candidateRoutes(null), [{ provider: 'deepseek-account', model: 'deepseek-flash' }])
})

test('关掉自己出门就不会出门；手动送走照样能走', () => {
  const t0 = Date.now()
  const s = { ...freshState(t0), settings: { autoDepart: false, fastMode: false, offPeakOnly: false } }
  assert.equal(advance(s, t0 + 10 * 3_600_000).state.whale.status, 'home')
  assert.equal(depart(s, t0).whale.status, 'away')
})
