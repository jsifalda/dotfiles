#!/usr/bin/env node

// sync-skills.js: pre-launch sync that mirrors skill directories into Copilot CLI.
// Wired via a shell function so it runs every time `copilot` is invoked.
//
// Machine-agnostic: the sources and the name filters live in a per-machine config
// file outside this repo, gitignored, seeded from sources.conf.example:
//   ${XDG_CONFIG_HOME:-$HOME/.config}/copilot-sync/sources.conf
//
// Config format (mirrors site-tmux's sites.conf):
//   - one `key=value` per line, '#' starts a comment to end of line, blanks skipped
//   - surrounding whitespace is trimmed, a leading '~' in a value expands to $HOME
//   - keys repeat; `source` order is priority order, first source wins on a name conflict
//   - recognized keys: source, whitelist, blacklist. Anything else is ignored.
//   - a non-empty whitelist wins over blacklist (include-only), otherwise blacklist excludes
//
// With no readable config it falls back to a single source, ~/instructions/skills, and no
// filters. The hook runs before every `copilot` invocation, so it stays silent and harmless
// on a machine that has neither Copilot nor a config.
//
// Notes:
//   - Targets ~/.copilot/skills/
//   - Copies directories (Copilot CLI ignores symlinked skills, see github/copilot-cli#1021)
//   - Drops a .managed-by-copilot-sync marker so we never delete user-installed skills
//   - Skips silently if ~/.copilot/ does not exist
//   - isFresh() (below) is where this repo copy intentionally differs from the machine-local
//     Claude Code counterpart hook, so the two are no longer identical on purpose

const fs = require('fs');
const path = require('path');
const os = require('os');

const COPILOT_HOME = path.join(os.homedir(), '.copilot');
const SKILLS_DIR = path.join(COPILOT_HOME, 'skills');
const MARKER = '.managed-by-copilot-sync';

const CONFIG_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'copilot-sync',
  'sources.conf'
);

const DEFAULT_SOURCES = [path.join(os.homedir(), 'instructions', 'skills')];

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

// Parse the per-machine config into { sources, whitelist, blacklist }.
// Unreadable or absent config -> defaults. Never throws, never warns loudly.
function loadConfig() {
  const sources = [];
  const whitelist = [];
  const blacklist = [];

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return { sources: DEFAULT_SOURCES, whitelist, blacklist };
  }

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || !value) continue;

    // Only `source` is a path. whitelist/blacklist are bare skill names, so they are
    // taken literally, no '~' expansion.
    if (key === 'source') sources.push(expandHome(value));
    else if (key === 'whitelist') whitelist.push(value);
    else if (key === 'blacklist') blacklist.push(value);
    // unrecognized keys are ignored on purpose, for forward compatibility
  }

  return {
    sources: sources.length > 0 ? sources : DEFAULT_SOURCES,
    whitelist,
    blacklist,
  };
}

const { sources: SOURCES, whitelist: WHITELIST, blacklist: BLACKLIST } = loadConfig();

function collectSkills() {
  const skillMap = new Map();
  const conflicts = [];

  for (const source of SOURCES) {
    if (!fs.existsSync(source)) continue;

    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const skillPath = path.join(source, entry.name);
      const skillMd = path.join(skillPath, 'SKILL.md');

      if (!fs.existsSync(skillMd)) continue;

      if (WHITELIST.length > 0) {
        if (!WHITELIST.includes(entry.name)) continue;
      } else if (BLACKLIST.includes(entry.name)) {
        continue;
      }

      if (skillMap.has(entry.name)) {
        conflicts.push({
          name: entry.name,
          winner: skillMap.get(entry.name),
          loser: skillPath,
        });
      } else {
        skillMap.set(entry.name, skillPath);
      }
    }
  }

  for (const c of conflicts) {
    console.error(
      `[sync-skills:copilot] CONFLICT: "${c.name}" exists in both sources. Using: ${c.winner} (skipping: ${c.loser})`
    );
  }

  return { skillMap, conflicts };
}

function isManaged(dir) {
  try {
    return fs.existsSync(path.join(dir, MARKER));
  } catch {
    return false;
  }
}

// Returns the newest mtimeMs found anywhere in the tree rooted at dir, or 0 if the
// directory cannot be read. Recurses manually with readdirSync + isDirectory() rather
// than the `recursive: true` option or dirent.parentPath/path, since those need a newer
// Node than a random Linux server is guaranteed to have, and this hook must not crash there.
function newestMtime(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let newest = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const childNewest = newestMtime(entryPath);
      if (childNewest > newest) newest = childNewest;
      continue;
    }

    try {
      const mtime = fs.statSync(entryPath).mtimeMs;
      if (mtime > newest) newest = mtime;
    } catch {
      continue;
    }
  }

  return newest;
}

// Walks the whole tree instead of just comparing SKILL.md, because a changed script or
// reference file under an unchanged SKILL.md would otherwise be missed and the stale
// copy would keep being served. Only stat calls are made, no file contents are read, so
// the cost stays flat even though this hook runs before every `copilot` launch.
function isFresh(sourcePath, targetPath) {
  const sourceMtime = newestMtime(sourcePath);
  const targetMtime = newestMtime(targetPath);
  if (sourceMtime === 0 || targetMtime === 0) return false;
  return targetMtime >= sourceMtime;
}

function syncCopilotSkills() {
  if (!fs.existsSync(COPILOT_HOME)) {
    console.log(`[sync-skills:copilot] ~/.copilot not found, skipping`);
    return;
  }

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const { skillMap, conflicts } = collectSkills();

  let created = 0;
  let updated = 0;
  let removed = 0;
  let unchanged = 0;

  // Stale cleanup, only touch dirs we own
  for (const entry of fs.readdirSync(SKILLS_DIR)) {
    const fullPath = path.join(SKILLS_DIR, entry);
    let stat;
    try {
      stat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!isManaged(fullPath)) continue;
    if (skillMap.has(entry)) continue;

    fs.rmSync(fullPath, { recursive: true, force: true });
    removed++;
  }

  // Copy / refresh
  for (const [name, sourcePath] of skillMap) {
    const targetPath = path.join(SKILLS_DIR, name);
    const targetExists = fs.existsSync(targetPath);

    if (targetExists && isManaged(targetPath) && isFresh(sourcePath, targetPath)) {
      unchanged++;
      continue;
    }

    if (targetExists) {
      if (!isManaged(targetPath)) {
        console.error(
          `[sync-skills:copilot] WARNING: "${targetPath}" exists but is not managed by us, skipping`
        );
        continue;
      }
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    fs.cpSync(sourcePath, targetPath, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(targetPath, MARKER), '');

    if (targetExists) updated++;
    else created++;
  }

  const total = skillMap.size;
  console.log(
    `[sync-skills:copilot] Synced ${total} skills (${created} new, ${updated} updated, ${removed} removed, ${unchanged} unchanged, ${conflicts.length} conflicts)`
  );
}

try {
  syncCopilotSkills();
} catch (err) {
  console.error(`[sync-skills:copilot] Error: ${err.message}`);
}

process.exit(0);
