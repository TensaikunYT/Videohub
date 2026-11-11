// Render Guard — shows which Claude session is rendering what, how far along it is,
// and caps how much CPU renders may use while you are at the PC.
// It is also VideoHub's native agent: it writes its live state to %APPDATA%\RenderGuard\state.json every 2 s,
// takes commands from %APPDATA%\RenderGuard\cmd\*.json and starts / opens the VideoHub server.
// Build: build.ps1 (uses the .NET Framework 4 csc that ships with Windows, C# 5).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

// Built as VideoHubAgent.exe: an invisible part of VideoHub (no window, no tray icon, no notifications).
// The hub starts it with --agent when a VideoHub window opens or a render runs, and stops it when it idles out.
[assembly: System.Reflection.AssemblyTitle("VideoHub Agent")]
[assembly: System.Reflection.AssemblyProduct("VideoHub")]
[assembly: System.Reflection.AssemblyDescription("VideoHub render protection: CPU caps, RAM slow mode, emergency hotkeys")]
[assembly: System.Reflection.AssemblyVersion("1.2.0.0")]

namespace RenderGuard
{
    // ------------------------------------------------------------------ native
    static class N
    {
        [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
        [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
        [DllImport("kernel32.dll")] public static extern bool GetSystemTimes(out long idle, out long kernel, out long user);
        [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);
        [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] public static extern int SetWindowTheme(IntPtr h, string app, string id);
        [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
        [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
        [DllImport("kernel32.dll")] public static extern bool SetProcessInformation(IntPtr h, int cls, ref uint info, int size);
        [DllImport("kernel32.dll")] public static extern bool SetProcessWorkingSetSizeEx(IntPtr h, IntPtr min, IntPtr max, uint flags);
        [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject")] public static extern bool QueryJobRaw(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);

        public static long AvailMB()
        {
            var m = new MEMORYSTATUSEX();
            return GlobalMemoryStatusEx(m) ? (long)(m.ullAvailPhys / 1048576) : long.MaxValue;
        }

        // suspend / resume a whole process (all threads). A suspended process touches no memory,
        // so Windows can page it out once instead of thrashing.
        public static void Suspend(int pid, bool on)
        {
            IntPtr h = OpenProcess(0x0800, false, pid);   // PROCESS_SUSPEND_RESUME
            if (h == IntPtr.Zero) return;
            try { if (on) NtSuspendProcess(h); else NtResumeProcess(h); } finally { CloseHandle(h); }
        }

        // MEMORY_PRIORITY_LOW: Windows reclaims these pages before the desktop's
        public static void LowMemoryPriority(int pid) { MemoryPriority(pid, 2); }

        // 1 = very low (slow mode: trimmed first), 2 = low, 5 = normal
        public static void MemoryPriority(int pid, uint prio)
        {
            IntPtr h = OpenProcess(0x0200, false, pid);   // PROCESS_SET_INFORMATION
            if (h == IntPtr.Zero) return;
            try { SetProcessInformation(h, 0, ref prio, 4); } finally { CloseHandle(h); }
        }

        public static List<int> JobPids(IntPtr job)
        {
            var list = new List<int>(); const int max = 2048; int size = 8 + 8 * max;
            IntPtr buf = Marshal.AllocHGlobal(size);
            try
            {
                if (QueryJobRaw(job, 3, buf, size, IntPtr.Zero))    // JobObjectBasicProcessIdList
                {
                    int n = Marshal.ReadInt32(buf, 4);
                    for (int i = 0; i < n && i < max; i++) list.Add((int)Marshal.ReadInt64(buf, 8 + 8 * i));
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
            return list;
        }

        [StructLayout(LayoutKind.Sequential)]
        public class MEMORYSTATUSEX
        {
            public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            public uint dwMemoryLoad;
            public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
        }
        [DllImport("kernel32.dll")] public static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX m);

        [StructLayout(LayoutKind.Sequential)] public struct CPU_RATE { public uint ControlFlags; public uint CpuRate; }
        [StructLayout(LayoutKind.Sequential)]
        public struct ACCOUNTING { public long TotalUserTime, TotalKernelTime, ThisPeriodUser, ThisPeriodKernel; public uint PageFaults, TotalProcesses, ActiveProcesses, Terminated; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr attr, string name);
        [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref CPU_RATE info, int len);
        [DllImport("kernel32.dll")] public static extern bool QueryInformationJobObject(IntPtr job, int cls, out ACCOUNTING info, int len, IntPtr ret);
        [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
        [DllImport("kernel32.dll")] public static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool result);
        [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll")] public static extern bool IsWow64Process(IntPtr h, out bool wow);
        [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);

        [StructLayout(LayoutKind.Sequential)] public struct PBI { public IntPtr R1; public IntPtr Peb; public IntPtr R2a; public IntPtr R2b; public IntPtr Pid; public IntPtr R3; }
        [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PBI pbi, int len, out int ret);

        public static double IdleSeconds()
        {
            var li = new LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(li);
            if (!GetLastInputInfo(ref li)) return 0;
            return unchecked((uint)Environment.TickCount - li.dwTime) / 1000.0;
        }

        // Working directory of another 64-bit process (read from its PEB).
        public static string GetCwd(int pid)
        {
            IntPtr h = OpenProcess(0x0400 | 0x0010, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                bool wow; if (IsWow64Process(h, out wow) && wow) return null;
                var pbi = new PBI(); int ret;
                if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
                byte[] b8 = new byte[8]; IntPtr rd;
                if (!ReadProcessMemory(h, IntPtr.Add(pbi.Peb, 0x20), b8, (IntPtr)8, out rd)) return null;
                IntPtr pp = new IntPtr(BitConverter.ToInt64(b8, 0));
                byte[] us = new byte[16];
                if (!ReadProcessMemory(h, IntPtr.Add(pp, 0x38), us, (IntPtr)16, out rd)) return null;
                int len = BitConverter.ToUInt16(us, 0);
                IntPtr buf = new IntPtr(BitConverter.ToInt64(us, 8));
                if (len <= 0 || len > 4096) return null;
                byte[] s = new byte[len];
                if (!ReadProcessMemory(h, buf, s, (IntPtr)len, out rd)) return null;
                return Encoding.Unicode.GetString(s).TrimEnd('\\');
            }
            catch { return null; }
            finally { CloseHandle(h); }
        }
    }

    // ------------------------------------------------------------------ settings
    class Settings
    {
        // defaults for a new install; an existing settings.txt keeps its own values
        public int CapActive = 90, CapIdle = 100, IdleMin = 2, PauseMB = 700;
        public int CriticalMB = 500;    // below this even the last running render is frozen
        public int SlowCapPct = 5;      // RAM short: a slowed render may use this % of the whole machine (it is never frozen)
        public bool LowPrio = true, Tray = true;
        public bool ReadOnly;           // test instances (--only) never write the user's settings
        // VideoHub: where its folder is (environment variables allowed) and whether to start its server with us
        public string HubDir = DefaultHubDir();
        internal static string DefaultHubDir()
        {
            try
            {
                // we normally live in VideoHub\guard: the hub is one folder up (works wherever the VideoHub folder is)
                var parent = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'));
                if (parent != null && File.Exists(Path.Combine(parent.FullName, "server", "hub.js"))) return parent.FullName;
            }
            catch { }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "VideoHub");
        }
        public bool HubStart = true;

        public string HubPath { get { return Environment.ExpandEnvironmentVariables(HubDir ?? ""); } }

        public static string Dir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RenderGuard"); } }
        // VideoHub writes this file; we watch it and apply changes live. A test instance may point at its own copy (--settings).
        public static string FileOverride;
        public static string FilePath { get { return FileOverride ?? Path.Combine(Dir, "settings.txt"); } }

        static readonly string[] Keys = { "CapActive", "CapIdle", "IdleMin", "PauseMB", "CriticalMB", "SlowCapPct", "LowPrio", "Tray", "HubDir", "HubStart" };
        string Get(string k)
        {
            switch (k)
            {
                case "CapActive": return CapActive.ToString(); case "CapIdle": return CapIdle.ToString(); case "IdleMin": return IdleMin.ToString();
                case "PauseMB": return PauseMB.ToString(); case "CriticalMB": return CriticalMB.ToString(); case "SlowCapPct": return SlowCapPct.ToString();
                case "LowPrio": return LowPrio ? "1" : "0"; case "Tray": return Tray ? "1" : "0"; case "HubDir": return HubDir; case "HubStart": return HubStart ? "1" : "0";
            }
            return "";
        }
        // take over another instance's values (live reload); returns "Key a→b, …" for what changed
        public string CopyFrom(Settings o)
        {
            var diff = Keys.Where(k => Get(k) != o.Get(k)).Select(k => k + " " + Get(k) + "→" + o.Get(k)).ToList();
            foreach (var k in Keys) Set(k, o.Get(k));
            return string.Join(", ", diff);
        }
        // history.log / error.log; a test instance logs into test\ so its lines never look like the real guard's
        static string logDir;
        public static string LogDir { get { return logDir ?? Dir; } set { logDir = value; } }
        public static string HistoryPath { get { return Path.Combine(LogDir, "history.log"); } }

        public void Set(string k, string v)
        {
            if (k == "CapActive") CapActive = Bounded(v, 1, 100);
            else if (k == "CapIdle") CapIdle = Bounded(v, 1, 100);
            else if (k == "IdleMin") IdleMin = Bounded(v, 1, 1440);
            else if (k == "PauseMB") PauseMB = Bounded(v, 0, 1048576);
            else if (k == "CriticalMB") CriticalMB = Bounded(v, 0, 1048576);
            else if (k == "SlowCapPct") SlowCapPct = Bounded(v, 1, 100);
            else if (k == "LowPrio") LowPrio = v == "1";
            else if (k == "Tray") Tray = v == "1";
            else if (k == "HubDir") { if (v != "") HubDir = v; }
            else if (k == "HubStart") HubStart = v == "1";
        }

        static int Bounded(string v, int min, int max) { int n = int.Parse(v, CultureInfo.InvariantCulture); if (n < min || n > max) throw new FormatException("Invalid setting range"); return n; }
        public static bool TryLoad(out Settings s)
        {
            s = new Settings();
            try
            {
                string[] lines = File.ReadAllLines(FilePath);
                if (!lines.Any(l => l.Trim().Length > 0)) return false;
                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var kv = line.Split(new[] { '=' }, 2); if (kv.Length != 2) return false;
                    s.Set(kv[0].Trim(), kv[1].Trim());
                }
                return true;
            }
            catch { return false; }
        }
        public static Settings Load() { Settings s; return TryLoad(out s) ? s : new Settings(); }

        public void Save()
        {
            if (ReadOnly) return;
            try
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllLines(FilePath, new[] {
                    "CapActive=" + CapActive, "CapIdle=" + CapIdle, "IdleMin=" + IdleMin, "PauseMB=" + PauseMB, "CriticalMB=" + CriticalMB, "SlowCapPct=" + SlowCapPct,
                    "LowPrio=" + (LowPrio ? 1 : 0), "Tray=" + (Tray ? 1 : 0), "HubDir=" + HubDir, "HubStart=" + (HubStart ? 1 : 0) });
            }
            catch { }
        }

        static readonly object appendGate = new object();   // UI, watchdog, loop and command threads all write history
        public static void Append(string file, string line)
        {
            try { lock (appendGate) { Directory.CreateDirectory(LogDir); File.AppendAllText(Path.Combine(LogDir, file), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine); } }
            catch { }
        }
        public static void History(string line) { Append("history.log", line); }
    }

    // ------------------------------------------------------------------ data
    class ProcInfo { public int Pid, Ppid; public string Name, Cmd; public DateTime Start; public long Ram; }

    class Job
    {
        public int RootPid; public List<int> Pids = new List<int>();
        public string Session = "", SessionId, SessionDir = "", Project = "", Cwd = "", What = "", Cmd = "", LogPath, LastLine = "";
        public double Progress = -1, Eta = -1, Cpu, Gpu; public long RamMB; public DateTime Start;
        public bool Finished; public int Cap = -1;
        public string Paused;   // null or "manual": frozen by hand (Ctrl+Alt+End, pause button, cmd "pause")
        public string Slow;     // null, "RAM", "queue" or "manual": runs with a tiny CPU cap instead of being frozen
    }

    class Snapshot
    {
        public List<Job> Jobs = new List<Job>();
        public double Cpu, Gpu = -1, RamUsedGB, RamTotalGB, IdleSec; public int CapNow; public bool Active;
    }

    class SessionInfo { public string Id, Title, Dir; public DateTime Read; }

    // ------------------------------------------------------------------ GPU (per-process, like Task Manager)
    class GpuSampler
    {
        PerformanceCounterCategory cat; bool ok;
        Dictionary<string, CounterSample> prev = new Dictionary<string, CounterSample>();
        static readonly Regex rx = new Regex(@"pid_(\d+)_.*engtype_(.+)$");

        public GpuSampler() { try { cat = new PerformanceCounterCategory("GPU Engine"); cat.ReadCategory(); ok = true; } catch { ok = false; } }

        public double Sample(Dictionary<int, double> perPid)
        {
            if (!ok) return -1;
            InstanceDataCollection col = null;
            try
            {
                foreach (InstanceDataCollection c in cat.ReadCategory().Values)
                    if (string.Equals(c.CounterName, "Utilization Percentage", StringComparison.OrdinalIgnoreCase)) col = c;
            }
            catch { return -1; }
            if (col == null) return -1;
            var next = new Dictionary<string, CounterSample>();
            var engTotal = new Dictionary<string, double>();
            var pidEng = new Dictionary<int, Dictionary<string, double>>();
            foreach (InstanceData d in col.Values)
            {
                next[d.InstanceName] = d.Sample;
                CounterSample p; if (!prev.TryGetValue(d.InstanceName, out p)) continue;
                double v; try { v = CounterSample.Calculate(p, d.Sample); } catch { continue; }
                var m = rx.Match(d.InstanceName); if (!m.Success) continue;
                int pid = int.Parse(m.Groups[1].Value); string eng = m.Groups[2].Value;
                double t; engTotal.TryGetValue(eng, out t); engTotal[eng] = t + v;
                Dictionary<string, double> pe; if (!pidEng.TryGetValue(pid, out pe)) { pe = new Dictionary<string, double>(); pidEng[pid] = pe; }
                pe.TryGetValue(eng, out t); pe[eng] = t + v;
            }
            prev = next;
            foreach (var kv in pidEng) perPid[kv.Key] = Math.Min(100, kv.Value.Values.Max());
            return engTotal.Count == 0 ? 0 : Math.Min(100, engTotal.Values.Max());
        }
    }

    // ------------------------------------------------------------------ CPU limiter
    // Windows Job Objects give a hard CPU cap. A process can only join a job inside its current job tree,
    // and every Claude session already runs its commands in its own job, so each render gets its own job(s)
    // and the total budget is shared between them by how much each one actually wants.
    class Limiter
    {
        class Unit { public IntPtr H; public int Root; public long LastTime = -1; public DateTime LastT; public double Used; public bool Measured; public int Cap = -1; }

        readonly object gate = new object();
        readonly int cores = Environment.ProcessorCount;
        List<Unit> units = new List<Unit>();
        Dictionary<int, int> handled = new Dictionary<int, int>();     // pid -> root it was attached for
        HashSet<int> lowered = new HashSet<int>();
        Dictionary<int, DateTime> rootStart = new Dictionary<int, DateTime>();
        Dictionary<int, List<int>> treePids = new Dictionary<int, List<int>>();
        // Frozen (NtSuspendProcess) only by hand: Ctrl+Alt+End, the pause button, cmd "pause". The RAM watchdog never
        // freezes — a frozen puppeteer render dies when a CDP call outlives its timeout. It slows renders down instead.
        Dictionary<int, string> paused = new Dictionary<int, string>();   // root -> "manual"
        Dictionary<int, string> slow = new Dictionary<int, string>();     // root -> why it runs slowed: "RAM", "queue" (ping-pong), "manual" (cmd)
        Dictionary<int, List<DateTime>> flips = new Dictionary<int, List<DateTime>>();   // root -> RAM slow/normal switches (ping-pong guard)
        Dictionary<int, DateTime> pausedAt = new Dictionary<int, DateTime>();       // root -> frozen since
        Dictionary<int, double> frozenSec = new Dictionary<int, double>();          // root -> seconds spent frozen in earlier pauses
        HashSet<int> youngSlowed = new HashSet<int>();   // slowed once in its first 60 s of running: not again until it has run 60 s
        int slowCap = 5, lastCap = 100; bool lowPrioNow = true, released;
        public const string Queue = "queue";   // stays slow until no other render runs at normal speed
        public static bool Trace;   // test instances with --trace: log every slow-mode decision to test\trace.log

        // seconds the render has actually run (frozen time does not count)
        double RunSec(int root, DateTime now)
        {
            DateTime st; if (!rootStart.TryGetValue(root, out st)) return 0;
            double f; frozenSec.TryGetValue(root, out f);
            DateTime at; if (pausedAt.TryGetValue(root, out at)) f += (now - at).TotalSeconds;
            return (now - st).TotalSeconds - f;
        }

        // every process of a render: what its jobs hold (includes children spawned since the last scan) + the last tree scan
        List<int> PidsOf(int root)
        {
            var s = new HashSet<int>();
            foreach (var u in units) if (u.Root == root) foreach (int p in N.JobPids(u.H)) s.Add(p);
            List<int> t; if (treePids.TryGetValue(root, out t)) foreach (int p in t) s.Add(p);
            return s.ToList();
        }

        public bool Pause(int root, string why)
        {
            lock (gate)
            {
                if (released) return false;
                if (paused.ContainsKey(root) || !rootStart.ContainsKey(root)) return false;
                foreach (int p in PidsOf(root)) N.Suspend(p, true);
                paused[root] = why; pausedAt[root] = DateTime.Now; return true;
            }
        }

        public bool Resume(int root)
        {
            lock (gate)
            {
                if (released) return false;
                if (!paused.ContainsKey(root)) return false;
                foreach (int p in PidsOf(root)) N.Suspend(p, false);
                paused.Remove(root);
                DateTime at; if (pausedAt.TryGetValue(root, out at)) { double f; frozenSec.TryGetValue(root, out f); frozenSec[root] = f + (DateTime.Now - at).TotalSeconds; pausedAt.Remove(root); }
                return true;
            }
        }

        // slow mode: the render's jobs share a hard cap of slowCap % of the machine, its processes get very low memory
        // priority (their pages are trimmed first). It keeps running, so nothing times out.
        void ApplySlow(int root)
        {
            var mine = units.Where(u => u.Root == root).ToList();
            foreach (var u in mine) SetCap(u, Math.Max(1, slowCap / mine.Count));
            foreach (int p in PidsOf(root)) N.MemoryPriority(p, 1);
        }

        void ApplyNormal(int root)
        {
            var mine = units.Where(u => u.Root == root).ToList();
            int share = lastCap >= 100 ? 100 : Math.Max(5, lastCap / Math.Max(1, units.Count));   // the next Update shares the budget properly
            foreach (var u in mine) SetCap(u, share);
            foreach (int p in PidsOf(root)) N.MemoryPriority(p, lowPrioNow ? 2u : 5u);
        }

        // by hand (cmd "slow" / "normal"): the watchdog never speeds a "manual" render up on its own
        public bool Slow(int root, string why)
        {
            lock (gate)
            {
                if (released) return false;
                string cur; if (!rootStart.ContainsKey(root) || (slow.TryGetValue(root, out cur) && cur == why)) return false;
                slow[root] = why; ApplySlow(root); return true;
            }
        }

        public bool Normal(int root) { lock (gate) { if (released || !slow.Remove(root)) return false; ApplyNormal(root); return true; } }

        // RAM-driven slow/normal switches of one render in the last 10 min, counting this one
        int Flip(int root)
        {
            List<DateTime> l; if (!flips.TryGetValue(root, out l)) { l = new List<DateTime>(); flips[root] = l; }
            var now = DateTime.Now; l.RemoveAll(t => (now - t).TotalMinutes > 10); l.Add(now);
            return l.Count;
        }

        // RAM watchdog. Slows the newest render running at normal speed (the one most likely still growing), but never
        // the last one at normal speed unless RAM is critical: the oldest keeps going and finishes, the others crawl.
        // A render switched more than 3 times in 10 min stays slow as "queue" until no other render runs at normal speed.
        // A render slowed once in its first 60 s of running is not slowed again until it has run 60 s (Chrome launch).
        public int SlowForRam(bool critical, out string why)
        {
            lock (gate)
            {
                why = null;
                if (released) return 0;
                var now = DateTime.Now;
                var normal = rootStart.Where(kv => !paused.ContainsKey(kv.Key) && !slow.ContainsKey(kv.Key)).OrderByDescending(kv => kv.Value).Select(kv => kv.Key).ToList();
                if (Trace) Settings.Append("trace.log", "slow? critical=" + critical + " normal=" + string.Join(" ", normal.Select(r => r + "(run " + RunSec(r, now).ToString("0") + "s" + (youngSlowed.Contains(r) ? " young-slowed" : "") + ")")) + " slow=" + string.Join(",", slow.Keys) + " paused=" + string.Join(",", paused.Keys));
                if (normal.Count == 0 || (normal.Count == 1 && !critical)) return 0;
                foreach (int r in critical ? normal : normal.Take(normal.Count - 1))
                {
                    bool young = RunSec(r, now) < 60;
                    if (!young) youngSlowed.Remove(r);
                    else if (youngSlowed.Contains(r)) continue;
                    why = Flip(r) > 3 ? Queue : "RAM";
                    slow[r] = why; ApplySlow(r);
                    if (young) youngSlowed.Add(r);
                    return r;
                }
                return 0;
            }
        }

        // oldest first. RAM comfortably free: a "RAM" render gets its speed back. No render at normal speed any more: "queue" too.
        public int NormalForRam(bool nothingNormal)
        {
            lock (gate)
            {
                if (released) return 0;
                int r = slow.Where(kv => !paused.ContainsKey(kv.Key) && (kv.Value == "RAM" || (nothingNormal && kv.Value == Queue)))
                            .OrderBy(kv => rootStart.ContainsKey(kv.Key) ? rootStart[kv.Key] : DateTime.MaxValue).Select(kv => kv.Key).FirstOrDefault();
                if (r == 0) return 0;
                slow.Remove(r); ApplyNormal(r); Flip(r); return r;
            }
        }

        public int NormalCount() { lock (gate) return rootStart.Keys.Count(r => !paused.ContainsKey(r) && !slow.ContainsKey(r)); }
        public int SlowCount(string why) { lock (gate) return slow.Count(kv => why == null || kv.Value == why); }

        public int PauseAll(string why) { int n = 0; foreach (int r in RootsSnapshot()) if (Pause(r, why)) n++; return n; }
        public int ResumeAll() { int n = 0; List<int> rs; lock (gate) rs = paused.Keys.ToList(); foreach (int r in rs) if (Resume(r)) n++; return n; }
        public int PausedCount(string why) { lock (gate) return paused.Count(kv => why == null || kv.Value == why); }
        List<int> RootsSnapshot() { lock (gate) return rootStart.Keys.ToList(); }

        static void SetCap(Unit u, int pct)
        {
            if (pct >= 100) pct = 100;
            if (u.Cap == pct) return;
            var info = new N.CPU_RATE();
            if (pct < 100) { info.ControlFlags = 0x1 | 0x4; info.CpuRate = (uint)(Math.Max(1, pct) * 100); } // ENABLE | HARD_CAP
            if (N.SetInformationJobObject(u.H, 15, ref info, Marshal.SizeOf(info))) u.Cap = pct;
        }

        bool Attach(int pid, int root)
        {
            IntPtr h = N.OpenProcess(0x1000 | 0x0100 | 0x0001, false, pid); // QUERY_LIMITED | SET_QUOTA | TERMINATE
            if (h == IntPtr.Zero) return false;
            try
            {
                var mine = units.Where(u => u.Root == root).ToList();
                foreach (var u in mine) { bool r; if (N.IsProcessInJob(h, u.H, out r) && r) return true; }   // inherited from its parent
                foreach (var u in mine) if (N.AssignProcessToJobObject(u.H, h)) return true;
                // A named job survives an agent crash while its render is alive. Reopen it on the next
                // launch so an old 5% cap can be lifted; process birth times prevent PID-reuse collisions.
                long born;
                try { using (var p = Process.GetProcessById(pid)) born = p.StartTime.ToUniversalTime().Ticks; }
                catch { return false; }
                string name = "Local\\RenderGuard_job_" + root + "_" + rootStart[root].ToUniversalTime().Ticks + "_" + pid + "_" + born;
                var nu = new Unit { H = N.CreateJobObject(IntPtr.Zero, name), Root = root };
                if (nu.H == IntPtr.Zero) return false;
                bool already;
                if ((N.IsProcessInJob(h, nu.H, out already) && already) || N.AssignProcessToJobObject(nu.H, h)) { units.Add(nu); return true; }
                N.CloseHandle(nu.H); return false;
            }
            finally { N.CloseHandle(h); }
        }

        public void Update(List<Job> jobs, int cap, bool lowPrio, int slowCapPct)
        {
            lock (gate)
            {
                if (released) return;
                bool priorityChanged = lowPrioNow != lowPrio;
                lastCap = cap; lowPrioNow = lowPrio; slowCap = Math.Max(1, Math.Min(100, slowCapPct));
                var roots = new HashSet<int>(jobs.Select(j => j.RootPid));
                foreach (var u in units.Where(u => !roots.Contains(u.Root)).ToList()) { SetCap(u, 100); N.CloseHandle(u.H); units.Remove(u); }
                foreach (var r in rootStart.Keys.Where(r => !roots.Contains(r)).ToList()) { rootStart.Remove(r); treePids.Remove(r); paused.Remove(r); slow.Remove(r); flips.Remove(r); pausedAt.Remove(r); frozenSec.Remove(r); youngSlowed.Remove(r); }
                foreach (var j in jobs)
                {
                    rootStart[j.RootPid] = j.Start; treePids[j.RootPid] = j.Pids; string why;
                    j.Paused = paused.TryGetValue(j.RootPid, out why) ? why : null;
                    j.Slow = slow.TryGetValue(j.RootPid, out why) ? why : null;
                }

                var all = new HashSet<int>();
                foreach (var j in jobs)
                    foreach (int pid in j.Pids)
                    {
                        all.Add(pid);
                        int r;
                        if (!handled.TryGetValue(pid, out r) || r != j.RootPid)
                        {
                            handled[pid] = j.RootPid;
                            if (j.Slow != null) N.MemoryPriority(pid, 1);   // appeared inside a slowed render
                            else if (lowPrio) N.LowMemoryPriority(pid);
                            if (j.Paused != null) N.Suspend(pid, true);   // appeared inside a paused render
                        }
                        Attach(pid, j.RootPid);   // retry failures; existing membership is a no-op
                        if (priorityChanged && j.Slow == null) N.MemoryPriority(pid, lowPrio ? 2u : 5u);
                        try
                        {
                            using (var p = Process.GetProcessById(pid))
                            {
                            if (lowPrio && p.PriorityClass == ProcessPriorityClass.Normal) { p.PriorityClass = ProcessPriorityClass.BelowNormal; lowered.Add(pid); }
                            else if (!lowPrio && lowered.Contains(pid)) { p.PriorityClass = ProcessPriorityClass.Normal; lowered.Remove(pid); }
                            }
                        }
                        catch { }
                    }
                foreach (var k in handled.Keys.Where(k => !all.Contains(k)).ToList()) handled.Remove(k);
                lowered.IntersectWith(all);

                // measure what each job used since last time (% of the whole machine)
                var now = DateTime.Now;
                foreach (var u in units)
                {
                    N.ACCOUNTING a;
                    if (!N.QueryInformationJobObject(u.H, 1, out a, Marshal.SizeOf(typeof(N.ACCOUNTING)), IntPtr.Zero)) continue;
                    long t = a.TotalUserTime + a.TotalKernelTime;
                    if (u.LastTime >= 0) { double dt = (now - u.LastT).TotalSeconds; if (dt > 0) { u.Used = 100.0 * (t - u.LastTime) / 1e7 / dt / cores; u.Measured = true; } }
                    u.LastTime = t; u.LastT = now;
                }

                // share the budget. A job only gives budget away when it clearly does not need it
                // (under half its cap), and keeps 2x what it uses, so a render that waits on the GPU
                // is never squeezed tighter turn after turn.
                // Slowed renders keep their small cap whatever the budget says and are left out of the share.
                var slowUnits = units.Where(u => slow.ContainsKey(u.Root)).ToList();
                foreach (var g in slowUnits.GroupBy(u => u.Root)) { int n = g.Count(); foreach (var u in g) SetCap(u, Math.Max(1, slowCap / n)); }
                var normalUnits = units.Except(slowUnits).ToList();
                if (cap >= 100) foreach (var u in normalUnits) SetCap(u, 100);
                else if (normalUnits.Count > 0)
                {
                    double budget = Math.Max(5, cap - slowUnits.Sum(u => u.Cap)), fair = budget / normalUnits.Count;
                    var calm = normalUnits.Where(u => u.Measured && u.Cap > 0 && u.Cap < 100 && u.Used < u.Cap * 0.5).ToList();
                    var hungry = normalUnits.Except(calm).ToList();
                    foreach (var u in calm) { int a = (int)Math.Max(2, Math.Min(fair, Math.Ceiling(u.Used * 2) + 2)); budget -= a; SetCap(u, a); }
                    foreach (var u in hungry) SetCap(u, (int)Math.Max(Math.Min(fair, cap), budget / hungry.Count));
                }

                foreach (var j in jobs)
                {
                    var mine = units.Where(u => u.Root == j.RootPid).ToList();
                    j.Cap = mine.Count == 0 || (cap >= 100 && j.Slow == null) ? -1 : Math.Min(100, mine.Sum(u => u.Cap));
                }
            }
        }

        // lift every cap and slow mode (on exit, so running renders continue at full speed)
        public void Release()
        {
            lock (gate)
            {
                if (released) return;
                ResumeAll();
                released = true;   // late scans and watchdog ticks may not reapply caps
                foreach (int r in rootStart.Keys)
                    foreach (int p in PidsOf(r)) N.MemoryPriority(p, 5);
                foreach (int pid in lowered)
                    try { using (var p = Process.GetProcessById(pid)) { if (p.PriorityClass == ProcessPriorityClass.BelowNormal) p.PriorityClass = ProcessPriorityClass.Normal; } } catch { }
                foreach (var u in units) { SetCap(u, 100); N.CloseHandle(u.H); }
                units.Clear(); lowered.Clear(); slow.Clear();
            }
        }
    }

    // ------------------------------------------------------------------ collector
    class Collector
    {
        static readonly string Home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        static readonly string Desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        static readonly string TempClaude = Path.Combine(Path.GetTempPath(), "claude");
        static readonly Regex rxScript = new Regex(@"render|snap|score|mix|sfx|frames|encode", RegexOptions.IgnoreCase);

        readonly int cores = Environment.ProcessorCount;
        readonly string only;   // test mode: only roots whose command line contains this
        Dictionary<int, TimeSpan> lastCpu = new Dictionary<int, TimeSpan>();
        DateTime lastT = DateTime.MinValue;
        long sIdle, sKern, sUser;
        Dictionary<int, string> cwdCache = new Dictionary<int, string>();
        Dictionary<int, string> logCache = new Dictionary<int, string>();
        Dictionary<int, Tuple<DateTime, double>> firstSeen = new Dictionary<int, Tuple<DateTime, double>>();
        GpuSampler gpu = new GpuSampler();

        public Collector(string onlyFilter) { only = onlyFilter; }

        // VideoHub's own server processes (hub.js, cli.js hub_render …, mcp.js) are not renders. What its queue starts
        // (node render.js / ffmpeg in a project folder) still is: they become the render roots under it.
        static readonly Regex rxHubDir = new Regex(@"[\\/]VideoHub[\\/]server[\\/]", RegexOptions.IgnoreCase);
        static readonly Regex rxHubScript = new Regex(@"(?:^|[\s""'])((?:\.{0,2}[\\/])?(?:server[\\/])?(?:hub|cli|mcp)\.js)(?=[\s""']|$)", RegexOptions.IgnoreCase);
        static readonly Dictionary<int, Tuple<DateTime, bool>> hubCache = new Dictionary<int, Tuple<DateTime, bool>>();
        // our own hub's server folder, whatever the install folder is called (a GitHub ZIP unpacks as VideoHub-main)
        internal static string OwnHubServer = Settings.DefaultHubDir().TrimEnd('\\', '/').Replace('/', '\\') + "\\server\\";
        static bool InOwnHub(string s) { return !string.IsNullOrEmpty(s) && s.Replace('/', '\\').IndexOf(OwnHubServer, StringComparison.OrdinalIgnoreCase) >= 0; }

        internal static bool IsHub(ProcInfo p)
        {
            string c = p.Cmd ?? "";
            if (rxHubDir.IsMatch(c) || InOwnHub(c)) return true;
            var m = rxHubScript.Match(c);   // started with a relative path (`node server/cli.js …` from the VideoHub folder): resolve it
            if (!m.Success) return false;
            lock (hubCache)
            {
                Tuple<DateTime, bool> hit;
                if (hubCache.TryGetValue(p.Pid, out hit) && hit.Item1 == p.Start) return hit.Item2;
                bool yes = false;
                string cwd = N.GetCwd(p.Pid);
                if (cwd != null) try { var full = Path.GetFullPath(Path.Combine(cwd + "\\", m.Groups[1].Value.Replace('/', '\\'))); yes = rxHubDir.IsMatch(full) || InOwnHub(full); } catch { }
                if (hubCache.Count > 256) hubCache.Clear();
                hubCache[p.Pid] = Tuple.Create(p.Start, yes);
                return yes;
            }
        }

        internal static bool IsRender(ProcInfo p)
        {
            string n = p.Name.ToLowerInvariant(), c = p.Cmd ?? "";
            if (IsHub(p)) return false;
            if (n == "ffmpeg.exe") return true;
            if (n == "ffprobe.exe") return false; // Metadata scans are not standalone renders.
            if (n == "chrome.exe" || n == "chrome-headless-shell.exe" || n == "msedge.exe")
                return n == "chrome-headless-shell.exe" || c.Contains("--headless") || Regex.IsMatch(c, @"--user-data-dir=""?[^""]*\\Temp\\", RegexOptions.IgnoreCase);
            if (n == "node.exe" || n == "python.exe" || n == "pythonw.exe") return IsRenderScript(c);
            return false;
        }

        // Runtime flags such as --node-snapshot are not render scripts. Inspect the entry point,
        // not flags, executable paths or arguments passed to a web server / test runner.
        internal static bool IsRenderScript(string command)
        {
            var args = Regex.Matches(command ?? "", @"""([^""]*)""|(\S+)");
            for (int i = 1; i < args.Count; i++)
            {
                string arg = args[i].Groups[1].Success ? args[i].Groups[1].Value : args[i].Groups[2].Value;
                if (arg == "-e" || arg == "--eval" || arg == "-p" || arg == "--print" || arg == "-c" || arg == "--test") return false;
                if (arg == "-m") {
                    if (++i >= args.Count) return false;
                    return rxScript.IsMatch(args[i].Value.Trim('"'));
                }
                if (arg == "-r" || arg == "--require" || arg == "--import" || arg == "--loader" || arg == "--experimental-loader" || arg == "--env-file") { i++; continue; }
                if (arg.StartsWith("-")) continue;
                if (!Regex.IsMatch(arg, @"\.(?:[cm]?js|py)$", RegexOptions.IgnoreCase)) continue;
                if (Regex.IsMatch(arg, @"(?:\.(?:test|spec)\.[cm]?js$|(?:^|[\\/])(?:tests?|__tests__)[\\/])", RegexOptions.IgnoreCase)) return false;
                if (Path.GetFileName(arg.Replace('\\', '/')).Equals("make.mjs", StringComparison.OrdinalIgnoreCase))
                    return Regex.IsMatch(command, @"(?:^|\s)--(?:chunks|only|seconds|range|preview|stills|mux)(?:\s|$)", RegexOptions.IgnoreCase);
                return rxScript.IsMatch(arg);
            }
            return false;
        }

        public Snapshot Collect(Settings st)
        {
            var snap = new Snapshot();
            var now = DateTime.Now;

            long i2, k2, u2;
            if (N.GetSystemTimes(out i2, out k2, out u2))
            {
                long busy = (k2 - sKern) + (u2 - sUser), idle = i2 - sIdle;
                if (sKern != 0 && busy > 0) snap.Cpu = Math.Max(0, Math.Min(100, 100.0 * (busy - idle) / busy));
                sIdle = i2; sKern = k2; sUser = u2;
            }
            var ms = new N.MEMORYSTATUSEX();
            if (N.GlobalMemoryStatusEx(ms)) { snap.RamTotalGB = ms.ullTotalPhys / 1073741824.0; snap.RamUsedGB = (ms.ullTotalPhys - ms.ullAvailPhys) / 1073741824.0; }
            var gpuPid = new Dictionary<int, double>();
            snap.Gpu = gpu.Sample(gpuPid);

            snap.IdleSec = N.IdleSeconds();
            snap.Active = snap.IdleSec < st.IdleMin * 60;
            snap.CapNow = snap.Active ? st.CapActive : st.CapIdle;

            var procs = new Dictionary<int, ProcInfo>();
            using (var s = new ManagementObjectSearcher("SELECT ProcessId,ParentProcessId,Name,CommandLine,CreationDate,WorkingSetSize FROM Win32_Process"))
                foreach (ManagementObject o in s.Get())
                {
                    var p = new ProcInfo();
                    p.Pid = Convert.ToInt32(o["ProcessId"]); p.Ppid = Convert.ToInt32(o["ParentProcessId"]);
                    p.Name = (string)o["Name"] ?? ""; p.Cmd = (string)o["CommandLine"] ?? "";
                    try { p.Start = ManagementDateTimeConverter.ToDateTime((string)o["CreationDate"]); } catch { p.Start = now; }
                    try { p.Ram = Convert.ToInt64(o["WorkingSetSize"]); } catch { }
                    procs[p.Pid] = p;
                }

            var children = new Dictionary<int, List<int>>();
            foreach (var p in procs.Values)
            {
                if (p.Ppid == p.Pid) continue;
                List<int> l; if (!children.TryGetValue(p.Ppid, out l)) { l = new List<int>(); children[p.Ppid] = l; }
                l.Add(p.Pid);
            }

            // group render processes under their top-most render ancestor
            var roots = new HashSet<int>();
            foreach (var p in procs.Values)
            {
                // test mode: a node script carrying the tag counts too, so dummy renders can be made that the real instance ignores
                bool tagged = only != null && p.Name.Equals("node.exe", StringComparison.OrdinalIgnoreCase) && p.Cmd.IndexOf(only, StringComparison.OrdinalIgnoreCase) >= 0 && !IsHub(p);
                if (!IsRender(p) && !tagged) continue;
                var r = p; int guard = 0;
                while (guard++ < 30)
                {
                    ProcInfo par; if (!procs.TryGetValue(r.Ppid, out par) || par.Start > r.Start || !IsRender(par)) break;
                    r = par;
                }
                if (only == null || r.Cmd.IndexOf(only, StringComparison.OrdinalIgnoreCase) >= 0) roots.Add(r.Pid);
            }

            double dt = lastT == DateTime.MinValue ? 0 : (now - lastT).TotalSeconds;
            var newCpu = new Dictionary<int, TimeSpan>();

            foreach (int rootPid in roots)
            {
                var root = procs[rootPid];
                var job = new Job(); job.RootPid = rootPid; job.Start = root.Start; job.Cmd = root.Cmd;
                var q = new Queue<int>(); q.Enqueue(rootPid);
                while (q.Count > 0)
                {
                    int x = q.Dequeue(); job.Pids.Add(x);
                    List<int> ch; if (children.TryGetValue(x, out ch)) foreach (int c in ch) if (procs[c].Start >= procs[x].Start) q.Enqueue(c);
                }
                double cpuSec = 0;
                foreach (int pid in job.Pids)
                {
                    job.RamMB += procs[pid].Ram / 1048576;
                    double g; if (gpuPid.TryGetValue(pid, out g)) job.Gpu += g;
                    try
                    {
                        var t = Process.GetProcessById(pid).TotalProcessorTime; newCpu[pid] = t;
                        TimeSpan o; if (lastCpu.TryGetValue(pid, out o)) cpuSec += (t - o).TotalSeconds;
                    }
                    catch { }
                }
                job.Gpu = Math.Min(100, job.Gpu);
                if (dt > 0) job.Cpu = Math.Max(0, Math.Min(100, 100.0 * cpuSec / (dt * cores)));

                job.What = ShortCmd(root.Cmd, root.Name);
                string cwd; if (!cwdCache.TryGetValue(rootPid, out cwd)) { cwd = N.GetCwd(rootPid) ?? ""; cwdCache[rootPid] = cwd; }
                job.Cwd = cwd;
                job.Project = ShortPath(cwd);

                SessionInfo si = null; var cur = root; int depth = 0;
                while (cur != null && depth++ < 30)
                {
                    if (cur.Name.Equals("claude.exe", StringComparison.OrdinalIgnoreCase) && cur.Cmd.Contains("stream-json")) { si = SessionFor(cur); break; }
                    ProcInfo par; cur = procs.TryGetValue(cur.Ppid, out par) && par.Start <= cur.Start ? par : null;
                }
                if (si != null) { job.Session = si.Title; job.SessionId = si.Id; job.SessionDir = si.Dir; }
                else job.Session = "(outside Claude / manual)";
                if (job.Project == "") job.Project = job.SessionDir;

                // Claude's task output, unless it is empty because the command redirected into its own log file
                string log; if (!logCache.TryGetValue(rootPid, out log) || log == null)
                {
                    try
                    {
                        string task = FindLog(si, root.Start), file = FindFileLog(cwd, root.Start);
                        bool taskEmpty = task == null || new FileInfo(task).Length < 64;
                        log = taskEmpty && file != null ? file : task;
                        logCache[rootPid] = log != null && new FileInfo(log).Length >= 64 ? log : null;   // keep looking until one has content
                    }
                    catch { log = null; logCache[rootPid] = null; }   // a task output deleted under us must not drop the whole scan
                }
                job.LogPath = log;
                if (log != null) ParseLog(log, job);
                if (job.Progress >= 0 && job.Eta < 0)
                {
                    Tuple<DateTime, double> f;
                    if (!firstSeen.TryGetValue(rootPid, out f)) firstSeen[rootPid] = Tuple.Create(now, job.Progress);
                    else if (job.Progress > f.Item2 + 0.001) job.Eta = (1 - job.Progress) * (now - f.Item1).TotalSeconds / (job.Progress - f.Item2);
                }
                snap.Jobs.Add(job);
            }
            lastCpu = newCpu; lastT = now;

            foreach (var k in cwdCache.Keys.Where(k => !roots.Contains(k)).ToList()) { cwdCache.Remove(k); logCache.Remove(k); firstSeen.Remove(k); }
            snap.Jobs.Sort((a, b) => a.Start.CompareTo(b.Start));
            return snap;
        }

        static string ShortCmd(string cmd, string name)
        {
            cmd = (cmd ?? "").Trim(); string rest;
            if (cmd.StartsWith("\"")) { int e = cmd.IndexOf('"', 1); rest = e > 0 ? cmd.Substring(e + 1) : ""; }
            else { int e = cmd.IndexOf(' '); rest = e > 0 ? cmd.Substring(e) : ""; }
            rest = Regex.Replace(rest, @"""?[A-Za-z]:[\\/][^\s""]*[\\/]([^\s""\\/]+)""?", "$1");
            rest = Regex.Replace(rest, @"\s+", " ").Trim();
            string s = Path.GetFileNameWithoutExtension(name) + " " + rest;
            return s.Length > 90 ? s.Substring(0, 90) + "…" : s;
        }

        static string ShortPath(string p)
        {
            if (string.IsNullOrEmpty(p)) return "";
            if (p.StartsWith(Desktop, StringComparison.OrdinalIgnoreCase)) return p.Substring(Desktop.Length).TrimStart('\\');
            if (p.StartsWith(Home, StringComparison.OrdinalIgnoreCase)) return "~" + p.Substring(Home.Length);
            return p;
        }

        // A render started from a Claude session is labelled just that. The agent never opens Claude's own files
        // (no transcripts, titles or session ids): it only looks at processes and at the render's folder.
        static readonly SessionInfo ClaudeSession = new SessionInfo { Title = "Claude session", Dir = "" };
        SessionInfo SessionFor(ProcInfo claude) { return ClaudeSession; }

        // Claude writes background command output to Temp\claude\<project>\<session>\tasks\<id>.output,
        // created the moment the command starts.
        static string FindLog(SessionInfo si, DateTime start)
        {
            try
            {
                if (!Directory.Exists(TempClaude)) return null;
                var dirs = new List<string>();
                foreach (var d in Directory.GetDirectories(TempClaude))
                {
                    if (si != null && si.Id != null) { var t = Path.Combine(d, si.Id, "tasks"); if (Directory.Exists(t)) dirs.Add(t); }
                    else foreach (var s in Directory.GetDirectories(d)) { var t = Path.Combine(s, "tasks"); if (Directory.Exists(t)) dirs.Add(t); }
                }
                string best = null; double bestDiff = 1e9;
                foreach (var t in dirs)
                    foreach (var f in Directory.GetFiles(t, "*.output"))
                    {
                        double diff = (start - File.GetCreationTime(f)).TotalSeconds;
                        if (diff >= -3 && diff <= 30 && Math.Abs(diff) < bestDiff) { bestDiff = Math.Abs(diff); best = f; }
                    }
                return best;
            }
            catch { return null; }
        }

        // Render started with its output redirected to a file (e.g. `node render.js 2 >> render/log.txt`):
        // look for a log in its folder that is being written during this run.
        static string FindFileLog(string cwd, DateTime start)
        {
            try
            {
                if (string.IsNullOrEmpty(cwd) || !Directory.Exists(cwd)) return null;
                var cands = new List<string>();
                foreach (var d in new[] { cwd, Path.Combine(cwd, "render"), Path.Combine(cwd, "out"), Path.Combine(cwd, "logs") })
                {
                    if (!Directory.Exists(d)) continue;
                    foreach (var pat in new[] { "*.log", "*log*.txt", "*.out" }) cands.AddRange(Directory.GetFiles(d, pat));
                }
                return cands.Distinct()
                    .Where(f => { var w = File.GetLastWriteTime(f); return w >= start.AddSeconds(-5) && w > DateTime.Now.AddMinutes(-20); })
                    .OrderByDescending(f => File.GetLastWriteTime(f)).FirstOrDefault();
            }
            catch { return null; }
        }

        static readonly Regex rxChunkHdr =new Regex(@"^(\d+)/(\d+) chunks to render");
        static readonly Regex rxChunkOk = new Regex(@"chunk \d+ ok\D+(\d+) done, (\d+) queued, (\d+)s");
        static readonly Regex rxWorker = new Regex(@"^\[?w(\d+)\]?\s+(\d+)/(\d+)(?:\s+frames,)?\s+(\d+)s");
        static readonly Regex rxWorkerDone = new Regex(@"^\[?w(\d+)\]?\s+done");
        static readonly Regex rxFrac = new Regex(@"(\d+)\s*/\s*(\d+)");
        static readonly Regex rxPct = new Regex(@"(\d{1,3}(?:[.,]\d+)?)\s*%");

        static string ReadHeadTail(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                long len = fs.Length;
                if (len <= 256 * 1024) { var b = new byte[len]; int n = 0; while (n < len) { int r = fs.Read(b, n, (int)len - n); if (r <= 0) break; n += r; } return Encoding.UTF8.GetString(b, 0, n); }
                var head = new byte[32 * 1024]; int hn = fs.Read(head, 0, head.Length);
                fs.Seek(-192 * 1024, SeekOrigin.End);
                var tail = new byte[192 * 1024]; int tn = 0; while (tn < tail.Length) { int r = fs.Read(tail, tn, tail.Length - tn); if (r <= 0) break; tn += r; }
                return Encoding.UTF8.GetString(head, 0, hn) + "\n" + Encoding.UTF8.GetString(tail, 0, tn);
            }
        }

        static void ParseLog(string path, Job j)
        {
            string text; try { text = ReadHeadTail(path); } catch { return; }
            // PowerShell's `*>>` appends UTF-16 text to a UTF-8 file: dropping the zero bytes makes both readable
            var lines = text.Replace("\0", "").Replace("\r", "\n").Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
            if (lines.Count == 0) return;
            var useful = lines.Where(l => !l.StartsWith("console:")).ToList();
            j.LastLine = (useful.Count > 0 ? useful[useful.Count - 1] : lines[lines.Count - 1]);
            if (j.LastLine.Length > 200) j.LastLine = j.LastLine.Substring(0, 200);
            bool finished = useful.Count > 0 && Regex.IsMatch(useful[useful.Count - 1], @"^(done|video assembled|partial done)\b");

            int hdr = -1, N = 0, Q0 = 0;
            for (int i = 0; i < lines.Count; i++) { var m = rxChunkHdr.Match(lines[i]); if (m.Success) { hdr = i; Q0 = int.Parse(m.Groups[1].Value); N = int.Parse(m.Groups[2].Value); } }
            if (hdr >= 0 && N > 0)
            {
                int done = 0, secs = 0;
                for (int i = hdr + 1; i < lines.Count; i++) { var m = rxChunkOk.Match(lines[i]); if (m.Success) { done = int.Parse(m.Groups[1].Value); secs = int.Parse(m.Groups[3].Value); } }
                // progress of this run (Q0 chunks were queued); resumed or ONLY= runs skip the rest
                int have = N - Q0 + done;
                j.Progress = Q0 > 0 ? Math.Min(1, done / (double)Q0) : 1;
                if (done > 0 && secs > 0) j.Eta = (N - have) * secs / (double)done;
                if (finished) { j.Progress = 1; j.Eta = 0; j.Finished = true; }
                return;
            }

            var w = new Dictionary<int, int[]>();
            foreach (var l in lines)
            {
                var m = rxWorker.Match(l);
                if (m.Success) { w[int.Parse(m.Groups[1].Value)] = new[] { int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value), int.Parse(m.Groups[4].Value) }; continue; }
                m = rxWorkerDone.Match(l);
                if (m.Success) { int k = int.Parse(m.Groups[1].Value); int[] v; if (w.TryGetValue(k, out v)) v[0] = v[1]; }
            }
            if (w.Count > 0)
            {
                double d = w.Values.Sum(v => (double)v[0]), t = w.Values.Sum(v => (double)v[1]);
                if (t > 0) j.Progress = d / t;
                double eta = -1;
                foreach (var v in w.Values) if (v[0] < v[1] && v[0] > 0 && v[2] > 0) eta = Math.Max(eta, (v[1] - v[0]) * v[2] / (double)v[0]);
                j.Eta = eta;
                if (finished) { j.Progress = 1; j.Eta = 0; j.Finished = true; }
                return;
            }

            for (int i = useful.Count - 1; i >= Math.Max(0, useful.Count - 30); i--)
            {
                var m = rxPct.Match(useful[i]);
                if (m.Success) { double p; if (double.TryParse(m.Groups[1].Value.Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out p) && p <= 100) { j.Progress = p / 100; break; } }
                m = rxFrac.Match(useful[i]);
                if (m.Success) { double a = double.Parse(m.Groups[1].Value), b = double.Parse(m.Groups[2].Value); if (b > 1 && a <= b) { j.Progress = a / b; break; } }
            }
            if (finished) { j.Progress = 1; j.Eta = 0; j.Finished = true; }
        }
    }

    // ------------------------------------------------------------------ VideoHub bridge
    // The hub server and this app talk through files, not HTTP: state.json is what the hub reads,
    // cmd\*.json is what it asks for. No port to open, no firewall prompt, works while the hub is down.
    static class StateFile
    {
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        static readonly int MyPid = Process.GetCurrentProcess().Id;
        static string lastErr;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool MoveFileEx(string from, string to, int flags);

        public static string Str(string s)
        {
            if (s == null) return "null";
            var b = new StringBuilder(s.Length + 2); b.Append('"');
            foreach (char c in s)
            {
                if (c == '"') b.Append("\\\"");
                else if (c == '\\') b.Append("\\\\");
                else if (c == '\n') b.Append("\\n");
                else if (c == '\r') b.Append("\\r");
                else if (c == '\t') b.Append("\\t");
                else if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) b.Append("\\u").Append(((int)c).ToString("x4"));
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }
        static string Num(double v, int dec) { return double.IsNaN(v) || double.IsInfinity(v) ? "null" : Math.Round(v, dec).ToString("0.###", Inv); }
        static string Iso(DateTime t) { return t.ToString("yyyy-MM-dd'T'HH:mm:ss", Inv); }
        static string Bool(bool b) { return b ? "true" : "false"; }

        // unknown values are null: progress/etaSec (no log yet), gpu (no counters), cap (no cap)
        // slow: null / "RAM" / "queue" / "manual" — runs with a SlowCapPct CPU cap (never frozen by the watchdog)
        // ramWarning: free RAM is below CriticalMB even though renders were slowed — names the biggest render, the user decides
        public static string Json(Snapshot s, Settings st, bool hotkeys, long availMB)
        {
            var warnJob = MainForm.WarnJob(s, st, availMB);
            string warn = warnJob == null ? null : MainForm.RamWarning(warnJob);
            var b = new StringBuilder(2048);
            b.Append("{ \"updated\": ").Append(Str(Iso(DateTime.Now))).Append(", \"pid\": ").Append(MyPid)
             .Append(", \"cpu\": ").Append(Num(s.Cpu, 1)).Append(", \"gpu\": ").Append(s.Gpu < 0 ? "null" : Num(s.Gpu, 1))
             .Append(", \"ramUsedGB\": ").Append(Num(s.RamUsedGB, 2)).Append(", \"ramTotalGB\": ").Append(Num(s.RamTotalGB, 2))
             .Append(", \"ramAvailMB\": ").Append(availMB == long.MaxValue ? "null" : availMB.ToString(Inv)).Append(",\n")
             .Append("  \"active\": ").Append(Bool(s.Active)).Append(", \"idleSec\": ").Append(((long)Math.Round(s.IdleSec)).ToString(Inv))
             .Append(", \"capNow\": ").Append(s.CapNow).Append(", \"pauseMB\": ").Append(st.PauseMB).Append(", \"criticalMB\": ").Append(st.CriticalMB)
             .Append(", \"slowCapPct\": ").Append(st.SlowCapPct).Append(", \"hotkeys\": ").Append(Bool(hotkeys))
             .Append(",\n  \"ramWarning\": ").Append(Str(warn))
             // what VideoHub's settings page shows; it changes them by writing settings.txt (+ a "reload" command)
             .Append(",\n  \"settings\": { \"CapActive\": ").Append(st.CapActive).Append(", \"CapIdle\": ").Append(st.CapIdle).Append(", \"IdleMin\": ").Append(st.IdleMin)
             .Append(", \"PauseMB\": ").Append(st.PauseMB).Append(", \"CriticalMB\": ").Append(st.CriticalMB).Append(", \"SlowCapPct\": ").Append(st.SlowCapPct)
             .Append(", \"LowPrio\": ").Append(Bool(st.LowPrio)).Append(", \"HubStart\": ").Append(Bool(st.HubStart)).Append(", \"Startup\": ").Append(Bool(MainForm.IsStartup())).Append(" }")
             .Append(",\n  \"renders\": [");
            for (int i = 0; i < s.Jobs.Count; i++)
            {
                var j = s.Jobs[i];
                b.Append(i == 0 ? "\n" : ",\n")
                 .Append("    { \"rootPid\": ").Append(j.RootPid).Append(", \"start\": ").Append(Str(Iso(j.Start)))
                 .Append(", \"session\": { \"id\": ").Append(Str(j.SessionId)).Append(", \"title\": ").Append(Str(j.Session)).Append(", \"dir\": ").Append(Str(j.SessionDir)).Append(" },\n")
                 .Append("      \"cwd\": ").Append(Str(j.Cwd)).Append(", \"project\": ").Append(Str(j.Project)).Append(", \"what\": ").Append(Str(j.What)).Append(",\n")
                 .Append("      \"cmd\": ").Append(Str(j.Cmd)).Append(",\n")
                 .Append("      \"progress\": ").Append(j.Progress < 0 ? "null" : Num(j.Progress, 3)).Append(", \"etaSec\": ").Append(j.Eta < 0 ? "null" : ((long)Math.Round(j.Eta)).ToString(Inv))
                 .Append(", \"cpu\": ").Append(Num(j.Cpu, 1)).Append(", \"gpu\": ").Append(s.Gpu < 0 ? "null" : Num(j.Gpu, 1))
                 .Append(", \"ramMB\": ").Append(j.RamMB.ToString(Inv)).Append(", \"cap\": ").Append(j.Cap < 0 ? "null" : j.Cap.ToString(Inv))
                 .Append(", \"paused\": ").Append(Str(j.Paused)).Append(", \"slow\": ").Append(Str(j.Slow))
                 .Append(", \"ramWarning\": ").Append(Str(j == warnJob ? warn : null)).Append(",\n")
                 .Append("      \"logPath\": ").Append(Str(j.LogPath)).Append(", \"lastLine\": ").Append(Str(j.LastLine)).Append(", \"finished\": ").Append(Bool(j.Finished)).Append(" }");
            }
            b.Append(s.Jobs.Count == 0 ? "] }\n" : "\n  ] }\n");
            return b.ToString();
        }

        // write next to it, then swap it in, so a reader never sees half a file
        public static void Write(string path, string json)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, json, new UTF8Encoding(false));
                for (int i = 0; ; i++)
                {
                    if (MoveFileEx(tmp, path, 0x1 | 0x8)) { lastErr = null; return; }   // REPLACE_EXISTING | WRITE_THROUGH
                    if (i >= 5) throw new IOException("Could not replace state.json (error " + Marshal.GetLastWin32Error() + ")");
                    Thread.Sleep(50);   // a reader that opened it without sharing delete: try again in a moment
                }
            }
            catch (Exception ex)
            {
                if (ex.Message != lastErr) Settings.Append("error.log", "state: " + ex.Message);   // once, not every 2 s
                lastErr = ex.Message;
            }
        }
    }

