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

    function Spout({ x = 0, y = 0, scale = 1, still = false, cute = false }) {
      const water = cute ? '#8fd0f5' : '#d6eeff'
      const drop = cute ? { fill: '#b9e4fb', stroke: INK, strokeWidth: 1.1 } : { fill: water }
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${scale})`, className: still ? '' : 'wv-spout' },
        h('path', { d: 'M0 0C-1 -8 -6 -13 -13 -13M0 0C1 -8 6 -13 13 -13', stroke: water, strokeWidth: cute ? 3.6 : 3.2, fill: 'none', strokeLinecap: 'round' }),
        h('circle', { cx: -15.5, cy: -9, r: cute ? 2.4 : 1.8, ...drop }),
        h('circle', { cx: 15.5, cy: -9, r: cute ? 2.4 : 1.8, ...drop }),
        cute
          ? h('path', { transform: 'translate(0 -21) scale(1.5)', d: 'M0 3C-6 -1 -3.5 -5.5 0 -2.5C3.5 -5.5 6 -1 0 3Z', fill: '#ff8fb0', stroke: INK, strokeWidth: 0.8, strokeLinejoin: 'round' })
          : h('circle', { cx: 0, cy: -17, r: 2, fill: water }),
      )
    }

    /** 明信片上大肥鱼戴的小东西，每片海一样。 */
    function WhaleHat({ hat }) {
      const ol = { stroke: INK, strokeWidth: 1.9, strokeLinejoin: 'round', strokeLinecap: 'round' }
      if (hat === 'sailor') {
        return h(
          'g',
          { transform: 'translate(15 -29) rotate(10)' },
          h('path', { d: 'M-12 1q-1-14 12-14t12 14z', fill: '#ffffff', ...ol }),
          h('path', { d: 'M-13.5 1h27v-4.5h-27z', fill: '#4f86e0', ...ol }),
          h('circle', { cx: 0, cy: -8, r: 2, fill: '#ffcf5a', stroke: INK, strokeWidth: 1 }),
        )
      }
      if (hat === 'straw') {
        return h(
          'g',
          { transform: 'translate(14 -28) rotate(10)' },
          h('ellipse', { cx: 0, cy: 1, rx: 19, ry: 4.6, fill: '#ffd774', ...ol }),
          h('path', { d: 'M-10 0q0-12 10-12t10 12z', fill: '#ffe49a', ...ol }),
          h('path', { d: 'M-10 -0.5h20v-3.6h-20z', fill: '#ff7aa5', stroke: INK, strokeWidth: 1.2, strokeLinejoin: 'round' }),
        )
      }
      if (hat === 'glasses') {
        return h(
          'g',
          null,
          h('path', { d: 'M17.6 -7.5L-4 -11M32.4 -5.6L46 -8.5', stroke: INK, strokeWidth: 1.7, strokeLinecap: 'round', fill: 'none' }),
          h('circle', { cx: 25, cy: -5, r: 7.6, fill: '#ffffff', fillOpacity: 0.28, stroke: INK, strokeWidth: 1.9 }),
        )
      }
      if (hat === 'flower') {
        return h(
          'g',
          { transform: 'translate(-6 -32)' },
          ...[0, 72, 144, 216, 288].map((a) => h('circle', { key: a, cx: Math.sin((a * Math.PI) / 180) * 4.6, cy: -Math.cos((a * Math.PI) / 180) * 4.6, r: 3.6, fill: '#ffb3cf', stroke: INK, strokeWidth: 1.2 })),
          h('circle', { r: 3, fill: '#ffd95a', stroke: INK, strokeWidth: 1.2 }),
        )
      }
      if (hat === 'star') {
        return h('path', {
          transform: 'translate(-10 -33) rotate(-12) scale(1.7)',
          d: 'M0 -5L1.5 -1.6L5 -1.5L2.3 0.8L3.1 4.5L0 2.5L-3.1 4.5L-2.3 0.8L-5 -1.5L-1.5 -1.6Z',
          fill: '#ffd95a',
          stroke: INK,
          strokeWidth: 1.1,
          strokeLinejoin: 'round',
        })
      }
      return null
    }

    /**
     * 朝右的大肥鱼，原点在身体中心；身体约 100×63，尾巴向左翘到 x=-88。
     * cute：明信片用的插画画法——描边、大眼睛、表情（mood: calm / happy / wow）和小配饰（hat）。
     */
    function Whale({ x = 0, y = 0, scale = 1, flip = false, sleepy = false, spout = null, className = '', cute = false, mood = 'calm', hat = null }) {
      const t = `translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`
      const ol = cute ? { stroke: INK, strokeWidth: 2.3, strokeLinejoin: 'round', strokeLinecap: 'round' } : {}
      const TAIL = 'M-44 -6C-54 -8 -58 -16 -60 -24C-62 -32 -70 -38 -80 -38C-78 -30 -74 -24 -68 -20C-76 -20 -84 -16 -88 -8C-78 -6 -68 -8 -60 -12C-58 -2 -54 6 -44 10Z'
      const BODY = 'M48 0C48 -20 28 -32 2 -32C-22 -32 -40 -22 -50 -6C-52 0 -50 6 -46 10C-36 24 -18 31 4 31C30 31 48 20 48 0Z'
      const face = cute ? '#2b2947' : '#1d3557'
      let eyes
      if (sleepy) eyes = h('path', { d: 'M20 -5q5 4 10 0', stroke: face, strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' })
      else if (cute && mood === 'happy') eyes = h('path', { d: 'M19.5 -3q5.2-7 10.4 0', stroke: face, strokeWidth: 2.7, fill: 'none', strokeLinecap: 'round' })
      else if (cute) eyes = h('g', null, h('circle', { cx: 25, cy: -5, r: 5, fill: face }), h('circle', { cx: 26.8, cy: -7, r: 1.8, fill: '#ffffff' }), h('circle', { cx: 23.2, cy: -2.8, r: 0.9, fill: '#ffffff' }))
      else eyes = h('g', null, h('circle', { cx: 25, cy: -5, r: 4, fill: face }), h('circle', { cx: 26.3, cy: -6.4, r: 1.3, fill: '#ffffff' }))
      return h(
        'g',
        { transform: t, className },
        spout ? h(Spout, { x: 6, y: -33, still: spout === 'still', cute }) : null,
        h('path', { d: TAIL, fill: '#4a79b4', ...ol }),
        h('path', { d: BODY, fill: cute ? '#6a9fe0' : '#5c92d1' }),
        h('path', { d: 'M-28 -20C-14 -29 10 -30 26 -22', stroke: cute ? '#a9cbf5' : '#8db8ea', strokeWidth: 5, strokeLinecap: 'round', fill: 'none', opacity: 0.7 }),
        h('path', { d: 'M-44 8C-30 18 -4 21 18 17C32 14 42 8 47 4C46 20 29 31 4 31C-18 31 -36 24 -46 10Z', fill: cute ? '#f3f9ff' : '#e3f1fc' }),
        h('path', { d: 'M-22 21C-10 25 6 26 20 23M-12 26.5C-2 29 10 29 20 27', stroke: '#b9d6ee', strokeWidth: 1.3, strokeLinecap: 'round', fill: 'none' }),
        cute ? h('path', { d: BODY, fill: 'none', ...ol }) : null,
        h('path', { d: 'M-4 12C-8 22 -4 30 6 34C8 28 8 20 6 13Z', fill: '#4a79b4', ...ol }),
        eyes,
        cute ? h('ellipse', { cx: 28.5, cy: 6.5, rx: 6, ry: 3.6, fill: '#ff9fb8', opacity: 0.9 }) : h('ellipse', { cx: 29, cy: 5, rx: 5, ry: 3, fill: '#f7a6ba', opacity: 0.85 }),
        cute && mood !== 'calm'
          ? h('path', { d: 'M36 1.4h8.4q-4.2 7.6-8.4 0z', fill: '#ff7d9c', stroke: INK, strokeWidth: 1.5, strokeLinejoin: 'round' })
          : h('path', { d: 'M37 2q3.6 3.4 7.2 0', stroke: face, strokeWidth: cute ? 2 : 1.8, fill: 'none', strokeLinecap: 'round' }),
        h('ellipse', { cx: 6, cy: -31, rx: 3, ry: 1, fill: '#3f6aa3' }),
        cute && hat ? h(WhaleHat, { hat }) : null,
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

    /* ------------------------------------------------------------ 画：海域明信片正面（可爱插画风） */

    /*
     * 画法：大肥鱼是主角，画得大、带描边和表情；每张只围绕它带回的那一样东西，别的尽量少。
     * - 每片海一个主景物（小岛上的一间房子 / 沙滩伞 / 礁石上的海鸥 / 灯塔 / 一页发光的论文）和一件小配饰；
     * - 带回的那样东西变成画里的一个词：房子的门牌、一条弹幕、一个对话气泡、论文的标题；
     * - 回港时刻定天色，天气和姿势每张随机。
     */

    const INK = '#3f3a63'
    const OL = { stroke: INK, strokeWidth: 1.7, strokeLinejoin: 'round', strokeLinecap: 'round' }

    const CUTE = {
      code: { sky: ['#bff0e0', '#f1fcf6'], sea: ['#93e2d2', '#5fcab9', '#36ab9b'], hat: 'star' },
      danmaku: { sky: ['#ffd0e4', '#fff4f9'], sea: ['#a3e5ff', '#6accf5', '#3cabe1'], hat: 'straw' },
      chat: { sky: ['#dcd0ff', '#f7f2ff'], sea: ['#c4b7f8', '#a090ec', '#7f6dd9'], hat: 'flower' },
      hacker: { sky: ['#ffd2a6', '#fff1df'], sea: ['#a5c6ed', '#769ed6', '#517dbb'], hat: 'sailor' },
      paper: { sky: ['#5580d6', '#27459a'], sea: ['#5580d6', '#27459a', '#1c3478'], hat: 'glasses' },
      fog: { sky: ['#d7dde6', '#f2f4f7'], sea: ['#c8d0da', '#a8b2bf', '#8a95a5'], hat: null },
    }

    const CUTE_SKIES = {
      dawn: ['#ffcdb8', '#fff5ec'],
      dusk: ['#ffad94', '#ffe4bd'],
      night: ['#2a2960', '#4d4c96'],
    }

    function timeOfDay(t) {
      const hr = new Date(t).getHours()
      if (hr >= 5 && hr < 8) return 'dawn'
      if (hr >= 8 && hr < 17) return 'day'
      if (hr >= 17 && hr < 20) return 'dusk'
      return 'night'
    }

    /** 带回的那样东西，变成画里的一个词。 */
    function focusWord(card) {
      const it = (card.items || [])[0]
      if (!it) return ''
      const short = (s, n) => {
        const t = String(s || '').replace(/[【】\[\]（）()「」《》|]/g, ' ').replace(/\s+/g, ' ').trim()
        return t.length > n ? t.slice(0, n) : t
      }
      if (card.sea === 'code') {
        const ABBR = { TypeScript: 'TS', JavaScript: 'JS', 'Jupyter Notebook': 'Jupyter' }
        const lang = String(it.meta || '').split('·')[1]
        const name = lang && lang.trim() ? lang.trim() : String(it.title || '').split('/').pop()
        return short(ABBR[name] || name, 7)
      }
      if (card.sea === 'danmaku') return short(it.title, 8)
      if (card.sea === 'chat') return short(it.title, 5)
      if (card.sea === 'paper') return short(it.title, 22)
      return ''
    }

    function pickWeather(rng, tod) {
      const r = rng()
      if (r < 0.5) return 'clear'
      if (r < 0.72) return 'clouds'
      if (r < 0.86) return 'rain'
      return tod === 'night' ? 'clouds' : 'rainbow'
    }

    function pickPose(rng) {
      const r = rng()
      if (r < 0.34) return 'swim'
      if (r < 0.6) return 'spout'
      if (r < 0.82) return 'jump'
      return 'peek'
    }

    const SPARKLE = 'M0 -5Q0.7 -0.7 5 0Q0.7 0.7 0 5Q-0.7 0.7 -5 0Q-0.7 -0.7 0 -5Z'
    const HEART = 'M0 3C-6 -1 -3.5 -5.5 0 -2.5C3.5 -5.5 6 -1 0 3Z'

    /** 扇贝边的浪：一排小圆拱，顶上一道白沫。 */
    function ScallopBand({ y, fill, phase = 0, speed = 0 }) {
      let top = `M${-WL - phase} ${y}`
      for (let x = -WL - phase; x < 300 + WL * 2; x += 22) top += 'a11 5.5 0 0 1 22 0'
      return h(
        'g',
        { className: speed ? 'wv-wave' : '', style: speed ? { animationDuration: `${speed}s` } : undefined },
        h('path', { d: `${top}V200H${-WL * 2}Z`, fill }),
        h('path', { d: top, fill: 'none', stroke: '#ffffff', strokeWidth: 1.7, strokeLinecap: 'round', opacity: 0.92 }),
      )
    }

    function SunFace({ x, y }) {
      return h(
        'g',
        { transform: `translate(${x} ${y})` },
        ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => h('path', { key: a, transform: `rotate(${a})`, d: 'M0 -18.5V-22.5', stroke: '#ffc93c', strokeWidth: 2.6, strokeLinecap: 'round' })),
        h('circle', { r: 14, fill: '#ffd95a', ...OL }),
        h('circle', { cx: -4.6, cy: -1.5, r: 1.4, fill: INK }),
        h('circle', { cx: 4.6, cy: -1.5, r: 1.4, fill: INK }),
        h('path', { d: 'M-3 3q3 3.2 6 0', stroke: INK, strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }),
        h('ellipse', { cx: -8.6, cy: 3, rx: 2.6, ry: 1.7, fill: '#ff9f7a', opacity: 0.85 }),
        h('ellipse', { cx: 8.6, cy: 3, rx: 2.6, ry: 1.7, fill: '#ff9f7a', opacity: 0.85 }),
      )
    }

    function MoonFace({ x, y }) {
      return h(
        'g',
        { transform: `translate(${x} ${y})` },
        h('circle', { r: 21, fill: '#fff1b8', opacity: 0.14 }),
        h('path', { d: 'M5 -14A14 14 0 1 0 14 5A11 11 0 0 1 5 -14Z', fill: '#fff1b8', ...OL }),
        h('path', { d: 'M-8 -1q2.2 2.2 4.4 0', stroke: INK, strokeWidth: 1.4, fill: 'none', strokeLinecap: 'round' }),
        h('path', { d: 'M-6.5 4.5q1.6 1.6 3.2 0', stroke: INK, strokeWidth: 1.3, fill: 'none', strokeLinecap: 'round' }),
        h('ellipse', { cx: -10, cy: 3, rx: 2.2, ry: 1.4, fill: '#ffb38a', opacity: 0.8 }),
        h('text', { x: 15, y: -9, fontSize: 8, fontWeight: 700, fill: '#fff1b8' }, 'z'),
        h('text', { x: 21, y: -15, fontSize: 6, fontWeight: 700, fill: '#fff1b8' }, 'z'),
      )
    }

    function CuteCloud({ x, y, s = 1, face = false, fill = '#ffffff', sleepy = false }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${s})` },
        h('path', { d: 'M-22 6a8 8 0 0 1 2-15.5a12 12 0 0 1 22-4a9 9 0 0 1 15 6a7 7 0 0 1 1 13.5z', fill, ...OL, strokeWidth: 1.7 / s }),
        face
          ? h(
              'g',
              null,
              sleepy
                ? h('path', { d: 'M-8 -3q1.8 1.8 3.6 0M3 -3q1.8 1.8 3.6 0', stroke: INK, strokeWidth: 1.3 / s, fill: 'none', strokeLinecap: 'round' })
                : h('g', null, h('circle', { cx: -6, cy: -3, r: 1.2, fill: INK }), h('circle', { cx: 5, cy: -3, r: 1.2, fill: INK })),
              h('path', { d: 'M-2.4 0q1.9 2 3.8 0', stroke: INK, strokeWidth: 1.2 / s, fill: 'none', strokeLinecap: 'round' }),
              h('ellipse', { cx: -10, cy: 0.5, rx: 2.2, ry: 1.4, fill: '#ffb3c7', opacity: 0.9 }),
              h('ellipse', { cx: 9, cy: 0.5, rx: 2.2, ry: 1.4, fill: '#ffb3c7', opacity: 0.9 }),
            )
          : null,
      )
    }

    function SmileStar({ x, y, s = 1, rot = 0 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) rotate(${rot}) scale(${s})` },
        h('path', { d: 'M0 -11L3.3 -3.6L11 -3.3L5 1.7L6.8 9.9L0 5.6L-6.8 9.9L-5 1.7L-11 -3.3L-3.3 -3.6Z', fill: '#ffd95a', ...OL, strokeWidth: 1.7 / s }),
        h('circle', { cx: -2.4, cy: -0.6, r: 0.95, fill: INK }),
        h('circle', { cx: 2.4, cy: -0.6, r: 0.95, fill: INK }),
        h('path', { d: 'M-1.5 1.8q1.5 1.6 3 0', stroke: INK, strokeWidth: 1 / s, fill: 'none', strokeLinecap: 'round' }),
      )
    }

    function RoundTree({ x, y, s = 1 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${s})` },
        h('path', { d: 'M0 0V-8', stroke: '#9a6b42', strokeWidth: 2.6, strokeLinecap: 'round' }),
        h('circle', { cx: 0, cy: -13, r: 7.5, fill: '#6fcf8a', ...OL }),
        h('path', { d: 'M-3.5 -15.5q2-2.4 5-2', stroke: '#b4ecc2', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' }),
      )
    }

    function CuteHouse({ x, y, label, lit }) {
      return h(
        'g',
        { transform: `translate(${x} ${y})` },
        h('rect', { x: 0, y: 0, width: 34, height: 24, rx: 3.5, fill: '#fff6e3', ...OL }),
        h('path', { d: 'M-4.5 2L17 -15L38.5 2Z', fill: '#ff8e7a', ...OL }),
        h('rect', { x: 4, y: 6, width: 26, height: 12, rx: 3, fill: lit ? '#ffe9a8' : '#ffffff', stroke: INK, strokeWidth: 1.2 }),
        h('text', { x: 17, y: label.length > 4 ? 14.6 : 15.2, fontSize: label.length > 4 ? 6.6 : 8.4, textAnchor: 'middle', fill: INK, fontWeight: 700, fontFamily: 'ui-monospace,Menlo,monospace' }, label),
        h('path', { transform: 'translate(27 -13) scale(0.9)', d: HEART, fill: '#ff8fb0' }),
      )
    }

    function Seagull({ x, y }) {
      return h(
        'g',
        { transform: `translate(${x} ${y})` },
        h('path', { d: 'M-3 6v5M2 6v5', stroke: '#ff9f43', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('ellipse', { cx: 0, cy: 0, rx: 9, ry: 6.5, fill: '#ffffff', ...OL }),
        h('circle', { cx: 7, cy: -6.5, r: 4.8, fill: '#ffffff', ...OL }),
        h('path', { d: 'M11.4 -7l5 1.4l-5 1.6z', fill: '#ff9f43', stroke: INK, strokeWidth: 1.1, strokeLinejoin: 'round' }),
        h('circle', { cx: 8.2, cy: -7.2, r: 0.95, fill: INK }),
        h('path', { d: 'M-6 -1q4 5 9 0', stroke: INK, strokeWidth: 1.4, fill: '#dfe6f2', strokeLinecap: 'round' }),
      )
    }

    function PaperBoat({ x, y }) {
      return h(
        'g',
        { transform: `translate(${x} ${y})` },
        h('path', { d: 'M0 -2V-19L11 -5Z', fill: '#ffb37a', ...OL }),
        h('path', { d: 'M-2 -3V-14L-9 -4Z', fill: '#fff6e3', ...OL }),
        h('path', { d: 'M-13 -2H13L8 6H-8Z', fill: '#ffffff', ...OL }),
      )
    }

    /** 每片海的主景物，画在大肥鱼的一侧。dx 把右侧的画法平移到左侧。 */
    function SideProp({ sea, side, focus, tod }) {
      const dx = side === 'right' ? 0 : -190
      const lit = tod === 'night' || tod === 'dusk'
      if (sea === 'code') {
        return h(
          'g',
          { transform: `translate(${dx} 0)` },
          h('path', { d: 'M202 126q46-50 96 0z', fill: '#8fdc9f', ...OL }),
          h('path', { d: 'M226 104q20-13 42-8', stroke: '#c0f0c9', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' }),
          h(RoundTree, { x: 222, y: 112, s: 0.95 }),
          h(RoundTree, { x: 284, y: 114, s: 0.8 }),
          h(CuteHouse, { x: 234, y: 84, label: focus || '{ }', lit }),
        )
      }
      if (sea === 'danmaku') {
        return h(
          'g',
          { transform: `translate(${dx} 0)` },
          h('path', { d: 'M200 126q48-24 100-10v10z', fill: '#ffe7bd', ...OL }),
          h('path', { d: 'M250 118V88', stroke: '#9a6b42', strokeWidth: 2.2, strokeLinecap: 'round' }),
          h('path', { d: 'M229 91a21 17 0 0 1 42 0z', fill: '#ff8fb5', ...OL }),
          h('path', { d: 'M243 91a21 17 0 0 1 7-16.4a21 17 0 0 1 7 16.4z', fill: '#ffffff', ...OL }),
          h('circle', { cx: 250, cy: 73.5, r: 1.8, fill: '#ff8fb5', stroke: INK, strokeWidth: 1 }),
          h('path', { transform: 'translate(278 116) rotate(16) scale(0.62)', d: 'M0 -11L3.3 -3.6L11 -3.3L5 1.7L6.8 9.9L0 5.6L-6.8 9.9L-5 1.7L-11 -3.3L-3.3 -3.6Z', fill: '#ffab73', stroke: INK, strokeWidth: 2, strokeLinejoin: 'round' }),
        )
      }
      if (sea === 'chat') {
        return h(
          'g',
          { transform: `translate(${dx} 0)` },
          h('path', { d: 'M212 126q8-32 42-30q32 2 42 30z', fill: '#b3a6e6', ...OL }),
          h('path', { d: 'M232 106q12-7 26-5', stroke: '#d6cdf7', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' }),
          h(Seagull, { x: 252, y: 84 }),
        )
      }
      if (sea === 'hacker') {
        return h(
          'g',
          { transform: `translate(${dx} 0)` },
          lit ? h('path', { d: side === 'right' ? 'M244 60L120 34V88Z' : 'M256 60L380 34V88Z', fill: '#fff3c4', opacity: 0.32, className: 'wv-beam' }) : null,
          h('path', { d: 'M208 126q14-24 42-22q30 0 46 22z', fill: '#96a6cc', ...OL }),
          h('path', { d: 'M239 110L242.5 70H257.5L261 110Z', fill: '#ffffff', ...OL }),
          h('path', { d: 'M240.6 92H259.4L260.3 102H239.7Z', fill: '#ff7d6b', stroke: INK, strokeWidth: 1.2, strokeLinejoin: 'round' }),
          h('rect', { x: 238.5, y: 66, width: 23, height: 5, rx: 2, fill: '#6a7aa6', ...OL }),
          h('rect', { x: 243.5, y: 54, width: 13, height: 12, rx: 2.5, fill: '#ffe9a8', ...OL }),
          h('path', { d: 'M241 54.5L250 43.5L259 54.5Z', fill: '#ff7d6b', ...OL }),
          h('circle', { cx: 246.4, cy: 79, r: 1.25, fill: INK }),
          h('circle', { cx: 253.6, cy: 79, r: 1.25, fill: INK }),
          h('path', { d: 'M248 82.6q2 2 4 0', stroke: INK, strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round' }),
          h('ellipse', { cx: 243.6, cy: 82.4, rx: 1.9, ry: 1.2, fill: '#ffb3c7' }),
          h('ellipse', { cx: 256.4, cy: 82.4, rx: 1.9, ry: 1.2, fill: '#ffb3c7' }),
        )
      }
      return null
    }

    /** 带回的那样东西说成一句话：闲聊礁是对话气泡，弹幕湾是一条弹幕。 */
    function TalkTag({ kind, x, y, text }) {
      const w = Math.max(36, [...text].length * 11 + 20)
      const l = -w / 2
      const r = w / 2
      if (kind === 'chat') {
        return h(
          'g',
          { transform: `translate(${x} ${y})`, className: 'wv-bob' },
          h('path', { d: `M${l + 10} -11H${r - 10}a10 10 0 0 1 10 10V1a10 10 0 0 1-10 10H${r - 12}l7 10l-17-10H${l + 10}a10 10 0 0 1-10-10V-1a10 10 0 0 1 10-10Z`, fill: '#ffffff', ...OL }),
          h('text', { x: 0, y: 4.2, fontSize: 10.5, fontWeight: 700, textAnchor: 'middle', fill: INK }, text),
        )
      }
      return h(
        'g',
        { transform: `translate(${x} ${y}) rotate(-5)`, className: 'wv-bob' },
        h('path', { d: `M${r + 6} -3.5h9M${r + 6} 3.5h5`, stroke: '#ffffff', strokeWidth: 2.4, strokeLinecap: 'round' }),
        h('rect', { x: l, y: -11, width: w, height: 22, rx: 11, fill: '#ffc2d8', ...OL }),
        h('text', { x: 0, y: 4.2, fontSize: 10.5, fontWeight: 700, textAnchor: 'middle', fill: INK }, text),
      )
    }

    function WhaleHero({ pose, x, flip, hat, mood }) {
      if (pose === 'jump') {
        const dir = flip ? -1 : 1
        return h(
          'g',
          null,
          h('g', { transform: `translate(${x} 98) rotate(${-17 * dir})` }, h(Whale, { scale: 0.7, flip, cute: true, mood: 'wow', hat })),
          ...[-34, -22, -8, 8, 20].map((d, i) => h('circle', { key: i, cx: x - 14 * dir + d, cy: 118 - (i % 2) * 7 - (i === 2 ? 5 : 0), r: 2.2 + (i % 3) * 0.6, fill: '#ffffff', stroke: INK, strokeWidth: 1.1 })),
        )
      }
      if (pose === 'peek') return h(Whale, { x, y: 137, scale: 0.78, flip, cute: true, mood: 'calm', hat })
      return h(Whale, { x, y: 130, scale: 0.78, flip, cute: true, mood, hat, spout: pose === 'spout' ? 'still' : null })
    }

    /** 论文深海：整张在水下。大肥鱼戴着眼镜，面前漂着那一页论文。 */
    function DeepHero({ rng, focus, x }) {
      const y = 104 + rng() * 10
      return h(
        'g',
        null,
        h('path', { d: 'M40 0H74L10 200H-50Z', fill: '#cfe1ff', opacity: 0.1, className: 'wv-glow' }),
        h('path', { d: 'M176 0H204L150 200H96Z', fill: '#cfe1ff', opacity: 0.08, className: 'wv-glow' }),
        // 水母
        h(
          'g',
          { transform: `translate(${46 + rng() * 16} ${58 + rng() * 14})`, className: 'wv-float' },
          h('path', { d: 'M-7 2q-2 7 0 13M-2.5 2.5q2 8 0 16M2.5 2.5q-2 8 0 15M7 2q2 7 0 12', stroke: '#ffb3d9', strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round' }),
          h('path', { d: 'M-11 2a11 10 0 0 1 22 0q-11 4-22 0z', fill: '#ffc2e2', ...OL }),
          h('circle', { cx: -3.4, cy: -2.5, r: 1.1, fill: INK }),
          h('circle', { cx: 3.4, cy: -2.5, r: 1.1, fill: INK }),
          h('path', { d: 'M-1.6 0q1.6 1.6 3.2 0', stroke: INK, strokeWidth: 1, fill: 'none', strokeLinecap: 'round' }),
        ),
        // 海底和海草
        h('path', { d: 'M-22 186a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0a11 6 0 0 1 22 0V200H-22Z', fill: '#16296a' }),
        ...[26, 58, 214, 246, 276].map((sx, i) => {
          const hgt = 18 + rng() * 18
          return h('path', { key: `w${i}`, d: `M${sx} 190q-6 ${-hgt / 3} 0 ${(-hgt * 2) / 3}t0 ${-hgt / 3}`, stroke: i % 2 ? '#5fd3b6' : '#7fe0a8', strokeWidth: 3.4, fill: 'none', strokeLinecap: 'round' })
        }),
        ...Array.from({ length: 7 }, (_, i) => h('circle', { key: `b${i}`, cx: 16 + rng() * 270, cy: 16 + rng() * 150, r: 1.4 + rng() * 2.4, fill: '#ffffff', fillOpacity: 0.16, stroke: '#e3eeff', strokeWidth: 1, opacity: 0.8 })),
        // 那一页论文
        h(
          'g',
          { transform: `translate(${x + 70} ${y - 6}) rotate(9)`, className: 'wv-bob' },
          h('circle', { r: 30, fill: '#fff6c9', opacity: 0.16 }),
          h('rect', { x: -15, y: -20, width: 30, height: 40, rx: 3, fill: '#fffbe6', ...OL }),
          h('path', { d: 'M-9 -12h18', stroke: INK, strokeWidth: 2.2, strokeLinecap: 'round' }),
          h('path', { d: 'M-9 -5h18M-9 0h18M-9 5h13M-9 10h16', stroke: '#b9a86a', strokeWidth: 1.4, strokeLinecap: 'round' }),
          h('path', { transform: 'translate(9 13) scale(0.8)', d: HEART, fill: '#ff8fb0' }),
        ),
        focus ? h('text', { x: 14, y: 26, fontSize: 9.5, fill: '#e6f0ff', fontFamily: 'Georgia,serif', fontStyle: 'italic' }, `“${focus}”`) : null,
        h(Whale, { x, y, scale: 0.78, cute: true, mood: rng() < 0.5 ? 'happy' : 'calm', hat: 'glasses' }),
        ...[0, 1, 2].map((i) => h('circle', { key: `wb${i}`, cx: x + 40 + i * 4, cy: y - 22 - i * 11, r: 2 + i * 0.9, fill: '#ffffff', fillOpacity: 0.2, stroke: '#ffffff', strokeWidth: 1.1 })),
      )
    }

    function PostcardArt({ card }) {
      const seaId = card.sea || 'fog'
      const pal = CUTE[seaId] || CUTE.fog
      const rng = seeded(card.id)
      const tod = timeOfDay(card.returnedAt)
      const deep = seaId === 'paper'
      const fog = seaId === 'fog'
      const plain = deep || fog
      const weather = plain ? 'clear' : pickWeather(rng, tod)
      const night = tod === 'night' && !plain
      const sky = plain || tod === 'day' ? pal.sky : CUTE_SKIES[tod]
      const focus = focusWord(card)
      const pose = fog ? 'swim' : pickPose(rng)
      const talk = seaId === 'chat' || seaId === 'danmaku'
      const side = talk || rng() < 0.5 ? 'right' : 'left'
      const flip = side === 'left'
      const x = 142 + rng() * 16
      const mood = pose === 'spout' || rng() < 0.4 ? 'happy' : 'calm'
      const tint = (c) => (night ? mix(c, '#23265e', 0.4) : tod === 'dusk' && !plain ? mix(c, '#c76a5a', 0.12) : c)
      const gid = `wv-g-${String(card.id).slice(0, 8)}`
      const ink = night || deep ? '#ffb3c0' : '#c9506a'
      const label = card.place ? `寄自 ${card.place}` : ''
      const labelW = 26 + [...label].length * 11.4
      return h(
        'svg',
        { viewBox: '0 0 300 200', className: 'wv-art', role: 'img', 'aria-label': `${card.seaName} 的风景` },
        h('defs', null, h('linearGradient', { id: `${gid}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: sky[0] }), h('stop', { offset: deep ? 1 : 0.62, stopColor: sky[1] }))),
        h('rect', { width: 300, height: 200, fill: `url(#${gid}-sky)` }),
        deep
          ? h(DeepHero, { rng, focus, x: 128 + rng() * 14 })
          : h(
              'g',
              null,
              // 清晨和傍晚：一轮大太阳垫在大肥鱼身后
              !fog && (tod === 'dawn' || tod === 'dusk')
                ? h('g', null, h('circle', { cx: 150, cy: 124, r: 60, fill: tod === 'dawn' ? '#fff0c2' : '#ffd29c', opacity: 0.45 }), h('circle', { cx: 150, cy: 124, r: 46, fill: tod === 'dawn' ? '#ffe9a8' : '#ffc38a' }))
                : null,
              night ? Array.from({ length: 11 }, (_, i) => h('path', { key: `n${i}`, transform: `translate(${14 + rng() * 272} ${12 + rng() * 96}) scale(${0.4 + rng() * 0.5})`, d: SPARKLE, fill: '#fff1b8', opacity: 0.9, className: i % 3 === 0 ? 'wv-blink' : '' })) : null,
              night ? h(MoonFace, { x: 34, y: 32 }) : null,
              !fog && tod === 'day' && (weather === 'clear' || weather === 'rainbow') ? h(SunFace, { x: 34, y: 34 }) : null,
              weather === 'rainbow'
                ? h('g', null, ...['#ff9aa2', '#ffd08a', '#b5e8a8', '#9fd3ff'].map((c, i) => h('path', { key: c, d: `M${150 - 84 + i * 8} 126a${84 - i * 8} ${84 - i * 8} 0 0 1 ${168 - i * 16} 0`, stroke: c, strokeWidth: 8.4, fill: 'none', opacity: 0.85 })))
                : null,
              weather === 'clouds' || weather === 'rain' ? h(CuteCloud, { x: 96 + rng() * 80, y: 26 + rng() * 6, s: 1.15, face: true, fill: night ? '#d9dcf7' : '#ffffff' }) : null,
              weather === 'clouds' ? h(CuteCloud, { x: side === 'right' ? 70 : 190, y: 62, s: 0.75, fill: night ? '#d9dcf7' : '#ffffff' }) : null,
              h(SideProp, { sea: seaId, side, focus, tod }),
              seaId === 'code' ? h(SmileStar, { x: side === 'right' ? 88 + rng() * 14 : 176 + rng() * 10, y: 50 + rng() * 10, s: 1.05, rot: -12 + rng() * 24 }) : null,
              h(ScallopBand, { y: 123, fill: tint(pal.sea[0]), phase: rng() * 22, speed: 12 }),
              seaId === 'hacker' ? h(PaperBoat, { x: side === 'right' ? 46 + rng() * 14 : 244 + rng() * 14, y: 122 }) : null,
              h(WhaleHero, { pose, x, flip, hat: pal.hat, mood }),
              h(ScallopBand, { y: 147, fill: tint(pal.sea[1]), phase: rng() * 22, speed: 9 }),
              h(ScallopBand, { y: 172, fill: tint(pal.sea[2]), phase: rng() * 22, speed: 7 }),
              talk && focus ? h(TalkTag, { kind: seaId, x: x - (seaId === 'chat' ? 52 : 44), y: pose === 'jump' ? 40 : 66, text: focus }) : null,
              // 起雾：它有点懵
              fog
                ? h(
                    'g',
                    null,
                    h('text', { x: x + 26, y: 92, fontSize: 20, fontWeight: 800, fill: INK, opacity: 0.75 }, '?'),
                    h('path', { transform: `translate(${x - 4} 104)`, d: 'M0 -5C3 0 3 3.5 0 3.5C-3 3.5 -3 0 0 -5Z', fill: '#9fd3ff', stroke: INK, strokeWidth: 1.1 }),
                    h(CuteCloud, { x: 62, y: 58, s: 1.7, face: true, sleepy: true }),
                    h(CuteCloud, { x: 236, y: 104, s: 1.5, face: true, sleepy: true }),
                    h(CuteCloud, { x: 96, y: 160, s: 1.3 }),
                  )
                : null,
              !night && !fog ? Array.from({ length: 4 }, (_, i) => h('path', { key: `sp${i}`, transform: `translate(${60 + rng() * 180} ${16 + rng() * 84}) scale(${0.5 + rng() * 0.5})`, d: SPARKLE, fill: '#ffffff', opacity: 0.95 })) : null,
              weather === 'rain'
                ? Array.from({ length: 12 }, (_, i) => h('path', { key: `r${i}`, transform: `translate(${14 + rng() * 272} ${48 + rng() * 66})`, d: 'M0 -5C3 0 3 3.5 0 3.5C-3 3.5 -3 0 0 -5Z', fill: '#a9dbf8', stroke: INK, strokeWidth: 0.9 }))
                : null,
            ),
        // 白边
        h('rect', { x: 3.5, y: 3.5, width: 293, height: 193, rx: 5, fill: 'none', stroke: '#ffffff', strokeWidth: 7 }),
        // 邮票
        h(
          'g',
          { transform: 'translate(245 13) rotate(3 20 24)' },
          h('rect', { x: 1.2, y: 1.8, width: 40, height: 48, fill: INK, opacity: 0.16 }),
          h('rect', { width: 40, height: 48, fill: '#fffaf0', stroke: '#e6cfa8', strokeDasharray: '3 2', strokeWidth: 2 }),
          h('rect', { x: 5, y: 5, width: 30, height: 30, rx: 2, fill: mix(pal.sea[0], '#ffffff', 0.35) }),
          h('path', { d: 'M5 27a5 3 0 0 1 10 0a5 3 0 0 1 10 0a5 3 0 0 1 10 0V35H5z', fill: pal.sea[1] }),
          h(Whale, { x: 21.5, y: 20.5, scale: 0.19, cute: true, mood: 'happy' }),
          h('text', { x: 20, y: 44, fontSize: 6, textAnchor: 'middle', fill: '#8a6d3b' }, '港口邮政'),
        ),
        // 邮戳
        h(
          'g',
          { transform: `translate(221 56) rotate(${-20 + rng() * 14})`, opacity: 0.78, stroke: ink, fill: 'none' },
          h('circle', { r: 19, strokeWidth: 1.5 }),
          h('circle', { r: 16, strokeWidth: 0.6 }),
          h('path', { d: 'M20.5 -7q5-4 10 0t10 0t10 0M20.5 1q5-4 10 0t10 0t10 0M20.5 9q5-4 10 0t10 0t10 0', strokeWidth: 1.1, strokeLinecap: 'round' }),
          h('text', { y: -3, fontSize: 7, textAnchor: 'middle', fill: ink, stroke: 'none', fontWeight: 700 }, card.seaName || ''),
          h('text', { y: 8, fontSize: 5.4, textAnchor: 'middle', fill: ink, stroke: 'none' }, dateStamp(card.returnedAt)),
        ),
        // 落款的小布条
        label
          ? h(
              'g',
              { transform: 'translate(12 169)' },
              h('rect', { x: 1, y: 1.6, width: labelW, height: 20, rx: 10, fill: INK, opacity: 0.18 }),
              h('rect', { width: labelW, height: 20, rx: 10, fill: '#fffdf6', stroke: INK, strokeWidth: 1.5 }),
              h('path', { transform: 'translate(12.5 10.4) scale(1.05)', d: HEART, fill: '#ff8fb0' }),
              h('text', { x: 21, y: 14.2, fontSize: 11, fill: INK, className: 'wv-hand' }, label),
            )
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
.wv-gift-box{display:flex;flex-direction:column;gap:8px;align-self:start;padding:12px 14px;border-radius:12px;background:#fff;border:1.5px solid #3f3a63;box-shadow:2px 3px 0 rgba(63,58,99,.16)}
.wv-gift-label{align-self:flex-start;font-size:11px;font-weight:700;color:#3f3a63;background:#ffe08a;border-radius:999px;padding:2px 9px}
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
