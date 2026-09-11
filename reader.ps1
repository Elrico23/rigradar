# Rig Radar shared-memory reader
# Streams the scs-sdk-plugin telemetry block (Local\SCSTelemetry) to stdout
# as base64 lines at ~10Hz. Node spawns this; no manual use needed.
$ErrorActionPreference = 'SilentlyContinue'
$SIZE = 4400

while ($true) {
  $mmf = $null; $view = $null
  try {
    $mmf  = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting("Local\SCSTelemetry")
    $view = $mmf.CreateViewAccessor(0, $SIZE, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)
    $buf  = New-Object byte[] $SIZE
    while ($true) {
      $null = $view.ReadArray(0, $buf, 0, $SIZE)
      [Console]::Out.WriteLine([Convert]::ToBase64String($buf))
      Start-Sleep -Milliseconds 100
    }
  } catch {
    [Console]::Out.WriteLine("NOMAP")
    Start-Sleep -Seconds 2
  } finally {
    if ($view) { $view.Dispose() }
    if ($mmf)  { $mmf.Dispose() }
  }
}
