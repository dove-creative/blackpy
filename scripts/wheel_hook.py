"""Bundle a fresh Windows deployment; never package a student's working copy."""

from pathlib import Path
import subprocess
import sys
import tempfile

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class WindowsRuntimeHook(BuildHookInterface):
    def initialize(self, version, build_data):
        if sys.platform != "win32" or version != "standard":
            raise RuntimeError("Build the Windows wheel with scripts/Build-Wheel.ps1.")

        root = Path(self.root)
        cache = root / ".cache"
        cache.mkdir(exist_ok=True)
        self.staging = tempfile.TemporaryDirectory(prefix="wheel-", dir=cache)
        try:
            subprocess.run(
                ["pwsh", "-NoProfile", "-File", str(root / "scripts" / "Publish.ps1"),
                 "-Destination", self.staging.name],
                cwd=root, check=True,
            )
            runtime = Path(self.staging.name) / "실습" / "_blackpy" / "_runtime"
            build_data["force_include"][str(runtime)] = "blackpy/_runtime"
            build_data["force_include"][str(root / "distribution" / "project")] = (
                "blackpy/_templates"
            )
            build_data["tag"] = "py3-none-win_amd64"
            build_data["pure_python"] = False
        except BaseException:
            self.staging.cleanup()
            raise

    def finalize(self, version, build_data, artifact_path):
        self.staging.cleanup()
