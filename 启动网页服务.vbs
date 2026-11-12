' 竞足预测汇总 - 静默启动本地服务（无黑窗）
' 用法：双击即可；开机自启把本文件的快捷方式放进 shell:startup
' 说明：自动定位 node.exe 与 server.js，不依赖固定盘符路径
Option Explicit

Dim fso, ws, here, srv, nodeExe, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set ws = CreateObject("WScript.Shell")

' 脚本所在目录（去掉末尾反斜杠）
here = fso.GetParentFolderName(WScript.ScriptFullName)
srv = fso.BuildPath(here, "server.js")

If Not fso.FileExists(srv) Then
  MsgBox "找不到 server.js：" & vbCrLf & srv, 16, "启动失败"
  WScript.Quit 1
End If

' 找 node.exe：优先 PATH，其次常见安装位置
nodeExe = FindNode(ws, fso)
If nodeExe = "" Then
  MsgBox "未找到 node.exe，请先安装 Node.js 18+ 并加入 PATH。" & vbCrLf & _
         "下载：https://nodejs.org/", 16, "启动失败"
  WScript.Quit 1
End If

cmd = """" & nodeExe & """ """ & srv & """"
' 0 = 隐藏窗口, False = 不等待
ws.CurrentDirectory = here
ws.Run cmd, 0, False

Function FindNode(ws, fso)
  Dim p, cand, i
  ' 1) PATH 里找
  On Error Resume Next
  p = ws.ExpandEnvironmentStrings("%PATH%")
  If Err.Number = 0 Then
    For Each cand In Split(p, ";")
      If Len(cand) > 0 Then
        If fso.FileExists(fso.BuildPath(cand, "node.exe")) Then
          FindNode = fso.BuildPath(cand, "node.exe")
          Exit Function
        End If
      End If
    Next
  End If
  Err.Clear
  On Error GoTo 0

  ' 2) 常见安装位置
  Dim roots, subs
  roots = Array( _
    ws.ExpandEnvironmentStrings("%ProgramFiles%"), _
    ws.ExpandEnvironmentStrings("%ProgramFiles(x86)%"), _
    ws.ExpandEnvironmentStrings("%LOCALAPPDATA%"), _
    "D:\nodejs", "C:\nodejs", "D:\Program Files\nodejs" _
  )
  For i = 0 To UBound(roots)
    cand = fso.BuildPath(roots(i), "node.exe")
    If fso.FileExists(cand) Then
      FindNode = cand
      Exit Function
    End If
  Next

  FindNode = ""
End Function
