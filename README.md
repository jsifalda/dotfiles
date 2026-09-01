# dotfiles

Portable shell helpers and config, shared across servers.

Currently ships:

- **`bin/site-tmux`** — attach to (or create) a per-"site" tmux session in its working
  directory, and ensure a `claude remote-control` window is running in that session.
- **`tmux/tmux.conf`** → `~/.tmux.conf` — small set of tmux options.
- **`bash/bash_aliases`** → `~/.bash_aliases` — portable shell aliases (git shortcuts, plus
  `yolo`/`yolow` for sandboxed Claude runs with a default Remote Control session name, and
  `cyolo`/`copilot` for worktree-isolated agent runs). The stock Ubuntu/Debian `~/.bashrc`
  sources `~/.bash_aliases` automatically, so they load on any fresh box with no bashrc edits.
- **`bin/cyolow`** → `~/.local/bin/cyolow` — run GitHub Copilot CLI inside an isolated git
  worktree, copying in the gitignored files listed in `.worktreeinclude` first.
- **`bin/ompw`** → `~/.local/bin/ompw` — run omp (Oh My Pi) inside an isolated git worktree,
  copying in the gitignored files listed in `.worktreeinclude` first.
- **`bin/repo-sync`** → `~/.local/bin/repo-sync` — pull a predefined list of local git repos
  in one command, skipping any that are dirty or off their default branch.
- **`copilot/sync-skills.js`** → `~/.copilot/hooks/sync-skills.js` — pre-launch hook that
  mirrors Claude Code skills into Copilot CLI's skills directory.

The site→directory map is **per-machine** and lives outside this repo, so the same script
works unchanged on any server.

## Why this setup

The goal is **one source of truth for your shell tooling that follows you to every server**,
without copy-paste drift. The design choices that make that work:

- **Git, not scp.** The repo is the canonical copy. New machine → `clone` + `install.sh`.
  Changed something → commit once, `--update` everywhere. No "which box has the latest
  version?" guessing, and full history/rollback for free.
- **Symlinks, not copies.** `install.sh` links the repo's files into place
  (`~/.local/bin/site-tmux`, `~/.tmux.conf`) instead of copying them. So a `git pull` takes
  effect *instantly* — the live file **is** the repo file. Nothing to re-copy, no stale duplicates.
- **Machine-agnostic code, per-machine config.** The scripts are identical on every host. What
  differs is two config files: the `site=dir` map in `~/.config/site-tmux/sites.conf`, and the
  skill source list in `~/.config/copilot-sync/sources.conf`. Both stay *outside* the repo
  (gitignored), so machine-specific paths never leak into a public repo and updates never
  clobber your local setup.
- **Safe to adopt and re-run.** `install.sh` is idempotent and backs up any real file it would
  replace to `*.bak`, so installing (or re-installing) never destroys existing config.
- **`~/dotfiles`, not a fixed path.** Cloning to `~/dotfiles` resolves correctly for whatever
  user runs it (`/root/dotfiles` for root, `/home/you/dotfiles` otherwise) — the same install
  command is portable across hosts and users.

Net effect: fix a bug or add a tmux tweak once, push it, and every server picks it up with a
single `site-tmux --update` — while each box keeps its own project paths.

## Install

```bash
git clone https://github.com/jsifalda/dotfiles ~/dotfiles
~/dotfiles/install.sh
```

`install.sh` is idempotent: it symlinks `bin/site-tmux` → `~/.local/bin/site-tmux`,
`tmux/tmux.conf` → `~/.tmux.conf`, `bash/bash_aliases` → `~/.bash_aliases`, `bin/cyolow` →
`~/.local/bin/cyolow`, `bin/ompw` → `~/.local/bin/ompw`, `bin/repo-sync` →
`~/.local/bin/repo-sync`, and `copilot/sync-skills.js` → `~/.copilot/hooks/sync-skills.js`
(backing up any real file it would replace to `*.bak`), and seeds three per-machine config files
from their examples: `~/.config/site-tmux/sites.conf`, `~/.config/copilot-sync/sources.conf` and
`~/.config/repo-sync/repos.conf`.

