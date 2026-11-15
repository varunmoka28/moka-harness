// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0
//
// Strict Guard: decides destructive Bash commands by fixed rules, with nobody asked.
// Adapted from Blast Radius (anthropics/claude-code-playground): its command
// classifier and dry runs are kept, the pane and the hold are replaced by rules.
//
// tool.call (Bash): every destructive part of the command line is checked. All
// allowed: the command runs as written. One refused, or one the guard cannot
// measure: the command is refused and the reason goes back to the model.
//
// The default is to refuse. A delete is allowed only in a temp folder or of a
// build leftover inside the project; a git discard only when it discards nothing;
// a force push only when it drops no commits and is not to a protected branch.
//
// The host reads `on(...)` and `$.noun.method(...)` from source, so they are
// spelled literally, and helpers that take `$` are top-level functions.

// A delete is allowed strictly inside these folders (real paths, symlinks resolved)
const TEMP_ROOTS = ["/private/tmp", "/tmp", "/private/var/folders", "/var/folders"];
// ...or of these regenerable folders, anywhere inside the session's project
const LEFTOVERS = new Set(["node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);
const PROTECTED_BRANCHES = new Set(["main", "master"]);
// A variable, a command substitution, braces, an escape or a stray quote: only
// the shell knows what the word becomes, so the guard does not guess.
const UNREADABLE = /[$`{}\\"']/;

export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const risks = classify(String(e.command ?? ""));
    if (risks.length === 0) {
      return next(e);
    }
    let refusal;
    try {
      refusal = await firstRefusal($, risks);
    } catch (error) {
      // Anything unexpected refuses the command
      refusal = `the guard hit an error while checking it (${String(error?.message ?? error).slice(0, 120)})`;
    }
    if (refusal === null) {
      return next(e);
    }
    return {
      deny: `Strict Guard refused this command and did not run it: ${refusal}. Do not retry it and do not work around it with another command. Say what you wanted to do and why, and let the user decide.`,
    };
  });
}

/** Why the command is refused, from the first risky part that fails its rule; null when all pass. */
async function firstRefusal($, risks) {
  const sessionCwd = await $.session.cwd();
  const root = await $.session.root();
  for (const risk of risks) {
    // Where the part runs: the session folder, moved by any `cd dir &&` or `git -C dir` before it
    const cwd = risk.dir ? await resolveDir($, sessionCwd, risk.dir) : sessionCwd;
    if (cwd === null) {
      return `${risk.label} runs in a folder the guard could not find (${risk.dir})`;
    }
    const refusal = await check($, risk, cwd, root);
    if (refusal !== null) {
      return refusal;
    }
  }
  return null;
}

async function check($, risk, cwd, root) {
  if (risk.kind === "migrate") {
    return `${risk.label} changes a database`;
  }
  if (risk.kind === "refuse") {
    return risk.why;
  }
  if (risk.kind === "rm") {
    return await checkRm($, risk, cwd, root);
  }
  if (risk.kind === "git-push-force") {
    return await checkPush($, risk, cwd);
  }
  if (risk.kind === "git-clean") {
    return await checkClean($, risk, cwd);
  }
  return await checkDiscard($, risk, cwd);
}

// ---- What counts as risky -------------------------------------------------

// Commands that only read, so a bare word "migrate" in them isn't a migration.
const READ_ONLY = new Set(["ls", "cat", "echo", "printf", "grep", "rg", "find", "less", "head", "tail", "cd", "git"]);

/** A folder a later `cd arg` moves to, given the folder so far (null = the session folder). */
function joinDir(dir, arg) {
  if (arg === undefined || arg === "~" || arg.startsWith("/") || arg.startsWith("~/")) {
    return arg ?? "~";
  }
  return dir ? `${dir}/${arg}` : arg;
}

/** Every risky segment of a shell command, in order. */
function classify(command, startDir = null) {
  const risks = [];
  let dir = startDir; // where a `cd` earlier on the line moved to; null means the session folder
  const scopes = []; // dir to restore when a ( subshell ) closes
  const pushed = []; // pushd stack, for popd
  // A single & also ends a command, but not in 2>&1, >&2 or &>file
  for (const raw of command.split(/&&|\|\||;|\||\n|(?<![>&])&(?![>&])/)) {
    const opens = (raw.match(/^\s*\(+/)?.[0].trim().length) ?? 0;
    // Trailing redirects and & don't hide a closing ) : `(cd sub && make) > log`.
    const tail = raw.replace(/(?:\s*(?:\d*>>?|&>>?|<)\s*\S+|\s*&)+\s*$/, "");
    const closes = (tail.match(/\)+\s*$/)?.[0].trim().length) ?? 0;
    for (let k = 0; k < opens; k += 1) {
      scopes.push(dir);
    }
    risks.push(...nested(raw, dir));
    const risk = classifySegment(raw, dir, pushed);
    if (risk !== null && risk.cd === undefined) {
      risks.push(risk);
    } else if (risk !== null) {
      dir = risk.cd; // a cd, pushd or popd moved the folder
    }
    for (let k = 0; k < closes && scopes.length > 0; k += 1) {
      dir = scopes.pop(); // a cd inside ( ... ) doesn't outlive it
    }
  }
  return risks;
}

// Commands whose run inside another command the guard cannot follow, unless it reads them itself.
const OPAQUE_DELETERS = new Set(["rm", "unlink", "rmdir", "shred", "sh", "bash", "zsh"]);

/** Risks hidden inside a segment: $( ), backticks, <( ), `bash -c '...'` and `eval ...`. */
function nested(segment, dir) {
  // Every substitution on the line; each one runs to the end of it, and later ones are found on their own
  const inner = [...segment.matchAll(/[$<>]\(/g)].map((m) => segment.slice(m.index + 2).replace(/\)[^)]*$/, ""));
  inner.push(...[...segment.matchAll(/`([^`]*)`?/g)].map((m) => m[1]));
  const words = tokenize(segment);
  words.forEach((w, i) => {
    if (/^(?:.*\/)?(?:ba|z|da)?sh$/.test(w) && /^-[a-z]*c$/.test(words[i + 1] ?? "") && words[i + 2] !== undefined) {
      inner.push(words[i + 2]);
    } else if (w === "eval") {
      inner.push(words.slice(i + 1).join(" "));
    }
  });
  return inner.flatMap((text) => classify(text, dir));
}

const refuse = (label, why, dir) => ({ kind: "refuse", label, why, dir });

// Words that can come before the real command without changing what it does.
const PREFIXES = new Set(["then", "do", "else", "!"]);
// Wrapper commands: the options that take a value (so it isn't read as the command),
// "arg" when a bare argument comes after the options (timeout's duration), "query"
// for options that only look the command up instead of running it.
const WRAPPERS = {
  sudo: { value: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U", "--user", "--group", "--host", "--prompt", "--role", "--type", "--chdir"]) },
  doas: { value: new Set(["-u", "-C"]) },
  setsid: {},
  ionice: { value: new Set(["-c", "-n", "-p", "-P", "-u"]) },
  env: { value: new Set(["-u", "-C", "--unset", "--chdir"]) },
  command: { query: new Set(["-v", "-V"]) },
  exec: { value: new Set(["-a"]) },
  nohup: {},
  time: { value: new Set(["-f", "-o", "--format", "--output"]) },
  nice: { value: new Set(["-n", "--adjustment"]) },
  timeout: { value: new Set(["-s", "-k", "--signal", "--kill-after"]), arg: true },
  stdbuf: { value: new Set(["-i", "-o", "-e"]) },
  builtin: {},
};

/** The command a word names: no backslash, no folder ("\rm", "/bin/rm" are rm). Quotes are already gone. */
const commandName = (word) => word.replace(/^.*\//, "").replace(/^\\/, "");

/** Drops VAR=value words, prefix words and wrapper commands with their options; what is left starts with the real command. */
function stripWrappers(words) {
  while (words.length > 0) {
    const word = words[0];
    const name = commandName(word);
    const wrapper = Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : undefined;
    if (PREFIXES.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      words.shift();
    } else if (wrapper === undefined) {
      break;
    } else {
      words.shift();
      while (words.length > 0 && words[0].startsWith("-") && words[0] !== "-") {
        const option = words.shift();
        if (wrapper.query?.has(option)) {
          return []; // `command -v rm` only looks rm up
        }
        if (option === "--") {
          break;
        }
        if (name === "env" && (option === "-S" || option === "--split-string" || option.startsWith("--split-string="))) {
          // env -S "rm -rf x" runs that string as a command line
          words.unshift(...tokenize(option.includes("=") ? option.slice(option.indexOf("=") + 1) : (words.shift() ?? "")));
          break;
        }
        if (wrapper.value?.has(option)) {
          words.shift();
        }
      }
      if (wrapper.arg) {
        words.shift();
      }
    }
  }
  return words;
}

/** One segment: a risk, { cd } for a folder change, or null. */
function classifySegment(segment, dir, pushed) {
  const words = stripWrappers(tokenize(segment.trim().replace(/^[({]+\s*/, "").replace(/\s*[)}]+$/, "")));
  const [first, ...args] = words;
  if (first === undefined) {
    return null;
  }
  const cmd = commandName(first);
  if (cmd === "cd") {
    return { cd: args[0] === "-" ? "-" : joinDir(dir, args[0]) };
  }
  if (cmd === "pushd") {
    pushed.push(dir);
    return { cd: joinDir(dir, args[0]) };
  }
  if (cmd === "popd") {
    return { cd: pushed.length > 0 ? pushed.pop() : "-" };
  }
  if (cmd === "xargs" && args.some((a) => OPAQUE_DELETERS.has(commandName(a)))) {
    return refuse("xargs", "xargs would delete paths the guard cannot see", null);
  }
  if (cmd === "find") {
    const exec = args.findIndex((a, i) => /^-(exec|execdir|ok|okdir)$/.test(a) && OPAQUE_DELETERS.has(commandName(args[i + 1] ?? "")));
    if (args.includes("-delete") || exec !== -1) {
      return refuse("find", "find would delete paths the guard cannot see", null);
    }
  }
  if (cmd === "rm" || cmd === "unlink" || cmd === "rmdir" || cmd === "shred") {
    // Every rm is checked, with or without -r and -f. After `--` every word is a path.
    const end = args.indexOf("--");
    const options = end === -1 ? args : args.slice(0, end);
    const flags = options.filter((a) => a.startsWith("-") && a !== "-");
    const targets = [...options.filter((a) => !a.startsWith("-") || a === "-"), ...(end === -1 ? [] : args.slice(end + 1))];
    return { kind: "rm", label: `rm ${flags.join(" ")}`.trim(), targets, dir };
  }
  if (cmd === "git") {
    // Git's own options come before the subcommand; -C moves where it runs.
    let gitDir = dir;
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) {
      if (args[i] === "-C" && i + 1 < args.length) {
        gitDir = joinDir(gitDir, args[i + 1]);
        i += 2;
      } else if (args[i] === "-c" && i + 1 < args.length) {
        i += 2;
      } else {
        i += 1;
      }
    }
    const sub = args[i];
    const rest = args.slice(i + 1);
    if (sub === "reset" && rest.includes("--hard")) {
      return { kind: "git-reset", label: "git reset --hard", args: rest, dir: gitDir };
    }
    if (sub === "clean") {
      return { kind: "git-clean", label: "git clean", args: rest, dir: gitDir };
    }
    if (sub === "branch" && rest.some((a) => /^-[a-zA-Z]*D[a-zA-Z]*$/.test(a))) {
      return refuse("git branch -D", "git branch -D deletes a branch whose commits may become unreachable", null);
    }
    if (sub === "stash" && (rest[0] === "drop" || rest[0] === "clear")) {
      return refuse(`git stash ${rest[0]}`, `git stash ${rest[0]} throws away saved work`, null);
    }
    if (sub === "push" && rest.some((a) => a === "--delete" || a === "-d" || /^:./.test(a))) {
      return refuse("git push --delete", "it deletes a branch on the remote", null);
    }
    if (sub === "push" && rest.some((a) => a.startsWith("--force") || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || /^\+/.test(a))) {
      return { kind: "git-push-force", label: "git push --force", args: rest, dir: gitDir };
    }
    const stagedOnly = sub === "restore" && rest.includes("--staged") && !rest.includes("--worktree") && !rest.includes("-W");
    if (((sub === "checkout" && (rest.includes(".") || rest.includes("--"))) || sub === "restore") && !stagedOnly) {
      return { kind: "git-checkout", label: `git ${sub} -- <paths>`, args: rest, dir: gitDir };
    }
  }
  const joined = words.join(" ");
  if (/\balembic\s+upgrade\b/.test(joined)) {
    return { kind: "migrate", label: "alembic upgrade", dir };
  }
  if (/\bdb:migrate(?!:status\b)/.test(joined)) {
    return { kind: "migrate", label: "db:migrate", dir };
  }
  if (/\bprisma\s+migrate\b/.test(joined)) {
    return { kind: "migrate", label: "prisma migrate", dir };
  }
  if (/\bmanage\.py\s+migrate\b/.test(joined)) {
    return { kind: "migrate", label: "manage.py migrate", dir };
  }
  if (!READ_ONLY.has(cmd) && args.includes("migrate")) {
    return { kind: "migrate", label: "migrate", dir };
  }
  return null;
}

// Resolves a `cd` target to an absolute folder, or null if it doesn't exist.
// The target is passed as an argument, never as source.
const CD_SCRIPT = `unset CDPATH; d="$1"; case "$d" in "~") d="$HOME";; "~/"*) d="$HOME/\${d#\\~/}";; esac; cd -- "$d" 2>/dev/null && pwd -P`;

async function resolveDir($, sessionCwd, dir) {
  if (dir === "-") {
    return null; // `cd -` depends on the shell's history
  }
  const run = await $.process.run(["bash", "-c", CD_SCRIPT, "strict-guard", dir], { cwd: sessionCwd, timeoutMs: 5000 });
  const out = run.stdout.trim();
  return run.exitCode === 0 && out !== "" ? out : null;
}

/** Splits one segment into words, honouring quotes. Good enough to read flags and paths. */
function tokenize(text) {
  const words = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    words.push(m[1] ?? m[2] ?? m[3]);
  }
  return words;
}

// ---- The rules --------------------------------------------------------------

// Expands globs and ~ as rm would see them and prints the real path of each
// path that exists ("?" for one it cannot resolve). The paths are passed to
// bash as arguments, never as source, so nothing in them runs.
const RM_SCRIPT = `
shopt -s nullglob dotglob
for p in "$@"; do
  case "$p" in "~") p="$HOME";; "~/"*) p="$HOME/\${p#\\~/}";; esac
  if [[ "$p" == *[*?[]* ]]; then
    while IFS= read -r m; do realpath -- "$m" 2>/dev/null || echo "?"; done < <(compgen -G "$p")
  elif [[ -e "$p" || -L "$p" ]]; then
    realpath -- "$p" 2>/dev/null || echo "?"
  fi
done
exit 0
`;

/** A delete passes only when every path it reaches is disposable. */
async function checkRm($, risk, cwd, root) {
  const odd = risk.targets.find((t) => UNREADABLE.test(t) || /^~[^/]/.test(t));
  if (odd !== undefined) {
    return `the guard cannot tell what ${odd} becomes once the shell expands it`;
  }
  const run = await $.process.run(["bash", "-c", RM_SCRIPT, "strict-guard", ...risk.targets], { cwd, timeoutMs: 15000 });
  if (run.exitCode !== 0 || run.isStdoutTruncated) {
    return `the guard could not list what ${risk.label} would delete`;
  }
  for (const path of run.stdout.split("\n").filter((l) => l !== "")) {
    if (path === "?") {
      return `${risk.label} would delete a path the guard could not resolve`;
    }
    if (!isDisposable(path, root)) {
      return `it would delete ${path}, which is not in a temp folder and not a build leftover`;
    }
  }
  return null;
}

function isDisposable(path, root) {
  if (TEMP_ROOTS.some((temp) => path.startsWith(`${temp}/`))) {
    return true;
  }
  return path.startsWith(`${root}/`) && path.split("/").some((part) => LEFTOVERS.has(part));
}

/** git reset --hard, git checkout -- . and git restore . pass only when they discard nothing. */
async function checkDiscard($, risk, cwd) {
  // `git reset --hard <commit>` also moves the branch, whatever the working tree holds
  const moved = risk.kind === "git-reset" ? risk.args.find((a) => !a.startsWith("-") && a !== "HEAD") : undefined;
  if (moved !== undefined) {
    return `git reset --hard ${moved} moves the branch to another commit`;
  }
  const status = await $.process.run(["git", "status", "--porcelain"], { cwd, timeoutMs: 15000 });
  if (status.exitCode !== 0) {
    return `the guard could not read git status for ${risk.label}`;
  }
  const rows = status.stdout.split("\n").filter((l) => l.length > 3 && !l.startsWith("??"));
  // reset --hard drops staged and unstaged changes; checkout -- . drops unstaged ones.
  const lost = risk.kind === "git-reset" ? rows : rows.filter((l) => l[1] !== " ");
  if (lost.length === 0) {
    return null;
  }
  return `${risk.label} would throw away uncommitted changes in ${lost.length} ${lost.length === 1 ? "file" : "files"} (${lost[0].slice(3)}${lost.length > 1 ? ", ..." : ""})`;
}

/** git clean passes only when its own dry run removes nothing. */
async function checkClean($, risk, cwd) {
  const flags = [];
  const paths = [];
  for (let i = 0; i < risk.args.length; i += 1) {
    const a = risk.args[i];
    if (a === "--") {
      paths.push(...risk.args.slice(i + 1));
      break;
    }
    if (a === "-e" || a === "--exclude") {
      flags.push(a, risk.args[i + 1] ?? "");
      i += 1;
    } else if (a.startsWith("--exclude=") || /^-e./.test(a)) {
      flags.push(a);
    } else if (/^-[a-zA-Z]+$/.test(a)) {
      const kept = a.replace(/[finq]/g, ""); // -n is added below; -f, -i and -q would change the dry run
      if (kept !== "-") {
        flags.push(kept);
      }
    } else if (!a.startsWith("-")) {
      paths.push(a);
    }
  }
  const run = await $.process.run(["git", "clean", "-n", ...flags, "--", ...paths], { cwd, timeoutMs: 15000 });
  if (run.exitCode !== 0) {
    return "the guard could not dry-run git clean";
  }
  const gone = run.stdout.split("\n").filter((l) => l.startsWith("Would remove ")).map((l) => l.slice(13));
  if (gone.length === 0) {
    return null;
  }
  return `git clean would remove ${gone.length} untracked ${gone.length === 1 ? "path" : "paths"} (${gone[0]}${gone.length > 1 ? ", ..." : ""}), which git cannot bring back`;
}

/** A force push passes only to one unprotected branch, and only when it drops no commits. */
async function checkPush($, risk, cwd) {
  const positional = risk.args.filter((a) => !a.startsWith("-"));
  if (positional.length > 2 || risk.args.some((a) => a === "--all" || a === "--mirror" || a === "--tags")) {
    return "it force-pushes more than one branch";
  }
  const remote = positional[0] ?? "origin";
  // A refspec is src:dst. With no colon, the local branch of the same name is pushed.
  const spec = (positional[1] ?? "").replace(/^\+/, "");
  let [source, branch] = spec.includes(":") ? spec.split(":") : [spec, spec];
  branch = (branch ?? "").replace(/^refs\/heads\//, "");
  if (!branch || branch === "HEAD") {
    // No branch named, or `git push origin HEAD`: the current branch goes to its namesake
    const head = await $.process.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 10000 });
    branch = head.stdout.trim();
    source = "HEAD";
  }
  source = source || "HEAD";
  if (!branch || PROTECTED_BRANCHES.has(branch)) {
    return `it force-pushes to ${branch || "a branch the guard could not name"}`;
  }
  const ref = `${remote}/${branch}`;
  const known = await $.process.run(["git", "rev-parse", "--verify", "--quiet", ref], { cwd, timeoutMs: 10000 });
  if (known.exitCode !== 0) {
    return `the guard has no local copy of ${ref}, so it cannot tell which commits the force push would drop`;
  }
  // ponytail: judged against the last fetch of the remote branch. If several agents ever push one branch, compare with `git ls-remote` first.
  const log = await $.process.run(["git", "log", "--oneline", "--no-decorate", `${source}..${ref}`], { cwd, timeoutMs: 15000 });
  if (log.exitCode !== 0) {
    return `the guard could not compare ${source} with ${ref}`;
  }
  const dropped = log.stdout.split("\n").filter((l) => l !== "");
  if (dropped.length === 0) {
    return null;
  }
  return `the force push would drop ${dropped.length} ${dropped.length === 1 ? "commit" : "commits"} from ${ref} (${dropped[0]}${dropped.length > 1 ? ", ..." : ""})`;
}
