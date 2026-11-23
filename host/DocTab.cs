using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// One open document: a browser view running the Preview page.
class DocTab
{
    public const string AppHost = "https://app.preview/";
    const string Cors = "Access-Control-Allow-Origin: https://app.preview\r\nCache-Control: no-store";
    const string OpenFilter =
        "All supported files|*.pdf;*.docx;*.docm;*.dotx;*.doc;*.rtf;*.odt;*.xlsx;*.xlsm;*.xlsb;*.xls;*.ods;*.csv;*.numbers;*.pptx;*.ppsx;*.potx;*.ppt;*.pps;*.odp;*.pages;*.key;*.gdoc;*.gsheet;*.gslides;*.txt;*.md;*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp" +
        "|PDF|*.pdf|Word and text|*.docx;*.docm;*.dotx;*.doc;*.rtf;*.odt;*.txt;*.md|Spreadsheets|*.xlsx;*.xlsm;*.xlsb;*.xls;*.ods;*.csv;*.numbers" +
        "|Presentations|*.pptx;*.ppsx;*.potx;*.ppt;*.pps;*.odp|Apple (Pages, Numbers, Keynote)|*.pages;*.numbers;*.key|Google|*.gdoc;*.gsheet;*.gslides" +
        "|Images (turned into a PDF)|*.jpg;*.jpeg;*.png;*.gif;*.webp;*.bmp|All files|*.*";

    public readonly WebView2 Web = new WebView2();
    public string Title = "Preview";
    public bool Ready { get; private set; }
    public MainForm Owner;
    readonly string startPath;
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
    bool initStarted;

    public DocTab(string path)
    {
        startPath = path;
        Web.Dock = DockStyle.Fill;
        ApplyTheme();
    }

    public void ApplyTheme()
    {
        Web.DefaultBackgroundColor = Program.Dark ? Color.FromArgb(27, 27, 29) : Color.FromArgb(243, 243, 243);
    }

    IWin32Window DialogOwner { get { return (IWin32Window)Owner ?? Web; } }

