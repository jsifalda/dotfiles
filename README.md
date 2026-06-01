# dotfiles

Portable shell helpers and config, shared across servers.

Currently ships:

- **`bin/site-tmux`** — attach to (or create) a per-"site" tmux session in its working
  directory, and ensure a `claude remote-control` window is running in that session.
- **`tmux/tmux.conf`** → `~/.tmux.conf` — small set of tmux options.

The site→directory map is **per-machine** and lives outside this repo, so the same script
works unchanged on any server.

## Install

```bash
git clone https://github.com/jsifalda/dotfiles ~/dotfiles
~/dotfiles/install.sh
```

`install.sh` is idempotent: it symlinks `bin/site-tmux` → `~/.local/bin/site-tmux` and
`tmux/tmux.conf` → `~/.tmux.conf` (backing up any real file it would replace to `*.bak`),
and seeds a per-machine `~/.config/site-tmux/sites.conf` from the example.

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

## Usage

```bash
site-tmux                     # 'home' session in $HOME
site-tmux obsidian-vault-api  # session in the mapped directory
site-tmux anything-else       # unknown site → falls back to $HOME
```

## Update

```bash
site-tmux --update            # git pull + re-run install.sh
# or: cd ~/dotfiles && git pull && ./install.sh
```

Because the files are symlinked, a `git pull` applies changes to `site-tmux` instantly;
`--update` just runs the pull and reinstall for you (also re-links if files were added).
Your per-machine `sites.conf` is never touched by updates.
