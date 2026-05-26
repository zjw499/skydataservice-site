[CmdletBinding()]
param(
  [string]$SiteBaseUrl = "https://skydataservice.com",
  [string]$UploadKey = "",
  [string]$ViewerKey = "",
  [int]$IntervalMs = 1250,
  [int]$MaxWidth = 1280,
  [ValidateRange(35, 90)]
  [int]$JpegQuality = 55,
  [string]$SessionId,
  [string]$EnvFile = (Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "This script currently supports Windows only."
}

function Import-DotEnvFile {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path $Path)) {
    return
  }

  foreach ($line in Get-Content -Path $Path) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -ne 2) {
      continue
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace((Get-Item -Path ("Env:" + $name) -ErrorAction SilentlyContinue).Value)) {
      Set-Item -Path ("Env:" + $name) -Value $value
    }
  }
}

Import-DotEnvFile -Path $EnvFile

if ([string]::IsNullOrWhiteSpace($UploadKey)) {
  $UploadKey = $env:SCREEN_STREAM_UPLOAD_KEY
}

if ([string]::IsNullOrWhiteSpace($ViewerKey)) {
  $ViewerKey = $env:SCREEN_STREAM_VIEW_KEY
}

if ([string]::IsNullOrWhiteSpace($UploadKey)) {
  throw "Provide -UploadKey or set SCREEN_STREAM_UPLOAD_KEY before running."
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:JpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq "image/jpeg" } |
  Select-Object -First 1

if (-not $script:JpegCodec) {
  throw "JPEG encoder is not available on this machine."
}

function Write-Log([string]$Message) {
  Write-Host ("[" + (Get-Date -Format HH:mm:ss) + "] " + $Message)
}

function New-SessionId {
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssfffZ")
  $suffix = Get-Random -Minimum 100000 -Maximum 999999
  return "$stamp-$suffix"
}

function Invoke-StreamApi {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [hashtable]$Payload
  )

  $uri = $SiteBaseUrl.TrimEnd("/") + $Path
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress

  Invoke-RestMethod `
    -Uri $uri `
    -Method Post `
    -Headers @{ "x-screen-stream-upload-key" = $UploadKey } `
    -ContentType "application/json" `
    -Body $json `
    -TimeoutSec 120
}

function Resize-Bitmap {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Bitmap]$Bitmap,
    [Parameter(Mandatory = $true)]
    [int]$TargetWidth
  )

  if ($Bitmap.Width -le $TargetWidth) {
    return $Bitmap
  }

  $scale = $TargetWidth / [double]$Bitmap.Width
  $targetHeight = [Math]::Max(1, [int][Math]::Round($Bitmap.Height * $scale))
  $resized = New-Object System.Drawing.Bitmap($TargetWidth, $targetHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($resized)

  try {
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImage($Bitmap, 0, 0, $TargetWidth, $targetHeight)
  }
  finally {
    $graphics.Dispose()
  }

  return $resized
}

function Convert-ToJpegBytes {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Image]$Image,
    [Parameter(Mandatory = $true)]
    [int]$Quality
  )

  $stream = New-Object System.IO.MemoryStream
  $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality,
    [int64]$Quality
  )

  try {
    $Image.Save($stream, $script:JpegCodec, $encoderParams)
    return $stream.ToArray()
  }
  finally {
    $encoderParams.Dispose()
    $stream.Dispose()
  }
}

function Get-DisplayDefinitions {
  $items = @()
  $index = 0

  foreach ($screen in [System.Windows.Forms.Screen]::AllScreens) {
    $bounds = $screen.Bounds
    $items += [ordered]@{
      id      = "display-$index"
      label   = if ($screen.Primary) { "Primary Display" } else { "Display $($index + 1)" }
      width   = $bounds.Width
      height  = $bounds.Height
      left    = $bounds.X
      top     = $bounds.Y
      primary = [bool]$screen.Primary
    }

    $index += 1
  }

  return $items
}

function Get-DisplayCapture {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Display
  )

  $bitmap = New-Object System.Drawing.Bitmap($Display.width, $Display.height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.CopyFromScreen($Display.left, $Display.top, 0, 0, $bitmap.Size)
  }
  finally {
    $graphics.Dispose()
  }

  $working = $bitmap
  if ($bitmap.Width -gt $MaxWidth) {
    $working = Resize-Bitmap -Bitmap $bitmap -TargetWidth $MaxWidth
    $bitmap.Dispose()
  }

  try {
    $bytes = Convert-ToJpegBytes -Image $working -Quality $JpegQuality
    return [ordered]@{
      bytes  = $bytes
      width  = $working.Width
      height = $working.Height
    }
  }
  finally {
    if ($working) {
      $working.Dispose()
    }
  }
}

$resolvedSessionId = if ($SessionId) { $SessionId } else { New-SessionId }
$displays = Get-DisplayDefinitions

if (-not $displays.Count) {
  throw "No displays were detected."
}

$startPayload = [ordered]@{
  sessionId   = $resolvedSessionId
  startedAt   = (Get-Date).ToUniversalTime().ToString("o")
  machineName = $env:COMPUTERNAME
  intervalMs  = $IntervalMs
  maxWidth    = $MaxWidth
  jpegQuality = $JpegQuality
  displays    = $displays
}

Invoke-StreamApi -Path "/api/screen-stream-start" -Payload $startPayload | Out-Null

$viewerUrl = $SiteBaseUrl.TrimEnd("/") + "/screen-stream.html"
if (-not [string]::IsNullOrWhiteSpace($ViewerKey)) {
  $viewerUrl += "#key=" + [uri]::EscapeDataString($ViewerKey)
}

Write-Log "Screen stream started."
Write-Log ("Viewer: " + $viewerUrl)
Write-Log ("Session: " + $resolvedSessionId)
Write-Log "Press Ctrl+C to stop."

$consecutiveFailures = 0

try {
  while ($true) {
    $loopStarted = Get-Date

    try {
      foreach ($display in $displays) {
        $capture = Get-DisplayCapture -Display $display
        $framePayload = [ordered]@{
          sessionId   = $resolvedSessionId
          displayId   = $display.id
          capturedAt  = (Get-Date).ToUniversalTime().ToString("o")
          contentType = "image/jpeg"
          imageBase64 = [Convert]::ToBase64String($capture.bytes)
        }

        Invoke-StreamApi -Path "/api/screen-stream-upload" -Payload $framePayload | Out-Null
      }

      $consecutiveFailures = 0
    }
    catch {
      $consecutiveFailures += 1
      Write-Warning ("Upload loop failed (" + $consecutiveFailures + "): " + $_.Exception.Message)

      if ($consecutiveFailures -ge 5) {
        throw
      }

      Start-Sleep -Seconds 2
      continue
    }

    $elapsedMs = [int]((Get-Date) - $loopStarted).TotalMilliseconds
    $delayMs = [Math]::Max(200, $IntervalMs - $elapsedMs)
    Start-Sleep -Milliseconds $delayMs
  }
}
finally {
  try {
    Invoke-StreamApi -Path "/api/screen-stream-stop" -Payload @{
      sessionId = $resolvedSessionId
      stoppedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | Out-Null

    Write-Log "Screen stream stopped."
  }
  catch {
    Write-Warning ("Failed to signal stop: " + $_.Exception.Message)
  }
}
