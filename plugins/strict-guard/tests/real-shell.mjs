// Runs the guard's rules against the real shell and real git, outside Claude Code:
//   node tests/real-shell.mjs <a real git repo with uncommitted changes>
// The guard only measures (realpath, git status, git clean -n, git log). The
// commands under test are never run: `next` here is a stub.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import { register } from "../hooks/strict-guard.mjs";

let hook;
register((event, matcher, fn) => {
  hook = fn;
});

function sh(cwd, ...argv) {
  const run = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`${argv.join(" ")} failed: ${run.stderr}`);
  }
}

async function decide(command, cwd, root = cwd) {
  const $ = {
    session: { cwd: async () => cwd, root: async () => root },
    process: {
      run: async (argv, init = {}) => {
        const run = spawnSync(argv[0], argv.slice(1), { cwd: init.cwd, encoding: "utf8", timeout: init.timeoutMs });
        return { exitCode: run.status ?? -1, stdout: run.stdout ?? "", stderr: run.stderr ?? "", isStdoutTruncated: false, isStderrTruncated: false };
      },
    },
  };
  const answer = await hook($, { tool: "Bash", command }, async () => ({ result: "ran" }));
  return answer.deny === undefined ? "allow" : `refuse: ${answer.deny}`;
}

const repo = process.argv[2];
if (!repo) {
  throw new Error("pass a real git repo with uncommitted changes");
}

// A scratch area in /tmp: a clean repo with a local remote, a dirty branch state for force pushes
const tmp = mkdtempSync("/tmp/strict-guard-");
const remote = `${tmp}/remote.git`;
const clean = `${tmp}/clean`;
sh(tmp, "git", "init", "--quiet", "--bare", remote);
sh(tmp, "git", "clone", "--quiet", remote, clean);
writeFileSync(`${clean}/a.txt`, "one\n");
sh(clean, "git", "add", "a.txt");
sh(clean, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "one");
sh(clean, "git", "checkout", "--quiet", "-b", "feature");
sh(clean, "git", "push", "--quiet", "origin", "feature");
mkdirSync(`${tmp}/junk/deep`, { recursive: true });
writeFileSync(`${tmp}/junk/deep/file.txt`, "x");
symlinkSync(homedir(), `${tmp}/escape`);

