/**
 * Host half of the task traffic light: publishes a tiny state file that the
 * standalone TaskTrafficLight macOS app watches. No UI and no network access.
 *
 * The three lamps are independent: running work, a pending human interaction,
 * and an unread completion can all be true at once.
 *
 * A click on the yellow or the green lamp is delivered by the macOS app as
 * `focus.json` and handed to the Web UI over the local Connection RPC channel,
 * where the client half selects the target Session.
 *
 * The green lamp is owned by the Web UI: the client half reports which
 * Sessions still carry a completion-reminder dot ("finished while you were
 * elsewhere, not opened since"), so the lamp only goes out once the user has
 * opened every such Session and DSH has cleared its own dot.
 */
import { execFile, spawn } from 'node:child_process'
import {
  accessSync, constants, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'task-traffic-light'
export const inject = ['agents']

const STATE_DIR = join(homedir(), '.dsh', 'task-traffic-light')
const STATE_FILE = join(STATE_DIR, 'state.json')
/** Click request written by the macOS app; read here and handed to the Web UI. */
const FOCUS_FILE = join(STATE_DIR, 'focus.json')
/** How long an unanswered lamp click stays valid, in milliseconds. */
const FOCUS_TTL_MS = 30_000
/** How often the snapshot is considered for a rewrite. */
const TICK_MS = 500
/** A stale state file must still be refreshed at least this often. */
const HEARTBEAT_MS = 2_500
/** Sliding window used to estimate the live output speed. */
const SPEED_WINDOW_MS = 2_500
/** The shortest span a fresh stream is averaged over, so the first second is not inflated. */
const MIN_SPAN_MS = 700
/** The companion app this plugin is half of; its version tracks the macOS release. */
const APP_VERSION = '1.0.3'
const APP_NAME = 'TaskTrafficLight.app'
/** Version-free asset name, so this URL keeps resolving after every release. */
const APP_ZIP_URL = 'https://github.com/wunankun/dsh-task-traffic-light/releases/latest/download/TaskTrafficLight.zip'
/** The companion app is macOS-only; other hosts simply have no button. */
const macOS = process.platform === 'darwin'

/** State file layout version; the macOS app tolerates older and newer fields. */
const STATE_VERSION = 6
/** Most Session ids one report may carry; a guard against a runaway client. */
const MAX_REPORTED = 200


/**
 * Where the companion app lives: `/Applications` when the user can write
 * there, the per-user folder otherwise.
 * @returns {string} directory path.
 */
function appDirectory() {
  try {
    accessSync('/Applications', constants.W_OK)
    return '/Applications'
  } catch (error) {
    return join(homedir(), 'Applications')
  }
}

/**
 * Version of the installed companion app, read from its own Info.plist.
 * @returns {string | null} version, or null when the app is not installed.
 */
function installedAppVersion() {
  try {
    const plist = readFileSync(join(appDirectory(), APP_NAME, 'Contents', 'Info.plist'), 'utf8')
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)
    return match === null ? null : match[1].trim()
  } catch (error) {
    return null
  }
}

/**
 * Whether the companion app is running right now. Matching is by the bundle's
 * own executable path, which is what the update path stops as well.
 * @returns {Promise<boolean>} true while the process exists.
 */
function appRunning() {
  return new Promise(resolve => {
    execFile('/usr/bin/pgrep', ['-f', `${APP_NAME}/Contents/MacOS/TaskTrafficLight`], error => {
      resolve(error === null)
    })
  })
}

/**
 * Run one macOS command and reject with its stderr.
 * @param {string} command - absolute executable path.
 * @param {string[]} args - arguments.
 * @returns {Promise<string>} stdout.
 */
function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout)
      else reject(new Error((stderr || error.message).trim() || `${command} failed`))
    })
  })
}

/**
 * Download the latest release and install it over the existing copy. Only the
 * system's own unarchiver, de-quarantine and open commands are used, and only
 * when the user presses the install button on the plugin page.
 * @returns {Promise<string | null>} the installed version.
 */
