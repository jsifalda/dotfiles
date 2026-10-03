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
test -f /var/log/auth.log || echo 'NO auth.log — use journalctl instead (see below)'
grep 'Accepted' /var/log/auth.log \
  | grep -oE 'Accepted (password|publickey|keyboard-interactive[^ ]*) for [A-Za-z0-9._-]+' \
  | sort | uniq -c
# and the rotated logs, where anything older than a week lives:
zgrep 'Accepted' /var/log/auth.log.*.gz \
  | grep -oE 'Accepted (password|publickey|keyboard-interactive[^ ]*) for [A-Za-z0-9._-]+' \
  | sort | uniq -c
```

The username pattern is `[A-Za-z0-9._-]+`, not `[a-z_-]+`: digits and capitals are legal in
account names, and the narrow class silently truncates `admin1` to `admin` and fails to match
`2fa-bot` at all — which, because `grep -o` prints only matches, discards that whole log line
instead of flagging it.

Three ways this check lies to you, and all three read as "clean":

- **There is no `auth.log`.** journald-only systems and minimal container images never write
  one, and the RHEL family calls it `/var/log/secure`. The `grep` then matches nothing and
  prints nothing — indistinguishable from a box where only keys have ever been used. Hence the
  `test -f` line. Where the journal is the log, ask it instead:

  ```bash
  journalctl -u ssh --no-pager | grep 'Accepted'
  ```

- **Errors swallowed.** There is deliberately no `2>/dev/null` on the `zgrep`: "no such file or
  directory" is precisely the signal you need, and hiding it is how an empty result gets
  mistaken for a good one.

- **A short window.** Debian/Ubuntu rotate `auth.log` weekly keeping `rotate 4`, so the
  commands above see roughly five weeks — not the life of the box. Print the real window before
  trusting it:

  ```bash
  ls -la /var/log/auth.log*
  ```

If every line says `publickey`, then **for as far back as the retained logs go**, password auth
has not let anybody in and is pure attack surface — dead weight you carry for bots. That is a
bounded claim, not a lifetime one; a box reinstalled or rotated last week has little to say. A
single `password` line is a stop sign: find out whose it was before going further.

**How much noise it absorbs**, for context on why this is worth doing at all:

```bash
grep -c 'Failed password' /var/log/auth.log
```

On any internet-facing box with port 22 open this runs into the tens of thousands within weeks.
None of them can succeed once password auth is off.

**The effective config, not the file.** This matters more than it sounds:

```bash
sudo sshd -T | grep -iE 'passwordauth|kbdinteractive|permitroot'
```

The `sudo` is load-bearing. Without root, `sshd -T` cannot read the host keys, so it prints
`sshd: no hostkeys available -- exiting.` on stderr and **zero lines** on stdout — the grep
matches nothing and a silent, failed command looks exactly like a clean config.

`sshd -T` dumps the configuration sshd actually computed. Reading `sshd_config` is *not*
reading the config: a commented-out directive does not mean "off", it means "fall back to
the compiled-in default" — and the default for `PasswordAuthentication` is `yes`. A file
full of `#PasswordAuthentication yes` lines tells you nothing. Trust `sshd -T` for the
**global** config, and only that — see the next step for what it leaves out.

**`Match` blocks — the hole in the command above.** `man sshd` on `-T` says Match rules are
applied only when the connection parameters are supplied with one or more `-C` options. So a
plain `sudo sshd -T` can report `passwordauthentication no` while a live `Match User backup`
block further down sets `PasswordAuthentication yes` for that account. Find the blocks:

```bash
grep -rn -iE '^[[:space:]]*Match' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/
```

Then re-evaluate the config **as** each connection they govern. The `-C` values have to
*resemble the real connection*, or the rule you are hunting will not fire: a `Match User`
block keys on `user`, but `Match Address` keys on `addr`, and `Match LocalPort` on `lport`.
Passing `addr=127.0.0.1` tests the loopback case only — it will happily report `no` while a
`Match Address 10.0.0.0/8` block hands out password auth to the entire private range:

```bash
# A Match User rule, as that user arriving from a representative remote address:
sudo sshd -T -C user=<u>,host=<their-hostname>,addr=<their-remote-ip> \
  | grep -iE 'passwordauth|kbdinteractive'

# An address- or port-keyed rule: supply the values IT selects on.
# -C accepts user, host, addr, laddr, lport and rdomain.
sudo sshd -T -C user=<u>,addr=10.1.2.3,laddr=<this-host-ip>,lport=22 \
  | grep -iE 'passwordauth|kbdinteractive'
```

No output from the `grep -rn` is the answer you want. Any `Match` line means the global value
you just read is not the whole policy: check **every** rule with parameters matching the
connections it governs before concluding the box is key-only. One `-C` run per account is not
enough if a rule keys on something other than the username.

