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
- `bin/ompw` → symlinked to `~/.local/bin/ompw`. Runs omp (Oh My Pi) inside an isolated git
  worktree.
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

## ompw behavior

`ompw [name] [-- omp args...]` runs omp (Oh My Pi) inside an isolated git worktree.

- **It owns the whole worktree lifecycle**, because omp has no `--worktree` flag of its own —
  `omp worktree` only lists and clears the trees omp's own subagents make under `~/.omp/wt`.
- **Worktree at `<repo>/.omp/worktrees/<name>`, branch `omp/<name>`**, kept out of `git status` by
  appending `/.omp/worktrees/` to the clone's `.git/info/exclude` (resolved via `--git-common-dir`,
  so it also works from inside a worktree). It copies the `.worktreeinclude` entries, runs
  `scripts/setup-worktree.sh` when present, then `exec`s omp in the new directory.
- **The helpers duplicated from `cyolow` are duplicated on purpose** — `install.sh` symlinks single
  files, so each script must stand alone on a fresh server.
- **A path is only reused when git still registers it as a worktree**, and a setup that fails
  part-way removes the worktree and the branch it just created. Cleanup after a successful run is
  manual.

## Conventions

- This repo is **additive only** to a running machine: creating/attaching tmux sessions must never
  affect background services.
- README.md documents install/usage for humans; keep it in sync when install or CLI behavior changes.

---

_The Verification, Git Policy, and File Organization sections below were generated by the
`setup-aiengineering` skill (v9) — re-run the skill to refresh._

## Mandatory Verification After Code Changes

After ANY code change, run these checks before presenting the work. All are mandatory unless a step
says otherwise.

> **Exemption:** when changes are **solely** to markdown/docs (`*.md`), skip this protocol — no
> impact on builds, types, or tests.

- **Regression test for bug fixes** — _dormant: this repo has no test framework, so the gate sets
  intent rather than blocking today._ Once tests land, every bug fix ships a test that **fails
  before the fix and passes after**. Test-first: write the failing test, watch it fail for the right
  reason, then fix the bug and watch it pass. Exempt, and only these: typos in copy, CI config,
  dependency bumps, pure formatting. Until a runner exists, state in one line how the fix was
  manually reproduced and re-checked instead.
- **Code review** — **Exempt:** an integration-only session — a merge, rebase, cherry-pick, or
  revert of already-reviewed work that authored no new lines — skips this gate and only this gate;
  every other gate still runs. Writing one line neither side had voids it. Report the skip with the
  diff proving nothing was authored (`git show --cc --format="" <integration-sha>` for a merge,
  `git range-diff` for a rebase or cherry-pick) **plus** `git diff <integration-sha>..HEAD`, where
  `<integration-sha>` is the merge commit or the replayed tip — that pairing is what proves nothing
  landed after the integration commit, which neither command before it can see. Never skip silently.
  Otherwise run **every lens below** in parallel on this session's changes:
  - **Harness-native code review** — invoke your harness's `code-review` agent (Claude Code:
    `Task` tool with `subagent_type: "code-review"`; Copilot CLI: the `code-review` skill). Cover
    bugs, security, logic errors, race conditions, unhandled edge cases, and the project's own
    conventions.
  - **CodeRabbit CLI** — `cr review --agent --base master`. Collect every `type: "finding"` event;
    wait for `type: "complete"`.
    - **Prerequisites** — `cr` on `PATH` (`which cr`) and authenticated (`cr auth status`). If either
      fails, **tell the user and skip the CodeRabbit CLI lens** — label it `skipped (CodeRabbit
      unavailable)`; never skip silently.
    - **Triage** — `critical`/`major` → auto-apply the fix, then re-check the affected scripts.
      `minor`/`trivial`/`info` → do **not** auto-apply; list them for the user (file:line +
      suggested fix).
    - **Re-review budget** — at most one extra `cr review` after auto-fixes; further loops need user
      approval (each costs credits).
  - **Nuclear structural review** — if the `code-review-nuclear` skill is available, spawn a
    subagent that runs it on this session's diff (Claude Code: `Task`/`Agent` tool → a subagent
    whose prompt invokes the skill against `master...HEAD`). Structural / maintainability "code
    judo" only — NOT correctness, security, or bugs (the **Harness-native code review** lens covers
    those). Surface its findings for the user; never auto-apply. If the skill isn't available,
    **tell the user and skip the nuclear structural review lens** — label it `skipped (nuclear
    review unavailable)`; never skip silently.
  - **Security review** — if your harness provides a security-review capability (Claude Code:
    the built-in `/security-review` skill; Copilot CLI: its built-in security review), spawn a
    subagent that runs it against `master...HEAD`. Vulnerability classes only — injection, hardcoded
    secrets, unsafe `eval`/word-splitting, path traversal, privilege escalation via the `unshare`
    and `install.sh` paths. Structural and correctness concerns belong to the **Harness-native code
    review** and **Nuclear structural review** lenses, not here.
    - **Triage** — `critical`/`major` → auto-apply the fix, then re-check the affected scripts.
      `minor`/`trivial`/`info` → do **not** auto-apply; list them for the user (file:line +
      suggested fix).
    - If your harness provides no security-review capability, **tell the user and skip the security
      review lens** — label it `skipped (security review unavailable)`; never skip silently.
  - **Merge** — wait for **every lens** to finish — a `skipped` lens still counts as done — then
    deduplicate findings across them and present one combined "Code review findings" section.
- **Docs & instructions alignment** — before marking the task done, check whether this session's
  changes made any documentation stale:
  - **Project docs** (`README.md`, `docs/`, other human-facing docs) — stale docs are part of the
    change, like a failing test: update them now and list what was updated.
  - **Agent instructions** (`AGENTS.md` / `CLAUDE.md` and any rule files they link) — draft the
    updated wording and **ask the user** before applying. Never silently edit instruction files.
  - Nothing stale → say so explicitly in one line; do not invent updates.

If any check fails, fix and re-run. These gates are mandatory for every code change — no exceptions.

No automated lint/typecheck/test gates were detected for this repo. Add them here when build tooling
lands.

## Git Policy

- **Commit as soon as a task is marked done.** Once the work passes the verification protocol and
  the task is complete, stage and commit it without waiting to be asked. Do not batch several
  finished tasks into one commit — one task, one commit.
- **Do not push to remote unless the user explicitly tells you to.** Committing is automatic;
  pushing never is.
- Conventional commits (`feat:`, `fix:`, `docs:`).
- When working on the default branch (`master`), create a feature branch first rather than
  committing directly to it.
- Never force-push or rewrite history.

## File Organization

- All documentation and markdown files (guides, explorations, architecture docs, notes) go in the
  `docs/` folder — never the repository root.
- Only these files belong at the root: `README.md`, `CLAUDE.md`, `AGENTS.md` (symlink to
  `CLAUDE.md`), `install.sh` (the entry point, must stay at root), `.gitignore`.
- Tracked artifacts live in their own directory by target: `bin/` (executables), `bash/` (shell
  config), `tmux/` (tmux config), `site-tmux/` (example per-machine config). A new installed
  artifact gets its own directory rather than joining an unrelated one.
- Planning artifacts (implementation plans, scoping docs) go in `plans/`.
- New reference docs in `docs/` should be linked from `README.md`'s documentation section, so they
  stay discoverable (scratch / exploration notes excepted).
