using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Preview")]
[assembly: System.Reflection.AssemblyProduct("Preview")]
[assembly: System.Reflection.AssemblyDescription("Fast viewer for PDF, Word, Excel, PowerPoint, Apple and Google files")]

static class Program
{
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Preview");
    static readonly string PipeName = "Preview.Instance." + Environment.UserName;
    public static Task<CoreWebView2Environment> Env;
    public static Control Invoker;                       // UI-thread marshaller that outlives any single window
    public static readonly List<MainForm> Windows = new List<MainForm>();
    public static MainForm LastActive;
    public static bool Dark;
    public static bool Resident;                         // started with Windows: never exits on its own

    // PREVIEW_TRACE=1 writes start-up timings to %LOCALAPPDATA%\Preview\trace.txt
    static readonly Stopwatch clock = Stopwatch.StartNew();
    static readonly bool tracing = Environment.GetEnvironmentVariable("PREVIEW_TRACE") == "1";
    public static void Trace(string what)
    {
        if (!tracing) return;
        try { File.AppendAllText(Path.Combine(DataDir, "trace.txt"), clock.ElapsedMilliseconds + " ms  " + what + "\r\n", Encoding.UTF8); } catch { }
    }

    [STAThread]
    static void Main(string[] args)
    {
        Trace("main");
        bool background = false; string path = null;
        foreach (var a in args) { if (a == "--background") background = true; else if (path == null) path = Path.GetFullPath(a); }

        // One process serves all windows: later launches just hand their file over (much faster
        // than starting a second browser engine).
        bool first;
        var mutex = new Mutex(true, "Local\\Preview.Instance", out first);
        if (!first) { if (background || SendToRunning(path)) return; }

        if (path != null) FileCache.Prefetch(path);      // start reading the file right away
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Directory.CreateDirectory(DataDir);
        Settings.Load();
        Updater.Auto = Settings.AutoUpdate; Updater.Start();
        try { Dark = File.ReadAllText(Path.Combine(DataDir, "theme.txt")).Trim() == "dark"; } catch { }
        Resident = background || Settings.Startup;
        Invoker = new Control(); Invoker.CreateControl();
        var h = Invoker.Handle;
        // start the browser engine while the window is being created
        Env = CoreWebView2Environment.CreateAsync(null, Path.Combine(DataDir, "WebView2"),
            new CoreWebView2EnvironmentOptions("--disable-features=msSmartScreenProtection --disable-background-networking", "en-US"));
        Env.ContinueWith(t => Trace("env ready"));
        if (first) new Thread(ListenForOthers) { IsBackground = true }.Start();
        if (background) ScheduleSpare(300);
        else { Open(path, false); Trace("window created"); }
        Application.Run();
        GC.KeepAlive(mutex);
    }

    // ---------------- opening files: new tab in the last window, or a new window ----------------
    public static void Open(string path, bool forceWindow)
    {
        if (lingerTimer != null) lingerTimer.Stop();
        MainForm target = null;
        if (!forceWindow && Settings.Tabs && LastActive != null && !LastActive.IsDisposed && Windows.Contains(LastActive)) target = LastActive;
        DocTab tab = TakeSpare();
        bool fresh = tab == null;
        if (fresh) tab = new DocTab(path);
        if (target == null)
        {
            target = new MainForm(Windows.Count > 0 ? Windows[Windows.Count - 1] : null);
            Windows.Add(target);
            target.FormClosed += (s, e) => { Windows.Remove(target); if (LastActive == target) LastActive = Windows.Count > 0 ? Windows[Windows.Count - 1] : null; WindowClosed(); };
            target.Show();
        }
        target.AddTab(tab);
        if (!fresh) tab.Open(path);
        if (target.WindowState == FormWindowState.Minimized) target.WindowState = FormWindowState.Normal;
        target.Activate();
        LastActive = target;
        ScheduleSpare(2500);
    }

    // A hidden, fully loaded page is kept ready so the next file opens without any start-up cost.
    // After the last window closes the process stays a few minutes (or for good when started with
    // Windows) so re-opening is instant too.
    static DocTab spare;
    static Form parking;
    static System.Windows.Forms.Timer lingerTimer, spareTimer;
    const int LingerMinutes = 10;

    static DocTab TakeSpare()
    {
        if (spare == null || !spare.Ready) return null;
        var t = spare; spare = null;
        Trace("used spare page");
        return t;
    }

    public static void ScheduleSpare(int delay)
    {
        if (spare != null) return;
        if (spareTimer == null)
        {
            spareTimer = new System.Windows.Forms.Timer();
            spareTimer.Tick += (s, e) =>
            {
                spareTimer.Stop();
                if (spare != null) return;
                try
                {
                    if (parking == null) { parking = new Form { ShowInTaskbar = false, Text = "Preview (ready)" }; var ph = parking.Handle; }
                    spare = new DocTab(null);
                    parking.Controls.Add(spare.Web);
                    var wh = spare.Web.Handle;
                    var ignored = spare.Init();
                }
                catch { spare = null; }
            };
        }
        spareTimer.Interval = delay;
        spareTimer.Start();
    }

    static void WindowClosed()
    {
        if (Windows.Count > 0 || Resident) return;
        if (lingerTimer == null)
        {
            lingerTimer = new System.Windows.Forms.Timer();
            lingerTimer.Tick += (a, b) => { lingerTimer.Stop(); if (Windows.Count == 0 && !Resident) Application.ExitThread(); };
        }
        lingerTimer.Interval = LingerMinutes * 60 * 1000;
        lingerTimer.Start();
    }

