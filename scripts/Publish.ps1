param(
    [string]$Destination,
    [switch]$SkipRestore
)

$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $PSScriptRoot
$env:NUGET_PACKAGES = Join-Path $toolRoot '.cache/nuget'
if (-not $Destination) {
    $Destination = Join-Path $toolRoot 'artifacts/blackpy'
}

$licenseSources = [ordered]@{
    'BlackPy.LICENSE.md' = Join-Path $toolRoot 'LICENSE.md'
    'UniEngine.LICENSE.md' = Join-Path $toolRoot 'packages/UniEngine.LICENSE.md'
    'BlackboxSystem.LICENSE.md' = Join-Path $toolRoot 'packages/BlackboxSystem.LICENSE.md'
    'Box2D.NET.LICENSE.md' = Join-Path $toolRoot 'packages/Box2D.NET.LICENSE.md'
}
foreach ($licenseSource in $licenseSources.Values) {
    if (-not (Test-Path -LiteralPath $licenseSource -PathType Leaf)) {
        throw "Required license notice is missing: $licenseSource"
    }
}

$destinationPath = [IO.Path]::GetFullPath($Destination)
$practicePath = Join-Path $destinationPath '실습'
$legacyProject = (Test-Path -LiteralPath (Join-Path $practicePath 'project.json')) -and
    -not (Test-Path -LiteralPath (Join-Path $practicePath '_blackpy/project.json'))
$supportPath = if ($legacyProject) { $practicePath } else { Join-Path $practicePath '_blackpy' }
$runtimePath = Join-Path $supportPath '_runtime'
if ((Test-Path -LiteralPath (Join-Path $practicePath 'main.py')) -and
    -not $legacyProject -and -not (Test-Path -LiteralPath (Join-Path $practicePath '_blackpy/project.json'))) {
    throw '기존 main.py 프로젝트는 자동 변환하지 않습니다. -Destination으로 새 배포 폴더를 지정해 주세요.'
}
$project = Join-Path $toolRoot 'src\BlackThunder.BlackPy\BlackThunder.BlackPy.csproj'
$publishArguments = @('publish', $project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '-p:PublishTrimmed=false', '-p:PublishSingleFile=false', '-o', $runtimePath)
if ($SkipRestore) { $publishArguments += '--no-restore' }

& dotnet @publishArguments
if ($LASTEXITCODE -ne 0) { throw 'Runtime publishing failed.' }

$launcherScript = Join-Path $PSScriptRoot 'New-Launcher.ps1'
& $launcherScript -Destination (Join-Path $supportPath '시작.exe') `
    -ManagedDllRelativePath '_runtime/BlackThunder.BlackPy.dll'

$templates = Join-Path $toolRoot 'distribution'
$batchEncoding = [Text.UTF8Encoding]::new($false)
$debugBatch = [IO.File]::ReadAllText((Join-Path $templates 'Debug.bat')).Replace("`r`n", "`n").Replace("`n", "`r`n")
if ($legacyProject) { $debugBatch = $debugBatch.Replace('--project "%~dp0.."', '--project "%~dp0."') }
[IO.File]::WriteAllText((Join-Path $supportPath 'Debug.bat'), $debugBatch, $batchEncoding)
$projectTemplates = Join-Path $templates 'project'
foreach ($template in (Get-ChildItem -LiteralPath $projectTemplates -File -Recurse)) {
    $relativePath = [IO.Path]::GetRelativePath($projectTemplates, $template.FullName)
    if ($legacyProject -and $relativePath.StartsWith('_blackpy' + [IO.Path]::DirectorySeparatorChar)) {
        $relativePath = $relativePath.Substring('_blackpy'.Length + 1)
    }
    $studentFile = Join-Path $practicePath $relativePath
    if (-not (Test-Path -LiteralPath $studentFile)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $studentFile) -Force | Out-Null
        Copy-Item -LiteralPath $template.FullName -Destination $studentFile
    }
}

$licenses = Join-Path $runtimePath 'licenses'
New-Item -ItemType Directory -Path $licenses -Force | Out-Null
foreach ($licenseName in $licenseSources.Keys) {
    Copy-Item -LiteralPath $licenseSources[$licenseName] -Destination (Join-Path $licenses $licenseName) -Force
}

$dependencyManifest = Join-Path $runtimePath 'BlackThunder.BlackPy.deps.json'
$dependencies = Get-Content -LiteralPath $dependencyManifest -Raw | ConvertFrom-Json
$runtimePacks = @($dependencies.libraries.PSObject.Properties | Where-Object { $_.Value.type -eq 'runtimepack' })
if ($runtimePacks.Count -eq 0) {
    throw "No runtime packs were recorded in the self-contained deployment: $dependencyManifest"
}

$dotnetRoot = Split-Path -Parent (Get-Command dotnet -CommandType Application).Source
foreach ($runtimePack in $runtimePacks) {
    if ($runtimePack.Name -notmatch '^runtimepack\.([^/]+)/([^/]+)$') {
        throw "Unrecognized runtime pack in the deployment: $($runtimePack.Name)"
    }

    $packageId = $Matches[1]
    $packageVersion = $Matches[2]
    $packageLocations = @(
        (Join-Path $env:NUGET_PACKAGES ($packageId.ToLowerInvariant() + '/' + $packageVersion)),
        (Join-Path $dotnetRoot ('packs/' + $packageId + '/' + $packageVersion))
    )
    $packageDirectory = $packageLocations | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_ 'LICENSE.txt') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $_ 'THIRD-PARTY-NOTICES.txt') -PathType Leaf)
    } | Select-Object -First 1
    if (-not $packageDirectory) {
        throw "Required runtime notices for $packageId/$packageVersion were not found in: $($packageLocations -join ', ')"
    }

    $noticeDirectory = Join-Path $licenses ($packageId + '/' + $packageVersion)
    New-Item -ItemType Directory -Path $noticeDirectory -Force | Out-Null
    foreach ($noticeName in @('LICENSE.txt', 'THIRD-PARTY-NOTICES.txt')) {
        Copy-Item -LiteralPath (Join-Path $packageDirectory $noticeName) `
            -Destination (Join-Path $noticeDirectory $noticeName) -Force
    }
}

Write-Output "BLACKPY_PUBLISHED=$destinationPath"
