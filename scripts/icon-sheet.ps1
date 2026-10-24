# Build a legibility sheet for raster logo candidates: each input at 256 px, then 32 and 16 px
# on a dark (#1b1b1f) and a light (#f0f0f0) strip, with the 16 px version also shown 4x (nearest neighbour).
# usage: powershell -File scripts/icon-sheet.ps1 -Out sheet.png in1.png in2.png ...
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Inputs
)
Add-Type -AssemblyName System.Drawing

function Resize([System.Drawing.Image]$img, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

$col = 300
$W = $col * $Inputs.Count
$H = 300 + 90 + 90
$sheet = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::FromArgb(0x2a, 0x2a, 0x30))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0x1b, 0x1b, 0x1f))
$light = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0xf0, 0xf0, 0xf0))

for ($i = 0; $i -lt $Inputs.Count; $i++) {
  $src = [System.Drawing.Image]::FromFile((Resolve-Path $Inputs[$i]))
  $x = $i * $col + 22
  $big = Resize $src 256
  $g.DrawImage($big, $x, 22, 256, 256)
  $s32 = Resize $src 32
  $s16 = Resize $src 16
  foreach ($row in @(@{ y = 300; brush = $dark }, @{ y = 390; brush = $light })) {
    $g.FillRectangle($row.brush, $x, $row.y, 256, 80)
    $g.DrawImage($s32, $x + 16, $row.y + 24, 32, 32)
    $g.DrawImage($s16, $x + 70, $row.y + 32, 16, 16)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($s16, $x + 120, $row.y + 8, 64, 64)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  }
  $src.Dispose()
}
$g.Dispose()
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"wrote $Out"
