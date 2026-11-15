#!/usr/bin/env bash
# Checks the public docs: every relative link resolves to a file, and every plugin
# named in an install command or in the README exists in marketplace.json.
set -u
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json, re, sys, pathlib
root = pathlib.Path('.')
names = {p['name'] for p in json.load(open('.claude-plugin/marketplace.json'))['plugins']}
docs = [pathlib.Path('README.md'), pathlib.Path('CREDITS.md')] + sorted(pathlib.Path('docs').glob('*.md')) + sorted(pathlib.Path('docs/groups').glob('*.md'))
bad = []
for f in docs:
    text = f.read_text()
    for m in re.finditer(r'\]\(([^)\s]+)\)', text):
        t = m.group(1)
        if t.startswith(('http://', 'https://', 'mailto:')):
            continue
        path, _, frag = t.partition('#')
        target = (f.parent / path).resolve() if path else f.resolve()
        if not target.is_file():
            bad.append(f'{f}: broken link {t}')
        elif frag:
            heads = {re.sub(r'[^a-z0-9 -]', '', h.lower()).strip().replace(' ', '-') for h in re.findall(r'^#+\s+(.*)$', target.read_text(), re.M)}
            if frag not in heads:
                bad.append(f'{f}: broken anchor {t}')
    for m in re.finditer(r'plugin install ([\w-]+)@moka-harness', text):
        if m.group(1) not in names:
            bad.append(f'{f}: unknown plugin {m.group(1)}')
readme = pathlib.Path('README.md').read_text()
tools = {'python3', 'git', 'jq', 'herdr', 'tuios', 'ffmpeg', 'yt-dlp', 'claude', 'plugin', 'doctor'}
for tok in sorted(set(re.findall(r'`([a-z][a-z0-9-]*)`', readme))):
    if tok not in names and tok not in tools:
        bad.append(f'README.md: `{tok}` is not a plugin in marketplace.json')
print('\n'.join(bad) if bad else 'docs links ok')
sys.exit(1 if bad else 0)
PY
