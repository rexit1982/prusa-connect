---
title: Install from a release
description: Which file to download for Linux, a Raspberry Pi, Windows or macOS, how to check it, where the server keeps its data, the first-run questions, adding a printer with a USB drive, and running it as a systemd service.
audience: run
rewrite:
  describes: current
  implementedBy:
    - .github/workflows/release.yml
    - .github/workflows/beta-portal.yml
    - deploy/systemd/prusa-connect.service
    - deploy/firewalld
    - config/config.yaml
    - compose/compose.go
    - internal/kernel/version
    - internal/transport/http/httpapi/setup.go
---

This page is for a person who downloads Prusa Connect from a release and
runs it. You need no programming tools. You download one file for your machine,
start it, set it up in a wizard in the browser, and point a printer at it with
a USB drive. You need no configuration file: the wizard writes one.

| command | does |
|---|---|
| `./prusa_connect_<file> --version` | prints the version of the file you downloaded |
| `./prusa_connect_<file>` | starts the server in this folder, on port 8080 |
| `./prusa_connect_<file> -addr :8090` | starts it on port 8090 instead |
| `curl -s http://127.0.0.1:8080/api/v1/health` | answers while the server runs, with its version |
| `sha256sum --check --ignore-missing SHA256SUMS` | checks the files you downloaded from a GitHub release |
| `sha256sum prusa_connect_<file>` | prints the checksum of the file, to compare with the one the Beta Portal shows |

| file | purpose |
|---|---|
| `prusa_connect_<file>` | the server. One file with the web app inside |
| `config.yaml` | a configuration to start from, for a person who prefers a file. You do not need it |
| `prusa-connect.service` | the systemd unit, for running it as a service on Linux |

The downloads page lists the binaries for each platform. It lists
`config.yaml` and `prusa-connect.service` under
**Files for every platform**.

## Pick the file for your machine

| your machine | file |
|---|---|
| a Linux PC or NAS, 64-bit Intel or AMD | `prusa_connect_amd64` |
| a Raspberry Pi Zero 2 W, 3, 4 or 5 with a 64-bit system | `prusa_connect_aarch64` |
| a Raspberry Pi 2, Zero 2 W, 3, 4 or 5 with a 32-bit system | `prusa_connect_armv7` |
| a Raspberry Pi Zero, Zero W or 1 | `prusa_connect_armhf` |
| Windows on Intel or AMD | `prusa_connect_windows_amd64.exe` |
| Windows on ARM | `prusa_connect_windows_arm64.exe` |
| a Mac with an Intel processor | `prusa_connect_macos_amd64` |
| a Mac with Apple silicon, M1 and later | `prusa_connect_macos_arm64` |

On a Raspberry Pi, `uname -m` says which one you need. `aarch64` means the
64-bit file, and the `armv7` file runs there too. `armv7l` means `armv7`
only, and `armv6l` means `armhf`. A Pi 3, 4, 5 or Zero 2 W reports `aarch64`
or `armv7l`, depending on the system you installed.

On Linux, if you want the server to run as a service, download
`prusa-connect.service` and `config.yaml` as well, from
**Files for every platform**. A
file with `minimal` in its name is a smaller Linux build with no web app, so do
not pick it for a first install.

## Check the download

A checksum is a long number computed from the file's bytes. If one byte
changed, the number changes too.

A release on GitHub lists `SHA256SUMS` beside the binaries. It holds the
SHA-256 checksum of every file in that release. Download it into the folder
that holds the downloads, and check every file you downloaded against it:

```text
$ sha256sum --check --ignore-missing SHA256SUMS
prusa_connect_amd64: OK
```

On a Mac, the same check is
`shasum -a 256 --check --ignore-missing SHA256SUMS`.

The Beta Portal works another way. Its downloads page shows the SHA-256
checksum of each file you download, under **Verify your download**. Each
tester's copy of a binary carries a small fingerprint of its own, so compare
your file with the checksum the page shows for your download. `SHA256SUMS` from
GitHub does not match such a copy.

On Linux, in the folder that holds the downloads, put the checksum from the
page in place of `<checksum>`. Two spaces go between the checksum and the file
name:

```text
$ echo '<checksum>  prusa_connect_amd64' | sha256sum -c
prusa_connect_amd64: OK
```

On Windows, in PowerShell, in the folder that holds the downloads. `True` means
the file matches:

```text
> (Get-FileHash .\prusa_connect_windows_amd64.exe -Algorithm SHA256).Hash -eq '<checksum>'
True
```