    // cmd\*.json: { "action": "pause"|"resume"|"kill"|"pauseAll"|"resumeAll", "rootPid": 123, "by": "optional name" }
    // A writer should create it under another name (x.tmp) and rename it to .json when complete.
    class CommandBox
    {
        readonly string dir, badDir;
        readonly Func<string, int, Dictionary<string, object>, string> exec;   // (action, rootPid, whole command) -> outcome for history.log
        readonly AutoResetEvent kick = new AutoResetEvent(false);
        readonly Dictionary<string, DateTime> handled = new Dictionary<string, DateTime>();   // ran but could not delete: never run twice
        FileSystemWatcher fsw;
        static readonly HashSet<string> Actions = new HashSet<string> { "pause", "resume", "kill", "slow", "normal", "pauseAll", "resumeAll", "reload", "startup" };

        public CommandBox(string dir, Func<string, int, Dictionary<string, object>, string> exec) { this.dir = dir; badDir = Path.Combine(dir, "bad"); this.exec = exec; }

        public void Start()
        {
            try
            {
                Directory.CreateDirectory(dir);
                fsw = new FileSystemWatcher(dir, "*.json") { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size, IncludeSubdirectories = false };
                FileSystemEventHandler h = (s, e) => kick.Set();
                fsw.Created += h; fsw.Changed += h; fsw.Renamed += (s, e) => kick.Set(); fsw.Error += (s, e) => kick.Set();
                fsw.EnableRaisingEvents = true;
            }
            catch (Exception ex) { Settings.Append("error.log", "cmd watcher: " + ex.Message); }
            new Thread(Run) { IsBackground = true, Name = "cmd" }.Start();
        }

