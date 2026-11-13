/**
 * dsh-whale-voyage — 航程核心（不依赖 DSH，可单独测试）。
 *
 * - 海域：每片海对应一个免 key 的公开数据源，取回「真东西」（标题、链接、一句介绍）。
 * - 航程：出海 / 回港的时间安排；可选「谷时靠岸」，按 DeepSeek 峰谷时段推迟回港。
 * - 明信片：把取回的东西交给模型只挑一件、用鲸鱼的口吻写几句话；模型不可用时用模板兜底。
 */

/* ------------------------------------------------------------------ 海域 */

const UA = 'dsh-whale-voyage (+https://github.com/topics/dsh-plugin)'
const FETCH_TIMEOUT_MS = 10_000
const MAX_ITEMS = 30

function clean(text, max = 160) {
  const s = String(text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[k])
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

async function getText(url, { fetchImpl = fetch, headers = {} } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': UA, accept: '*/*', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts))
}

function daysAgo(n, now = Date.now()) {
  return new Date(now - n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * GitHub：最近新建、星数靠前的仓库；有纸条关键词时按关键词搜。
 * 每趟随机换时间窗（3 / 7 / 14 天）和页码，免得一天里总落在同一份榜单的同一页。
 */
export async function fetchCode({ keywords = [], fetchImpl, now, rng = Math.random } = {}) {
  const kw = keywords.slice(0, 2).join(' ')
  const window = [3, 7, 14][Math.floor(rng() * 3)]
  const page = kw ? 1 : 1 + Math.floor(rng() * 3)
  const q = encodeURIComponent(`${kw ? `${kw} ` : ''}created:>${daysAgo(window, now)}`)
  const data = await getJson(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${MAX_ITEMS}&page=${page}`, {
    fetchImpl,
    headers: { accept: 'application/vnd.github+json' },
  })
  return (data.items || []).map((r) => ({
    title: r.full_name,
    url: r.html_url,
    note: clean(r.description || '（作者没写简介）'),
    meta: `★ ${r.stargazers_count}${r.language ? ` · ${r.language}` : ''}`,
  }))
}

/** arXiv：AI / 计算语言学方向最新提交的论文；有关键词时全文搜。 */
export async function fetchPaper({ keywords = [], fetchImpl, rng = Math.random } = {}) {
  const query = keywords.length
    ? keywords.slice(0, 2).map((k) => `all:${encodeURIComponent(k)}`).join('+AND+')
    : 'cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG'
  const start = keywords.length ? 0 : Math.floor(rng() * 3) * MAX_ITEMS
  const xml = await getText(
    `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${MAX_ITEMS}`,
    { fetchImpl },
  )
  return parseArxiv(xml)
}

export function parseArxiv(xml) {
  const out = []
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = m[1]
    const pick = (tag) => (body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
    const id = clean(pick('id'), 300)
    if (!id) continue
    out.push({
      title: clean(pick('title'), 200),
      url: id.replace(/^http:/, 'https:'),
      note: clean(pick('summary'), 220),
      meta: clean(pick('published'), 40).slice(0, 10),
    })
  }
  return out
}

/** B 站：综合热门。 */
export async function fetchDanmaku({ fetchImpl, rng = Math.random } = {}) {
  const pn = 1 + Math.floor(rng() * 3)
  const data = await getJson(`https://api.bilibili.com/x/web-interface/popular?ps=${MAX_ITEMS}&pn=${pn}`, {
    fetchImpl,
    headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
  })
  if (data.code !== 0) throw new Error(`bilibili code ${data.code}`)
  return ((data.data && data.data.list) || []).map((v) => ({
    title: clean(v.title, 120),
    url: `https://www.bilibili.com/video/${v.bvid}`,
    note: clean(v.desc && v.desc !== '-' ? v.desc : `${v.tname || ''}区 · UP 主 ${v.owner ? v.owner.name : ''}`),
    meta: `${v.owner ? v.owner.name : ''}${v.stat ? ` · ${Math.round(v.stat.view / 1e4)} 万播放` : ''}`,
  }))
}

/** Hacker News：首页；有关键词时搜最近的讨论。 */
export async function fetchHacker({ keywords = [], fetchImpl } = {}) {
  const url = keywords.length
    ? `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(keywords[0])}&hitsPerPage=${MAX_ITEMS}`
    : `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${MAX_ITEMS}`
  const data = await getJson(url, { fetchImpl })
  return (data.hits || [])
    .filter((h) => h.title)
    .map((h) => ({
      title: clean(h.title, 160),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      note: `HN 讨论 ${h.num_comments || 0} 条`,
      meta: `${h.points || 0} points`,
    }))
}

/** V2EX：今日热议。 */
export async function fetchChat({ fetchImpl } = {}) {
  const data = await getJson('https://www.v2ex.com/api/topics/hot.json', { fetchImpl })
  return (Array.isArray(data) ? data : []).map((t) => ({
    title: clean(t.title, 120),
    url: t.url,
    note: clean(t.content || (t.node ? `${t.node.title} 节点` : ''), 160),
    meta: `${t.replies || 0} 条回复`,
  }))
}

export const SEAS = [
  { id: 'code', name: '代码群岛', blurb: 'GitHub 上最近冒出来的新仓库', keywordFriendly: true, fetch: fetchCode },
  { id: 'paper', name: '论文深海', blurb: 'arXiv 上新挂出来的论文', keywordFriendly: true, fetch: fetchPaper },
  { id: 'danmaku', name: '弹幕湾', blurb: 'B 站正在热播的视频', keywordFriendly: false, fetch: fetchDanmaku },
  { id: 'hacker', name: '黑客海峡', blurb: 'Hacker News 上大家在聊的', keywordFriendly: true, fetch: fetchHacker },
  { id: 'chat', name: '闲聊礁', blurb: 'V2EX 今天的热帖', keywordFriendly: false, fetch: fetchChat },
]

export function seaById(id) {
  return SEAS.find((s) => s.id === id)
}

/** 纸条 → 关键词：按空白、逗号、顿号切开，最多 4 个。 */
export function wishKeywords(wish) {
  return String(wish || '')
    .split(/[\s,，、;；/|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 30)
    .slice(0, 4)
}

/** 连不上的海记多久：24 小时内少去，过后网络可能恢复了，再正常挑。 */
export const UNREACHABLE_MEMORY_MS = 24 * 3_600_000

export function recentlyUnreachable(unreachable = {}, seaId, now = Date.now()) {
  const at = unreachable[seaId]
  return typeof at === 'number' && now - at < UNREACHABLE_MEMORY_MS
}

/**
 * 挑海域：鲸鱼有自己的主意。有纸条时七成去关键词能用上的海，否则随便逛；
 * 去得越少的海越容易被挑中（权重 1 /（1 + 去过的次数））；上一趟刚到过的海这一趟不去；
 * 24 小时内连不上的海权重降到一成（偶尔还会去试试网络恢复了没有）。
 */
export function chooseSea({ visited = {}, wish = '', rng = Math.random, available = SEAS, unreachable = {}, now = Date.now(), last = '' } = {}) {
  const hasWish = wishKeywords(wish).length > 0
  const followWish = hasWish && rng() < 0.7
  const pool = available.filter((s) => (followWish ? s.keywordFriendly : true))
  const wide = pool.length ? pool : available
  const fresh = wide.filter((s) => s.id !== last)
  const list = fresh.length ? fresh : wide
  const weights = list.map((s) => (1 / (1 + (visited[s.id] || 0))) * (recentlyUnreachable(unreachable, s.id, now) ? 0.1 : 1))
  let r = rng() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < list.length; i += 1) {
    r -= weights[i]
    if (r < 0) return { sea: list[i], followWish }
  }
  return { sea: list[list.length - 1], followWish }
}

/* ------------------------------------------------------------------ 时间 */

const HOUR = 3_600_000
const MINUTE = 60_000

function between(rng, lo, hi) {
  return Math.round(lo + rng() * (hi - lo))
}

/** 航程时长：正常 2–6 小时；快速模式 1–2 分钟（试玩用）。 */
export function tripDuration(settings = {}, rng = Math.random) {
  return settings.fastMode ? between(rng, 1 * MINUTE, 2 * MINUTE) : between(rng, 2 * HOUR, 6 * HOUR)
}

/** 回港后在港里歇多久再自己出门：正常 1–3 小时；快速模式 1–2 分钟。 */
export function restDuration(settings = {}, rng = Math.random) {
  return settings.fastMode ? between(rng, 1 * MINUTE, 2 * MINUTE) : between(rng, 1 * HOUR, 3 * HOUR)
}

/**
 * DeepSeek 峰谷：北京时间工作日 9–12 点、14–18 点为高峰，其余为谷时（半价）。
 * 不含法定节假日调休表。
 */
export function isPeak(epochMs) {
  const bj = new Date(epochMs + 8 * HOUR)
  const day = bj.getUTCDay()
  if (day === 0 || day === 6) return false
  const h = bj.getUTCHours()
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

/** 从 epochMs 起下一个谷时开始的时刻（本身就是谷时则原样返回）。按整点推进。 */
export function nextOffPeak(epochMs) {
  if (!isPeak(epochMs)) return epochMs
  let t = Math.ceil(epochMs / HOUR) * HOUR
  for (let i = 0; i < 48 && isPeak(t); i += 1) t += HOUR
  return t
}

/* ------------------------------------------------------------------ 明信片 */

/**
 * 给模型的候选（最多 12 条）：
 * - 以前带回过的链接（seen）先拿掉；拿掉后不到 3 条才用旧的补齐，免得空手而归。
 * - 含纸条关键词的排前面；同一档里随机打乱，每趟看到的候选不一样。
 */
export function shortlist(items, keywords = [], { limit = 12, seen = new Set(), rng = Math.random } = {}) {
  const kws = keywords.map((k) => k.toLowerCase())
  const fresh = items.filter((it) => !seen.has(it.url))
  const pool = fresh.length >= 3 ? fresh : [...fresh, ...items.filter((it) => seen.has(it.url))]
  const scored = pool.map((it) => {
    const text = `${it.title} ${it.note}`.toLowerCase()
    const hits = kws.filter((k) => text.includes(k)).length
    return { it, score: hits * 100 + (seen.has(it.url) ? -1000 : 0) + rng() * 10 }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.it)
}

export const POSTCARD_SYSTEM = [
  '你是一只圆滚滚的小鲸鱼，住在主人的港口里。你刚从一片海域旅行回来，要给主人写一张明信片。',
  '',
  '你会拿到：这次去的海域、主人塞给你的纸条（可能为空）、你在海上看到的一批真实条目（编号、标题、简介、链接）。',
  '',
  '一张明信片只介绍一样东西。要做的事：',
  '1. 从条目里只挑一件你觉得主人最值得看的「土特产」。有纸条时优先挑和纸条相关的；纸条上的东西这片海没有，就在正文里照实说没找到，再挑一件你自己觉得有意思的。',
  '2. 写一句「为什么带回来」，30 字以内，说清它是什么、哪里有意思。只能依据条目里给的信息，不编造条目里没有的事实和数字。',
  '3. 写一段明信片正文，40 到 70 字：第一人称，口语，像旅行途中随手写的；讲你是怎么遇到这样东西的、当时的心情。只讲这一件，不提别的条目。',
  '4. 起一个这次的落脚点小地名，8 字以内，和海域气质相符，比如「星标灯塔下」。',
  '',
  '只输出一个 JSON 对象，不要代码块、不要多余文字：',
  '{"place":"落脚点","message":"正文","pick":{"index":条目编号,"why":"为什么带回来"}}',
].join('\n')

export function postcardPrompt({ sea, wish, items }) {
  const lines = items.map((it, i) => `[${i}] ${it.title}\n    简介：${it.note || '无'}\n    ${it.meta ? `信息：${it.meta}\n    ` : ''}链接：${it.url}`)
  return [
    `海域：${sea.name}（${sea.blurb}）`,
    `主人的纸条：${wish ? wish : '（没有纸条）'}`,
    '',
    '你看到的条目：',
    ...lines,
  ].join('\n')
}

/** 从模型输出里抠出 JSON 并校验；不合格返回 null。 */
export function parsePostcardReply(text, itemCount) {
  const s = String(text || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj
  try {
    obj = JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj.message !== 'string') return null
  // 一张明信片只带一样东西：认 pick；模型按旧格式回了 picks 数组时取其中第一个合格的。
  const candidates = [obj.pick, ...(Array.isArray(obj.picks) ? obj.picks : [])].filter(Boolean)
  const picks = []
  for (const p of candidates) {
    const index = Number(p && p.index)
    if (!Number.isInteger(index) || index < 0 || index >= itemCount) continue
    picks.push({ index, why: clean(p.why, 60) })
    break
  }
  if (!picks.length) return null
  return { place: clean(obj.place || '', 16), message: clean(obj.message, 200), picks }
}

const FALLBACK_LINES = {
  code: ['群岛上到处是新搭的小木屋，每间门口都挂着星星。我挑了最亮的那一间，地址抄给你。', '今天代码群岛风很大，好多新仓库刚靠岸。我蹲在码头数星星，顺手捡了一个回来。'],
  paper: ['深海里很安静，只有论文一页页发着光。我游得很慢，挑了看起来最亮的那一页。', '在论文深海潜了一整天，耳朵里都是公式的回声。带回来一篇，标题我抄好了。'],
  danmaku: ['弹幕湾今天特别热闹，满天都是飘过去的字。我跟着人群看了好一会儿，挑了一个大家都在刷的。', '湾里的弹幕像流星雨一样，我差点迷路。回来前记下了最热闹的那一处。'],
  hacker: ['海峡那边的人聊得很起劲，灯塔亮到半夜。我在旁边听了一会儿，抄回来一条。', '黑客海峡风浪有点急，不过大家讨论的东西都很新鲜。我挑了一条给你。'],
  chat: ['闲聊礁上大家七嘴八舌，我也凑过去听了听。有个话题挺有意思，带回来给你看看。', '礁石上坐满了聊天的人，我在旁边晒太阳，顺便记下了一个热帖。'],
}
const FALLBACK_PLACES = {
  code: ['星标码头', '分支岔口', '提交灯塔'],
  paper: ['摘要海沟', '引用暗礁', '公式洋流'],
  danmaku: ['三连浅滩', '弹幕回旋处', '热门沙洲'],
  hacker: ['首页灯塔', '投票礁', '夜聊港'],
  chat: ['热帖沙滩', '回复潮间带', '节点小湾'],
}

function pickOne(list, rng) {
  return list[Math.floor(rng() * list.length) % list.length]
}

/** 模型不可用时的明信片：取第一件，配一句模板话。 */
export function fallbackPostcard({ sea, items, rng = Math.random }) {
  return {
    place: pickOne(FALLBACK_PLACES[sea.id] || ['无名小岛'], rng),
    message: pickOne(FALLBACK_LINES[sea.id] || ['这次走得有点远，带回来一样东西给你。'], rng),
    picks: items.slice(0, 1).map((_, index) => ({ index, why: '' })),
  }
}

/** 起雾：所有海域都取不到东西时的明信片。 */
export function foggyPostcard({ rng = Math.random } = {}) {
  return {
    place: pickOne(['雾里', '浓雾边上', '看不清的地方'], rng),
    message: pickOne(
      [
        '今天海上起了大雾，我游了好久什么也没看清，只好先回来了。等雾散了我再出去一趟。',
        '出门没多久就起雾了，信号断断续续的，什么都没捞到。别担心，我歇一会儿再去。',
      ],
      rng,
    ),
    picks: [],
  }
}

/**
 * 去一趟海：按顺序试这片海和备选海，取到第一批非空条目为止。
 * 备选海里，最近连不上的排到最后，少白等超时。
 * @returns {{ sea, items, tried: string[], failed: string[] }}  items 为空表示全都起雾；failed 是这趟连不上的海。
 */
export async function sail({ sea, keywords = [], fetchImpl, now = Date.now(), rng = Math.random, fallbacks = SEAS.length - 1, unreachable = {} }) {
  const others = SEAS.filter((s) => s.id !== sea.id)
    .map((s) => ({ s, k: (recentlyUnreachable(unreachable, s.id, now) ? 1 : 0) + rng() * 0.5 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s)
    .slice(0, fallbacks)
  const tried = []
  const failed = []
  for (const s of [sea, ...others]) {
    tried.push(s.id)
    try {
      const kws = s.keywordFriendly ? keywords : []
      let items = await s.fetch({ keywords: kws, fetchImpl, now, rng })
      if (!items.length && kws.length) items = await s.fetch({ keywords: [], fetchImpl, now, rng })
      items = items.filter((it) => it && it.title && /^https?:\/\//.test(it.url || ''))
      if (items.length) return { sea: s, items, tried, failed }
    } catch (error) {
      failed.push(s.id)
      console.warn(`[dsh-whale-voyage] ${s.name} 去不了：`, error && error.message ? error.message : error)
    }
  }
  return { sea, items: [], tried, failed }
}
