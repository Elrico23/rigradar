# Rig Radar shared-memory reader
# Streams the scs-sdk-plugin telemetry block (Local\SCSTelemetry) to stdout
# as base64 lines at ~10Hz. Node spawns this; no manual use needed.
$ErrorActionPreference = 'SilentlyContinue'
$SIZE = 4400

# node kills this on a normal shutdown (Ctrl+C), but that path can't cover
# node itself being force-killed -- a forceful kill can't be intercepted by
# anything, including node's own cleanup code. So this checks the other
# direction instead: if the parent that spawned it is ever gone, stop.
# Without this a force-killed node leaves this loop running forever, still
# polling shared memory every 100ms with nothing left to feed. Checked
# every ~2s (not every tick) since it's a WMI query, not free.
#
# PID alone isn't enough: Windows recycles process IDs, and doesn't update
# a child's recorded ParentProcessId when the original parent exits. A
# reader whose real node.exe died could see its PID reused by some other,
# unrelated process later and wrongly conclude its parent is still alive
# forever -- caught in practice, not just in theory, when an orphan from
# this exact bug outlived its parent's PID being reassigned to an unrelated
# process. Recording the parent's StartTime alongside its PID and requiring
# both to still match is what actually distinguishes "still my parent"
# from "something else now has that number."
$ParentPID = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$ParentStartTime = if ($ParentPID) { (Get-Process -Id $ParentPID -ErrorAction SilentlyContinue).StartTime } else { $null }
$lastParentCheck = Get-Date
function Test-ParentAlive {
  if (-not $ParentPID -or -not $ParentStartTime) { return $true } # couldn't determine it; don't self-kill on a guess
  $p = Get-Process -Id $ParentPID -ErrorAction SilentlyContinue
  return ($null -ne $p) -and ($p.StartTime -eq $ParentStartTime)
}

while ($true) {
  if (((Get-Date) - $lastParentCheck).TotalSeconds -ge 2) {
    $lastParentCheck = Get-Date
    if (-not (Test-ParentAlive)) { exit }
  }
  $mmf = $null; $view = $null
  try {
    $mmf  = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting("Local\SCSTelemetry")
    $view = $mmf.CreateViewAccessor(0, $SIZE, [System.IO.MemoryMappedFiles.MemoryMappedFileAccess]::Read)
    $buf  = New-Object byte[] $SIZE
    while ($true) {
      if (((Get-Date) - $lastParentCheck).TotalSeconds -ge 2) {
        $lastParentCheck = Get-Date
        if (-not (Test-ParentAlive)) { exit }
      }
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
