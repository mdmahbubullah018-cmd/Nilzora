# Builds the app icons and splash art from the official Nilzora artwork.
#
# Every output is the supplied artwork itself: scaled proportionally (never stretched),
# centred on a canvas, and never recoloured except for the two Android monochrome
# silhouettes, which the platform requires to be a single alpha shape.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = 'D:\Nilzora'
$brand = Join-Path $root 'assets\brand'
$mobileApp = Join-Path $root 'apps\mobile\assets\app'
$mobileBrand = Join-Path $root 'apps\mobile\assets\brand'
$storefrontBrand = Join-Path $root 'apps\storefront\public\brand'
$adminBrand = Join-Path $root 'apps\admin\public\brand'
$storefrontApp = Join-Path $root 'apps\storefront\src\app'
$adminApp = Join-Path $root 'apps\admin\src\app'

foreach ($dir in @($mobileBrand, $adminBrand)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# Drops ink that has no company: a pixel survives only when at least two of its eight
# neighbours carry ink too.
#
# The supplied mark has a soft glow and a faint light rim around its square. Thresholding keeps
# the letterform and its dot, and can leave a one-or-two-pixel fleck behind - visible as a speck
# on a 1024px tile, and unacceptable in launcher artwork. This removes those flecks and cannot
# thin the letterform, whose every edge pixel has neighbours along the edge.
function Remove-IsolatedInk {
  param([System.Drawing.Bitmap] $Bitmap)
  $width = $Bitmap.Width
  $height = $Bitmap.Height
  $mask = New-Object bool[] ($width * $height)
  for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
      $mask[($y * $width) + $x] = $Bitmap.GetPixel($x, $y).A -gt 0
    }
  }
  $removed = 0
  for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
      if (-not $mask[($y * $width) + $x]) { continue }
      $neighbours = 0
      for ($dy = -1; $dy -le 1; $dy++) {
        for ($dx = -1; $dx -le 1; $dx++) {
          if ($dx -eq 0 -and $dy -eq 0) { continue }
          $nx = $x + $dx; $ny = $y + $dy
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $width -or $ny -ge $height) { continue }
          if ($mask[($ny * $width) + $nx]) { $neighbours++ }
        }
      }
      if ($neighbours -lt 2) {
        $Bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        $removed++
      }
    }
  }
  if ($removed -gt 0) { Write-Output ("         cleared {0} isolated pixels" -f $removed) }
}

function Get-ContentBox {
  param([System.Drawing.Bitmap] $Bitmap)
  $minX = $Bitmap.Width; $minY = $Bitmap.Height; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      if ($Bitmap.GetPixel($x, $y).A -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  return [System.Drawing.Rectangle]::new($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
}

function Save-Trimmed {
  param([string] $Source, [string] $Target)
  $image = [System.Drawing.Bitmap]::FromFile($Source)
  try {
    $box = Get-ContentBox $image
    $trimmed = New-Object System.Drawing.Bitmap $box.Width, $box.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($trimmed)
    try {
      $graphics.DrawImage($image, [System.Drawing.Rectangle]::new(0, 0, $box.Width, $box.Height), $box, [System.Drawing.GraphicsUnit]::Pixel)
    } finally { $graphics.Dispose() }
    $trimmed.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output ("trimmed  {0} -> {1}x{2}" -f (Split-Path $Target -Leaf), $box.Width, $box.Height)
    $trimmed.Dispose()
  } finally { $image.Dispose() }
}

# A single-colour silhouette: the letterform's shape on transparency, taken from the official
# navy mark by keeping everything that is not the navy fill colour (the sky letterform and the
# off-white dot). Colouring it white is what Android's monochrome and notification icons need.
function Save-Silhouette {
  param([string] $Source, [string] $Target, [int] $Canvas, [double] $Fill = 0.6)
  $image = [System.Drawing.Bitmap]::FromFile($Source)
  try {
    $box = Get-ContentBox $image
    $bodyColor = $image.GetPixel(($box.X + 4), ($box.Y + [int]($box.Height / 2)))
    if ($bodyColor.A -lt 200) { throw "the fill sample at the mark's left edge is transparent" }
    $bitmap = New-Object System.Drawing.Bitmap $box.Width, $box.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $ink = 0
    for ($y = 0; $y -lt $box.Height; $y++) {
      for ($x = 0; $x -lt $box.Width; $x++) {
        $pixel = $image.GetPixel(($box.X + $x), ($box.Y + $y))
        # The artwork carries a soft cyan glow just outside the mark and a rounded-square body in
        # the fill colour. Only near-opaque pixels can be the letterform, so the glow (which is
        # 6-15% opaque) and the body are both excluded.
        if ($pixel.A -lt 160) {
          $bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
          continue
        }
        # Only the letterform and its dot are ink. The mark's rounded square is the fill colour,
        # and its faint light rim sits well below this threshold, so neither becomes a shape.
        $distance = [Math]::Max(
          [Math]::Abs($pixel.R - $bodyColor.R),
          [Math]::Max([Math]::Abs($pixel.G - $bodyColor.G), [Math]::Abs($pixel.B - $bodyColor.B))
        )
        $alpha = [int][Math]::Round(
          255 * [Math]::Max(0, [Math]::Min(1, ($distance - 130) / 70.0)) * ($pixel.A / 255.0)
        )
        # The mark's soft grey shadow beside the dot is shading, not the logo: a low-saturation
        # pixel that is not bright cannot be the dot or the letterform.
        $spread = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) - [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))
        $brightness = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
        if ($spread -lt 24 -and $brightness -lt 225) { $bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
        if ($alpha -lt 128) { $bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
        $ink++
        $bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, 255, 255, 255))
      }
    }
    if ($ink -lt 100) { throw "the silhouette came out empty; the mark's colours were not recognised" }
    Remove-IsolatedInk -Bitmap $bitmap
    $inkBox = Get-ContentBox $bitmap
    Write-Output ("         ink box {0}x{1} of {2}x{3}" -f $inkBox.Width, $inkBox.Height, $box.Width, $box.Height)
    $scaled = New-Object System.Drawing.Bitmap $Canvas, $Canvas, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($scaled)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      # The same share of the canvas the coloured foreground uses, so the themed icon keeps the
      # adaptive-icon safe zone instead of growing into the mask.
      $scale = $Canvas * $Fill / [Math]::Max($inkBox.Width, $inkBox.Height)
      $width = [int][Math]::Round($inkBox.Width * $scale)
      $height = [int][Math]::Round($inkBox.Height * $scale)
      $graphics.DrawImage(
        $bitmap,
        [System.Drawing.Rectangle]::new([int](($Canvas - $width) / 2), [int](($Canvas - $height) / 2), $width, $height),
        $inkBox,
        [System.Drawing.GraphicsUnit]::Pixel
      )
    } finally { $graphics.Dispose() }
    $scaled.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output ("silhouette {0} -> {1}x{1} from {2} ink pixels" -f (Split-Path $Target -Leaf), $Canvas, $ink)
    $bitmap.Dispose(); $scaled.Dispose()
  } finally { $image.Dispose() }
}

