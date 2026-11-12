param(
    [string]$SourceRepository = (Join-Path (Split-Path -Parent $PSScriptRoot) 'references/uniengine')
)

$ErrorActionPreference = 'Stop'
$commit = 'e256629bf5a9a164e4d385ea5a7eab82f456e1aa'
$version = '0.1.0-mvp.e256629'
$toolRoot = Split-Path -Parent $PSScriptRoot
$feed = Join-Path $toolRoot 'packages'
$package = Join-Path $feed "BlackThunder.UniEngine.$version.nupkg"
if (Test-Path -LiteralPath $package) {
    throw 'The pinned package already exists. Verify packages/source-manifest.json instead of replacing it.'
}

$sourcePath = (Resolve-Path -LiteralPath $SourceRepository).Path
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('Elementary-UniEngine-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch, $feed -Force | Out-Null
$archive = Join-Path $scratch 'source.zip'
& git --no-optional-locks -C $sourcePath archive --format=zip "--output=$archive" $commit
if ($LASTEXITCODE -ne 0) { throw 'The pinned source commit could not be exported.' }

$source = Join-Path $scratch 'source'
Expand-Archive -LiteralPath $archive -DestinationPath $source
$project = Join-Path $source 'src\BlackThunder.UniEngine.csproj'
& dotnet pack $project -c Release -o $feed "-p:PackageVersion=$version" "-p:RepositoryCommit=$commit" `
    '-p:RepositoryUrl=https://github.com/dove-creative/uniengine'
if ($LASTEXITCODE -ne 0) { throw 'UniEngine packaging failed.' }

$blackbox = Join-Path $source 'packages\BlackThunder.BlackboxSystem.0.2.0.nupkg'
$blackboxTarget = Join-Path $feed ([IO.Path]::GetFileName($blackbox))
if (-not (Test-Path -LiteralPath $blackboxTarget)) {
    Copy-Item -LiteralPath $blackbox -Destination $blackboxTarget
}
if ((Get-FileHash -LiteralPath $blackbox).Hash -ne (Get-FileHash -LiteralPath $blackboxTarget).Hash) {
    throw 'The existing Blackbox package does not match the pinned source.'
}

Copy-Item -LiteralPath (Join-Path $source 'LICENSE.md') -Destination (Join-Path $feed 'UniEngine.LICENSE.md')
$manifest = [ordered]@{
    repository = 'https://github.com/dove-creative/uniengine'
    branch = 'uniengine-mvp'
    commit = $commit
    framework = 'netstandard2.1'
    packages = @(
        [ordered]@{ id = 'BlackThunder.UniEngine'; version = $version;
            file = [IO.Path]::GetFileName($package); sha256 = (Get-FileHash -LiteralPath $package).Hash },
        [ordered]@{ id = 'BlackThunder.BlackboxSystem'; version = '0.2.0';
            repository = 'https://github.com/dove-creative/blackbox-system';
            sourceCommit = '635c20e2ece4ce0c504ea03dda2c40679eac00e1';
            file = [IO.Path]::GetFileName($blackboxTarget); sha256 = (Get-FileHash -LiteralPath $blackboxTarget).Hash }
    )
}
$json = ($manifest | ConvertTo-Json -Depth 5).Replace("`r`n", "`n") + "`n"
[IO.File]::WriteAllText((Join-Path $feed 'source-manifest.json'), $json, [Text.UTF8Encoding]::new($false))
Write-Output "UNIENGINE_SOURCE=$scratch"