        // one thread runs every command, in arrival order; the watcher wakes it at once, the 1 s poll catches anything it missed
        void Run()
        {
            while (true)
            {
                kick.WaitOne(1000);
                try { Drain(); } catch (Exception ex) { Settings.Append("error.log", "cmd: " + ex.Message); }
            }
        }

        void Drain()
        {
            if (!Directory.Exists(dir)) { Directory.CreateDirectory(dir); return; }
            var files = Directory.GetFiles(dir, "*.json").Where(f => f.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                                 .OrderBy(f => { try { return File.GetCreationTime(f); } catch { return DateTime.MaxValue; } }).ToList();
            foreach (var k in handled.Keys.Where(k => !files.Contains(k)).ToList()) handled.Remove(k);
            foreach (var f in files)
            {
                DateTime wt; try { wt = File.GetLastWriteTime(f); } catch { continue; }
                DateTime prev; if (handled.TryGetValue(f, out prev) && prev == wt) continue;

                string text;
                try { using (var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.Read)) using (var sr = new StreamReader(fs, Encoding.UTF8)) text = sr.ReadToEnd(); }
                catch (IOException) { continue; }                 // still being written: next round
                catch (UnauthorizedAccessException) { continue; }
                bool young = (DateTime.Now - wt).TotalSeconds < 3;

                Dictionary<string, object> o = null;
                try { o = new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(text) as Dictionary<string, object>; } catch { }
                if (o == null) { if (!young) Bad(f, "invalid JSON"); continue; }

                object v; string action = o.TryGetValue("action", out v) ? v as string : null;
                if (action == null || !Actions.Contains(action)) { Bad(f, "unknown action: " + (action ?? "(none)")); continue; }
                int root = 0;
                if (o.TryGetValue("rootPid", out v) && v != null) { try { root = Convert.ToInt32(v, CultureInfo.InvariantCulture); } catch { root = -1; } }
                bool needsRoot = action == "pause" || action == "resume" || action == "kill" || action == "slow" || action == "normal";
                if (root < 0 || (needsRoot && root <= 0)) { Bad(f, "rootPid is missing or invalid"); continue; }
                if (action == "startup" && !(o.TryGetValue("on", out v) && v is bool)) { Bad(f, "startup requires \"on\": true/false"); continue; }
                string by = o.TryGetValue("by", out v) ? v as string : null;

                string outcome;
                try { outcome = exec(action, root, o); } catch (Exception ex) { outcome = "error: " + ex.Message; }
                Settings.History("COMMAND  " + action + (needsRoot ? " " + root : "") + (string.IsNullOrEmpty(by) ? "" : "  (" + by + ")") + "  →  " + outcome);
                try { File.Delete(f); } catch { handled[f] = wt; }
            }
        }

