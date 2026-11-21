using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// A window holding one or more documents in tabs.
class MainForm : Form
{
    readonly TabStrip strip;
    readonly Panel content = new Panel { Dock = DockStyle.Fill };
    public readonly List<DocTab> Tabs = new List<DocTab>();
    public DocTab Active;
    bool allowClose;

    public MainForm(Form cascadeFrom)
    {
        Text = "Preview";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        MinimumSize = new Size(640, 420);
        strip = new TabStrip(this) { Dock = DockStyle.Top, Visible = false };
        Controls.Add(content);
        Controls.Add(strip);
        LoadBounds(cascadeFrom);
        ApplyTheme();
        FormClosing += OnClosing;
        Activated += (s, e) => { Program.LastActive = this; };
    }

    // ---------------- tabs ----------------
    public void AddTab(DocTab tab)
    {
        tab.Owner = this;
        Tabs.Add(tab);
        tab.Web.Visible = false;
        content.Controls.Add(tab.Web);
        var h = tab.Web.Handle;
        var ignored = tab.Init();
        ActivateTab(tab);
    }

    public void ActivateTab(DocTab tab)
    {
        if (!Tabs.Contains(tab)) return;
        Active = tab;
        foreach (var t in Tabs) t.Web.Visible = t == tab;
        tab.Web.BringToFront();
        tab.Web.Focus();
        Text = tab.Title;
        UpdateStrip();
    }

    public async void CloseTab(DocTab tab)
    {
        if (!await tab.CanClose()) return;
        RemoveTab(tab);
    }

    void RemoveTab(DocTab tab)
    {
        int i = Tabs.IndexOf(tab); if (i < 0) return;
        Tabs.RemoveAt(i);
        content.Controls.Remove(tab.Web);
        tab.Web.Dispose();
        if (Tabs.Count == 0) { allowClose = true; Close(); return; }
        if (Active == tab) ActivateTab(Tabs[Math.Min(i, Tabs.Count - 1)]);
        else UpdateStrip();
    }

    public void MoveTab(int from, int to)
    {
        if (from == to || from < 0 || to < 0 || from >= Tabs.Count || to >= Tabs.Count) return;
        var t = Tabs[from]; Tabs.RemoveAt(from); Tabs.Insert(to, t);
        strip.Invalidate();
    }

    public void TabTitleChanged(DocTab tab)
    {
        if (tab == Active) Text = tab.Title;
        strip.Invalidate();
    }

    void UpdateStrip()
    {
        bool show = Tabs.Count > 1;
        if (strip.Visible != show) { strip.Visible = show; ApplyFrame(); }
        strip.Invalidate();
    }

    // ---------------- full screen (presentation mode) ----------------
    FormBorderStyle savedBorder; FormWindowState savedState; Rectangle savedBounds; bool fullScreen;
    public void SetFullScreen(bool on)
    {
        if (on == fullScreen) return;
        fullScreen = on;
        if (on)
        {
            savedBorder = FormBorderStyle; savedState = WindowState; savedBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            strip.Visible = false;
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Normal;
            Bounds = Screen.FromControl(this).Bounds;
            TopMost = true;
        }
        else
        {
            TopMost = false;
            FormBorderStyle = savedBorder;
            Bounds = savedBounds;
            WindowState = savedState;
            UpdateStrip();
            ApplyFrame();
        }
    }

