# Server hardening

A runbook for standing up a new VPS, written for my own future self at 2am on a box I just
rented. One `##` section per concern, each self-contained, so sections can be added
(`ufw`, `fail2ban`, Tailscale) without rewriting what is already here.

The house rule: **the config snippet is the cheap part, the audit is the work.** Every
directive in this file is one web search away. What is *not* one search away is proving, on
this specific box, that applying it will not lock you out. Where a section has an audit
step, that step is not optional and does not come second.

## SSH: key-only authentication

Three directives make sshd key-only. This section is long because typing them blind is how
you lose a server: if anything on the box still gets in by password — a colleague, a backup
job, your own phone — you find out once you are already locked out, and the provider's web
console will not save you (see §5). So: audit, apply, verify, *then* close the session you
started from.

### 1. Audit first — prove nothing uses password auth

**Which methods have ever actually succeeded.** The most informative command here. It
reads history, not intent:

```bash
grep 'Accepted' /var/log/auth.log \
  | grep -oE 'Accepted (password|publickey|keyboard-interactive[^ ]*) for [a-z_-]+' \
  | sort | uniq -c
# and the rotated logs, where anything older than a week lives:
zgrep 'Accepted' /var/log/auth.log.*.gz 2>/dev/null \
  | grep -oE 'Accepted (password|publickey|keyboard-interactive[^ ]*) for [a-z_-]+' \
  | sort | uniq -c
```

If every line says `publickey`, password auth has never once let anybody in and is pure attack
surface — dead weight you carry for bots. A single `password` line is a stop sign: find out
whose it was before going further.

**How much noise it absorbs**, for context on why this is worth doing at all:

```bash
grep -c 'Failed password' /var/log/auth.log
```

On any internet-facing box with port 22 open this runs into the tens of thousands within weeks.
None of them can succeed once password auth is off.

**The effective config, not the file.** This matters more than it sounds:

```bash
sshd -T | grep -iE 'passwordauth|kbdinteractive|permitroot'
```

`sshd -T` dumps the configuration sshd actually computed. Reading `sshd_config` is *not*
reading the config: a commented-out directive does not mean "off", it means "fall back to
the compiled-in default" — and the default for `PasswordAuthentication` is `yes`. A file
full of `#PasswordAuthentication yes` lines tells you nothing. Trust `sshd -T` only.

**Which accounts have a usable password.** A login shell plus a real hash is a live
password door, whatever sshd is configured to do today:

```bash
awk -F: '$7 !~ /(nologin|false)$/ {print $1}' /etc/passwd
sudo grep '^<user>:' /etc/shadow | cut -d: -f2     # for each name that printed
```

A hash field of `!`, `*` or `!!` means no usable password. Anything starting `$y$`, `$6$`
or similar is a real hash and needs explaining before you continue.

**Your own automation.** sshd's logs only know about this box. Grep the things that
connect *to* it:

```bash
grep -rnE 'sshpass|PasswordAuthentication=yes' ~/ --include='*.sh' --include='*.yml' 2>/dev/null
```

`sshpass` in a deploy script, or `-o PasswordAuthentication=yes` in a CI job, is a
dependency no server-side audit can see. Clear this before concluding.

### 2. The setting

The drop-in lives in this repo as [`../ssh/10-hardening.conf.example`](../ssh/10-hardening.conf.example).
**Copy it** into place — never symlink it:

```bash
sudo install -m 644 ~/dotfiles/ssh/10-hardening.conf.example \
  /etc/ssh/sshd_config.d/10-hardening.conf
```

This is the one place where the repo's symlink-everything convention is deliberately
inverted: a symlink would let a future `git pull` silently rewrite live sshd policy on every
machine — an unreviewed config change to the one service that can lock you out.

`sshd_config` ships with `Include /etc/ssh/sshd_config.d/*.conf` **near the top**, and sshd
takes the **first** value it obtains for a keyword. So an early-included drop-in wins outright
and the main file needs no edit — the distro's file stays pristine and your change lives in one
removable file. Confirm the `Include` really is near the top
(`grep -n Include /etc/ssh/sshd_config`); "first wins" cuts the other way at the bottom.

`PermitRootLogin` stays `prohibit-password` rather than `no` on purpose: on a single-admin box,
root-with-a-key is how both you and any deploy key get in, so `no` would lock out the only
account that matters. `prohibit-password` already denies exactly what this exercise is about,
and is pinned explicitly so a future distro default cannot move it underneath you.

### 3. Apply sequence

