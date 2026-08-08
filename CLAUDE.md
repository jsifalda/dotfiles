# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A portable dotfiles repo (public, pushed to `github.com/jsifalda/dotfiles`) cloned to `~/dotfiles`
on each machine. Plain Bash, a tmux config, and a Node hook. No build, lint, or test step. Five
tracked artifacts get installed:

- `bin/site-tmux` → symlinked to `~/.local/bin/site-tmux`
- `tmux/tmux.conf` → symlinked to `~/.tmux.conf`
- `bash/bash_aliases` → symlinked to `~/.bash_aliases` (portable shell aliases; stock bashrc
  sources `~/.bash_aliases` automatically, so no bashrc edit is needed). Keep it machine-agnostic:
  no absolute paths, no secrets. `pull`/`push` auto-detect the current branch to stay repo-portable.
  They are functions, so the file `unalias pull push` first — aliases expand at parse time, and a
  stale alias from an older `~/.bashrc` would otherwise make re-sourcing a syntax error. Keep that
  guard. It now also covers `yolo`, `yolow` and `copilot`, which are functions for the same
  parse-time-expansion reason, so the file unaliases them too. `yolo`/`yolow` pass a default
  `--remote-control <folder>-<timestamp>` built by `_claude_rc_args`, where folder is the git repo
  root's name (the cwd's name outside a repo) and the timestamp keeps parallel sessions from
  colliding in claude.ai/code. That helper is a port of `_pro_rc_args` in the machine-local
  `~/.zshrc`, so its subcommand skip-list has to stay in sync with that copy. In `yolow` the
  injected args must stay BEFORE `--worktree`: both `--remote-control [name]` and
  `-w, --worktree [name]` take an optional value, so a trailing `--remote-control` is swallowed as
  `--worktree`'s name and silently breaks `yolow <name>`. Keep that order.
- `bin/cyolow` → symlinked to `~/.local/bin/cyolow`. Runs GitHub Copilot CLI inside an isolated
  git worktree.
- `copilot/sync-skills.js` → symlinked to `~/.copilot/hooks/sync-skills.js`. Pre-launch hook that
  mirrors Claude Code skills into Copilot CLI's skills directory.

## The core design constraint: symlinks, not copies

`install.sh` **symlinks** the repo files into place rather than copying them. The live file *is*
the repo file, so:

- Editing `bin/site-tmux` or `tmux/tmux.conf` here changes the installed config **immediately** —
  no reinstall needed. A `git pull` likewise takes effect instantly.
- Never "copy the file into `~/.local/bin`" — that breaks the symlink contract. Edit the repo copy.

## Machine-agnostic code, per-machine config

The scripts are byte-identical on every host. Per-machine state lives in two config files, both
outside the repo and gitignored, both seeded once by `install.sh` from an example and never
overwritten after that:

- **`site-tmux` map**: `${XDG_CONFIG_HOME:-$HOME/.config}/site-tmux/sites.conf` (format: one
  `site=dir` per line), seeded from `site-tmux/sites.conf.example`. Also carries an optional
  reserved `@prefix=<name>` line (not a site), the device label shown in claude.ai/code,
  defaulting to the OS hostname when unset.
- **Copilot skill sync sources**: `${XDG_CONFIG_HOME:-$HOME/.config}/copilot-sync/sources.conf`
  (format: `key=value` per line, `#` comments, `~` expands to `$HOME`, keys repeatable), seeded
  from `copilot-sync/sources.conf.example`. Keys: `source=<path>` (repeatable, order sets
  priority, first source wins on a name conflict), `blacklist=<skill>` (repeatable, excludes a
  skill), `whitelist=<skill>` (repeatable, non-empty wins over `blacklist` and makes the sync
  include-only). No config file present, hook defaults to a single source,
  `~/instructions/skills`.

Consequences for both files:

- Never commit real machine paths or skill names into either file. They belong in the example
  files as commented samples only.
- `install.sh` seeds each config only if absent and never overwrites it. Updates must not touch
  either.
- Unknown/missing `site-tmux` sites fall back to `$HOME` by design. The script must stay safe on
  any server.

## install.sh invariants (keep these when editing)

- **Idempotent and re-runnable.** Re-running must not destroy anything.
- A real (non-symlink) file at a target is moved to `<file>.bak` before linking; an existing
  symlink is replaced. Existing backups are never overwritten, falling back to the first free
  `<file>.<n>.bak` on collision. `*.bak` is gitignored.
- Preserve the `set -euo pipefail` discipline and the PATH-check warning at the end.

## site-tmux behavior

`site-tmux [site]` attaches to (or creates) a tmux session named `<site>` in its mapped directory
(no arg → `home` session in `$HOME`). On create it also spawns a `claude` window running
`claude remote-control --name <site>` so the session is controllable from claude.ai/code or mobile.
That window uses `remain-on-exit on` + `--debug-file ~/.local/state/site-tmux/<site>-rc.log` so a
crash stays visible with its log rather than vanishing. On each run, dead or duplicate `claude`
windows (remote-control exited, `#{pane_dead}`) are reaped by `window_id` and a single live one
is ensured — never killing a healthy remote-control. When `@prefix` is configured (and running as
root), remote-control is launched via `unshare --uts` with that namespace's hostname set, so the
bridge registers `<prefix>` as its machine name in claude.ai/code without changing the real
system hostname; without root/`unshare` the override is skipped and the default hostname applies.

`site-tmux --update` resolves the install symlink back to the repo, runs `git pull --ff-only`, and
re-execs `install.sh`. The repo must be a git checkout for this to work.

## cyolow behavior

`cyolow [name] [-- copilot args...]` runs GitHub Copilot CLI inside an isolated git worktree. It
hard-fails outside a git repo. With no `name` it generates a random `adjective-noun-NNN` one. It
pre-creates the worktree at the path Copilot's own `--worktree` flag expects, then copies the
entries listed in the repo's `.worktreeinclude` into it before handing over. This exists because
Copilot's own `--worktree` does not bring gitignored files, like `.env`, along on its own. It
warns (does not fail) when the repo has no `.worktreeinclude`, and reuses an existing worktree at
the same path instead of recreating it. It then hands over to
`copilot --experimental --worktree=<name> --yolo`, with any args after `--` passed through.

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`). Don't force-push or rewrite history.
- This repo is **additive only** to a running machine: creating/attaching tmux sessions must never
  affect background services.
- README.md documents install/usage for humans; keep it in sync when install or CLI behavior changes.
