' ─────────────────────────────────────────────────────────────
'  dataB Flow — Lanzador silencioso para Windows
'  (Sin ventana de terminal negra)
' ─────────────────────────────────────────────────────────────

Dim WshShell, fso, projectDir, nodeExe, port, url

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

port = "3000"
url  = "http://localhost:" & port

' Directorio del proyecto = carpeta padre de "tools"
Dim scriptPath
scriptPath = WScript.ScriptFullName
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(scriptPath))

' ── Buscar node.exe ──────────────────────────────────────────
Dim nodePaths(5)
nodePaths(0) = WshShell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
nodePaths(1) = WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe")
nodePaths(2) = WshShell.ExpandEnvironmentStrings("%APPDATA%\nvm\current\node.exe")
nodePaths(3) = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\nodejs\node.exe")
nodePaths(4) = ""  ' buscar en PATH via 'where node'
nodePaths(5) = ""

nodeExe = ""
Dim i
For i = 0 To 3
  If fso.FileExists(nodePaths(i)) Then
    nodeExe = nodePaths(i)
    Exit For
  End If
Next

' Intentar con PATH si no encontramos en ubicaciones fijas
If nodeExe = "" Then
  Dim oExec
  Set oExec = WshShell.Exec("where node")
  Dim result
  result = ""
  Do While Not oExec.StdOut.AtEndOfStream
    result = oExec.StdOut.ReadLine()
    If result <> "" Then Exit Do
  Loop
  If fso.FileExists(result) Then nodeExe = result
End If

If nodeExe = "" Then
  MsgBox "No se encontro Node.js." & vbCrLf & vbCrLf & _
         "Instala Node.js desde https://nodejs.org", _
         vbCritical + vbOKOnly, "dataB Flow"
  WScript.Quit 1
End If

' ── Verificar si el servidor ya está corriendo ────────────────
Dim oCheck
Set oCheck = WshShell.Exec("cmd /c netstat -ano | findstr :" & port & ".*LISTENING")
WScript.Sleep 500
Dim isRunning
isRunning = False
Do While Not oCheck.StdOut.AtEndOfStream
  Dim line
  line = oCheck.StdOut.ReadLine()
  If InStr(line, "LISTENING") > 0 Then
    isRunning = True
    Exit Do
  End If
Loop

' ── Arrancar servidor si no está corriendo ────────────────────
If Not isRunning Then
  Dim cmd
  cmd = "cmd /c cd /d """ & projectDir & """ && """ & nodeExe & """ server.js >> server.log 2>&1"
  WshShell.Run cmd, 0, False   ' 0 = ventana oculta, False = no esperar

  ' Esperar hasta 8 segundos a que el puerto esté activo
  Dim attempts
  attempts = 0
  Do While attempts < 16
    WScript.Sleep 500
    Set oCheck = WshShell.Exec("cmd /c netstat -ano | findstr :" & port & ".*LISTENING")
    WScript.Sleep 300
    Dim ready
    ready = False
    Do While Not oCheck.StdOut.AtEndOfStream
      If InStr(oCheck.StdOut.ReadLine(), "LISTENING") > 0 Then
        ready = True
        Exit Do
      End If
    Loop
    If ready Then Exit Do
    attempts = attempts + 1
  Loop

  If attempts >= 16 Then
    MsgBox "El servidor no arranco. Revisa server.log en el directorio del proyecto.", _
           vbCritical + vbOKOnly, "dataB Flow"
    WScript.Quit 1
  End If
End If

' ── Abrir browser ─────────────────────────────────────────────
WshShell.Run url