async function installApp() {
  const work = mkdtempSync(join(tmpdir(), 'dsh-traffic-light-'))
  try {
    const response = await fetch(APP_ZIP_URL, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
    const zip = join(work, 'app.zip')
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()))

    const unpacked = join(work, 'unpacked')
    mkdirSync(unpacked, { recursive: true })
    await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked])

    // Stop the running copy first: replacing the bundle on disk would leave
    // the old binary running in memory. Quitting through AppleScript would ask
    // for an automation grant, so the process is stopped directly.
    await run('/usr/bin/pkill', ['-f', `${APP_NAME}/Contents/MacOS/TaskTrafficLight`]).catch(() => {})

    mkdirSync(appDirectory(), { recursive: true })
    const target = join(appDirectory(), APP_NAME)
    rmSync(target, { recursive: true, force: true })
    await run('/usr/bin/ditto', [join(unpacked, APP_NAME), target])
    // The release build is ad-hoc signed, so a download carries quarantine.
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', target]).catch(() => {})
    await run('/usr/bin/open', [target]).catch(() => {})
    return installedAppVersion()
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * What the plugin page needs to know about the companion app: whether it is
 * installed, which version, and whether it is open right now.
 * @returns {Promise<{ installed: boolean, version: string | null, latest: string, running: boolean, supported: boolean }>} state.
 */
async function appStatus() {
  const version = macOS ? installedAppVersion() : null
  return {
    installed: version !== null,
    version,
    latest: APP_VERSION,
    running: version !== null && macOS ? await appRunning() : false,
    supported: macOS,
  }
}

/**
 * Keep an already-installed companion app current: a plugin update that ships
 * a newer app replaces it on the next start, so there is only one thing to
 * update. A missing app is left alone — installing is always the user's click.
 * @param {number} delayMs - wait before touching the network.
 * @returns {() => void} cancels the pending check.
 */
function scheduleAppUpdate(delayMs = 3_000) {
  if (!macOS) return () => {}
  const timer = setTimeout(() => {
    const installed = installedAppVersion()
    if (installed === null || installed === APP_VERSION) return
    void installApp().catch(() => {
      // Offline, or GitHub unreachable: the next start tries again.
    })
  }, delayMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearTimeout(timer)
}

/** The plugin's own name, as it is listed in a profile manifest. */
const PACKAGE_NAME = 'dsh-task-traffic-light'
/** Every profile that names this plugin shares the one companion app. */
const PROFILES_DIR = join(homedir(), '.dsh', 'profiles')
/** The companion app's preferences domain, cleared together with its bundle. */
const APP_DEFAULTS_DOMAIN = 'local.tasktrafficlight'

/**
 * Shell script that removes the companion app once no profile names this
 * plugin any more. DSH has no uninstall hook: removing a bundle first
 * deselects it and reloads (which disposes this plugin), then removes the
 * dependency. So the check starts just after the dispose, keeps polling for
 * the dependency to disappear, and exits untouched when any profile — the
 * current one after a reload, or another one all along — still wants it.
 */
const UNINSTALL_CHECK = `
still_wanted() {
  for manifest in "$LIGHT_PROFILE_ROOT"/*/package.json; do
    [ -f "$manifest" ] || continue
    grep -q "$LIGHT_PACKAGE" "$manifest" && return 0
  done
  return 1
}
attempt=0
misses=0
while [ "$attempt" -lt 12 ]; do
  sleep 5
  if still_wanted; then misses=0; else misses=$((misses + 1)); fi
  [ "$misses" -ge 2 ] && break
  attempt=$((attempt + 1))
done
[ "$misses" -ge 2 ] || exit 0
pkill -f "TaskTrafficLight.app/Contents/MacOS/TaskTrafficLight" 2>/dev/null
sleep 1
rm -rf "$LIGHT_APP_PATH" "$LIGHT_USER_APP_PATH"
defaults delete "$LIGHT_DEFAULTS_DOMAIN" 2>/dev/null
rm -f "$HOME/Library/Preferences/$LIGHT_DEFAULTS_DOMAIN.plist"
rm -rf "$LIGHT_STATE_DIR"
exit 0
`

/**
 * Whether any profile still selects this bundle. A reload or a shutdown keeps
 * it selected; an uninstall deselects it before the dependency is removed, and
 * a plain disable deselects it while keeping the dependency.
 * @returns {boolean} true while some profile lists the bundle.
 */
function selectedInSomeProfile() {
  let profiles
  try {
    profiles = readdirSync(PROFILES_DIR)
  } catch (error) {
    // An unreadable profile root is not evidence of an uninstall.
    return true
  }
  for (const name of profiles) {
    try {
      const manifest = JSON.parse(readFileSync(join(PROFILES_DIR, name, 'package.json'), 'utf8'))
      const bundles = manifest?.dsh?.profile?.bundles
      if (Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)) return true
    } catch (error) {
      // A profile without a readable manifest cannot want the app.
    }
  }
  return false
}