On a Mac, run `shasum -a 256 prusa_connect_macos_arm64` in Terminal. It
prints the checksum and the file name. Compare the checksum with the one the
downloads page shows for that file.

## Start it on Linux or a Raspberry Pi

Make a folder for the server and put the binary in it. The server keeps
everything it writes in two folders inside the folder you start it in:
`config` for its settings and database, and `storage` for the files you
upload. It creates both itself.

In the folder that holds the downloads:

```text
$ mkdir -p ~/prusa-connect
$ cp prusa_connect_amd64 ~/prusa-connect/
$ cd ~/prusa-connect
$ chmod +x prusa_connect_amd64
$ ./prusa_connect_amd64 --version
prusa-connect 0.1.0
```

The database in this folder holds the password hashes, so keep the folder
private to your own user:

```text
$ chmod 700 ~/prusa-connect
$ ls -ld ~/prusa-connect
drwx------ 3 you you 4096 Sep 29 21:13 /home/you/prusa-connect
```

If you want a configuration file of your own as well, put it at
`config/config.yaml`. Every key it sets wins over the wizard, and the wizard
shows that key as fixed. A `config.yaml` left beside the binary is not read,
and the log says where the server looked and where the file is:

```text
time=2026-09-29T21:07:45.415+02:00 level=WARN msg="no configuration file, so the server runs on its defaults and has no storage for uploads" looked_at=/home/you/prusa-connect/config/config.yaml found=[/home/you/pcl-mis/prusa-connect/config.yaml] fix="move the file to /home/you/pcl-mis/prusa-connect/config/config.yaml, or start with -config <file>"
```

Start it. It runs in the foreground and writes its log to the terminal. Ctrl+C
stops it.

```bash
./prusa_connect_amd64
```

The first line names the version and the configuration file. The first
warning says there is no configuration file, which is expected: the wizard
makes the choices instead. The other says that nobody has answered the
first-run questions yet. Under it is the setup code the first-run page asks
for. Only somebody who can read this log has it, so nobody else on your
network can set the server up first:

```text
time=2026-09-29T15:43:22.583+02:00 level=INFO msg=starting version=0.1.0 config=config/config.yaml overlay=config/config.d/resources.json
time=2026-09-29T15:43:22.590+02:00 level=WARN msg="no configuration file, so the server runs on its defaults and has no storage for uploads" looked_at=/home/you/prusa-connect/config/config.yaml
time=2026-09-29T15:43:22.641+02:00 level=WARN msg="this server has recorded nothing about identity; it serves the first run and nothing else, and asks for this setup code" setup="POST /api/v1/setup" setup_code=X4ZF-VBX9-GMPH

  This server is not set up yet. Open one of these addresses in a
  browser:

      http://localhost:8080
      http://192.168.1.50:8080

  and enter this setup code:

      X4ZF-VBX9-GMPH

  The code works once. A restart prints a new one.

time=2026-09-29T15:43:22.674+02:00 level=INFO msg=serving api=[::]:8080 reference=http://[::]:8080/docs openapi=http://[::]:8080/openapi.json health=http://[::]:8080/api/v1/health
```

From a second terminal on the same machine:

```text
$ curl -s http://127.0.0.1:8080/api/v1/health
{"status":"ok","version":"0.1.0"}
```

