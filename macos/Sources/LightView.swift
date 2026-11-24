import AppKit
import QuartzCore

// MARK: - State

/// One decoded bridge snapshot. The three lamps are independent: work can be
/// running, the human can be awaited, and a finished run can be unread at the
/// same time.
struct LightState {
    let online: Bool
    let running: Int
    let pending: Int
    let waitingSessions: [String]
    /// Sessions DSH still marks with a completion dot, oldest completion first.
    let completedSessions: [String]
    let tokensPerSecond: Double?

    static let offline = LightState(
        online: false,
        running: 0,
        pending: 0,
        waitingSessions: [],
        completedSessions: [],
        tokensPerSecond: nil
    )
}

struct BridgeState: Decodable {
    let updatedAt: Double
    let running: Int?
    let pending: Int?
    let waitingSessions: [String]?
    let completedSessions: [String]?
    let tokensPerSecond: Double?
}

final class StateReader {
    static let fileURL = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent(".dsh/task-traffic-light/state.json")

    /// Read the newest snapshot; a missing or stale file means DSH is not running.
    func read() -> LightState {
        let staleAfter: Double = 10_000
        guard let data = try? Data(contentsOf: Self.fileURL),
              let state = try? JSONDecoder().decode(BridgeState.self, from: data),
              Date().timeIntervalSince1970 * 1000 - state.updatedAt < staleAfter
        else { return .offline }
        return LightState(
            online: true,
            running: max(0, state.running ?? 0),
            pending: max(0, state.pending ?? 0),
            waitingSessions: state.waitingSessions ?? [],
            completedSessions: state.completedSessions ?? [],
            tokensPerSecond: state.tokensPerSecond
        )
    }
}

// MARK: - Panel

final class TrafficLightPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

// MARK: - Light view

final class LightView: NSView {
    /// The traffic-light body keeps its old size; the window adds one strip on
    /// top for the speed reading so the body does not move when it appears.
    static let bodySize = NSSize(width: 68, height: 132)
    private static let speedBarHeight: CGFloat = 22
    static let windowSize = NSSize(width: 68, height: bodySize.height + speedBarHeight)

    private static let housingInset: CGFloat = 8
    private static let lampDiameter: CGFloat = 26
    private static let lampGap: CGFloat = 9

    private static let red = NSColor(srgbRed: 1.00, green: 0.36, blue: 0.31, alpha: 1)
    private static let amber = NSColor(srgbRed: 1.00, green: 0.84, blue: 0.04, alpha: 1)
    private static let green = NSColor(srgbRed: 0.19, green: 0.82, blue: 0.35, alpha: 1)

    private let housing = CAGradientLayer()
    private let lamps: [(layer: CAGradientLayer, shine: CAGradientLayer)] = (0..<3).map { _ in
        let lamp = CAGradientLayer()
        lamp.type = .radial
        lamp.startPoint = CGPoint(x: 0.34, y: 0.68)
        lamp.endPoint = CGPoint(x: 1.05, y: -0.05)
        let shine = CAGradientLayer()
        shine.type = .radial
        shine.startPoint = CGPoint(x: 0.36, y: 0.72)
        shine.endPoint = CGPoint(x: 0.92, y: 0.15)
        return (lamp, shine)
    }
    private let speedBadge = CALayer()
    private let speedText = CATextLayer()

    /// Called when the green lamp is clicked while a Session still carries an
    /// unread completion dot, so the owner can focus DSH and switch to it.
    var focusCompleted: (() -> Void)?

    /// Called when the yellow lamp is clicked while a Session waits for the
    /// human, so the owner can focus DSH and switch to the first one.
    var focusWaiting: (() -> Void)?

    /// How many top-level sessions are running; only decides whether the red
    /// lamp is lit.
    var runningCount: Int = 0 {
        didSet {
            guard oldValue != runningCount else { return }
            updateLamps()
            updateSpeedBadge()
        }
    }

    /// Whether some session is waiting for a human answer or approval.
    var waiting: Bool = false {
        didSet {
            guard oldValue != waiting else { return }
            updateLamps()
            updateHousingBorder()
            window?.invalidateCursorRects(for: self)
        }
    }

    /// Whether at least one finished run still carries an unread reminder dot
    /// in DSH. It stays lit until every one of them has been opened.
    var completed: Bool = false {
        didSet {
            guard oldValue != completed else { return }
            updateLamps()
            updateHousingBorder()
            window?.invalidateCursorRects(for: self)
        }
    }

