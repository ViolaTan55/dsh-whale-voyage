/**
 * dsh-whale-voyage — 宿主半区。
 *
 * 大肥鱼的一生都在这里：在港歇着 → 自己出海 → 到点回港、带回一张明信片。
 * 状态存在 $DSH_HOME/plugin-data/dsh-whale-voyage/state.json（默认 ~/.dsh）。
 * DSH 没开着的时候时间照走：下次启动时把过期的航程一次结算掉。
 *
 * 接口（浏览器半区用）：
 *   GET  /api/dsh-whale-voyage/state
 *   POST /api/dsh-whale-voyage/action   { type: 'send-off' | 'read' | 'wish' | 'settings', ... }
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  POSTCARD_SYSTEM,
  SEAS,
  chooseSea,
  fallbackPostcard,
  foggyPostcard,
  isPeak,
  nextOffPeak,
  parsePostcardReply,
  postcardPrompt,
  recentlyUnreachable,
  restDuration,
  sail,
  seaById,
  shortlist,
  tripDuration,
  wishKeywords,
} from './voyage.js'

export const name = 'dsh-whale-voyage'
export const inject = ['webServer']

const API = '/api/dsh-whale-voyage'
const TICK_MS = 10_000
const MAX_POSTCARDS = 200
const LLM_TIMEOUT_MS = 90_000

export function dataFile(env = process.env) {
  const home = env.DSH_HOME && env.DSH_HOME.trim() ? env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'plugin-data', 'dsh-whale-voyage', 'state.json')
}

export function freshState(now = Date.now(), rng = Math.random) {
  const settings = { autoDepart: true, fastMode: false, offPeakOnly: false }
  return {
    version: 1,
    createdAt: now,
    whale: { status: 'home', since: now, departAt: now + Math.min(restDuration(settings, rng), 10 * 60_000), trip: null },
    postcards: [],
    visited: {},
    unreachable: {},
    wish: '',
    settings,
  }
}

/** 时间推进一步：该出门的出门，该回港的标记为待结算。纯函数，返回 { state, settle } 。 */
export function advance(state, now = Date.now(), rng = Math.random) {
  const whale = state.whale
  if (whale.status === 'away' && whale.trip) {
    if (now < whale.trip.returnAt) return { state, settle: false }
    // 谷时靠岸：航程到点但正赶上高峰，就在港外等到谷时再写明信片（写明信片要调模型）。
    if (state.settings.offPeakOnly && isPeak(now)) {
      if (whale.trip.waitingTide) return { state, settle: false }
      return { state: { ...state, whale: { ...whale, trip: { ...whale.trip, waitingTide: true } } }, settle: false }
    }
    return { state, settle: true }
  }
  if (whale.status === 'home' && state.settings.autoDepart && whale.departAt && now >= whale.departAt) {
    return { state: depart(state, now, rng), settle: false }
  }
  return { state, settle: false }
}

export function depart(state, now = Date.now(), rng = Math.random) {
  const { sea, followWish } = chooseSea({ visited: state.visited, wish: state.wish, rng, unreachable: state.unreachable || {}, now })
  return {
    ...state,
    whale: {
      status: 'away',
      since: now,
      departAt: null,
      trip: {
        id: randomUUID(),
        sea: sea.id,
        followWish,
        wish: followWish ? state.wish : '',
        departedAt: now,
        returnAt: now + tripDuration(state.settings, rng),
        waitingTide: false,
      },
    },
  }
}

/** 航程结算后的状态：收下明信片、记下这趟连不上和连得上的海、回港、排下一次出门。 */
export function arrive(state, postcard, now = Date.now(), rng = Math.random) {
  const visited = { ...state.visited }
  if (postcard.sea) visited[postcard.sea] = (visited[postcard.sea] || 0) + 1
  const unreachable = { ...(state.unreachable || {}) }
  for (const id of postcard.failedSeas || []) unreachable[id] = now
  if (postcard.sea) delete unreachable[postcard.sea]
  return {
    ...state,
    visited,
    unreachable,
    postcards: [postcard, ...state.postcards].slice(0, MAX_POSTCARDS),
    whale: { status: 'home', since: now, departAt: now + restDuration(state.settings, rng), trip: null },
  }
}

function lowestEffort(info) {
  const efforts = info && info.reasoning && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : []
  const preferred = efforts.find((e) => /^(none|off|minimal|low)$/i.test(String(e.id)))
  return preferred ? preferred.id : undefined
}

/**
 * 写明信片可用的模型路线：先用 DSH 的默认模型；默认路线没配凭据时（比如新建配置默认走 API key、
 * 而用户是账号登录），再试 DeepSeek 账号路线。
 */
