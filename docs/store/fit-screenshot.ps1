# 스토어 스크린샷을 1280×800 규격으로 맞춘다 (L21).
# 비율을 지킨 채 줄이거나 늘리고, 남는 칸은 #f2f4f6으로 채운다. 투명도 없는 24비트 PNG로 저장한다(스토어 규격).
# 쓰는 법(저장소 루트): powershell -File docs/store/fit-screenshot.ps1 -In <찍은 파일> -Out docs/store/screenshot-1.png
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1280,
  [int]$Height = 800,
  # 먼저 잘라 낼 영역(원본 픽셀). 넓은 창을 그대로 줄이면 글자가 작아진다 — 왼쪽 X부터 CropWidth만 남긴다.
  [int]$CropX = 0,
  [int]$CropWidth = 0,
  [int]$CropHeight = 0
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $In).Path)
try {
  if ($CropX -gt 0 -or $CropWidth -gt 0 -or $CropHeight -gt 0) {
    $cw = if ($CropWidth -gt 0) { [Math]::Min($CropWidth, $src.Width - $CropX) } else { $src.Width - $CropX }
    $ch = if ($CropHeight -gt 0) { [Math]::Min($CropHeight, $src.Height) } else { $src.Height }
    $cropped = New-Object System.Drawing.Bitmap $cw, $ch
    $cg = [System.Drawing.Graphics]::FromImage($cropped)
    $cg.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $cw, $ch), (New-Object System.Drawing.Rectangle $CropX, 0, $cw, $ch), [System.Drawing.GraphicsUnit]::Pixel)
    $cg.Dispose()
    $src.Dispose()
    $src = $cropped
  }
  $scale = [Math]::Min($Width / $src.Width, $Height / $src.Height)
  $w = [int][Math]::Round($src.Width * $scale)
  $h = [int][Math]::Round($src.Height * $scale)
  $dst = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#f2f4f6'))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, [int](($Width - $w) / 2), [int](($Height - $h) / 2), $w, $h)
  $g.Dispose()
  $outPath = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path (Get-Location).Path $Out }
  $dst.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose()
  "saved $outPath ($Width x $Height, scale $([Math]::Round($scale, 3)))"
} finally {
  $src.Dispose()
}
