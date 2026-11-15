#!/usr/bin/env python3
"""UserPromptSubmit hook: surface the skills relevant to this prompt.

Keyword prefilter over every enabled skill's full description, then one Jev
request with a Noul question per candidate. Winners are injected as context,
so descriptions dropped from the truncated skill listing still reach Claude.
Fails silent: any error means no injection, never a blocked prompt.
"""
import json, math, os, re, sys, time, urllib.request
from pathlib import Path

HOME = Path.home()
CONFIG = Path(os.environ.get("CLAUDE_CONFIG_DIR") or HOME / ".claude")
TOP_K, THRESHOLD, MAX_SHOWN = 20, 0.6, 4
# Skills triggered by the kind of work, not topic words: always sent to Jev.
ALWAYS = ["superpowers:systematic-debugging", "superpowers:brainstorming",
          "superpowers:writing-plans", "superpowers:test-driven-development"]
STOP = set("the a an and or to of in for on with is are be this that it i we you my our can do how what why should use using from at as by into".split())


def words(text):
    # ponytail: 6-char prefix as a crude stemmer (implement/implementing), use a real stemmer if it misfires
    return {w[:6] for w in re.findall(r"[a-z][a-z0-9]{2,}", text.lower()) if w not in STOP}


def frontmatter(path, default_name=None):
    try:
        text = path.read_text(errors="ignore")
    except OSError:
        return None
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    if not m:
        return None
    name = re.search(r"^name:\s*(.+)$", m.group(1), re.M)
    desc = re.search(r"^description:\s*(.*(?:\n[ \t]+.*)*)", m.group(1), re.M)
    name = name.group(1).strip().strip("\"'") if name else default_name
    if not (name and desc):
        return None
    return name, re.sub(r"\s+", " ", desc.group(1)).strip().strip("\"'>|")


def enabled_plugins(cwd):
    enabled = {}
    files = [CONFIG / "settings.json"]
    if cwd:
        files += [Path(cwd) / ".claude/settings.json", Path(cwd) / ".claude/settings.local.json"]
    for f in files:
        try:
            enabled.update(json.loads(f.read_text()).get("enabledPlugins") or {})
        except (OSError, ValueError):
            pass
    return {k for k, v in enabled.items() if v}


def catalog(cwd):
    skills = {}
    for p in [*(CONFIG / "skills").glob("*/SKILL.md"), *(Path(cwd).glob(".claude/skills/**/SKILL.md") if cwd else [])]:
        if fm := frontmatter(p, p.parent.name):
            skills[fm[0]] = fm[1]
    # project commands are invoked by filename, not their frontmatter name
    for p in (Path(cwd).glob(".claude/commands/*.md") if cwd else []):
        if fm := frontmatter(p, p.stem):
            skills[p.stem] = fm[1]
    installed = json.loads((CONFIG / "plugins/installed_plugins.json").read_text())["plugins"]
    for key in enabled_plugins(cwd):
        if key not in installed:
            continue
        add_plugin(skills, key.split("@")[0], Path(installed[key][0]["installPath"]))
    for d in (CONFIG / "plugins/synced").glob("*/*/"):
        add_plugin(skills, d.name.split("~")[0], d)
    return skills


def add_plugin(skills, prefix, root):
    for p in [*root.glob("skills/*/SKILL.md"), *root.glob("commands/*.md")]:
        if fm := frontmatter(p, p.stem):
            skills.setdefault(f"{prefix}:{fm[0]}", fm[1])


def prefilter(prompt, skills):
    q = words(prompt)
    docs = {n: words(n.replace(":", " ") + " " + d) for n, d in skills.items()}
    df = {}
    for ws in docs.values():
        for w in ws & q:
            df[w] = df.get(w, 0) + 1
    # ponytail: idf-weighted word overlap, swap for BM25/embeddings if recall is poor
    scored = sorted(((sum(math.log(len(docs) / df[w]) for w in ws & q), n) for n, ws in docs.items()), reverse=True)
    top = [n for s, n in scored[:TOP_K] if s > 0]
    return top + [n for n in ALWAYS if n in skills and n not in top]


def jev(prompt, cands, skills, key):
    state = {"user_request": prompt[:4000], "skills": {f"s{i}": {"name": n, "description": skills[n][:600]} for i, n in enumerate(cands)}}
    questions = {
        f"s{i}": {
            "type": "noul",
            "instructions": f"Would loading the skill `skills.s{i}` directly help an AI coding assistant carry out `user_request`?",
            "criteria": {
                "true": "The request's actual task is what this skill is for; its instructions would change how the work gets done.",
                "false": "The skill only shares keywords or a loose topic with the request, the request needs no skill, or the skill's workflow would do substantially more than was asked (e.g. a full release process when only a commit was requested).",
            },
        }
        for i in range(len(cands))
    }
    req = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone",
        data=json.dumps({"model": "jev-latest", "state": state, "questions": questions}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        body = json.load(r)
    data_dir = os.environ.get("CLAUDE_PLUGIN_DATA")
    if data_dir:  # token counts only, never the prompt
        try:
            Path(data_dir).mkdir(parents=True, exist_ok=True)
            with open(Path(data_dir) / "jev-router-usage.jsonl", "a") as f:
                f.write(json.dumps({"ts": time.time(), "cands": len(cands), **body.get("usage", {})}) + "\n")
        except OSError:
            pass
    answers = body["answers"]
    return {cands[int(k[1:])]: a["noul"] for k, a in answers.items()}


def api_key():
    return os.environ.get("CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY") or os.environ.get("TYPESAFE_API_KEY")


def route(prompt, cwd, skills=None):
    """Return [(prob, skill_name)] worth injecting, best first."""
    prompt = prompt.strip()
    # slash commands, and harness messages like <task-notification>, are not user tasks
    if prompt.startswith(("/", "<")) or len(words(prompt)) < 4:
        return []
    key = api_key()
    if not key:
        return []
    skills = skills or catalog(cwd)
    cands = prefilter(prompt, skills)
    if not cands:
        return []
    probs = jev(prompt, cands, skills, key)
    return sorted((p, n) for n, p in probs.items() if p >= THRESHOLD)[::-1][:MAX_SHOWN]


def main():
    if os.environ.get("JEV_ROUTER_OFF"):
        return
    data = json.load(sys.stdin)
    cwd = data.get("cwd")
    skills = catalog(cwd)
    picks = route(data.get("prompt", ""), cwd, skills)
    if not picks:
        return
    lines = [f"- `{n}` ({p:.2f}): {skills[n][:300]}" for p, n in picks]
    ctx = "Skills likely relevant to this request (ranked by Jev). Invoke via the Skill tool if they fit:\n" + "\n".join(lines)
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": ctx}}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("JEV_ROUTER_DEBUG"):
            print(f"jev-skill-router: {e!r}", file=sys.stderr)
