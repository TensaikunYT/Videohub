// Windows' own "Select folder" window (on a Mac: the standard folder dialog, see server/mac.js) (the Explorer-style one, IFileOpenDialog with FOS_PICKFOLDERS), opened by a hidden
// PowerShell on top of every window (an invisible topmost owner), so it never hides behind the VideoHub window. Returns
// the chosen folder or null (cancelled). Falls back to the old folder tree if the modern one cannot start.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickFolder as pickFolderMac } from './mac.js';

const CS = `
using System; using System.Runtime.InteropServices;
public static class VhPick {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogCo { }
  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem { void BindToHandler(); void GetParent(); void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name); void GetAttributes(); void Compare(); }
  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr owner);
    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex(); void Advise(); void Unadvise();
    void SetOptions(uint fos); void GetOptions(out uint fos); void SetDefaultFolder(IShellItem si); void SetFolder(IShellItem si);
    void GetFolder(); void GetCurrentSelection(); void SetFileName(); void GetFileName();
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel(); void GetResult(out IShellItem si);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IShellItem si);
  public static string Pick(IntPtr owner, string title, string start) {
    var d = (IFileOpenDialog)new FileOpenDialogCo();
    uint o; d.GetOptions(out o); d.SetOptions(o | 0x20 | 0x40 | 0x800);   // PICKFOLDERS | FORCEFILESYSTEM | PATHMUSTEXIST
    if (!string.IsNullOrEmpty(title)) d.SetTitle(title);
    d.SetOkButtonLabel("Choose this folder");
    if (!string.IsNullOrEmpty(start)) { try { IShellItem f; SHCreateItemFromParsingName(start, IntPtr.Zero, typeof(IShellItem).GUID, out f); d.SetFolder(f); } catch { } }
    if (d.Show(owner) != 0) return null;
    IShellItem r; d.GetResult(out r); string p; r.GetDisplayName(0x80058000, out p); return p;   // SIGDN_FILESYSPATH
  }
}`;

const q = (s) => "'" + String(s ?? '').replace(/'/g, "''") + "'";
export function pickFolder(start, title = 'Choose folder') {
  if (process.env.VIDEOHUB_NO_WINDOW) return Promise.resolve(null);
  if (process.platform === 'darwin') return pickFolderMac(start, title);   // the macOS "Choose" dialog (osascript)
  const ps = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    // an invisible topmost owner: the dialog comes up above every window, and in front
    "$f = New-Object Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; FormBorderStyle = 'None'; Opacity = 0; Width = 1; Height = 1; StartPosition = 'CenterScreen' }",
    '$f.Show(); $f.Activate()',
    `$start = ${q(start)}; if ($start -and -not (Test-Path -LiteralPath $start)) { $start = '' }`,
    'try {',
    `  Add-Type -TypeDefinition @'\n${CS}\n'@ -ErrorAction Stop`,
    `  $r = [VhPick]::Pick($f.Handle, ${q(title)}, $start)`,
    '} catch {',
    // the old folder tree, if the modern window cannot start on this PC
    `  $d = New-Object Windows.Forms.FolderBrowserDialog; $d.Description = ${q(title)}; $d.ShowNewFolderButton = $true; if ($start) { $d.SelectedPath = $start }`,
    "  $r = if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath } else { $null }",
    '}',
    '$f.Close()',
    'if ($r) { $r }',
  ].join('\n');
  // a script file (UTF-8 with BOM: Windows PowerShell reads Turkish text right only then), removed afterwards
  const file = path.join(os.tmpdir(), `vh-pick-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(file, '﻿' + ps, 'utf8');
  return new Promise((res) => {
    const done = (v) => { try { fs.unlinkSync(file); } catch { } res(v); };
    const c = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    let o = ''; c.stdout.on('data', (b) => { o += b; }); c.on('close', () => done(o.trim().split(/\r?\n/).pop() || null)); c.on('error', () => done(null));
  });
}
