# Changelog

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