# 1. The web copies: byte-identical trimmed artwork in every app that serves them.
foreach ($name in @('nilzora-logo-on-light.png', 'nilzora-logo-on-dark.png', 'nilzora-mark-navy.png', 'nilzora-mark-sky.png')) {
  $from = Join-Path $storefrontBrand $name
  Copy-Item $from (Join-Path $adminBrand $name) -Force
  Copy-Item $from (Join-Path $mobileBrand $name) -Force
  Write-Output "copied   $name -> admin/public/brand, mobile/assets/brand"
}

# 2. Browser icons: the supplied files, unchanged, under Next's file conventions.
foreach ($pair in @(@('favicon-1.ico', 'favicon.ico'), @('apple-touch-icon.png', 'apple-icon.png'))) {
  Copy-Item (Join-Path $brand $pair[0]) (Join-Path $adminApp $pair[1]) -Force
  Copy-Item (Join-Path $brand $pair[0]) (Join-Path $storefrontApp $pair[1]) -Force
}
Write-Output 'copied   favicon and apple touch icon into both apps'

# The launcher art is the letterform, never the mark's rounded square.
#
# The supplied mark is the sky "N", its off-white dot, and a navy rounded square around them.
# Painting that square again on a navy canvas (what this script used to do for icon.png) leaves
# a visible edge and light rim inside the launcher tile, and on Android the square then competes
# with the mask the launcher itself applies. So both launcher layers come from the same pixels:
#
#   * ink  - every pixel of the mark that is not the navy body, keeping its own cyan/off-white
#            colour and its anti-aliased edge, on transparency;
#   * tile - that same ink over the brand navy, flattened to RGB for iOS and the legacy icon.
#
# Nothing is redrawn, resized non-proportionally or recoloured.
#
# Sizing follows the supplied art instead of eyeballing it: in 3-app-icon-navy the letterform
# covers 0.615 of the rounded square's height. The square is what the launcher mask replaces, so
# 0.615 of the 72dp visible viewport - 0.41 of the 108dp adaptive canvas - keeps the mark the
# same size Apple and the official tile show, and leaves every mask (circle included) a margin.
function Save-MarkInk {
  param(
    [string] $Source,
    [string] $Target,
    [int] $Canvas = 1024,
    # Share of the canvas the letterform's longer side covers.
    [double] $Fill = 0.62,
    # Empty keeps the canvas transparent (adaptive foreground); a colour makes it opaque.
    [string] $Background = $null
  )
  $image = [System.Drawing.Bitmap]::FromFile($Source)
  try {
    $box = Get-ContentBox $image
    $bodyColor = $image.GetPixel(($box.X + 4), ($box.Y + [int]($box.Height / 2)))
    if ($bodyColor.A -lt 200) { throw "the fill sample at the mark's left edge is transparent" }
    $ink = New-Object System.Drawing.Bitmap $box.Width, $box.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $count = 0
    for ($y = 0; $y -lt $box.Height; $y++) {
      for ($x = 0; $x -lt $box.Width; $x++) {
        $pixel = $image.GetPixel(($box.X + $x), ($box.Y + $y))
        if ($pixel.A -lt 160) { $ink.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
        $distance = [Math]::Max(
          [Math]::Abs($pixel.R - $bodyColor.R),
          [Math]::Max([Math]::Abs($pixel.G - $bodyColor.G), [Math]::Abs($pixel.B - $bodyColor.B))
        )
        # The mark carries a soft grey shadow beside the dot. It is the mark's own shading, not
        # the logo: a low-saturation pixel that is not bright cannot be the dot or the letterform.
        $spread = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) - [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))
        $brightness = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
        if ($spread -lt 24 -and $brightness -lt 225) { $ink.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
        if ($distance -le 130) { $ink.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
        # The pixel keeps its own colour; only its solidity comes from the distance to the body,
        # so the letterform's anti-aliased edge survives the extraction.
        $alpha = [int][Math]::Round(255 * [Math]::Min(1, ($distance - 130) / 70.0) * ($pixel.A / 255.0))
        if ($alpha -lt 128) { $ink.SetPixel($x, $y, [System.Drawing.Color]::Transparent); continue }
        $count++
        $ink.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $pixel.R, $pixel.G, $pixel.B))
      }
    }
    if ($count -lt 100) { throw "the mark's letterform was not recognised" }
    Remove-IsolatedInk -Bitmap $ink
    $inkBox = Get-ContentBox $ink
    $tile = New-Object System.Drawing.Bitmap $Canvas, $Canvas, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($tile)
    $width = 0
    $height = 0
    try {
      if ($Background) { $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background)) }
      else { $graphics.Clear([System.Drawing.Color]::Transparent) }
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = $Canvas * $Fill / [Math]::Max($inkBox.Width, $inkBox.Height)
      $width = [int][Math]::Round($inkBox.Width * $scale)
      $height = [int][Math]::Round($inkBox.Height * $scale)
      $graphics.DrawImage(
        $ink,
        [System.Drawing.Rectangle]::new([int](($Canvas - $width) / 2), [int](($Canvas - $height) / 2), $width, $height),
        $inkBox,
        [System.Drawing.GraphicsUnit]::Pixel
      )
    } finally { $graphics.Dispose() }
    if ($Background) {
      $flat = New-Object System.Drawing.Bitmap $Canvas, $Canvas, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
      $flatGraphics = [System.Drawing.Graphics]::FromImage($flat)
      try {
        $flatGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml($Background))
        $flatGraphics.DrawImage($tile, 0, 0)
      } finally { $flatGraphics.Dispose() }
      $flat.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
      $flat.Dispose()
    } else {
      $tile.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    Write-Output ("ink      {0} -> {1}x{1} (letterform {2}x{3}, {4:P0} of the canvas)" -f (Split-Path $Target -Leaf), $Canvas, $width, $height, $Fill)
    $ink.Dispose(); $tile.Dispose()
  } finally { $image.Dispose() }
}

