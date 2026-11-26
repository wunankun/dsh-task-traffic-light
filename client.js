/**
 * Web half of `dsh-task-traffic-light`.
 *
 * Two jobs:
 *
 * 1. The macOS app writes a click on the yellow or the green lamp as a small
 *    file, the Host half exposes it over the authenticated `/api` channel, and
 *    this module selects the requested Session in the Web UI.
 * 2. It reports back which Sessions DSH still marks as an unread completion
 *    (the green dot in front of a Session row), so the green lamp in the app
 *    only goes out once every dot has been cleared.
 *
 * It also adds one button to this plugin's own page in the plugin manager,
 * which installs or updates the companion macOS app. Every other plugin page
 * renders nothing: the contribution reads the page's `subject` and returns
 * null unless the subject is this package.
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-traffic-light',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = 'dsh-task-traffic-light'
    const FOCUS_ROUTE = 'api/task-light/focus'
    const APP_ROUTE = 'api/task-light/app'
    const POLL_MS = 500
    const STORAGE_KEY = 'dsh-task-light.last-focus.v1'

    const zh = String(window.navigator?.language ?? '').toLowerCase().startsWith('zh')
    const LABEL = zh
      ? {
        checking: '检测小应用…',
        install: '安装红绿灯小应用',
        installing: '正在下载安装…',
        opening: '正在开启…',
        open: '开启',
        running: '已开启',
        update: '可更新',
        retry: '重试安装',
        unreachable: '连不上插件',
      }
      : {
        checking: 'Checking the app…',
        install: 'Install the lamp app',
        installing: 'Downloading…',
        opening: 'Starting…',
        open: 'Start',
        running: 'Running',
        update: 'Update available',
        retry: 'Retry install',
        unreachable: 'plugin unreachable',
      }

    const buttonStyle = {
      font: 'inherit',
      fontSize: 13,
      lineHeight: '20px',
      padding: '3px 12px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.4))',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, inherit)',
      cursor: 'pointer',
    }

    const noteStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 13,
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
    }

    const stackStyle = {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
      lineHeight: '16px',
    }

    const linkStyle = {
      font: 'inherit',
      fontSize: 11,
      lineHeight: '14px',
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
      cursor: 'pointer',
      textDecoration: 'underline',
      textUnderlineOffset: 2,
    }

    const dotStyle = {
      width: 6,
      height: 6,
      borderRadius: 3,
      background: 'var(--dsw-alias-state-success, #30d158)',
    }

    /**
     * Send one action to the Host half over the shared authenticated channel.
     * @param {string} route - API path, without the leading slash.
     * @param {object} body - action payload.
     * @returns {Promise<object | null>} decoded result, or null when unreachable.
     */
    async function post(route, body) {
      try {
        const response = await window.fetch(route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
        })
        const data = await response.json().catch(() => null)
        if (data === null || typeof data !== 'object') return { error: `HTTP ${response.status}` }
        return data
      } catch (_error) {
        return null
      }
    }

    /**
     * The control on this plugin's page. It reports whether the companion app
     * is installed and whether it is open right now, and offers the one action
     * that makes sense: install, update, or start it.
     */
    function AppControl() {
      const [state, setState] = React.useState({ phase: 'checking' })
      const busy = React.useRef(false)

      /**
       * Fold one Host answer into the component state.
       * @param {object | null} result - `status`, `open` or `install` answer.
       */
      const absorb = React.useCallback(result => {
        if (result === null) {
          setState({ phase: 'error', message: LABEL.unreachable })
          return
        }
        if (typeof result.error === 'string') {
          setState({ phase: 'error', message: result.error })
          return
        }
        if (result.supported === false) {
          // The companion app is macOS-only: other hosts get no control at all.
          setState({ phase: 'hidden' })
          return
        }
        if (result.installed !== true) {
          setState({ phase: 'missing', latest: result.latest })
          return
        }
        const known = result.version !== undefined && result.version !== null
          && result.latest !== undefined && result.latest !== null
        setState({
          phase: result.running === true ? 'running' : 'stopped',
          version: result.version,
          latest: result.latest,
          update: known && result.version !== result.latest,
        })
      }, [])

      const query = React.useCallback(async () => {
        const result = await post(APP_ROUTE, { action: 'status' })
        if (!busy.current) absorb(result)
      }, [absorb])

      React.useEffect(() => {
        void query()
        // Quit or reopen the app while this page stays open, and the state follows.
        const ticker = window.setInterval(() => { void query() }, 3000)
        return () => { window.clearInterval(ticker) }
      }, [query])

      const install = React.useCallback(async () => {
        busy.current = true
        setState({ phase: 'installing' })
        absorb(await post(APP_ROUTE, { action: 'install' }))
        busy.current = false
      }, [absorb])

      const start = React.useCallback(async () => {
        busy.current = true
        setState({ phase: 'opening' })
        absorb(await post(APP_ROUTE, { action: 'open' }))
        busy.current = false
      }, [absorb])

      if (state.phase === 'checking') return h('span', { style: noteStyle }, LABEL.checking)
      if (state.phase === 'hidden') return null

      if (state.phase === 'installing' || state.phase === 'opening') {
        return h('button', {
          type: 'button',
          style: { ...buttonStyle, opacity: 0.55, cursor: 'default' },
          disabled: true,
        }, state.phase === 'opening' ? LABEL.opening : LABEL.installing)
      }

      const caption = state.update === true && state.latest !== undefined
        ? h('button', {
          type: 'button',
          style: linkStyle,
          onClick: install,
          title: `v${state.version} → v${state.latest}`,
        }, `${LABEL.update} v${state.latest}`)
        : null

      if (state.phase === 'running') {
        return h('span', { style: stackStyle },
          h('span', { style: noteStyle }, h('span', { style: dotStyle }), LABEL.running),
          caption)
      }

      if (state.phase === 'stopped') {
        return h('span', { style: stackStyle },
          h('button', { type: 'button', style: buttonStyle, onClick: start }, LABEL.open),
          caption)
      }

      const label = state.phase === 'error' ? LABEL.retry : LABEL.install
      return h('button', {
        type: 'button',
        style: buttonStyle,
        onClick: install,
        title: state.message,
      }, label)
    }

    /**
     * Detail-page contribution: only this package's own page shows a control.
     * @param {{ subject?: { kind?: string, pkg?: { name?: string } } }} props - page subject.
     * @returns {object | null} the button, or null on every other page.
     */
    function DetailAction({ subject }) {
      if (subject === undefined || subject === null) return null
      if (subject.kind !== 'bundle' && subject.kind !== 'row') return null
      if (subject.pkg === undefined || subject.pkg.name !== PACKAGE) return null
      if (subject.kind === 'row' && subject.row?.moduleName !== PACKAGE) return null
      return h(AppControl, null)
    }

    return {
      inject: ['uiWorkspace', 'uiSession', 'slots'],
      apply(ctx) {
        let disposed = false
        let polling = false
        let seen = lastNonce()
        /** Sessions that finished while this window was not in front of the user. */
        const backgroundDone = new Set()
        /** Last running state seen per Session, so a stop can be noticed at all. */
        const lastRunning = new Map()
        /** Whether the DSH window is out of sight right now. */
        let background = isBackground()

        /**
         * Read the last click this page already applied, so a reload does not
         * navigate again before the Host retires the request.
         * @returns {string} nonce, or an empty string.
         */
        function lastNonce() {
          try {
            return window.localStorage.getItem(STORAGE_KEY) ?? ''
          } catch (_error) {
            return ''
          }
        }

        /**
         * Remember one applied click without making storage failure fatal.
         * @param {string} nonce - request identity.
         */
        function rememberNonce(nonce) {
          try {
            window.localStorage.setItem(STORAGE_KEY, nonce)
          } catch (_error) {
            // Private mode or a disabled store only means a reload may repeat it.
          }
        }

        /**
         * Is the DSH window out of sight? A hidden tab or another window on
         * top both mean the user is not watching, which is exactly when a
         * completion should light the lamp even if DSH itself would not mark it.
         * @returns {boolean} true when the page is hidden or unfocused.
         */
        function isBackground() {
          if (document.visibilityState !== 'visible') return true
          return document.hasFocus() === false
        }

        /**
         * Notice sessions that stopped running while the window was hidden.
         * DSH only marks a completion unread when the session is not the main
         * view, so a session you are "looking at" from another window would
         * otherwise never reach the lamp.
         */
        function trackBackgroundCompletions() {
          let statuses
          try {
            statuses = ctx.uiSession.sessionStatus.getSnapshot()
          } catch (_error) {
            return
          }
          const present = new Set()
          for (const [id, status] of statuses) {
            const key = String(id)
            present.add(key)
            const running = status !== undefined && status.running === true
            const previous = lastRunning.get(key)
            if (running) {
              backgroundDone.delete(key)
            } else if (previous === true && background) {
              backgroundDone.add(key)
            }
            lastRunning.set(key, running)
          }
          for (const key of lastRunning.keys()) {
            if (!present.has(key)) lastRunning.delete(key)
          }
        }

        /**
         * Everything the green lamp should account for: DSH's own reminder
         * dots plus the completions seen while the window was out of sight.
         * @returns {string[]} Session ids.
         */
        function reportedCompleted() {
          const ids = new Set(unreadSessionIds())
          for (const id of backgroundDone) ids.add(id)
          return [...ids]
        }

        /**
         * Sessions whose completion the user still has not opened, as DSH's
         * own reminder dots see them.
         * @returns {string[]} Session ids; empty when the status source is not ready.
         */
        function unreadSessionIds() {
          try {
            const ids = []
            for (const [id, status] of ctx.uiSession.sessionStatus.getSnapshot()) {
              if (status !== undefined && status.completionUnread === true) ids.push(String(id))
            }
            return ids
          } catch (_error) {
            // Before the Session source settles there is simply nothing to report.
            return []
          }
        }

        async function poll() {
          if (polling || disposed) return
          polling = true
          try {
            background = isBackground()
            trackBackgroundCompletions()
            // One request carries both directions: which Sessions still need a
            // look, and whether a lamp click waits to be applied.
            const result = await post(FOCUS_ROUTE, { action: 'poll', completed: reportedCompleted() })
            const request = result?.request
            if (request === null || request === undefined || typeof request !== 'object') return
            const { sessionId, nonce } = request
            if (typeof sessionId !== 'string' || sessionId.length === 0) return
            if (typeof nonce !== 'string' || nonce.length === 0 || nonce === seen) return
            seen = nonce
            rememberNonce(nonce)
            try {
              ctx.uiWorkspace.openSession(sessionId)
            } catch (_error) {
              // A Session that disappeared between the click and the poll is
              // nothing the user can act on here.
            }
            await post(FOCUS_ROUTE, { action: 'ack', nonce })
          } catch (_error) {
            // The route appears with the Host plugin and disappears while it
            // reloads; the next tick retries.
          } finally {
            polling = false
          }
        }

        ctx.effect(() => {
          /**
           * Coming back to the window means the user has seen it: the
           * background-only completions stop holding the green lamp on.
           */
          const onFocusChange = () => {
            const next = isBackground()
            if (background && !next) backgroundDone.clear()
            background = next
          }
          window.addEventListener('visibilitychange', onFocusChange)
          window.addEventListener('focus', onFocusChange)
          window.addEventListener('blur', onFocusChange)

          const ticker = window.setInterval(() => { void poll() }, POLL_MS)
          return () => {
            disposed = true
            window.clearInterval(ticker)
            window.removeEventListener('visibilitychange', onFocusChange)
            window.removeEventListener('focus', onFocusChange)
            window.removeEventListener('blur', onFocusChange)
          }
        }, 'task-light-bridge: focus poll')

        ctx.effect(() => ctx.slots.inject('plugins.detail.actions', () =>
          ctx.slots.register({
            name: 'plugins.detail.actions',
            id: 'dsh-task-traffic-light-app',
            order: 40,
          }, DetailAction)), 'task-light-bridge: app install action')
      },
    }
  },
})
