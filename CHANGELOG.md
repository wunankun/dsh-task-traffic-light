# Changelog

## 0.10.2 — 2026-11-25

- The panel no longer draws an outer shadow: it sits flat on the desktop,
  with only the lit border and the lamps' own glow. Companion app 1.4.

## 0.10.1 — 2026-11-25

Same release as 0.10.0. npm kept the first upload in its staging area for a
few minutes, so the tag move needed a second version number.

## 0.10.0 — 2026-11-25

- The red lamp is clickable too: each click moves to the next running session,
  in the order they started. Every clickable lamp shows a pointing hand.
- A session that finishes while the DSH window is out of sight now counts as
  unread, even when it is the one selected: DSH only knows the main view, not
  whether its window is visible. Coming back to the window clears it.
- Companion app 1.3.

## 0.9.0 — 2026-11-25

- The README is Chinese by default now, with switchers to English, Spanish,
  Japanese and Korean.
- The plugin card also ships Spanish and Japanese text, following DSH's own
  interface language.

## 0.8.0 — 2026-11-25

- The plugin page now reports whether the lamp is open, not just installed:
  a stopped app gets a **Start the lamp app** button, a running one shows
  *Running*, and the state follows the app within a few seconds of quitting or
  reopening it.

## 0.5.0 — 2026-11-25

- An installed companion app now follows the plugin: on startup the plugin
  compares the installed version with the one it ships and replaces a stale
  copy, so updating the plugin is the only update there is. A missing app is
  never installed on its own — that stays the button's job.
- Updating stops the running lamp first, so the new build is what actually
  starts; before, the old process kept running from memory.

## 0.4.0 — 2026-11-25

- The plugin's own page in the plugin manager gets a button that installs or
  updates the companion macOS app: it downloads the release, unpacks it into
  `/Applications`, clears the quarantine flag and launches it. When the app is
  already installed the button turns into a version readout.
- Installing is the only thing that touches the network, and only when that
  button is pressed.

## 0.3.0 — 2026-11-25

First public release.

- Three independent lamps: red while top-level sessions run, yellow while something waits for the human, green while finished sessions are still unread.
- Clicking the yellow lamp opens the first waiting session; clicking the green lamp opens the oldest unread one. Both bring DSH to the front.
- The green lamp mirrors DSH's own unread completion dots instead of a dismissing timestamp, so it goes out only when every dot has been cleared.
- Subagent sessions are filtered out of every count.
- No port, no network access, no shell commands: one JSON state file and one JSON click file under `~/.dsh/task-traffic-light/`.
- Universal macOS build (Apple silicon + Intel), macOS 13+.