Open one of the addresses the banner names, in a browser on this machine or
on your network. [Set it up in the wizard](#set-it-up-in-the-wizard) says what
the wizard asks.

To keep the server running after you log out, and to start it when the machine
starts, [run it as a service](#run-it-as-a-service-on-linux).

### Let the time server open its port

The time server answers on UDP port 123. On Linux a normal user may not open a
port below 1024, so when you start the binary yourself the time server
reports `failed` with `permission denied`. Give the binary that one right:

```text
$ sudo setcap cap_net_bind_service=+ep ./prusa_connect_amd64
```

The right belongs to the file. Replacing the file removes it, and so does an
update, also one the server installs itself. Run the command again after each
update, or the time server goes back to `failed`.

The service in [Run it as a service](#run-it-as-a-service-on-linux) already
has this right, so it needs no `setcap`. Do not run `setcap` on the binary in
a container image: the container then does not start (see
[Port 80 without capabilities](./container.md#port-80-without-capabilities)).

## Start it on Windows

Make the folder in your user profile, such as
`C:\Users\<you>\prusa-connect`, and put the `.exe` in it. Starting
the file with a double click works too: Windows starts it in its own folder.

A folder in your profile is readable only by you, the system and the
administrators, and the database there holds the password hashes. The names
appear in your system's language:

```text
> icacls $env:USERPROFILE\prusa-connect
C:\Users\you\prusa-connect NT AUTHORITY\SYSTEM:(I)(OI)(CI)(F)
                                 BUILTIN\Administradores:(I)(OI)(CI)(F)
                                 you-pc\you:(I)(OI)(CI)(F)

Successfully processed 1 files; Failed processing 0 files
```

A folder at the top of the drive, such as `C:\prusa-connect`, lets every
user on the machine read it. If you use one, remove the inherited rights and
grant only yourself, the system and the administrators. The `*S-1-5-...` names
are the system and the administrators in any language:

```text
> icacls C:\prusa-connect /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" /grant:r "*S-1-5-18:(OI)(CI)F" /grant:r "*S-1-5-32-544:(OI)(CI)F"
processed file: C:\prusa-connect
Successfully processed 1 files; Failed processing 0 files
```

Then open PowerShell in the folder:

```text
> .\prusa_connect_windows_amd64.exe --version
prusa-connect 0.1.0
> .\prusa_connect_windows_amd64.exe
```

The log is the same as on Linux. Keep the window open while you use the
server. Closing it or pressing Ctrl+C stops the server.

The release is not signed, so Windows warns you the first time:

- **SmartScreen.** If you start the file by double-clicking it, Windows may
  show "Windows protected your PC". Choose **More info**, check that the name
  is the file you downloaded, then choose **Run anyway**. You can also clear the
  download mark in PowerShell with `Unblock-File .\prusa_connect_windows_amd64.exe`
- **Windows Defender Firewall.** The first start asks whether the program may
  use the network. Allow it on **Private networks**, or the printers cannot
  reach it

Another program may already use port 8080. Then the server stops at once, and
the last line of the log says so:

```text
prusa-connect core: bind the api listener on :8080: listen tcp :8080: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.
```

Start it on another port, and use that port in the browser and on the printer:

```text
> .\prusa_connect_windows_amd64.exe -addr :8090
```

On Linux the same failure ends with `bind: address already in use`.

## Start it on macOS

Make a folder and put the binary in it, the same way as on Linux. Then, in
Terminal, in that folder:

```bash
chmod +x prusa_connect_macos_arm64
./prusa_connect_macos_arm64
```

A release whose notes say the macOS binaries are signed and notarized starts
without a warning, and the rest of this section does not apply.

An unsigned release is blocked by Gatekeeper on the first start. Gatekeeper is
the part of macOS that checks where a program comes from. It shows a message
that Apple could not check the file for malicious software. Choose **Done**,
then open **System Settings**, then **Privacy & Security**. Near the bottom, the
page names the file. Choose **Open Anyway**, then start the file again.

You can also remove the download mark that Gatekeeper reads, before the first
start:

```bash
xattr -d com.apple.quarantine prusa_connect_macos_arm64
```

macOS may also ask whether the program may accept incoming network
connections. Allow it, or the printers cannot reach it.

## Where your data lives

Everything the server writes is in the folder you start it in. The paths in
`config/config.yaml` are relative to that folder.

| path | holds |
|---|---|
| `config/config.yaml` | your own configuration, if you wrote one. The server only reads it |
| `config/config.d/setup.yaml` | what the wizard set. A key in `config.yaml` wins over it |
| `config/config.d/setup.yaml.refused` | the wizard's answers the server could not start on, kept so you can read them |
| `config/config.d/certs/` | the certificates the wizard made, when you turned encryption on |
| `config/config.d/history.db` | the history of each printer, when the wizard keeps it |
| `config/config.d/authz.db` | the database: accounts, permissions, printers and their commands |
| `config/config.d/resources.json` | what the wizard, the web app and the API declared: the storage, the history store, the MQTT broker with its password |
| `config/config.d/modules/` | installed modules, once you install one |
| `config/config.d/beta-portal-pairing.json` | the private key and the token of the Beta Portal pairing, while updates are on. It sits beside `resources.json` |
| `storage/` | the print files you upload |

Under the systemd service, the files the wizard writes sit in `/etc/prusa-connect/config.d/`, beside `config.yaml`. They are `setup.yaml`, `certs/` and the history files. A Beta Portal pairing file that release 0.0.1-alpha.7 wrote stays there too. The rest stays in `/var/lib/prusa-connect`.

These are the files after the first start on Windows:

```text
> Get-ChildItem -Recurse -Name config
config.d
config.d\authz.db
config.d\authz.db-shm
config.d\authz.db-wal
config.d\beta-portal-pairing.json
config.d\resources.json
```

The two files ending in `-shm` and `-wal` belong to the database while it is
open. Keep them with `authz.db`.
[Upgrade, back up and uninstall](./upgrade-back-up-and-uninstall.md) says how
to copy these files safely.

## Set it up in the wizard

A new server serves only the wizard. It first asks for the setup code from the
log. If the log no longer shows the code, restart the server, and it prints a
new one. Your answers stay in the browser until you confirm, so a reload loses
nothing. The passwords and the setup code stay in that tab only. The language
and the colours of the wizard are at the top right.

Then you choose the basic path, with the few choices most people make, or the
advanced path, with almost every setting. Both ask:

- **Who may use this server?** Choose that everybody signs in, and create the
  first administrator. The other choice lets anybody on your network use the
  server without signing in
- **How does a new printer join?** Choose that you approve each printer. The
  printer then shows a code, and it joins when you approve that code
- **Files and history.** The folder for the files you upload, which the
  server checks it can write to, and how long it keeps each printer's charts
  and events
- **Encryption.** HTTPS for the web app, TLS for the printers, or neither.
  The wizard can make the certificates, and gives you `connect.der` for each
  printer's USB stick
- **Network and look.** The port, whether the server shows itself on the
  local network, an MQTT broker, the name, the language and
  the theme. A port you gave with `-addr` is shown fixed, and the wizard does
  not change it

The last page lists every answer. To change one, open its page from that list
or from the steps on the left. After a change, **Back to summary** returns to
the last page in one step. The wizard stops on the way at any page whose
answer is no longer valid. **Confirm and restart** checks that a new
port is free, writes the answers to `config/config.d/setup.yaml`, and the
server restarts on them by itself. The page waits for it. When you changed the
port or turned on HTTPS, it opens the new address. **Go to the fleet** then
signs you in and opens the fleet.

If the server does not start with the new answers, it goes back to the ones it
had and prints a new setup code. The wizard shows the error beside your
answers. Enter the new code, change the answer and confirm again.

The same first run over the API, without the wizard's configuration:

```text
$ curl -s -X POST http://127.0.0.1:8080/api/v1/setup -H 'content-type: application/json' -d '{"code":"X4ZF-VBX9-GMPH","mode":"required","account":{"username":"admin","password":"choose a long password"},"admission":"ask"}'
{"state":"done","mode":"required","admission":"ask","signed_in":true,"steps":[{"step":"mode","done":true,"detail":"Every caller presents a credential."},{"step":"administrator","done":true,"detail":"This server holds an account to sign in with."},{"step":"admission","done":true,"detail":"A new printer shows a code and waits for you to approve it."},{"step":"module:sink:graphql","done":false,"detail":"sink:graphql is switched off."},{"step":"module:link:fractal","done":false,"detail":"link:fractal is switched off."}]}
```

**Restart the server after the first run.** The answer about printers is read
when the server starts. After the restart the log says which one it uses:

```text
time=2026-09-29T15:43:26.702+02:00 level=INFO msg="the first run's admission choice is what this connector admits on" connector=core.connectors.xbuddy admission=ask mode=token
```

The password must be at least 8 characters long.
[Local accounts](./local-accounts.md) covers more accounts and resetting a
password.

## Add a printer with a USB drive

A Prusa printer finds the server through a small text file on a USB drive.
Create a file named `prusa_printer_settings.ini` in the top folder of the
drive:

```ini
[service::connect]
hostname = 192.168.1.100
port = 8080
tls = false
```

| key | set it to |
|---|---|
| `hostname` | the address of the machine that runs the server. At most 20 characters, see [Hostname length](./printer-configuration.md#hostname-length) |
| `port` | `8080`, or the port you gave with `-addr` |
| `tls` | `false`. The server answers plain HTTP unless you give it a certificate |
| `token` | not in the file. The printer gets its token from the server when its code is approved |

The web app shows the same file with your server's address filled in. Open
`http://<server>:8080/printers/add`, the **Add a printer** page. Its first
step downloads the file.

On the printer: insert the drive, open **Settings**, **Network**,
**Prusa Connect**, choose **Load Settings**, then **Add Printer to Connect**.

The printer shows a code. The **Add a printer** page shows the printer as
soon as it asks, without a reload. Check that the code and the fingerprint
match the printer's display, then choose **Approve**.

The same steps over the API, with a simulated printer that connected as
`PI-0000`. Log in once, then list what waits and approve its code:

```text
$ curl -s -c cookies.txt -X POST http://127.0.0.1:8080/api/v1/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"choose a long password"}'
{"expires_at":"2026-10-06T15:44:36.250411767+02:00"}
$ curl -s -b cookies.txt http://127.0.0.1:8080/api/v1/registrations
{"items":[{"code":"R9C62DEFN2","connector":"xbuddy","fingerprint":"DB7678992476E0D","serial":"PI-0000","model":"1.4.1","firmware":"6.4.0-0","approved":false}]}
$ curl -s -b cookies.txt -X POST http://127.0.0.1:8080/api/v1/registrations/R9C62DEFN2/approve
{"code":"R9C62DEFN2","connector":"xbuddy","fingerprint":"DB7678992476E0D","serial":"PI-0000","model":"1.4.1","firmware":"6.4.0-0","approved":true,"device_id":"0c9e4c47-7190-4a97-98db-3d446d436735"}
```

A few seconds later the printer is in `GET /api/v1/devices` with
`"connected": true`, and on the **Printers** page.

`prusa-connect registrations approve <code>` does the same from the
command line, and it is meant for a server that is stopped. A running server
does not see it until it restarts, and the command says so:

```text
$ ./prusa_connect_amd64 registrations approve 9GKY9TF99E
approved 9GKY9TF99E on xbuddy. A core that is already running reads its table at startup, so restart it, or use the API instead: POST /api/v1/registrations/<code>/approve.
```

If the printer never shows a code, [Bench preflight](./bench-preflight.md)
checks the cable, the address, the firewall and which program holds the port.

## Run it as a service on Linux

A service is a program the system starts when the machine starts, and restarts
when it stops by itself. The downloads page lists
`prusa-connect.service` under **Files for every platform**. It is a unit
file for systemd, which is the service manager of Raspberry Pi OS, Debian and
Ubuntu. Download it and `config.yaml` from there, beside the binary.

The unit runs the server as a user of its own, with one extra right. It may
open a port below 1024, for the time server on UDP port 123. The modules the
server starts do not get that right. It reads
`/etc/prusa-connect/config.yaml` and writes everything under
`/var/lib/prusa-connect`, which only that user may read. The setup
wizard's files are the exception: they go to
`/etc/prusa-connect/config.d`, the folder the `install -d` line below
makes writable for that user.

In the folder that holds the downloads:

```text
$ sudo useradd --system --home-dir /var/lib/prusa-connect --shell /usr/sbin/nologin prusa-connect
$ sudo install -d -o prusa-connect -g prusa-connect -m 0750 /var/lib/prusa-connect/bin
$ sudo install -o prusa-connect -g prusa-connect -m 0755 prusa_connect_amd64 /var/lib/prusa-connect/bin/prusa-connect
$ sudo ln -s /var/lib/prusa-connect/bin/prusa-connect /usr/local/bin/prusa-connect
$ sudo install -d -m 0755 /etc/prusa-connect
$ sudo install -d -o prusa-connect -g prusa-connect -m 0700 /etc/prusa-connect/config.d
$ sudo install -m 0644 config.yaml /etc/prusa-connect/config.yaml
$ sudo install -m 0644 prusa-connect.service /etc/systemd/system/prusa-connect.service
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now prusa-connect
Created symlink /etc/systemd/system/multi-user.target.wants/prusa-connect.service → /etc/systemd/system/prusa-connect.service.
```

On a Raspberry Pi, use the name of your file, such as
`prusa_connect_aarch64`, in the third line.

Check that it runs:

```text
$ systemctl status prusa-connect --no-pager | head -9
● prusa-connect.service - Prusa Connect, a local server for 3D printers
     Loaded: loaded (/etc/systemd/system/prusa-connect.service; enabled; vendor preset: enabled)
     Active: active (running) since Tue 2026-09-29 21:13:47 CEST; 5s ago
   Main PID: 97084 (prusa-connect-l)
      Tasks: 17 (limit: 14999)
     Memory: 20.6M
     CGroup: /system.slice/prusa-connect.service
             └─97084 /var/lib/prusa-connect/bin/prusa-connect -config /etc/prusa-connect/config.yaml
```

The unit keeps the server away from the rest of the system. It may not gain
rights or write outside its own folder, and it may use only the system calls a
service needs. A configuration the server refuses stops it at once, and after five
failed starts in five minutes systemd stops trying. `systemctl status` then
shows `failed`, and the journal names the line the server refused.

The service owns its binary under the state directory, so an administrator can
prepare and apply a signed release from the Updates page. The path under
`/usr/local/bin` is a symlink for commands typed in a terminal.

The log goes to the system journal:

```text
$ journalctl -u prusa-connect --no-pager | grep -E 'msg=starting|level=WARN' | head -3
Sep 29 15:45:23 you-pc prusa-connect[7487]: time=2026-09-29T15:45:23.097+02:00 level=INFO msg=starting version=0.1.0 config=/etc/prusa-connect/config.yaml overlay=config/config.d/resources.json
Sep 29 15:45:23 you-pc prusa-connect[7487]: time=2026-09-29T15:45:23.142+02:00 level=WARN msg="this server has recorded nothing about identity; it serves the first run and nothing else, and asks for this setup code" setup="POST /api/v1/setup" setup_code=X4ZF-VBX9-GMPH
```

Its files are under `/var/lib/prusa-connect`, in the same layout as
[Where your data lives](#where-your-data-lives):

```text
$ sudo ls -l /var/lib/prusa-connect /var/lib/prusa-connect/config/config.d
/var/lib/prusa-connect:
total 8
drwx------ 3 prusa-connect prusa-connect 4096 Sep 29 21:13 config
drwx------ 2 prusa-connect prusa-connect 4096 Sep 29 21:13 storage

/var/lib/prusa-connect/config/config.d:
total 916
-rw------- 1 prusa-connect prusa-connect   4096 Sep 29 21:13 authz.db
-rw------- 1 prusa-connect prusa-connect  32768 Sep 29 21:13 authz.db-shm
-rw------- 1 prusa-connect prusa-connect 889952 Sep 29 21:13 authz.db-wal
-rw------- 1 prusa-connect prusa-connect    234 Sep 29 21:13 beta-portal-pairing.json
-rw------- 1 prusa-connect prusa-connect    772 Sep 29 21:13 resources.json
```

A command such as `registrations list` has to run as the service user, in the
service's folder, with the same configuration file:

```text
$ sudo -u prusa-connect sh -c 'cd /var/lib/prusa-connect && prusa-connect registrations list -config /etc/prusa-connect/config.yaml'
no device is registered or waiting.
```

After you edit `/etc/prusa-connect/config.yaml`, run
`sudo systemctl restart prusa-connect`. The server reads the file only
when it starts.


### Open the ports in firewalld

firewalld is the firewall on RHEL, Fedora and the systems built from them. It
drops the printers' connections until you open the server's port. The folder
`deploy/firewalld` in the repository has two service files for it. A service
file gives a set of ports one name, so one command opens them all.

| file | opens | add it |
|---|---|---|
| `prusa-connect.xml` | 8080/tcp, for the web app, the API and the printers | always |
| `prusa-connect-buddy-debug-logs.xml` | 13514/udp for log lines and 8514/udp for metrics | when you install [Prusa printer logs](./reference/extensions/buddy-debug-logs.md) |

From the top folder of the repository, copy the files and reload firewalld.
Then add the service to the zone your printers are in. A zone is the set of
rules firewalld applies to one network:

```text
$ sudo cp deploy/firewalld/*.xml /etc/firewalld/services/
$ sudo firewall-cmd --reload
$ sudo firewall-cmd --permanent --add-service=prusa-connect
$ sudo firewall-cmd --reload
```

Add `--zone=<zone>` to the third line when the printers are not in the default
zone. `sudo firewall-cmd --get-active-zones` lists the zones.

firewalld has its own services for two more parts of the server. Add them the
same way:

| part | firewalld service | add it |
|---|---|---|
| discovery over mDNS, on by default | `mdns` | so PrusaSlicer finds the server and the server lists the printers nearby |
| the time server, off by default | `ntp` | when you switch the time server on |

If the server listens on a port other than 8080, write that port in
`prusa-connect.xml` before you copy it.

## Read these next

| page | covers |
|---|---|
| [Upgrade, back up and uninstall](./upgrade-back-up-and-uninstall.md) | a new release, a copy of your data, and removing the server |
| [Container deployment](./container.md) | building the image from a release and running it with Docker Compose |
| [Run it on a NAS](./nas.md) | Synology, unRAID and TrueNAS |
| [Configuration](./config.md) | every key in `config.yaml` |
| [Printer Configuration](./printer-configuration.md) | the INI file and the printer menus in detail |
