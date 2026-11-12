/**
 * dsh-whale-voyage — 浏览器半区。
 *
 * 左侧图标栏加一个「出海」入口（有新明信片时亮一个小点）；主区是港口：
 *   大肥鱼在不在家、去了哪片海、什么时候回来 → 新寄回来的明信片 → 塞纸条 → 明信片册 → 海图 → 设置。
 * 所有状态都来自宿主的 /api/dsh-whale-voyage/*，这里只负责画。
 */

window.__ModuleLoader__.load({
  id: 'dsh-whale-voyage',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const PANEL_ID = 'whale-voyage'
    const API = '/api/dsh-whale-voyage'
    const STYLE_ID = 'dsh-whale-voyage-style'

    /* ------------------------------------------------------------ 数据：一个小 store，图标和页面共用 */

    const store = { state: null, error: null, listeners: new Set(), timer: null }

    function notify() {
      for (const fn of store.listeners) fn()
    }

    function nextDelay() {
      const s = store.state
      if (!s) return 15_000
      const w = s.whale
      if (w.settling) return 3_000
      const now = Date.now()
      const soon = (t) => t && t - now < 90_000
      if (w.status === 'away' && w.trip && soon(w.trip.dueAt)) return 4_000
      if (w.status === 'home' && s.settings.autoDepart && soon(w.departAt)) return 4_000
      return 20_000
    }

    async function refresh() {
      try {
        const res = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
        const body = await res.json()
        if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`)
        store.state = { ...body.state, clientSkew: Date.now() - body.state.now }
        store.error = null
      } catch (error) {
        store.error = error && error.message ? error.message : String(error)
      }
      notify()
      schedule()
    }

    function schedule() {
      clearTimeout(store.timer)
      if (store.listeners.size) store.timer = setTimeout(refresh, nextDelay())
    }

    function subscribe(fn) {
      store.listeners.add(fn)
      if (store.listeners.size === 1) refresh()
      return () => {
        store.listeners.delete(fn)
        if (!store.listeners.size) clearTimeout(store.timer)
      }
    }

    async function act(payload) {
      const res = await fetch(`${API}/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-whale-voyage': '1' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
      if (body.state) store.state = { ...body.state, clientSkew: Date.now() - body.state.now }
      notify()
      schedule()
      if (!body.ok) throw new Error(body.error || '没成功')
      return body
    }

    function useStore() {
      const [, force] = useState(0)
      useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return store
    }

    function useNow(ms = 1000) {
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), ms)
        return () => clearInterval(t)
      }, [ms])
      return now
    }

    /* ------------------------------------------------------------ 格式化 */

    function hm(t) {
      const d = new Date(t)
      return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    function dayLabel(t) {
      const d = new Date(t)
      const today = new Date()
      const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diff = Math.round((start(d) - start(today)) / 86_400_000)
      if (diff === 0) return '今天'
      if (diff === 1) return '明天'
      if (diff === -1) return '昨天'
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
    }
    function when(t) {
      return `${dayLabel(t)} ${hm(t)}`
    }
    function left(ms) {
      if (ms <= 0) return '马上'
      const m = Math.ceil(ms / 60_000)
      if (m < 60) return `${m} 分钟`
      const hh = Math.floor(m / 60)
      const mm = m % 60
      return mm ? `${hh} 小时 ${mm} 分钟` : `${hh} 小时`
    }
    function dateStamp(t) {
      const d = new Date(t)
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
    }

    /** 由字符串种出一串稳定的伪随机数，让同一张明信片每次画得都一样。 */
    function seeded(seed) {
      let x = 2166136261
      for (const ch of String(seed)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619)
      return () => {
        x = Math.imul(x ^ (x >>> 15), 2246822507)
        x = Math.imul(x ^ (x >>> 13), 3266489909)
        x ^= x >>> 16
        return (x >>> 0) / 4294967296
      }
    }

    /* ------------------------------------------------------------ 画：大肥鱼 */

    /** 两个 #rrggbb 颜色按 t 混合。 */
    function mix(a, b, t) {
      const pa = parseInt(a.slice(1), 16)
      const pb = parseInt(b.slice(1), 16)
      const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
      return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
    }

    function Spout({ x = 0, y = 0, scale = 1, still = false }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${scale})`, className: still ? '' : 'wv-spout' },
        h('path', { d: 'M0 0C-1 -8 -6 -13 -13 -13M0 0C1 -8 6 -13 13 -13', stroke: '#d6eeff', strokeWidth: 3.2, fill: 'none', strokeLinecap: 'round' }),
        h('circle', { cx: -15.5, cy: -9, r: 1.8, fill: '#d6eeff' }),
        h('circle', { cx: 15.5, cy: -9, r: 1.8, fill: '#d6eeff' }),
        h('circle', { cx: 0, cy: -17, r: 2, fill: '#d6eeff' }),
      )
    }

    /** 朝右的大肥鱼，原点在身体中心；身体约 100×63，尾巴向左翘到 x=-88。 */
    function Whale({ x = 0, y = 0, scale = 1, flip = false, sleepy = false, spout = null, className = '' }) {
      const t = `translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`
      return h(
        'g',
        { transform: t, className },
        spout ? h(Spout, { x: 6, y: -33, still: spout === 'still' }) : null,
        // 尾巴
        h('path', { d: 'M-44 -6C-54 -8 -58 -16 -60 -24C-62 -32 -70 -38 -80 -38C-78 -30 -74 -24 -68 -20C-76 -20 -84 -16 -88 -8C-78 -6 -68 -8 -60 -12C-58 -2 -54 6 -44 10Z', fill: '#4a79b4' }),
        // 身体
        h('path', { d: 'M48 0C48 -20 28 -32 2 -32C-22 -32 -40 -22 -50 -6C-52 0 -50 6 -46 10C-36 24 -18 31 4 31C30 31 48 20 48 0Z', fill: '#5c92d1' }),
        // 背上的高光
        h('path', { d: 'M-28 -20C-14 -29 10 -30 26 -22', stroke: '#8db8ea', strokeWidth: 5, strokeLinecap: 'round', fill: 'none', opacity: 0.7 }),
        // 白肚皮和腹纹
        h('path', { d: 'M-44 8C-30 18 -4 21 18 17C32 14 42 8 47 4C46 20 29 31 4 31C-18 31 -36 24 -46 10Z', fill: '#e3f1fc' }),
        h('path', { d: 'M-22 21C-10 25 6 26 20 23M-12 26.5C-2 29 10 29 20 27', stroke: '#b9d6ee', strokeWidth: 1.3, strokeLinecap: 'round', fill: 'none' }),
        // 鳍
        h('path', { d: 'M-4 12C-8 22 -4 30 6 34C8 28 8 20 6 13Z', fill: '#4a79b4' }),
        // 脸
        sleepy
          ? h('path', { d: 'M20 -5q5 4 10 0', stroke: '#1d3557', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' })
          : h('g', null, h('circle', { cx: 25, cy: -5, r: 4, fill: '#1d3557' }), h('circle', { cx: 26.3, cy: -6.4, r: 1.3, fill: '#ffffff' })),
        h('ellipse', { cx: 29, cy: 5, rx: 5, ry: 3, fill: '#f7a6ba', opacity: 0.85 }),
        h('path', { d: 'M37 2q3.6 3.4 7.2 0', stroke: '#1d3557', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' }),
        h('ellipse', { cx: 6, cy: -31, rx: 3, ry: 1, fill: '#3f6aa3' }),
      )
    }

    /* ------------------------------------------------------------ 画：通用部件 */

    const WL = 44

    /** 一层浪：上沿是波浪线，往下填满。几层叠起来，把大肥鱼夹在中间，它就泡在水里了。 */
    function WaveBand({ y, amp = 3, phase = 0, fill, width = 300, depth = 200, opacity = 1, speed = 0 }) {
      let d = `M${-WL - phase} ${y}`
      for (let x = -WL - phase; x < width + WL * 2; x += WL) d += `q${WL / 4} ${-amp} ${WL / 2} 0t${WL / 2} 0`
      d += `V${depth}H${-WL * 2}Z`
      return h('path', { d, fill, opacity, className: speed ? 'wv-wave' : '', style: speed ? { animationDuration: `${speed}s` } : undefined })
    }

    /** 水面上的几道反光。 */
    function Glints({ rng, y0, y1, width = 300, n = 9, color = '#ffffff', opacity = 0.35 }) {
      return h(
        'g',
        null,
        ...Array.from({ length: n }, (_, i) => {
          const x = rng() * width
          const y = y0 + rng() * (y1 - y0)
          return h('path', { key: i, d: `M${x} ${y}h${6 + rng() * 10}`, stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', opacity: opacity * (0.5 + rng() * 0.5) })
        }),
      )
    }

    /** 太阳或月亮在水面上的倒影：一串越往下越散的横线。 */
    function Reflection({ x, y0, color, rng, rows = 6, opacity = 0.55 }) {
      return h(
        'g',
        null,
        ...Array.from({ length: rows }, (_, i) => {
          const w = 26 - i * 3 + rng() * 6
          const dx = (rng() - 0.5) * (4 + i * 2)
          return h('path', { key: i, d: `M${x - w / 2 + dx} ${y0 + 5 + i * 8}h${w}`, stroke: color, strokeWidth: 2.2, strokeLinecap: 'round', opacity: opacity * (1 - i / (rows + 1)) })
        }),
      )
    }

    function Cloud({ x, y, s = 1, color = '#ffffff', opacity = 0.92 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${s})`, opacity },
        h('path', { d: 'M-22 6a8 8 0 0 1 2-15.5a12 12 0 0 1 22-4a9 9 0 0 1 15 6a7 7 0 0 1 1 13.5z', fill: color }),
      )
    }

    function Star({ x, y, s = 1, rot = 0, fill = '#f6c63c' }) {
      return h('path', {
        transform: `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
        d: 'M0 -5L1.5 -1.6L5 -1.5L2.3 0.8L3.1 4.5L0 2.5L-3.1 4.5L-2.3 0.8L-5 -1.5L-1.5 -1.6Z',
        fill,
        stroke: fill,
        strokeWidth: 0.8,
        strokeLinejoin: 'round',
      })
    }

    function Pine({ x, y, s = 1, fill = '#2f7d4f' }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${s})` },
        h('rect', { x: -1, y: -3, width: 2, height: 4, fill: '#7a5230' }),
        h('path', { d: 'M-6 -3L0 -13L6 -3Z', fill }),
        h('path', { d: 'M-4.5 -9L0 -18L4.5 -9Z', fill }),
      )
    }

    function Birds({ x, y, color = '#3d3d5c', s = 1 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${s})`, stroke: color, strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round' },
        h('path', { d: 'M0 0q3-4 6 0q3-4 6 0' }),
        h('path', { d: 'M16 -7q2.4-3.2 4.8 0q2.4-3.2 4.8 0' }),
      )
    }

    /* ------------------------------------------------------------ 画：海域明信片正面 */

    const PALETTES = {
      code: { sky: ['#bfeadf', '#f1fbf8'], sea: ['#35b3a6', '#0f6860'], ink: '#0e4f49' },
      paper: { sky: ['#143a78', '#081a3d'], sea: ['#10264f', '#050f24'], ink: '#dce8ff' },
      danmaku: { sky: ['#ffcfe3', '#fff1f7'], sea: ['#62cdf7', '#1b86bd'], ink: '#7a2550' },
      hacker: { sky: ['#ffab66', '#ffe4c7'], sea: ['#4b6f9c', '#22354f'], ink: '#5a2a05' },
      chat: { sky: ['#d3c5ff', '#f3eeff'], sea: ['#9483e6', '#5443ad'], ink: '#382a7a' },
      fog: { sky: ['#c3c9d2', '#e9edf1'], sea: ['#a3adba', '#6b7685'], ink: '#3d4552' },
    }

    /*
     * 每张明信片画的是「这一趟」：
     * - 回港时刻定天色（清晨 / 白天 / 傍晚 / 夜里），夜里有月亮和星星；
     * - 天气按这张卡随机（晴 / 多云 / 雨 / 彩虹）；
     * - 大肥鱼的姿势随机（游 / 喷水 / 跃出水面 / 探头）；
     * - 画里的字和物件来自它带回的东西：弹幕是视频标题片段，小房子门牌是仓库的语言，气泡是帖子开头。
     */

    function timeOfDay(t) {
      const hr = new Date(t).getHours()
      if (hr >= 5 && hr < 8) return 'dawn'
      if (hr >= 8 && hr < 17) return 'day'
      if (hr >= 17 && hr < 20) return 'dusk'
      return 'night'
    }

    const TIME_SKIES = {
      dawn: ['#ffbf9e', '#f3f1ff'],
      dusk: ['#ec7a62', '#ffd7a1'],
      night: ['#0e1a3a', '#2b3b72'],
    }

    function cardSky(seaId, pal, tod) {
      if (seaId === 'paper' || seaId === 'fog' || tod === 'day') return pal.sky
      return TIME_SKIES[tod]
    }

    /** 从带回的东西里取几个短词，画进插画。 */
    function tokensFrom(card) {
      const items = card.items || []
      const short = (s, n) => {
        const t = String(s || '').replace(/[【】\[\]（）()「」《》|]/g, ' ').replace(/\s+/g, ' ').trim()
        return t.length > n ? t.slice(0, n) : t
      }
      if (card.sea === 'code') {
        const ABBR = { TypeScript: 'TS', JavaScript: 'JS', 'Jupyter Notebook': 'Jupyter' }
        return items.map((it) => {
          const lang = String(it.meta || '').split('·')[1]
          const name = lang && lang.trim() ? lang.trim() : String(it.title || '').split('/').pop()
          return short(ABBR[name] || name, 7)
        })
      }
      if (card.sea === 'danmaku') return items.map((it) => short(it.title, 7))
      if (card.sea === 'chat') return items.map((it) => short(it.title, 4))
      return items.map((it) => short(it.title, 24))
    }

    function pickWeather(rng, tod, seaId) {
      if (seaId === 'paper' || seaId === 'fog') return 'clear'
      const r = rng()
      if (r < 0.48) return 'clear'
      if (r < 0.72) return 'clouds'
      if (r < 0.86) return 'rain'
      return tod === 'night' ? 'clouds' : 'rainbow'
    }

    /** 这张卡的光源：夜里是月亮，清晨傍晚是贴着海平面的太阳，晴朗的白天是高处的太阳。 */
    function pickLight(rng, tod, weather, seaId) {
      if (seaId === 'paper' || seaId === 'fog') return null
      if (tod === 'night') return { kind: 'moon', x: 34 + rng() * 170, y: 30, color: '#fff3c9' }
      if (tod === 'dawn') return { kind: 'low', x: 44 + rng() * 70, y: 124, color: '#ffe2a8' }
      if (tod === 'dusk') return { kind: 'low', x: 150 + rng() * 70, y: 124, color: '#ffb46b' }
      if (weather === 'clear' || weather === 'rainbow') return { kind: 'sun', x: 26 + rng() * 40, y: 28, color: '#ffe27a' }
      return null
    }

    function SkyLayer({ tod, weather, rng, light, skyTop }) {
      const out = []
      if (tod === 'night' && light) {
        for (let i = 0; i < 16; i += 1) out.push(h('circle', { key: `s${i}`, cx: rng() * 300, cy: rng() * 104, r: 0.6 + rng() * 1.1, fill: '#ffffff', opacity: 0.45 + rng() * 0.5, className: i % 4 === 0 ? 'wv-blink' : '' }))
      }
      if (light && light.kind === 'moon') {
        out.push(h('circle', { key: 'halo', cx: light.x, cy: light.y, r: 20, fill: light.color, opacity: 0.12 }))
        out.push(h('circle', { key: 'moon', cx: light.x, cy: light.y, r: 11, fill: light.color }), h('circle', { key: 'moon2', cx: light.x + 5.5, cy: light.y - 3.5, r: 9.5, fill: skyTop }))
      } else if (light) {
        const r = light.kind === 'low' ? 21 : 12
        out.push(h('circle', { key: 'halo2', cx: light.x, cy: light.y, r: r * 2.1, fill: light.color, opacity: 0.16 }))
        out.push(h('circle', { key: 'halo', cx: light.x, cy: light.y, r: r * 1.45, fill: light.color, opacity: 0.28 }))
        out.push(h('circle', { key: 'sun', cx: light.x, cy: light.y, r, fill: light.color }))
      }
      if (weather === 'rainbow') {
        const cx = 70 + rng() * 150
        const colors = ['#ff8a80', '#ffd180', '#fff59d', '#a5d6a7', '#90caf9', '#b39ddb']
        colors.forEach((c, i) => out.push(h('path', { key: `r${i}`, d: `M${cx - 72 + i * 3.6} 126a${72 - i * 3.6} ${72 - i * 3.6} 0 0 1 ${144 - i * 7.2} 0`, stroke: c, strokeWidth: 3.8, fill: 'none', opacity: 0.5 })))
      }
      if (weather === 'clouds' || weather === 'rain' || weather === 'rainbow') {
        const n = weather === 'rainbow' ? 1 : 2 + Math.floor(rng() * 2)
        const color = weather === 'rain' ? '#c6cfdc' : tod === 'night' ? '#aab4d8' : tod === 'dusk' ? '#ffe6d6' : '#ffffff'
        for (let i = 0; i < n; i += 1) out.push(h(Cloud, { key: `c${i}`, x: 34 + rng() * 180, y: 24 + rng() * 34, s: 0.75 + rng() * 0.6, color, opacity: tod === 'night' ? 0.55 : 0.92 }))
      }
      return h('g', null, ...out)
    }

    function RainLayer({ rng }) {
      const lines = []
      for (let i = 0; i < 36; i += 1) {
        const x = rng() * 320
        const y = rng() * 185
        lines.push(h('path', { key: i, d: `M${x} ${y}l-3.5 9`, stroke: '#eef4ff', strokeWidth: 1.1, opacity: 0.55, strokeLinecap: 'round' }))
      }
      return h('g', null, ...lines)
    }

    function House({ x, y, label, roof, ink, lit }) {
      return h(
        'g',
        { transform: `translate(${x} ${y})` },
        h('rect', { x: 0, y: 0, width: 26, height: 18, rx: 2, fill: '#fff6e3' }),
        h('rect', { x: 0, y: 14.5, width: 26, height: 3.5, fill: '#e9d9b8' }),
        h('rect', { x: 2.5, y: 3.5, width: 21, height: 9, rx: 1.5, fill: lit ? '#ffe9a8' : '#ffffff' }),
        h('path', { d: 'M-3.5 2.5L13 -11L29.5 2.5Z', fill: roof }),
        h('path', { d: 'M13 -11L29.5 2.5H21Z', fill: '#000000', opacity: 0.12 }),
        h('text', { x: 13, y: 10.4, fontSize: label.length > 4 ? 5 : 6.4, textAnchor: 'middle', fill: ink, fontWeight: 700, fontFamily: 'ui-monospace,Menlo,monospace' }, label),
      )
    }

    /** 海平面以上的景物（论文深海除外，那片整张都在水下）。 */
    function SeaDecor({ sea, rng, ink, tokens, tod, sky, landRight = true }) {
      const night = tod === 'night'
      const dim = (c) => (night ? mix(c, '#0b1530', 0.42) : tod === 'dusk' ? mix(c, '#7a3b2e', 0.18) : c)
      if (sea === 'code') {
        const mirror = !landRight
        const mx = (x, w = 0) => (mirror ? 300 - x - w : x)
        const n = Math.max(1, Math.min(3, tokens.length || 1))
        const roofs = ['#e76f51', '#2a9d8f', '#e9b949']
        return h(
          'g',
          null,
          h(
            'g',
            { transform: mirror ? 'translate(300 0) scale(-1 1)' : undefined },
            h('path', { d: 'M146 128q40-40 94-36q36 2 60 36z', fill: dim('#3f9d63') }),
            h('path', { d: 'M172 106q28-17 66-14q-34 5-56 22z', fill: dim('#63bf85'), opacity: 0.8 }),
            h('path', { d: 'M10 128q26-24 60-20q24 3 34 20z', fill: dim('#4caf72') }),
            h('path', { d: 'M30 114q18-10 38-8q-20 4-30 12z', fill: dim('#74cb93'), opacity: 0.8 }),
          ),
          h(Pine, { x: mx(160), y: 116, s: 0.9, fill: dim('#2f7d4f') }),
          h(Pine, { x: mx(276), y: 113, s: 1.05, fill: dim('#2f7d4f') }),
          h(Pine, { x: mx(44), y: 113, s: 0.85, fill: dim('#37885a') }),
          h(Pine, { x: mx(58), y: 115, s: 0.65, fill: dim('#2f7d4f') }),
          ...Array.from({ length: n }, (_, i) => h(House, { key: i, x: mx(178 + i * 30, 26), y: 90 - (i % 2) * 5, label: tokens[i] || '{ }', roof: dim(roofs[i % roofs.length]), ink, lit: night || tod === 'dusk' })),
          ...[0, 1, 2].map((i) => h(Star, { key: `st${i}`, x: 24 + rng() * 200, y: 22 + rng() * 52, s: 0.9 + rng() * 0.6, rot: -20 + rng() * 40 })),
        )
      }
      if (sea === 'danmaku') {
        const generic = ['哈哈哈哈', '名场面', '来了来了', '三连了', '前方高能', '好耶', '泪目', '学到了']
        const words = [...tokens.filter(Boolean).slice(0, 1), ...generic.sort(() => rng() - 0.5)].slice(0, 4)
        const colors = ['#ff5c93', '#0099cf', '#f59f00', '#7b61ff', night ? '#ffffff' : '#444444', '#22a08f']
        const left = !landRight
        const ux = left ? 34 + rng() * 30 : 236 + rng() * 30
        return h(
          'g',
          null,
          ...words.map((w, i) =>
            h(
              'text',
              {
                key: i,
                x: rng() * 150,
                y: 18 + i * 14.5,
                fontSize: i < tokens.length ? 11 : 9.5,
                fontWeight: i < tokens.length ? 700 : 500,
                fill: colors[i % colors.length],
                stroke: night ? '#0e1a3a' : '#ffffff',
                strokeWidth: 2.2,
                strokeOpacity: 0.75,
                paintOrder: 'stroke',
                strokeLinejoin: 'round',
                className: 'wv-scroll',
                style: { animationDelay: `${-rng() * 8}s` },
              },
              w,
            ),
          ),
          h('path', { d: left ? 'M0 128q60-16 124-5q28 5 40 5z' : 'M300 128q-60-16-124-5q-28 5-40 5z', fill: dim('#f6d9ab') }),
          h('path', { d: left ? 'M0 128q50-9 104-3z' : 'M300 128q-50-9-104-3z', fill: dim('#fbe8c6') }),
          // 沙滩伞
          h(
            'g',
            { transform: `translate(${ux} 121)` },
            h('path', { d: 'M0 0V-21', stroke: dim('#8a6d4b'), strokeWidth: 1.4 }),
            h('path', { d: 'M-15 -19a15 12 0 0 1 30 0z', fill: dim('#ff7aa5') }),
            h('path', { d: 'M-5 -19a15 12 0 0 1 5-11.6a15 12 0 0 1 5 11.6z', fill: dim('#ffffff') }),
            h('circle', { cx: 0, cy: -31, r: 1.2, fill: dim('#ff7aa5') }),
          ),
          h(Star, { x: ux + (left ? 26 : -26), y: 123, s: 0.55, rot: 18, fill: dim('#ff9a62') }),
        )
      }
      if (sea === 'hacker') {
        const right = landRight
        const lx = right ? 214 : 78
        const boats = Math.floor(rng() * 3)
        const lit = night || tod === 'dusk'
        return h(
          'g',
          null,
          h('path', { d: 'M0 126q34-20 84-11q44-16 96-5q52-14 120 16z', fill: mix(sky[1], '#33475f', 0.4), opacity: 0.7 }),
          lit ? h('path', { d: right ? `M${lx - 4} 62L${lx - 150} 34V84Z` : `M${lx + 4} 62L${lx + 150} 34V84Z`, fill: '#fff3c4', opacity: 0.22, className: 'wv-beam' }) : null,
          h('path', { d: `M${lx - 32} 128q8-15 30-14q26 0 38 14z`, fill: dim('#2c3e50') }),
          h('path', { d: `M${lx - 20} 118q8-5 20-4q-10 2-14 6z`, fill: dim('#48607a') }),
          h('path', { d: `M${lx - 8} 115L${lx - 5.5} 72H${lx + 5.5}L${lx + 8} 115Z`, fill: dim('#ffffff') }),
          h('path', { d: `M${lx - 6.2} 84H${lx + 6.2}L${lx + 6.8} 93H${lx - 6.8}Z`, fill: dim('#ff6600') }),
          h('path', { d: `M${lx - 7.3} 102H${lx + 7.3}L${lx + 7.8} 111H${lx - 7.8}Z`, fill: dim('#ff6600') }),
          h('rect', { x: lx - 8, y: 69, width: 16, height: 3.2, rx: 1, fill: dim('#2c3e50') }),
          h('rect', { x: lx - 4.5, y: 60, width: 9, height: 9, fill: lit ? '#fff3c4' : dim('#dfeaf5') }),
          h('path', { d: `M${lx - 6.5} 60L${lx} 53L${lx + 6.5} 60Z`, fill: dim('#ff6600') }),
          h('rect', { x: lx - 1.6, y: 96, width: 3.2, height: 4.5, rx: 1.4, fill: dim('#2c3e50') }),
          ...Array.from({ length: boats }, (_, i) => {
            const bx = (right ? 36 : 176) + rng() * 96
            return h(
              'g',
              { key: `b${i}`, transform: `translate(${bx} ${121 + rng() * 3})` },
              h('path', { d: 'M-10 0h20l-4 5.5h-12z', fill: dim('#5a3a1f') }),
              h('path', { d: 'M0 -1v-16l9 13.5z', fill: dim(i % 2 ? '#ffffff' : '#ff6600') }),
              h('path', { d: 'M-1.2 -1v-12l-6 10z', fill: dim('#f1e3c8') }),
            )
          }),
          h(Birds, { x: right ? 60 + rng() * 60 : 170 + rng() * 40, y: 40 + rng() * 24, color: night ? '#9aa6cf' : '#5a3d2b' }),
        )
      }
      if (sea === 'chat') {
        const texts = tokens.length ? tokens : ['…', '+1', '…']
        return h(
          'g',
          null,
          h('path', { d: 'M4 128q22-24 50-21q20 2 30 21z', fill: dim('#6b5a9e') }),
          h('path', { d: 'M22 113q14-8 30-6q-16 3-22 10z', fill: dim('#8b7bc0'), opacity: 0.85 }),
          h('path', { d: 'M204 128q26-30 62-25q22 4 34 25z', fill: dim('#6b5a9e') }),
          h('path', { d: 'M226 110q18-12 40-8q-22 4-30 14z', fill: dim('#8b7bc0'), opacity: 0.85 }),
          h('path', { d: 'M150 128q8-9 20-8q10 1 14 8z', fill: dim('#7868ad') }),
          ...texts.slice(0, 3).map((t, i) => {
            const x = 44 + i * 78 + rng() * 16
            const y = 34 + rng() * 30
            const w = Math.max(26, t.length * 10 + 12)
            return h(
              'g',
              { key: i, transform: `translate(${x} ${y})`, className: 'wv-bob', style: { animationDelay: `${-i * 0.7}s` } },
              h('rect', { x: -w / 2 + 1, y: -9.5, width: w, height: 22, rx: 10, fill: '#3a2a7a', opacity: 0.12 }),
              h('rect', { x: -w / 2, y: -11, width: w, height: 22, rx: 10, fill: '#ffffff' }),
              h('path', { d: i % 2 ? 'M6 10l5 8-11-8' : 'M-6 10l-5 8 11-8', fill: '#ffffff' }),
              h('text', { x: 0, y: 4, fontSize: 9.5, fontWeight: 600, textAnchor: 'middle', fill: ink }, t),
            )
          }),
          h(Birds, { x: 120 + rng() * 60, y: 84 + rng() * 14, color: night ? '#b3a8e6' : '#5a49b2', s: 0.9 }),
        )
      }
      // 起雾：远处只剩一座灯塔的影子。
      return h(
        'g',
        null,
        h('path', { d: 'M196 128q10-12 26-11q18 0 26 11z', fill: '#8791a0', opacity: 0.6 }),
        h('path', { d: 'M215 117L217 84H225L227 117ZM214 84h14l-7-8z', fill: '#8791a0', opacity: 0.6 }),
      )
    }

    function FogLayer({ rng }) {
      return h(
        'g',
        null,
        ...[0, 1, 2, 3, 4].map((i) => h('rect', { key: i, x: -60 + rng() * 120, y: 26 + i * 27 + rng() * 8, width: 250 + rng() * 90, height: 13 + rng() * 6, rx: 9, fill: '#ffffff', opacity: 0.34 + rng() * 0.2 })),
      )
    }

    /** 论文深海：整张都在水下。光柱、发光的纸页、水母、海底的海草。 */
    function DeepScene({ rng, tokens, gid }) {
      const pages = 1 // 一张只讲一页论文
      const jelly = 1 + Math.floor(rng() * 2)
      const wx = 80 + rng() * 120
      const wy = 96 + rng() * 34
      const flip = rng() < 0.4
      return h(
        'g',
        null,
        ...[0, 1, 2].map((i) => {
          const x = 30 + i * 90 + rng() * 40
          return h('path', { key: `l${i}`, d: `M${x} 0L${x + 26} 0L${x - 30 + rng() * 20} 200L${x - 74} 200Z`, fill: '#bcd9ff', opacity: 0.07, className: 'wv-glow' })
        }),
        tokens[0] ? h('text', { x: 16, y: 24, fontSize: 9, fill: '#cfe3ff', opacity: 0.8, fontFamily: 'Georgia,serif', fontStyle: 'italic' }, tokens[0]) : null,
        ...Array.from({ length: pages }, (_, i) => {
          const x = 28 + rng() * 240
          const y = 44 + rng() * 104
          const r = -25 + rng() * 50
          return h(
            'g',
            { key: i, transform: `translate(${x} ${y}) rotate(${r})`, className: 'wv-bob', style: { animationDelay: `${-rng() * 3}s` } },
            h('circle', { r: 17, fill: '#fff6c9', opacity: 0.1 }),
            h('rect', { x: -8, y: -10.5, width: 16, height: 21, rx: 1.5, fill: '#f8f3d9', opacity: 0.94 }),
            h('path', { d: 'M-5 -6h10M-5 -2.5h10M-5 1h7M-5 4.5h9', stroke: '#8a7f52', strokeWidth: 0.9 }),
          )
        }),
        ...Array.from({ length: jelly }, (_, i) => {
          const x = 40 + rng() * 220
          const y = 40 + rng() * 60
          const c = i % 2 ? '#a7c8ff' : '#f7a8d8'
          return h(
            'g',
            { key: `j${i}`, transform: `translate(${x} ${y})`, opacity: 0.85, className: 'wv-float' },
            h('circle', { r: 15, fill: c, opacity: 0.12 }),
            h('path', { d: 'M-9 0a9 8 0 0 1 18 0q-9 3-18 0z', fill: c }),
            h('path', { d: 'M-6 1q-2 6 0 12M-2 1.5q2 7 0 15M2 1.5q-2 7 0 14M6 1q2 6 0 11', stroke: c, strokeWidth: 1.1, fill: 'none', strokeLinecap: 'round' }),
          )
        }),
        // 海底
        h('path', { d: 'M0 180q40-16 86-8q46-14 100-4q54-12 114 6V200H0z', fill: '#06122b' }),
        h('path', { d: 'M0 190q60-12 130-6q80-10 170 4V200H0z', fill: '#040c1f' }),
        ...Array.from({ length: 7 }, (_, i) => {
          const x = 10 + i * 44 + rng() * 22
          const hgt = 14 + rng() * 20
          return h('path', { key: `w${i}`, d: `M${x} 192q-5 ${-hgt / 3} 0 ${(-hgt * 2) / 3}t0 ${-hgt / 3}`, stroke: i % 2 ? '#1d6f6a' : '#195c7a', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' })
        }),
        ...Array.from({ length: 9 }, (_, i) => h('circle', { key: `b${i}`, cx: 16 + rng() * 270, cy: 14 + rng() * 150, r: 0.9 + rng() * 2, fill: 'none', stroke: '#cfe3ff', strokeWidth: 0.8, opacity: 0.6 })),
        // 大肥鱼和它吐的泡泡
        h(Whale, { x: wx, y: wy, scale: 0.42, flip }),
        ...[0, 1, 2].map((i) => h('circle', { key: `wb${i}`, cx: wx + (flip ? -1 : 1) * (22 + i * 3), cy: wy - 12 - i * 9, r: 1.6 + i * 0.7, fill: 'none', stroke: '#e3f1fc', strokeWidth: 0.9, opacity: 0.8 })),
      )
    }

    function pickPose(rng) {
      const r = rng()
      if (r < 0.34) return 'swim'
      if (r < 0.58) return 'spout'
      if (r < 0.82) return 'jump'
      return 'peek'
    }

    /** 大肥鱼画在第一层浪和第二层浪之间，下半身被前面的浪盖住。 */
    function WhaleInScene({ pose, rng, side = null }) {
      const flip = rng() < 0.4
      const x = side === 'left' ? 56 + rng() * 70 : side === 'right' ? 176 + rng() * 70 : 74 + rng() * 116
      const dir = flip ? -1 : 1
      if (pose === 'jump') {
        return h(
          'g',
          null,
          h('g', { transform: `translate(${x} 112) rotate(${-22 * dir})` }, h(Whale, { scale: 0.42, flip })),
          ...[0, 1, 2, 3, 4, 5].map((i) => h('circle', { key: i, cx: x - 20 * dir + (rng() - 0.5) * 34, cy: 128 - rng() * 14, r: 1.3 + rng() * 2, fill: '#ffffff', opacity: 0.9 })),
          h('path', { d: `M${x - 20 * dir - 20} 131q10-9 20 0q10-9 20 0`, stroke: '#ffffff', strokeWidth: 2, fill: 'none', opacity: 0.85, strokeLinecap: 'round' }),
        )
      }
      if (pose === 'peek') return h(Whale, { x, y: 149, scale: 0.5, flip })
      return h(Whale, { x, y: 143, scale: 0.42, flip, spout: pose === 'spout' ? 'still' : null })
    }

    /* ---- 大肥鱼的另外几个角度：正脸、背影、俯视 ---- */

    /** 正脸：圆圆的大脸对着镜头。原点在脸中心，宽约 132、高约 116。 */
    function WhaleFront({ x = 0, y = 0, scale = 1, tilt = 0, mood = 'calm', spout = false }) {
      const eye = (cx) =>
        mood === 'happy'
          ? h('path', { key: cx, d: `M${cx - 7} 0q7 -9 14 0`, stroke: '#1d3557', strokeWidth: 3, fill: 'none', strokeLinecap: 'round' })
          : h('g', { key: cx }, h('circle', { cx, cy: -2, r: 6.6, fill: '#1d3557' }), h('circle', { cx: cx + 2.2, cy: -4.4, r: 2.2, fill: '#ffffff' }), h('circle', { cx: cx - 2.4, cy: 0.6, r: 1, fill: '#ffffff', opacity: 0.8 }))
      return h(
        'g',
        { transform: `translate(${x} ${y}) rotate(${tilt}) scale(${scale})` },
        spout ? h(Spout, { x: 0, y: -57, scale: 1.5, still: true }) : null,
        h('path', { d: 'M-58 14C-80 8 -94 20 -97 36C-82 37 -68 31 -58 27Z', fill: '#4a79b4' }),
        h('path', { d: 'M58 14C80 8 94 20 97 36C82 37 68 31 58 27Z', fill: '#4a79b4' }),
        h('path', { d: 'M-66 6C-66 -34 -36 -56 0 -56C36 -56 66 -34 66 6C66 40 38 60 0 60C-38 60 -66 40 -66 6Z', fill: '#5c92d1' }),
        h('path', { d: 'M-36 -38C-20 -49 16 -49 32 -40', stroke: '#8db8ea', strokeWidth: 6.5, strokeLinecap: 'round', fill: 'none', opacity: 0.7 }),
        h('path', { d: 'M-54 30C-32 19 32 19 54 30C47 50 25 60 0 60C-25 60 -47 50 -54 30Z', fill: '#e3f1fc' }),
        h('path', { d: 'M-24 41C-8 45 8 45 24 41M-15 49.5C-5 52.5 5 52.5 15 49.5', stroke: '#b9d6ee', strokeWidth: 1.5, strokeLinecap: 'round', fill: 'none' }),
        eye(-31),
        eye(31),
        h('ellipse', { cx: -43, cy: 13, rx: 8.5, ry: 5, fill: '#f7a6ba', opacity: 0.85 }),
        h('ellipse', { cx: 43, cy: 13, rx: 8.5, ry: 5, fill: '#f7a6ba', opacity: 0.85 }),
        mood === 'wow'
          ? h('ellipse', { cx: 0, cy: 13, rx: 5, ry: 6, fill: '#1d3557' })
          : h('path', { d: 'M-8 9q8 8 16 0', stroke: '#1d3557', strokeWidth: 2.6, fill: 'none', strokeLinecap: 'round' }),
        h('ellipse', { cx: 0, cy: -54, rx: 4.4, ry: 1.5, fill: '#3f6aa3' }),
      )
    }

    /** 背影：只看得到圆圆的后背。原点和大小同正脸。 */
    function WhaleBack({ x = 0, y = 0, scale = 1, tilt = 0, spout = false }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) rotate(${tilt}) scale(${scale})` },
        spout ? h(Spout, { x: 0, y: -57, scale: 1.5, still: true }) : null,
        h('path', { d: 'M-58 14C-80 8 -94 20 -97 36C-82 37 -68 31 -58 27Z', fill: '#4a79b4' }),
        h('path', { d: 'M58 14C80 8 94 20 97 36C82 37 68 31 58 27Z', fill: '#4a79b4' }),
        h('path', { d: 'M-66 6C-66 -34 -36 -56 0 -56C36 -56 66 -34 66 6C66 40 38 60 0 60C-38 60 -66 40 -66 6Z', fill: '#5687c6' }),
        h('path', { d: 'M-40 -34C-22 -48 20 -48 38 -36', stroke: '#8db8ea', strokeWidth: 7, strokeLinecap: 'round', fill: 'none', opacity: 0.6 }),
        h('path', { d: 'M0 -46V34', stroke: '#4a79b4', strokeWidth: 2, strokeLinecap: 'round', opacity: 0.45 }),
        h('ellipse', { cx: 0, cy: -54, rx: 4.4, ry: 1.5, fill: '#3f6aa3' }),
      )
    }

    /** 翘出水面的尾鳍，配背影用。原点在尾柄入水处。 */
    function Fluke({ x = 0, y = 0, scale = 1, tilt = 0 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) rotate(${tilt}) scale(${scale})` },
        h('path', { d: 'M-7 6C-7 -8 -4 -18 0 -24C4 -18 7 -8 7 6Z', fill: '#4a79b4' }),
        h('path', { d: 'M0 -20C-8 -34 -28 -40 -42 -32C-34 -20 -16 -13 0 -14C16 -13 34 -20 42 -32C28 -40 8 -34 0 -20Z', fill: '#4a79b4' }),
        h('path', { d: 'M-30 -31C-22 -33 -12 -30 -5 -23', stroke: '#6f9bd1', strokeWidth: 2.4, strokeLinecap: 'round', fill: 'none', opacity: 0.8 }),
      )
    }

    /** 俯视：从天上往下看，头朝上。身体约 60×110。 */
    function WhaleTop({ x = 0, y = 0, scale = 1, rot = 0 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) rotate(${rot}) scale(${scale})` },
        // 尾迹和水纹
        h('path', { d: 'M-9 64Q-22 96 -42 122M9 64Q22 96 42 122', stroke: '#ffffff', strokeWidth: 2.2, fill: 'none', strokeLinecap: 'round', opacity: 0.5 }),
        h('path', { d: 'M-4 78Q-8 100 -14 118M4 78Q8 100 14 118', stroke: '#ffffff', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', opacity: 0.3 }),
        h('ellipse', { cx: 0, cy: 4, rx: 50, ry: 70, fill: 'none', stroke: '#ffffff', strokeWidth: 1.6, opacity: 0.28 }),
        h('ellipse', { cx: 0, cy: 4, rx: 66, ry: 88, fill: 'none', stroke: '#ffffff', strokeWidth: 1.2, opacity: 0.14 }),
        // 鳍和尾
        h('path', { d: 'M-25 -12C-46 -8 -56 6 -56 20C-44 17 -32 9 -26 0Z', fill: '#4a79b4' }),
        h('path', { d: 'M25 -12C46 -8 56 6 56 20C44 17 32 9 26 0Z', fill: '#4a79b4' }),
        h('path', { d: 'M0 52C-10 58 -26 58 -32 72C-20 75 -8 71 0 64C8 71 20 75 32 72C26 58 10 58 0 52Z', fill: '#4a79b4' }),
        // 身体
        h('path', { d: 'M0 -50C22 -50 31 -26 29 0C27 26 12 46 0 60C-12 46 -27 26 -29 0C-31 -26 -22 -50 0 -50Z', fill: '#5c92d1' }),
        h('path', { d: 'M0 -40C-3 -16 -3 14 0 44', stroke: '#8db8ea', strokeWidth: 6, strokeLinecap: 'round', fill: 'none', opacity: 0.55 }),
        h('circle', { cx: -19, cy: -30, r: 2.6, fill: '#1d3557' }),
        h('circle', { cx: 19, cy: -30, r: 2.6, fill: '#1d3557' }),
        h('ellipse', { cx: -23, cy: -21, rx: 3.6, ry: 2.4, fill: '#f7a6ba', opacity: 0.7 }),
        h('ellipse', { cx: 23, cy: -21, rx: 3.6, ry: 2.4, fill: '#f7a6ba', opacity: 0.7 }),
        h('ellipse', { cx: 0, cy: -24, rx: 3, ry: 1.6, fill: '#3f6aa3' }),
      )
    }

    /* ---- 构图：同一趟旅行，换着镜头拍 ---- */

    function pickShot(rng, seaId) {
      if (seaId === 'fog') return 'wide'
      const r = rng()
      if (seaId === 'paper') return r < 0.5 ? 'wide' : 'portrait'
      if (r < 0.26) return 'wide' // 远景：小小的它在风景里
      if (r < 0.5) return 'portrait' // 大脸自拍：风景在身后
      if (r < 0.68) return 'back' // 背影：它在看风景
      if (r < 0.85) return 'split' // 半水下：水面上是风景，水面下是它
      return 'top' // 俯拍：从天上看它游
    }

    /** 俯拍：整张都是海面。 */
    function TopShot({ rng, bands, seaId, focus, night }) {
      const x = 126 + rng() * 48
      const y = 92 + rng() * 14
      const rot = -55 + rng() * 110
      const floaty = () => {
        const fx = x + (rng() < 0.5 ? -1 : 1) * (78 + rng() * 26)
        const fy = 44 + rng() * 100
        if (seaId === 'code') return h('g', null, h(Star, { x: fx, y: fy, s: 1.7, rot: rng() * 40 }), h(Star, { x: fx + 16, y: fy + 20, s: 1.1, rot: rng() * 40 }))
        if (seaId === 'danmaku') return h('g', { transform: `translate(${fx} ${fy})` }, h('circle', { r: 11, fill: 'none', stroke: '#ffffff', strokeWidth: 7 }), h('circle', { r: 11, fill: 'none', stroke: '#ff7aa5', strokeWidth: 7, strokeDasharray: '8.6 8.7' }))
        if (seaId === 'hacker')
          return h(
            'g',
            { transform: `translate(${fx} ${fy}) rotate(${-30 + rng() * 60})` },
            h('path', { d: 'M0 -18C8 -8 8 8 5 16H-5C-8 8 -8 -8 0 -18Z', fill: '#7a5230' }),
            h('path', { d: 'M0 -12C4.5 -5 4.5 6 3 12H-3C-4.5 6 -4.5 -5 0 -12Z', fill: '#c99755' }),
            h('path', { d: 'M-4 0H4M-3.6 6H3.6', stroke: '#7a5230', strokeWidth: 1.4 }),
          )
        return h('g', null, ...[0, 1, 2].map((i) => h('circle', { key: i, cx: fx + i * 9 - 8, cy: fy - i * 7, r: 3 + i * 1.6, fill: 'none', stroke: '#ffffff', strokeWidth: 1.4, opacity: 0.7 })))
      }
      return h(
        'g',
        null,
        h('rect', { width: 300, height: 200, fill: bands[1] }),
        ...[0, 1, 2, 3].map((i) => h('ellipse', { key: `e${i}`, cx: rng() * 300, cy: rng() * 200, rx: 60 + rng() * 60, ry: 26 + rng() * 22, fill: i % 2 ? bands[0] : bands[2], opacity: 0.32 })),
        ...Array.from({ length: 12 }, (_, i) => {
          const rx = rng() * 290
          const ry = 10 + rng() * 180
          return h('path', { key: `r${i}`, d: `M${rx} ${ry}q9 -5 18 0`, stroke: '#ffffff', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', opacity: night ? 0.16 : 0.3 })
        }),
        floaty(),
        h(WhaleTop, { x, y, rot, scale: 0.92 }),
        seaId === 'danmaku' && focus
          ? h('text', { x: 16, y: 30, fontSize: 11, fontWeight: 700, fill: '#ffffff', opacity: 0.9, className: 'wv-scroll' }, focus)
          : null,
      )
    }

    /** 半水下：上半张是风景，下半张是水里的它。 */
    function SplitShot({ rng, bands, gid, children }) {
      const flip = rng() < 0.45
      const x = 96 + rng() * 108
      const y = 142 + rng() * 10
      const floor = mix(bands[2], '#0b1530', 0.35)
      return h(
        'g',
        null,
        h('defs', null, h('linearGradient', { id: `${gid}-deep`, x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: bands[0] }), h('stop', { offset: 0.45, stopColor: bands[1] }), h('stop', { offset: 1, stopColor: bands[2] }))),
        h('g', { transform: 'translate(0 -36)' }, children),
        h(WaveBand, { y: 92, amp: 2.6, phase: rng() * WL, fill: `url(#${gid}-deep)`, speed: 10 }),
        h('path', { d: 'M-10 93.5q11 -2.6 22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0t22 0', stroke: '#ffffff', strokeWidth: 1.6, fill: 'none', opacity: 0.55 }),
        ...[0, 1, 2].map((i) => {
          const lx = 40 + i * 96 + rng() * 30
          return h('path', { key: `l${i}`, d: `M${lx} 94L${lx + 22} 94L${lx - 16} 200L${lx - 58} 200Z`, fill: '#ffffff', opacity: 0.08, className: 'wv-glow' })
        }),
        h('path', { d: 'M0 186q44 -14 92 -6q52 -12 108 -2q54 -10 100 6V200H0z', fill: floor }),
        ...[0, 1, 2, 3].map((i) => {
          const sx = 18 + i * 84 + rng() * 30
          const hgt = 14 + rng() * 16
          return h('path', { key: `w${i}`, d: `M${sx} 192q-5 ${-hgt / 3} 0 ${(-hgt * 2) / 3}t0 ${-hgt / 3}`, stroke: mix(bands[0], '#2aa37c', 0.5), strokeWidth: 2.6, fill: 'none', strokeLinecap: 'round' })
        }),
        // 两条小鱼
        ...[0, 1].map((i) => {
          const fx = i ? x + (flip ? 1 : -1) * 78 : x + (flip ? -1 : 1) * 86
          const fy = 120 + rng() * 50
          const d = rng() < 0.5 ? 1 : -1
          return h('g', { key: `f${i}`, transform: `translate(${Math.max(16, Math.min(284, fx))} ${fy}) scale(${d} 1)` }, h('ellipse', { rx: 6, ry: 3.4, fill: i ? '#ffd27a' : '#ff9f8a' }), h('path', { d: 'M-5 0l-6 -4v8z', fill: i ? '#ffd27a' : '#ff9f8a' }), h('circle', { cx: 3, cy: -0.8, r: 0.9, fill: '#1d3557' }))
        }),
        h(Whale, { x, y, scale: 0.62, flip }),
        ...[0, 1, 2].map((i) => h('circle', { key: `b${i}`, cx: x + (flip ? -1 : 1) * (30 + i * 3), cy: y - 20 - i * 10, r: 1.8 + i * 0.8, fill: 'none', stroke: '#ffffff', strokeWidth: 1, opacity: 0.75 })),
      )
    }

    /** 论文深海的大脸：它凑到镜头前，身后漂着那一页论文。 */
    function DeepPortrait({ rng, tokens }) {
      const right = rng() < 0.5
      const x = right ? 196 : 104
      const px = right ? 62 + rng() * 30 : 208 + rng() * 30
      return h(
        'g',
        null,
        ...[0, 1, 2].map((i) => {
          const lx = 30 + i * 90 + rng() * 40
          return h('path', { key: `l${i}`, d: `M${lx} 0L${lx + 26} 0L${lx - 30 + rng() * 20} 200L${lx - 74} 200Z`, fill: '#bcd9ff', opacity: 0.07, className: 'wv-glow' })
        }),
        tokens[0] ? h('text', { x: 16, y: 24, fontSize: 9, fill: '#cfe3ff', opacity: 0.8, fontFamily: 'Georgia,serif', fontStyle: 'italic' }, tokens[0]) : null,
        h('path', { d: 'M0 184q40-16 86-8q46-14 100-4q54-12 114 6V200H0z', fill: '#06122b' }),
        h(
          'g',
          { transform: `translate(${px} ${78 + rng() * 30}) rotate(${-14 + rng() * 28})`, className: 'wv-bob' },
          h('circle', { r: 30, fill: '#fff6c9', opacity: 0.1 }),
          h('rect', { x: -14, y: -19, width: 28, height: 38, rx: 2.5, fill: '#f8f3d9', opacity: 0.95 }),
          h('path', { d: 'M-9 -11h18', stroke: '#6f6642', strokeWidth: 2 }),
          h('path', { d: 'M-9 -4h18M-9 1.5h18M-9 7h12M-9 12.5h15', stroke: '#8a7f52', strokeWidth: 1.2 }),
        ),
        ...Array.from({ length: 8 }, (_, i) => h('circle', { key: `b${i}`, cx: 16 + rng() * 270, cy: 14 + rng() * 150, r: 0.9 + rng() * 2.2, fill: 'none', stroke: '#cfe3ff', strokeWidth: 0.8, opacity: 0.6 })),
        h(WhaleFront, { x, y: 128, scale: 0.92, tilt: right ? 5 : -5, mood: rng() < 0.5 ? 'happy' : 'calm' }),
        ...[0, 1, 2].map((i) => h('circle', { key: `wb${i}`, cx: x + (right ? -1 : 1) * (50 + i * 6), cy: 74 - i * 14, r: 2.4 + i, fill: 'none', stroke: '#e3f1fc', strokeWidth: 1.1, opacity: 0.8 })),
      )
    }

    function PostcardArt({ card }) {
      const seaId = card.sea || 'fog'
      const pal = PALETTES[seaId] || PALETTES.fog
      const rng = seeded(card.id)
      const tod = timeOfDay(card.returnedAt)
      const deep = seaId === 'paper'
      const weather = pickWeather(rng, tod, seaId)
      const sky = cardSky(seaId, pal, tod)
      const tokens = tokensFrom(card).slice(0, 1)
      const posed = pickPose(rng)
      // 黑客海峡这一侧有小船，不让它跃出水面砸到船上。
      const pose = seaId === 'hacker' && posed === 'jump' ? 'spout' : posed
      const landRight = rng() < 0.5
      const light = pickLight(rng, tod, weather, seaId)
      const shot = pickShot(rng, seaId)
      const night = tod === 'night' && !deep && seaId !== 'fog'
      const tint = (c) => (night ? mix(c, '#0b1530', 0.4) : tod === 'dusk' && !deep && seaId !== 'fog' ? mix(c, '#b3563f', 0.14) : c)
      const bands = [tint(mix(pal.sea[0], '#ffffff', 0.16)), tint(mix(pal.sea[0], pal.sea[1], 0.45)), tint(pal.sea[1])]
      const gid = `wv-g-${String(card.id).slice(0, 8)}`
      const ink = night || deep ? '#ff9aa8' : '#b23a48'
      const mood = rng() < 0.45 ? 'happy' : 'calm'
      // 大脸和背影：它在景物的另一侧，景物留在画面里。
      const heroX = landRight ? 96 + rng() * 16 : 188 + rng() * 16
      const tilt = (landRight ? 1 : -1) * (3 + rng() * 5)
      const scenery = [h(SkyLayer, { key: 'sky', tod, weather, rng, light, skyTop: sky[0] }), h(SeaDecor, { key: 'decor', sea: seaId, rng, ink: pal.ink, tokens, tod, sky, landRight })]
      let scene
      if (deep) {
        scene = shot === 'portrait' ? h(DeepPortrait, { rng, tokens }) : h(DeepScene, { rng, tokens, gid })
      } else if (shot === 'top') {
        scene = h(TopShot, { rng, bands, seaId, focus: tokens[0], night })
      } else if (shot === 'split') {
        scene = h(SplitShot, { rng, bands, gid }, ...scenery)
      } else {
        const back0 = h(WaveBand, { key: 'b0', y: 127, amp: 2.2, phase: rng() * WL, fill: bands[0], speed: 11 })
        const glow = light && light.kind !== 'sun' ? h(Reflection, { key: 'refl', x: light.x, y0: 126, color: light.color, rng, opacity: light.kind === 'moon' ? 0.4 : 0.6 }) : null
        let front
        if (shot === 'portrait') {
          front = [
            h(WaveBand, { key: 'b1', y: 150, amp: 3, phase: rng() * WL, fill: bands[1], speed: 8 }),
            h(WhaleFront, { key: 'w', x: heroX, y: 136, scale: 0.98, tilt, mood: pose === 'jump' ? 'wow' : mood, spout: pose === 'spout' }),
            h(WaveBand, { key: 'b2', y: 180, amp: 3.6, phase: rng() * WL, fill: bands[2], speed: 6 }),
            h(Glints, { key: 'g', rng, y0: 184, y1: 196, n: 5, opacity: night ? 0.2 : 0.38 }),
          ]
        } else if (shot === 'back') {
          front = [
            h(WaveBand, { key: 'b1', y: 150, amp: 3, phase: rng() * WL, fill: bands[1], speed: 8 }),
            h(WhaleBack, { key: 'w', x: heroX, y: 168, scale: 0.8, tilt: tilt * 0.6, spout: pose === 'spout' }),
            h(WaveBand, { key: 'b2', y: 180, amp: 3.6, phase: rng() * WL, fill: bands[2], speed: 6 }),
            h(Fluke, { key: 'f', x: heroX + (landRight ? -8 : 8), y: 193, scale: 1.05, tilt: -tilt * 2.4 }),
            h('path', { key: 'rip', d: `M${heroX - 40} 193q13 -6 26 0M${heroX + 12} 194q13 -6 26 0`, stroke: '#ffffff', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', opacity: 0.6 }),
            h(Glints, { key: 'g', rng, y0: 134, y1: 148, n: 5, opacity: night ? 0.2 : 0.38 }),
          ]
        } else {
          front = [
            h(WhaleInScene, { key: 'w', pose, rng, side: seaId === 'hacker' ? (landRight ? 'left' : 'right') : null }),
            h(WaveBand, { key: 'b1', y: 152, amp: 3, phase: rng() * WL, fill: bands[1], speed: 8 }),
            h(WaveBand, { key: 'b2', y: 174, amp: 3.4, phase: rng() * WL, fill: bands[2], speed: 6 }),
            h(Glints, { key: 'g', rng, y0: 134, y1: 192, opacity: night ? 0.2 : 0.38 }),
          ]
        }
        scene = h('g', null, ...scenery, back0, glow, ...front, seaId === 'fog' ? h(FogLayer, { rng }) : null)
      }
      return h(
        'svg',
        { viewBox: '0 0 300 200', className: 'wv-art', role: 'img', 'aria-label': `${card.seaName} 的风景` },
        h('defs', null, h('linearGradient', { id: `${gid}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: sky[0] }), h('stop', { offset: deep ? 1 : 0.66, stopColor: sky[1] }))),
        h('rect', { width: 300, height: 200, fill: `url(#${gid}-sky)` }),
        scene,
        !deep && weather === 'rain' && shot !== 'top' ? h(RainLayer, { rng }) : null,
        // 白边
        h('rect', { x: 4.5, y: 4.5, width: 291, height: 191, rx: 3, fill: 'none', stroke: '#ffffff', strokeWidth: 1.4, opacity: 0.6 }),
        // 邮票
        h(
          'g',
          { transform: 'translate(247 12) rotate(2 20 24)' },
          h('rect', { x: 1, y: 1.5, width: 40, height: 48, fill: '#000000', opacity: 0.12 }),
          h('rect', { width: 40, height: 48, fill: '#fffaf0', stroke: '#e0c9a6', strokeDasharray: '3 2', strokeWidth: 2 }),
          h('rect', { x: 5, y: 5, width: 30, height: 30, fill: mix(pal.sea[0], '#ffffff', 0.2) }),
          h('path', { d: 'M5 26q7.5-4 15 0t10 0v9H5z', fill: pal.sea[1], opacity: 0.55 }),
          h(Whale, { x: 21.5, y: 21, scale: 0.17 }),
          h('text', { x: 20, y: 44, fontSize: 6, textAnchor: 'middle', fill: '#8a6d3b' }, '港口邮政'),
        ),
        // 邮戳：圆戳加三道波浪销票线
        h(
          'g',
          { transform: `translate(222 54) rotate(${-22 + rng() * 16})`, opacity: 0.72, stroke: ink, fill: 'none' },
          h('circle', { r: 19.5, strokeWidth: 1.5 }),
          h('circle', { r: 16.4, strokeWidth: 0.6 }),
          h('path', { d: 'M21 -8q5-4 10 0t10 0t10 0M21 0q5-4 10 0t10 0t10 0M21 8q5-4 10 0t10 0t10 0', strokeWidth: 1.1, strokeLinecap: 'round' }),
          h('text', { y: -3, fontSize: 7, textAnchor: 'middle', fill: ink, stroke: 'none', fontWeight: 700 }, card.seaName || ''),
          h('text', { y: 8, fontSize: 5.4, textAnchor: 'middle', fill: ink, stroke: 'none' }, dateStamp(card.returnedAt)),
        ),
        card.place
          ? h('text', { x: 13, y: 188, fontSize: 12, fill: '#ffffff', className: 'wv-hand', stroke: '#06203a', strokeOpacity: 0.35, strokeWidth: 2, paintOrder: 'stroke', strokeLinejoin: 'round' }, `寄自 ${card.place}`)
          : null,
      )
    }

    /* ------------------------------------------------------------ 画：港口 */

    function harborSky(hour) {
      if (hour < 5 || hour >= 20) return { tod: 'night', top: '#0d1b3e', bottom: '#30468a' }
      if (hour < 8) return { tod: 'dawn', top: '#f6a986', bottom: '#fde9d3' }
      if (hour < 17) return { tod: 'day', top: '#7cc6fb', bottom: '#e6f5ff' }
      return { tod: 'dusk', top: '#ea7a5c', bottom: '#ffd6a3' }
    }

    function Harbor({ state, now }) {
      const w = state.whale
      const sky = harborSky(new Date(now).getHours())
      const night = sky.tod === 'night'
      const rng = seeded('harbor')
      const home = w.status === 'home'
      const resting = home && !(state.settings.autoDepart && w.departAt && w.departAt - now < 5 * 60_000)
      const dim = (c) => (night ? mix(c, '#0b1530', 0.42) : sky.tod === 'dusk' ? mix(c, '#7a3b2e', 0.16) : c)
      const sea = [dim('#63aee6'), dim('#3f8fd0'), dim('#2a6fb0'), dim('#1d5a99')]
      const light = night
        ? { x: 470, y: 38, r: 15, color: '#fff3c9', low: false }
        : sky.tod === 'dawn'
          ? { x: 200, y: 142, r: 30, color: '#ffe2a8', low: true }
          : sky.tod === 'dusk'
            ? { x: 250, y: 142, r: 30, color: '#ffb46b', low: true }
            : { x: 500, y: 40, r: 17, color: '#ffe27a', low: false }
      return h(
        'svg',
        { viewBox: '0 0 600 220', className: 'wv-harbor', role: 'img', 'aria-label': home ? '大肥鱼在港口里' : '港口空着，大肥鱼出海了' },
        h('defs', null, h('linearGradient', { id: 'wv-h-sky', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: sky.top }), h('stop', { offset: 0.66, stopColor: sky.bottom }))),
        h('rect', { width: 600, height: 220, fill: 'url(#wv-h-sky)' }),
        night ? Array.from({ length: 22 }, (_, i) => h('circle', { key: i, cx: rng() * 600, cy: rng() * 110, r: 0.7 + rng() * 1.3, fill: '#fff', opacity: 0.45 + rng() * 0.5, className: i % 4 === 0 ? 'wv-blink' : '' })) : null,
        h('circle', { cx: light.x, cy: light.y, r: light.r * 2.1, fill: light.color, opacity: night ? 0.1 : 0.16 }),
        h('circle', { cx: light.x, cy: light.y, r: light.r * 1.45, fill: light.color, opacity: night ? 0.14 : 0.28 }),
        h('circle', { cx: light.x, cy: light.y, r: light.r, fill: light.color }),
        night ? h('circle', { cx: light.x + 7.5, cy: light.y - 5, r: light.r * 0.86, fill: sky.top }) : null,
        h(Cloud, { x: 150, y: 44, s: 1.5, color: night ? '#aab4d8' : sky.tod === 'dusk' ? '#ffe6d6' : '#ffffff', opacity: night ? 0.4 : 0.9 }),
        h(Cloud, { x: 372, y: 64, s: 1.05, color: night ? '#aab4d8' : sky.tod === 'dusk' ? '#ffe6d6' : '#ffffff', opacity: night ? 0.3 : 0.8 }),
        sky.tod === 'day' ? h(Birds, { x: 262, y: 70, color: '#4a6d8f', s: 1.2 }) : null,
        // 远山
        h('path', { d: 'M120 144q60-34 130-18q60-26 140-6q70-20 210 24z', fill: mix(sky.bottom, '#3c5a80', 0.36), opacity: 0.75 }),
        // 灯塔和小山
        night ? h('path', { d: 'M86 76L330 28V112Z', fill: '#fff3c4', opacity: 0.16, className: 'wv-beam' }) : null,
        h('path', { d: 'M24 146q24-32 66-28q32 3 46 28z', fill: dim('#5f8f5c') }),
        h('path', { d: 'M46 126q20-12 44-9q-24 4-34 13z', fill: dim('#86b77e'), opacity: 0.85 }),
        h(Pine, { x: 46, y: 128, s: 1.2, fill: dim('#3f7a4a') }),
        h(Pine, { x: 116, y: 131, s: 1, fill: dim('#3f7a4a') }),
        h('path', { d: 'M72 128L75 82H89L92 128Z', fill: dim('#ffffff') }),
        h('path', { d: 'M74.2 94H89.8L90.5 104H73.5Z', fill: dim('#e76f51') }),
        h('path', { d: 'M72.9 114H91.1L91.7 124H72.3Z', fill: dim('#e76f51') }),
        h('rect', { x: 71, y: 79, width: 22, height: 3.6, rx: 1, fill: dim('#34495e') }),
        h('rect', { x: 76.5, y: 68, width: 11, height: 11, fill: '#ffe9a8', className: night ? 'wv-blink' : '' }),
        h('path', { d: 'M74 68L82 59L90 68Z', fill: dim('#e76f51') }),
        // 最远一层浪
        h(WaveBand, { y: 144, amp: 2.4, fill: sea[0], width: 600, depth: 220, speed: 12 }),
        light.low || night ? h(Reflection, { x: light.x, y0: 144, color: light.color, rng, rows: 7, opacity: night ? 0.35 : 0.6 }) : null,
        !home ? h('g', { className: 'wv-far' }, h(Whale, { x: 214, y: 150, scale: 0.24, spout: 'anim' })) : null,
        h(WaveBand, { y: 158, amp: 2.8, phase: 17, fill: sea[1], width: 600, depth: 220, speed: 10 }),
        // 码头：桩子插进水里，被前面的浪盖住
        ...[0, 1, 2, 3, 4].map((i) => h('rect', { key: `p${i}`, x: 408 + i * 44, y: 134, width: 8, height: 60, rx: 1.5, fill: dim('#7a5230') })),
        h('rect', { x: 396, y: 126, width: 204, height: 10, rx: 1.5, fill: dim('#b07d47') }),
        h('rect', { x: 396, y: 133.5, width: 204, height: 2.5, fill: dim('#8a5f34') }),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => h('path', { key: `k${i}`, d: `M${420 + i * 24} 126.5v7`, stroke: dim('#8a5f34'), strokeWidth: 1 })),
        h('rect', { x: 400, y: 117, width: 7, height: 10, rx: 2, fill: dim('#5d3f25') }),
        h('rect', { x: 560, y: 92, width: 5, height: 35, fill: dim('#5d3f25') }),
        night ? h('circle', { cx: 562.5, cy: 86, r: 15, fill: '#ffe9a8', opacity: 0.18 }) : null,
        h('rect', { x: 557, y: 80.5, width: 11, height: 11.5, rx: 2, fill: night || sky.tod === 'dusk' ? '#ffe9a8' : dim('#f3ead6'), stroke: dim('#5d3f25'), strokeWidth: 1.4 }),
        h('path', { d: 'M555.5 80.5h14l-3-4.5h-8z', fill: dim('#5d3f25') }),
        // 木箱和救生圈
        h('rect', { x: 500, y: 112, width: 16, height: 14, rx: 1, fill: dim('#c99755') }),
        h('path', { d: 'M500 112l16 14M516 112l-16 14', stroke: dim('#9a6f3a'), strokeWidth: 1.2 }),
        h('circle', { cx: 536, cy: 119, r: 5.5, fill: 'none', stroke: dim('#ffffff'), strokeWidth: 3.4 }),
        h('circle', { cx: 536, cy: 119, r: 5.5, fill: 'none', stroke: dim('#e76f51'), strokeWidth: 3.4, strokeDasharray: '4.3 4.3' }),
        home
          ? h(
              'g',
              { className: 'wv-float' },
              h(Whale, { x: 318, y: 163, scale: 1, sleepy: resting, spout: resting ? null : 'anim' }),
              resting ? h('text', { x: 356, y: 122, fontSize: 17, fontWeight: 700, fill: '#ffffff', className: 'wv-zzz' }, 'z z') : null,
            )
          : h(
              'g',
              { transform: 'translate(538 96) rotate(4)' },
              h('rect', { x: 1.5, y: 2, width: 48, height: 30, rx: 2, fill: '#000000', opacity: 0.14 }),
              h('rect', { width: 48, height: 30, rx: 2, fill: '#fffaf0', stroke: '#d9c3a0' }),
              h('text', { x: 24, y: 19.5, fontSize: 10.5, fontWeight: 600, textAnchor: 'middle', fill: '#6b4f2a' }, '出海中'),
            ),
        h(WaveBand, { y: 180, amp: 3.4, phase: 9, fill: sea[2], width: 600, depth: 220, speed: 8 }),
        h(WaveBand, { y: 202, amp: 3.8, phase: 28, fill: sea[3], width: 600, depth: 220, speed: 6 }),
        h(Glints, { rng, y0: 150, y1: 214, width: 600, n: 16, opacity: night ? 0.2 : 0.36 }),
      )
    }

    /* ------------------------------------------------------------ 组件 */

    function Postcard({ card, onClose, onKeep, compact }) {
      return h(
        'article',
        { className: `wv-card${compact ? ' is-compact' : ''}` },
        h(PostcardArt, { card }),
        h(
          'div',
          { className: 'wv-back' },
          h(
            'div',
            { className: 'wv-letter' },
            h('p', { className: 'wv-hand wv-msg' }, card.message),
            h('p', { className: 'wv-sign wv-hand' }, '—— 大肥鱼'),
            h(
              'p',
              { className: 'wv-meta' },
              `${card.seaName}${card.place ? ` · ${card.place}` : ''} · ${when(card.returnedAt)} 回港`,
              card.wish ? ` · 揣着纸条「${card.wish}」` : '',
              card.plannedSea && card.sea && card.plannedSea !== card.sea
                ? ` · 本来想去${card.plannedSeaName || '另一片海'}，你这边的网络连不上那里，就改道来了${card.seaName}`
                : '',
            ),
          ),
          card.items && card.items.length
            ? h(
                'div',
                { className: 'wv-gift-box' },
                h('span', { className: 'wv-gift-label' }, card.items.length > 1 ? '这次带回来的' : '这次带回来一样东西'),
                h(
                  'ul',
                  { className: 'wv-gifts' },
                  ...card.items.map((it, i) =>
                    h(
                      'li',
                      { key: i },
                      h('a', { href: it.url, target: '_blank', rel: 'noreferrer noopener' }, it.title),
                      it.why ? h('span', { className: 'wv-why' }, it.why) : it.note ? h('span', { className: 'wv-why' }, it.note) : null,
                      it.meta ? h('span', { className: 'wv-gift-meta' }, it.meta) : null,
                    ),
                  ),
                ),
              )
            : h('p', { className: 'wv-empty' }, '这次两手空空。'),
        ),
        onKeep || onClose
          ? h(
              'div',
              { className: 'wv-card-actions' },
              onKeep ? h('button', { className: 'wv-btn is-primary', onClick: onKeep }, '收进明信片册') : null,
              onClose ? h('button', { className: 'wv-btn', onClick: onClose }, '关上') : null,
            )
          : null,
      )
    }

    function Status({ state, now }) {
      const w = state.whale
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')
      const sendOff = async () => {
        setBusy(true)
        setErr('')
        try {
          await act({ type: 'send-off' })
        } catch (e) {
          setErr(e.message)
        } finally {
          setBusy(false)
        }
      }
      if (w.settling) return h('div', { className: 'wv-status' }, h('strong', null, '它正在靠岸，翻包里的东西……'), h('span', null, '写明信片要一小会儿。'))
      if (w.status === 'away' && w.trip) {
        const t = w.trip
        const due = t.dueAt
        return h(
          'div',
          { className: 'wv-status' },
          h('strong', null, `出海去了：${t.seaName}`),
          h(
            'span',
            null,
            t.waitingTide
              ? `已经游到港外了，等谷时再靠岸（省一半钱），大约 ${when(due)}。`
              : `${when(t.departedAt)} 出的门，预计 ${when(due)} 回来，还有 ${left(due - now)}。`,
          ),
          t.followWish && t.wish ? h('span', { className: 'wv-sub' }, `揣着你的纸条：「${t.wish}」`) : null,
        )
      }
      const auto = state.settings.autoDepart && w.departAt
      return h(
        'div',
        { className: 'wv-status' },
        h('strong', null, '在港里打盹'),
        h('span', null, auto ? `大约 ${when(w.departAt)} 会自己出门（还有 ${left(w.departAt - now)}）。` : '「自己出门」关着，它会一直待在港里。'),
        h('div', { className: 'wv-row' }, h('button', { className: 'wv-btn is-primary', disabled: busy, onClick: sendOff }, busy ? '出发中…' : '现在就送它出海'), err ? h('span', { className: 'wv-err' }, err) : null),
      )
    }

    function Wish({ state }) {
      const [text, setText] = useState(state.wish || '')
      const [saved, setSaved] = useState(false)
      useEffect(() => setText(state.wish || ''), [state.wish])
      const save = async () => {
        await act({ type: 'wish', text })
        setSaved(true)
        setTimeout(() => setSaved(false), 1600)
      }
      return h(
        'section',
        { className: 'wv-section' },
        h('h3', null, '塞张纸条'),
        h('p', { className: 'wv-hint' }, '写上你想让它留意的东西，比如「Rust 游戏引擎」「多模态 agent」。它会揣着出门，但不一定照做——鲸有鲸的主意。'),
        h(
          'div',
          { className: 'wv-row' },
          h('input', {
            className: 'wv-input',
            value: text,
            maxLength: 60,
            placeholder: '留空就让它随便逛',
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
            },
          }),
          h('button', { className: 'wv-btn', onClick: save }, saved ? '塞好了' : '塞给它'),
        ),
      )
    }

    function Album({ postcards, onOpen }) {
      const kept = postcards.filter((p) => p.read)
      return h(
        'section',
        { className: 'wv-section' },
        h('h3', null, `明信片册 · ${kept.length}`),
        kept.length
          ? h(
              'div',
              { className: 'wv-album' },
              ...kept.map((p) =>
                h(
                  'button',
                  { key: p.id, className: 'wv-thumb', onClick: () => onOpen(p), title: `${p.seaName} · ${when(p.returnedAt)}` },
                  h(PostcardArt, { card: p }),
                  h('span', null, `${p.seaName} · ${dayLabel(p.returnedAt)}`),
                ),
              ),
            )
          : h('p', { className: 'wv-hint' }, '还没有收进来的明信片。它回港时会寄一张给你。'),
      )
    }

    function Chart({ seas }) {
      return h(
        'section',
        { className: 'wv-section' },
        h('h3', null, '海图'),
        h(
          'ul',
          { className: 'wv-seas' },
          ...seas.map((s) =>
            h(
              'li',
              { key: s.id, className: s.visited ? 'is-known' : '' },
              h('strong', null, s.visited || s.unreachable ? s.name : '？？？'),
              h('span', null, s.visited ? `${s.blurb} · 去过 ${s.visited} 次` : '还没去过'),
              s.unreachable ? h('span', { className: 'wv-fogged' }, '最近起雾：你的网络连不上这里，它会少来几趟') : null,
            ),
          ),
        ),
      )
    }

    function Settings({ settings }) {
      const toggle = (key) => act({ type: 'settings', [key]: !settings[key] }).catch(() => {})
      const row = (key, label, hint) =>
        h(
          'label',
          { className: 'wv-toggle', key },
          h('input', { type: 'checkbox', checked: Boolean(settings[key]), onChange: () => toggle(key) }),
          h('span', null, h('strong', null, label), h('small', null, hint)),
        )
      return h(
        'section',
        { className: 'wv-section' },
        h('h3', null, '设置'),
        row('autoDepart', '自己出门', '歇够了会自己出海；关掉就只在你送它时出门。'),
        row('offPeakOnly', '谷时靠岸', '回港要用模型写明信片，赶上 DeepSeek 高峰（工作日 9–12、14–18 点）就在港外等到谷时，省一半钱。'),
        row('fastMode', '快速模式', '试玩用：航程和休息都缩短到 1–2 分钟。'),
      )
    }

    function WhaleVoyagePage() {
      const s = useStore()
      const now = useNow(1000)
      const [open, setOpen] = useState(null)
      const rootRef = useRef(null)
      const [dark, setDark] = useState(false)
      useEffect(() => {
        const el = rootRef.current
        if (!el) return
        const probe = getComputedStyle(el.parentElement || document.body).backgroundColor
        const m = probe && probe.match(/\d+(\.\d+)?/g)
        if (m && m.length >= 3) setDark((0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255 < 0.45 && (m[3] === undefined || Number(m[3]) > 0))
      }, [])
      useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => e.key === 'Escape' && setOpen(null)
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      const state = s.state
      const unread = state ? state.postcards.filter((p) => !p.read) : []
      const fresh = unread[0]

      return h(
        'div',
        { className: `wv-root${dark ? ' is-dark' : ''}`, ref: rootRef },
        h(StyleTag),
        !state
          ? h('div', { className: 'wv-loading' }, s.error ? `港口连不上：${s.error}` : '正在去港口……')
          : h(
              'div',
              { className: 'wv-page' },
              h('header', { className: 'wv-head' }, h('h2', null, '大肥鱼的港口'), state.peak ? h('span', { className: 'wv-chip' }, '现在是高峰时段') : h('span', { className: 'wv-chip is-ok' }, '现在是谷时')),
              h(Harbor, { state, now: now - (state.clientSkew || 0) }),
              h(Status, { state, now: now - (state.clientSkew || 0) }),
              fresh
                ? h(
                    'section',
                    { className: 'wv-section wv-fresh' },
                    h('h3', null, unread.length > 1 ? `它寄回来 ${unread.length} 张明信片` : '它寄回来一张明信片'),
                    h(Postcard, { card: fresh, onKeep: () => act({ type: 'read', id: fresh.id }).catch(() => {}) }),
                  )
                : null,
              h(Wish, { state }),
              h(Album, { postcards: state.postcards, onOpen: setOpen }),
              h(Chart, { seas: state.seas }),
              h(Settings, { settings: state.settings }),
              h('p', { className: 'wv-foot' }, '航程在 DSH 开着的时候走；关掉 DSH 期间到点的航程，下次打开时补寄。取材来自 GitHub、arXiv、B 站、Hacker News、V2EX 的公开页面。'),
            ),
        open
          ? h(
              'div',
              { className: 'wv-overlay', onClick: (e) => e.target === e.currentTarget && setOpen(null) },
              h(Postcard, { card: open, onClose: () => setOpen(null) }),
            )
          : null,
      )
    }

    function WhaleIcon(props) {
      const s = useStore()
      const size = props && typeof props.size === 'number' ? props.size : 20
      const dot = s.state && (s.state.unread > 0 || s.state.whale.settling)
      return h(
        'span',
        { style: { position: 'relative', display: 'inline-block', width: size, height: size } },
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' } },
          h('path', { d: 'M4 14c0-3.4 3.4-5.8 8-5.8 4.4 0 8 2.4 8 5.6 0 2.6-2.8 4.2-7.4 4.2C7.6 18 4 16.6 4 14z' }),
          h('path', { d: 'M4 13.6 2 11m2 2.6L2 16.4' }),
          h('circle', { cx: 15.6, cy: 12.6, r: 0.6, fill: 'currentColor' }),
          h('path', { d: 'M12 8.2V5.4m0 0c-.6-1-1.6-1.4-2.6-1.4M12 5.4c.6-1 1.6-1.4 2.6-1.4' }),
        ),
        dot ? h('span', { style: { position: 'absolute', right: -2, top: -2, width: 7, height: 7, borderRadius: 4, background: '#ff7a3d', boxShadow: '0 0 0 2px var(--background, #fff)' } }) : null,
      )
    }

    /* ------------------------------------------------------------ 样式 */

    const CSS = `
.wv-root{position:relative;height:100%;overflow:auto;--wv-bg:#f7f2e8;--wv-ink:#2b2a28;--wv-sub:#6d6a63;--wv-line:#e3d9c6;--wv-card:#fffdf8;--wv-accent:#2f6fb0;
  background:var(--wv-bg);color:var(--wv-ink);font-family:"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",system-ui,sans-serif}
.wv-root.is-dark{--wv-bg:#15181d;--wv-ink:#ece7dd;--wv-sub:#a39d92;--wv-line:#2d323a;--wv-card:#1d2128;--wv-accent:#7db4ec}
.wv-page{max-width:760px;margin:0 auto;padding:20px 20px 48px;display:flex;flex-direction:column;gap:18px}
.wv-loading{padding:48px;text-align:center;color:var(--wv-sub)}
.wv-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.wv-head h2{margin:0;font-size:20px;font-weight:700}
.wv-chip{font-size:12px;padding:3px 10px;border-radius:999px;background:rgba(231,111,81,.14);color:#c4552f}
.wv-chip.is-ok{background:rgba(42,157,143,.14);color:#1f7a6f}
.wv-harbor{width:100%;height:auto;border-radius:16px;display:block;box-shadow:0 6px 20px rgba(0,0,0,.08)}
.wv-status{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border-radius:14px;background:var(--wv-card);border:1px solid var(--wv-line)}
.wv-status strong{font-size:16px}
.wv-status span{color:var(--wv-sub);font-size:14px;line-height:1.6}
.wv-sub{font-size:13px}
.wv-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}
.wv-section{display:flex;flex-direction:column;gap:10px}
.wv-section h3{margin:0;font-size:15px;font-weight:700}
.wv-hint{margin:0;color:var(--wv-sub);font-size:13px;line-height:1.6}
.wv-btn{appearance:none;border:1px solid var(--wv-line);background:var(--wv-card);color:var(--wv-ink);font:inherit;font-size:14px;padding:7px 14px;border-radius:10px;cursor:pointer}
.wv-btn:hover{border-color:var(--wv-accent)}
.wv-btn.is-primary{background:var(--wv-accent);border-color:var(--wv-accent);color:#fff;font-weight:600}
.wv-btn:disabled{opacity:.6;cursor:default}
.wv-btn:focus-visible,.wv-thumb:focus-visible,.wv-input:focus-visible{outline:2px solid var(--wv-accent);outline-offset:2px}
.wv-err{color:#c4552f;font-size:13px}
.wv-input{flex:1;min-width:180px;font:inherit;font-size:14px;padding:8px 12px;border-radius:10px;border:1px solid var(--wv-line);background:var(--wv-card);color:var(--wv-ink)}
.wv-fresh .wv-card{max-width:620px;width:100%;align-self:center}
.wv-card{background:#fffdf6;color:#2b2a28;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.14);border:1px solid #eadfca;animation:wv-in 500ms cubic-bezier(.2,.8,.2,1) both}
.wv-art{display:block;width:100%;height:auto}
.wv-back{display:grid;grid-template-columns:1.1fr 1fr;gap:18px;padding:16px 18px;background:repeating-linear-gradient(0deg,transparent 0 27px,rgba(160,130,90,.12) 27px 28px)}
.wv-letter{display:flex;flex-direction:column;gap:6px}
.wv-hand{font-family:"Kaiti SC","STKaiti","KaiTi","BiauKai",serif}
.wv-msg{margin:0;font-size:17px;line-height:1.75}
.wv-sign{margin:0;text-align:right;font-size:15px;color:#5a4a33}
.wv-meta{margin:4px 0 0;font-size:12px;color:#8a7a62;line-height:1.6}
.wv-gift-box{display:flex;flex-direction:column;gap:8px;align-self:start;padding:12px 14px;border-radius:12px;background:#fff;border:1px solid #eadfca}
.wv-gift-label{align-self:flex-start;font-size:11px;font-weight:700;color:#8a6d3b;background:#fff1cf;border-radius:999px;padding:2px 9px}
.wv-gifts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.wv-gifts li{display:flex;flex-direction:column;gap:3px}
.wv-gifts a{color:#1f5f9e;font-weight:600;font-size:14px;text-decoration:none;word-break:break-word}
.wv-gifts a:hover{text-decoration:underline}
.wv-why{font-size:13px;color:#4b4335;line-height:1.5}
.wv-gift-meta{font-size:12px;color:#998a70}
.wv-empty{margin:0;color:#8a7a62;font-size:14px;align-self:center}
.wv-card-actions{display:flex;gap:10px;justify-content:flex-end;padding:0 18px 16px}
.wv-card .wv-btn{background:#fff;color:#2b2a28;border-color:#e3d9c6}
.wv-card .wv-btn.is-primary{background:#2f6fb0;border-color:#2f6fb0;color:#fff}
.wv-album{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.wv-thumb{appearance:none;border:1px solid var(--wv-line);background:var(--wv-card);border-radius:10px;padding:0;overflow:hidden;cursor:pointer;text-align:left;color:var(--wv-ink);font:inherit;transition:transform 160ms}
.wv-thumb:hover{transform:translateY(-2px) rotate(-.6deg)}
.wv-thumb span{display:block;padding:6px 8px;font-size:12px;color:var(--wv-sub)}
.wv-seas{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.wv-seas li{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;border:1px dashed var(--wv-line);color:var(--wv-sub)}
.wv-seas li.is-known{border-style:solid;background:var(--wv-card);color:var(--wv-ink)}
.wv-seas strong{font-size:14px}
.wv-seas span{font-size:12px;color:var(--wv-sub)}
.wv-seas .wv-fogged{color:#b07a2a}
.wv-toggle{display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer}
.wv-toggle input{margin-top:3px}
.wv-toggle span{display:flex;flex-direction:column;gap:2px}
.wv-toggle strong{font-size:14px;font-weight:600}
.wv-toggle small{font-size:12px;color:var(--wv-sub);line-height:1.5}
.wv-foot{margin:8px 0 0;font-size:12px;color:var(--wv-sub);line-height:1.6}
.wv-overlay{position:fixed;inset:0;background:rgba(10,16,28,.55);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto;z-index:1000}
.wv-overlay .wv-card{max-width:680px;width:100%}
.wv-wave{animation:wv-wave 8s linear infinite}
.wv-float{animation:wv-float 4s ease-in-out infinite}
.wv-zzz{animation:wv-zzz 3s ease-in-out infinite}
.wv-spout{animation:wv-spout 2.6s ease-in-out infinite;transform-box:fill-box;transform-origin:bottom}
.wv-far{animation:wv-far 6s ease-in-out infinite}
.wv-blink{animation:wv-blink 2.4s ease-in-out infinite}
.wv-glow{animation:wv-blink 3.2s ease-in-out infinite}
.wv-bob{animation:wv-float 3s ease-in-out infinite}
.wv-scroll{animation:wv-scroll 9s linear infinite}
.wv-beam{animation:wv-blink 3s ease-in-out infinite}
@keyframes wv-in{from{opacity:0;transform:translateY(16px) rotate(-1deg)}to{opacity:1;transform:none}}
@keyframes wv-wave{from{transform:translateX(0)}to{transform:translateX(-44px)}}
@keyframes wv-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes wv-zzz{0%,100%{opacity:.2;transform:translateY(4px)}50%{opacity:.9;transform:translateY(-4px)}}
@keyframes wv-spout{0%,60%,100%{opacity:0;transform:scaleY(.3)}75%{opacity:1;transform:scaleY(1)}}
@keyframes wv-far{0%,100%{transform:translateX(0)}50%{transform:translateX(-18px)}}
@keyframes wv-blink{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes wv-scroll{from{transform:translateX(320px)}to{transform:translateX(-120px)}}
@media (max-width:600px){.wv-page{padding:14px 16px 40px}.wv-back{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.wv-root *{animation:none!important;transition:none!important}}
`

    function StyleTag() {
      useEffect(() => {
        // 热重载后同 id 的旧样式还在，所以每次都覆盖内容，而不是见到就跳过。
        let el = document.getElementById(STYLE_ID)
        if (!el) {
          el = document.createElement('style')
          el.id = STYLE_ID
          document.head.appendChild(el)
        }
        if (el.textContent !== CSS) el.textContent = CSS
      }, [])
      return null
    }

    /* ------------------------------------------------------------ 注册 */

    function apply(ctx) {
      const slots = typeof ctx.get === 'function' ? ctx.get('slots') : ctx.slots
      if (!slots) {
        console.warn('[dsh-whale-voyage] slots 服务不可用，跳过注册')
        return
      }
      slots.inject('sidebar.panellist', () =>
        slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 22, label: () => '出海' }, WhaleIcon),
      )
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, WhaleVoyagePage))
    }

    return { inject: ['slots'], apply, WhaleVoyagePage, PostcardArt, Harbor }
  },
})