export function candidateRoutes(selection) {
  const routes = []
  const add = (provider, model) => {
    if (provider && model && !routes.some((r) => r.provider === provider && r.model === model)) routes.push({ provider, model })
  }
  if (selection) add(selection.provider, selection.model)
  add('deepseek-account', selection && selection.model)
  add('deepseek-account', 'deepseek-flash')
  return routes
}

/** 用 DSH 的模型写明信片；所有路线都不行就返回 null，由调用方兜底。 */
async function writeWithModel(ctx, input) {
  const llm = ctx.get('llm')
  if (!llm || typeof llm.prepareCall !== 'function') return null
  const defaults = ctx.get('agentDefaultModel')
  const selection = defaults && typeof defaults.currentSelection === 'function' ? defaults.currentSelection() : null
  let lastError = null
  for (const route of candidateRoutes(selection)) {
    try {
      return await writeWithRoute(llm, route, input)
    } catch (error) {
      lastError = error
      console.warn(`[dsh-whale-voyage] 模型路线 ${route.provider}/${route.model} 不可用：`, error && error.message ? error.message : error)
    }
  }
  if (lastError) throw lastError
  return null
}

async function writeWithRoute(llm, selection, { sea, wish, items }) {
  const signal = AbortSignal.timeout(LLM_TIMEOUT_MS)
  const call = await llm.prepareCall({ provider: selection.provider, model: selection.model, maxTokens: 1200 }, signal, (controls, info) => {
    const effort = lowestEffort(info)
    return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
  })
  const messages = [
    {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: postcardPrompt({ sea, wish, items }) }],
      source: { kind: 'dsh-whale-voyage' },
    },
  ]
  let text = ''
  for await (const chunk of call.stream({ ...call.config, messages, system: POSTCARD_SYSTEM, purpose: 'dsh-whale-voyage', signal })) {
    if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    if (chunk && chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure ? chunk.reason.failure.message : 'model error')
    }
  }
  const parsed = parsePostcardReply(text, items.length)
  if (!parsed) console.warn('[dsh-whale-voyage] 模型回的明信片读不懂，改用模板：', text.slice(0, 200))
  return parsed ? { ...parsed, model: `${selection.provider}/${selection.model}` } : null
}

/** 真的去一趟海，生成明信片。 */
async function makePostcard(ctx, state, now) {
  const trip = state.whale.trip
  const planned = seaById(trip.sea) || SEAS[0]
  const keywords = wishKeywords(trip.wish)
  const { sea, items, failed } = await sail({ sea: planned, keywords, now, unreachable: state.unreachable || {} })
  const base = {
    id: trip.id,
    sea: sea.id,
    seaName: sea.name,
    plannedSea: planned.id,
    plannedSeaName: planned.name,
    failedSeas: failed,
    wish: trip.wish || '',
    departedAt: trip.departedAt,
    returnedAt: now,
    read: false,
  }
  if (!items.length) return { ...base, sea: null, seaName: '雾里', ...foggyPostcard(), items: [], model: null }

  // 以前带回过的东西不再带：从明信片册里收集已带回的链接。
  const seen = new Set(state.postcards.flatMap((p) => (p.items || []).map((it) => it.url)))
  const pool = shortlist(items, keywords, { seen })
  let card = null
  try {
    card = await writeWithModel(ctx, { sea, wish: trip.wish, items: pool })
  } catch (error) {
    console.warn('[dsh-whale-voyage] 模型没写成明信片，改用模板：', error && error.message ? error.message : error)
  }
  if (!card) card = { ...fallbackPostcard({ sea, items: pool }), model: null }
  return {
    ...base,
    place: card.place,
    message: card.message,
    model: card.model,
    items: card.picks.map((p) => ({ ...pool[p.index], why: p.why })),
  }
}

