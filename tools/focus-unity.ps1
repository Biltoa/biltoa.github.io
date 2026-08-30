# Brings the Unity editor's main window to the front.
#
# The tool screenshots are grabbed off the desktop, so anything sitting on top
# of Unity ends up in them - and a browser window showing this very portfolio is
# a particularly confusing thing to find in a screenshot of a Unity tool. Run
# this immediately before grabbing.

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Fg {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@

$proc = Get-Process -Name Unity -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1

if (-not $proc) {
    Write-Output 'unity-window-not-found'
    exit 1
}

# 9 is SW_RESTORE - a minimised editor cannot be captured at all.
[void][Fg]::ShowWindow($proc.MainWindowHandle, 9)
[void][Fg]::BringWindowToTop($proc.MainWindowHandle)
[void][Fg]::SetForegroundWindow($proc.MainWindowHandle)

Start-Sleep -Milliseconds 500
Write-Output ("focused {0}" -f $proc.MainWindowTitle)
