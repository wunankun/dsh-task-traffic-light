# DSH Task Traffic Light

A floating traffic light for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) on macOS. It sits at the edge of your screen and tells you what your agents are doing — without switching windows to find out.

<img src="docs/demo.gif" width="452" alt="The lamp lights as sessions run and wait; it stays green until you open the finished session.">

[简体中文](README.md) · **English** · [Español](README.es.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [MIT](LICENSE)

## Three lamps, three facts

| Lamp | Lit while | Click it and it |
|---|---|---|
| 🔴 red | at least one top-level session is running | brings DSH forward and opens the **next** running session (each click moves on) |
| 🟡 yellow | a session waits for your approval or answer | brings DSH forward and opens the **first** waiting session |
| 🟢 green | a finished session still shows its unread dot in DSH | brings DSH forward and opens the **oldest** unread session |

The lamps are independent: a red and a green lamp can be lit at the same time. Any lamp that can do something turns the pointer into a hand.

## Install

**1 — the plugin** (inside DSH):

```sh
dsh plugin add dsh-task-traffic-light
```

Or install it from the plugin market in the app. Most setups need a page refresh afterwards.

**2 — the app:**

The easy way: open **Plugins → this plugin** in DSH and press **Install the lamp app**. It downloads the release, unpacks it into `/Applications`, clears the quarantine flag and launches it. After that the control follows the app: **Running v1.5** while it is open, **Start the lamp app** after you quit it, and **Update to v…** when a newer build ships.

Or do it from a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/wunankun/dsh-task-traffic-light/main/scripts/install-app.sh | sh
```

The script installs `TaskTrafficLight.app` into `/Applications` and launches it. Prefer to do it by hand? Download `TaskTrafficLight.zip` from [Releases](https://github.com/wunankun/dsh-task-traffic-light/releases/latest), unzip, drag it to Applications, and right-click → Open the first time (the build is ad-hoc signed, not notarized).

**3 — go.** Restart DSH, refresh its page, and put the lamp where you like. Drag it anywhere; the position is remembered.

**Updates.** There is only one thing to update: the plugin. Once the app is installed, the next start replaces it with whatever version the plugin ships. A missing app is never installed on its own — that stays a click.

## The green lamp follows DSH, not a timestamp

DSH already puts a small green dot in front of a session that finished while you were looking elsewhere. That dot is the truth this app renders:

- the lamp is lit while at least one session carries that dot;
- opening the session — by clicking the lamp or any other way — clears the dot, and the lamp follows within a second;
- the lamp goes out only when the last dot is gone.

With several unread sessions, each click opens the oldest one and clears it, so clicking twice walks a small queue.

One case DSH does not mark is covered here too: a completion of the currently selected session **while the DSH window is out of sight** — another app in front, or the tab hidden — counts as unread and lights the lamp. DSH only knows which session is the main view, not whether its window is visible; coming back to the window clears that reminder.

## How it works

```
DSH Host plugin ──writes──> ~/.dsh/task-traffic-light/state.json <──reads── TaskTrafficLight.app
        ▲                                                                        │
        └────── /api/task-light/focus (authenticated, same-origin) ◀── focus.json ┘
```

- The plugin writes a snapshot: running count, pending interactions, waiting session ids, unread session ids, token speed.
- The app polls that file and draws the lamps.
- A click writes `focus.json`; the plugin validates it against the lamp it came from and hands it to the Web UI over DSH's own authenticated local channel. The page opens the session and acknowledges the request.
- Subagent sessions are filtered out: they have no row to open, so they can never hold a lamp on.

## Privacy

No listening port. The plugin writes one JSON file under `~/.dsh/task-traffic-light/`; the app writes one more when you click a lamp. Nothing leaves the machine on its own.

The one exception is the install button on the plugin page: pressing it downloads the release archive from GitHub and runs the system's own `ditto`, `xattr` and `open` to put the app in place. It never runs otherwise, and uninstalling the plugin removes that button. The whole thing is about 600 lines of JavaScript and 500 lines of Swift — small enough to read in one sitting.

## Requirements

- macOS 13 or later, Apple silicon or Intel (the release build is universal)
- DeepSeek Harness 0.2.1 or later with a profile you can add plugins to

The app's own menus are in Chinese for now — a localization PR would be very welcome.

## Troubleshooting

**All lamps stay dark.** No fresh `state.json` within 10 seconds means "DSH is not running". Check the plugin is enabled (`dsh plugin list`), then `tail -f ~/.dsh/task-traffic-light/state.json`.

**Clicking does nothing.** The click is applied by the DSH page, so it needs a page that has loaded the plugin's client half: refresh DSH once after installing. A request older than 30 seconds expires quietly.

**The lamp shows DSH as online but everything is idle.** The plugin only counts top-level sessions; subagents never light anything on their own.

## Build from source

```sh
git clone https://github.com/wunankun/dsh-task-traffic-light
cd dsh-task-traffic-light
./macos/build.sh          # universal binary, needs the Xcode command line tools
open macos/TaskTrafficLight.app
```

## License

MIT © 2026 wunankun