    /// Live output speed published by the bridge; shown only while running.
    var tokensPerSecond: Double? {
        didSet { updateSpeedBadge() }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.masksToBounds = false

        housing.cornerRadius = 14
        housing.startPoint = CGPoint(x: 0.5, y: 1)
        housing.endPoint = CGPoint(x: 0.5, y: 0)
        housing.colors = [
            NSColor(srgbRed: 0.20, green: 0.20, blue: 0.23, alpha: 1).cgColor,
            NSColor(srgbRed: 0.08, green: 0.08, blue: 0.09, alpha: 1).cgColor,
        ]
        housing.borderWidth = 1
        housing.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
        housing.masksToBounds = false
        housing.shadowColor = NSColor.black.cgColor
        housing.shadowOpacity = 0.38
        housing.shadowRadius = 10
        housing.shadowOffset = CGSize(width: 0, height: -3)
        layer?.addSublayer(housing)

        for lamp in lamps {
            housing.addSublayer(lamp.layer)
            lamp.layer.addSublayer(lamp.shine)
        }

        speedBadge.cornerRadius = 8
        speedBadge.backgroundColor = NSColor(srgbRed: 0.09, green: 0.09, blue: 0.10, alpha: 0.86).cgColor
        speedBadge.borderWidth = 1
        speedBadge.borderColor = NSColor(white: 1, alpha: 0.10).cgColor
        speedBadge.masksToBounds = true
        speedBadge.isHidden = true
        layer?.addSublayer(speedBadge)

        speedText.fontSize = 9
        speedText.font = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .semibold)
        speedText.alignmentMode = .center
        speedText.truncationMode = .none
        speedText.isWrapped = false
        speedText.foregroundColor = NSColor(srgbRed: 1.0, green: 0.72, blue: 0.68, alpha: 1).cgColor
        speedText.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
        speedText.isHidden = true
        speedBadge.addSublayer(speedText)

        updateLamps()
        updateHousingBorder()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    override func layout() {
        super.layout()
        // Keep the light body at its historical size and anchor it to the
        // bottom edge, so the extra strip only appears above it.
        housing.frame = CGRect(x: Self.housingInset, y: Self.housingInset,
                               width: bounds.width - Self.housingInset * 2,
                               height: Self.bodySize.height - Self.housingInset * 2)
        let side = Self.lampDiameter
        let contentHeight = side * 3 + Self.lampGap * 2
        let topInset = (housing.bounds.height - contentHeight) / 2
        for (index, lamp) in lamps.enumerated() {
            let y = housing.bounds.height - topInset - CGFloat(index + 1) * side - CGFloat(index) * Self.lampGap
            lamp.layer.frame = CGRect(x: (housing.bounds.width - side) / 2, y: y, width: side, height: side)
            lamp.layer.cornerRadius = side / 2
            lamp.layer.masksToBounds = false
            lamp.shine.frame = lamp.layer.bounds
            lamp.shine.cornerRadius = side / 2
        }

        let badgeHeight: CGFloat = 16
        speedBadge.frame = CGRect(x: 4, y: Self.bodySize.height + 3,
                                  width: bounds.width - 8, height: badgeHeight)
        speedText.frame = CGRect(x: 0, y: 3, width: speedBadge.bounds.width, height: badgeHeight - 4)
        speedText.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
        // The glow shadow needs the final housing bounds, and the first state
        // may land before the panel lays out.
        updateHousingBorder()
    }

    /// A click must reach the view even when the app is not frontmost.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    private var dragStartMouse: NSPoint?
    private var dragStartOrigin: NSPoint?
    private var pressPoint: NSPoint?
    private var dragged = false