Then edit this machine's site map:

```bash
$EDITOR ~/.config/site-tmux/sites.conf
```

```ini
# site=dir   (one per line; ~ expands to $HOME)
obsidian-vault-api=/root/obsidian-vault-api
vaults=/root/vaults
```

Make sure `~/.local/bin` is on your `PATH`.

### Copilot skill sync config

`copilot/sync-skills.js` mirrors Claude Code skills into Copilot CLI's skills directory before
each `copilot` launch. Its source list is a second per-machine config,
`~/.config/copilot-sync/sources.conf`. Same rules as `sites.conf`: it lives outside the repo,
it is gitignored, and `install.sh` seeds it once from the example and never overwrites it.

```ini
# key=value   (repeatable keys; ~ expands to $HOME)
source=~/instructions/skills
blacklist=example-skill-name
```

`source` is repeatable, order sets priority, and the first source wins on a name conflict.
`blacklist` excludes a skill by name. `whitelist` (also repeatable) wins over `blacklist` when
non-empty and makes the sync include-only. With no config file present, the hook defaults to a
single source, `~/instructions/skills`.

### repo-sync repo list

`bin/repo-sync` pulls a list of local checkouts. That list is a third per-machine config,
`~/.config/repo-sync/repos.conf`, under the same rules: outside the repo, gitignored, seeded
once from the example and never overwritten.

```ini
# key=value   (repeatable keys; ~ expands to $HOME)
repo=~/instructions
skip=~/instructions-private
```

`repo` is a checkout to pull; `skip` is one you deliberately left out, listed in the output so
it never looks forgotten. With neither key present, `repo-sync` falls back to its built-in
defaults, `~/instructions` and `~/instructions-private`, and asks about any path that is
missing — the answer is written back here, so it only ever asks once.

### Naming this machine in claude.ai/code

Remote Control lists each device as `<hostname>:<site>:<hash>`, so by default it shows the raw
server hostname (e.g. `ubuntu-4gb-nbg1-2:…`). To show a friendlier label, add a reserved
`@prefix` line to this machine's `sites.conf`:

```ini
@prefix=mybox     # → device shows as  mybox:home:…  mybox:vaults:…
```

It applies to every site on the machine. The override is **Claude-only**: `site-tmux` launches
`remote-control` inside its own UTS namespace and sets that namespace's hostname, so the bridge
reports `mybox` while the real system hostname is unchanged. Needs root + `unshare` (otherwise the
line is ignored and the default hostname is used). Already-running bridges keep their old label
until respawned (`tmux kill-window -t <site>:claude-rc` then `site-tmux <site>`).

## Usage

### site-tmux

```bash
site-tmux                     # 'home' session in $HOME
site-tmux obsidian-vault-api  # session in the mapped directory
site-tmux anything-else       # unknown site → falls back to $HOME
```

The `claude remote-control` window uses `remain-on-exit on`, so if it exits it stays
visible as a dead pane (with its log) instead of vanishing. Re-running `site-tmux <site>`
detects that dead `claude` window and respawns it.

### yolo / yolow

```bash
yolo                            # claude --dangerously-skip-permissions, IS_SANDBOX=1
yolo -p "summarize this repo"   # print mode, no Remote Control default
yolo mcp list                   # subcommand, no Remote Control default
yolow                           # worktree-isolated yolo, same defaults
yolow my-feature                # worktree named 'my-feature'
```