**Record `PermitRootLogin` before you touch anything.** Write the current value down:

```bash
sudo sshd -T | grep -i permitrootlogin
```

**If it already reads `no`, delete the `PermitRootLogin` line from your copy of the drop-in
before installing it.** Because the drop-in is included early and the first value wins, leaving
that line in would *relax* a stricter setting something else on this box already made. §2
explains exactly how that happens.

**Which accounts have a usable password.** A login shell plus a real hash is a live
password door, whatever sshd is configured to do today:

```bash
awk -F: '$7 !~ /(nologin|false)$/ {print $1}' /etc/passwd
sudo passwd -S <user>     # for each name printed: L = locked, NP = NO PASSWORD, P = usable
```

Or every account at once, with no hash on screen:

```bash
sudo awk -F: '{print $1, ($2=="" ? "EMPTY-NO-PASSWORD" : ($2 ~ /^[!*]/ ? "locked" : "HASH-PRESENT"))}' /etc/shadow
```

How to read that:

- A second field that **begins with** `!` or `*` is disabled. Test the first character, not the
  whole field: `passwd -l` prefixes the existing hash, leaving `!$6$...`, which an equality
  check against `!` misses entirely. `!!` (never set) is the same case.
- An **empty** second field means no password is required at all — a wider-open door than any
  hash, and the easiest one to overlook because there is nothing there to see.
- Anything else — `$y$`, `$6$` and friends — is a real hash and needs explaining before you
  continue.

Deliberately *not* `grep '^<user>:' /etc/shadow | cut -d: -f2`: that writes a full hash into
your scrollback, your tmux buffer and any session recording, to answer a question that one
character settles. Never print the hash when you only need its first byte.

**Prove you hold a key that will still work afterwards.** Do this *before* installing anything,
because once password auth is off it is the only way back in. Check the **target account's**
file — the §4 tests log in as `root@`, so that means `/root/.ssh/authorized_keys`, not your own
`~` — and let sshd tell you where that file actually is:

```bash
sudo sshd -T | grep -i -e authorizedkeysfile -e authorizedkeyscommand
```

`AuthorizedKeysFile` can relocate the file or list several, and `AuthorizedKeysCommand` can
replace it with a script, in which case there is no file to read and the check has to go through
whatever that command queries. With the real path in hand:

```bash
ssh-keygen -lf ~/.ssh/<your_key>.pub
sudo ssh-keygen -lf /root/.ssh/authorized_keys      # or the path sshd just reported
```

The fingerprint from the first command must appear in the output of the second. If it does not,
you are about to lock yourself out: stop here and fix that first.

**Your own automation — and this is the step that cannot be finished on this box.** sshd's logs
only know about connections that arrived. Anything that *initiates* one lives somewhere else by
definition, so grepping this server's `~/` cannot clear it. Run the scan on **every machine and
CI system that connects to this host**, from the root of each repo or config tree:

```bash
grep -rnE 'sshpass|ansible_ssh_pass|ansible_password|PasswordAuthentication=yes|PubkeyAuthentication=no' . \
  --include='*.sh' --include='*.yml' --include='*.yaml' --include='*.ini' --include='*.cfg' \
  --include='Dockerfile*' --include='Makefile' --include='Jenkinsfile*'
```

`sshpass` in a deploy script, or `-o PasswordAuthentication=yes` in a CI job, is a dependency no
server-side audit can see. But a clean grep only narrows the search — it never clears it. The
irreducible manual step: **list the systems that SSH into this box — people, deploy pipelines,
backup jobs, monitoring agents — and confirm for each one that it authenticates with a key.**
That list is the actual audit; the grep is a shortcut for finding the obvious offenders in it.

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
takes the **first** value it obtains for a keyword. So an early-included drop-in wins in the
global section and the main file needs no edit — the distro's file stays pristine and your
change lives in one removable file. A matching `Match` block still overrides it, which is why §1
goes looking for those. Confirm the `Include` really is near the top
(`grep -n Include /etc/ssh/sshd_config`); "first wins" cuts the other way at the bottom.

**The `10-` prefix cuts both ways.** `man sshd_config` says `Include` globs are expanded in
**lexical order**, so `10-hardening.conf` is read *before* `50-cloud-init.conf` — and under
first-value-wins, being read first means *overriding*. Consequence, stated plainly: on a host
where `PermitRootLogin no` arrives from a cloud-init drop-in or a CIS/USG hardening profile,
copying this file in **silently re-enables root SSH key login**. The prefix that makes the
hardening stick is the same prefix that lets it undo someone else's. Nothing warns you, which
is the entire reason §1 makes you record the value first: **if `PermitRootLogin` already reads
`no`, delete that line from your copy before installing it.**