/**
 * Hand the companion app's removal to a detached process, so it can outlive
 * both this plugin and the DSH process that uninstalled it. A reload keeps the
 * bundle selected and spawns nothing.
 */
function scheduleUninstallCleanup() {
  if (!macOS || selectedInSomeProfile()) return
  try {
    const child = spawn('/bin/sh', ['-c', UNINSTALL_CHECK], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LIGHT_PACKAGE: PACKAGE_NAME,
        LIGHT_PROFILE_ROOT: PROFILES_DIR,
        LIGHT_APP_PATH: join('/Applications', APP_NAME),
        LIGHT_USER_APP_PATH: join(homedir(), 'Applications', APP_NAME),
        LIGHT_DEFAULTS_DOMAIN: APP_DEFAULTS_DOMAIN,
        LIGHT_STATE_DIR: STATE_DIR,
      },
    })
    child.unref()
  } catch (error) {
    // Without a shell the app simply stays installed; the plugin is gone anyway.
  }
}

/**
 * Publish task state to the macOS app.
 *
 * Only top-level sessions count: a subagent belongs to the session that
 * started it, so its work never adds to the red count and its stop never
 * lights green on its own. Pending questions and approvals still count
 * globally because they always need the human.
 */
export function apply(ctx, config) {
  /** @type {Map<object, boolean>} top-level agent -> running */
  const sessions = new Map()
  /** @type {WeakSet<object>} agents owned by a session, excluded from counts */
  const subagents = new WeakSet()
  /** @type {Map<symbol, { kind: string, sessionId: string | undefined, since: number }>} pending interaction -> details */
  const pending = new Map()
  /** @type {Map<object, Array<{ t: number, tokens: number }>>} agent -> recent output samples */
  const streams = new Map()
  /** Session ids the Web UI still marks with a completion-reminder dot, newest report wins. */
  let reportedUnread = []
  /** @type {Map<string, number>} Session id -> when it last stopped running, for the green queue. */
  const stoppedAt = new Map()
  /** @type {Map<string, number>} Session id -> when it started running, for the red queue. */
  const startedAt = new Map()
  /** Latest top-level completion, kept until a newer one replaces it. */
  let doneAt = 0
  /** Latest yellow-lamp click waiting for the Web UI, or null once answered. */
  let focusRequest = null
  /** Contents of the last focus file read, so an unchanged file is not re-parsed. */
  let focusFileSignature = ''
  let lastSignature = ''
  let lastWriteAt = 0

  /**
   * Whether an agent is a subagent child rather than a session the user opened.
   * @param {object} agent - live agent.
   * @returns {boolean} true when the session header marks it as a subagent.
   */
  function isSubagent(agent) {
    return agent.session?.header?.origin === 'subagent'
  }

  /**
   * Session the user sees for one pending interaction: a subagent belongs to
   * the top-level Session that opened it, so walking up its live parents picks
   * the row a click should select.
   * @param {object | undefined} agent - agent that asked for the human.
   * @returns {string | undefined} top-level Session id when known.
   */
  function visibleSessionId(agent) {
    let header = agent?.session?.header
    let guard = 0
    while (header?.origin === 'subagent' && header.parentSession !== undefined && guard < 16) {
      const parent = ctx.agents.get(header.parentSession)
      if (parent?.session === undefined) break
      header = parent.session.header
      guard += 1
    }
    return header?.id
  }

  /**
   * Waiting Sessions in request order, without duplicates. The first one is
   * what a click on the yellow lamp selects.
   * @returns {string[]} Session ids.
   */
  function waitingSessionIds() {
    const ids = []
    const seen = new Set()
    for (const entry of pending.values()) {
      if (entry.sessionId === undefined || seen.has(entry.sessionId)) continue
      seen.add(entry.sessionId)
      ids.push(entry.sessionId)
    }
    return ids
  }

  /**
   * Session id behind one tracked agent.
   * @param {object} agent - live agent.
   * @returns {string | undefined} Session id when the agent exposes one.
   */
  function sessionIdOf(agent) {
    return agent?.session?.header?.id
  }

  /**
   * Sessions the user still owes a look, oldest completion first. Only ids the
   * Web UI reported as unread count, and only top-level Sessions are kept:
   * a subagent row never appears in the list and could never be cleared by
   * opening it, so it must not hold the green lamp on.
   * @returns {string[]} Session ids, first one is what a click on the green lamp selects.
   */
  function completedSessionIds() {
    const known = new Set()
    for (const agent of sessions.keys()) {
      const id = sessionIdOf(agent)
      if (id !== undefined) known.add(id)
    }
    const ids = reportedUnread.filter(id => known.has(id))
    // Array.prototype.sort is stable, so ids without a stop stamp keep report order.
    ids.sort((left, right) => (stoppedAt.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (stoppedAt.get(right) ?? Number.MAX_SAFE_INTEGER))
    return ids
  }

  /**
   * Replace the client-reported unread set, rejecting malformed entries.
   * @param {unknown} input - candidate list from the Web UI.
   * @returns {boolean} true when the stored set changed.
   */
  function setReportedUnread(input) {
    const next = []
    const seen = new Set()
    if (Array.isArray(input)) {
      for (const value of input) {
        if (typeof value !== 'string' || value.length === 0 || value.length > 200) continue
        if (seen.has(value)) continue
        seen.add(value)
        next.push(value)
        if (next.length >= MAX_REPORTED) break
      }
    }
    const unchanged = next.length === reportedUnread.length
      && next.every((id, index) => id === reportedUnread[index])
    if (unchanged) return false
    reportedUnread = next
    return true
  }

  for (const agent of ctx.agents.list()) {
    if (isSubagent(agent)) {
      subagents.add(agent)
      continue
    }
    sessions.set(agent, agent.status === 'running')
  }

  function runningCount() {
    return runningSessionIds().length
  }

  /**
   * Sessions running right now, oldest start first. The app walks this list on
   * every click of the red lamp, so the order has to be stable while they run.
   * @returns {string[]} Session ids.
   */
  function runningSessionIds() {
    const ids = []
    for (const [agent, running] of sessions) {
      if (!running) continue
      const id = sessionIdOf(agent)
      if (id !== undefined) ids.push(id)
    }
    ids.sort((left, right) => (startedAt.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (startedAt.get(right) ?? Number.MAX_SAFE_INTEGER))
    return ids
  }

  function summaryTone() {
    if (pending.size > 0) return 'waiting'
    if (runningCount() > 0) return 'running'
    if (doneAt > 0 || completedSessionIds().length > 0) return 'done'
    return 'idle'
  }

  /**
   * Rough output-token estimate for one streamed delta: CJK and other wide
   * characters cost about one token each, everything else about four
   * characters per token.
   * @param {string} text - one streamed delta.
   * @returns {number} estimated tokens.
   */
  function estimateTokens(text) {
    let wide = 0
    let narrow = 0
    for (const character of text) {
      const code = character.codePointAt(0)
      if (code >= 0x2e80) wide += 1
      else if (code > 0x20 && code !== 0x7f) narrow += 1
    }
    return wide + narrow / 4
  }

  /**
   * Record one streamed delta and drop samples that left the window.
   * @param {object} agent - the agent that produced the delta.
   * @param {unknown} frame - one `agent/assistant-stream` publication.
   */
  function recordFrame(agent, frame) {
    if (frame === undefined || frame === null || frame.type !== 'chunk') return
    const chunk = frame.chunk
    if (chunk === undefined || chunk === null) return
    let text
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') text = chunk.text
    else if (chunk.type === 'tool-call-delta') text = chunk.argumentsDelta
    if (typeof text !== 'string' || text.length === 0) return
    const tokens = estimateTokens(text)
    if (tokens <= 0) return
    const now = Date.now()
    const samples = streams.get(agent)
    if (samples === undefined) streams.set(agent, [{ t: now, tokens }])
    else samples.push({ t: now, tokens })
  }

  /**
   * Sum the in-window output across every streaming agent and divide by the
   * watched span.
   * @param {number} now - current time in milliseconds.
   * @returns {number} estimated tokens per second.
   */
  function currentSpeed(now) {
    const cutoff = now - SPEED_WINDOW_MS
    let tokens = 0
    let earliest = now
    for (const [agent, samples] of streams) {
      let expired = 0
      while (expired < samples.length && samples[expired].t < cutoff) expired += 1
      if (expired > 0) samples.splice(0, expired)
      if (samples.length === 0) {
        streams.delete(agent)
        continue
      }
      for (const sample of samples) {
        tokens += sample.tokens
        if (sample.t < earliest) earliest = sample.t
      }
    }
    if (tokens <= 0) return 0
    const span = Math.max(MIN_SPAN_MS, now - Math.max(cutoff, earliest))
    return (tokens * 1000) / span
  }

  /**
   * Read a new click request written by the macOS app. An unchanged file is
   * ignored, and a click only navigates to a Session the lamp it came from
   * still stands for, so a stale request cannot switch the page on its own.
   * @param {number} now - current time in milliseconds.
   */
  function readFocusFile(now) {
    let text
    try {
      text = readFileSync(FOCUS_FILE, 'utf8')
    } catch (error) {
      return
    }
    if (text === focusFileSignature) return
    focusFileSignature = text
    let request
    try {
      request = JSON.parse(text)
    } catch (error) {
      return
    }
    if (request === null || typeof request !== 'object') return
    const { sessionId, nonce } = request
    const lamp = request.lamp === 'green' ? 'green' : request.lamp === 'red' ? 'red' : 'yellow'
    const at = typeof request.at === 'number' ? request.at : now
    if (typeof sessionId !== 'string' || typeof nonce !== 'string') return
    if (now - at > FOCUS_TTL_MS || at - now > 5_000) return
    const targets = lamp === 'green'
      ? completedSessionIds()
      : lamp === 'red' ? runningSessionIds() : waitingSessionIds()
    if (!targets.includes(sessionId)) return
    focusRequest = { sessionId, nonce, at, lamp }
  }

  /**
   * Current click request, if it has not expired.
   * @returns {{ sessionId: string, nonce: string, at: number, lamp: 'yellow' | 'green' } | null} request.
   */
  function takeFocusRequest() {
    if (focusRequest === null) return null
    if (Date.now() - focusRequest.at > FOCUS_TTL_MS) {
      focusRequest = null
      return null
    }
    return { ...focusRequest }
  }

  /**
   * Retire a click request once the Web UI has selected its Session.
   * @param {unknown} nonce - request identity echoed by the client.
   * @returns {boolean} true when the request was current or already retired.
   */
  function acknowledgeFocus(nonce) {
    if (focusRequest === null) return true
    if (typeof nonce !== 'string' || focusRequest.nonce !== nonce) return false
    focusRequest = null
    return true
  }

  function buildPayload() {
    const now = Date.now()
    const running = runningCount()
    const speed = running > 0 ? Math.round(currentSpeed(now) * 10) / 10 : null
    return {
      version: STATE_VERSION,
      tone: summaryTone(),
      sessions: sessions.size,
      running,
      pending: pending.size,
      waitingSessions: waitingSessionIds(),
      completedSessions: completedSessionIds(),
      runningSessions: runningSessionIds(),
      updatedAt: now,
      doneAt: doneAt > 0 ? doneAt : null,
      tokensPerSecond: speed,
    }
  }

  /**
   * Rewrite the state file when something visible changed, or when the
   * heartbeat interval elapsed.
   * @param {boolean} force - write even when the snapshot is unchanged.
   */
  function publish(force = false) {
    const now = Date.now()
    readFocusFile(now)
    const payload = buildPayload()
    const signature = JSON.stringify([payload.running, payload.pending, payload.sessions,
      payload.waitingSessions, payload.completedSessions, payload.runningSessions,
      payload.doneAt, payload.tokensPerSecond])
    if (!force && signature === lastSignature && now - lastWriteAt < HEARTBEAT_MS) return
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      const temporary = STATE_FILE + '.tmp'
      writeFileSync(temporary, JSON.stringify(payload) + '\n', 'utf8')
      renameSync(temporary, STATE_FILE)
      lastSignature = signature
      lastWriteAt = now
    } catch (error) {
      // The app treats a missing or stale file as idle; never break the Host.
    }
  }

  /**
   * Track one pending interaction until the human answers it.
   * @param {string} kind - approval or question.
   * @param {object | undefined} agent - agent the interaction belongs to.
   * @returns {() => void} release function.
   */
  function trackPending(kind, agent) {
    const key = Symbol(kind)
    pending.set(key, { kind, sessionId: visibleSessionId(agent), since: Date.now() })
    publish(true)
    return () => {
      if (!pending.delete(key)) return
      publish(true)
    }
  }

  // These are waterfalls that DSH itself forwards to the web client, which
  // awaits the human answer before calling `next()`. Registering with
  // `prepend` keeps this bookkeeping outside that forwarder; otherwise the
  // pending state would only appear after the answer arrived.
  ctx.on('approval/request', async (request, next) => {
    const release = trackPending('approval', request.agent)
    try {
      return await next()
    } finally {
      release()
    }
  }, { prepend: true })

  ctx.on('user-questions/request', async (request, next) => {
    const release = trackPending('question', request.agent)
    try {
      return await next()
    } finally {
      release()
    }
  }, { prepend: true })

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    recordFrame(agent, frame)
  })

  ctx.on('agent/created', ({ agent }) => {
    if (isSubagent(agent)) {
      subagents.add(agent)
      return
    }
    sessions.set(agent, agent.status === 'running')
    publish(true)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (subagents.has(agent)) return
    const wasRunning = sessions.get(agent) === true
    sessions.set(agent, status === 'running')
    const sessionId = sessionIdOf(agent)
    if (sessionId !== undefined) {
      if (status === 'running') {
        stoppedAt.delete(sessionId)
        startedAt.set(sessionId, Date.now())
      } else if (wasRunning) {
        startedAt.delete(sessionId)
        stoppedAt.set(sessionId, Date.now())
      }
    }
    if (wasRunning && status !== 'running') doneAt = Date.now()
    publish(true)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    streams.delete(agent)
    if (subagents.has(agent)) return
    const sessionId = sessionIdOf(agent)
    if (sessionId !== undefined) {
      stoppedAt.delete(sessionId)
      startedAt.delete(sessionId)
    }
    sessions.delete(agent)
    publish(true)
  })

  // The click is only a UI navigation; it travels over the same authenticated
  // Connection transport as the rest of the Web client, so no extra port,
  // server, or network access is opened.
  // The click is only a UI navigation. It travels over the same authenticated
  // `/api` Fetch channel as the rest of the Web client, so no extra port,
  // server, or network access is opened. An exact Fetch route is used instead
  // of a logical RPC channel because the Connection service in this release
  // cannot mount a new physical route from the profile's composition.
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const disposeApp = scope.connection.fetch.register({
        path: '/api/task-light/app',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          let body
          try {
            body = await request.json()
          } catch (error) {
            return Response.json({ error: 'body is not JSON' }, { status: 400 })
          }
          if (body !== null && typeof body === 'object' && body.action === 'status') {
            return Response.json(await appStatus())
          }
          if (body !== null && typeof body === 'object' && body.action === 'open') {
            if (!macOS) return Response.json({ error: 'the companion app is macOS only' }, { status: 501 })
            if (installedAppVersion() === null) {
              return Response.json({ error: 'not installed yet' }, { status: 404 })
            }
            await run('/usr/bin/open', [join(appDirectory(), APP_NAME)]).catch(() => {})
            // Give the process a moment to appear before reporting it.
            await new Promise(resolve => setTimeout(resolve, 700))
            return Response.json(await appStatus())
          }
          if (body !== null && typeof body === 'object' && body.action === 'install') {
            if (!macOS) {
              return Response.json({ error: 'the companion app is macOS only' }, { status: 501 })
            }
            try {
              await installApp()
              await new Promise(resolve => setTimeout(resolve, 700))
              return Response.json(await appStatus())
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return Response.json({ error: message }, { status: 500 })
            }
          }
          return Response.json({ error: `unknown action: ${String(body?.action)}` }, { status: 400 })
        },
      })
      const dispose = scope.connection.fetch.register({
        path: '/api/task-light/focus',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          let body
          try {
            body = await request.json()
          } catch (error) {
            return Response.json({ error: 'body is not JSON' }, { status: 400 })
          }
          if (body === null || typeof body !== 'object') {
            return Response.json({ error: 'body must be an object' }, { status: 400 })
          }
          if (body.action === 'poll') {
            // The page also reports which Sessions still carry a completion
            // dot, so the green lamp follows DSH's own reminder instead of a
            // timestamp the app would have to dismiss on its own.
            if (setReportedUnread(body.completed)) publish(true)
            readFocusFile(Date.now())
            return Response.json({ request: takeFocusRequest() })
          }
          if (body.action === 'ack') {
            return Response.json({ acknowledged: acknowledgeFocus(body.nonce) })
          }
          return Response.json({ error: `unknown action: ${String(body.action)}` }, { status: 400 })
        },
      })
      return () => {
        void disposeApp()
        void dispose()
      }
    }, 'task-light-bridge: focus route')
  })

  ctx.effect(() => {
    publish(true)
    const ticker = setInterval(() => publish(), TICK_MS)
    if (typeof ticker.unref === 'function') ticker.unref()
    const cancelAppUpdate = config?.autoUpdateApp === false ? () => {} : scheduleAppUpdate()
    return () => {
      clearInterval(ticker)
      cancelAppUpdate()
      scheduleUninstallCleanup()
      try {
        mkdirSync(STATE_DIR, { recursive: true })
        const temporary = STATE_FILE + '.tmp'
        writeFileSync(temporary, JSON.stringify({
          version: STATE_VERSION,
          tone: 'idle',
          sessions: 0,
          running: 0,
          pending: 0,
          waitingSessions: [],
          completedSessions: [],
          runningSessions: [],
          updatedAt: Date.now(),
          doneAt: null,
          tokensPerSecond: null,
        }) + '\n', 'utf8')
        renameSync(temporary, STATE_FILE)
      } catch (error) {
        // A stale file only makes the app show idle after its freshness window.
      }
    }
  }, 'task-light-bridge: publish state')
}
