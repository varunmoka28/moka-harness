"""Redraw claude-hud's output as colored segments: model, folder, branch, time,
then the dim config counts on the right. Unrecognised output passes through as is."""
import os
import re
import subprocess
import sys
import unicodedata

ANSI = re.compile(r"\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)")
FIRST = re.compile(r"^\[(?P<model>[^\]]+)\] │ (?P<proj>\S+)(?: (?P<added>\+\S+))?"
                   r"(?: git:\((?P<branch>[^)]+)\))?.*?(?:⏱\S*\s+(?P<time>.+?))?\s*$")
RESET, DIM = "\x1b[0m", "\x1b[38;2;92;99;112m"


def vis(s):
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 0 if unicodedata.combining(c) else 1
               for c in ANSI.sub("", s))


def seg(text, bg, fg=(30, 33, 39)):
    return f"\x1b[48;2;{bg[0]};{bg[1]};{bg[2]}m\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m {text} {RESET}"


def place():
    """Return (folder as ~/path, linked worktree name or None) for the session cwd."""
    cwd = os.environ.get("STATUS_CWD", "")
    if not cwd:
        return None, None
    home = os.path.expanduser("~")
    tilde = lambda p: "~" + p[len(home):] if p.startswith(home) else p
    out = subprocess.run(["git", "-C", cwd, "rev-parse", "--absolute-git-dir", "--git-common-dir", "--show-toplevel"],
                         capture_output=True, text=True).stdout.split()
    if len(out) == 3:
        common = os.path.realpath(os.path.join(cwd, out[1]))
        if os.path.realpath(out[0]) != common:  # linked worktree: show the main checkout and the worktree name
            return tilde(os.path.dirname(common)), os.path.basename(out[2])
    return tilde(cwd), None


def main(width):
    lines = [l for l in sys.stdin.read().split("\n") if l.strip()]
    if not lines:
        return
    m = FIRST.match(ANSI.sub("", lines[0]))
    if not m:
        print("\n".join(lines))
        return
    left = seg(m["model"], (86, 182, 194))
    folder, worktree = place()
    left += seg((folder or m["proj"]) + (f" {m['added']}" if m["added"] else ""), (229, 192, 123))
    if worktree:
        left += seg(f"worktree {worktree}", (198, 120, 221))
    if m["branch"]:
        left += seg(m["branch"], (152, 195, 121))
    if m["time"]:
        left += seg(m["time"], (62, 68, 81), (171, 178, 191))
    rest = [DIM + ANSI.sub("", l).replace(" | ", " · ") + RESET for l in lines[1:]]
    rows = [[left, []]]
    for item in rest:
        l, right = rows[-1]
        if vis(l) + sum(vis(r) + 3 for r in right + [item]) <= width:
            right.append(item)
        else:
            rows.append(["", [item]])
    for l, right in rows:
        joined = "   ".join(right)
        print(l + " " * max(1, width - vis(l) - vis(joined)) + joined)


if __name__ == "__main__":
    main(int(sys.argv[1]))
