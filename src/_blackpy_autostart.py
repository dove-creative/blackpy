"""Route direct student-file execution to the installed BlackPy runtime."""

import os
import sys

_installed = False
_handled = False


def install():
    global _installed
    if _installed or sys.platform != "win32":
        return
    if os.environ.get("BLACKPY_AUTO_RUN") == "0":
        return

    sys.addaudithook(_audit)
    _installed = True


def _audit(event, arguments):
    global _handled
    if event != "cpython.run_file" or _handled:
        return
    _handled = True

    if os.environ.get("BLACKPY_AUTO_RUN") == "0":
        return

    # Startup occurs before the script directory is added, but this event does not.
    # Exclude student search paths while loading our standard-library dependencies.
    original_path = sys.path[:]
    installed_directory = os.path.normcase(os.path.dirname(os.path.abspath(__file__)))
    excluded = {
        os.path.normcase(os.path.dirname(os.path.abspath(arguments[0]))),
        os.path.normcase(os.getcwd()),
    }
    excluded.update(
        os.path.normcase(os.path.abspath(entry))
        for entry in os.environ.get("PYTHONPATH", "").split(os.pathsep) if entry
    )
    sys.path[:] = [
        entry for entry in original_path
        if entry and (
            os.path.normcase(os.path.abspath(entry)) == installed_directory
            or os.path.normcase(os.path.abspath(entry)) not in excluded
        )
    ]
    try:
        directory = _project_directory(arguments[0])
        if directory is not None:
            # This event occurs after initialization and before source parsing.
            raise SystemExit(_run_project(directory, sys.argv[1:]))
    finally:
        sys.path[:] = original_path


def _project_directory(filename):
    filename = os.path.abspath(filename)
    if os.path.splitext(filename)[1].lower() != ".py":
        return None
    if not os.path.isfile(filename):
        return None

    directory = os.path.dirname(filename)
    if os.path.basename(directory) == "_blackpy":
        return None
    configuration = os.path.join(directory, "_blackpy", "project.json")
    if not os.path.isfile(configuration):
        configuration = os.path.join(directory, "project.json")
    try:
        with open(configuration, encoding="utf-8-sig") as stream:
            source = stream.read()
        import json
        project = json.loads(source)
    except (OSError, ValueError, RecursionError):
        return None

    if not isinstance(project, dict):
        return None
    background = project.get("background")
    if not isinstance(background, dict):
        return None
    if not isinstance(background.get("file"), str):
        return None
    if not isinstance(project.get("actors"), list):
        return None

    return directory


def _run_project(directory, arguments):
    import importlib
    import importlib.util

    # Load only our sibling package, even if a student file is named 'blackpy.py'.
    # A private name also leaves the runtime's separate 'blackpy.py' API untouched.
    package_name = "_blackpy_autostart_package"
    package_path = os.path.join(os.path.dirname(__file__), "blackpy", "__init__.py")
    specification = importlib.util.spec_from_file_location(package_name, package_path)
    package = importlib.util.module_from_spec(specification)
    sys.modules[package_name] = package
    specification.loader.exec_module(package)
    cli = importlib.import_module(f"{package_name}.cli")
    return cli.main(["run", directory, *arguments])
