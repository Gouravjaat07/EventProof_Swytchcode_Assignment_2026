# EventProof dev-only wrapper: runs the Swytchcode CLI with its backend traffic
# routed through tools/relay/relay.js (see that file for why).
# Usage: .\tools\relay\swy.ps1 <swy args...>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)

$ErrorActionPreference = 'Stop'
$root = 'D:\Downloads\SwtychCode_Assignment'

# Pick a free localhost port.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()

$relayLog = Join-Path $root 'tools\relay\.relay.log'
if (Test-Path $relayLog) { Remove-Item $relayLog -Force }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.Arguments = "`"$root\tools\relay\relay.js`""
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.EnvironmentVariables['RELAY_PORT'] = "$port"
$relay = [System.Diagnostics.Process]::Start($psi)

try {
    # Wait until the relay accepts connections (max ~15s).
    $ready = $false
    for ($i = 0; $i -lt 150; $i++) {
        Start-Sleep -Milliseconds 100
        if ($relay.HasExited) { break }
        try {
            $c = New-Object System.Net.Sockets.TcpClient
            $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
            if ($iar.AsyncWaitHandle.WaitOne(300)) { $c.EndConnect($iar); $c.Close(); $ready = $true; break }
            $c.Close()
        } catch { }
    }
    if (-not $ready) {
        $err = $relay.StandardError.ReadToEnd()
        throw "relay did not become ready. stderr: $err"
    }
    $env:SWYTCHCODE_API_URL = "http://127.0.0.1:$port"
    & "$root\tools\cli\node_modules\.bin\swytchcode.cmd" @CliArgs
    $code = $LASTEXITCODE
} finally {
    if (-not $relay.HasExited) {
        $relay.Kill()
        $relay.WaitForExit(5000) | Out-Null
    }
    $out = $relay.StandardOutput.ReadToEnd()
    $err = $relay.StandardError.ReadToEnd()
    if ($out) { $out | Out-File -FilePath $relayLog -Encoding utf8 }
    if ($err) { Write-Host '--- relay log ---'; Write-Host $err }
}

exit $code
