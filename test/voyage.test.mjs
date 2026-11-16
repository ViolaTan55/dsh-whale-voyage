import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advance, arrive, candidateRoutes, depart, freshState, hostRejection } from '../index.js'
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

test('挑海域：上一趟刚到过的海这一趟不去；去得越多的海越少被挑中', () => {
  let x = 3
  const rng = () => ((x = (x * 9301 + 49297) % 233280), x / 233280)
  const visited = { code: 2, danmaku: 4 }
  const count = {}
  for (let i = 0; i < 2000; i += 1) {
    const id = chooseSea({ visited, rng, last: 'danmaku' }).sea.id
    count[id] = (count[id] || 0) + 1
  }
  assert.equal(count.danmaku, undefined)
  assert.ok(count.code < count.paper / 2, `去过 2 次的代码群岛应明显少于没去过的，实际 ${JSON.stringify(count)}`)
  assert.equal(chooseSea({ rng, last: 'code', available: SEAS.filter((s) => s.id === 'code') }).sea.id, 'code')

  const s = { ...freshState(Date.now()), postcards: [{ id: 'p', sea: 'danmaku' }], visited }
  for (let i = 0; i < 50; i += 1) assert.notEqual(depart(s, Date.now(), rng).whale.trip.sea, 'danmaku')
})

test('候选：含关键词的排前面', () => {
  const items = [
    { title: 'a', note: '', url: 'u:a' },
    { title: 'Rust engine', note: '', url: 'u:b' },
    { title: 'c', note: 'rust', url: 'u:c' },
  ]
  const got = shortlist(items, ['rust']).map((i) => i.title)
  assert.equal(got[2], 'a')
  assert.deepEqual(new Set(got.slice(0, 2)), new Set(['Rust engine', 'c']))
})

test('候选：带回过的链接拿掉；剩下不到 3 条才用旧的补在最后', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((t) => ({ title: t, note: '', url: `u:${t}` }))
  const got = shortlist(items, [], { seen: new Set(['u:a', 'u:b']) }).map((i) => i.title)
  assert.deepEqual(new Set(got), new Set(['c', 'd', 'e']))
  const few = shortlist(items, [], { seen: new Set(['u:a', 'u:b', 'u:c', 'u:d']) }).map((i) => i.title)
  assert.equal(few[0], 'e')
  assert.equal(few.length, 5)
})

test('候选：同一份榜单，每趟顺序不一样', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ title: `r${i}`, note: '', url: `u:${i}` }))
  const a = shortlist(items).map((i) => i.title).join()
  const b = shortlist(items).map((i) => i.title).join()
  assert.notEqual(a, b)
})

test('连不上的海：24 小时内很少再挑，备选时排在最后，过期后恢复', async () => {
  const now = BJ(2026, 11, 12, 20)
  const unreachable = { paper: now - 3_600_000, hacker: now - 3_600_000, chat: now - 3_600_000 }
  let x = 7
  const rng = () => ((x = (x * 9301 + 49297) % 233280), x / 233280)
  let bad = 0
  for (let i = 0; i < 600; i += 1) if (unreachable[chooseSea({ rng, unreachable, now }).sea.id]) bad += 1
  assert.ok(bad / 600 < 0.25, `连不上的海应很少被挑，实际 ${bad / 600}`)
  const later = now + 25 * 3_600_000
  bad = 0
  for (let i = 0; i < 600; i += 1) if (unreachable[chooseSea({ rng, unreachable, now: later }).sea.id]) bad += 1
  assert.ok(bad / 600 > 0.4, `过了 24 小时应恢复正常，实际 ${bad / 600}`)

  const order = []
  const fetchImpl = async (url) => {
    order.push(String(url))
    return new Response('x', { status: 500 })
  }
  const warn = console.warn
  console.warn = () => {}
  try {
    const got = await sail({ sea: SEAS.find((s) => s.id === 'hacker'), fetchImpl, now, unreachable })
    assert.deepEqual(got.tried.slice(0, 1), ['hacker'])
    assert.deepEqual(new Set(got.tried.slice(1, 3)), new Set(['code', 'danmaku']))
    assert.deepEqual(new Set(got.failed), new Set(SEAS.map((s) => s.id)))
  } finally {
    console.warn = warn
  }
})

test('回港时记下连不上的海，连上了就清掉', () => {
  const t0 = Date.now()
  const s = { ...freshState(t0), unreachable: { code: t0 - 1000 } }
  const back = arrive(s, { id: 'p', sea: 'code', failedSeas: ['paper', 'hacker'], items: [] }, t0)
  assert.deepEqual(Object.keys(back.unreachable).sort(), ['hacker', 'paper'])
})

test('读模型回的明信片：只认一件；越界的跳过；旧格式的 picks 取第一个合格的', () => {
  const card = parsePostcardReply('好的\n{"place":"星标灯塔下","message":"今天风很大","pick":{"index":1,"why":"好玩"}}', 4)
  assert.equal(card.place, '星标灯塔下')
  assert.deepEqual(card.picks, [{ index: 1, why: '好玩' }])
  const old = parsePostcardReply('{"message":"x","picks":[{"index":9,"why":"越界"},{"index":0,"why":"a"},{"index":2,"why":"b"}]}', 4)
  assert.deepEqual(old.picks.map((p) => p.index), [0])
  assert.equal(parsePostcardReply('不是 JSON', 4), null)
  assert.equal(parsePostcardReply('{"message":"x","pick":{"index":7}}', 4), null)
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

test('模板明信片只取一件', () => {
  const card = fallbackPostcard({ sea: SEAS[0], items: [{}, {}, {}], rng: fixed(0) })
  assert.deepEqual(card.picks.map((p) => p.index), [0])
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

test('访问检查：照 DSH 的结论办；宿主没有这道检查就放行；检查出错按拒绝算', () => {
  const req = { headers: {} }
  const host = (connection) => ({ get: (name) => (name === 'connection' ? connection : undefined) })
  assert.equal(hostRejection(host({ requestRejection: () => undefined }), req), undefined)
  assert.equal(hostRejection(host({ requestRejection: () => 401 }), req), 401)
  assert.equal(hostRejection(host({ requestRejection: (r) => (r === req ? 403 : undefined) }), req), 403)
  assert.equal(hostRejection(host(undefined), req), undefined)
  assert.equal(hostRejection(host({}), req), undefined)
  assert.equal(hostRejection({ get: () => { throw new Error('no service') } }, req), undefined)
  assert.equal(hostRejection(host({ requestRejection: () => { throw new Error('boom') } }), req), 403)
  const self = { secret: 403, requestRejection() { return this.secret } }
  assert.equal(hostRejection(host(self), req), 403)
})
