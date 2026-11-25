using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace TaskTrafficLight;

/// <summary>
/// The floating panel: a dark housing with three lamps, dragged anywhere and
/// kept above other windows. Clicking a lit yellow or green lamp opens the
/// matching DSH session.
/// </summary>
public sealed class LampForm : Form
{
    // Layout at 96 DPI, matching the macOS build: a 68x132 body with a 22px
    // strip above it for the speed reading.
    private const float BodyWidth = 68f;
    private const float BodyHeight = 132f;
    private const float BadgeHeight = 22f;
    private const float HousingInset = 8f;
    private const float LampDiameter = 26f;
    private const float LampGap = 9f;

    private static readonly Color Background = Color.FromArgb(18, 18, 18);
    private static readonly Color HousingTop = Color.FromArgb(51, 51, 59);
    private static readonly Color HousingBottom = Color.FromArgb(20, 20, 23);

    private static readonly Color RedOn = Color.FromArgb(255, 91, 80);
    private static readonly Color AmberOn = Color.FromArgb(255, 214, 10);
    private static readonly Color GreenOn = Color.FromArgb(48, 209, 88);

    private static readonly Color RedOff = Color.FromArgb(66, 17, 15);
    private static readonly Color AmberOff = Color.FromArgb(69, 52, 4);
    private static readonly Color GreenOff = Color.FromArgb(15, 56, 28);

    private readonly System.Windows.Forms.Timer ticker;
    private Snapshot state = Snapshot.Offline;

    private Point pressPoint;
    private Point pressLocation;
    private bool dragging;
    private bool overAmber;
    private bool overGreen;

    public LampForm()
    {
        Text = "任务红绿灯";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Background;
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

        var scale = UiScale;
        Size = new Size((int)Math.Round(BodyWidth * scale), (int)Math.Round((BodyHeight + BadgeHeight) * scale));

        ticker = new System.Windows.Forms.Timer { Interval = 300 };
        ticker.Tick += (_, _) => Reload();
        ticker.Start();

        if (!RestorePosition()) MoveToDefault();
        Reload();
    }

    /// <summary>A click must reach the lamp even when the window is not active.</summary>
    protected override bool ShowWithoutActivation => true;

    private float UiScale => DeviceDpi / 96f;

    private void Reload()
    {
        var next = Bridge.Read();
        var changed = !Same(next, state);
        state = next;
        if (changed) Invalidate();
    }

    private static bool Same(Snapshot a, Snapshot b) =>
        a.Online == b.Online
        && a.Running == b.Running
        && a.Pending == b.Pending
        && a.CompletedSessions.Length == b.CompletedSessions.Length
        && a.WaitingSessions.Length == b.WaitingSessions.Length
        && a.TokensPerSecond == b.TokensPerSecond;

    private bool Working => state.Online && state.Running > 0;
    private bool Waiting => state.Online && state.Pending > 0;
    private bool Completed => state.Online && state.CompletedSessions.Length > 0;

    /// <summary>Popup on one lamp, in client coordinates.</summary>
    private RectangleF LampRect(int index)
    {
        var s = UiScale;
        var housingTop = s * (BadgeHeight + HousingInset);
        var housingHeight = s * (BodyHeight - HousingInset * 2);
        var content = s * (LampDiameter * 3 + LampGap * 2);
        var topInset = (housingHeight - content) / 2;
        var size = s * LampDiameter;
        var left = (Width - size) / 2;
        var top = housingTop + topInset + index * (size + s * LampGap);
        return new RectangleF(left, top, size, size);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAlias;
        g.Clear(Background);

        var s = UiScale;
        DrawHousing(g, s);
        DrawLamp(g, 0, Working, RedOn, RedOff, s);
        DrawLamp(g, 1, Waiting, AmberOn, AmberOff, s);
        DrawLamp(g, 2, Completed, GreenOn, GreenOff, s);
        DrawBadge(g, s);
    }

    private void DrawHousing(Graphics g, float s)
    {
        var rect = new RectangleF(
            s * HousingInset,
            s * (BadgeHeight + HousingInset),
            Width - s * HousingInset * 2,
            s * (BodyHeight - HousingInset * 2));

        using var path = Rounded(rect, s * 14f);
        using var fill = new LinearGradientBrush(rect, HousingTop, HousingBottom, 90f);
        g.FillPath(fill, path);

        var lit = Waiting ? AmberOn : Completed ? GreenOn : (Color?)null;
        using var border = new Pen(lit is null ? Color.FromArgb(36, Color.White) : Color.FromArgb(230, lit.Value), Math.Max(1f, s * 1.2f));
        g.DrawPath(border, path);

        if (lit is not null)
        {
            // Soft halo around the housing, the way the macOS layer shadow does it.
            for (var i = 5; i >= 1; i--)
            {
                using var glow = new Pen(Color.FromArgb(14, lit.Value), s * (i * 2.2f));
                using var glowPath = Rounded(RectangleF.Inflate(rect, s * i * 0.6f, s * i * 0.6f), s * 16f);
                g.DrawPath(glow, glowPath);
            }
        }
    }

