Add-Type -AssemblyName System.Drawing

function New-KebabIcon([string]$out, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $amber = [System.Drawing.Color]::FromArgb(232, 160, 32)
  $r = [int]($size * 0.24)
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $gp.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $gp.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
  $gp.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
  $gp.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush($amber)), $gp)
  $font = New-Object System.Drawing.Font('Segoe UI', ($size * 0.52), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, ($size * 0.03), $size, $size)
  $g.DrawString('K', $font, [System.Drawing.Brushes]::Black, $rect, $sf)
  $g.Dispose()
  if ($out.EndsWith('.ico')) {
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $fs = [System.IO.File]::OpenWrite($out)
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
  } else {
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $bmp.Dispose()
  Write-Host "wrote $out"
}

New-KebabIcon 'renderer\assets\tray.png' 32
New-KebabIcon 'renderer\assets\icon-256.png' 256
