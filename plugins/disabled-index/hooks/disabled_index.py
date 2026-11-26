#!/usr/bin/env python3
"""disabled-index. "build" (SessionStart) writes an index of the skills inside the plugins switched
off in settings.json. "hint" (UserPromptSubmit) greps the prompt against it and prints a hint when a
disabled skill clearly fits. Changes no plugin state and never loads the index into context."""
import json, os, re, sys
from pathlib import Path

CONFIG = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
DATA = Path(os.environ.get("CLAUDE_PLUGIN_DATA") or CONFIG / "disabled-index")
INDEX = DATA / "disabled-plugins.md"
STOP = set("a an the and or of for to in on with from by use when you your this that is are be as at it its "
           "into about using create generate write build make analyze analyse plan new existing".split())


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def frontmatter(path):
    m = re.match(r"^---\n(.*?)\n---", path.read_text(errors="replace"), re.S)
    fm, key = {}, None
    for line in (m.group(1).splitlines() if m else []):
        if line.startswith(" ") and key:
            fm[key] = (fm[key] + " " + line.strip()).strip()
            continue
        k, sep, v = line.partition(":")
        if sep:
            key = k.strip()
            v = v.strip().strip("\"'")
            fm[key] = "" if v in ("|", ">", "|-", ">-") else v
    return fm


def build():
    disabled = [k for k, on in load(CONFIG / "settings.json").get("enabledPlugins", {}).items() if on is False]
    installed = load(CONFIG / "plugins/installed_plugins.json").get("plugins", {})
    lines = ["# Disabled plugins: what they hold", "",
             "Written by the disabled-index plugin at session start. A skill below can be read from its "
             "SKILL.md and followed, or its plugin re-enabled with `claude plugin enable <name>`.", ""]
    for key in sorted(disabled):
        roots = [Path(e["installPath"]) for e in installed.get(key, []) if Path(e.get("installPath", "")).exists()]
        if not roots:
            continue
        root = roots[-1]
        lines += [f"## {key.split('@')[0]}", "", f"Path: `{root}`", ""]
        skills = sorted(root.glob("skills/*/SKILL.md"))
        if not skills:
            lines.append("- no skills (hooks, agents or MCP only)")
        for s in skills:
            fm = frontmatter(s)
            desc = " ".join((fm.get("description") or s.parent.name).split())
            lines.append(f"- `{s.parent.name}`: {desc}")
        lines.append("")
    DATA.mkdir(parents=True, exist_ok=True)
    INDEX.write_text("\n".join(lines).rstrip() + "\n")


def words(s):
    return {w for w in re.findall(r"[a-z][a-z0-9]+", s.lower()) if w not in STOP and len(w) > 2}


def hint():
    try:
        prompt = json.load(sys.stdin).get("prompt", "")
    except ValueError:
        return
    pw = words(prompt)
    if len(pw) < 2 or not INDEX.exists():
        return
    hits, plugin, path = [], None, None
    for line in INDEX.read_text().splitlines():
        if line.startswith("## "):
            plugin = line[3:]
        elif line.startswith("Path: `"):
            path = line[7:-1]
        elif line.startswith("- `") and "`: " in line:
            name, _, desc = line[3:].partition("`: ")
            nw, dw = words(name.replace("-", " ")), words(desc)
            n_hit, d_hit = len(nw & pw), len(dw & pw)
            # shortcut: word overlap, no embeddings. Needs most of the skill name in the prompt.
            if n_hit >= 2 or (n_hit == len(nw) == 1 and d_hit >= 3):
                hits.append((n_hit * 3 + d_hit, name, plugin, f"{path}/skills/{name}/SKILL.md"))
    hits.sort(reverse=True)
    for _, name, plugin, p in hits[:2]:
        print(f"Disabled skill `{name}` ({plugin}) may fit this prompt. Read {p} and follow it; do not enable the plugin.")


if __name__ == "__main__":
    build() if sys.argv[1:] == ["build"] else hint()