    // Ctrl+W / Ctrl+T / Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageUp/Down / Ctrl+1…9
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        var key = keyData & Keys.KeyCode;
        bool ctrl = (keyData & Keys.Control) != 0, shift = (keyData & Keys.Shift) != 0;
        if (ctrl && Active != null)
        {
            int i = Tabs.IndexOf(Active);
            if (key == Keys.W || key == Keys.F4) { CloseTab(Active); return true; }
            if (key == Keys.T) { Program.Open(null, false); return true; }
            if (key == Keys.Tab || key == Keys.PageDown || key == Keys.PageUp)
            {
                if (Tabs.Count < 2) return false;
                int d = (key == Keys.PageUp || (key == Keys.Tab && shift)) ? -1 : 1;
                ActivateTab(Tabs[(i + d + Tabs.Count) % Tabs.Count]); return true;
            }
            if (key >= Keys.D1 && key <= Keys.D9 && Tabs.Count > 1 && !shift)
            {
                int n = key == Keys.D9 ? Tabs.Count - 1 : Math.Min(Tabs.Count - 1, key - Keys.D1);
                ActivateTab(Tabs[n]); return true;
            }
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    async void OnClosing(object sender, FormClosingEventArgs e)
    {
        if (allowClose) { SaveBounds(); return; }
        e.Cancel = true;
        foreach (var t in Tabs.ToArray()) if (!await t.CanClose()) return;
        allowClose = true;
        Close();
    }

    // ---------------- colours: title bar blends into the tab strip / toolbar ----------------
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    static int Colorref(Color c) { return c.R | (c.G << 8) | (c.B << 16); }
    public static Color StripColor { get { return Program.Dark ? Color.FromArgb(24, 24, 26) : Color.FromArgb(232, 232, 235); } }
    public static Color BarColor { get { return Program.Dark ? Color.FromArgb(32, 32, 35) : Color.FromArgb(243, 243, 243); } }

    public void ApplyTheme()
    {
        BackColor = Program.Dark ? Color.FromArgb(27, 27, 29) : Color.FromArgb(243, 243, 243);
        content.BackColor = BackColor;
        foreach (var t in Tabs) t.ApplyTheme();
        strip.Invalidate();
        ApplyFrame();
    }

    void ApplyFrame()
    {
        if (!IsHandleCreated) return;
        int v = Program.Dark ? 1 : 0;
        int caption = Colorref(strip.Visible ? StripColor : BarColor);
        int text = Colorref(Program.Dark ? Color.FromArgb(230, 230, 232) : Color.FromArgb(26, 26, 26));
        int border = Colorref(Program.Dark ? Color.FromArgb(17, 17, 19) : Color.FromArgb(217, 217, 220));
        try
        {
            DwmSetWindowAttribute(Handle, 20, ref v, 4);         // immersive dark mode
            DwmSetWindowAttribute(Handle, 35, ref caption, 4);   // caption colour
            DwmSetWindowAttribute(Handle, 36, ref text, 4);
            DwmSetWindowAttribute(Handle, 34, ref border, 4);
        }
        catch { }
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); ApplyFrame(); }

    // ---------------- window position ----------------
    static string BoundsFile { get { return Path.Combine(Program.DataDir, "window.txt"); } }

    void LoadBounds(Form cascadeFrom)
    {
        StartPosition = FormStartPosition.Manual;
        var wa = Screen.PrimaryScreen.WorkingArea;
        var r = new Rectangle(wa.X + wa.Width / 10, wa.Y + wa.Height / 12, wa.Width * 8 / 10, wa.Height * 10 / 12);
        bool max = false;
        if (cascadeFrom != null && !cascadeFrom.IsDisposed)
        {
            var b = cascadeFrom.WindowState == FormWindowState.Normal ? cascadeFrom.Bounds : cascadeFrom.RestoreBounds;
            r = new Rectangle(b.X + 28, b.Y + 28, b.Width, b.Height);
            max = cascadeFrom.WindowState == FormWindowState.Maximized;
        }
        else
        {
            try
            {
                var p = File.ReadAllText(BoundsFile).Split(',');
                var saved = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                foreach (var s in Screen.AllScreens)
                    if (s.WorkingArea.IntersectsWith(saved) && saved.Width >= 400 && saved.Height >= 300) { r = saved; break; }
                max = p.Length > 4 && p[4] == "1";
            }
            catch { }
        }
        Bounds = r;
        if (max) WindowState = FormWindowState.Maximized;
    }

    void SaveBounds()
    {
        try
        {
            var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(BoundsFile, b.X + "," + b.Y + "," + b.Width + "," + b.Height + "," + (WindowState == FormWindowState.Maximized ? "1" : "0"));
        }
        catch { }
    }
}
