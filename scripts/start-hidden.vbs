' Starts cedarstalk with no console window -- what the Desktop shortcut runs.
' Its output goes to data\server.log. If it's already running, the engine just
' opens a window in the running copy and exits.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
app = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
bun = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.bun\bin\bun.exe"
If Not fso.FileExists(bun) Then bun = "bun"
If Not fso.FolderExists(app & "\data") Then fso.CreateFolder(app & "\data")
shell.CurrentDirectory = app
shell.Environment("PROCESS")("CEDARSTALK_OPEN") = "1"
q = Chr(34)
shell.Run "cmd /c " & q & q & bun & q & " run src\index.ts >> data\server.log 2>&1" & q, 0, False
