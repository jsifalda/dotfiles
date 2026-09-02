#!/usr/bin/env bash
# install.sh — symlink the dotfiles into place. Idempotent and safe to re-run.
# A real (non-symlink) file at a target is backed up to <file>.bak before linking,
# so we never silently clobber existing data.
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

link() {
    local src="$1" dst="$2"
    mkdir -p "$(dirname "$dst")"
    if [[ -L "$dst" ]]; then
        rm -f "$dst"                                   # replace an existing symlink
    elif [[ -e "$dst" ]]; then
        # Find the first free <dst>.bak or <dst>.N.bak so an earlier backup is
        # never clobbered. -L also catches a dangling symlink at that name.
        local backup="$dst.bak"
        local n=1
        while [[ -e "$backup" || -L "$backup" ]]; do
            if (( n > 100 )); then
                echo "error: too many existing backups for $dst, clean up old .bak files" >&2
                exit 1
            fi
            backup="$dst.$n.bak"
            n=$((n + 1))
        done
        echo "backing up existing $dst → $backup"
        mv "$dst" "$backup"                             # preserve a real file
    fi
    ln -s "$src" "$dst"
    echo "linked $dst → $src"
}

# Seed a per-machine config file from its example, only if it does not exist yet.
# Never overwrites an existing config, that is a documented invariant.
seed() {
    local example="$1" dst="$2" hint="$3"
    mkdir -p "$(dirname "$dst")"
    if [[ ! -e "$dst" && ! -L "$dst" ]]; then
        cp "$example" "$dst"
        echo "created $dst — $hint"
    else
        echo "kept existing $dst"
    fi
}

link "$repo/bin/site-tmux" "$HOME/.local/bin/site-tmux"
link "$repo/tmux/tmux.conf" "$HOME/.tmux.conf"
link "$repo/bash/bash_aliases" "$HOME/.bash_aliases"
link "$repo/bin/cyolow" "$HOME/.local/bin/cyolow"                              # Copilot-CLI-in-a-git-worktree launcher
link "$repo/bin/ompw" "$HOME/.local/bin/ompw"                                  # omp-in-a-git-worktree launcher
link "$repo/bin/repo-sync" "$HOME/.local/bin/repo-sync"                        # pulls the configured git repos in one command
link "$repo/copilot/sync-skills.js" "$HOME/.copilot/hooks/sync-skills.js"      # pre-launch hook, mirrors Claude Code skills into Copilot CLI

seed "$repo/site-tmux/sites.conf.example" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/site-tmux/sites.conf" \
    "edit it with this machine's sites (site=dir per line)"

seed "$repo/copilot-sync/sources.conf.example" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/copilot-sync/sources.conf" \
    "edit it with this machine's skill sources"

seed "$repo/repo-sync/repos.conf.example" \
    "${XDG_CONFIG_HOME:-$HOME/.config}/repo-sync/repos.conf" \
    "edit it with this machine's repos (repo=path per line)"

case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "note: $HOME/.local/bin is not on PATH — add it to your shell rc." ;;
esac

echo "done."
