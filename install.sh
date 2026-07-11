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
        echo "backing up existing $dst → $dst.bak"
        mv "$dst" "$dst.bak"                            # preserve a real file
    fi
    ln -s "$src" "$dst"
    echo "linked $dst → $src"
}

link "$repo/bin/site-tmux" "$HOME/.local/bin/site-tmux"
link "$repo/tmux/tmux.conf" "$HOME/.tmux.conf"
link "$repo/bash/bash_aliases" "$HOME/.bash_aliases"

# Seed the per-machine site map if it does not exist yet (never overwrite it).
config="${XDG_CONFIG_HOME:-$HOME/.config}/site-tmux/sites.conf"
mkdir -p "$(dirname "$config")"
if [[ ! -f "$config" ]]; then
    cp "$repo/site-tmux/sites.conf.example" "$config"
    echo "created $config — edit it with this machine's sites (site=dir per line)"
else
    echo "kept existing $config"
fi

case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "note: $HOME/.local/bin is not on PATH — add it to your shell rc." ;;
esac

echo "done."
