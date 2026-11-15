#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
E="$REPO_ROOT/scripts/export_public.sh"
src="$(tmp)"
cp -R "$REPO_ROOT/scripts" "$src/scripts"
git -C "$src" init -q
git -C "$src" config user.email t"@"x.invalid; git -C "$src" config user.name t
mkdir -p "$src/plugins/p" "$src/docs/specs" "$src/docs/plans" "$src/docs/sources" "$src/docs/guides" "$src/.github" "$src/secret-notes"
echo x > "$src/plugins/p/a.txt"; echo x > "$src/README.md"; echo x > "$src/LICENSE"
echo x > "$src/docs/specs/s.md"; echo x > "$src/docs/plans/p.md"; echo x > "$src/docs/sources/m.md"
echo x > "$src/docs/guides/g.md"; echo x > "$src/.github/w.yml"; echo x > "$src/secret-notes/n.md"
git -C "$src" add -A; git -C "$src" commit -qm src
echo untracked > "$src/plugins/p/untracked.txt"

t="$(tmp)/out"
expect_rc 0 "export to a new folder" bash "$src/scripts/export_public.sh" --no-private "$t"
for f in plugins/p/a.txt README.md LICENSE docs/guides/g.md .github/w.yml scripts/leak_scan.sh; do
  [ -f "$t/$f" ] || fail "missing $f"; done
for f in docs/specs/s.md docs/plans/p.md docs/sources/m.md secret-notes/n.md plugins/p/untracked.txt; do
  [ ! -e "$t/$f" ] || fail "should not be copied: $f"; done
pass "published files copied, private and untracked ones not"

expect_rc 1 "non-empty target refused" bash "$src/scripts/export_public.sh" --no-private "$t"

# a leak in a published file fails the export
echo "contact: someone"@"x.com" > "$src/docs/guides/g.md"; git -C "$src" commit -qam leak
t2="$(tmp)/out"
expect_rc 1 "leak scan failure fails the export" bash "$src/scripts/export_public.sh" --no-private "$t2"
