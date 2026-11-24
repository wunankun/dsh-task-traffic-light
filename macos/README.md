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
- Lit yellow and green lamps show a pointing hand cursor.
- The speed badge above the body appears only while the red lamp is lit and the bridge publishes a rate.

## Signing

The build is ad-hoc signed (`codesign --sign -`), which is enough to run locally. Downloads carry the quarantine flag, so the installer script clears it; notarization would need an Apple Developer account.
