// Read Fence: while on, Read, Glob, Grep and Bash may not touch the folders that
// already enter the context as a listing (skills, rules, plugin cache). Off by
// default. The switch lives in read-fence.json inside the Claude config folder
// (CLAUDE_CONFIG_DIR, or ~/.claude when that is not set).
//
// Exempt even when on: the skill the model just invoked (its folder, learnt from
// skill.prompt), any CLAUDE.md, and the memory folders under the config folder.
//
// Options: `configDirs` lists the config folders to fence (the first keeps the
// switch, so accounts given the same list share it); `exempt` lists folders that
// are never fenced. Both are comma-separated and may start with ~.

const SETTINGS = "read-fence.json";
const BLOCKED_IN_CONFIG = ["plugins/cache", "skills", "rules"];
const BLOCKED_IN_PROJECT = [".claude/skills", ".claude/rules"];

// Folders of skills invoked this session (absolute, from the skill prompt's base dir line)
const invoked = new Set();

// The manifest's options, set again on every load
let opts = {};

export function register(on, options = {}) {
  opts = options;
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "read-fence",
      description: "Turn the read fence on or off, or show its state: on, off or status",
      argumentHint: "on|off|status",
    });
    return next(e);
  });

  on("command.run", ($, e, next) => runCommand($, e, next).catch(() => next(e)));

  on("skill.prompt", async ($, e, next) => {
    const m = /Base directory for this skill:\s*(\S+)/.exec(String(e.text ?? ""));
    if (m) invoked.add(m[1].replace(/\/+$/, ""));
    return next(e);
  });

  // The fence is a convenience: if it cannot decide, the call goes through.
  on("tool.call", { tool: ["Read", "Glob", "Grep", "Bash"] }, ($, e, next) => guard($, e, next).catch(() => next(e)));
}

async function runCommand($, e, next) {
  if (e.command !== "read-fence") return next(e);
  const arg = String(e.args ?? "").trim().toLowerCase();
  if (arg === "on" || arg === "off") {
    try {
      await setOn($, await configDirs($), arg === "on");
    } catch {
      return { text: `read-fence could not save its setting, so it is still ${(await isOn($, await configDirs($))) ? "on" : "off"}` };
    }
    return { text: `read-fence ${arg}` };
  }
  return { text: `read-fence is ${(await isOn($, await configDirs($))) ? "on" : "off"}` };
}

async function guard($, e, next) {
  const configs = await configDirs($);
  if (!(await isOn($, configs))) return next(e);
  const home = await $.env.get("HOME");
  const exempt = list(opts.exempt, home);
  const root = await $.session.root();
  const cwd = await $.session.cwd();
  for (const p of await touched($, e, cwd, home)) {
    const why = await blocked($, p, configs, exempt, root);
    if (why) {
      return {
        deny: `Read Fence refused ${e.tool} on ${p}: ${why}. The fence is on (/read-fence off lifts it). Skill folders enter the context as name and description already; invoke a skill with the Skill tool instead of reading its folder.`,
      };
    }
  }
  return next(e);
}

/** A comma-separated option as absolute folders, ~ expanded. */
function list(value, home) {
  return String(value ?? "")
    .split(",")
    .map((p) => p.trim().replace(/^~(?=\/|$)/, home).replace(/\/+$/, ""))
    .filter(Boolean);
}

/** The config folders to fence; the first keeps the switch. */
async function configDirs($) {
  const home = await $.env.get("HOME");
  const given = list(opts.configDirs, home);
  if (given.length) return given;
  const set = await $.env.get("CLAUDE_CONFIG_DIR");
  return [(set || `${home}/.claude`).replace(/\/+$/, "")];
}

async function isOn($, configs) {
  try {
    return JSON.parse(await $.fs.read(`${configs[0]}/${SETTINGS}`)).on === true;
  } catch {
    return false;
  }
}

async function setOn($, configs, on) {
  await $.fs.write(`${configs[0]}/${SETTINGS}`, JSON.stringify({ on }) + "\n");
}

/** The absolute paths a call reaches, as spelled. */
async function touched($, e, cwd, home) {
  const abs = (p) => (p.startsWith("/") ? p : `${cwd}/${p}`);
  if (e.tool === "Read") return [abs(String(e.file_path ?? ""))];
  if (e.tool === "Glob" || e.tool === "Grep") {
    const base = abs(String(e.path ?? "."));
    const out = [base];
    const pat = String(e.pattern ?? "");
    // A Glob pattern can reach a folder by itself, absolute or relative to the search path.
    if (e.tool === "Glob" && pat) out.push(pat.startsWith("/") ? pat.split("*")[0] : `${base}/${pat.split("*")[0]}`);
    return out;
  }
  // Bash: every absolute or ~ path spelled in the command line
  const command = String(e.command ?? "").replace(/\$\{HOME\}|\$HOME/g, home);
  const found = command.match(/(?:~|\/)[\w./@-]+/g) ?? [];
  return found.map((p) => (p.startsWith("~") ? home + p.slice(1) : p));
}

/** Why `path` is fenced, or null. Spelled path decides exemptions; spelled and real path decide blocks. */
async function blocked($, path, configs, exempt, root) {
  const under = (p, dir) => p === dir || p.startsWith(dir + "/");
  if (/(^|\/)CLAUDE\.md$/.test(path)) return null;
  if (path === `${configs[0]}/${SETTINGS}`) return null;
  for (const c of configs) if (/\/projects\/[^/]+\/memory(\/|$)/.test(path) && under(path, c)) return null;
  for (const dir of [...exempt, ...invoked]) if (under(path, dir)) return null;

  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath;
  for (const p of real && real !== path ? [path, real] : [path]) {
    for (const c of configs) for (const b of BLOCKED_IN_CONFIG) if (under(p, `${c}/${b}`)) return `${b} is fenced`;
    for (const b of BLOCKED_IN_PROJECT) if (under(p, `${root}/${b}`)) return `${b} is fenced`;
    for (const dir of invoked) if (under(p, dir)) return null;
  }
  return null;
}