```bash
sudo install -m 644 ~/dotfiles/ssh/10-hardening.conf.example \
  /etc/ssh/sshd_config.d/10-hardening.conf
sudo sshd -t                 # silent == valid. ANY output: stop, rm the file, start over.
sudo sshd -T | grep -iE 'passwordauth|kbdinteractive|permitroot'
sudo systemctl reload ssh    # reload. NOT restart.
```

**Reload, never restart.** The reason is worth knowing rather than memorising:

- The unit's `ExecReload` runs `sshd -t` first with `ignore_errors=no`, then
  `kill -HUP $MAINPID`. A broken config fails that test, so the reload **aborts** and the
  old, working sshd keeps running. `restart` has no such gate: it stops sshd, fails to
  start the replacement, and leaves you with no sshd at all.
- `HUP` re-execs the master process only. Established sessions are forked children and are
  never signalled, so **your current connection survives** — including the one you need for
  rollback.

### 4. Verify — two loopback tests, no second device needed

The part most guides skip, and the part that makes the procedure safe. Both tests run on the
box itself against `127.0.0.1`: no phone, no laptop, no second network.

**Negative test — does the server still offer `password`?** The trick worth teaching: sshd's
denial message *enumerates the methods it was willing to try*, so a deliberately failed login
is a direct read of server policy — far better evidence than a config file.

```bash
ssh -o BatchMode=yes -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password,keyboard-interactive \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1 true
```

- Before: `Permission denied (publickey,password).`
- After: `Permission denied (publickey).`

That disappearing `password` is the whole deliverable. Both runs "fail" — the failure *is*
the measurement.

**Positive test — does key auth still work through the reloaded sshd?** Run this when a
private key for an authorized key is present on the box:

```bash
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/<your_key> \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    root@127.0.0.1 'echo PUBKEY-LOGIN-OK'
```

`PUBKEY-LOGIN-OK` on stdout means key auth survived the reload. First confirm you hold the
private half of an authorized key, or the test proves nothing about the key you will log in
with tomorrow — `ssh-keygen -lf ~/.ssh/<your_key>.pub` must print a fingerprint that
appears in `ssh-keygen -lf ~/.ssh/authorized_keys`.

Then two things loopback cannot tell you: check that **the session you are sitting in is
still alive**, and open **one genuinely new client session** from your laptop and watch it
log in. Loopback proves policy; a real client proves reachability.

### 5. Rollback and break-glass

Rollback, from the session you deliberately kept open:

```bash
sudo rm /etc/ssh/sshd_config.d/10-hardening.conf
sudo sshd -t
sudo systemctl reload ssh
```

Three commands and the box is exactly as it was — the payoff for putting the change in one
drop-in instead of editing `sshd_config`.

Now the part most people get wrong. **A provider's web console is not a fallback if the root
password hash is locked.** If `/etc/shadow` shows `!` or `*` for root — which, on a key-only
box, it very likely does — the console hands you a login prompt and no password on earth
satisfies it. The console is a keyboard, not an authentication bypass.

The real break-glass is your provider's **rescue mode**: boot a rescue image, mount the system
disk, delete the drop-in, reboot. Hetzner-style rescue mode works this way and most providers
have an equivalent. **Confirm you can reach it in your provider's panel before you rely on
it** — find the button, know whether it needs a reboot and whether it mails you a one-time
root password. Learning that rescue mode is unavailable on your plan while locked out is a bad
time to learn it.

Simplest of all, and why the apply sequence is ordered as it is: **keep the original session
open until verification passes.** An open session is a live root shell that no sshd policy
change can revoke — the cheapest safety net available, costing nothing but patience.

### 6. Gotchas

- **Socket activation makes `Port` inert** (Ubuntu 22.10+, including 24.04). When
  `ssh.socket` is enabled, systemd owns `0.0.0.0:22` and hands accepted connections to sshd,
  so `Port` and `ListenAddress` in `sshd_config` are **silently ignored** — the classic "I
  changed the port and nothing happened". Check `systemctl is-enabled ssh.socket`; if
  enabled, the port lives in the socket unit (`systemctl edit ssh.socket`, `ListenStream=`),
  not in `sshd_config`.
- **`PasswordAuthentication no` alone is not enough.** Some PAM stacks answer
  `keyboard-interactive` with a password prompt — a different authentication method, not
  covered by `PasswordAuthentication`. `KbdInteractiveAuthentication no` closes that side
  channel, and it is why the negative test asks for *both* methods.
- **This does not quiet your logs.** Bots keep knocking at the same rate; they simply cannot
  succeed. If `Failed password` volume itself is the problem, that is a `fail2ban` question (a
  future section here) — a log-volume fix, not a security fix. Conflating the two is how people
  install `fail2ban` and think they are done.
- **Audit the box you are on, not the box you remember.** Re-run §1 per host: this document is
  portable, its answers are not.