    /// Dragging is handled here, so the window must not start its own drag;
    /// that also lets a click on the green lamp mean "open the finished
    /// Session" and a click on the yellow lamp mean "focus the waiting one".
    override var mouseDownCanMoveWindow: Bool { false }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        pressPoint = point
        dragged = false
        dragStartMouse = NSEvent.mouseLocation
        dragStartOrigin = window?.frame.origin
    }

    override func mouseDragged(with event: NSEvent) {
        guard let startMouse = dragStartMouse,
              let startOrigin = dragStartOrigin,
              let window else { return }
        let current = NSEvent.mouseLocation
        let dx = current.x - startMouse.x
        let dy = current.y - startMouse.y
        if abs(dx) > 2 || abs(dy) > 2 { dragged = true }
        window.setFrameOrigin(NSPoint(
            x: startOrigin.x + dx,
            y: startOrigin.y + dy
        ))
    }

    override func mouseUp(with event: NSEvent) {
        if !dragged, let pressPoint {
            if waiting, amberLampFrame().insetBy(dx: -5, dy: -5).contains(pressPoint) {
                focusWaiting?()
            } else if completed, greenLampFrame().insetBy(dx: -5, dy: -5).contains(pressPoint) {
                focusCompleted?()
            }
        }
        dragStartMouse = nil
        dragStartOrigin = nil
        pressPoint = nil
        dragged = false
    }

    /// The yellow and green lamps are clickable while their state is on.
    override func resetCursorRects() {
        super.resetCursorRects()
        if waiting { addCursorRect(amberLampFrame(), cursor: .pointingHand) }
        if completed { addCursorRect(greenLampFrame(), cursor: .pointingHand) }
    }

    private func greenLampFrame() -> CGRect {
        let lamp = lamps[2].layer.frame
        return lamp.offsetBy(dx: housing.frame.minX, dy: housing.frame.minY)
    }

    private func amberLampFrame() -> CGRect {
        let lamp = lamps[1].layer.frame
        return lamp.offsetBy(dx: housing.frame.minX, dy: housing.frame.minY)
    }

    private func updateLamps() {
        let redOff = NSColor(srgbRed: 0.26, green: 0.07, blue: 0.06, alpha: 1)
        let amberOff = NSColor(srgbRed: 0.27, green: 0.21, blue: 0.03, alpha: 1)
        let greenOff = NSColor(srgbRed: 0.06, green: 0.22, blue: 0.11, alpha: 1)

        let lampTones: [(NSColor, NSColor)] = [
            (Self.red, redOff), (Self.amber, amberOff), (Self.green, greenOff),
        ]
        let onStates = [runningCount > 0, waiting, completed]

        for (index, lamp) in lamps.enumerated() {
            let isOn = onStates[index]
            let (on, off) = lampTones[index]
            let base = isOn ? on : off
            if index == 0 && isOn {
                // Three stops give the working lamp a lit core and a deep rim
                // instead of a flat, washed-out disc.
                lamp.layer.colors = [
                    NSColor(srgbRed: 1.00, green: 0.58, blue: 0.52, alpha: 1).cgColor,
                    base.cgColor,
                    NSColor(srgbRed: 0.66, green: 0.07, blue: 0.05, alpha: 1).cgColor,
                ]
                lamp.layer.locations = [0, 0.55, 1]
            } else {
                lamp.layer.colors = [
                    base.blended(withFraction: 0.06, of: .black)?.cgColor ?? base.cgColor,
                    base.cgColor,
                ]
                lamp.layer.locations = nil
            }
            lamp.layer.removeAnimation(forKey: "pulse")
            if isOn {
                lamp.layer.shadowColor = base.cgColor
                // The working lamp glows harder and barely dips: red is the
                // state seen most of the day, and a deep breath read as "dim".
                lamp.layer.shadowOpacity = index == 0 ? 1.0 : 0.9
                lamp.layer.shadowRadius = index == 0 ? 16 : 9
                lamp.layer.shadowOffset = .zero
                let pulse: Double? = index == 0 ? 2.6 : index == 1 ? 0.65 : nil
                if let pulse {
                    let animation = CABasicAnimation(keyPath: "opacity")
                    // Keep the dip clearly above the unlit colour: the old
                    // 0.55 made the lit lamp look extinguished mid-breath.
                    animation.fromValue = 1.0
                    animation.toValue = index == 0 ? 0.95 : 0.82
                    animation.duration = pulse
                    animation.autoreverses = true
                    animation.repeatCount = .infinity
                    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                    lamp.layer.add(animation, forKey: "pulse")
                }
            } else {
                lamp.layer.shadowOpacity = 0
            }
            lamp.shine.colors = [
                NSColor(white: 1, alpha: isOn ? (index == 0 ? 0.30 : 0.42) : 0.12).cgColor,
                NSColor(white: 1, alpha: 0).cgColor,
            ]
        }
    }

    /// Light the housing border for the strongest non-red state: waiting wins
    /// over a finished run, because it is the one that needs the human.
    private func updateHousingBorder() {
        if waiting {
            applyBorderGlow(color: Self.amber)
        } else if completed {
            applyBorderGlow(color: Self.green)
        } else {
            housing.borderWidth = 1
            housing.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
            housing.shadowPath = nil
            housing.shadowColor = NSColor.black.cgColor
            housing.shadowOpacity = 0.38
            housing.shadowRadius = 10
            housing.shadowOffset = CGSize(width: 0, height: -3)
        }
    }

    private func applyBorderGlow(color: NSColor) {
        housing.borderWidth = 1.5
        housing.borderColor = color.withAlphaComponent(0.9).cgColor
        housing.shadowPath = CGPath(roundedRect: housing.bounds, cornerWidth: 14, cornerHeight: 14, transform: nil)
        housing.shadowColor = color.cgColor
        housing.shadowOpacity = 0.5
        housing.shadowRadius = 7
        housing.shadowOffset = .zero
    }


    private func updateSpeedBadge() {
        guard runningCount > 0, let tokensPerSecond else {
            speedBadge.isHidden = true
            speedText.isHidden = true
            return
        }
        speedText.string = String(format: "%.1f tok/s", tokensPerSecond)
        speedBadge.isHidden = false
        speedText.isHidden = false
    }
}
