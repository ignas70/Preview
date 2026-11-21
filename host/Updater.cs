using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

// Automatic updates from the project's GitHub releases: the newest release's "Preview-x.y.z-Setup.exe"
// is offered in the app; on "Update" it is downloaded and run silently, and Preview restarts.
static class Updater
{
    public const string Repo = BuildInfo.Repo;   // written by build.ps1 from the git remote
    public static readonly Version Current = typeof(Updater).Assembly.GetName().Version;
    public static string CurrentText { get { return Current.Major + "." + Current.Minor + "." + Current.Build; } }

    public static string LatestVersion, SetupUrl, NotesUrl;
    public static long SetupSize;
    public static bool Available { get { return SetupUrl != null; } }
    public static bool Auto = true;                     // check by itself (settings.txt "updates=0" turns it off)
    static Timer timer;
    static string announced;

    public static void Start()
    {
        if (!Auto || Repo.StartsWith("OWNER")) return;
        timer = new Timer { Interval = 20 * 1000 };     // shortly after start, then twice a day
        timer.Tick += async (s, e) => { timer.Interval = 12 * 60 * 60 * 1000; await Check(); };
        timer.Start();
    }

    // returns null when the check worked, otherwise a short error
    public static async Task<string> Check()
    {
        if (Repo.StartsWith("OWNER")) return "updates are not set up in this build";
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            string body;
            using (var h = new HttpClient())
            {
                h.Timeout = TimeSpan.FromSeconds(20);
                h.DefaultRequestHeaders.UserAgent.ParseAdd("Preview-Updater/" + CurrentText);
                h.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
                var r = await h.GetAsync("https://api.github.com/repos/" + Repo + "/releases/latest");
                if (r.StatusCode == HttpStatusCode.NotFound) return null;          // no release yet
                if (!r.IsSuccessStatusCode) return "GitHub answered " + (int)r.StatusCode;
                body = await r.Content.ReadAsStringAsync();
            }
            var rel = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(body);
            string tag = (rel["tag_name"] ?? "").ToString().TrimStart('v', 'V');
            Version v; if (!Version.TryParse(tag, out v)) return "unexpected release name " + tag;
            string url = null; long size = 0;
            var assets = rel["assets"] as System.Collections.ArrayList;
            if (assets != null) foreach (Dictionary<string, object> a in assets)
            {
                string n = a["name"].ToString();
                if (Regex.IsMatch(n, @"^Preview-[\d.]+-Setup\.exe$", RegexOptions.IgnoreCase)) { url = a["browser_download_url"].ToString(); size = Convert.ToInt64(a["size"]); }
            }
            Program.Trace("update check: latest " + v + ", current " + Current);
            if (v <= Normalize(Current) || url == null || !url.StartsWith("https://github.com/")) { SetupUrl = null; LatestVersion = tag; return null; }
            LatestVersion = tag; SetupUrl = url; SetupSize = size; NotesUrl = rel.ContainsKey("html_url") ? rel["html_url"].ToString() : null;
            if (announced != tag) { announced = tag; Program.Invoker.BeginInvoke(new Action(Announce)); }
            return null;
        }
        catch (Exception ex) { return ex.Message; }
    }
    static Version Normalize(Version v) { return new Version(v.Major, v.Minor, Math.Max(0, v.Build)); }

    static void Announce()
    {
        var msg = new Dictionary<string, object> { { "cmd", "updateAvailable" }, { "version", LatestVersion }, { "notes", NotesUrl } };
        foreach (var w in Program.Windows.ToArray()) foreach (var t in w.Tabs.ToArray()) t.Post(msg);
    }

    // downloads the setup and runs it silently; the setup closes Preview and starts the new version
    public static async Task<string> Install()
    {
        if (!Available) return "no update available";
        string file = Path.Combine(Path.GetTempPath(), "Preview-" + LatestVersion + "-Setup.exe");
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using (var h = new HttpClient())
            {
                h.Timeout = TimeSpan.FromMinutes(10);
                h.DefaultRequestHeaders.UserAgent.ParseAdd("Preview-Updater/" + CurrentText);
                var data = await h.GetByteArrayAsync(SetupUrl);
                if (data.Length < 2 || data[0] != 'M' || data[1] != 'Z' || (SetupSize > 0 && data.Length != SetupSize)) return "the download was incomplete";
                File.WriteAllBytes(file, data);
            }
        }
        catch (Exception ex) { return "download failed: " + ex.Message; }
        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        bool allUsers = exeDir.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), StringComparison.OrdinalIgnoreCase);
        var psi = new ProcessStartInfo(file, "/SILENT /SUPPRESSMSGBOXES /NORESTART " + (allUsers ? "/ALLUSERS" : "/CURRENTUSER") + " /DIR=\"" + exeDir + "\"");
        psi.UseShellExecute = true;
        if (allUsers) psi.Verb = "runas";
        try { Process.Start(psi); }
        catch (Exception ex) { return "could not start the installer: " + ex.Message; }
        // leave so the installer can replace the files
        var quit = new Timer { Interval = 300 };
        quit.Tick += (s, e) => { quit.Stop(); Environment.Exit(0); };
        quit.Start();
        return null;
    }
}