    private void DrawLamp(Graphics g, int index, bool lit, Color on, Color off, float s)
    {
        var rect = LampRect(index);
        var color = lit ? on : off;

        if (lit)
        {
            for (var i = 7; i >= 1; i--)
            {
                var spread = s * i * 2.4f;
                using var halo = new SolidBrush(Color.FromArgb(10, on));
                g.FillEllipse(halo, RectangleF.Inflate(rect, spread, spread));
            }
        }

        using var path = new GraphicsPath();
        path.AddEllipse(rect);
        if (lit)
        {
            using var brush = new PathGradientBrush(path)
            {
                CenterColor = Mix(color, Color.White, 0.35f),
                SurroundColors = [color],
                CenterPoint = new PointF(rect.Left + rect.Width * 0.38f, rect.Top + rect.Height * 0.32f),
            };
            g.FillPath(brush, path);
        }
        else
        {
            using var brush = new SolidBrush(color);
            g.FillPath(brush, path);
        }

        // A small specular dot keeps even the unlit lamps from looking like
        // flat holes.
        using var shine = new SolidBrush(Color.FromArgb(lit ? 70 : 18, 255, 255, 255));
        var shineRect = new RectangleF(
            rect.Left + rect.Width * 0.24f,
            rect.Top + rect.Height * 0.16f,
            rect.Width * 0.34f,
            rect.Height * 0.26f);
        g.FillEllipse(shine, shineRect);
    }

    private void DrawBadge(Graphics g, float s)
    {
        if (!Working || state.TokensPerSecond is not { } rate) return;

        var rect = new RectangleF(s * 4, s * 3, Width - s * 8, s * 16);
        using var path = Rounded(rect, s * 8);
        using var fill = new SolidBrush(Color.FromArgb(220, 23, 23, 26));
        g.FillPath(fill, path);
        using var border = new Pen(Color.FromArgb(26, 255, 255, 255), Math.Max(1f, s));
        g.DrawPath(border, path);

        using var font = new Font("Segoe UI", s * 7.5f, FontStyle.Bold, GraphicsUnit.Point);
        using var text = new SolidBrush(Color.FromArgb(255, 214, 10));
        var label = $"{rate:0.0} tok/s";
        var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        g.DrawString(label, font, text, rect, format);
    }

    private static GraphicsPath Rounded(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static Color Mix(Color a, Color b, float t) => Color.FromArgb(
        (int)(a.R + (b.R - a.R) * t),
        (int)(a.G + (b.G - a.G) * t),
        (int)(a.B + (b.B - a.B) * t));

    // ---- input -------------------------------------------------------------

    protected override void OnMouseDown(MouseEventArgs e)
    {
        pressPoint = e.Location;
        pressLocation = Location;
        dragging = false;
        Cursor = vp(e.Location) ? Cursors.Hand : Cursors.Default;
        base.OnMouseDown(e);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left && pressLocation != Point.Empty)
        {
            var dx = e.X - pressPoint.X;
            var dy = e.Y - pressPoint.Y;
            if (!dragging && (Math.Abs(dx) > 2 || Math.Abs(dy) > 2)) dragging = true;
            if (dragging) Location = new Point(pressLocation.X + dx, pressLocation.Y + dy);
        }
        else
        {
            var hand = vp(e.Location);
            if (hand != (overAmber || overGreen)) { overAmber = hand; overGreen = false; Cursor = hand ? Cursors.Hand : Cursors.Default; }
        }
        base.OnMouseMove(e);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (!dragging && pressLocation != Point.Empty)
        {
            if (Waiting && LampRect(1).Contains(e.Location))
            {
                Focus("yellow");
            }
            else if (Completed && LampRect(2).Contains(e.Location))
            {
                Focus("green");
            }
        }
        if (dragging) SavePosition();

        pressLocation = Point.Empty;
        dragging = false;
        base.OnMouseUp(e);
    }

    private bool vp(Point point) =>
        (Waiting && LampRect(1).Contains(point)) || (Completed && LampRect(2).Contains(point));

    private void Focus(string lamp)
    {
        var target = lamp == "yellow"
            ? state.WaitingSessions.FirstOrDefault()
            : state.CompletedSessions.FirstOrDefault();
        if (string.IsNullOrEmpty(target)) return;

        Bridge.WriteFocus(target, lamp);
        Bridge.ActivateHarness();
    }

    // ---- position ----------------------------------------------------------

    private static string PrefsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TaskTrafficLight", "prefs.json");

    private bool RestorePosition()
    {
        var origin = new Point(-1, -1);
        try
        {
            if (File.Exists(PrefsPath))
            {
                using var document = System.Text.Json.JsonDocument.Parse(File.ReadAllText(PrefsPath));
                if (document.RootElement.TryGetProperty("x", out var x) && document.RootElement.TryGetProperty("y", out var y))
                {
                    origin = new Point(x.GetInt32(), y.GetInt32());
                }
            }
        }
        catch (Exception)
        {
            // A broken prefs file only means the default corner is used.
        }

        if (origin.X < 0 || origin.Y < 0) return false;
        var screen = Screen.PrimaryScreen ?? Screen.AllScreens[0];
        Location = Clamp(origin, screen);
        return true;
    }

    private Point Clamp(Point point, Screen screen)
    {
        var area = screen.WorkingArea;
        var x = Math.Clamp(point.X, area.Left + 4, area.Right - Width - 4);
        var y = Math.Clamp(point.Y, area.Top + 4, area.Bottom - Height - 4);
        return new Point(x, y);
    }

    private void SavePosition()
    {
        try
        {
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(PrefsPath)!);
            File.WriteAllText(PrefsPath, System.Text.Json.JsonSerializer.Serialize(new { x = Location.X, y = Location.Y }));
        }
        catch (Exception)
        {
            // Losing the position is never worth surfacing.
        }
    }

    /// <summary>Park the panel at the right edge, vertically centred.</summary>
    public void MoveToDefault()
    {
        var screen = Screen.PrimaryScreen ?? Screen.AllScreens[0];
        var area = screen.WorkingArea;
        Location = new Point(area.Right - Width - 26, area.Top + (area.Height - Height) / 2);
        SavePosition();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            ticker.Stop();
            ticker.Dispose();
        }
        base.Dispose(disposing);
    }
}