        void Bad(string f, string why)
        {
            try
            {
                Directory.CreateDirectory(badDir);
                string to = Path.Combine(badDir, Path.GetFileName(f));
                if (File.Exists(to)) to = Path.Combine(badDir, DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + "_" + Path.GetFileName(f));
                File.Move(f, to);
                Settings.History("INVALID COMMAND  " + Path.GetFileName(f) + "  (" + why + ")  →  cmd\\bad\\");
            }
            catch (Exception ex) { Settings.Append("error.log", "cmd bad: " + ex.Message); }
        }
    }

    // (no hub launcher here any more: VideoHub owns the agent's lifetime, never the other way round)

    // ------------------------------------------------------------------ dark theme + custom controls
    static class Th
    {
        public static readonly Color Bg = Color.FromArgb(17, 18, 22);
        public static readonly Color Panel = Color.FromArgb(24, 25, 30);
        public static readonly Color Card = Color.FromArgb(32, 34, 41);
        public static readonly Color Row = Color.FromArgb(22, 23, 28);
        public static readonly Color RowAlt = Color.FromArgb(27, 28, 34);
        public static readonly Color Sel = Color.FromArgb(44, 54, 76);
        public static readonly Color Border = Color.FromArgb(46, 48, 58);
        public static readonly Color Track = Color.FromArgb(48, 50, 60);
        public static readonly Color Text = Color.FromArgb(232, 232, 238);
        public static readonly Color Muted = Color.FromArgb(140, 143, 156);
        public static readonly Color Accent = Color.FromArgb(240, 138, 60);
        public static readonly Color Green = Color.FromArgb(70, 196, 128);
        public static readonly Color Red = Color.FromArgb(232, 84, 84);
        public static readonly Color Blue = Color.FromArgb(96, 156, 255);