Both wrap `claude --dangerously-skip-permissions` with `IS_SANDBOX=1`, and both inject a
default `--remote-control <name>`, naming the session `<repo-root-folder>-<YYYY-MM-DD-HHMM>`
(or the current directory's name outside a git repo). The timestamp exists so two sessions
launched from the same repo don't collide in claude.ai/code.

The default is skipped when the caller already passed `--remote-control` or
`--remote-control=...`, asked for print mode (`-p`/`--print`), or the first argument is a
Claude subcommand (`agents`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`,
`mcp`, `plugin`, `plugins`, `project`, `setup-token`, `ultrareview`, `update`, `upgrade`).
`yolow <name>` still names the worktree, not the session. The injected args sit before
`--worktree` on purpose: both flags take an optional value, so a trailing `--remote-control`
would get consumed as the worktree's name instead. `yolow` hard-fails outside a git repo and
warns when the repo has no `.worktreeinclude`.

### cyolow

```bash
cyolow                              # random 'adjective-noun-NNN' worktree, then copilot --yolo
cyolow my-feature                   # worktree named 'my-feature'
cyolow my-feature -- --model gpt-5  # extra args passed through to copilot
```

`cyolow` pre-creates the worktree at the path Copilot's own `--worktree` flag uses, then copies
the entries listed in the repo's `.worktreeinclude` into it, so gitignored files like `.env`
come along (Copilot's own `--worktree` does not do this). It hard-fails outside a git repo,
warns when there is no `.worktreeinclude`, and reuses an existing worktree at the same path
instead of recreating it.

### ompw

```bash
ompw                            # random 'adjective-noun-NNN' worktree, then omp
ompw my-feature                 # worktree named 'my-feature'
ompw my-feature -- --model opus # extra args passed through to omp
```

`ompw` owns the whole worktree lifecycle, because omp has no `--worktree` flag of its own
(`omp worktree` only lists and clears the worktrees omp's own subagents create). It puts the
worktree at `<repo>/.omp/worktrees/<name>` on a branch named `omp/<name>`, adds
`/.omp/worktrees/` to the clone's `.git/info/exclude` so it never shows up in `git status`,
copies the entries listed in `.worktreeinclude` so gitignored files like `.env` come along,
runs the repo's `scripts/setup-worktree.sh` if it has one, and then starts omp in the new
directory. It hard-fails outside a git repo, warns when there is no `.worktreeinclude`, and
reuses an existing worktree at the same path instead of recreating it — but only when git still
knows that path as a worktree; a leftover plain directory is an error, not something to reuse.
If setup fails part-way, it removes the half-prepared worktree and the branch it just created
rather than leaving them to be reused.

A worktree that finished setup is never cleaned up automatically — remove one with
`git worktree remove <path> && git branch -d omp/<name>` (use `-D` instead of `-d` to discard
unmerged work).

### repo-sync

```bash
repo-sync                     # pull every configured repo that is safe to pull
repo-sync --help              # usage, and where the config lives
$EDITOR ~/.config/repo-sync/repos.conf   # change the list by hand
```

`repo-sync` walks the configured repos and pulls each one with `git pull --rebase origin
<branch>` — the same pull as the `pull` shell function — but only when it is a git repo with an
`origin` remote, sitting on its own default branch (`origin/HEAD`, falling back to whichever of
`main`/`master` exists) and with a clean working tree. Anything else is reported and skipped:
dirty, detached, on a feature branch, not a repo, missing. A missing path is asked about once on
a terminal — supply an alternative, skip it permanently, or leave it for now — and the answer is
saved to `~/.config/repo-sync/repos.conf`, so later runs are silent. Piped and cron runs never
prompt and never write to the config. Skips are normal and exit `0`; only a failed `git pull`
exits non-zero.

If a repo is skipped as "not the default branch" but the named default looks wrong, the clone's
`origin/HEAD` is stale (typically after a `master` → `main` rename upstream) — refresh it once
with `git -C <path> remote set-head origin -a`.

Not called `sync`, because `/usr/bin/sync` (coreutils) already owns that name on `PATH`.

## Update

```bash
site-tmux --update            # git pull + re-run install.sh
# or: cd ~/dotfiles && git pull && ./install.sh
```

Because the files are symlinked, a `git pull` applies changes to `site-tmux` instantly;
`--update` just runs the pull and reinstall for you (also re-links if files were added).
Your per-machine `sites.conf`, `sources.conf` and `repos.conf` are never touched by updates.
