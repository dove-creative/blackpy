param(
    [switch]$IncludeSource
)

$ErrorActionPreference = 'Stop'
$toolRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $toolRoot 'packages/source-manifest.json') -Raw | ConvertFrom-Json
[xml]$project = Get-Content -LiteralPath (Join-Path $toolRoot 'src/BlackThunder.BlackPy/BlackThunder.BlackPy.csproj') -Raw
$references = @($project.Project.ItemGroup.PackageReference | Where-Object { $_ })

foreach ($package in $manifest.packages) {
    $packagePath = Join-Path $toolRoot ('packages/' + $package.file)
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        throw "Pinned package is missing: $($package.file)"
    }

    $actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash
    if ($actualHash -ne $package.sha256) {
        throw "Pinned package checksum differs: $($package.file)"
    }

    $reference = @($references | Where-Object { $_.Include -eq $package.id })
    if ($reference.Count -ne 1 -or $reference[0].Version -ne $package.version) {
        throw "The direct PackageReference must match the manifest: $($package.id) $($package.version)"
    }

    Write-Output "PACKAGE_VERIFIED=$($package.id)/$($package.version)"
}

if (-not $IncludeSource) {
    return
}

$blackbox = $manifest.packages | Where-Object { $_.id -eq 'BlackThunder.BlackboxSystem' }
$sources = @(
    @{ Path = 'references/uniengine'; Commit = $manifest.commit },
    @{ Path = 'references/blackbox-system'; Commit = $blackbox.sourceCommit }
)

foreach ($source in $sources) {
    $sourcePath = Join-Path $toolRoot $source.Path
    if (-not (Test-Path -LiteralPath (Join-Path $sourcePath '.git'))) {
        throw "Initialize the submodule first: git submodule update --init -- $($source.Path)"
    }

    $actualCommit = & git -C $sourcePath rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $source.Commit) {
        throw "Submodule commit differs from the package source: $($source.Path)"
    }

    Write-Output "SOURCE_VERIFIED=$($source.Path)@$actualCommit"
}
