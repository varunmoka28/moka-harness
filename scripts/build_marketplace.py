#!/usr/bin/env python3
"""Build .claude-plugin/marketplace.json from marketplace.d/*.json.

Usage: build_marketplace.py [--root DIR] [--check]
--check exits 1 when the file on disk differs from what would be written.
"""
import argparse, glob, json, os, re, sys

SHA = re.compile(r"^[0-9a-f]{40}$")


def load(root):
    names, plugins, errors = {}, [], []
    for path in sorted(glob.glob(os.path.join(root, "marketplace.d", "*.json"))):
        label = os.path.basename(path)
        try:
            entries = json.load(open(path))
        except ValueError as e:
            errors.append(f"{label}: not valid JSON ({e})")
            continue
        if not isinstance(entries, list):
            errors.append(f"{label}: must be a JSON array")
            continue
        for e in entries:
            name = e.get("name") if isinstance(e, dict) else None
            if not isinstance(name, str) or not name:
                errors.append(f"{label}: entry without a name")
                continue
            if name in names:
                errors.append(f"{label}: duplicate entry '{name}' (also in {names[name]})")
                continue
            names[name] = label
            src = e.get("source")
            if isinstance(src, str):
                if not src.startswith("./") or not os.path.isdir(os.path.join(root, src)):
                    errors.append(f"{label}: '{name}' local source folder missing: {src}")
            elif isinstance(src, dict):
                if not SHA.match(str(src.get("sha", ""))):
                    errors.append(f"{label}: '{name}' third-party source needs a full 40-character sha")
            else:
                errors.append(f"{label}: '{name}' has no usable source")
            plugins.append(e)
    return plugins, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    plugins, errors = load(root)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    text = json.dumps({
        "name": "moka-harness",
        "owner": {"name": "moka-harness"},
        "description": "One person's Claude Code setup, packaged as plugins.",
        "plugins": plugins,
    }, indent=2) + "\n"
    out = os.path.join(root, ".claude-plugin", "marketplace.json")
    if a.check:
        if not os.path.exists(out) or open(out).read() != text:
            print("marketplace.json is out of date: run scripts/build_marketplace.py", file=sys.stderr)
            return 1
        return 0
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, "w").write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
