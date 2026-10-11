param([int]$Port = 8123)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dataDirectory = Join-Path $root "data"
$uploadsDirectory = Join-Path $root "uploads"
$dataFile = Join-Path $dataDirectory "mazraa.json"
$loginPhone = "01044147246"
$passwordSalt = [byte[]]@(0xBD,0x87,0x86,0x1B,0xA7,0x9D,0x8B,0x0F,0x39,0xB3,0x82,0x80,0x84,0xCD,0xE1,0x0A)
$passwordHash = "64d5b824a2b04966371775ebf38e7be796c5be20e42863cf069dfb193811ce78"
$sessions = @{}
$loginAttempts = @{}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

function Read-BoundedBody {
  param(
    [System.Net.HttpListenerRequest]$Request,
    [int]$Limit
  )

  $stream = New-Object System.IO.MemoryStream
  $buffer = New-Object byte[] 65536
  $total = 0
  while (($read = $Request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    $total += $read
    if ($total -gt $Limit) {
      $stream.Dispose()
      throw [System.IO.InvalidDataException]::new("REQUEST_TOO_LARGE")
    }
    $stream.Write($buffer, 0, $read)
  }

  $body = $stream.ToArray()
  $stream.Dispose()
  return ,$body
}

function Send-Response {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$Status,
    [string]$ContentType,
    [byte[]]$Body
  )

  $Response.StatusCode = $Status
  $Response.ContentType = $ContentType
  $Response.ContentLength64 = $Body.Length
  $Response.Headers["Cache-Control"] = "no-store"
  $origin = $requestOrigin
  $allowCredentials = $false
  if (-not [string]::IsNullOrWhiteSpace($origin)) {
    $originUri = $null
    if ([Uri]::TryCreate($origin, [UriKind]::Absolute, [ref]$originUri) -and
      $originUri.IsLoopback -and
      $originUri.Scheme -in @("http", "https")) {
      $Response.Headers["Access-Control-Allow-Origin"] = $origin
      $Response.Headers["Vary"] = "Origin"
      $allowCredentials = $true
    }
  } else {
    $Response.Headers["Access-Control-Allow-Origin"] = "*"
  }
  $Response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
  $Response.Headers["Access-Control-Allow-Headers"] = "Accept, Content-Type, X-Upload-Extension"
  $Response.Headers["Access-Control-Max-Age"] = "600"
  if ($allowCredentials) {
    $Response.Headers["Access-Control-Allow-Credentials"] = "true"
  }
  $Response.OutputStream.Write($Body, 0, $Body.Length)
  $Response.Close()
}

function Send-Json {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$Status,
    [object]$Value
  )

  $json = ConvertTo-Json -InputObject $Value -Depth 12 -Compress
  $body = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
  Send-Response -Response $Response -Status $Status -ContentType "application/json; charset=utf-8" -Body $body
}

