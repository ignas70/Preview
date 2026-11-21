using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

// Tab bar drawn to match the app: the active tab joins the toolbar below it (Shot/Windows 11 style).
class TabStrip : Control
{
    readonly MainForm form;
    int hover = -1, hoverClose = -1, dragFrom = -1, pressX;
    bool hoverPlus;
    const float GlyphPt = 7.5f;

    public TabStrip(MainForm f)
    {
        form = f;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        Height = Scale(38);
        Font = new Font("Segoe UI", 9f);
    }

    int Scale(int px) { return (int)Math.Round(px * DeviceDpi / 96.0); }

    Rectangle TabRect(int i)
    {
        int n = form.Tabs.Count, left = Scale(8), plus = Scale(40);
        int w = Math.Min(Scale(240), Math.Max(Scale(90), (Width - left - plus) / Math.Max(1, n)));
        return new Rectangle(left + i * w, Scale(6), w, Height - Scale(6));
    }
    Rectangle CloseRect(Rectangle t) { int s = Scale(20); return new Rectangle(t.Right - s - Scale(8), t.Top + (t.Height - s) / 2, s, s); }
    Rectangle PlusRect() { var last = TabRect(form.Tabs.Count - 1); int s = Scale(28); return new Rectangle(last.Right + Scale(6), Scale(6) + (Height - Scale(6) - s) / 2, s, s); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        g.Clear(MainForm.StripColor);
        bool dark = Program.Dark;
        var text = dark ? Color.FromArgb(230, 230, 232) : Color.FromArgb(26, 26, 26);
        var muted = dark ? Color.FromArgb(142, 142, 147) : Color.FromArgb(97, 97, 97);
        var hoverBg = dark ? Color.FromArgb(38, 38, 42) : Color.FromArgb(222, 222, 226);
        var sep = dark ? Color.FromArgb(52, 52, 56) : Color.FromArgb(205, 205, 210);
        using (var glyph = new Font("Segoe Fluent Icons", GlyphPt))
        {
            for (int i = 0; i < form.Tabs.Count; i++)
            {
                var t = form.Tabs[i]; var r = TabRect(i); bool active = t == form.Active;
                if (active || i == hover)
                {
                    using (var path = TopRounded(r, Scale(8)))
                    using (var b = new SolidBrush(active ? MainForm.BarColor : hoverBg)) g.FillPath(b, path);
                }
                else if (i + 1 < form.Tabs.Count && form.Tabs[i + 1] != form.Active && i + 1 != hover)
                    using (var p = new Pen(sep)) g.DrawLine(p, r.Right, r.Top + Scale(9), r.Right, r.Bottom - Scale(9));
                var tr = new Rectangle(r.Left + Scale(12), r.Top, r.Width - Scale(44), r.Height);
                TextRenderer.DrawText(g, t.ShortTitle, Font, tr, active ? text : muted,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                if (active || i == hover)
                {
                    var cr = CloseRect(r);
                    if (i == hoverClose) using (var b = new SolidBrush(dark ? Color.FromArgb(60, 60, 64) : Color.FromArgb(205, 205, 210))) g.FillEllipse(b, cr);
                    TextRenderer.DrawText(g, "", glyph, cr, muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                }
            }
            if (form.Tabs.Count > 0)
            {
                var pr = PlusRect();
                if (hoverPlus) using (var b = new SolidBrush(hoverBg)) g.FillEllipse(b, pr);
                TextRenderer.DrawText(g, "", glyph, pr, muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
            }
        }
    }

    static GraphicsPath TopRounded(Rectangle r, int rad)
    {
        var p = new GraphicsPath(); int d = rad * 2;
        p.AddLine(r.Left - rad, r.Bottom, r.Left, r.Bottom - 0);
        p.AddArc(r.Left, r.Top, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        p.AddLine(r.Right, r.Bottom, r.Right + rad, r.Bottom);
        p.CloseFigure();
        return p;
    }

    int HitTab(Point pt) { for (int i = 0; i < form.Tabs.Count; i++) if (TabRect(i).Contains(pt)) return i; return -1; }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (dragFrom >= 0 && Math.Abs(e.X - pressX) > Scale(6))
        {
            int to = HitTab(new Point(e.X, Height / 2));
            if (to >= 0 && to != dragFrom) { form.MoveTab(dragFrom, to); dragFrom = to; }
        }
        int h = HitTab(e.Location), hc = h >= 0 && CloseRect(TabRect(h)).Contains(e.Location) ? h : -1;
        bool hp = form.Tabs.Count > 0 && PlusRect().Contains(e.Location);
        if (h != hover || hc != hoverClose || hp != hoverPlus) { hover = h; hoverClose = hc; hoverPlus = hp; Invalidate(); }
    }

    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); hover = hoverClose = -1; hoverPlus = false; Invalidate(); }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        int i = HitTab(e.Location);
        if (e.Button == MouseButtons.Left)
        {
            if (i >= 0 && !CloseRect(TabRect(i)).Contains(e.Location)) { form.ActivateTab(form.Tabs[i]); dragFrom = i; pressX = e.X; }
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        int i = HitTab(e.Location);
        if (e.Button == MouseButtons.Left)
        {
            if (dragFrom < 0 && i >= 0 && CloseRect(TabRect(i)).Contains(e.Location)) form.CloseTab(form.Tabs[i]);
            else if (dragFrom < 0 && form.Tabs.Count > 0 && PlusRect().Contains(e.Location)) Program.Open(null, false);
            else if (dragFrom >= 0 && i >= 0 && Math.Abs(e.X - pressX) <= Scale(6) && CloseRect(TabRect(i)).Contains(e.Location)) form.CloseTab(form.Tabs[i]);
        }
        else if (e.Button == MouseButtons.Middle && i >= 0) form.CloseTab(form.Tabs[i]);
        dragFrom = -1;
    }

    protected override void OnDoubleClick(EventArgs e)
    {
        base.OnDoubleClick(e);
        var pt = PointToClient(Cursor.Position);
        if (HitTab(pt) < 0 && !(form.Tabs.Count > 0 && PlusRect().Contains(pt))) Program.Open(null, false);
    }
}