export function apply(ctx) {
  const file = dataFile()
  let state = null
  let settling = null
  let writeChain = Promise.resolve()

  const load = async () => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      if (parsed && parsed.version === 1 && parsed.whale) {
        return { ...freshState(), ...parsed, settings: { ...freshState().settings, ...parsed.settings } }
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') console.warn('[dsh-whale-voyage] 存档读不了，重新开始：', error.message)
    }
    return freshState()
  }

  const save = () => {
    const snapshot = JSON.stringify(state, null, 2)
    writeChain = writeChain
      .then(async () => {
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, snapshot, 'utf8')
        await rename(tmp, file)
      })
      .catch((error) => console.warn('[dsh-whale-voyage] 存档写入失败：', error && error.message ? error.message : error))
    return writeChain
  }

  const ready = load().then((loaded) => {
    state = loaded
  })

  const settle = () => {
    if (settling) return settling
    const tripId = state.whale.trip && state.whale.trip.id
    settling = (async () => {
      const now = Date.now()
      let postcard
      try {
        postcard = await makePostcard(ctx, state, now)
      } catch (error) {
        console.warn('[dsh-whale-voyage] 航程结算出错：', error)
        postcard = { id: tripId || randomUUID(), sea: null, seaName: '雾里', ...foggyPostcard(), items: [], model: null, departedAt: now, returnedAt: now, read: false, wish: '' }
      }
      if (state.whale.trip && state.whale.trip.id === tripId) {
        state = arrive(state, postcard, Date.now())
        await save()
      }
    })().finally(() => {
      settling = null
    })
    return settling
  }

  const tick = async () => {
    await ready
    if (settling) return
    const step = advance(state, Date.now())
    if (step.state !== state) {
      state = step.state
      await save()
    }
    if (step.settle) await settle()
  }

  ctx.effect(() => {
    let disposed = false
    const run = () => {
      if (!disposed) tick().catch((error) => console.warn('[dsh-whale-voyage] tick 出错：', error))
    }
    run()
    const timer = setInterval(run, TICK_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  })

  const view = () => {
    const now = Date.now()
    const trip = state.whale.trip
    return {
      now,
      peak: isPeak(now),
      whale: {
        ...state.whale,
        settling: Boolean(settling),
        trip: trip
          ? {
              ...trip,
              seaName: (seaById(trip.sea) || {}).name || '',
              dueAt: state.settings.offPeakOnly ? nextOffPeak(Math.max(trip.returnAt, now)) : trip.returnAt,
            }
          : null,
      },
      postcards: state.postcards,
      unread: state.postcards.filter((p) => !p.read).length,
      wish: state.wish,
      settings: state.settings,
      seas: SEAS.map((s) => ({
        id: s.id,
        name: s.name,
        blurb: s.blurb,
        visited: state.visited[s.id] || 0,
        unreachable: recentlyUnreachable(state.unreachable || {}, s.id, now),
      })),
    }
  }

  const act = async (body) => {
    switch (body && body.type) {
      case 'send-off':
        if (state.whale.status !== 'home') return { ok: false, error: '它已经在海上了' }
        state = depart(state, Date.now())
        break
      case 'read': {
        const ids = new Set(Array.isArray(body.ids) ? body.ids : [body.id])
        state = { ...state, postcards: state.postcards.map((p) => (ids.has(p.id) ? { ...p, read: true } : p)) }
        break
      }
      case 'wish':
        state = { ...state, wish: String(body.text || '').slice(0, 60).trim() }
        break
      case 'settings': {
        const next = { ...state.settings }
        for (const key of ['autoDepart', 'fastMode', 'offPeakOnly']) if (typeof body[key] === 'boolean') next[key] = body[key]
        state = { ...state, settings: next }
        // 打开快速模式时把正在进行的等待缩短到 2 分钟以内，方便试玩。
        if (next.fastMode) {
          const cap = Date.now() + 2 * 60_000
          const w = state.whale
          if (w.status === 'away' && w.trip && w.trip.returnAt > cap) state = { ...state, whale: { ...w, trip: { ...w.trip, returnAt: cap } } }
          if (w.status === 'home' && w.departAt && w.departAt > cap) state = { ...state, whale: { ...w, departAt: cap } }
        }
        break
      }
      default:
        return { ok: false, error: 'unknown-action' }
    }
    await save()
    return { ok: true }
  }

  const send = (res, status, payload) => {
    const body = JSON.stringify(payload)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-length', Buffer.byteLength(body))
    res.end(body)
  }

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > 16_384) {
          reject(new Error('body-too-large'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })

  /** 同源检查：只接受本页面发来的写请求，挡掉别的网站借浏览器发的请求。 */
  const sameOrigin = (req) => {
    if (req.headers['x-whale-voyage'] !== '1') return false
    const origin = req.headers.origin
    if (!origin) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/state`,
      handler: async (req, res) => {
        if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
        await ready
        send(res, 200, { ok: true, state: view() })
      },
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: `${API}/action`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!sameOrigin(req)) return send(res, 403, { ok: false, error: 'forbidden' })
        await ready
        try {
          const result = await act(JSON.parse((await readBody(req)) || '{}'))
          if (result.ok) tick().catch(() => {})
          send(res, result.ok ? 200 : 400, { ...result, state: view() })
        } catch (error) {
          send(res, 400, { ok: false, error: error && error.message ? error.message : String(error) })
        }
      },
    }),
  )
}