function Test-AuthenticatedRequest {
  param([System.Net.HttpListenerRequest]$Request)

  $sessionCookie = $Request.Cookies["mazraa_session"]
  if ($null -eq $sessionCookie -or [string]::IsNullOrEmpty($sessionCookie.Value)) { return $false }
  $expiry = $sessions[$sessionCookie.Value]
  if ($null -eq $expiry) { return $false }
  if ($expiry -le [DateTime]::UtcNow) {
    $sessions.Remove($sessionCookie.Value)
    return $false
  }
  $sessions[$sessionCookie.Value] = [DateTime]::UtcNow.AddHours(8)
  return $true
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $uploadsDirectory -Force | Out-Null
$listener.Start()
Write-Host "Mazraa is running on http://127.0.0.1:$Port/"
Write-Host "Keep this window open while using the website."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $requestOrigin = $request.Headers["Origin"]
    $path = $request.Url.AbsolutePath

    try {
      if ($request.HttpMethod -eq "OPTIONS") {
        Send-Response -Response $response -Status 204 -ContentType "text/plain; charset=utf-8" -Body ([byte[]]@())
        continue
      }

      if ($request.HttpMethod -eq "GET" -and $path -eq "/api/session") {
        Send-Json -Response $response -Status 200 -Value @{ authenticated = (Test-AuthenticatedRequest -Request $request) }
        continue
      }

      if ($request.HttpMethod -eq "POST" -and $path -eq "/api/login") {
        $remoteAddress = $request.RemoteEndPoint.Address.ToString()
        $attempt = $loginAttempts[$remoteAddress]
        if ($null -ne $attempt -and $attempt.LockedUntil -gt [DateTime]::UtcNow) {
          Send-Json -Response $response -Status 429 -Value @{ error = "Too many attempts. Wait 10 minutes and try again." }
          continue
        }

        $loginBody = Read-BoundedBody -Request $request -Limit 8192
        $credentials = ConvertFrom-Json -InputObject ([System.Text.UTF8Encoding]::new($false).GetString($loginBody)) -ErrorAction Stop
        $submittedPhone = ([string]$credentials.username).Trim()
        $validPhone = [string]::Equals($submittedPhone, $loginPhone, [System.StringComparison]::Ordinal)
        $validPassword = $false
        if ($validPhone -and $null -ne $credentials.password) {
          $deriveBytes = [System.Security.Cryptography.Rfc2898DeriveBytes]::new(
            [string]$credentials.password,
            $passwordSalt,
            120000,
            [System.Security.Cryptography.HashAlgorithmName]::SHA256
          )
          $candidateBytes = $deriveBytes.GetBytes(32)
          $deriveBytes.Dispose()
          $candidateHash = [BitConverter]::ToString($candidateBytes).Replace("-", "").ToLowerInvariant()
          $difference = 0
          for ($index = 0; $index -lt $passwordHash.Length; $index++) {
            $difference = $difference -bor ([int][char]$candidateHash[$index] -bxor [int][char]$passwordHash[$index])
          }
          $validPassword = $difference -eq 0
        }

        if (-not ($validPhone -and $validPassword)) {
          if ($null -eq $attempt -or $attempt.WindowStarted -lt [DateTime]::UtcNow.AddMinutes(-10)) {
            $attempt = @{ WindowStarted = [DateTime]::UtcNow; Failures = 0; LockedUntil = [DateTime]::MinValue }
          }
          $attempt.Failures++
          if ($attempt.Failures -ge 5) { $attempt.LockedUntil = [DateTime]::UtcNow.AddMinutes(10) }
          $loginAttempts[$remoteAddress] = $attempt
          Send-Json -Response $response -Status 401 -Value @{ error = "Incorrect phone number or password." }
          continue
        }

        $loginAttempts.Remove($remoteAddress)
        $token = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
        $sessions[$token] = [DateTime]::UtcNow.AddHours(8)
        $response.Headers.Add("Set-Cookie", "mazraa_session=$token; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800")
        Send-Json -Response $response -Status 200 -Value @{ authenticated = $true }
        continue
      }

      if ($request.HttpMethod -eq "POST" -and $path -eq "/api/logout") {
        $sessionCookie = $request.Cookies["mazraa_session"]
        if ($null -ne $sessionCookie) { $sessions.Remove($sessionCookie.Value) }
        $response.Headers.Add("Set-Cookie", "mazraa_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
        Send-Json -Response $response -Status 200 -Value @{ authenticated = $false }
        continue
      }

      $protectedPath = $path -eq "/api/state" -or $path -eq "/api/uploads" -or $path -match "^/uploads/"
      if ($protectedPath -and -not (Test-AuthenticatedRequest -Request $request)) {
        Send-Json -Response $response -Status 401 -Value @{ error = "Log in to access farm data." }
        continue
      }

      if ($request.HttpMethod -eq "GET" -and $path -eq "/api/state") {
        if (Test-Path -LiteralPath $dataFile -PathType Leaf) {
          $body = [System.IO.File]::ReadAllBytes($dataFile)
        } else {
          $traders = @(
            for ($index = 0; $index -lt 70; $index++) {
              [pscustomobject]@{ name = ""; phone = ""; outstanding = ""; total = "" }
            }
          )
          $initialState = [pscustomobject]@{
            cycle = $null
            traders = $traders
            dailyRecords = @()
            invoiceRecords = @()
            gasRecords = @()
            extraExpenses = @()
            workerRecords = @()
          }
          $body = [System.Text.UTF8Encoding]::new($false).GetBytes(
            (ConvertTo-Json -InputObject $initialState -Depth 8 -Compress)
          )
        }
        Send-Response -Response $response -Status 200 -ContentType "application/json; charset=utf-8" -Body $body
        continue
      }

      if ($request.HttpMethod -eq "POST" -and $path -eq "/api/state") {
        $body = Read-BoundedBody -Request $request -Limit 5242880
        $json = [System.Text.UTF8Encoding]::new($false).GetString($body)
        $parsed = ConvertFrom-Json -InputObject $json -ErrorAction Stop
        if ($null -eq $parsed -or $null -eq $parsed.traders -or $parsed.traders.Count -ne 70 -or $null -eq $parsed.dailyRecords -or $null -eq $parsed.invoiceRecords -or $null -eq $parsed.gasRecords -or $null -eq $parsed.extraExpenses) {
          throw [System.ArgumentException]::new("Farm data is incomplete.")
        }
        $temporaryFile = Join-Path $dataDirectory "mazraa.tmp"
        [System.IO.File]::WriteAllBytes($temporaryFile, $body)
        Move-Item -LiteralPath $temporaryFile -Destination $dataFile -Force
        Send-Json -Response $response -Status 200 -Value @{ saved = $true }
        continue
      }

      if ($request.HttpMethod -eq "POST" -and $path -eq "/api/uploads") {
        $extension = $request.Headers["X-Upload-Extension"]
        $contentTypes = @{
          ".jpg" = "image/jpeg"
          ".jpeg" = "image/jpeg"
          ".png" = "image/png"
          ".webp" = "image/webp"
        }
        if (-not $contentTypes.ContainsKey($extension) -or $request.ContentType.Split(";")[0].Trim().ToLowerInvariant() -ne $contentTypes[$extension]) {
          throw [System.ArgumentException]::new("Unsupported image format. Use JPG, PNG, or WebP.")
        }
        $body = Read-BoundedBody -Request $request -Limit 8388608
        if ($body.Length -eq 0) {
          throw [System.ArgumentException]::new("The image is empty.")
        }
        $signatureValid = switch ($extension) {
          ".jpg" { $body.Length -ge 3 -and $body[0] -eq 255 -and $body[1] -eq 216 -and $body[$body.Length - 2] -eq 255 -and $body[$body.Length - 1] -eq 217 }
          ".jpeg" { $body.Length -ge 3 -and $body[0] -eq 255 -and $body[1] -eq 216 -and $body[$body.Length - 2] -eq 255 -and $body[$body.Length - 1] -eq 217 }
          ".png" { $body.Length -ge 8 -and $body[0] -eq 137 -and $body[1] -eq 80 -and $body[2] -eq 78 -and $body[3] -eq 71 }
          ".webp" { $body.Length -ge 12 -and [System.Text.Encoding]::ASCII.GetString($body, 0, 4) -eq "RIFF" -and [System.Text.Encoding]::ASCII.GetString($body, 8, 4) -eq "WEBP" }
          default { $false }
        }
        if (-not $signatureValid) {
          throw [System.ArgumentException]::new("The file content does not match the selected image format.")
        }
        $fileName = [guid]::NewGuid().ToString("N") + $extension
        [System.IO.File]::WriteAllBytes((Join-Path $uploadsDirectory $fileName), $body)
        Send-Json -Response $response -Status 201 -Value @{ url = "/uploads/$fileName" }
        continue
      }

      if ($request.HttpMethod -eq "GET" -and $path -match "^/uploads/[0-9a-f]{32}\.(jpg|jpeg|png|webp)$") {
        $fileName = $path.Substring("/uploads/".Length)
        $filePath = Join-Path $uploadsDirectory $fileName
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
          Send-Json -Response $response -Status 404 -Value @{ error = "Requested image was not found." }
          continue
        }
        $extension = [System.IO.Path]::GetExtension($fileName)
        $mimeType = @{ ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"; ".png" = "image/png"; ".webp" = "image/webp" }[$extension]
        Send-Response -Response $response -Status 200 -ContentType $mimeType -Body ([System.IO.File]::ReadAllBytes($filePath))
        continue
      }

      if ($request.HttpMethod -eq "GET") {
        $staticFiles = @{
          "/" = @{ name = "index.html"; type = "text/html; charset=utf-8" }
          "/index.html" = @{ name = "index.html"; type = "text/html; charset=utf-8" }
          "/styles.css" = @{ name = "styles.css"; type = "text/css; charset=utf-8" }
          "/app.js" = @{ name = "app.js"; type = "text/javascript; charset=utf-8" }
          "/assets/farm-logo.png" = @{ name = "assets/farm-logo.png"; type = "image/png" }
        }
        if ($staticFiles.ContainsKey($path)) {
          $asset = $staticFiles[$path]
          $body = [System.IO.File]::ReadAllBytes((Join-Path $root $asset.name))
          Send-Response -Response $response -Status 200 -ContentType $asset.type -Body $body
          continue
        }
      }

      Send-Json -Response $response -Status 404 -Value @{ error = "Requested path was not found." }
    } catch {
      $status = 400
      if ($_.Exception.Message -eq "REQUEST_TOO_LARGE") { $status = 413 }
      Write-Warning "Request failed: $($request.HttpMethod) $path : $($_.Exception.Message)"
      try {
        Send-Json -Response $response -Status $status -Value @{ error = $_.Exception.Message }
      } catch {
        $response.Abort()
      }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
