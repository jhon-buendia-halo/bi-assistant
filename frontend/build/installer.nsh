; Custom NSIS hooks, included automatically by electron-builder from build
; resources (delivery.md section 2 "Windows", roadmap 1.7.21).

; Defining customCheckAppRunning makes electron-builder skip these two, but its
; _CHECK_APP_RUNNING (reused below) needs them.
!include "getProcessInfo.nsh"
Var pid

; Runs in the installer (before the previous version is uninstalled) and in
; the uninstaller. electron-builder's usual check goes first: it asks the user
; to close a running app and ends processes inside the install folder. Then
; every "Halo BI Assistant.exe" this user still runs is force-ended with its
; children, so a backend orphaned by a crashed window (same executable, no
; window to close) can't keep files locked or the port taken.
!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  nsExec::Exec `"$CmdPath" /C taskkill /F /T /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  ; Exit code 128 just means nothing was left to end.
  Sleep 500
!macroend
