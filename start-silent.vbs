Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\dwich-printer"
WshShell.Run "cmd /c node server.js", 0, False
WScript.Sleep 2000
WshShell.Run "cmd /c cloudflared tunnel run dwich-printer", 0, False
