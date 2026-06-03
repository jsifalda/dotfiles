# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A portable dotfiles repo (public, pushed to `github.com/jsifalda/dotfiles`) cloned to `~/dotfiles`
on each machine. Plain Bash + a tmux config — no build, lint, or test step. Two tracked artifacts
get installed:

- `bin/site-tmux` → symlinked to `~/.local/bin/site-tmux`
- `tmux/tmux.conf` → symlinked to `~/.tmux.conf`

## The core design constraint: symlinks, not copies

`install.sh` **symlinks** the repo files into place rather than copying them. The live file *is*
the repo file, so:

- Editing `bin/site-tmux` or `tmux/tmux.conf` here changes the installed config **immediately** —
  no reinstall needed. A `git pull` likewise takes effect instantly.
- Never "copy the file into `~/.local/bin`" — that breaks the symlink contract. Edit the repo copy.

## Machine-agnostic code, per-machine config

The script is byte-identical on every host. The only per-machine state is the site→directory map
at `${XDG_CONFIG_HOME:-$HOME/.config}/site-tmux/sites.conf` (format: one `site=dir` per line).
That file is **outside the repo and gitignored** (`site-tmux/sites.conf`), seeded once from
`site-tmux/sites.conf.example`. Consequences:

- Never commit real machine paths — they belong in the example file as commented samples only.
- `install.sh` seeds `sites.conf` only if absent and never overwrites it; updates must not touch it.
- Unknown/missing sites fall back to `$HOME` by design — the script must stay safe on any server.

## install.sh invariants (keep these when editing)

- **Idempotent and re-runnable.** Re-running must not destroy anything.
- A real (non-symlink) file at a target is moved to `<file>.bak` before linking; an existing
  symlink is replaced. `*.bak` is gitignored.
- Preserve the `set -euo pipefail` discipline and the PATH-check warning at the end.

## site-tmux behavior

`site-tmux [site]` attaches to (or creates) a tmux session named `<site>` in its mapped directory
(no arg → `home` session in `$HOME`). On create it also spawns a `claude` window running
`claude remote-control --name <site>` so the session is controllable from claude.ai/code or mobile.
That window uses `remain-on-exit on` + `--debug-file ~/.local/state/site-tmux/<site>-rc.log` so a
crash stays visible with its log rather than vanishing. A dead `claude` window (remote-control
exited) is detected via `#{pane_dead}` and respawned on the next `site-tmux <site>` run.

`site-tmux --update` resolves the install symlink back to the repo, runs `git pull --ff-only`, and
re-execs `install.sh`. The repo must be a git checkout for this to work.

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`). Don't force-push or rewrite history.
- This repo is **additive only** to a running machine: creating/attaching tmux sessions must never
  affect background services.
- README.md documents install/usage for humans; keep it in sync when install or CLI behavior changes.
