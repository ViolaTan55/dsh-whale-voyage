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

    function Whale({ x = 0, y = 0, scale = 1, flip = false, sleepy = false, className = '' }) {
      const t = `translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`
      return h(
        'g',
        { transform: t, className },
        h('path', { d: 'M-44 4c-6-10-16-14-24-12 6 4 9 9 10 14-3 5-8 9-14 11 9 2 19-1 26-8', fill: '#4f7fb6' }),
        h('ellipse', { cx: 0, cy: 0, rx: 46, ry: 30, fill: '#5b8fcb' }),
        h('path', { d: 'M-38 10c14 16 52 18 76 2-6 14-28 22-46 20-14-2-26-10-30-22z', fill: '#cfe4f7' }),
        h('path', { d: 'M-4 14c4 8 12 12 18 12-4-6-6-10-6-14', fill: '#4f7fb6' }),
        sleepy
          ? h('path', { d: 'M20 -6q5 4 10 0', stroke: '#1d3557', strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round' })
          : h('circle', { cx: 25, cy: -5, r: 3.6, fill: '#1d3557' }),
        h('ellipse', { cx: 31, cy: 5, rx: 5, ry: 3, fill: '#f4a6b8', opacity: 0.8 }),
        h('path', { d: 'M34 12q4 3 8 0', stroke: '#1d3557', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' }),
      )
    }

    function Spout({ x, y, scale = 1 }) {
      return h(
        'g',
        { transform: `translate(${x} ${y}) scale(${scale})`, className: 'wv-spout' },
        h('path', { d: 'M0 0c-2-8-8-12-14-12M0 0c2-8 8-12 14-12M0 0v-16', stroke: '#9fd3ff', strokeWidth: 3, fill: 'none', strokeLinecap: 'round' }),
      )
    }

    /* ------------------------------------------------------------ 画：海域明信片正面 */

    const PALETTES = {
      code: { sky: ['#c8efe6', '#f1fbf8'], sea: ['#2aa198', '#127068'], ink: '#0e4f49' },
      paper: { sky: ['#0b1b3a', '#1c3a73'], sea: ['#10264f', '#050f24'], ink: '#dce8ff' },
      danmaku: { sky: ['#ffd3e6', '#fff1f7'], sea: ['#58c6f5', '#1f8fc4'], ink: '#7a2550' },
      hacker: { sky: ['#ffb16a', '#ffe6cc'], sea: ['#40618a', '#243b57'], ink: '#5a2a05' },
      chat: { sky: ['#d8cbff', '#f3eeff'], sea: ['#8a78dd', '#5a49b2'], ink: '#382a7a' },
      fog: { sky: ['#c9ced6', '#eceff3'], sea: ['#98a2b0', '#6f7a89'], ink: '#3d4552' },
    }

    function Waves({ y, color, rng, opacity = 0.35 }) {
      const paths = []
      for (let row = 0; row < 3; row += 1) {
        let d = ''
        const yy = y + 14 + row * 16
        for (let x = -20; x < 320; x += 40) {
          const off = rng() * 6
          d += `M${x + off} ${yy}q10 -6 20 0`
        }
        paths.push(h('path', { key: row, d, stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round', opacity }))
      }
      return h('g', { className: 'wv-waves' }, ...paths)
    }

    function SeaDecor({ sea, rng, ink }) {
      if (sea === 'code') {
        return h(
          'g',
          null,
          h('path', { d: 'M150 120q40-34 90-30q30 2 50 30z', fill: '#3f9d63' }),
          h('path', { d: 'M20 124q26-22 60-18q20 3 30 18z', fill: '#4caf72' }),
          h('rect', { x: 196, y: 82, width: 22, height: 18, rx: 2, fill: '#fff8e8' }),
          h('path', { d: 'M193 84l14-12 14 12z', fill: '#e76f51' }),
          h('text', { x: 207, y: 96, fontSize: 9, textAnchor: 'middle', fill: ink, fontFamily: 'ui-monospace,Menlo,monospace' }, '{ }'),
          h('rect', { x: 236, y: 90, width: 16, height: 12, rx: 2, fill: '#fff8e8' }),
          h('path', { d: 'M234 92l10-9 10 9z', fill: '#2a9d8f' }),
          ...[0, 1, 2, 3].map((i) =>
            h('text', { key: i, x: 30 + rng() * 240, y: 18 + rng() * 40, fontSize: 10 + rng() * 6, fill: '#f4c430', opacity: 0.9 }, '★'),
          ),
        )
      }
      if (sea === 'paper') {
        return h(
          'g',
          null,
          ...[0, 1, 2, 3, 4].map((i) => {
            const x = 40 + rng() * 220
            const y = 70 + rng() * 80
            const r = -20 + rng() * 40
            return h(
              'g',
              { key: i, transform: `translate(${x} ${y}) rotate(${r})`, className: 'wv-glow' },
              h('rect', { x: -9, y: -12, width: 18, height: 24, rx: 1.5, fill: '#f8f3d9', opacity: 0.92 }),
              h('path', { d: 'M-5 -6h10M-5 -2h10M-5 2h7M-5 6h9', stroke: '#8a7f52', strokeWidth: 1 }),
            )
          }),
          ...[0, 1, 2, 3, 4, 5].map((i) => h('circle', { key: `b${i}`, cx: 20 + rng() * 260, cy: 20 + rng() * 60, r: 1 + rng() * 2.2, fill: '#cfe3ff', opacity: 0.8 })),
        )
      }
      if (sea === 'danmaku') {
        const words = ['哈哈哈哈', '名场面', '来了来了', '三连了', '前方高能', '好耶', '泪目', '学到了']
        return h(
          'g',
          null,
          ...[0, 1, 2, 3, 4].map((i) => {
            const y = 16 + i * 13
            const x = rng() * 200
            const w = words[Math.floor(rng() * words.length)]
            const colors = ['#ff6b9a', '#00a1d6', '#ffb000', '#7b61ff', '#ffffff']
            return h(
              'text',
              { key: i, x, y, fontSize: 10, fill: colors[i % colors.length], stroke: 'rgba(0,0,0,.25)', strokeWidth: 0.4, className: 'wv-scroll', style: { animationDelay: `${-rng() * 8}s` } },
              w,
            )
          }),
          h('path', { d: 'M0 128q60-14 120-4q30 6 40 4v16H0z', fill: '#f6d7a7' }),
        )
      }
      if (sea === 'hacker') {
        return h(
          'g',
          null,
          h('path', { d: 'M150 102q-40 -10 -110 -40', stroke: '#fff3c4', strokeWidth: 18, opacity: 0.35, className: 'wv-beam' }),
          h('path', { d: 'M180 126q30-18 70-16q30 2 50 16z', fill: '#2c3e50' }),
          h('rect', { x: 196, y: 70, width: 14, height: 44, fill: '#ffffff' }),
          h('rect', { x: 196, y: 82, width: 14, height: 7, fill: '#ff6600' }),
          h('rect', { x: 196, y: 98, width: 14, height: 7, fill: '#ff6600' }),
          h('path', { d: 'M193 70h20l-4-10h-12z', fill: '#ff6600' }),
          h('circle', { cx: 203, cy: 64, r: 3.5, fill: '#fff3c4' }),
        )
      }
      if (sea === 'chat') {
        return h(
          'g',
          null,
          h('path', { d: 'M10 128q20-20 46-18q18 2 26 18z', fill: '#6b5a9e' }),
          h('path', { d: 'M210 128q24-26 58-22q20 4 30 22z', fill: '#6b5a9e' }),
          ...[0, 1, 2].map((i) => {
            const x = 40 + i * 90 + rng() * 20
            const y = 34 + rng() * 26
            return h(
              'g',
              { key: i, transform: `translate(${x} ${y})`, className: 'wv-bob', style: { animationDelay: `${-i * 0.7}s` } },
              h('rect', { x: -18, y: -11, width: 36, height: 22, rx: 9, fill: '#ffffff' }),
              h('path', { d: 'M-6 10l-4 8 10-8', fill: '#ffffff' }),
              h('text', { x: 0, y: 4, fontSize: 11, textAnchor: 'middle', fill: ink }, i === 1 ? '+1' : '…'),
            )
          }),
        )
      }
      return h(
        'g',
        null,
        ...[0, 1, 2, 3].map((i) => h('rect', { key: i, x: -40 + rng() * 120, y: 30 + i * 26, width: 260 + rng() * 80, height: 14, rx: 7, fill: '#ffffff', opacity: 0.45 })),
      )
    }

    function PostcardArt({ card }) {
      const seaId = card.sea || 'fog'
      const pal = PALETTES[seaId] || PALETTES.fog
      const rng = seeded(card.id)
      const gid = `wv-g-${String(card.id).slice(0, 8)}`
      return h(
        'svg',
        { viewBox: '0 0 300 200', className: 'wv-art', role: 'img', 'aria-label': `${card.seaName} 的风景` },
        h(
          'defs',
          null,
          h('linearGradient', { id: `${gid}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: pal.sky[0] }), h('stop', { offset: 1, stopColor: pal.sky[1] })),
          h('linearGradient', { id: `${gid}-sea`, x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: pal.sea[0] }), h('stop', { offset: 1, stopColor: pal.sea[1] })),
        ),
        h('rect', { width: 300, height: 200, fill: `url(#${gid}-sky)` }),
        h(SeaDecor, { sea: seaId, rng, ink: pal.ink }),
        h('rect', { y: 124, width: 300, height: 76, fill: `url(#${gid}-sea)` }),
        h(Waves, { y: 124, color: '#ffffff', rng }),
        h(Whale, { x: 88 + rng() * 60, y: 150, scale: 0.42, flip: rng() < 0.4 }),
        // 邮票
        h(
          'g',
          { transform: 'translate(250 10)' },
          h('rect', { width: 40, height: 48, fill: '#fffaf0', stroke: '#e0c9a6', strokeDasharray: '3 2', strokeWidth: 2 }),
          h('rect', { x: 5, y: 5, width: 30, height: 30, fill: pal.sea[0] }),
          h(Whale, { x: 20, y: 22, scale: 0.2 }),
          h('text', { x: 20, y: 44, fontSize: 6, textAnchor: 'middle', fill: '#8a6d3b' }, '港口邮政'),
        ),
        // 邮戳
        h(
          'g',
          { transform: 'translate(226 52) rotate(-14)', opacity: 0.7 },
          h('circle', { r: 20, fill: 'none', stroke: '#b23a48', strokeWidth: 1.6 }),
          h('text', { y: -4, fontSize: 7, textAnchor: 'middle', fill: '#b23a48', fontWeight: 700 }, card.seaName || ''),
          h('text', { y: 7, fontSize: 5.6, textAnchor: 'middle', fill: '#b23a48' }, dateStamp(card.returnedAt)),
        ),
        card.place ? h('text', { x: 12, y: 190, fontSize: 12, fill: '#ffffff', className: 'wv-hand', stroke: 'rgba(0,0,0,.25)', strokeWidth: 0.5 }, `寄自 ${card.place}`) : null,
      )
    }

    /* ------------------------------------------------------------ 画：港口 */

    function skyFor(hour) {
      if (hour < 5 || hour >= 20) return { top: '#0d1b3e', bottom: '#2a3f7a', star: true }
      if (hour < 7) return { top: '#f7b77c', bottom: '#fde3c8', star: false }
      if (hour < 17) return { top: '#8fd0ff', bottom: '#e3f4ff', star: false }
      return { top: '#f08a5d', bottom: '#ffd3a5', star: false }
    }

    function Harbor({ state, now }) {
      const w = state.whale
      const hour = new Date(now).getHours()
      const sky = skyFor(hour)
      const rng = seeded('harbor')
      const home = w.status === 'home'
      const resting = home && !(state.settings.autoDepart && w.departAt && w.departAt - now < 5 * 60_000)
      return h(
        'svg',
        { viewBox: '0 0 600 220', className: 'wv-harbor', role: 'img', 'aria-label': home ? '大肥鱼在港口里' : '港口空着，大肥鱼出海了' },
        h(
          'defs',
          null,
          h('linearGradient', { id: 'wv-h-sky', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: sky.top }), h('stop', { offset: 1, stopColor: sky.bottom })),
          h('linearGradient', { id: 'wv-h-sea', x1: 0, y1: 0, x2: 0, y2: 1 }, h('stop', { offset: 0, stopColor: '#3f8fd0' }), h('stop', { offset: 1, stopColor: '#1d5a99' })),
        ),
        h('rect', { width: 600, height: 220, fill: 'url(#wv-h-sky)' }),
        sky.star ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => h('circle', { key: i, cx: rng() * 600, cy: rng() * 90, r: 1 + rng() * 1.4, fill: '#fff', opacity: 0.8 })) : null,
        // 灯塔
        h('path', { d: 'M40 150q20-26 60-24q26 2 36 24z', fill: '#6b7d5c' }),
        h('rect', { x: 74, y: 86, width: 16, height: 46, fill: '#fff' }),
        h('rect', { x: 74, y: 98, width: 16, height: 8, fill: '#e76f51' }),
        h('rect', { x: 74, y: 116, width: 16, height: 8, fill: '#e76f51' }),
        h('path', { d: 'M71 86h22l-5-12h-12z', fill: '#e76f51' }),
        h('circle', { cx: 82, cy: 80, r: 4, fill: '#ffe08a', className: 'wv-blink' }),
        // 海
        h('rect', { y: 140, width: 600, height: 80, fill: 'url(#wv-h-sea)' }),
        h(Waves, { y: 140, color: '#ffffff', rng: seeded('waves'), opacity: 0.3 }),
        h('g', { transform: 'scale(2 1)' }, h(Waves, { y: 160, color: '#ffffff', rng: seeded('waves2'), opacity: 0.18 })),
        // 码头
        h('rect', { x: 400, y: 128, width: 200, height: 10, fill: '#a0703d' }),
        ...[0, 1, 2, 3, 4].map((i) => h('rect', { key: i, x: 410 + i * 44, y: 136, width: 7, height: 40, fill: '#7a5230' })),
        h('rect', { x: 560, y: 96, width: 6, height: 34, fill: '#7a5230' }),
        home
          ? h(
              'g',
              { className: 'wv-float' },
              h(Whale, { x: 330, y: 168, scale: 1, sleepy: resting }),
              resting ? h('text', { x: 372, y: 126, fontSize: 18, fill: '#ffffff', className: 'wv-zzz' }, 'z z') : h(Spout, { x: 318, y: 140, scale: 1 }),
            )
          : h(
              'g',
              null,
              // 码头上的字条
              h('g', { transform: 'translate(542 82) rotate(6)' }, h('rect', { width: 46, height: 30, fill: '#fffaf0', stroke: '#d9c3a0' }), h('text', { x: 23, y: 19, fontSize: 10, textAnchor: 'middle', fill: '#6b4f2a' }, '出海中')),
              // 远处的小影子
              h('g', { className: 'wv-far' }, h(Whale, { x: 210, y: 144, scale: 0.26 }), h(Spout, { x: 205, y: 136, scale: 0.45 })),
            ),
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
              card.plannedSea && card.sea && card.plannedSea !== card.sea ? ' · 原定那片海去不了，绕路了' : '',
            ),
          ),
          card.items && card.items.length
            ? h(
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
              h('strong', null, s.visited ? s.name : '？？？'),
              h('span', null, s.visited ? `${s.blurb} · 去过 ${s.visited} 次` : '还没去过'),
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
.wv-gifts{list-style:none;margin:0;padding:0 0 0 16px;border-left:1px dashed #d8c7a8;display:flex;flex-direction:column;gap:12px}
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
.wv-toggle{display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer}
.wv-toggle input{margin-top:3px}
.wv-toggle span{display:flex;flex-direction:column;gap:2px}
.wv-toggle strong{font-size:14px;font-weight:600}
.wv-toggle small{font-size:12px;color:var(--wv-sub);line-height:1.5}
.wv-foot{margin:8px 0 0;font-size:12px;color:var(--wv-sub);line-height:1.6}
.wv-overlay{position:fixed;inset:0;background:rgba(10,16,28,.55);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto;z-index:1000}
.wv-overlay .wv-card{max-width:680px;width:100%}
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
@keyframes wv-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes wv-zzz{0%,100%{opacity:.2;transform:translateY(4px)}50%{opacity:.9;transform:translateY(-4px)}}
@keyframes wv-spout{0%,60%,100%{opacity:0;transform:scaleY(.3)}75%{opacity:1;transform:scaleY(1)}}
@keyframes wv-far{0%,100%{transform:translateX(0)}50%{transform:translateX(-18px)}}
@keyframes wv-blink{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes wv-scroll{from{transform:translateX(320px)}to{transform:translateX(-120px)}}
@media (max-width:600px){.wv-page{padding:14px 16px 40px}.wv-back{grid-template-columns:1fr}.wv-gifts{padding:12px 0 0;border-left:0;border-top:1px dashed #d8c7a8}}
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

    return { inject: ['slots'], apply, WhaleVoyagePage, PostcardArt }
  },
})
