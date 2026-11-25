Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
RootDir = fso.GetParentFolderName(ScriptDir)
WshShell.CurrentDirectory = RootDir

' Launch tray_worker.py using pythonw.exe completely hidden (0 = hidden window)
PywPath = "C:\Users\m_hit\AppData\Local\Programs\Python\Python312\pythonw.exe"
If fso.FileExists(PywPath) Then
    WshShell.Run """" & PywPath & """ agent_worker\tray_worker.py", 0, False
Else
    WshShell.Run "pythonw.exe agent_worker\tray_worker.py", 0, False
End If
