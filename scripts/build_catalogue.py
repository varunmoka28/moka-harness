#!/usr/bin/env python3
"""Build docs/index.html, the catalogue page, from files already in the repo.

Sources: .claude-plugin/marketplace.json (every entry), marketplace.d/ (third-party
plugin or skill), docs/trust-table.md (author, licence, runs code, sends text),
docs/WIRING.md (events, commands, tools of harness plugins), each harness plugin's README
("What it does") and plugin.json (bundle members), the bundles' .mcp.json, and
plugins/core/working-style.md (rules).

Usage: build_catalogue.py [--check]   --check exits 1 if docs/index.html is stale.
"""
import html, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = "https://github.com/varunmoka28/moka-harness"
OUT = ROOT / "docs" / "index.html"
ADAPTED = {
    "terminal-desk": "Terminal Desk by ClariSortAi (MIT)",
    "assumption-log": "Terminal Desk by ClariSortAi (MIT)",
    "input-router": "lean-connector-results by Creator Scripts (MIT)",
    "next-steps-autopilot": "next-steps by Thariq Shihipar (MIT)",
    "noticeboard": "decision-tree by Ray Amjad (MIT)",
    "strict-guard": "Blast Radius in anthropics/claude-code-playground (Apache-2.0)",
}
TYPES = [("rule", "Rules"), ("bundle", "Bundles"), ("mod", "Mods"), ("hook", "Hooks"),
         ("skill", "Skills"), ("plugin", "Third-party plugins"), ("mcp", "MCP servers")]


def esc(s):
    return html.escape(s, quote=True)


def inline(s, base):
    """Markdown inline (code, links, bold) to HTML. Relative links point at GitHub."""
    out, parts = [], re.split(r"(`[^`]+`)", s)
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append(f"<code>{esc(p[1:-1])}</code>")
            continue
        p = esc(p)
        def link(m):
            url = html.unescape(m.group(2))
            if not url.startswith(("http://", "https://", "#")):
                url = f"{base}/{url}"
            return f'<a href="{esc(url)}">{m.group(1)}</a>'
        p = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, p)
        p = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", p)
        out.append(p)
    return "".join(out)


def md(text, base):
    """Small Markdown block subset: paragraphs, bullet and numbered lists, code fences."""
    html_out, para, items, ordered, fence, code = [], [], [], False, False, []
    def flush():
        nonlocal para, items
        if para:
            html_out.append(f"<p>{inline(' '.join(para), base)}</p>")
            para = []
        if items:
            tag = "ol" if ordered else "ul"
            html_out.append(f"<{tag}>" + "".join(f"<li>{inline(i, base)}</li>" for i in items) + f"</{tag}>")
            items = []
    for line in text.splitlines():
        if line.strip().startswith("```"):
            if fence:
                html_out.append(f"<pre>{esc(chr(10).join(code))}</pre>")
                fence, code = False, []
            else:
                flush()
                fence = True
            continue
        if fence:
            code.append(line.strip("\n"))
            continue
        m = re.match(r"\s*(?:[-*]|(\d+)\.)\s+(.*)", line)
        if m:
            if para:
                flush()
            ordered = bool(m.group(1))
            items.append(m.group(2))
        elif not line.strip():
            flush()
        elif items and line.startswith("  "):
            items[-1] += " " + line.strip()
        else:
            if items:
                flush()
            para.append(line.strip())
    flush()
    return "".join(html_out)


