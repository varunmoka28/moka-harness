#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"
src="$(tmp)"
cp -R "$REPO_ROOT/scripts" "$src/scripts"
git -C "$src" init -q
git -C "$src" config user.email t"@"x.invalid; git -C "$src" config user.name t
mkdir -p "$src/plugins/p" "$src/docs/specs" "$src/docs/guides"
echo new > "$src/plugins/p/a.txt"; echo x > "$src/README.md"
echo x > "$src/docs/specs/s.md"; echo x > "$src/docs/guides/g.md"
git -C "$src" add -A; git -C "$src" commit -qm src
echo untracked > "$src/plugins/p/untracked.txt"

pub="$(tmp)"
git -C "$pub" init -q
git -C "$pub" config user.email t"@"x.invalid; git -C "$pub" config user.name t
mkdir -p "$pub/plugins/p" "$pub/plugins/gone"
echo old > "$pub/plugins/p/a.txt"; echo x > "$pub/plugins/gone/b.txt"; echo x > "$pub/.gitignore"
git -C "$pub" add -A; git -C "$pub" commit -qm pub

expect_rc 0 "sync into a clean public clone" bash "$src/scripts/sync_public.sh" --no-private "$pub"
[ "$(cat "$pub/plugins/p/a.txt")" = new ] || fail "changed file not copied"
for f in README.md docs/guides/g.md scripts/sync_public.sh; do [ -f "$pub/$f" ] || fail "missing $f"; done
for f in docs/specs/s.md plugins/p/untracked.txt; do [ ! -e "$pub/$f" ] || fail "should not be copied: $f"; done
[ -f "$pub/plugins/gone/b.txt" ] || fail "public-only file was deleted"
echo "$OUT" | grep -q "plugins/gone/b.txt" || fail "public-only file not listed: $OUT"
echo "$OUT" | grep -q ".gitignore" && fail ".gitignore should not be listed: $OUT"
pass "published files copied, private and untracked ones not, public-only file listed and kept"

expect_rc 1 "dirty public clone refused" bash "$src/scripts/sync_public.sh" --no-private "$pub"

git -C "$pub" add -A; git -C "$pub" commit -qm synced
echo "contact: someone"@"x.com" > "$src/docs/guides/g.md"; git -C "$src" commit -qam leak
expect_rc 1 "leak scan failure fails the sync" bash "$src/scripts/sync_public.sh" --no-private "$pub"