const cases = [
  // [expected, command, cwd]
  ["allow", "ls -la", repo],
  ["allow", `rm -rf ${tmp}/junk`, repo],
  ["allow", `sudo rm -rf ${tmp}/junk/deep/*`, repo],
  ["allow", "rm -f /tmp/strict-guard-does-not-exist", repo],
  ["allow", "rm -rf node_modules/.cache", repo],
  ["allow", "git reset --hard", clean],
  ["allow", `git -C ${clean} reset --hard HEAD`, repo],
  ["allow", "git clean -fd", clean],
  ["allow", "git push --force origin feature", clean],
  ["refuse", "rm README.md", repo],
  ["refuse", "rm -rf services/api/data", repo],
  ["refuse", "rm -f .env", repo],
  ["refuse", "rm -rf ~/.claude/skills", repo],
  ["refuse", `rm -rf ${tmp}/junk && rm -rf ~/projects`, repo],
  ["refuse", "rm -rf /tmp", repo],
  ["refuse", `rm -rf ${tmp}/escape/projects`, repo],
  // From /tmp (really /private/tmp), ../Users is /private/Users, which does not exist: the real rm deletes nothing too
  ["allow", "cd /tmp && rm -rf ../Users", repo],
  ["refuse", "cd /tmp && rm -rf ../../Users", repo],
  ["refuse", 'rm -rf "$HOME/projects"', repo],
  ["refuse", "rm -rf my\\ dir", repo],
  ["refuse", "rm -rf ~root/x", repo],
  ["refuse", "git reset --hard", repo],
  ["refuse", "git reset --hard HEAD~1", clean],
  ["refuse", "git checkout -- .", repo],
  ["refuse", "git clean -fd", repo],
  ["refuse", "git push --force origin main", clean],
  ["refuse", "git push --force --all", clean],
  ["refuse", "npx prisma migrate deploy", repo],
  // Bypasses found in review
  ["refuse", "true & rm -rf ~", repo],
  ["refuse", "echo $(rm -rf ~)", repo],
  ["refuse", "echo `rm -rf ~`", repo],
  ["refuse", "bash -c 'rm -rf ~'", repo],
  ["refuse", 'sh -c "rm -rf ~/projects"', repo],
  ["refuse", "eval rm -rf ~/projects", repo],
  ["refuse", "ls | xargs rm", repo],
  ["refuse", "find . -delete", repo],
  ["refuse", "find . -name x -exec rm {} \\;", repo],
  ["refuse", "unlink README.md", repo],
  ["refuse", "rmdir services", repo],
  ["refuse", "git branch -D feature", clean],
  ["refuse", "git stash drop", clean],
  ["refuse", "git stash clear", clean],
  ["refuse", "git push --delete origin feature", clean],
  ["refuse", "git push origin :feature", clean],
  ["refuse", "git push -fu origin main", clean],
  ["refuse", "git checkout -- README.md", repo],
  ["refuse", "git restore README.md", repo],
  // Harmless things the new rules must not catch
  ["allow", "echo $(date) && ls 2>&1", repo],
  ["allow", "ls >&2 & echo done", repo],
  ["allow", "bash -c 'echo hi'", repo],
  ["allow", "git checkout -- README.md", clean],
  // Wrappers, substitutions and command paths that must not hide an rm
  ["refuse", "env -i rm -rf ~", repo],
  ["refuse", "env -u HOME FOO=1 rm -rf ~", repo],
  ["refuse", "command -p rm -rf ~", repo],
  ["refuse", "time -p rm -rf ~", repo],
  ["refuse", "nohup rm -rf ~", repo],
  ["refuse", "exec -c rm -rf ~", repo],
  ["refuse", "exec -a name rm -rf ~", repo],
  ["refuse", "sudo -u root nohup env rm -rf ~", repo],
  ["refuse", "nice -n 5 rm -rf ~", repo],
  ["refuse", "timeout 5 rm -rf ~", repo],
  ["refuse", "timeout -s KILL 5 rm -rf ~", repo],
  ["refuse", "stdbuf -oL rm -rf ~", repo],
  ["refuse", "builtin rm -rf ~", repo],
  ["refuse", "\\rm -rf ~", repo],
  ["refuse", '"rm" -rf ~', repo],
  ["refuse", "/bin/rm -rf ~", repo],
  ["refuse", "echo `date` `rm -rf ~`", repo],
  ["refuse", "echo `rm -rf ~` `date`", repo],
  ["refuse", "echo $(date) $(rm -rf ~)", repo],
  ["refuse", "echo `date` $(rm -rf ~)", repo],
  ["refuse", "ls | xargs /bin/rm", repo],
  ["refuse", "ls | xargs -0 -n1 /usr/bin/rm", repo],
  ["refuse", "find . -exec /bin/rm {} \\;", repo],
  ["refuse", "echo $(rm -rf ~) $(date)", repo],
  ["refuse", "env -S 'rm -rf ~'", repo],
  ["refuse", "/bin/\\rm -rf ~", repo],
  ["refuse", "setsid rm -rf ~", repo],
  ["refuse", "ionice -c3 rm -rf ~", repo],
  ["refuse", "sudo --user root rm -rf ~", repo],
  // The same wrappers around harmless commands stay allowed
  ["allow", "env FOO=1 ls", repo],
  ["allow", "env -i ls", repo],
  ["allow", "nohup sleep 1", repo],
  ["allow", "time -p ls", repo],
  ["allow", "command -p ls", repo],
  ["allow", "command -v rm", repo],
  ["allow", "exec -a name ls", repo],
  ["allow", "timeout 5 ls", repo],
  ["allow", "stdbuf -oL ls", repo],
  ["allow", "nice -n 5 ls", repo],
  ["allow", "ls | xargs echo", repo],
  ["allow", "ls | xargs /bin/echo", repo],
  ["allow", "echo `date` `date`", repo],
  ["allow", "echo $(date) $(pwd)", repo],
  ["allow", `env FOO=1 rm -rf ${tmp}/junk`, repo],
];

// A force push that would drop a commit: the remote branch gets one the local branch lacks
writeFileSync(`${clean}/b.txt`, "two\n");
sh(clean, "git", "add", "b.txt");
sh(clean, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "two");
sh(clean, "git", "push", "--quiet", "origin", "feature");
const before = cases.length;
let failed = 0;
for (const [expected, command, cwd] of cases) {
  // The plain `feature` force push above is judged before the reset below would matter
  const got = await decide(command, cwd);
  const ok = got.startsWith(expected);
  failed += ok ? 0 : 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${expected.padEnd(6)} ${command}${ok && expected === "allow" ? "" : `\n       -> ${got.slice(0, 230)}`}`);
}
sh(clean, "git", "reset", "--quiet", "--hard", "HEAD~1");
const drop = await decide("git push --force origin feature", clean);
failed += drop.startsWith("refuse") && drop.includes("drop 1 commit") ? 0 : 1;
console.log(`${drop.includes("drop 1 commit") ? "ok  " : "FAIL"} refuse git push --force origin feature (one commit behind the remote)\n       -> ${drop.slice(0, 230)}`);

console.log(`\n${before + 1 - failed} of ${before + 1} as expected`);
process.exit(failed === 0 ? 0 : 1);
