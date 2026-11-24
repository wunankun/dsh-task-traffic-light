import AppKit

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let reader = StateReader()
    private var panel: TrafficLightPanel!
    private var lightView: LightView!
    private var statusItem: NSStatusItem?
    private var toggleItem: NSMenuItem?
    private var pollTimer: Timer?
    private var lastState: LightState = .offline
    /// Click request the Host plugin hands to the DSH Web UI.
    private let focusFileURL = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent(".dsh/task-traffic-light/focus.json")

    private let originXKey = "panel.origin.x"
    private let originYKey = "panel.origin.y"

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildPanel()
        buildStatusItem()
        startPolling()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )
    }

    private func buildPanel() {
        let size = LightView.windowSize
        let origin = savedOrigin() ?? defaultOrigin(for: size)
        panel = TrafficLightPanel(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.delegate = self

        lightView = LightView(frame: NSRect(origin: .zero, size: size))
        lightView.autoresizingMask = [.width, .height]
        lightView.focusCompleted = { [weak self] in
            self?.focusCompleted()
        }
        lightView.focusWaiting = { [weak self] in
            self?.focusWaiting()
        }
        panel.contentView = lightView
        panel.orderFrontRegardless()
    }

    private func buildStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            let image = NSImage(systemSymbolName: "trafficlight", accessibilityDescription: "任务红绿灯")
                ?? NSImage(systemSymbolName: "circle.fill", accessibilityDescription: "任务红绿灯")
            image?.isTemplate = true
            button.image = image
            button.toolTip = "任务红绿灯"
        }

        let menu = NSMenu()
        let toggle = NSMenuItem(title: "隐藏红绿灯", action: #selector(togglePanel), keyEquivalent: "h")
        toggle.target = self
        menu.addItem(toggle)
        toggleItem = toggle

        let reset = NSMenuItem(title: "回到默认位置", action: #selector(resetPosition), keyEquivalent: "")
        reset.target = self
        menu.addItem(reset)

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出任务红绿灯", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        item.menu = menu
        statusItem = item
    }

    private func startPolling() {
        let timer = Timer(timeInterval: 0.3, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
        refresh()
    }

    /// Re-read the bridge snapshot and apply it to the view.
    private func refresh() {
        lastState = reader.read()
        apply(lastState)
    }

    /// The green lamp mirrors DSH's own unread completion dots: it is lit while
    /// any Session still shows one, and clicking it opens the oldest one.
    private func apply(_ state: LightState) {
        let online = state.online
        let running = online ? state.running : 0
        let waiting = online && state.pending > 0
        let completed = online && !state.completedSessions.isEmpty
        lightView.runningCount = running
        lightView.waiting = waiting
        lightView.completed = completed
        lightView.tokensPerSecond = running > 0 ? state.tokensPerSecond : nil
    }

    /// Green-lamp click: point the Host at the oldest unfinished Session, then
    /// bring the DSH window to the front so the Web UI can open it. Opening it
    /// clears that Session's dot, so the lamp goes out once the last one is seen.
    private func focusCompleted() {
        guard lastState.online, let sessionId = lastState.completedSessions.first else { return }
        writeFocusRequest(sessionId: sessionId, lamp: "green")
        focusHarness()
    }

    /// Yellow-lamp click: point the Host at the first waiting Session, then
    /// bring the DSH window to the front so the Web UI can select it.
    private func focusWaiting() {
        guard lastState.online, lastState.pending > 0 else { return }
        if let sessionId = lastState.waitingSessions.first {
            writeFocusRequest(sessionId: sessionId, lamp: "yellow")
        }
        focusHarness()
    }

    /// Leave a fresh click request for the Host plugin; it validates that the
    /// Session still matches the clicked lamp and hands it to the Web UI over
    /// its local channel.
    private func writeFocusRequest(sessionId: String, lamp: String) {
        let request: [String: Any] = [
            "sessionId": sessionId,
            "nonce": UUID().uuidString,
            "at": Date().timeIntervalSince1970 * 1000,
            "lamp": lamp,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: request) else { return }
        let directory = focusFileURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: focusFileURL, options: .atomic)
    }

    /// `dsh://open` is the Desktop application's supported way to restore,
    /// show, and focus its main window.
    private func focusHarness() {
        guard let url = URL(string: "dsh://open") else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open(url, configuration: configuration) { application, error in
            guard application == nil || error != nil else { return }
            DispatchQueue.main.async {
                NSRunningApplication.runningApplications(withBundleIdentifier: "com.deepseek.dsh")
                    .first?.activate(options: [.activateAllWindows])
            }
        }
    }

    // MARK: Position

    private func savedOrigin() -> NSPoint? {
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: originXKey) != nil,
              defaults.object(forKey: originYKey) != nil else { return nil }
        let point = NSPoint(
            x: defaults.double(forKey: originXKey),
            y: defaults.double(forKey: originYKey)
        )
        return clamped(point, for: LightView.windowSize)
    }

    private func defaultOrigin(for size: NSSize) -> NSPoint {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let visible = screen.visibleFrame
        return NSPoint(
            x: visible.maxX - size.width - 26,
            y: visible.midY - size.height / 2
        )
    }

    /// Keep the panel fully inside the nearest screen's visible frame.
    private func clamped(_ point: NSPoint, for size: NSSize) -> NSPoint {
        let probe = NSRect(origin: point, size: size)
        let screen = NSScreen.screens.first(where: { $0.frame.intersects(probe) })
            ?? NSScreen.main
            ?? NSScreen.screens[0]
        let visible = screen.visibleFrame
        let x = min(max(point.x, visible.minX + 4), visible.maxX - size.width - 4)
        let y = min(max(point.y, visible.minY + 4), visible.maxY - size.height - 4)
        return NSPoint(x: x, y: y)
    }

    func windowDidMove(_ notification: Notification) {
        let origin = panel.frame.origin
        let defaults = UserDefaults.standard
        defaults.set(Double(origin.x), forKey: originXKey)
        defaults.set(Double(origin.y), forKey: originYKey)
    }

    @objc private func screensChanged() {
        let size = LightView.windowSize
        let origin = clamped(panel.frame.origin, for: size)
        panel.setFrameOrigin(origin)
    }

    @objc private func togglePanel() {
        if panel.isVisible {
            panel.orderOut(nil)
            toggleItem?.title = "显示红绿灯"
        } else {
            panel.orderFrontRegardless()
            toggleItem?.title = "隐藏红绿灯"
        }
    }

    @objc private func resetPosition() {
        let origin = defaultOrigin(for: LightView.windowSize)
        panel.setFrameOrigin(origin)
        windowDidMove(Notification(name: NSWindow.didMoveNotification, object: panel))
    }

    @objc private func quit() {
        pollTimer?.invalidate()
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
