#!/usr/bin/env python3
"""Cross-check scripts/taxonomy-yaml.mjs against PyYAML's safe_load.

The zero-dependency subset reader is what the tests use to read
spec/taxonomy.yaml. This local check confirms it reads the file exactly as a
full YAML parser does: same keys, same values, same types (a bool is not an
int, an int is not a str). It is not part of npm test or CI, because PyYAML
is not a dependency of this repository.

Run:  python3 scripts/check-taxonomy-yaml.py [file.yaml ...]

Exit 0: every file reads identically in both parsers.
Exit 1: a file differs, or the subset reader rejected it.
Exit 2: PyYAML is not installed, so nothing was compared.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
READER = ROOT / "scripts" / "taxonomy-yaml.mjs"


def first_difference(a, b, path="$"):
    """Return a description of the first difference, or None if equal."""
    if type(a) is not type(b):
        return f"{path}: subset reader gives {type(a).__name__} {a!r:.60}, PyYAML gives {type(b).__name__} {b!r:.60}"
    if isinstance(a, dict):
        if list(a) != list(b):
            return f"{path}: keys differ: subset reader {list(a)}, PyYAML {list(b)}"
        for key in a:
            found = first_difference(a[key], b[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: length differs: subset reader {len(a)}, PyYAML {len(b)}"
        for index, (x, y) in enumerate(zip(a, b)):
            found = first_difference(x, y, f"{path}[{index}]")
            if found:
                return found
        return None
    if a != b:
        return f"{path}: subset reader {a!r}, PyYAML {b!r}"
    return None


def main(argv):
    try:
        import yaml
    except ImportError:
        print("cannot check: PyYAML is not installed (pip install pyyaml); nothing was compared",
              file=sys.stderr)
        return 2

    targets = [Path(p).resolve() for p in argv] or [ROOT / "spec" / "taxonomy.yaml"]
    failed = 0
    for target in targets:
        shown = target.relative_to(ROOT) if target.is_relative_to(ROOT) else target
        run = subprocess.run(["node", str(READER), str(target)],
                             capture_output=True, text=True, encoding="utf-8")
        if run.returncode != 0:
            print(f"FAIL {shown}: subset reader rejected it: {run.stderr.strip()}")
            failed += 1
            continue
        ours = json.loads(run.stdout)
        with open(target, encoding="utf-8") as handle:
            theirs = yaml.safe_load(handle)
        found = first_difference(ours, theirs)
        if found:
            print(f"FAIL {shown}: {found}")
            failed += 1
        else:
            print(f"ok   {shown}: subset reader == PyYAML {yaml.__version__} safe_load")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
