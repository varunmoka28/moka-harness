#!/usr/bin/env python3
"""PreToolUse(Bash) guard: block a delete command that touches a protected path.

Protected paths come from the plugin option protected_paths (one per line, or
separated by ":"). With none set it does nothing. It only blocks; it never deletes.
Covers rm, rmdir, unlink, find -delete / -exec rm, xargs rm, git clean, rmtree,
and the same inside bash/sh/zsh -c. Exit 2 blocks the command.
With delete_guard_dry_run on (the default) it logs what it would block and allows it.
"""
import datetime
import glob
import json
import os
import re
import shlex
import sys

HOME = os.path.expanduser("~")
SEPARATORS = {";", "&&", "||", "|", "&", "\n"}


def option(name, default=""):
    return os.environ.get("CLAUDE_PLUGIN_OPTION_" + name, default)


def protected_paths():
    paths = []
    for raw in re.split(r"[\n:]", option("PROTECTED_PATHS")):
        raw = os.path.expanduser(raw.strip())
        if os.path.isabs(raw):  # a relative entry would need a guessed base; skip it
            paths += {os.path.normpath(raw), os.path.realpath(raw)}
    return paths


def under(path, root):
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def reason(path, protected):
    """Why deleting `path` would hit a protected path, or None."""
    for p in {os.path.normpath(path), os.path.realpath(path)}:
        for d in protected:
            if under(p, d):
                return f"{p} is inside protected {d}"
            if under(d, p):
                return f"{p} contains protected {d}"
    return None


def resolve(arg, cwd):
    arg = os.path.expanduser(arg.replace("${HOME}", HOME).replace("$HOME", HOME))
    path = os.path.normpath(os.path.join(cwd, arg))
    return glob.glob(path) or [path]


def segments(command):
    lex = shlex.shlex(command.replace("\n", " ; "), posix=True, punctuation_chars=";&|")
    lex.whitespace_split = True
    lex.commenters = ""
    seg = []
    for tok in lex:
        if tok in SEPARATORS:
            yield seg
            seg = []
        else:
            seg.append(tok)
    yield seg


def first_hit(args, cwd, protected):
    for a in args:
        for p in resolve(a, cwd):
            r = reason(p, protected)
            if r:
                return r
    return None


def check(command, cwd, protected):
    if "rmtree" in command:
        for d in protected:
            if d in command:
                return f"rmtree near protected {d}"
    try:
        segs = list(segments(command))
    except ValueError:  # unbalanced quotes: fall back to a text match
        if re.search(r"\brm\b|-delete|git\s+clean", command) and any(d in command for d in protected):
            return "unparseable delete mentioning a protected path"
        return None
    for seg in segs:
        while seg:
            seg[0] = seg[0].lstrip("({`").lstrip("$(")
            if seg[0] in ("", "then", "do", "else", "sudo", "command", "nohup", "time", "env", "exec", "eval") or re.match(r"^\w+=", seg[0]):
                seg = seg[1:]
            else:
                break
        if not seg:
            continue
        verb, args = os.path.basename(seg[0]), seg[1:]
        if verb == "cd" and args:
            cwd = resolve(args[0], cwd)[0]
        elif verb in ("bash", "sh", "zsh") and any(re.fullmatch(r"-\w*c", a) for a in args[:-1]):
            hit = check(args[[i for i, a in enumerate(args[:-1]) if re.fullmatch(r"-\w*c", a)][0] + 1], cwd, protected)
            if hit:
                return hit
        elif verb in ("rm", "rmdir", "unlink"):
            hit = first_hit([a for a in args if not a.startswith("-")], cwd, protected)
            if hit:
                return hit
        elif verb == "find" and ("-delete" in args or any(os.path.basename(a) == "rm" for a in args)):
            roots = []
            for a in args:
                if a.startswith(("-", "(", "!")):
                    break
                roots.append(a)
            hit = first_hit(roots or ["."], cwd, protected)
            if hit:
                return hit
        elif verb == "xargs" and any(os.path.basename(a) == "rm" for a in args):
            hit = first_hit([a for a in args if not a.startswith("-")] + ["."], cwd, protected)
            if hit:
                return "xargs rm fed from a protected path: " + hit
        elif verb == "git" and "clean" in args and not ("--dry-run" in args or any(re.fullmatch(r"-\w*n\w*", a) for a in args)):
            where = args[args.index("-C") + 1] if "-C" in args else "."
            hit = first_hit([where], cwd, protected)
            if hit:
                return "git clean: " + hit
    return None


def log(line):
    data = os.environ.get("CLAUDE_PLUGIN_DATA")
    if not data:
        return
    os.makedirs(data, exist_ok=True)
    with open(os.path.join(data, "delete-guard.log"), "a") as f:
        f.write(f"{datetime.datetime.now():%F %T} {line}\n")


def main():
    protected = protected_paths()
    if not protected:
        return
    data = json.load(sys.stdin)
    command = (data.get("tool_input") or {}).get("command", "")
    hit = check(command, data.get("cwd") or os.getcwd(), protected)
    if not hit:
        return
    if option("DELETE_GUARD_DRY_RUN", "true").lower() not in ("false", "0", "no", "off"):
        log(f"would block: {hit} | {command[:200]}")
        return
    try:
        log(f"blocked: {hit} | {command[:200]}")
    except OSError:
        pass  # a log failure must not let the delete through
    print(f"Blocked by the core delete guard: {hit}. Ask the user to run this delete themselves.", file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
