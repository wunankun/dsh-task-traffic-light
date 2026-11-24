/**
 * Web half of `dsh-task-traffic-light`.
 *
 * The macOS app writes a click on the yellow or the green lamp as a small
 * file, the Host half exposes it over the authenticated `/api` channel, and
 * this module selects the requested Session in the Web UI. No visible surface
 * is added.
 *
 * It also reports back which Sessions DSH still marks as an unread completion
 * (the green dot in front of a Session row). The green lamp in the macOS app
 * follows that set, so it only goes out once every dot has been cleared.
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-traffic-light',
  factory() {
    const ROUTE = 'api/task-light/focus'
    const POLL_MS = 500
    const STORAGE_KEY = 'dsh-task-light.last-focus.v1'

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

    return {
      inject: ['uiWorkspace', 'uiSession'],
      apply(ctx) {
        let disposed = false
        let polling = false
        let seen = lastNonce()

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

        /**
         * Send one action to the Host half over the shared API channel.
         * @param {object} body - action payload.
         * @returns {Promise<object | null>} decoded result, or null when unavailable.
         */
        async function post(body) {
          const response = await window.fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'same-origin',
          })
          if (!response.ok) return null
          return await response.json()
        }

        async function poll() {
          if (polling || disposed) return
          polling = true
          try {
            // One request carries both directions: which Sessions still have a
            // reminder dot, and whether a lamp click waits to be applied.
            const result = await post({ action: 'poll', completed: unreadSessionIds() })
            const request = result?.request
            if (request === null || typeof request !== 'object') return
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
            await post({ action: 'ack', nonce })
          } catch (_error) {
            // The route appears with the Host plugin and disappears while it
            // reloads; the next tick retries.
          } finally {
            polling = false
          }
        }

        ctx.effect(() => {
          const ticker = window.setInterval(() => { void poll() }, POLL_MS)
          return () => {
            disposed = true
            window.clearInterval(ticker)
          }
        }, 'task-light-bridge: focus poll')
      },
    }
  },
})
