param(
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $toolRoot '.cache/packaging-venv'
$buildPython = Join-Path $environmentPath 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $buildPython)) {
    & $Python -m venv $environmentPath
    if ($LASTEXITCODE -ne 0) { throw 'Packaging environment creation failed.' }
}

& $buildPython -m pip install 'build>=1.2,<2' 'hatchling>=1.27,<2' 'twine>=6,<7'
if ($LASTEXITCODE -ne 0) { throw 'Packaging dependencies could not be installed.' }

$wheelDirectory = Join-Path $toolRoot 'artifacts/wheels'
& $buildPython -m build --wheel --no-isolation --outdir $wheelDirectory $toolRoot
if ($LASTEXITCODE -ne 0) { throw 'Wheel build failed.' }

$versionFile = Join-Path $toolRoot 'src/blackpy/__init__.py'
$version = [regex]::Match([IO.File]::ReadAllText($versionFile), '__version__ = "([^"]+)"').Groups[1].Value
$wheel = Join-Path $wheelDirectory "blackpy-$version-py3-none-win_amd64.whl"
& $buildPython -m twine check --strict $wheel
if ($LASTEXITCODE -ne 0) { throw 'Wheel metadata validation failed.' }
if ((Get-Item -LiteralPath $wheel).Length -gt 100000000) {
    throw 'The wheel exceeds the default 100 MB PyPI file limit.'
}

Write-Output "BLACKPY_WHEEL=$wheel"