def section(text, heading):
    m = re.search(rf"^## {re.escape(heading)}[^\n]*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1).strip() if m else ""


def table_rows(path):
    rows = {}
    for line in path.read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if line.startswith("|") and len(cells) > 3 and not set(cells[0]) <= set("-"):
            rows[cells[0].strip("`")] = cells
    return rows


def main():
    market = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())["plugins"]
    trust = table_rows(ROOT / "docs/trust-table.md")
    wiring = table_rows(ROOT / "docs/WIRING.md")
    skill_packs = {p["name"] for p in json.loads((ROOT / "marketplace.d/third-party-skills.json").read_text())}
    group_of, entries = {}, []

    for p in market:
        if isinstance(p["source"], str):
            pj = json.loads((ROOT / p["source"] / ".claude-plugin/plugin.json").read_text())
            if (ROOT / p["source"] / "hooks/hooks.json").exists():
                continue  # a plugin with hooks and dependencies is not a bundle
            for d in pj.get("dependencies", []):
                group_of.setdefault(d if isinstance(d, str) else d["name"], p["name"])

    for p in market:
        name, t = p["name"], trust.get(p["name"], [])
        e = {"name": name, "desc": p.get("description", ""), "group": group_of.get(name, "add-on"),
             "author": t[2] if len(t) > 2 else "", "licence": t[3] if len(t) > 3 else "",
             "runs": t[5] if len(t) > 5 else "", "sends": t[6] if len(t) > 6 else "", "facts": []}
        if isinstance(p["source"], str):
            folder = ROOT / p["source"]
            base = f"{REPO}/blob/main/{p['source'][2:]}"
            readme = (folder / "README.md").read_text() if (folder / "README.md").exists() else ""
            hooks = folder / "hooks/hooks.json"
            pj = json.loads((folder / ".claude-plugin/plugin.json").read_text())
            deps = [d if isinstance(d, str) else d["name"] for d in pj.get("dependencies", [])]
            if deps and not hooks.exists():
                e["type"], e["group"] = "bundle", name
                e["facts"].append(("Members", ", ".join(deps)))
            elif hooks.exists() and "modules" in json.loads(hooks.read_text()):
                e["type"] = "mod"
            else:
                e["type"] = "hook"
            e["source"] = "adapted" if name in ADAPTED else "harness"
            if name in ADAPTED:
                e["facts"].append(("Adapted from", ADAPTED[name]))
            w = wiring.get(name)
            if w and len(w) >= 4 and e["type"] != "bundle":
                e["facts"] += [("Events", w[1]), ("Commands", w[2]), ("Tools", w[3]), ("Settings", w[4])]
            e["how"] = md(section(readme, "What it does"), base)
            e["ref"] = (f"{REPO}/tree/main/{p['source'][2:]}", "plugins/" + name)
            entries.append(e)
            for sk in sorted((folder / "skills").glob("*/SKILL.md")) if (folder / "skills").exists() else []:
                body = sk.read_text()
                d = re.search(r"^description:\s*(.*)$", body, re.M)
                entries.append({"name": f"{name}:{sk.parent.name}", "desc": d.group(1) if d else "",
                                "type": "skill", "source": "harness", "group": e["group"], "facts": [("Part of", name)],
                                "how": md(body.split("---", 2)[-1].strip(), base),
                                "ref": (f"{REPO}/blob/main/{p['source'][2:]}/skills/{sk.parent.name}/SKILL.md", "SKILL.md"),
                                "author": e["author"], "licence": e["licence"], "runs": "", "sends": ""})
            mcp = folder / ".mcp.json"
            if mcp.exists():
                for srv, cfg in json.loads(mcp.read_text())["mcpServers"].items():
                    run = cfg.get("url") or " ".join([cfg.get("command", "")] + cfg.get("args", []))
                    entries.append({"name": srv, "desc": f"MCP server started when the {name} bundle is enabled.",
                                    "type": "mcp", "source": "harness", "group": name, "how": "",
                                    "facts": [("Starts", run), ("Part of", name)], "ref": (f"{REPO}/blob/main/{p['source'][2:]}/.mcp.json", ".mcp.json"),
                                    "author": "", "licence": "", "runs": "", "sends": ""})
        else:
            s = p["source"]
            e["type"] = "skill" if name in skill_packs else "plugin"
            e["source"] = "third-party"
            e["facts"].append(("Pinned commit", s["sha"][:12]))
            e["how"] = ""
            repo = s.get("repo") or s["url"]
            sub = f"/{s['path']}" if s.get("path") else ""
            e["ref"] = (f"https://github.com/{repo}/tree/{s['sha']}{sub}", repo + sub)
            entries.append(e)

    style = (ROOT / "plugins/core/working-style.md").read_text()
    for m in re.finditer(r"^## ([^\n]+)\n(.*?)(?=^## |\Z)", style, re.M | re.S):
        body = m.group(2).strip()
        first = re.sub(r"\*\*|`|^[-\d.]+\s+", "", body.split("\n")[0]).strip()
        first = re.split(r"(?<=[.])\s", first)[0]
        entries.append({"name": re.sub(r"^\d+(\.\d+)?\.?\s+", "", m.group(1)), "i": m.start(), "desc": first, "type": "rule",
                        "source": "harness", "group": "core", "facts": [], "how": md(body, f"{REPO}/blob/main/plugins/core"),
                        "ref": (f"{REPO}/blob/main/plugins/core/working-style.md", "working-style.md"),
                        "author": "", "licence": "", "runs": "", "sends": ""})

    order = {k: i for i, (k, _) in enumerate(TYPES)}
    entries.sort(key=lambda e: (order[e["type"]], e["source"] == "third-party", e.get("i", 0), e["name"]))
    for e in entries:
        e["group"] = "core" if e["group"] == "core-bundle" else e["group"]
    counts = {k: sum(e["type"] == k for e in entries) for k, _ in TYPES}

    def card(e):
        tags = f'<span class="tag">{esc(e["source"])}</span><span class="tag">{esc(e["group"])}</span>'
        facts = [(k, v) for k, v in e["facts"] if v and v != "none"]
        for k, v in (("Author", e["author"]), ("Licence", e["licence"]), ("Runs code", e["runs"]), ("Sends text off the machine", e["sends"])):
            if v and v != "moka-harness":
                facts.append((k, v))
        dl = "".join(f"<dt>{esc(k)}</dt><dd>{inline(v, REPO)}</dd>" for k, v in facts)
        how = f'<details><summary>How it works</summary><div class="how">{e["how"]}</div></details>' if e["how"] else ""
        shots = [f for f in [ROOT / "docs/shots" / f'{e["name"]}.png', *(f for f in sorted((ROOT / "docs/shots").glob("*.png")) if f.name.startswith(e["name"] + "--"))] if f.exists()]
        imgs = "".join(f'<img src="shots/{f.name}" alt="{esc(e["name"] + (": " + f.stem.split("--", 1)[1] if "--" in f.stem else ""))}" loading="lazy">' for f in shots)
        ref = f'<a class="ref" href="{esc(e["ref"][0])}">{esc(e["ref"][1])}</a>'
        text = esc(" ".join([e["name"], e["desc"], e["group"], e["source"]]).lower())
        return (f'<article class="e" data-type="{e["type"]}" data-source="{e["source"]}" data-text="{text}">'
                f'<h3><code>{esc(e["name"])}</code>{tags}</h3><p class="d">{inline(e["desc"], REPO)}</p>'
                f'{imgs}<dl>{dl}<dt>Source</dt><dd>{ref}</dd></dl>{how}</article>')

    body = "".join(
        f'<section id="{k}"><h2>{label}</h2>' + "".join(card(e) for e in entries if e["type"] == k) + "</section>"
        for k, label in TYPES)
    nav = "".join(f'<a href="#{k}" data-f="{k}">{label} <span>{counts[k]}</span></a>' for k, label in TYPES)
    page = TEMPLATE.replace("{{NAV}}", nav).replace("{{BODY}}", body).replace("{{REPO}}", REPO)

    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != page:
            print("docs/index.html is stale: run scripts/build_catalogue.py")
            sys.exit(1)
        print("catalogue up to date")
        return
    OUT.write_text(page)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(entries)} entries)")


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>moka-harness catalogue</title>
<!-- Generated by scripts/build_catalogue.py. Do not edit by hand. -->
<style>
:root{--paper:#f6f3ec;--ink:#2b2a27;--mute:#7a7366;--rule:#ddd6c8;--accent:#a4462a;--tag:#c9bfab}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 Georgia,'Iowan Old Style',serif;display:grid;grid-template-columns:220px minmax(0,1fr)}
nav{position:sticky;top:0;height:100vh;overflow:auto;padding:28px 18px;border-right:1px solid var(--rule);font:14px/2 -apple-system,'Helvetica Neue',sans-serif}
nav b{display:block;font-size:11px;letter-spacing:.12em;color:#8a8273;margin:16px 0 4px}
nav a{display:flex;justify-content:space-between;color:var(--ink);text-decoration:none;cursor:pointer}
nav a span{color:var(--mute);font-size:12px}
nav a.on{color:var(--accent);font-weight:600}
nav input{width:100%;font:14px -apple-system,sans-serif;padding:6px 8px;border:1px solid var(--rule);background:#fffdf8;border-radius:4px}
main{padding:32px 44px;max-width:900px}
h1{font-size:30px;margin:0 0 4px}
.sub{color:var(--mute);font-style:italic;margin:0 0 8px}
.intro{font-size:15px;color:#4b473f}
h2{font-size:19px;border-bottom:1px solid var(--rule);padding-bottom:4px;margin:36px 0 10px}
.e{padding:12px 0;border-bottom:1px dotted var(--rule)}
.e h3{margin:0;font-weight:normal}
.e h3 code{font:600 15px 'SF Mono',Menlo,monospace}
.tag{font:11px -apple-system,sans-serif;border:1px solid var(--tag);border-radius:10px;padding:0 7px;margin-left:7px;color:#6b6457;vertical-align:2px}
.d{margin:4px 0}
.e img{display:block;max-width:100%;height:auto;margin:8px 0;border:1px solid var(--rule);border-radius:4px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:0 14px;margin:6px 0;font:13px/1.6 -apple-system,sans-serif;color:#4b473f}
dt{color:var(--mute)}dd{margin:0}
code{font:13px 'SF Mono',Menlo,monospace;background:#ece6da;padding:0 3px;border-radius:3px}
a{color:var(--accent)}
details summary{cursor:pointer;font:13px -apple-system,sans-serif;color:var(--accent)}
.how{font-size:14.5px;border-left:2px solid var(--rule);padding-left:14px;margin:6px 0}
pre{background:#ece6da;padding:8px 10px;overflow:auto;font:12px 'SF Mono',Menlo,monospace}
.hide{display:none}
@media(max-width:760px){body{display:block}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--rule)}main{padding:20px}}
</style></head><body>
<nav><input id="q" type="search" placeholder="Search" aria-label="Search the catalogue">
<b>TYPE</b><a data-f="all" class="on">Everything</a>{{NAV}}
<b>SOURCE</b><a data-s="harness">Harness</a><a data-s="adapted">Adapted</a><a data-s="third-party">Third-party</a>
<b>REPO</b><a href="{{REPO}}">GitHub</a><a href="{{REPO}}#prerequisites">Prerequisites</a><a href="{{REPO}}/blob/main/docs/trust-table.md">Trust table</a></nav>
<main><h1>The moka-harness catalogue</h1>
<p class="sub">Every rule, mod, hook, skill, plugin and MCP server in the marketplace: what it does, how it hooks into Claude Code, and where it comes from.</p>
<p class="intro"><b>Harness</b> entries live in <code>plugins/</code>; most started from mods other people published. <b>Adapted</b> ones are harness plugins that name their original on the entry. <b>Third-party</b> entries install from their author's repo, frozen to the commit shown; nothing from them is copied here. "Runs code" and "Sends text off the machine" come from the trust table; "Not checked" means nobody has read that code yet.</p>
{{BODY}}</main>
<script>
const q=document.getElementById('q'),arts=[...document.querySelectorAll('.e')];let type='all',src='';
function apply(){const t=q.value.toLowerCase();arts.forEach(a=>a.classList.toggle('hide',!((type==='all'||a.dataset.type===type)&&(!src||a.dataset.source===src)&&(!t||a.dataset.text.includes(t)))));
document.querySelectorAll('section').forEach(s=>s.classList.toggle('hide',!s.querySelector('.e:not(.hide)')));}
document.querySelectorAll('nav a[data-f]').forEach(a=>a.onclick=e=>{e.preventDefault();type=a.dataset.f;document.querySelectorAll('nav a[data-f]').forEach(x=>x.classList.toggle('on',x===a));apply();});
document.querySelectorAll('nav a[data-s]').forEach(a=>a.onclick=e=>{e.preventDefault();src=src===a.dataset.s?'':a.dataset.s;document.querySelectorAll('nav a[data-s]').forEach(x=>x.classList.toggle('on',x.dataset.s===src));apply();});
q.oninput=apply;
</script></body></html>
"""

if __name__ == "__main__":
    main()
