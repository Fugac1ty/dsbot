window.__ModuleLoader__.load({
  id: 'dsh-balance-peak',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const { createElement, useCallback, useEffect, useMemo, useState, useSyncExternalStore } = require('react')

    // ── Settings namespace + defaults (mirrors the host registration) ────────
    const NS = 'balance-peak'
    const DEFAULT_CFG = { refreshSeconds: 60, showPeak: true, showBalance: true, offsetX: 0, offsetY: 8 }

    // Live position-preview store shared between the settings card and the dock.
    // The dock applies this while the user nudges, so the pills move instantly
    // even before the settings write round-trips. A new snapshot object on every
    // set keeps useSyncExternalStore happy.
    let livePosState = { x: null, y: null }
    const livePosListeners = new Set()
    function livePosSet(x, y) { livePosState = { x, y }; for (const l of livePosListeners) l() }
    function livePosReset() { livePosSet(null, null) }
    function livePosGet() { return livePosState }
    function livePosSubscribe(cb) { livePosListeners.add(cb); return () => livePosListeners.delete(cb) }

    // ── DeepSeek 峰谷（北京时间）──────────────────────────────────────────────
    // 高峰：09:00–12:00 与 14:00–18:00；其余为低谷。匹配官方 V4 峰谷计价。
    const PEAKS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]

    function bjParts(now) {
      const p = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(now || new Date())
      const g = (t) => { const x = p.find((e) => e.type === t); return x ? parseInt(x.value, 10) : 0 }
      return { h: g('hour') % 24, m: g('minute'), s: g('second') }
    }

    function bjMinutes(now) {
      const b = bjParts(now)
      return b.h * 60 + b.m + b.s / 60
    }

    function pad(n) { return (n < 10 ? '0' : '') + n }
    function fmt(min) { return pad(Math.floor(min / 60)) + ':' + pad(Math.floor(min % 60)) }

    /** Current phase plus the peak window to display. */
    function phase(mins) {
      for (const [s, e] of PEAKS) {
        if (mins >= s && mins < e) return { peak: true, start: s, end: e }
      }
      let next = null
      for (const [s, e] of PEAKS) {
        if (s > mins) { next = [s, e]; break }
      }
      if (next === null) next = PEAKS[0] // 次日 09:00–12:00
      return { peak: false, nextStart: next[0], nextEnd: next[1] }
    }

    /** Current config, falling back to defaults until the settings scope is ready. */
    function readConfig(scope) {
      if (scope === undefined || scope === null) return DEFAULT_CFG
      const snap = scope.getSnapshot()
      if (snap === null || typeof snap !== 'object' || snap.status !== 'ready' || snap.value === undefined) return DEFAULT_CFG
      return Object.assign({}, DEFAULT_CFG, snap.value || {})
    }

    // ── 峰值/余额胶囊组件（输入框右上角）────────────────────────────────────
    function BalancePeakDock(props) {
      const scope = props && props.scope
      const [tick, setTick] = useState(Date.now())
      const [balance, setBalance] = useState(null)
      const [status, setStatus] = useState('loading')
      const [refreshing, setRefreshing] = useState(false)
      // Re-reads each render (the 1s tick re-renders), so a settings change
      // lands here within a second without subscribing the dock to the scope.
      const cfg = readConfig(scope)
      const refreshMs = Math.max(5, Number(cfg.refreshSeconds) || 60) * 1000

      useEffect(() => {
        const id = setInterval(() => setTick(Date.now()), 1000)
        return () => clearInterval(id)
      }, [])

      const loadBalance = useCallback(async () => {
        try {
          const r = await fetch('/api/balance', { headers: { accept: 'application/json' } })
          const j = await r.json().catch(() => null)
          if (!r.ok || j === null || j.ok !== true) { setBalance(null); setStatus('error'); return }
          setBalance(j); setStatus('ok')
        } catch {
          setBalance(null); setStatus('error')
        }
      }, [])

      useEffect(() => {
        loadBalance()
        const id = setInterval(loadBalance, refreshMs)
        return () => clearInterval(id)
      }, [refreshMs, loadBalance])

      const ph = useMemo(() => phase(bjMinutes(new Date(tick))), [tick])

      const peakText = ph.peak
        ? `${fmt(ph.start)}~${fmt(ph.end)}`
        : `至 ${fmt(ph.nextStart)} 起`

      const balanceText = status === 'ok' && balance
        ? `${balance.currency ? balance.currency + ' ' : ''}${balance.amount}`
        : status === 'error' ? '读取失败' : '查询中…'

      const pills = []
      if (cfg.showPeak !== false) {
        pills.push(createElement('span', {
          key: 'peak',
          className: 'dsh-balance-peak-pill ' + (ph.peak ? 'is-peak' : 'is-offpeak'),
          title: 'DeepSeek 峰谷：忙时 09:00–12:00 / 14:00–18:00（北京时间）',
        },
        createElement('span', { className: 'dsh-balance-peak-dot' }),
        createElement('strong', { className: 'dsh-balance-peak-label' }, ph.peak ? '忙时' : '谷时'),
        createElement('span', null, ' ' + peakText)))
      }
      if (cfg.showBalance !== false) {
        pills.push(createElement('span', {
          key: 'balance',
          className: 'dsh-balance-peak-pill is-balance' + (balance && balance.available === false ? ' is-depleted' : ''),
          title: 'DeepSeek 账户余额（服务端代理读取，不含 key）',
        },
        createElement('span', { className: 'dsh-balance-peak-dot' }),
        createElement('span', null, 'DeepSeek 余额 '),
        createElement('span', { className: 'dsh-balance-peak-amount' }, balanceText)))
        // Manual refresh, rightmost. Spins until the fetch settles.
        pills.push(createElement('button', {
          key: 'refresh',
          type: 'button',
          className: 'dsh-balance-peak-refresh' + (refreshing ? ' is-spinning' : ''),
          title: '刷新余额',
          disabled: refreshing,
          onClick: () => {
            setRefreshing(true)
            const started = Date.now()
            Promise.resolve(loadBalance()).finally(() => {
              // Keep the one-shot spin alive long enough to complete even when
              // the local /api/balance round-trips faster than the animation.
              const wait = Math.max(0, 300 - (Date.now() - started))
              setTimeout(() => setRefreshing(false), wait)
            })
          },
        }, '↻'))
      }
      if (pills.length === 0) return null
      // Position preview: apply the in-progress nudge immediately, else the
      // persisted offsets.
      const livePos = useSyncExternalStore(livePosSubscribe, livePosGet)
      const baseOffsetX = Number(cfg.offsetX) || 0
      const baseOffsetY = Number(cfg.offsetY) || 8
      const offsetX = livePos && livePos.x !== null && livePos.x !== undefined ? livePos.x : baseOffsetX
      const offsetY = livePos && livePos.y !== null && livePos.y !== undefined ? livePos.y : baseOffsetY
      const dockStyle = { bottom: `calc(100% + ${offsetY}px)`, right: `${offsetX}px` }
      return createElement('div', { className: 'dsh-balance-peak-bar', style: dockStyle }, pills)
    }

    // ── 设置卡片（设置 → 插件）──────────────────────────────────────────────
    function SettingsCard(props) {
      const scope = props && props.scope
      const [open, setOpen] = useState(false)
      const [draft, setDraft] = useState(null)
      const [subscribe, getSnapshot] = useMemo(() => {
        if (scope && typeof scope.subscribe === 'function' && typeof scope.getSnapshot === 'function') {
          return [(cb) => scope.subscribe(cb), () => scope.getSnapshot()]
        }
        return [() => () => {}, () => null]
      }, [scope])
      const snap = useSyncExternalStore(subscribe, getSnapshot)

      const cfg = Object.assign({}, DEFAULT_CFG, (snap && snap.value) || {})
      const cur = draft === null ? cfg : Object.assign({}, cfg, draft)
      const dirty = draft !== null
      const missing = snap === null || snap.status === 'unavailable'
      const loading = snap !== null && snap.status === 'loading'

      const patch = (field, value) => setDraft((d) => Object.assign({}, d || cfg, { [field]: value }))
      const offX = Number(cur.offsetX) || 0
      const offY = Number(cur.offsetY) || 8
      const STEP = 2
      const nudge = (dx, dy) => {
        const nx = Math.max(-400, Math.min(400, offX + dx))
        const ny = Math.max(-200, Math.min(600, offY + dy))
        livePosSet(nx, ny)
        patch('offsetX', nx)
        patch('offsetY', ny)
      }
      const resetPos = () => { livePosSet(0, 8); patch('offsetX', 0); patch('offsetY', 8) }
      const save = async () => {
        if (draft === null || scope === undefined) return
        try {
          await scope.set('refreshSeconds', Number(draft.refreshSeconds) || 60)
          await scope.set('showPeak', !!draft.showPeak)
          await scope.set('showBalance', !!draft.showBalance)
          await scope.set('offsetX', Number(draft.offsetX) || 0)
          await scope.set('offsetY', Number(draft.offsetY) || 8)
          livePosReset()
          setDraft(null)
        } catch { /* keep drafts on failure */ }
      }
      const discard = () => { livePosReset(); setDraft(null) }

      const body = createElement('div', { className: 'dsh-balance-peak-cardBody' },
        missing
          ? createElement('p', { className: 'dsh-balance-peak-none' }, '该命名空间未被 DSH 服务，无法编辑。')
          : loading
            ? createElement('p', { className: 'dsh-balance-peak-none' }, '加载配置中…')
            : createElement('div', { className: 'dsh-balance-peak-fields' },
              createElement('label', null,
                createElement('input', { type: 'checkbox', checked: !!cur.showPeak, onChange: (e) => patch('showPeak', e.target.checked) }),
                ' 显示忙时 / 谷时胶囊'),
              createElement('label', null,
                createElement('input', { type: 'checkbox', checked: !!cur.showBalance, onChange: (e) => patch('showBalance', e.target.checked) }),
                ' 显示余额胶囊'),
              createElement('label', null,
                ' 余额刷新间隔（秒） ',
                createElement('input', {
                  type: 'number', min: 5, max: 3600,
                  value: cur.refreshSeconds,
                  onChange: (e) => patch('refreshSeconds', e.target.value),
                })),
              createElement('div', { className: 'dsh-balance-peak-position' },
                createElement('span', { className: 'dsh-balance-peak-position-label' }, '位置'),
                createElement('button', { type: 'button', className: 'dsh-balance-peak-posbtn', onClick: () => nudge(0, STEP), title: '上移' }, '▲'),
                createElement('button', { type: 'button', className: 'dsh-balance-peak-posbtn', onClick: () => nudge(0, -STEP), title: '下移' }, '▼'),
                createElement('button', { type: 'button', className: 'dsh-balance-peak-posbtn', onClick: () => nudge(STEP, 0), title: '左移' }, '◀'),
                createElement('button', { type: 'button', className: 'dsh-balance-peak-posbtn', onClick: () => nudge(-STEP, 0), title: '右移' }, '▶'),
                createElement('button', { type: 'button', className: 'dsh-balance-peak-posbtn', onClick: resetPos, title: '重置到默认' }, '重置'),
                createElement('span', { className: 'dsh-balance-peak-posval' }, `右 ${offX} · 上 ${offY}`)),
              createElement('div', { className: 'dsh-balance-peak-actions' },
                createElement('button', { type: 'button', onClick: discard, disabled: !dirty }, '放弃'),
                createElement('button', { type: 'button', onClick: save, disabled: !dirty }, '保存'))))

      return createElement('li', { className: 'dsh-balance-peak-card' },
        createElement('button', { type: 'button', className: 'dsh-balance-peak-cardHead', 'aria-expanded': open, onClick: () => setOpen(!open) },
          createElement('span', { className: 'dsh-balance-peak-cardHeadText' },
            createElement('span', { className: 'dsh-balance-peak-cardTitle' }, '余额峰谷'),
            createElement('span', { className: 'dsh-balance-peak-cardDesc' }, missing ? '（无法编辑）' : '显示余额/峰谷胶囊，输入框上方右上角')),
          dirty ? createElement('span', { className: 'dsh-balance-peak-cardPending' }, '未保存') : null,
          createElement('span', { className: 'dsh-balance-peak-chevron' }, open ? '▾' : '▸')),
        open ? body : null)
    }

    const CSS = [
      // Lifted to just above the composer card, right-aligned with its top-right
      // corner (the overlay anchor spans the card width at its top).
      // pointer-events:none lets clicks fall through to the transcript's message
      // actions (e.g. the copy button) that the floating row may overlap; the
      // refresh button opts back in below.
      '.dsh-balance-peak-bar{position:absolute;bottom:calc(100% + 8px);right:0;z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:nowrap;justify-content:flex-end;pointer-events:none;}',
      '.dsh-balance-peak-pill{display:inline-flex;align-items:center;gap:6px;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;',
      'color:var(--dsw-alias-label-primary,#202124);background:color-mix(in srgb,var(--dsw-alias-bg-elevated,#fff) 92%,transparent);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:999px;padding:3px 12px;box-shadow:0 2px 8px rgba(0,0,0,.06);white-space:nowrap;}',
      '.dsh-balance-peak-pill .dsh-balance-peak-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;}',
      '.dsh-balance-peak-pill.is-peak{color:#b45309;background:#fff7ed;border-color:rgba(249,115,22,.35);}',
      '.dsh-balance-peak-pill.is-offpeak{color:#2563eb;background:#eff6ff;border-color:rgba(59,130,246,.3);}',
      '.dsh-balance-peak-pill.is-balance{color:#166534;background:#f0fdf4;border-color:rgba(22,163,74,.3);}',
      '.dsh-balance-peak-pill.is-depleted{color:#b91c1c;background:#fef2f2;border-color:rgba(220,38,38,.35);}',
      '.dsh-balance-peak-pill strong{font-variant-numeric:tabular-nums;font-weight:700;}',
      '.dsh-balance-peak-amount{font-variant-numeric:tabular-nums;font-weight:400;}',
      '.dsh-balance-peak-refresh{width:22px;height:22px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:50%;background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary,#202124);cursor:pointer;font-size:13px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.06);pointer-events:auto;}',
      '.dsh-balance-peak-refresh:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}',
      '@keyframes dsh-balance-peak-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      '.dsh-balance-peak-refresh.is-spinning{animation:dsh-balance-peak-spin .3s linear 1;cursor:wait;}',
      '.dsh-balance-peak-refresh:disabled{opacity:.6;cursor:default;}',
      '.dsh-balance-peak-refresh:disabled{opacity:.6;cursor:default;}',
      '.dsh-balance-peak-label{font-weight:700;}',
      '@media (max-width:600px){.dsh-balance-peak-bar{justify-content:flex-start;}}',
      // settings card (collapsible, mirrors the native plugin cards)
      '.dsh-balance-peak-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:14px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:0 1px 3px rgba(0,0,0,.04);}',
      '.dsh-balance-peak-cardHead{display:flex;align-items:center;gap:10px;width:100%;padding:14px 16px;border:none;background:transparent;cursor:pointer;text-align:left;font-family:inherit;}',
      '.dsh-balance-peak-cardHeadText{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;}',
      '.dsh-balance-peak-cardTitle{font:600 14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--dsw-alias-label-primary,#202124);}',
      '.dsh-balance-peak-cardDesc{font:13px/1.4 system-ui,sans-serif;color:var(--dsw-alias-label-tertiary,#888);}',
      '.dsh-balance-peak-cardPending{font:11px/1 system-ui,sans-serif;color:#b45309;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.4);border-radius:999px;padding:3px 8px;white-space:nowrap;}',
      '.dsh-balance-peak-chevron{font-size:14px;color:var(--dsw-alias-label-tertiary,#888);flex:none;}',
      '.dsh-balance-peak-cardBody{padding:0 16px 14px;border-top:1px dashed var(--dsw-alias-border-l2,rgba(0,0,0,.08));margin:0 0;}',
      '.dsh-balance-peak-fields{display:flex;flex-direction:column;gap:10px;padding-top:12px;}',
      '.dsh-balance-peak-fields label{display:flex;align-items:center;gap:6px;font:13px/1.4 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#202124);}',
      '.dsh-balance-peak-fields input[type=number]{width:90px;}',
      '.dsh-balance-peak-fields .dsh-balance-peak-position{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font:13px/1.4 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#202124);}',
      '.dsh-balance-peak-fields .dsh-balance-peak-position-label{font-weight:600;margin-right:2px;}',
      '.dsh-balance-peak-fields .dsh-balance-peak-posbtn{width:28px;height:26px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));border-radius:7px;background:var(--dsw-alias-bg-elevated,#fff);cursor:pointer;font-size:13px;line-height:1;color:var(--dsw-alias-label-primary,#202124);}',
      '.dsh-balance-peak-fields .dsh-balance-peak-posbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));}',
      '.dsh-balance-peak-fields .dsh-balance-peak-posval{color:var(--dsw-alias-label-tertiary,#888);margin-left:4px;font-variant-numeric:tabular-nums;}',
      '.dsh-balance-peak-fields .dsh-balance-peak-actions{display:flex;gap:8px;margin-top:2px;}',
      '.dsh-balance-peak-fields .dsh-balance-peak-actions button{font:12px/1.4 system-ui,sans-serif;padding:4px 12px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.15));background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-label-primary,#202124);}',
      '.dsh-balance-peak-none{color:var(--dsw-alias-label-tertiary,#888);}',
    ].join('')

    const inject = ['slots', 'settingsScope']

    function apply(ctx) {
      const slots = ctx.slots
      if (slots === undefined) return
      const settingsScope = ctx.settingsScope
      const scope = settingsScope && typeof settingsScope.bind === 'function'
        ? settingsScope.bind({ namespace: NS })
        : undefined

      // Pills sit ABOVE the composer card, aligned to its top-right. The
      // `conversation.input.overlay` anchor lives at the card's top (its own
      // absolute context), so `bottom:100%` lifts the row outside the card.
      slots.inject('conversation.input.overlay', () => slots.register({
        name: 'conversation.input.overlay',
        id: 'balance-peak',
        order: 100,
        inject: () => ({ scope }),
      }, BalancePeakDock))

      // Config card in Settings → Plugins. Guarded: the slot is declared by the
      // settings-plugins section, whose absence must not break the pills dock.
      if (scope !== undefined) {
        try {
          slots.inject('settings.plugin.item', () => slots.register({
            name: 'settings.plugin.item',
            key: NS,
            order: 500,
            inject: () => ({ scope }),
          }, SettingsCard))
        } catch { /* slot not declared this deployment */ }
      }

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-balance-peak'
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      }, 'dsh-balance-peak styles')
    }

    module.exports = { inject, apply }
    return module.exports
  },
})
