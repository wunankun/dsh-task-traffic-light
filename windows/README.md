# TaskTrafficLight.exe

The Windows half of [DSH 任务红绿灯](../README.zh.md): a borderless, always-on-top
panel with three lamps, reading `%USERPROFILE%\.dsh\task-traffic-light\state.json`
— the same file the macOS app reads.

## Run

Download `TaskTrafficLight-win-x64.zip` from
[Releases](https://github.com/wunankun/dsh-task-traffic-light/releases/latest),
unzip, run `TaskTrafficLight.exe`. The build is self-contained: no .NET install,
no installer, no admin rights. It sits in the notification area; right-click it
for show/hide, reset position, or quit.

## Behaviour

- Red while a top-level session runs, yellow while an approval or question waits,
  green while a finished session still carries its unread dot in DSH.
- Clicking a lit yellow or green lamp writes the same `focus.json` the macOS app
  writes and brings the DeepSeek Harness window to the front, so the plugin does
  the rest exactly as it does on macOS.
- Drag anywhere to move it; the position is remembered in
  `%APPDATA%\TaskTrafficLight\prefs.json`.
- No port, no network access of its own, no auto-start entry.

## Build

Needs the .NET 8 SDK. On Windows:

```powershell
dotnet publish TaskTrafficLight.csproj -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o out
```

Cross-building from macOS or Linux works too — the project sets
`EnableWindowsTargeting`, so `dotnet build TaskTrafficLight.csproj -c Release`
verifies the code anywhere the SDK is installed.

## Known gaps

- No code signing: SmartScreen shows "Windows protected your PC" on first run;
  choose **More info → Run anyway**.
- The speed badge and the housing glow follow the macOS design, but the fonts differ.