# 3. Android launcher, adaptive, monochrome, notification and splash.
Save-MarkInk -Source (Join-Path $brand '3-app-icon-navy-Picsart-BackgroundRemover.png') `
  -Target (Join-Path $mobileApp 'icon.png') -Canvas 1024 -Fill 0.62 -Background '#0F172A'
Save-MarkInk -Source (Join-Path $brand '3-app-icon-navy-Picsart-BackgroundRemover.png') `
  -Target (Join-Path $mobileApp 'adaptive-icon-foreground.png') -Canvas 1024 -Fill 0.41
Save-Silhouette -Source (Join-Path $brand '3-app-icon-navy-Picsart-BackgroundRemover.png') `
  -Target (Join-Path $mobileApp 'adaptive-icon-monochrome.png') -Canvas 1024 -Fill 0.41
Save-Silhouette -Source (Join-Path $brand '3-app-icon-navy-Picsart-BackgroundRemover.png') `
  -Target (Join-Path $mobileApp 'notification-icon.png') -Canvas 96
# iOS 18 shows a tinted icon when the user picks a tinted home screen. Apple expects a
# grayscale image the system tints itself, which is the same silhouette Android already uses as
# its themed icon - the official letterform, never a recoloured logo.
Save-Silhouette -Source (Join-Path $brand '3-app-icon-navy-Picsart-BackgroundRemover.png') `
  -Target (Join-Path $mobileApp 'ios-icon-tinted.png') -Canvas 1024 -Fill 0.41
Save-Trimmed -Source (Join-Path $brand '1-logo-white-bg-Picsart-BackgroundRemover.png') `
  -Target (Join-Path $mobileApp 'splash-icon.png')

Write-Output 'asset build complete'