    public static void SetTheme(bool dark)
    {
        Dark = dark;
        try { File.WriteAllText(Path.Combine(DataDir, "theme.txt"), dark ? "dark" : "light"); } catch { }
        foreach (var w in Windows.ToArray()) w.ApplyTheme();
        if (spare != null) spare.ApplyTheme();
    }

    static bool SendToRunning(string path)
    {
        for (int attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                using (var c = new NamedPipeClientStream(".", PipeName, PipeDirection.Out))
                {
                    c.Connect(400);
                    var b = Encoding.UTF8.GetBytes(path ?? "");
                    c.Write(b, 0, b.Length); c.Flush();
                    return true;
                }
            }
            catch { Thread.Sleep(100); }
        }
        return false;
    }

    static void ListenForOthers()
    {
        while (true)
        {
            try
            {
                using (var s = new NamedPipeServerStream(PipeName, PipeDirection.In, 1))
                {
                    s.WaitForConnection();
                    var ms = new MemoryStream(); s.CopyTo(ms);
                    string p = Encoding.UTF8.GetString(ms.ToArray());
                    if (p.Length == 0) p = null; else FileCache.Prefetch(p);
                    Invoker.BeginInvoke(new Action(() => Open(p, false)));
                }
            }
            catch { Thread.Sleep(200); }
        }
    }

    // The browser caches the app's own files; after an update they must be reloaded, so the cache is
    // cleared once whenever the files in .\app change (settings and saved signatures are kept).
    static Task cacheCheck;
    public static Task ClearStaleCache(CoreWebView2 cw)
    {
        if (cacheCheck != null) return cacheCheck;
        string stamp = "";
        try
        {
            long newest = 0;
            foreach (var f in Directory.GetFiles(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"), "*", SearchOption.AllDirectories))
                newest = Math.Max(newest, File.GetLastWriteTimeUtc(f).Ticks);
            stamp = newest.ToString();
        }
        catch { }
        string file = Path.Combine(DataDir, "app-stamp.txt"), old = "";
        try { old = File.ReadAllText(file); } catch { }
        if (stamp == old) return cacheCheck = Task.FromResult(0);
        try { File.WriteAllText(file, stamp); } catch { }
        Trace("clearing cache (app files changed)");
        try { return cacheCheck = cw.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.CacheStorage); }
        catch { return cacheCheck = Task.FromResult(0); }
    }
}

// User preferences kept by the host (the page keeps its own in localStorage).
static class Settings
{
    public static bool Tabs = true;
    public static bool Startup;
    public static bool AutoUpdate = true;
    static string FilePath { get { return Path.Combine(Program.DataDir, "settings.txt"); } }
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static void Load()
    {
        try
        {
            foreach (var line in File.ReadAllLines(FilePath))
            {
                var kv = line.Split(new[] { '=' }, 2); if (kv.Length != 2) continue;
                if (kv[0] == "tabs") Tabs = kv[1] == "1";
                if (kv[0] == "updates") AutoUpdate = kv[1] == "1";
            }
        }
        catch { }
        try { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) Startup = k != null && k.GetValue("Preview") != null; } catch { }
    }

    public static void Save()
    {
        try { File.WriteAllText(FilePath, "tabs=" + (Tabs ? "1" : "0") + "\r\nupdates=" + (AutoUpdate ? "1" : "0") + "\r\n"); } catch { }
    }

    public static void SetStartup(bool on)
    {
        using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
        {
            if (on) k.SetValue("Preview", "\"" + Application.ExecutablePath + "\" --background");
            else k.DeleteValue("Preview", false);
        }
        Startup = on;
        Program.Resident = on;
    }
}

// Reads files on a worker thread; a read started at launch is reused when the page asks for it.
static class FileCache
{
    static readonly Dictionary<string, Task<byte[]>> pending = new Dictionary<string, Task<byte[]>>(StringComparer.OrdinalIgnoreCase);
    public const long RangeThreshold = 8L << 20; // larger PDFs are read piece by piece instead

    public static void Prefetch(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            if (!fi.Exists || (fi.Length > RangeThreshold && path.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))) return;
        }
        catch { return; }
        lock (pending) { if (!pending.ContainsKey(path)) pending[path] = Task.Run(() => Read(path)); }
    }

    public static Task<byte[]> Take(string path)
    {
        lock (pending)
        {
            Task<byte[]> t;
            if (pending.TryGetValue(path, out t)) { pending.Remove(path); return t; }
        }
        return Task.Run(() => Read(path));
    }

    public static byte[] ReadRange(string path, long from, long to)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16))
        {
            to = Math.Min(to, fs.Length);
            var data = new byte[Math.Max(0, to - from)];
            fs.Seek(from, SeekOrigin.Begin);
            int off = 0;
            while (off < data.Length) { int n = fs.Read(data, off, data.Length - off); if (n <= 0) break; off += n; }
            return data;
        }
    }

    static byte[] Read(string path)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, FileOptions.SequentialScan))
        {
            var data = new byte[fs.Length];
            int off = 0;
            while (off < data.Length) { int n = fs.Read(data, off, data.Length - off); if (n <= 0) break; off += n; }
            return data;
        }
    }
}