    public async Task Init()
    {
        if (initStarted) return;
        initStarted = true;
        Program.Trace("tab init");
        try { await Web.EnsureCoreWebView2Async(await Program.Env); Program.Trace("webview ready"); }
        catch (Exception ex)
        {
            MessageBox.Show("The browser component (WebView2) could not start:\n" + ex.Message, "Preview", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var cw = Web.CoreWebView2;
        await Program.ClearStaleCache(cw);
        cw.Settings.IsStatusBarEnabled = false;
        cw.Settings.IsZoomControlEnabled = false;
        cw.Settings.IsBuiltInErrorPageEnabled = false;
        cw.SetVirtualHostNameToFolderMapping("app.preview", Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"), CoreWebView2HostResourceAccessKind.Allow);
        cw.AddWebResourceRequestedFilter("https://file.preview/*", CoreWebView2WebResourceContext.All);
        cw.WebResourceRequested += OnResource;
        cw.WebMessageReceived += (s, e) => { string raw = e.WebMessageAsJson; Program.Invoker.BeginInvoke(new Action(() => HandleMessage(raw))); };
        cw.DocumentTitleChanged += (s, e) =>
        {
            Title = cw.DocumentTitle;
            Program.Trace("title: " + Title);
            if (Owner != null) Owner.TabTitleChanged(this);
        };
        cw.DOMContentLoaded += (s, e) => Program.Trace("dom loaded");
        cw.NavigationCompleted += (s, e) =>
        {
            if (!e.IsSuccess) return;
            Ready = true;
            // developer hook for automated tests: PREVIEW_EVAL runs a script after the page loads
            var dev = Environment.GetEnvironmentVariable("PREVIEW_EVAL");
            if (!string.IsNullOrEmpty(dev) && Owner != null) cw.ExecuteScriptAsync(dev);
        };
        cw.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
        cw.NavigationStarting += (s, e) =>
        {
            if (e.Uri.StartsWith(AppHost)) return;
            e.Cancel = true;
            if (e.Uri.StartsWith("file:///")) { try { Open(new Uri(e.Uri).LocalPath); } catch { } }
            else OpenExternal(e.Uri);
        };
        // presentation mode: make the whole window full screen while the page is
        cw.ContainsFullScreenElementChanged += (s, e) => { if (Owner != null) Owner.SetFullScreen(cw.ContainsFullScreenElement); };
        // tab shortcuts (Ctrl+W, Ctrl+Tab, …) reach MainForm.ProcessCmdKey through the WinForms control
        cw.Navigate(AppUrl(startPath));
    }

    static string AppUrl(string path)
    {
        string url = AppHost + "index.html";
        if (!string.IsNullOrEmpty(path)) url += "?path=" + Uri.EscapeDataString(Path.GetFullPath(path));
        return url;
    }

    // Shows a file in this (already loaded) page.
    public void Open(string path)
    {
        var cw = Web.CoreWebView2; if (cw == null) return;
        if (path != null) cw.ExecuteScriptAsync("prefetchFor(extOf(" + json.Serialize(path) + ")); openPath(" + json.Serialize(path) + ");");
        else cw.ExecuteScriptAsync("setMode('home');");
    }

    public async Task<bool> CanClose()
    {
        if (Web.CoreWebView2 == null) return true;
        string r = "false";
        try { r = await Web.CoreWebView2.ExecuteScriptAsync("!!(window.isDirty && window.isDirty())"); } catch { }
        if (r != "true") return true;
        if (Owner != null) Owner.ActivateTab(this);
        return MessageBox.Show(DialogOwner, "\"" + ShortTitle + "\" has unsaved changes. Close anyway?", "Preview",
            MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes;
    }

    public string ShortTitle
    {
        get { var t = Title ?? "Preview"; int i = t.LastIndexOf(" – Preview"); return i > 0 ? t.Substring(0, i) : t; }
    }

    // ---------------- files for the page ----------------
    void Respond(CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Deferral deferral, byte[] data, int status, string error)
    {
        try
        {
            var env = Web.CoreWebView2.Environment;
            if (status == 200)
                e.Response = env.CreateWebResourceResponse(new MemoryStream(data), 200, "OK", "Content-Type: application/octet-stream\r\n" + Cors);
            else
                e.Response = env.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(error ?? "")), status, "Error", "Content-Type: text/plain; charset=utf-8\r\n" + Cors);
        }
        catch { }
        finally { deferral.Complete(); }
    }

    void OnResource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        string path = null, url = null; long from = -1, to = -1; bool stat = false;
        foreach (var part in new Uri(e.Request.Uri).Query.TrimStart('?').Split('&'))
        {
            if (part.StartsWith("p=")) path = Uri.UnescapeDataString(part.Substring(2));
            if (part.StartsWith("u=")) url = Uri.UnescapeDataString(part.Substring(2));
            if (part.StartsWith("from=")) long.TryParse(part.Substring(5), out from);
            if (part.StartsWith("to=")) long.TryParse(part.Substring(3), out to);
            if (part == "stat=1") stat = true;
        }
        Program.Trace("file requested" + (stat ? " (size)" : from >= 0 ? " (range)" : ""));
        var deferral = e.GetDeferral();
        if (url != null) { ProxyGoogle(e, deferral, url); return; }
        if (path == null) { Respond(e, deferral, null, 400, "no path"); return; }
        Task<byte[]> job;
        if (stat) job = Task.Run(() => Encoding.ASCII.GetBytes(new FileInfo(path).Length.ToString()));
        else if (from >= 0 && to > from) job = Task.Run(() => FileCache.ReadRange(path, from, to));
        else job = FileCache.Take(path);
        job.ContinueWith(t =>
        {
            byte[] data = t.Status == TaskStatus.RanToCompletion ? t.Result : null;
            string err = t.Exception != null ? t.Exception.GetBaseException().Message : null;
            Program.Invoker.BeginInvoke(new Action(() => Respond(e, deferral, data, data != null ? 200 : 404, err)));
        });
    }

    // Downloads a Google Docs/Sheets/Slides export (only works for documents shared "anyone with the link").
    void ProxyGoogle(CoreWebView2WebResourceRequestedEventArgs e, CoreWebView2Deferral deferral, string url)
    {
        Task.Run(async () =>
        {
            byte[] data = null; int status = 200;
            try
            {
                var u = new Uri(url);
                if (u.Scheme != "https" || u.Host != "docs.google.com") throw new Exception("blocked");
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                using (var h = new HttpClient())
                {
                    h.Timeout = TimeSpan.FromSeconds(90);
                    var r = await h.GetAsync(u);
                    var ct = r.Content.Headers.ContentType != null ? r.Content.Headers.ContentType.MediaType ?? "" : "";
                    if (!r.IsSuccessStatusCode) status = (int)r.StatusCode;
                    else if (ct.Contains("html")) status = 403; // sign-in page: the document is private
                    else data = await r.Content.ReadAsByteArrayAsync();
                }
            }
            catch { status = 502; }
            Program.Invoker.BeginInvoke(new Action(() => Respond(e, deferral, data, status, "unavailable")));
        });
    }

    // ---------------- messages from the page ----------------
    static string Str(Dictionary<string, object> m, string k)
    {
        object v; return m.TryGetValue(k, out v) && v != null ? v.ToString() : null;
    }

    public void Post(Dictionary<string, object> msg) { Reply(msg); }

    void Reply(Dictionary<string, object> reply)
    {
        try { Web.CoreWebView2.PostWebMessageAsJson(json.Serialize(reply)); } catch { }
    }

    void HandleMessage(string raw)
    {
        Dictionary<string, object> m;
        try { m = json.Deserialize<Dictionary<string, object>>(raw); } catch { return; }
        if (m == null) return;
        object id; m.TryGetValue("id", out id);
        var reply = new Dictionary<string, object>();
        reply["id"] = id;
        try
        {
            string dir = Str(m, "dir");
            switch (Str(m, "cmd"))
            {
                case "trace": Program.Trace("page: " + Str(m, "what")); return;
                case "printToPdf": PrintToPdf(m, reply); return;
                case "open":
                    using (var d = new OpenFileDialog())
                    {
                        d.Filter = OpenFilter;
                        if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) d.InitialDirectory = dir;
                        if (d.ShowDialog(DialogOwner) == DialogResult.OK) { reply["path"] = d.FileName; FileCache.Prefetch(d.FileName); }
                    }
                    break;
                case "saveAs":
                    using (var d = new SaveFileDialog())
                    {
                        d.Filter = Str(m, "filter") ?? "PDF document|*.pdf";
                        d.FileName = Str(m, "name") ?? "";
                        d.OverwritePrompt = true;
                        if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) d.InitialDirectory = dir;
                        if (d.ShowDialog(DialogOwner) == DialogResult.OK)
                        {
                            File.WriteAllBytes(d.FileName, Convert.FromBase64String(Str(m, "data")));
                            reply["path"] = d.FileName;
                        }
                    }
                    break;
                case "external": OpenExternal(Str(m, "url")); break;
                case "openWith": Process.Start("rundll32.exe", "shell32.dll,OpenAs_RunDLL " + Str(m, "path")); break;
                case "showInFolder": Process.Start("explorer.exe", "/select,\"" + Str(m, "path") + "\""); break;
                case "newWindow": FileCache.Prefetch(Str(m, "path")); Program.Open(Str(m, "path"), false); break;
                case "theme": Program.SetTheme(Str(m, "dark") == "True"); break;
                case "getSettings":
                    reply["tabs"] = Settings.Tabs; reply["startup"] = Settings.Startup; reply["updates"] = Settings.AutoUpdate;
                    reply["version"] = Updater.CurrentText; reply["latest"] = Updater.Available ? Updater.LatestVersion : null;
                    break;
                case "checkUpdate": CheckUpdate(reply); return;
                case "installUpdate": InstallUpdate(reply); return;
                case "setSetting":
                    if (Str(m, "name") == "tabs") { Settings.Tabs = Str(m, "value") == "True"; Settings.Save(); }
                    if (Str(m, "name") == "startup") Settings.SetStartup(Str(m, "value") == "True");
                    if (Str(m, "name") == "updates") { Settings.AutoUpdate = Updater.Auto = Str(m, "value") == "True"; Settings.Save(); Updater.Start(); }
                    reply["tabs"] = Settings.Tabs; reply["startup"] = Settings.Startup; reply["updates"] = Settings.AutoUpdate;
                    break;
            }
        }
        catch (Exception ex) { reply["error"] = ex.Message; }
        Reply(reply);
    }

    async void CheckUpdate(Dictionary<string, object> reply)
    {
        string err = await Updater.Check();
        if (err != null) reply["error"] = err;
        reply["latest"] = Updater.Available ? Updater.LatestVersion : null; reply["version"] = Updater.CurrentText;
        Reply(reply);
    }
    async void InstallUpdate(Dictionary<string, object> reply)
    {
        string err = await Updater.Install();
        if (err != null) reply["error"] = err;
        Reply(reply);
    }

    // "Save as PDF" for any document: prints the page (with its print styles) to a PDF file.
    async void PrintToPdf(Dictionary<string, object> m, Dictionary<string, object> reply)
    {
        try
        {
            string file = Environment.GetEnvironmentVariable("PREVIEW_PDFOUT"), dir = Str(m, "dir");   // dev hook for automated tests
            if (string.IsNullOrEmpty(file)) file = null; else { }
            if (file == null) using (var d = new SaveFileDialog())
            {
                d.Filter = "PDF document|*.pdf"; d.FileName = Str(m, "name") ?? "document.pdf"; d.OverwritePrompt = true;
                if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) d.InitialDirectory = dir;
                if (d.ShowDialog(DialogOwner) == DialogResult.OK) file = d.FileName;
            }
            if (file != null)
            {
                var s = Web.CoreWebView2.Environment.CreatePrintSettings();
                s.ShouldPrintBackgrounds = true;
                s.ShouldPrintHeaderAndFooter = false;
                s.MarginTop = s.MarginBottom = s.MarginLeft = s.MarginRight = 0;
                s.Orientation = Str(m, "landscape") == "True" ? CoreWebView2PrintOrientation.Landscape : CoreWebView2PrintOrientation.Portrait;
                if (await Web.CoreWebView2.PrintToPdfAsync(file, s)) reply["path"] = file; else reply["error"] = "printing failed";
            }
        }
        catch (Exception ex) { reply["error"] = ex.Message; }
        Reply(reply);
    }

    static void OpenExternal(string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
}
