using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using RenderGuard;
class Tests {
 static int fail;
 static void Check(string name,bool ok) { Console.WriteLine((ok?"PASS ":"FAIL ")+name); if(!ok)fail++; }
 static Job J(Process p,int age) { return new Job { RootPid=p.Id, Pids=new List<int>{p.Id}, Start=DateTime.Now.AddSeconds(-age) }; }
 static uint Rate(IntPtr h) { IntPtr b=Marshal.AllocHGlobal(8); try { if(!N.QueryJobRaw(h,15,b,8,IntPtr.Zero))return uint.MaxValue; return (uint)Marshal.ReadInt32(b); }finally{Marshal.FreeHGlobal(b);} }
 [DllImport("kernel32.dll")] static extern bool GetProcessInformation(IntPtr h,int cls,out uint v,int n);
 static uint Mem(Process p) { IntPtr h=N.OpenProcess(0x1000,false,p.Id); try { uint v; return GetProcessInformation(h,0,out v,4)?v:999; }finally{N.CloseHandle(h);} }
 static int Main() {
  Check("node snapshot flag is not a render", !Collector.IsRender(new ProcInfo { Name="node.exe", Cmd="node --node-snapshot --heapsnapshot-near-heap-limit=0 server\\thumbstudio\\gen.test.js" }));
  Check("profiling flags do not turn server into render", !Collector.IsRenderScript("node --trace-event-file-pattern=node_trace.log --node-snapshot server.js --frames=60"));
  Check("test runner is not render", !Collector.IsRenderScript("node --test render.test.js"));
  Check("test worker is not render", !Collector.IsRenderScript("node --node-snapshot tests/render-worker.js"));
  Check("node render entry point detected", Collector.IsRenderScript("node --node-snapshot render.js --frames=60"));
  Check("quoted render entry point detected", Collector.IsRenderScript("\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\my film\\render.js\""));
  Check("preload is not the entry point", Collector.IsRenderScript("node --require preload.js render.js"));
  Check("render word in server arguments ignored", !Collector.IsRenderScript("node server.js render.js"));
  Check("python render detected", Collector.IsRenderScript("python -u anim_render.py"));
  Check("python module render detected", Collector.IsRenderScript("python -m video.render"));
  Check("studio render coordinator detected", Collector.IsRenderScript("node make.mjs film --chunks --jobs 1"));
  Check("studio mux coordinator detected", Collector.IsRenderScript("node make.mjs film --mux in.mp4 out.mp4"));
  Check("unrelated make script is not render", !Collector.IsRenderScript("node make.mjs build"));
  string ownHub=Collector.OwnHubServer; Collector.OwnHubServer=@"C:\x\VideoHub-main\server\";
  Check("hub under any install folder name is the hub", Collector.IsHub(new ProcInfo { Name="node.exe", Cmd="node \"C:/x/VideoHub-main/server/mcp.js\"" }));
  Check("old VideoHub folder name still the hub", Collector.IsHub(new ProcInfo { Name="node.exe", Cmd="node C:\\y\\VideoHub\\server\\cli.js hub_live" }));
  Check("film in Documents\\VideoHub\\films is not the hub", !Collector.IsHub(new ProcInfo { Name="node.exe", Cmd="node C:\\u\\Documents\\VideoHub\\films\\a\\render.js 2" }));
  Check("sibling folder is not the hub", !Collector.IsHub(new ProcInfo { Name="node.exe", Cmd="node C:\\x\\VideoHub-main2\\server\\mcp.js" }));
  Collector.OwnHubServer=ownHub;
  Check("metadata probes are not standalone renders", !Collector.IsRender(new ProcInfo { Name="ffprobe.exe", Cmd="ffprobe film.mp4" }));
  Settings.LogDir=Path.Combine(Environment.CurrentDirectory,"logs"); Settings.FileOverride=Path.Combine(Environment.CurrentDirectory,"test-settings.txt");
  File.WriteAllText(Settings.FilePath,"CapActive=91\nPauseMB=700\nSlowCapPct=5\n"); Settings st;
  Check("valid settings",Settings.TryLoad(out st)&&st.CapActive==91);
  File.WriteAllText(Settings.FilePath,"CapActive=0\n"); Check("out-of-range rejected",!Settings.TryLoad(out st));
  File.WriteAllText(Settings.FilePath,"CapActive=90\nPauseMB=oops\n"); Check("malformed snapshot rejected",!Settings.TryLoad(out st));
  File.WriteAllText(Settings.FilePath,""); Check("empty snapshot rejected",!Settings.TryLoad(out st));
  using(var a=Process.Start(new ProcessStartInfo("node.exe","-e \"setInterval(()=>{},1000)\""){UseShellExecute=false,CreateNoWindow=true}))
  using(var b=Process.Start(new ProcessStartInfo("node.exe","-e \"setInterval(()=>{},1000)\""){UseShellExecute=false,CreateNoWindow=true})) {
   var lim=new Limiter(); var jobs=new List<Job>{J(a,120),J(b,10)};
   try {
    lim.Update(jobs,90,true,5); Check("low memory priority applied",Mem(a)==2);
    lim.Update(jobs,90,false,5); Check("live LowPrio=false restores memory priority",Mem(a)==5);
    string why; Check("newest slowed",lim.SlowForRam(false,out why)==b.Id);
    lim.Normal(b.Id); Check("oldest preserved when young newest ineligible",lim.SlowForRam(false,out why)==0);
    lim.Slow(b.Id,"RAM"); lim.Pause(b.Id,"manual");
    Check("auto-normal skips manually paused render",lim.NormalForRam(false)==0);
    lim.Resume(b.Id);
    lim.Release();
    lim.Update(jobs,5,true,1);
    Check("late Update cannot recreate caps",lim.Slow(a.Id,"manual")==false&&lim.Pause(a.Id,"manual")==false);
    Check("exit restores memory priority",Mem(a)==5&&Mem(b)==5);
    // A failed SetInformationJobObject must leave cached Cap unchanged, then succeed on retry.
    var unitType=typeof(Limiter).GetNestedType("Unit",BindingFlags.NonPublic);
    object u=Activator.CreateInstance(unitType,true); var cap=unitType.GetField("Cap"); var handle=unitType.GetField("H");
    var set=typeof(Limiter).GetMethod("SetCap",BindingFlags.Static|BindingFlags.NonPublic);
    set.Invoke(null,new object[]{u,5}); Check("failed cap not cached", (int)cap.GetValue(u)==-1);
    IntPtr h=N.CreateJobObject(IntPtr.Zero,null);
    try { handle.SetValue(u,h); set.Invoke(null,new object[]{u,5}); Check("failed cap retried and applied", (int)cap.GetValue(u)==5&&Rate(h)==5); }
    finally{N.CloseHandle(h);}
   }finally{lim.Release(); a.Kill(); b.Kill();}
  }
  using(var c=Process.Start(new ProcessStartInfo("node.exe","-e \"setInterval(()=>{},1000)\""){UseShellExecute=false,CreateNoWindow=true})) {
   var j=J(c,80); j.Start=c.StartTime; var js=new List<Job>{j};
   var old=new Limiter(); old.Update(js,5,false,5);
   var f=typeof(Limiter).GetField("units",BindingFlags.Instance|BindingFlags.NonPublic);
   var list=(System.Collections.IList)f.GetValue(old);
   Check("named cap job created",list.Count>0);
   foreach(object unit in list) N.CloseHandle((IntPtr)unit.GetType().GetField("H").GetValue(unit));
   list.Clear(); // simulate guard termination without Release
   var recovered=new Limiter();
   try {
    recovered.Update(js,100,false,5);
    var recoveredUnits=(System.Collections.IList)f.GetValue(recovered);
    Check("orphaned cap job recovered",recoveredUnits.Count>0 && recoveredUnits.Cast<object>().All(u=>Rate((IntPtr)u.GetType().GetField("H").GetValue(u))==0));
   } finally { recovered.Release(); c.Kill(); }
  }
  string path=Path.Combine(Environment.CurrentDirectory,"atomic-state.json");
  StateFile.Write(path,"{\"n\":1}"); StateFile.Write(path,"{\"n\":2}");
  Check("atomic state replacement",File.ReadAllText(path)=="{\"n\":2}");
  Console.WriteLine("Failures: "+fail); return fail;
 }
}
