using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace TaskTrafficLight;

/// <summary>Entry point: one instance, one tray item, one floating panel.</summary>
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(initiallyOwned: true, @"Local\TaskTrafficLight.SingleInstance", out var created);
        if (!created) return;

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LampContext());
    }
}

/// <summary>Owns the panel and its notification-area entry for the app's lifetime.</summary>
internal sealed class LampContext : ApplicationContext
{
    private readonly LampForm form;
    private readonly NotifyIcon tray;
    private readonly ToolStripMenuItem toggleItem;

    public LampContext()
    {
        form = new LampForm();
        form.Show();

        toggleItem = new ToolStripMenuItem("隐藏红绿灯", null, (_, _) => Toggle());
        var reset = new ToolStripMenuItem("回到默认位置", null, (_, _) => form.MoveToDefault());
        var quit = new ToolStripMenuItem("退出任务红绿灯", null, (_, _) => ExitApp());

        var menu = new ContextMenuStrip();
        menu.Items.Add(toggleItem);
        menu.Items.Add(reset);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quit);

        tray = new NotifyIcon
        {
            Icon = BuildIcon(),
            Text = "任务红绿灯",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.DoubleClick += (_, _) => Toggle();
    }

    private void Toggle()
    {
        if (form.Visible)
        {
            form.Hide();
            toggleItem.Text = "显示红绿灯";
        }
        else
        {
            form.Show();
            form.BringToFront();
            toggleItem.Text = "隐藏红绿灯";
        }
    }

    private void ExitApp()
    {
        tray.Visible = false;
        form.Hide();
        Application.Exit();
    }

    /// <summary>Draw the tray glyph instead of shipping an .ico asset.</summary>
    private static Icon BuildIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var body = new SolidBrush(Color.FromArgb(235, 32, 32, 38));
            g.FillRectangle(body, 9, 3, 14, 26);
            foreach (var (y, color) in new[]
            {
                (9, Color.FromArgb(255, 91, 80)),
                (16, Color.FromArgb(255, 214, 10)),
                (23, Color.FromArgb(48, 209, 88)),
            })
            {
                using var lamp = new SolidBrush(color);
                g.FillEllipse(lamp, 12, y - 3, 8, 8);
            }
        }

        var handle = bitmap.GetHicon();
        using var fromHandle = Icon.FromHandle(handle);
        return (Icon)fromHandle.Clone();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            tray.Visible = false;
            tray.Dispose();
            form.Dispose();
        }
        base.Dispose(disposing);
    }
}