        public static GraphicsPath Round(RectangleF r, float rad)
        {
            var p = new GraphicsPath(); float d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90); p.CloseFigure();
            return p;
        }
    }

    // stat tile: title, big value, thin usage bar
    class Tile : Control
    {
        public string Title = "", Value = "", Sub = ""; public double Frac = -1; public Color BarColor = Th.Accent;
        public Tile() { DoubleBuffered = true; BackColor = Th.Bg; Size = new Size(210, 78); Margin = new Padding(0, 0, 12, 0); }
        public void Set(string v, string sub, double frac, Color c)
        {
            if (v == Value && sub == Sub && Math.Abs(frac - Frac) < 0.002 && c == BarColor) return;
            Value = v; Sub = sub; Frac = frac; BarColor = c; Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var p = Th.Round(new RectangleF(0, 0, Width - 1, Height - 1), 8)) using (var b = new SolidBrush(Th.Card)) g.FillPath(b, p);
            using (var f = new Font("Segoe UI", 8.5f)) TextRenderer.DrawText(g, Title.ToUpper(new System.Globalization.CultureInfo("tr-TR")), f, new Point(12, 9), Th.Muted);
            using (var f = new Font("Segoe UI Semibold", 17f)) TextRenderer.DrawText(g, Value, f, new Point(10, 24), Th.Text);
            if (Sub != "") using (var f = new Font("Segoe UI", 8.5f)) TextRenderer.DrawText(g, Sub, f, new Rectangle(0, 33, Width - 12, 20), Th.Muted, TextFormatFlags.Right);
            if (Frac >= 0)
            {
                var tr = new RectangleF(12, Height - 13, Width - 24, 4);
                using (var p = Th.Round(tr, 2)) using (var b = new SolidBrush(Th.Track)) g.FillPath(b, p);
                float w = (float)(tr.Width * Math.Max(0, Math.Min(1, Frac)));
                if (w > 4) using (var p = Th.Round(new RectangleF(tr.X, tr.Y, w, tr.Height), 2)) using (var b = new SolidBrush(BarColor)) g.FillPath(b, p);
            }
        }
    }

    // flat slider
    class Slider : Control
    {
        int val = 50; public int Min = 5, Max = 100, Step = 5; public Color Fill = Th.Accent;
        public event EventHandler ValueChanged;
        public Slider() { DoubleBuffered = true; Height = 28; Cursor = Cursors.Hand; TabStop = true; SetStyle(ControlStyles.Selectable, true); }
        public int Value
        {
            get { return val; }
            set { int v = Math.Max(Min, Math.Min(Max, (int)Math.Round(value / (double)Step) * Step)); if (v == val) return; val = v; Invalidate(); if (ValueChanged != null) ValueChanged(this, EventArgs.Empty); }
        }
        float X0 { get { return 9; } }
        float X1 { get { return Width - 9; } }
        void FromMouse(int x) { Value = (int)(Min + (Max - Min) * Math.Max(0, Math.Min(1, (x - X0) / (X1 - X0)))); }
        protected override void OnMouseDown(MouseEventArgs e) { Focus(); if (e.Button == MouseButtons.Left) { Capture = true; FromMouse(e.X); } }
        protected override void OnMouseMove(MouseEventArgs e) { if (Capture) FromMouse(e.X); }
        protected override void OnMouseUp(MouseEventArgs e) { Capture = false; }
        protected override void OnMouseWheel(MouseEventArgs e) { Value += e.Delta > 0 ? Step : -Step; }
        protected override bool IsInputKey(Keys k) { return k == Keys.Left || k == Keys.Right || base.IsInputKey(k); }
        protected override void OnKeyDown(KeyEventArgs e) { if (e.KeyCode == Keys.Left) Value -= Step; else if (e.KeyCode == Keys.Right) Value += Step; }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent != null ? Parent.BackColor : Th.Panel);
            float cy = Height / 2f, t = (val - Min) / (float)(Max - Min), x = X0 + (X1 - X0) * t;
            using (var p = Th.Round(new RectangleF(X0, cy - 3, X1 - X0, 6), 3)) using (var b = new SolidBrush(Th.Track)) g.FillPath(b, p);
            if (x - X0 > 3) using (var p = Th.Round(new RectangleF(X0, cy - 3, x - X0, 6), 3)) using (var b = new SolidBrush(Fill)) g.FillPath(b, p);
            using (var b = new SolidBrush(Th.Text)) g.FillEllipse(b, x - 8, cy - 8, 16, 16);
            using (var b = new SolidBrush(Fill)) g.FillEllipse(b, x - 4, cy - 4, 8, 8);
            if (Focused) using (var pen = new Pen(Color.FromArgb(90, Fill), 2)) g.DrawEllipse(pen, x - 10, cy - 10, 20, 20);
        }
        protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
        protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    }

    // pill toggle with label
    class Toggle : Control
    {
        bool on; public event EventHandler CheckedChanged;
        public Toggle(string text) { Text = text; DoubleBuffered = true; Height = 24; Cursor = Cursors.Hand; ForeColor = Th.Text; Font = new Font("Segoe UI", 9.5f); }
        public bool Checked { get { return on; } set { if (on == value) return; on = value; Invalidate(); if (CheckedChanged != null) CheckedChanged(this, EventArgs.Empty); } }
        protected override void OnClick(EventArgs e) { Checked = !Checked; base.OnClick(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(Parent != null ? Parent.BackColor : Th.Panel);
            var r = new RectangleF(1, (Height - 18) / 2f, 34, 18);
            using (var p = Th.Round(r, 9)) using (var b = new SolidBrush(on ? Th.Accent : Th.Track)) g.FillPath(b, p);
            float kx = on ? r.Right - 16 : r.X + 2;
            using (var b = new SolidBrush(on ? Color.White : Th.Muted)) g.FillEllipse(b, kx, r.Y + 2, 14, 14);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(44, 0, Width - 44, Height), ForeColor, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }

    class DarkButton : Button
    {
        public DarkButton(string text, Color? fg = null)
        {
            Text = text; FlatStyle = FlatStyle.Flat; BackColor = Th.Card; ForeColor = fg ?? Th.Text; Cursor = Cursors.Hand;
            FlatAppearance.BorderColor = Th.Border; FlatAppearance.MouseOverBackColor = Color.FromArgb(44, 47, 57); FlatAppearance.MouseDownBackColor = Color.FromArgb(54, 57, 69);
            Font = new Font("Segoe UI", 9.5f); Height = 32; UseVisualStyleBackColor = false;
        }
    }

    class DarkMenuColors : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground { get { return Th.Card; } }
        public override Color MenuBorder { get { return Th.Border; } }
        public override Color MenuItemBorder { get { return Th.Border; } }
        public override Color MenuItemSelected { get { return Th.Sel; } }
        public override Color ImageMarginGradientBegin { get { return Th.Card; } }
        public override Color ImageMarginGradientMiddle { get { return Th.Card; } }
        public override Color ImageMarginGradientEnd { get { return Th.Card; } }
        public override Color SeparatorDark { get { return Th.Border; } }
    }

    class DBListView : ListView
    {
        public DBListView() { DoubleBuffered = true; SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true); }

        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
        struct RECT { public int L, T, R, B; }

        // paint over the column separator lines Windows draws below the last row
        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg != 0x000F) return;
            int top;
            if (Items.Count > 0) top = Items[Items.Count - 1].Bounds.Bottom;
            else { RECT hr; IntPtr hdr = SendMessage(Handle, 0x101F, IntPtr.Zero, IntPtr.Zero); top = hdr != IntPtr.Zero && GetClientRect(hdr, out hr) ? hr.B : 0; }
            if (top >= ClientSize.Height) return;
            using (var g = CreateGraphics()) using (var b = new SolidBrush(BackColor)) g.FillRectangle(b, 0, top, ClientSize.Width, ClientSize.Height - top);
        }
    }

    // ------------------------------------------------------------------ main window
    class MainForm : Form
    {
        readonly Settings st = Settings.Load();
        readonly Limiter lim = new Limiter();
        readonly Collector col;
        readonly bool startHidden;
        readonly EventWaitHandle showEvt;
        volatile bool quitting;
        // VideoHub agent: test instances (--only) use a test\ folder so they never overwrite the real state or take its commands
        readonly string agentDir, statePath, ramFile;
        readonly AutoResetEvent loopWake = new AutoResetEvent(false);
        volatile Snapshot latest;
        CommandBox cmdBox;
        Toggle tgHub;
        DarkButton btnHub;
        // silent agent: VideoHub is the UI. The WinForms window exists only with --window (debugging, --snap tests).
        readonly bool windowMode;
        readonly List<string> testSets;
        readonly object settingsGate = new object();
        FileSystemWatcher settingsWatcher;
        volatile bool loadingControls;   // controls being set from a reload: do not save them back

        Tile tCpu, tGpu, tRam, tJobs;
        Label lblState;
        DBListView list;
        Label detail;
        Slider slActive, slIdle, slIdleMin, slRam;
        Label vRam;
        DarkButton btnPause;
        const int HK_PAUSE = 0xB001, HK_RESUME = 0xB002;
        bool hotkeysOk, testMode;
        Label vActive, vIdle, vIdleMin, vSlow;
        Slider slSlow;
        Toggle tgLow, tgStartup, tgTray;
        DarkButton btnKill, btnFolder, btnLog, btnHistory;
        NotifyIcon tray;
        Dictionary<int, Job> lastJobs = new Dictionary<int, Job>();
        Snapshot lastSnap;

        static readonly string[] Cols = { "Session (who)", "Project", "What's running", "Progress", "Remaining", "CPU", "Limit", "GPU", "RAM", "Duration" };
        static readonly int[] Widths = { 250, 150, 200, 170, 90, 60, 60, 60, 75, 80 };
        static readonly bool[] AlignR = { false, false, false, false, true, true, true, true, true, true };
        const int ColProgress = 3;

        public MainForm(bool hidden, EventWaitHandle evt, string only, bool openHub, string fakeRamFile, List<string> sets, bool window)
        {
            windowMode = window; startHidden = hidden || !window;
            showEvt = evt; col = new Collector(only); testMode = only != null;
            ramFile = testMode ? fakeRamFile : null;
            testSets = testMode ? sets : new List<string>();
            // a test instance reads the settings but never writes them; --set Key=Value changes them for this run only
            if (testMode) { st.ReadOnly = true; ApplyTestSets(st); }
            agentDir = testMode ? Settings.LogDir : Settings.Dir;
            statePath = Path.Combine(agentDir, "state.json");
            Text = only == null ? "VideoHub Agent" : "VideoHub Agent (test: " + only + ")";
            Font = new Font("Segoe UI", 9.5f);
            ClientSize = new Size(1240, 700);
            MinimumSize = new Size(980, 560);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Th.Bg; ForeColor = Th.Text;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // ---- header: tiles + state
            var head = new Panel { Dock = DockStyle.Top, Height = 132, Padding = new Padding(18, 16, 18, 8), BackColor = Th.Bg };
            var tiles = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 80, BackColor = Th.Bg, WrapContents = false };
            tCpu = new Tile { Title = "CPU" }; tGpu = new Tile { Title = "GPU" }; tRam = new Tile { Title = "Memory" }; tJobs = new Tile { Title = "Renders" };
            tiles.Controls.AddRange(new Control[] { tCpu, tGpu, tRam, tJobs });
            lblState = new Label { Dock = DockStyle.Bottom, Height = 30, Font = new Font("Segoe UI Semibold", 10.5f), ForeColor = Th.Accent, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
            head.Controls.Add(lblState); head.Controls.Add(tiles);

            // ---- list
            var listWrap = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18, 4, 18, 0), BackColor = Th.Bg };
            list = new DBListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, MultiSelect = false, HideSelection = false, OwnerDraw = true, BorderStyle = BorderStyle.None, BackColor = Th.Row, ForeColor = Th.Text, HeaderStyle = ColumnHeaderStyle.Nonclickable };
            for (int i = 0; i < Cols.Length; i++) list.Columns.Add(Cols[i], Widths[i], AlignR[i] ? HorizontalAlignment.Right : HorizontalAlignment.Left);
            list.SmallImageList = new ImageList { ImageSize = new Size(1, 34) };   // row height
            list.DrawColumnHeader += DrawHeader;
            list.DrawItem += (s, e) => { };
            list.DrawSubItem += DrawCell;
            list.SelectedIndexChanged += (s, e) => UpdateDetail();
            list.DoubleClick += (s, e) => OpenLog();
            list.Resize += (s, e) => FitLastColumn();
            listWrap.Controls.Add(list);

            detail = new Label { Dock = DockStyle.Bottom, Height = 70, Padding = new Padding(20, 8, 18, 6), BackColor = Th.Bg, ForeColor = Th.Muted, Font = new Font("Consolas", 9f), AutoEllipsis = true };

            // ---- control panel
            var bottom = new Panel { Dock = DockStyle.Bottom, Height = 254, BackColor = Th.Panel, Padding = new Padding(18, 12, 18, 12) };
            bottom.Paint += (s, e) => { using (var p = new Pen(Th.Border)) e.Graphics.DrawLine(p, 0, 0, bottom.Width, 0); };
            var title = new Label { Text = "RENDER POWER  ·  CPU usage and memory protection", Left = 18, Top = 14, Width = 520, Height = 20, ForeColor = Th.Muted, Font = new Font("Segoe UI Semibold", 8.5f) };
            var l4 = new Label { Text = "Slow down below this free RAM", Left = 18, Top = 166, Width = 232, ForeColor = Th.Text };
            slRam = new Slider { Left = 250, Top = 160, Width = 360, Min = 300, Max = 4000, Step = 50, Value = st.PauseMB, Fill = Th.Red };
            vRam = new Label { Left = 622, Top = 166, Width = 200, ForeColor = Th.Red, Font = new Font("Segoe UI Semibold", 9.5f) };
            var l5 = new Label { Text = "Render speed with low RAM", Left = 18, Top = 206, Width = 232, ForeColor = Th.Text };
            slSlow = new Slider { Left = 250, Top = 200, Width = 360, Min = 1, Max = 50, Step = 1, Value = st.SlowCapPct, Fill = Th.Accent };
            vSlow = new Label { Left = 622, Top = 206, Width = 200, ForeColor = Th.Accent, Font = new Font("Segoe UI Semibold", 9.5f) };
            var l1 = new Label { Text = "Limit while using the PC", Left = 18, Top = 46, Width = 230, ForeColor = Th.Text };
            slActive = new Slider { Left = 250, Top = 40, Width = 360, Value = st.CapActive, Fill = Th.Accent };
            vActive = new Label { Left = 622, Top = 46, Width = 190, ForeColor = Th.Accent, Font = new Font("Segoe UI Semibold", 9.5f) };
            var l2 = new Label { Text = "When idle (no mouse/keyboard)", Left = 18, Top = 86, Width = 230, ForeColor = Th.Text };
            slIdle = new Slider { Left = 250, Top = 80, Width = 360, Value = st.CapIdle, Fill = Th.Green };
            vIdle = new Label { Left = 622, Top = 86, Width = 190, ForeColor = Th.Green, Font = new Font("Segoe UI Semibold", 9.5f) };
            var l3 = new Label { Text = "Idle after", Left = 18, Top = 126, Width = 230, ForeColor = Th.Text };
            slIdleMin = new Slider { Left = 250, Top = 120, Width = 360, Min = 1, Max = 30, Step = 1, Value = st.IdleMin, Fill = Th.Blue };
            vIdleMin = new Label { Left = 622, Top = 126, Width = 190, ForeColor = Th.Blue, Font = new Font("Segoe UI Semibold", 9.5f) };
            slActive.Value = st.CapActive; slIdle.Value = st.CapIdle;

            tgLow = new Toggle("Run renders at low priority") { Left = 840, Top = 8, Width = 300, Checked = st.LowPrio };
            tgTray = new Toggle("Keep running in the tray on close") { Left = 840, Top = 34, Width = 300, Checked = st.Tray };
            tgStartup = new Toggle("Start with Windows") { Left = 840, Top = 60, Width = 300, Checked = IsStartup() };
            tgHub = new Toggle("Start the VideoHub server") { Left = 840, Top = 86, Width = 300, Checked = st.HubStart, Visible = false };   // the agent no longer starts the hub
            btnKill = new DarkButton("Stop render", Th.Red) { Left = 840, Top = 120, Width = 186 };
            btnPause = new DarkButton("Pause") { Left = 1036, Top = 120, Width = 186 };
            btnFolder = new DarkButton("Folder") { Left = 840, Top = 160, Width = 88 };
            btnLog = new DarkButton("Log") { Left = 936, Top = 160, Width = 88 };
            btnHistory = new DarkButton("History") { Left = 1032, Top = 160, Width = 88 };
            btnHub = new DarkButton("VideoHub", Th.Blue) { Left = 1128, Top = 160, Width = 94 };
            bottom.Controls.AddRange(new Control[] { title, l1, slActive, vActive, l2, slIdle, vIdle, l3, slIdleMin, vIdleMin, l4, slRam, vRam, l5, slSlow, vSlow, tgLow, tgTray, tgStartup, tgHub, btnKill, btnPause, btnFolder, btnLog, btnHistory, btnHub });

            var tip = new ToolTip();
            tip.SetToolTip(slActive, "All renders together use at most this much CPU while you use the PC.");
            tip.SetToolTip(slIdle, "Switches to this limit after the specified time without mouse or keyboard input. 100% = unlimited.");
            tip.SetToolTip(tgLow, "Windows gives your apps CPU time first.");
            tip.SetToolTip(btnKill, "Stops the selected render and all its child processes (Chrome, ffmpeg).");
            tip.SetToolTip(btnPause, "Freezes or resumes the selected render. Shortcuts: Ctrl+Alt+End pauses all, Ctrl+Alt+Home resumes all.");
            tip.SetToolTip(slRam, "When free RAM drops below this value, renders slow down starting with the newest (they keep running to avoid timeouts); the oldest continues at normal speed (unless free RAM drops below " + st.CriticalMB + " MB). As RAM frees up, they return to normal speed starting with the oldest.");
            tip.SetToolTip(slSlow, "A render slowed down due to low RAM uses at most this much of the PC's CPU. It keeps running at a slower pace.");
            tip.SetToolTip(tgHub, "Starts the VideoHub server (node server\\hub.js) in the background when Render Guard starts. Folder: " + st.HubPath);
            tip.SetToolTip(btnHub, "Opens VideoHub in an app window, starting the server first if needed.");

            Controls.Add(listWrap); Controls.Add(head); Controls.Add(detail); Controls.Add(bottom);

            // (--window only) a control the user moves saves settings.txt; one set from a reload does not write it back
            slActive.ValueChanged += (s, e) => { RefreshCapLabels(); if (loadingControls) return; st.CapActive = slActive.Value; st.Save(); };
            slIdle.ValueChanged += (s, e) => { RefreshCapLabels(); if (loadingControls) return; st.CapIdle = slIdle.Value; st.Save(); };
            slIdleMin.ValueChanged += (s, e) => { RefreshCapLabels(); if (loadingControls) return; st.IdleMin = slIdleMin.Value; st.Save(); };
            tgLow.CheckedChanged += (s, e) => { if (loadingControls) return; st.LowPrio = tgLow.Checked; st.Save(); };
            tgTray.CheckedChanged += (s, e) => { if (loadingControls) return; st.Tray = tgTray.Checked; st.Save(); };
            tgStartup.CheckedChanged += (s, e) => { if (loadingControls) return; SetStartup(tgStartup.Checked); };
            slRam.ValueChanged += (s, e) => { RefreshCapLabels(); if (loadingControls) return; st.PauseMB = slRam.Value; st.Save(); };
            slSlow.ValueChanged += (s, e) => { RefreshCapLabels(); if (loadingControls) return; st.SlowCapPct = slSlow.Value; st.Save(); };
            btnKill.Click += (s, e) => KillSelected();
            btnPause.Click += (s, e) =>
            {
                var j = Selected(); if (j == null) return;
                if (j.Paused != null) { lim.Resume(j.RootPid); Settings.History("RESUMED     " + j.Session + "  [" + j.Project + "]"); }
                else if (lim.Pause(j.RootPid, "manual")) Settings.History("PAUSED (manual)  " + j.Session + "  [" + j.Project + "]");
                j.Paused = j.Paused == null ? "manual" : null; UpdateButtons(); list.Invalidate();
            };
            btnFolder.Click += (s, e) => { var j = Selected(); if (j != null && Directory.Exists(j.Cwd)) Process.Start("explorer.exe", "\"" + j.Cwd + "\""); };
            btnLog.Click += (s, e) => OpenLog();
            btnHistory.Click += (s, e) => { if (File.Exists(Settings.HistoryPath)) Process.Start("notepad.exe", "\"" + Settings.HistoryPath + "\""); };
            btnHub.Click += (s, e) => OpenHub();
            tgHub.CheckedChanged += (s, e) => { if (loadingControls) return; st.HubStart = tgHub.Checked; st.Save(); };
            RefreshCapLabels();

            // No tray icon: the agent is an invisible part of VideoHub (its Renders page has pause/slow/stop, the
            // settings and "pause all / go on"). Only the --window debug mode gets an icon to bring the window back.
            if (windowMode)
            {
                var menu = new ContextMenuStrip { Renderer = new ToolStripProfessionalRenderer(new DarkMenuColors()), ForeColor = Th.Text, BackColor = Th.Card };
                menu.Items.Add("Show window", null, (s, e) => ShowMe());
                menu.Items.Add("Open VideoHub", null, (s, e) => OpenHub());
                menu.Items.Add("Pause all renders (Ctrl+Alt+End)", null, (s, e) => EmergencyPause("menu"));
                menu.Items.Add("Resume (Ctrl+Alt+Home)", null, (s, e) => EmergencyResume("menu"));
                menu.Items.Add("Exit", null, (s, e) => QuitApp());
                foreach (ToolStripItem it in menu.Items) it.ForeColor = Th.Text;
                tray = new NotifyIcon { Icon = Icon ?? SystemIcons.Application, Text = "VideoHub Agent (debug)", Visible = true, ContextMenuStrip = menu };
                tray.DoubleClick += (s, e) => ShowMe();
            }

            Apply(new Snapshot());
            IntPtr uiHandle = Handle;   // establish handle on UI thread before workers start
            var t = new Thread(Loop) { IsBackground = true }; t.Start();
            var tw = new Thread(Watchdog) { IsBackground = true }; tw.Start();
            list.SelectedIndexChanged += (s, e) => UpdateButtons();
            // --window debug copy started again: bring its window back
            var t2 = new Thread(() => { while (true) { showEvt.WaitOne(); try { BeginInvoke((Action)(() => { if (windowMode) ShowMe(); })); } catch { } } }) { IsBackground = true }; t2.Start();
            WatchSettings();
            if (only == null)
            {
                // the hub stops us with `VideoHubAgent.exe --quit` (same event name as the old RenderGuard.exe)
                var quitEvt = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\RenderGuard_quit");
                var t3 = new Thread(() => { quitEvt.WaitOne(); try { BeginInvoke((Action)QuitApp); } catch { } }) { IsBackground = true }; t3.Start();
            }

            cmdBox = new CommandBox(Path.Combine(agentDir, "cmd"), RunCommand);
            cmdBox.Start();
            // The hub owns our lifetime: we never start, supervise or restart hub.js (openHub only in --window debug mode).
            if (openHub) OpenHub();
        }

        // ---- settings: VideoHub edits settings.txt (and may drop a "reload" command); we apply changes live
        void ApplyTestSets(Settings s)
        {
            foreach (var kv in testSets) { var p = kv.Split(new[] { '=' }, 2); if (p.Length == 2) try { s.Set(p[0].Trim(), p[1].Trim()); } catch { } }
        }

        void WatchSettings()
        {
            var kick = new AutoResetEvent(false);
            try
            {
                string path = Settings.FilePath;
                settingsWatcher = new FileSystemWatcher(Path.GetDirectoryName(path), Path.GetFileName(path)) { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
                settingsWatcher.Changed += (s, e) => kick.Set(); settingsWatcher.Created += (s, e) => kick.Set(); settingsWatcher.Renamed += (s, e) => kick.Set();
                settingsWatcher.EnableRaisingEvents = true;
            }
            catch (Exception ex) { Settings.Append("error.log", "settings watcher: " + ex.Message); }
            new Thread(() =>
            {
                while (!quitting)
                {
                    kick.WaitOne(5000);   // polling fallback for missed events
                    Thread.Sleep(300);   // let the writer finish; one reload for a burst of change events
                    try { ReloadSettings("file"); } catch (Exception ex) { Settings.Append("error.log", "settings reload: " + ex.Message); }
                }
            }) { IsBackground = true, Name = "settings" }.Start();
        }

        // returns what changed ("" = nothing)
        string ReloadSettings(string source)
        {
            string diff;
            lock (settingsGate)
            {
                Settings fresh; if (!Settings.TryLoad(out fresh)) return "";   // retain last good settings on read/parse failure
                if (testMode) ApplyTestSets(fresh);
                diff = st.CopyFrom(fresh);
            }
            if (diff == "") return "";
            Settings.History("SETTINGS (" + source + "): " + diff);
            loopWake.Set();
            if (windowMode) try { BeginInvoke((Action)LoadControls); } catch { }
            return diff;
        }

        // --window only: show reloaded settings on the controls
        void LoadControls()
        {
            loadingControls = true;
            try
            {
                slActive.Value = st.CapActive; slIdle.Value = st.CapIdle; slIdleMin.Value = st.IdleMin; slRam.Value = st.PauseMB; slSlow.Value = st.SlowCapPct;
                tgLow.Checked = st.LowPrio; tgTray.Checked = st.Tray; tgHub.Checked = st.HubStart; tgStartup.Checked = IsStartup();
                RefreshCapLabels();
            }
            finally { loadingControls = false; }
        }

        // ---- VideoHub
        // the VideoHub folder: one up from guard\ where this exe lives (else the HubDir setting)
        public static string HubFolder(Settings st)
        {
            try
            {
                string up = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
                if (File.Exists(Path.Combine(up, "server", "hub.js"))) return up;
            }
            catch { }
            return st.HubPath;
        }

        // open VideoHub the way its own shortcut does (open.vbs: starts the server if needed, then the app window)
        public static void OpenHubWindow(Settings st)
        {
            string vbs = Path.Combine(HubFolder(st), "open.vbs");
            try
            {
                if (!File.Exists(vbs)) { Settings.History("VIDEOHUB  could not open: " + vbs + " is missing"); return; }
                Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wscript.exe"), "\"" + vbs + "\"") { UseShellExecute = false });
            }
            catch (Exception ex) { Settings.Append("error.log", "hub open: " + ex.Message); }
        }

        void OpenHub() { OpenHubWindow(st); }   // --window debug mode only (button / tray)

        // a command from cmd\*.json (runs on the command thread). Only renders we currently see can be touched.
        string RunCommand(string action, int root, Dictionary<string, object> args)
        {
            if (action == "reload") { string d = ReloadSettings("command"); return d == "" ? "settings unchanged" : "settings loaded: " + d; }
            if (action == "startup")
            {
                bool on = (bool)args["on"]; SetStartup(on);
                if (windowMode) try { BeginInvoke((Action)LoadControls); } catch { }
                loopWake.Set();
                return "Start with Windows: " + (IsStartup() ? "on" : "off");
            }
            var snap = latest;
            Job j = snap == null ? null : snap.Jobs.FirstOrDefault(x => x.RootPid == root);
            string who = j == null ? "pid " + root : j.Session + "  [" + j.Project + "]";
            string outcome;
            if (action == "pause")
                outcome = lim.Pause(root, "manual") ? "PAUSED (manual)  " + who : j == null ? "render not found: pid " + root : "already paused: " + who;
            else if (action == "resume")
                outcome = lim.Resume(root) ? "RESUMED  " + who : j == null ? "render not found: pid " + root : "was not paused: " + who;
            else if (action == "kill")
            {
                if (j == null) outcome = "render not found, nothing stopped: pid " + root;
                else
                {
                    Process.Start(new ProcessStartInfo("taskkill", "/PID " + root + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                    outcome = "STOPPED  " + who + "  " + j.What;
                }
            }
            else if (action == "slow")
                outcome = lim.Slow(root, "manual") ? "SLOWED (manual)  " + st.SlowCapPct + "% CPU  " + who : j == null ? "render not found: pid " + root : "already slow: " + who;
            else if (action == "normal")
                outcome = lim.Normal(root) ? "NORMAL SPEED  " + who : j == null ? "render not found: pid " + root : "was not slow: " + who;
            else if (action == "pauseAll") outcome = lim.PauseAll("manual") + " renders paused";
            else outcome = lim.ResumeAll() + " renders resumed";
            loopWake.Set();   // refresh state.json and the list now, not in 2 s
            return outcome;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int on = 1;
            try { if (N.DwmSetWindowAttribute(Handle, 20, ref on, 4) != 0) N.DwmSetWindowAttribute(Handle, 19, ref on, 4); } catch { }
            if (!testMode)
            {
                const uint ALT = 0x1, CTRL = 0x2, NOREPEAT = 0x4000;
                hotkeysOk = N.RegisterHotKey(Handle, HK_PAUSE, CTRL | ALT | NOREPEAT, 0x23)      // End
                          & N.RegisterHotKey(Handle, HK_RESUME, CTRL | ALT | NOREPEAT, 0x24);    // Home
            }
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            try { N.UnregisterHotKey(Handle, HK_PAUSE); N.UnregisterHotKey(Handle, HK_RESUME); } catch { }
            base.OnHandleDestroyed(e);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try { N.SetWindowTheme(list.Handle, "DarkMode_ItemsView", null); } catch { }
            FitLastColumn();
        }

        void FitLastColumn()
        {
            if (list.Columns.Count == 0) return;
            int used = 0; for (int i = 0; i < list.Columns.Count - 1; i++) used += list.Columns[i].Width;
            int w = list.ClientSize.Width - used; if (w > 60) list.Columns[list.Columns.Count - 1].Width = w;
        }

        void RefreshCapLabels()
        {
            int c = Environment.ProcessorCount;
            vActive.Text = slActive.Value >= 100 ? "100%  unlimited" : slActive.Value + "%   ≈ " + (slActive.Value * c / 100.0).ToString("0.#", CultureInfo.InvariantCulture) + " cores";
            vIdle.Text = slIdle.Value >= 100 ? "100%  unlimited" : slIdle.Value + "%   ≈ " + (slIdle.Value * c / 100.0).ToString("0.#", CultureInfo.InvariantCulture) + " cores";
            vIdleMin.Text = slIdleMin.Value + " min of inactivity";
            vRam.Text = (slRam.Value / 1024.0).ToString("0.0#", CultureInfo.InvariantCulture) + " GB free";
            vSlow.Text = slSlow.Value + "%   ≈ " + (slSlow.Value * c / 100.0).ToString("0.#", CultureInfo.InvariantCulture) + " cores";
        }

        void UpdateButtons()
        {
            var j = Selected();
            btnPause.Text = j != null && j.Paused != null ? "Resume" : "Pause";
            btnPause.ForeColor = j != null && j.Paused != null ? Th.Green : Th.Text;
        }

        // emergency stop / go on (hotkeys and tray menu): a real freeze, the user's call
        void EmergencyPause(string via) { int n = lim.PauseAll("manual"); Settings.History("EMERGENCY PAUSE (" + via + "): " + n + " renders"); loopWake.Set(); }
        void EmergencyResume(string via) { int n = lim.ResumeAll(); Settings.History("RESUMED (" + via + "): " + n + " renders"); loopWake.Set(); }

        // "<session> · <project>" of a render we currently see
        string Who(int root)
        {
            var s = latest; var j = s == null ? null : s.Jobs.FirstOrDefault(x => x.RootPid == root);
            return j == null ? "pid " + root : j.Session + (j.Project != "" ? " · " + j.Project : "");
        }
        public static string RamWarning(string who) { return "RAM is critically low: consider stopping the render for " + who; }
        // free RAM under CriticalMB with renders running (all of them slowed by then): the biggest one is the one to stop
        public static Job WarnJob(Snapshot s, Settings st, long availMB)
        {
            return availMB < st.CriticalMB ? s.Jobs.Where(j => j.Paused == null).OrderByDescending(j => j.RamMB).FirstOrDefault() : null;
        }
        public static string RamWarning(Job j) { return RamWarning(j.Session + (j.Project != "" ? " · " + j.Project : "")); }

        // free RAM; a test instance can read it from a file (--ramfile) to try the watchdog without filling real memory
        long AvailMB()
        {
            if (ramFile != null) { try { return long.Parse(File.ReadAllText(ramFile).Trim(), CultureInfo.InvariantCulture); } catch { } }
            return N.AvailMB();
        }

        // RAM watchdog: runs on its own high-priority thread every 0.4 s (the WMI scan can stall under memory pressure).
        // It never freezes a render (a frozen puppeteer render dies on its CDP timeout); it slows renders down instead:
        // below PauseMB the newest render at normal speed gets a SlowCapPct CPU cap and very low memory priority, the
        // oldest keeps its speed unless RAM is critical. Speed comes back oldest-first when RAM has been comfortably free
        // for 10 s, or when no render runs at normal speed any more.
        void Watchdog()
        {
            Thread.CurrentThread.Priority = ThreadPriority.Highest;
            DateTime last = DateTime.MinValue, aboveSince = DateTime.MaxValue, idleSince = DateTime.MaxValue;
            while (!quitting)
            {
                try
                {
                    long avail = AvailMB(); var now = DateTime.Now;

                    if (avail < st.PauseMB)
                    {
                        aboveSince = idleSince = DateTime.MaxValue;
                        if ((now - last).TotalSeconds > 1.5)
                        {
                            bool critical = avail < st.CriticalMB;
                            string why; int r = lim.SlowForRam(critical, out why); last = now;
                            if (r != 0)
                            {
                                loopWake.Set();   // show it in state.json / the list now
                                bool lastOne = lim.NormalCount() == 0;
                                Settings.History((why == Limiter.Queue ? "SLOW IN QUEUE (RAM: " + avail + " MB free, more than 3 speed changes in 10 min)"
                                                                      : "SLOWED (RAM: " + avail + " MB free" + (lastOne ? ", critical — last render" : "") + ")")
                                                 + "  " + st.SlowCapPct + "% CPU  " + Who(r) + "  pid " + r);
                            }
                        }
                    }
                    else
                    {
                        // a) RAM comfortably free for 10 s: the oldest "RAM" render gets its speed back
                        // b) no render runs at normal speed any more and RAM is above the threshold: the queue moves on
                        bool plenty = avail > st.PauseMB + 1500 && lim.SlowCount("RAM") > 0;
                        bool idle = lim.NormalCount() == 0 && lim.SlowCount("RAM") + lim.SlowCount(Limiter.Queue) > 0;
                        if (!plenty) aboveSince = DateTime.MaxValue; else if (aboveSince == DateTime.MaxValue) aboveSince = now;
                        if (!idle) idleSince = DateTime.MaxValue; else if (idleSince == DateTime.MaxValue) idleSince = now;
                        bool go = (plenty && (now - aboveSince).TotalSeconds > 10 && (now - last).TotalSeconds > 10)
                               || (idle && (now - idleSince).TotalSeconds > 3 && (now - last).TotalSeconds > 3);
                        if (go)
                        {
                            int r = lim.NormalForRam(idle); last = now; aboveSince = idleSince = DateTime.MaxValue;
                            if (r != 0) { loopWake.Set(); Settings.History("NORMAL SPEED (RAM: " + avail + " MB free" + (idle ? ", queue advanced" : "") + ")  " + Who(r) + "  pid " + r); }
                        }
                    }
                }
                catch (Exception ex) { Settings.Append("error.log", "watchdog: " + ex.Message); }
                Thread.Sleep(400);
            }
        }

        // emergency keys work even when this window is hidden in the tray
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0312)   // WM_HOTKEY
            {
                int id = m.WParam.ToInt32();
                if (id == HK_PAUSE) EmergencyPause("Ctrl+Alt+End");
                if (id == HK_RESUME) EmergencyResume("Ctrl+Alt+Home");
                return;
            }
            base.WndProc(ref m);
        }

        // Silent agent: the window stays hidden until something asks for it (ShowMe). Checking only "handle not created
        // yet" was not enough: the handle can be created earlier (hotkeys, BeginInvoke threads), and then Application.Run
        // showed the full window a few seconds after a "--hub" start (seen Nov 4).
        bool allowShow;
        protected override void SetVisibleCore(bool value)
        {
            if (startHidden && !allowShow) { if (!IsHandleCreated) CreateHandle(); value = false; }
            base.SetVisibleCore(value);
        }

        void ShowMe() { allowShow = true; Show(); if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Activate(); BringToFront(); }

        public void QuitApp()
        {
            quitting = true;
            lim.Release();
            if (tray != null) tray.Visible = false;
            Application.Exit();
        }

        public void ReleaseLimits() { try { lim.Release(); } catch { } }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!quitting && st.Tray && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true; Hide();   // --window debug: keeps running, silently
                return;
            }
            quitting = true; lim.Release(); if (tray != null) tray.Visible = false;
            base.OnFormClosing(e);
        }

        // --snap <png> <seconds>: save a picture of the window and quit (used for testing)
        public void SnapAfter(string png, int sec)
        {
            var tm = new System.Windows.Forms.Timer { Interval = sec * 1000 };
            bool restored = false;
            tm.Tick += (s, e) =>
            {
                tm.Stop();
                // a window that was started minimized prints as a bare title bar: restore it first
                if (!restored && WindowState == FormWindowState.Minimized) { restored = true; WindowState = FormWindowState.Normal; tm.Interval = 600; tm.Start(); return; }
                try
                {
                    using (var bmp = new Bitmap(Width, Height))
                    {
                        using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); N.PrintWindow(Handle, dc, 2); g.ReleaseHdc(dc); }
                        bmp.Save(png, System.Drawing.Imaging.ImageFormat.Png);
                    }
                }
                catch (Exception ex) { Settings.Append("error.log", "snap: " + ex); }
                QuitApp();
            };
            tm.Start();
        }

        void Loop()
        {
            while (!quitting)
            {
                try
                {
                    var s = col.Collect(st);
                    if (quitting) break;
                    lim.Update(s.Jobs, s.CapNow, st.LowPrio, st.SlowCapPct);
                    latest = s;
                    StateFile.Write(statePath, StateFile.Json(s, st, hotkeysOk, AvailMB()));
                    BeginInvoke((Action<Snapshot>)Apply, s);
                }
                catch (Exception ex) { Settings.Append("error.log", "loop: " + ex.Message); }
                loopWake.WaitOne(2000);
            }
        }

        static string Dur(double sec)
        {
            if (sec < 0) return "—";
            var t = TimeSpan.FromSeconds(sec);
            if (t.TotalHours >= 1) return (int)t.TotalHours + " h " + t.Minutes + " min";
            if (t.TotalMinutes >= 1) return t.Minutes + " min " + t.Seconds.ToString("00") + " s";
            return t.Seconds + " s";
        }

        static Color Heat(double pct) { return pct >= 85 ? Th.Red : pct >= 60 ? Th.Accent : Th.Green; }

        void Apply(Snapshot s)
        {
            lastSnap = s;
            tCpu.Set(s.Cpu.ToString("0") + "%", Environment.ProcessorCount + " cores", s.Cpu / 100, Heat(s.Cpu));
            tGpu.Set(s.Gpu < 0 ? "?" : s.Gpu.ToString("0") + "%", "cannot be capped", s.Gpu < 0 ? -1 : s.Gpu / 100, Heat(Math.Max(0, s.Gpu)));
            double ramPct = s.RamTotalGB > 0 ? 100 * s.RamUsedGB / s.RamTotalGB : 0;
            tRam.Set(s.RamUsedGB.ToString("0.0", CultureInfo.InvariantCulture) + " GB", "/ " + s.RamTotalGB.ToString("0") + " GB", s.RamTotalGB > 0 ? s.RamUsedGB / s.RamTotalGB : -1, Heat(ramPct));
            double renderCpu = s.Jobs.Sum(j => j.Cpu);
            tJobs.Set(s.Jobs.Count == 0 ? "none" : s.Jobs.Count.ToString(), s.Jobs.Count == 0 ? "" : "CPU " + renderCpu.ToString("0") + "%", s.Jobs.Count == 0 ? -1 : renderCpu / 100, Th.Accent);

            if (s.Active)
            {
                lblState.ForeColor = Th.Accent;
                lblState.Text = "●  You're using the PC  →  renders " + (s.CapNow >= 100 ? "unlimited" : "use at most " + s.CapNow + "% CPU");
            }
            else
            {
                lblState.ForeColor = Th.Green;
                lblState.Text = "●  You're idle (" + Dur(s.IdleSec) + ")  →  renders " + (s.CapNow >= 100 ? "at full speed" : "use at most " + s.CapNow + "% CPU");
            }
            int nPaused = s.Jobs.Count(j => j.Paused != null);
            int nSlow = s.Jobs.Count(j => j.Slow != null && j.Paused == null);
            if (nSlow > 0) { lblState.ForeColor = Th.Accent; lblState.Text += "      🐢 " + nSlow + " renders slowed (low RAM)"; }
            if (nPaused > 0) { lblState.ForeColor = Th.Red; lblState.Text += "      ⏸ " + nPaused + " renders paused"; }
            var warnJob = WarnJob(s, st, AvailMB());
            // the RAM warning matters most: it goes first so a long project name cannot push it out of view
            if (warnJob != null) { lblState.ForeColor = Th.Red; lblState.Text = "⚠  " + RamWarning(warnJob) + (hotkeysOk ? "  (emergency pause: Ctrl+Alt+End)" : "") + (nPaused > 0 ? "      ⏸ " + nPaused + " renders paused" : ""); }
            else if (hotkeysOk) lblState.Text += "      ·  emergency pause Ctrl+Alt+End, resume Ctrl+Alt+Home";

            var keep = new HashSet<string>();
            list.BeginUpdate();
            foreach (var j in s.Jobs)
            {
                string key = j.RootPid.ToString(); keep.Add(key);
                var it = list.Items[key];
                if (it == null)
                {
                    it = new ListViewItem(new string[Cols.Length]) { Name = key };
                    list.Items.Add(it);
                    Settings.History("STARTED   " + j.Session + "  [" + j.Project + "]  " + j.What + "  (pid " + j.RootPid + ")");
                }
                it.Tag = j;
                Set(it, 0, j.Session);
                Set(it, 1, j.Project);
                Set(it, 2, j.What);
                Set(it, 3, j.Progress < 0 ? "" : (j.Progress * 100).ToString("0") + "%");
                Set(it, 4, j.Paused != null ? "paused" : j.Finished ? "finishing" : Dur(j.Eta));
                Set(it, 5, j.Cpu.ToString("0") + "%");
                Set(it, 6, j.Cap < 0 ? "—" : j.Cap + "%");
                Set(it, 7, s.Gpu < 0 ? "?" : j.Gpu.ToString("0") + "%");
                Set(it, 8, j.RamMB >= 1024 ? (j.RamMB / 1024.0).ToString("0.0", CultureInfo.InvariantCulture) + " GB" : j.RamMB + " MB");
                Set(it, 9, Dur((DateTime.Now - j.Start).TotalSeconds));
            }
            for (int i = list.Items.Count - 1; i >= 0; i--) if (!keep.Contains(list.Items[i].Name)) list.Items.RemoveAt(i);
            list.EndUpdate();
            list.Invalidate();

            var now = s.Jobs.ToDictionary(j => j.RootPid);
            foreach (var kv in lastJobs)
                if (!now.ContainsKey(kv.Key))
                {
                    var j = kv.Value; bool done = j.Finished || j.Progress >= 0.99;
                    Settings.History((done ? "FINISHED     " : "CLOSED   ") + j.Session + "  [" + j.Project + "]  " + j.What + "  " + Dur((DateTime.Now - j.Start).TotalSeconds) + (j.Progress >= 0 ? "  " + (j.Progress * 100).ToString("0") + "%" : ""));
                }
            lastJobs = now;

            if (tray != null)
            {
                string tt = s.Jobs.Count == 0 ? "VideoHub Agent — no renders" : "VideoHub Agent — " + s.Jobs.Count + " renders, limit " + s.CapNow + "%";
                tray.Text = tt.Length > 63 ? tt.Substring(0, 63) : tt;
            }
            UpdateDetail(); UpdateButtons();
        }

        static void Set(ListViewItem it, int i, string v) { if (it.SubItems[i].Text != v) it.SubItems[i].Text = v; }

        Job Selected() { return list.SelectedItems.Count > 0 ? list.SelectedItems[0].Tag as Job : (list.Items.Count == 1 ? list.Items[0].Tag as Job : null); }

        void UpdateDetail()
        {
            var j = Selected();
            string t;
            if (j == null) t = list.Items.Count == 0 ? "No renders right now. Renders started by a Claude session appear here." : "Select a row for details. Double-click to open the log.";
            else t = "Folder   " + (j.Cwd == "" ? "?" : j.Cwd) + "      process " + j.RootPid + " (+" + (j.Pids.Count - 1) + " child processes)\n" +
                     "Command  " + (j.Cmd.Length > 200 ? j.Cmd.Substring(0, 200) + "…" : j.Cmd) + "\n" +
                     "Latest   " + (j.LogPath == null ? "(no log — the render may not have been started in the background)" : j.LastLine);
            if (detail.Text != t) detail.Text = t;
        }

        void OpenLog()
        {
            var j = Selected();
            if (j != null && j.LogPath != null && File.Exists(j.LogPath)) Process.Start("notepad.exe", "\"" + j.LogPath + "\"");
        }

        void KillSelected()
        {
            var j = Selected(); if (j == null) return;   // --window debug only; VideoHub asks before it sends "kill"
            try
            {
                Process.Start(new ProcessStartInfo("taskkill", "/PID " + j.RootPid + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                Settings.History("STOPPED  " + j.Session + "  [" + j.Project + "]  " + j.What);
            }
            catch (Exception ex) { Settings.Append("error.log", "kill: " + ex.Message); }
        }

        // ---- owner drawing
        void DrawHeader(object sender, DrawListViewColumnHeaderEventArgs e)
        {
            var g = e.Graphics;
            using (var b = new SolidBrush(Th.Bg)) g.FillRectangle(b, e.Bounds);
            using (var p = new Pen(Th.Border)) g.DrawLine(p, e.Bounds.Left, e.Bounds.Bottom - 1, e.Bounds.Right, e.Bounds.Bottom - 1);
            var r = new Rectangle(e.Bounds.X + 10, e.Bounds.Y, e.Bounds.Width - 20, e.Bounds.Height);
            using (var f = new Font("Segoe UI Semibold", 8.5f))
                TextRenderer.DrawText(g, e.Header.Text.ToUpper(new System.Globalization.CultureInfo("en-US")), f, r, Th.Muted, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | (AlignR[e.ColumnIndex] ? TextFormatFlags.Right : TextFormatFlags.Left));
        }

        void DrawCell(object sender, DrawListViewSubItemEventArgs e)
        {
            var g = e.Graphics; var r = e.Bounds;
            var j = e.Item.Tag as Job;
            Color bg = e.Item.Selected ? Th.Sel : (e.ItemIndex % 2 == 0 ? Th.Row : Th.RowAlt);
            using (var b = new SolidBrush(bg)) g.FillRectangle(b, r);
            if (e.ColumnIndex == 0)
                using (var b = new SolidBrush(j != null && j.Session.StartsWith("(") ? Th.Muted : Th.Accent)) g.FillRectangle(b, r.X, r.Y + 6, 3, r.Height - 12);

            if (e.ColumnIndex == ColProgress)
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                var bar = new RectangleF(r.X + 10, r.Y + r.Height / 2f - 4, r.Width - 64, 8);
                if (j != null && j.Paused != null)
                {
                    TextRenderer.DrawText(g, "⏸  paused" + (j.Progress >= 0 ? "  ·  " + (j.Progress * 100).ToString("0") + "%" : ""), list.Font, new Rectangle(r.X + 10, r.Y, r.Width - 10, r.Height), Th.Red, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                    return;
                }
                if (j != null && j.Slow != null)
                {
                    string why = j.Slow == Limiter.Queue ? "queued: not enough RAM" : j.Slow == "manual" ? "manual" : "low RAM";
                    TextRenderer.DrawText(g, "🐢  slow (" + why + ")" + (j.Progress >= 0 ? "  ·  " + (j.Progress * 100).ToString("0") + "%" : ""), list.Font, new Rectangle(r.X + 10, r.Y, r.Width - 10, r.Height), Th.Accent, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                    return;
                }
                if (j == null || j.Progress < 0)
                {
                    TextRenderer.DrawText(g, "unknown", list.Font, new Rectangle(r.X + 10, r.Y, r.Width - 10, r.Height), Th.Muted, TextFormatFlags.VerticalCenter);
                    return;
                }
                using (var p = Th.Round(bar, 4)) using (var b = new SolidBrush(Th.Track)) g.FillPath(b, p);
                float w = (float)(bar.Width * Math.Max(0, Math.Min(1, j.Progress)));
                if (w > 6) using (var p = Th.Round(new RectangleF(bar.X, bar.Y, w, bar.Height), 4)) using (var b = new SolidBrush(j.Finished ? Th.Green : Th.Accent)) g.FillPath(b, p);
                TextRenderer.DrawText(g, (j.Progress * 100).ToString("0") + "%", list.Font, new Rectangle((int)bar.Right + 6, r.Y, 48, r.Height), Th.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
                return;
            }

            Color fg = Th.Text;
            if (e.ColumnIndex == 1 || e.ColumnIndex == 2 || e.ColumnIndex == 9) fg = Th.Muted;
            if (e.ColumnIndex == 6 && j != null && j.Cap > 0) fg = Th.Accent;
            var font = e.ColumnIndex == 0 ? new Font("Segoe UI Semibold", 9.5f) : list.Font;
            var tr = new Rectangle(r.X + (e.ColumnIndex == 0 ? 14 : 10), r.Y, r.Width - (e.ColumnIndex == 0 ? 20 : 18), r.Height);
            TextRenderer.DrawText(g, e.SubItem.Text, font, tr, fg, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | (AlignR[e.ColumnIndex] ? TextFormatFlags.Right : TextFormatFlags.Left));
            if (e.ColumnIndex == 0) font.Dispose();
        }

        // ---- start with Windows (HKCU Run)
        // "Start with Windows" starts VideoHub itself (open.vbs --server: the server, no window), never this exe;
        // the hub then keeps running and starts the agent. Test instances use their own value name.
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public static string RunName = "VideoHub";
        const string LegacyRunName = "RenderGuard";   // older builds started RenderGuard.exe --tray from here
        public static bool IsStartup()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(RunKey))
                    return k != null && (k.GetValue(RunName) != null || (RunName == "VideoHub" && k.GetValue(LegacyRunName) != null));
            }
            catch { return false; }
        }
        void SetStartup(bool on)
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    string wscript = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "wscript.exe");
                    if (on) k.SetValue(RunName, "\"" + wscript + "\" \"" + Path.Combine(HubFolder(st), "open.vbs") + "\" --server");
                    else k.DeleteValue(RunName, false);
                    if (RunName == "VideoHub") k.DeleteValue(LegacyRunName, false);
                }
            }
            catch (Exception ex) { Settings.Append("error.log", "startup: " + ex.Message); }
        }
    }

    static class Program
    {
        static MainForm form;

        // a render left frozen by an earlier Render Guard that crashed or was killed: thaw it
        static void ResumeOrphans()
        {
            try
            {
                using (var s = new ManagementObjectSearcher("SELECT ProcessId,Name,CommandLine FROM Win32_Process WHERE Name='chrome.exe' OR Name='ffmpeg.exe' OR Name='node.exe' OR Name='python.exe' OR Name='chrome-headless-shell.exe'"))
                    foreach (ManagementObject o in s.Get())
                    {
                        var p = new ProcInfo { Pid = Convert.ToInt32(o["ProcessId"]), Name = (string)o["Name"] ?? "", Cmd = (string)o["CommandLine"] ?? "" };
                        if (!Collector.IsRender(p)) continue;
                        try
                        {
                            var pr = Process.GetProcessById(p.Pid); bool all = pr.Threads.Count > 0;
                            foreach (ProcessThread t in pr.Threads)
                                if (!(t.ThreadState == System.Diagnostics.ThreadState.Wait && t.WaitReason == ThreadWaitReason.Suspended)) { all = false; break; }
                            if (all) { N.Suspend(p.Pid, false); Settings.History("FROZEN PROCESS RELEASED  pid " + p.Pid + "  " + p.Name); }
                        }
                        catch { }
                    }
            }
            catch { }
        }

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Contains("--quit"))   // ask the running instance to lift its caps and exit (used by build.ps1)
            {
                if (args.Contains("--only")) return;   // test quit must not signal resident guard
                EventWaitHandle q;
                if (EventWaitHandle.TryOpenExisting("Local\\RenderGuard_quit", out q)) { using (q) q.Set(); }
                return;
            }
            int oi = Array.IndexOf(args, "--only");
            string only = oi >= 0 && oi + 1 < args.Length ? args[oi + 1] : null;
            if (only != null)
            {
                // test runs log apart from the real guard, never touch the real Run entry, and may use their own
                // settings file (--settings) and a fake hub port (--hubport) so nothing of the real setup changes
                Settings.LogDir = Path.Combine(Settings.Dir, "test", Process.GetCurrentProcess().Id.ToString());
                int ti = Array.IndexOf(args, "--testdir");
                if (ti >= 0 && ti + 1 < args.Length) Settings.LogDir = Path.Combine(Path.GetFullPath(args[ti + 1]), Process.GetCurrentProcess().Id.ToString());
                Limiter.Trace = args.Contains("--trace");
                MainForm.RunName = "VideoHubTest";
                int fi = Array.IndexOf(args, "--settings"); if (fi >= 0 && fi + 1 < args.Length) Settings.FileOverride = Path.GetFullPath(args[fi + 1]);
            }
            int si = Array.IndexOf(args, "--snap");
            bool window = args.Contains("--window") || si >= 0;                  // debugging / --snap tests only
            bool agent = args.Contains("--agent") || args.Contains("--tray");    // --tray: what older hubs and Run entries pass
            // Not started by the hub (a double-click, an old "--hub" shortcut): we are not an app of our own. Open VideoHub
            // instead — it starts the agent itself when a window opens or a render runs — and leave.
            if (!agent && !window && only == null) { MainForm.OpenHubWindow(Settings.Load()); return; }

            bool created;
            // one agent per user (the same mutex name as the old RenderGuard.exe, so the two never run together);
            // test instances (--only) run beside the real one
            var mtx = new Mutex(true, only == null ? "Local\\RenderGuard_single" : "Local\\RenderGuard_test_" + Process.GetCurrentProcess().Id, out created);
            var showEvt = new EventWaitHandle(false, EventResetMode.AutoReset, only == null ? "Local\\RenderGuard_show" : "Local\\RenderGuard_tshow_" + Process.GetCurrentProcess().Id);
            if (!created)
            {
                if (window) showEvt.Set();   // a --window debug copy runs: bring its window back
                return;                      // the agent already runs: nothing to do
            }

            AppDomain.CurrentDomain.UnhandledException += (s, e) => { Settings.Append("error.log", "crash: " + e.ExceptionObject); if (form != null) form.ReleaseLimits(); };
            Application.ThreadException += (s, e) => { Settings.Append("error.log", "ui: " + e.Exception); };

            try { N.SetProcessDPIAware(); } catch { }
            if (only == null)
            {
                // stay responsive while the PC is starved: high priority, and our pages are never trimmed to the slow pagefile
                try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.High; } catch { }
                try { N.SetProcessWorkingSetSizeEx(N.GetCurrentProcess(), (IntPtr)(96L << 20), (IntPtr)(512L << 20), 0x1 | 0x8); } catch { }  // HARDWS_MIN_ENABLE | HARDWS_MAX_DISABLE
                ResumeOrphans();
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            int ri = Array.IndexOf(args, "--ramfile");   // test instances only: read "free RAM" from this file
            var sets = new List<string>();   // test instances only: --set Key=Value (settings for this run, never saved)
            for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "--set") sets.Add(args[i + 1]);
            // invisible: no window (unless --window / --snap), no tray icon, no notification
            form = new MainForm(!window, showEvt, only, false, ri >= 0 && ri + 1 < args.Length ? args[ri + 1] : null, sets, window);
            if (si >= 0 && si + 2 < args.Length) form.SnapAfter(args[si + 1], int.Parse(args[si + 2]));
            Application.Run(form);
            GC.KeepAlive(mtx);
        }
    }
}
