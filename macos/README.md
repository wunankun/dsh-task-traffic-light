# TaskTrafficLight.app

The macOS half of [DSH 任务红绿灯](../README.zh.md): a borderless floating panel with three lamps, reading `~/.dsh/task-traffic-light/state.json`.

## Build

```sh
./build.sh
open TaskTrafficLight.app
```

Needs the Xcode command line tools (`swiftc`). The script builds `arm64` and `x86_64` and `lipo`s them together, so the result runs on Apple silicon and Intel. Minimum macOS 13.

## Behaviour

- The panel is an accessory app: no Dock icon, no window in the app switcher, one menu-bar item.
- Drag anywhere on the lamp body to move it; the position is stored in `UserDefaults` and clamped to the visible screen.
- A click is only a click: if the pointer moves more than two points, the gesture is a drag and nothing is triggered.
- Every lamp with something to open shows a pointing hand cursor: red while sessions run, yellow while one waits, green while a finished session is unread.
- Clicking the red lamp walks the running sessions, one per click, in the order the bridge lists them.
- The speed badge above the body appears only while the red lamp is lit and the bridge publishes a rate. Hide it from the menu-bar menu (隐藏速率显示 / 开启速率显示); the panel then shrinks by the badge's 22 points and the choice is stored in `UserDefaults`.
- The menu-bar menu has three items: hide the panel, toggle the speed badge, quit.

## Signing

The build is ad-hoc signed (`codesign --sign -`), which is enough to run locally. Downloads carry the quarantine flag, so the installer script clears it; notarization would need an Apple Developer account.
