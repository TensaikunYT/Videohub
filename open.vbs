' Opens VideoHub without any console window (the Desktop shortcut runs this).
' "--server": only start the VideoHub server, no window (the Windows start-up entry runs this at log-in).
' Render protection runs inside the VideoHub server.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "--server" Then extra = " -ServerOnly"
End If
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & here & "\open.ps1""" & extra, 0, False
