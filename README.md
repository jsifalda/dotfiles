# dotfiles

Portable shell helpers and config, shared across servers.

Currently ships:

- **`bin/site-tmux`** — attach to (or create) a per-"site" tmux session in its working
  directory, and ensure a `claude remote-control` window is running in that session.
- **`tmux/tmux.conf`** → `~/.tmux.conf` — small set of tmux options.
- **`bash/bash_aliases`** → `~/.bash_aliases` — portable shell aliases (git shortcuts and a
  `claude` helper). The stock Ubuntu/Debian `~/.bashrc` sources `~/.bash_aliases`
  automatically, so they load on any fresh box with no bashrc edits.

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
- **Machine-agnostic code, per-machine config.** The script is identical on every host; only
  the `site=dir` map in `~/.config/site-tmux/sites.conf` differs. That file stays *outside* the
  repo (gitignored), so machine-specific paths never leak into a public repo and updates never
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
`tmux/tmux.conf` → `~/.tmux.conf`, and `bash/bash_aliases` → `~/.bash_aliases` (backing up
any real file it would replace to `*.bak`), and seeds a per-machine
`~/.config/site-tmux/sites.conf` from the example.

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

```bash
site-tmux                     # 'home' session in $HOME
site-tmux obsidian-vault-api  # session in the mapped directory
site-tmux anything-else       # unknown site → falls back to $HOME
```

The `claude remote-control` window uses `remain-on-exit on`, so if it exits it stays
visible as a dead pane (with its log) instead of vanishing. Re-running `site-tmux <site>`
detects that dead `claude` window and respawns it.

## Update

```bash
site-tmux --update            # git pull + re-run install.sh
# or: cd ~/dotfiles && git pull && ./install.sh
```

Because the files are symlinked, a `git pull` applies changes to `site-tmux` instantly;
`--update` just runs the pull and reinstall for you (also re-links if files were added).
Your per-machine `sites.conf` is never touched by updates.
