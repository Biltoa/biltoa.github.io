# Captures the primary display to a PNG.
#
# The Unity editor windows the portfolio screenshots come from are native
# windows, so nothing inside Unity can capture them - only the desktop can.
# Usage: powershell -File tools/grab-screen.ps1 -Out path\to\shot.png
param(
    [Parameter(Mandatory = $true)][string]$Out
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bmp.Size)

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()

Write-Output ("{0} {1}x{2}" -f $Out, $screen.Width, $screen.Height)