`PermitRootLogin` is pinned explicitly rather than left to inherit, so a future distro default
cannot move it underneath you. Choose the value deliberately:

- **Preferred:** a non-root admin user with its own key and `sudo`, and then `PermitRootLogin
  no`. Sudo keeps attribution in the logs, and one compromised key is then a user shell plus a
  further step, not an instant uid-0 shell.
- **Fallback:** `prohibit-password` on a box with no such user yet — the common single-admin VPS
  case, and what the example file ships with, labelled as the fallback it is. It denies exactly
  what this exercise is about.

What `no` does **not** do is lock you out of root. It blocks root **over SSH only**; root stays
reachable through `sudo -i` or `su` from any sudo-capable account, through the provider console,
and through rescue mode — the same paths §5 leans on for break-glass.

### 3. Apply sequence

First, find out whether systemd owns the listener, because it decides what the `reload` at the
end is really doing:

```bash
systemctl is-enabled ssh.socket
```

Syntax-check your copy of the drop-in *before* it goes anywhere near `/etc/ssh`:

```bash
sudo sshd -t -f ~/dotfiles/ssh/10-hardening.conf.example   # silent == parses
```

Then install, re-test the merged config, read back what sshd computed, and reload:

```bash
sudo install -m 644 ~/dotfiles/ssh/10-hardening.conf.example \
  /etc/ssh/sshd_config.d/10-hardening.conf
sudo sshd -t                 # silent == valid. ANY output: stop, rm the file, start over.
sudo sshd -T | grep -iE 'passwordauth|kbdinteractive|permitroot'
sudo systemctl reload ssh    # reload. NOT restart.
```

Expect that third command to print `permitrootlogin without-password` even though the file says
`prohibit-password`. `without-password` is the deprecated alias for the same setting and
`sshd -T` still renders it that way — the change worked; nothing was ignored.

**Reload, never restart.** The reason is worth knowing rather than memorising:

- The unit's `ExecReload` runs `sshd -t` first, then `kill -HUP $MAINPID`. Neither line is
  prefixed with `-`, so a broken config fails the test, the reload **aborts**, and the old,
  working sshd keeps running.
- `restart` is *also* gated — the shipped unit carries `ExecStartPre=/usr/sbin/sshd -t` — but
  the gate sits in the wrong place to save you: by the time it runs, systemd has already stopped
  the old daemon. The test then fails, the new daemon never starts, and you are left with no
  sshd at all. `reload` tests while the working daemon is still up. That ordering, not the
  presence of a test, is the whole difference.
- `HUP` re-execs the master process only. Established sessions are forked children and are
  never signalled, so **your current connection survives** — including the one you need for
  rollback.

**What `reload` means under socket activation.** If `systemctl is-enabled ssh.socket` said
`enabled`, check how the socket hands connections over:

```bash
systemctl cat ssh.socket | grep -i accept
```

- **`Accept=no`** — how Ubuntu 24.04 ships it. systemd holds the listening socket but passes it
  to a single long-running `sshd -D`, so there *is* a master process to signal and everything
  above applies exactly as written.
- **`Accept=yes`** — a fresh `sshd` is forked per connection and reads the config as it starts.
  Nothing is holding a stale config and a reload has nothing to re-read: the drop-in is live for
  new connections the moment it is written. There, the `sshd -t -f` you ran *before* installing
  is the real gate, and the window for catching a mistake closes at `install`, not at `reload`.

### 4. Verify — two loopback tests, no second device needed

The part most guides skip, and the part that makes the procedure safe. Both tests run on the
box itself against `127.0.0.1`: no phone, no laptop, no second network.

**Negative test — does the server still offer `password`?** The trick worth teaching: sshd's
denial message *enumerates the methods it was willing to try*, so a deliberately failed login
is a direct read of server policy — far better evidence than a config file.

```bash
# StrictHostKeyChecking=no + UserKnownHostsFile=/dev/null are safe here ONLY because the target
# is 127.0.0.1 (and BatchMode=yes would otherwise abort on the first-contact host-key prompt).
# Never carry those two flags to a remote host: they turn a loud MITM failure into a silent success.
ssh -o BatchMode=yes -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password,keyboard-interactive \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@127.0.0.1 true
```

- Before: `Permission denied (publickey,password).`
- After: `Permission denied (publickey).`

That disappearing `password` is the whole deliverable. Both runs "fail" — the failure *is*
the measurement.

Two things to know about this test, both checked by experiment rather than assumed:

- **It genuinely tracks the global `PasswordAuthentication`, even when the target is root.** The
  natural objection is that `PermitRootLogin prohibit-password` already refuses root's password,
  so the `password` in that list might be an artefact and the test insensitive. It is not: a
  throwaway sshd on a loopback-only port configured with `PermitRootLogin prohibit-password`
  *and* `PasswordAuthentication yes`, targeted at root, still answers
  `Permission denied (publickey,password).` `prohibit-password` does not remove `password` from
  the advertised method list. Nor does the "Before" line require `PermitRootLogin yes`: it is
  what a box prints at the stock default of `prohibit-password`, before the drop-in lands.
- **It only exercises the account you target.** A `Match User deploy` block that re-enables
  password auth for somebody else will not show up in a root-scoped run. Run it once per
  non-root account enumerated in §1 — e.g. `deploy@127.0.0.1`:

  ```bash
  ssh -o BatchMode=yes -o PubkeyAuthentication=no \
      -o PreferredAuthentications=password,keyboard-interactive \
      -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null <user>@127.0.0.1 true
  ```

**Positive test — does key auth still work through the reloaded sshd?** Run this when a
private key for an authorized key is present on the box. You already confirmed in §1 that you
hold the private half of a key listed for the target account; this checks that sshd still
accepts it:

```bash
# Same caveat as above: the two host-key flags are acceptable only against 127.0.0.1.
# Target the account YOU actually log in as -- see the note below.
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/<your_key> \
    -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    <your-login-account>@127.0.0.1 'echo PUBKEY-LOGIN-OK'
```

**Use the account you will really log in with, not reflexively `root`.** If you took the
preferred posture — a non-root admin user plus `PermitRootLogin no` — then a root run of this
test is *supposed* to fail, and reading that failure as "key auth is broken" is how a working
box gets rolled back for no reason. Test `<admin>@127.0.0.1`. Only test `root@` if root-with-key
is genuinely your access path (the `prohibit-password` fallback case).

`PUBKEY-LOGIN-OK` on stdout means key auth survived the reload. If you skipped the fingerprint
check in §1, go back and do it now — without it this test proves only that *some* key works,
not that it is the key you will log in with tomorrow.

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
password hash is locked.** If `/etc/shadow` shows a field starting `!` or `*` for root — which,
on a key-only box, it very likely does — the console hands you a login prompt and no password on
earth satisfies it. The console is a keyboard, not an authentication bypass.

The real break-glass is your provider's **rescue mode**: boot a rescue image, mount the system
disk, delete the drop-in, reboot. Most providers have an equivalent of this. **Confirm you can
reach it in your provider's panel before you rely on it** — find the button, know whether it
needs a reboot and whether it mails you a one-time root password. Learning that rescue mode is
unavailable on your plan while locked out is a bad time to learn it.

Simplest of all, and why the apply sequence is ordered as it is: **keep the original session
open until verification passes.** An open session is a live root shell that no sshd policy
change can revoke — the cheapest safety net available, costing nothing but patience.

### 6. Gotchas

- **Socket activation changes *when* `Port` and `ListenAddress` take effect — it does not make
  them inert.** Two different situations get conflated here, and the difference is a whole
  release cycle:
  - **Ubuntu 24.04, and any release shipping `sshd-socket-generator`.** `openssh-server`
    installs `/usr/lib/systemd/system-generators/sshd-socket-generator`, which parses
    `sshd_config` and generates `ssh.socket`'s `ListenStream=` from it. The value **is** read.
    It simply is not applied until the socket is regenerated. The distro's own
    `/etc/ssh/sshd_config` says so verbatim: *"When systemd socket activation is used (the
    default), the socket configuration must be re-generated after changing Port, AddressFamily,
    or ListenAddress. For changes to take effect, run: `systemctl daemon-reload` /
    `systemctl restart ssh.socket`."* Edit `sshd_config`, then run those two commands.
  - **Ubuntu 22.10 through 23.10** shipped socket activation *before* that generator existed.
    There the directives really were inert and the port had to be set in the socket unit. This
    is where the "I changed the port and nothing happened" folklore comes from — do not carry it
    forward to 24.04.

  If you do override the socket unit by hand (`systemctl edit ssh.socket`), know that
  `ListenStream=` in a systemd drop-in **appends** to the inherited list. It does not replace
  it unless you reset the list first with a bare `ListenStream=`:

  ```ini
  [Socket]
  ListenStream=
  ListenStream=2222
  ```

  Without that empty line, adding `ListenStream=2222` leaves the box listening on 2222 **and**
  22 while you believe SSH moved. Ask the kernel, not the config:

  ```bash
  ss -ltnp | grep sshd
  ss -ltnp | grep -E ':(22|2222)\b'   # with Accept=yes and no live connection, the fd
                                      # belongs to systemd, not sshd — match the port instead
  ```
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
