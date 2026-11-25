using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace TaskTrafficLight;

/// <summary>One decoded <c>state.json</c> snapshot.</summary>
public sealed class Snapshot
{
    public bool Online { get; init; }
    public int Running { get; init; }
    public int Pending { get; init; }
    public string[] WaitingSessions { get; init; } = [];
    public string[] CompletedSessions { get; init; } = [];
    public double? TokensPerSecond { get; init; }

    public static readonly Snapshot Offline = new();
}

/// <summary>The two files the DSH plugin and this app share.</summary>
public static class Bridge
{
    /// <summary>Same layout as macOS: <c>%USERPROFILE%\.dsh\task-traffic-light</c>.</summary>
    public static readonly string Directory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dsh", "task-traffic-light");

    private static string StatePath => Path.Combine(Directory, "state.json");
    private static string FocusPath => Path.Combine(Directory, "focus.json");

    private static readonly JsonDocumentOptions Options = new()
    {
        AllowTrailingCommas = true,
        CommentHandling = JsonCommentHandling.Skip,
    };

    /// <summary>
    /// Read the newest snapshot. A missing or stale file means DSH is not running,
    /// so every lamp stays dark.
    /// </summary>
    public static Snapshot Read()
    {
        string text;
        try
        {
            if (!File.Exists(StatePath)) return Snapshot.Offline;
            text = File.ReadAllText(StatePath);
        }
        catch (IOException)
        {
            return Snapshot.Offline;
        }
        catch (UnauthorizedAccessException)
        {
            return Snapshot.Offline;
        }

        try
        {
            using var document = JsonDocument.Parse(text, Options);
            var root = document.RootElement;

            var updatedAt = Number(root, "updatedAt") ?? 0;
            var ageMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - updatedAt;
            if (updatedAt <= 0 || ageMs > 10_000) return Snapshot.Offline;

            return new Snapshot
            {
                Online = true,
                Running = (int)Math.Max(0, Number(root, "running") ?? 0),
                Pending = (int)Math.Max(0, Number(root, "pending") ?? 0),
                WaitingSessions = Strings(root, "waitingSessions"),
                CompletedSessions = Strings(root, "completedSessions"),
                TokensPerSecond = Number(root, "tokensPerSecond"),
            };
        }
        catch (JsonException)
        {
            return Snapshot.Offline;
        }
    }

    /// <summary>
    /// Leave a click request for the plugin, exactly as the macOS app does: it
    /// validates the target against the lamp it came from before the page moves.
    /// </summary>
    public static void WriteFocus(string sessionId, string lamp)
    {
        var request = new
        {
            sessionId,
            lamp,
            nonce = Guid.NewGuid().ToString(),
            at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
        System.IO.Directory.CreateDirectory(Directory);
        File.WriteAllText(FocusPath, JsonSerializer.Serialize(request));
    }

    /// <summary>Bring the DeepSeek Harness window to the front.</summary>
    public static void ActivateHarness()
    {
        foreach (var process in Process.GetProcessesByName("DeepSeek Harness"))
        {
            if (process.MainWindowHandle == IntPtr.Zero) continue;
            ShowWindow(process.MainWindowHandle, SW_RESTORE);
            SetForegroundWindow(process.MainWindowHandle);
            return;
        }

        // The desktop app registers its own URL scheme; this is the fallback
        // when no window is running.
        try
        {
            Process.Start(new ProcessStartInfo("dsh://open") { UseShellExecute = true });
        }
        catch (Exception)
        {
            // Nothing to activate: the click simply stays unanswered.
        }
    }

    private const int SW_RESTORE = 9;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    /// <summary>Read one number, accepting null or a wrong shape as absent.</summary>
    private static double? Number(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return null;
        return value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) ? number : null;
    }

    /// <summary>Read one string array, skipping anything that is not a string.</summary>
    private static string[] Strings(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) return [];
        var items = new List<string>();
        foreach (var item in value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String) items.Add(item.GetString() ?? string.Empty);
        }
        return [.. items];
    }
}
