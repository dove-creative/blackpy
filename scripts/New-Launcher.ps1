param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [Parameter(Mandatory = $true)]
    [string]$ManagedDllRelativePath,
    [string]$SourceAppHost,
    [string]$SdkDirectory
)

$ErrorActionPreference = 'Stop'
if ([IO.Path]::IsPathRooted($ManagedDllRelativePath)) {
    throw 'ManagedDllRelativePath must be relative to the generated launcher.'
}

$destinationPath = [IO.Path]::GetFullPath($Destination)
$destinationDirectory = [IO.Path]::GetDirectoryName($destinationPath)
$managedPath = [IO.Path]::GetFullPath((Join-Path $destinationDirectory $ManagedDllRelativePath))
if (-not (Test-Path -LiteralPath $managedPath -PathType Leaf)) {
    throw "The managed application was not found: $managedPath"
}

$dotnetExecutable = (Get-Command dotnet -CommandType Application).Source
if (-not $SdkDirectory) {
    $dotnetDirectory = Split-Path -Parent $dotnetExecutable
    $sdkVersion = (& $dotnetExecutable --version).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'The selected .NET SDK could not be resolved.' }
    $SdkDirectory = Join-Path $dotnetDirectory ('sdk/' + $sdkVersion)
}
$SdkDirectory = [IO.Path]::GetFullPath($SdkDirectory)
$buildTasksAssembly = Join-Path $SdkDirectory 'Sdks/Microsoft.NET.Sdk/tools/net10.0/Microsoft.NET.Build.Tasks.dll'
if (-not (Test-Path -LiteralPath $buildTasksAssembly -PathType Leaf)) {
    throw "The selected SDK does not contain the .NET 10 build tasks: $SdkDirectory"
}

if (-not $SourceAppHost) {
    # Use the apphost version recorded by the selected SDK, never an already-bound executable.
    [xml]$bundledVersions = Get-Content -LiteralPath (
        Join-Path $SdkDirectory 'Microsoft.NETCoreSdk.BundledVersions.props') -Raw
    $appHostPack = @($bundledVersions.Project.ItemGroup.KnownAppHostPack |
        Where-Object { $_.TargetFramework -eq 'net10.0' -and $_.Include -eq 'Microsoft.NETCore.App' })[0]
    if (-not $appHostPack) { throw 'The selected SDK does not describe a .NET 10 apphost pack.' }
    $packVersion = $appHostPack.AppHostPackVersion
    $dotnetDirectory = Split-Path -Parent (Split-Path -Parent $SdkDirectory)
    $packageRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else {
        Join-Path ([Environment]::GetFolderPath('UserProfile')) '.nuget/packages'
    }
    $candidates = @(
        (Join-Path $dotnetDirectory "packs/Microsoft.NETCore.App.Host.win-x64/$packVersion/runtimes/win-x64/native/apphost.exe"),
        (Join-Path $packageRoot "microsoft.netcore.app.host.win-x64/$packVersion/runtimes/win-x64/native/apphost.exe")
    )
    $SourceAppHost = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $SourceAppHost) {
        throw "The .NET 10 win-x64 apphost template is missing. Publish BlackPy first or specify SourceAppHost."
    }
}

$SourceAppHost = [IO.Path]::GetFullPath($SourceAppHost)
if ([string]::Equals($SourceAppHost, $destinationPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The generated launcher must not overwrite the apphost template.'
}
[IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
# Run SDK tasks in the SDK runtime, independent of the runtime hosting PowerShell.
$arguments = @(
    'msbuild', (Join-Path $PSScriptRoot 'Launcher.proj'), '-nologo', '-verbosity:minimal',
    '-target:CreateLauncher', "-property:BuildTasksAssembly=$buildTasksAssembly",
    "-property:SourceAppHost=$SourceAppHost", "-property:Destination=$destinationPath",
    "-property:ManagedDllRelativePath=$ManagedDllRelativePath", "-property:ManagedAssembly=$managedPath"
)
& $dotnetExecutable @arguments
if ($LASTEXITCODE -ne 0) { throw 'The native launcher could not be generated.' }
Write-Output "BLACKPY_LAUNCHER=$destinationPath"
Write-Output "BLACKPY_BUILD_TASKS=$buildTasksAssembly"
