---
title: The failure paths
description: What happens when a printer disconnects, sends something unreadable, or refuses a command; when config is invalid, a grant is missing, storage is full or an extension misbehaves.
sidebar:
  order: 8
audience: build
rewrite:
  describes: current
  implementedBy:
    - sdk/fault
    - internal/transport/http/httpfault
    - internal/extension/supervisor
    - internal/connector/xbuddy
---

Failure is most of the design here, so this is the page that explains the most
code per paragraph. Read the first section for the shape every failure takes,
then whichever case is in front of you.

## Every failure a client sees is a registered fault

Every failure a client can see is a [fault](../glossary.md#fault): a registered
`domain/REASON` code, and the same object however it is rendered. Branch on the
code. Fall back to `title` for a code the client does not know, and quote
`trace_id` when reporting one.

```
   a handler returns an error
     |
     v
   fault.Fault                          sdk/fault/fault.go:48
     |   a registered code, the params it interpolates, an English message,
     |   a retry hint, a trace id, and the cause it wraps
     v
   fault.Payload                        sdk/fault/payload.go:12
     |   the canonical object, and the same one on every surface
     |
     +--> ProblemJSON  -> RFC 9457 application/problem+json over HTTP
     +--> EventError   -> an envelope's data.error, with the trace id cleared
     |                    because the envelope carries it as an attribute
     +--> the error member of a printer command result
```

Over HTTP it is written by `writeProblem`
(`internal/transport/http/httpapi/problem.go:290`). The body is:

```json
{
  "type": "https://beta.prusa3d.com/connect-local/docs/error-codes/#core-printer-not-found",
  "title": "No printer answers to that id",
  "status": 404,
  "code": "core.printer/NOT_FOUND",
  "detail": "no connected printer answers to that id",
  "params": {"device_id": "p4f2a91c0e33b"},
  "retryable": false,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "instance": "/api/v1/devices/p4f2a91c0e33b"
}
```

`type` is a mechanical function of the code (`sdk/fault/code.go:28`), so the
two cannot disagree. It is the [error reference](../error-codes.md) and the
code's own section of it. A page offers it as a help link, and the person lands
on what the code means and what to do about it. `code`, `params`, `retryable` and `trace_id` are
[RFC 9457](../glossary.md#rfc-9457) extension members, which a consumer that
does not know them is required to ignore.

The trace id comes from the request's `Traceparent` header when it is
well-formed, and is minted otherwise
(`internal/transport/http/httpapi/problem.go:372`).

### Redaction

A code registered as `RedactDetail` renders `code`, `title`, `status` and
`trace_id` and nothing else (`sdk/fault/payload.go:57`). Its occurrence message
and its params stay in the server log line that the trace id keys. Nothing
about an undocumented failure has been reviewed for a client to see, so
`core.internal/UNREGISTERED_CODE` is the fault of last resort and redacts
(`sdk/fault/fault.go:32`).

### Where the codes are defined

The [error code reference](../error-codes.md) is generated from the registry
and never hand-edited. These files hold the registrations.

| file | codes about |
|---|---|
| `sdk/fault/core_auth.go` | the token and the setup ceremony |
| `sdk/fault/core_printer.go` | a printer that is absent, read-only or refusing |
| `sdk/fault/core_storage.go` | a path, an extension, no space, a partial delete |
| `sdk/fault/fault.go` | the unregistered code itself |
| `sdk/connectorapi/faults.go` | a capability or an argument a printer will not take |
| `internal/authz/errors.go` | a subject, a relation or an action the graph refuses |
| `internal/extension/supervisor/faults.go` | something the host did to a supervised call |
| `internal/app/resourcehost/faults.go` | a declared instance the plane could not start or reach |
| `internal/transport/http/httpfault/httpfault.go` | failures before or instead of a handler |

`internal/transport/http/httpfault` is a package of its own so
`cmd/generate-error-codes` can link the registrations without linking a router,
a web framework or an event hub.

A new code is `fault.Register(domain, "REASON", status, fault.Document(...))`.
The domain must not be `core` unless it is this project's own
(`sdk/fault/code.go:51`), which keeps an extension's codes from colliding with
this project's and makes the owner of a failure readable in a log line. That is
hygiene rather than isolation: a compiled-in extension can call everything
`sdk/fault` exports.

## Send us diagnostics

An org admin can download one file that holds what support needs to find a bug,
or send it to Prusa from the same page. The server never sends it on its own.

1. Open Settings, then Diagnostics, and tick that you agree to share the file.
2. To keep the file, press Download. Open the zip if you want to see what it
   holds. It is a plain archive. Attach it to the ticket, and paste the trace
   id shown with the error.
3. To send it, choose Report a new problem or Add to a report I already sent,
   and press Send to Prusa. Your browser uploads the file to the Prusa beta
   portal and opens the portal in a new tab. Sign in there, and attach the file
   to a new report or to one of yours.

Send to Prusa uploads to `core.diagnostics.send_url`, which is
`https://beta.prusa3d.com` unless you change it. Write it empty to hide the
button. The upload goes from your browser, so the browser has to reach the
portal. The server itself needs no internet access for it.

The file holds recent server logs, the last crash, and the state of your
modules and printers. It also holds the errors your browser saw and the kinds
of page you opened before them. A kind of page is "a printer's page", never the
address itself. The server scrubs the secrets, passwords, addresses, email
addresses and file paths it recognises. A log line can still hold something
sensitive it did not recognise, so open the file before you share it. Printer names, serial numbers and the names you gave your
connectors are replaced by codes, so the same printer has the same code
throughout the file. What modules wrote to their error output is not in the
file unless you tick the box for it.

The server keeps no copy of the file. If a page broke, its error screen has the
same Download button.

The full and printer builds carry this download. The minimal build leaves it
out, and so does `core.diagnostics.enabled: false`. A server with no sign-in
leaves it out unless `core.diagnostics.enabled: true` is written, because
there everyone on the network is an admin. Then Settings shows no Diagnostics
entry.

## A printer disconnects

The important thing first: a session is not a connection. A printer that goes
away keeps its session, so a command still queues for it and it is still in the
fleet.

```
   the socket closes cleanly
     |   the read fails at once
     v
   Session.read returns, detach
                                 internal/connector/xbuddy/inbound.go:72
     |
     v
   the session stays. Connected() is now false, PresenceChanged() wakes
     |
     v
   devices.pump sees the wake                  internal/app/devices.go:436
     |
     v
   reachability.announce                       internal/app/devicepresence.go:73
         publishes device.presence.changed carrying the state, not the edge
```

A silent link is harder, and the keepalive is the whole of how fast it is
noticed. A printer that lost power or fell out of a NAT table leaves a socket
that reads as live for as long as the operating system keeps retrying. Silence
is the only symptom.

| setting | default | is |
|---|---|---|
| `read_deadline` | 60 s | how long the connection may say nothing before it is closed |
| `ping_interval` | 54 s | how often the host asks |
| `ping_timeout` | 10 s | how long the ping write itself may take |

Defaults are at `internal/connector/xbuddy/inbound.go:29`, transcribed from the
shipping connector rather than chosen. Detection lands between `read_deadline -
ping_interval` and `read_deadline` after the printer goes quiet, because the
deadline is armed by the last frame before it. On the defaults that is 6 s to
60 s.

`ping_interval` must stay below `read_deadline`. Every frame the printer sends
re-arms the deadline. A printer with nothing to report sends only its pong, so
an interval at or above the deadline drops every idle printer on a timer.
`config/config.yaml` carries the measured cost of shortening both: at 400
printers, a 2 s interval is 200 exchanges a second, 5.8 MB an hour of payload
and 2.6 % of a core.

### What a reader is told

Three separate facts, and telling them apart is the point.

| event | means | a reader should |
|---|---|---|
| `device.presence.changed` | unreachable now, session still open | mark it as away, keep it on the screen |
| `device.departed` | the session ended | keep the record, mark it gone |
| `device.arrived` | a new session | add it |

A bouncing link is folded into at most one durable frame per second per printer
(`presenceQuiet`, `internal/app/devices.go:35`). The first change after a quiet
stretch still leaves immediately, so what the bound costs is never the cable
coming out. The frame carries the state and not the edge, so one frame is the
whole answer and a reader that missed the one before it is correct again on the
next.

### What happens to a command in flight

| when it failed | what happens |
|---|---|
| the write never reached the printer | the frame is forgotten and the next connection gets it (`internal/connector/xbuddy/session.go:510`) |
| it reached the printer and the link went before an answer | `ErrPrinterWentAway`, and it is **not** resent. The printer may have carried it out, and a second START_PRINT is a second print |
| the session closed | `ErrSessionClosed` |
| the queue is already full | `ErrQueueFull`. The host fails it rather than deepening a queue nobody is draining |

The sentinels are at `internal/connector/xbuddy/session.go:24`.

### When a printer comes back

`handleWebsocket` looks for a session it is already holding for that
fingerprint (`internal/connector/xbuddy/xbuddy.go:444`).

- **same identity**: the new connection goes under the session that is already
  there, which drains what queued while it was away
- **different identity**: the old session is closed and whatever queued goes
  with it. A command composed against one firmware's capability set is not a
  command to carry out on another's

Either way the [capability](../glossary.md#capability) set is resolved again,
because a disconnection the host did not watch can carry a firmware update or a
corrected profile. The [epoch](../glossary.md#epoch) moves on every arrival, so
a client can tell a set it cached from the one in force.

## A printer sends something unreadable

The frame goes and the connection stays. `Session.refuse`
(`internal/connector/xbuddy/inbound.go:446`) counts it and logs it at warn.

A printer runs firmware this build does not control, so an unreadable frame is
a key or a shape nobody here has seen rather than an attack. Hanging up on it
costs the printer every command in flight and every command queued behind it.
Dropping it costs the frame.

Three things are refused this way: a websocket frame that is not text, a text
frame that is not a JSON object, and a telemetry key the dialect's path table
does not carry.

Only the first refusal on a connection is logged and the rest are counted, with
the total written once as the connection ends
(`summariseRefusals`, `internal/connector/xbuddy/inbound.go:467`). A firmware
speaking something else refuses every frame, and one record each is an
operator's disk spent saying the same sentence.

`Refused()` (`internal/connector/xbuddy/session.go:1082`) is the counter, and it
is what separates a deliberate drop from a silent one. A printer that is
connected, is counting up there and is reporting no telemetry is one whose
frames are all being refused, and no other observation separates that from a
printer with nothing to say.

`Dropped()` (`internal/connector/xbuddy/session.go:1062`) is the other counter:
state patches discarded because the host was not reading them. A dialog is never
among them, because each dialog path holds a slot the backlog cannot evict, so
this number counts the paths a later frame repeats and nothing else. Both are
counters rather than a log line per event, because the condition they report
repeats four times a second.

## A command is refused

Four different places can refuse, and which one did is readable from the code.

```
   [1] the caller may not              core.auth/ACCESS_DENIED, or
       act on this printer             core.printer/NOT_FOUND when the
                                       refusal must not confirm existence
   [2] the verb is not in the          core.printer/CAPABILITY_NOT_SUPPORTED
       resolved capability set
   [3] an argument is wrong            core.validation/ARGUMENT_UNKNOWN
                                       core.validation/ARGUMENT_MISSING
                                       core.validation/ARGUMENT_NOT_SUPPORTED
                                       core.validation/ARGUMENT_MALFORMED
                                       core.validation/ARGUMENT_OUT_OF_RANGE
                                       core.validation/GCODE_MALFORMED
                                       core.printer/PATH_NOT_ALLOWED
                                       core.printer/GCODE_NOT_ALLOWED
   [4] the printer itself said no      core.printer/COMMAND_REJECTED, or
                                       the driver's own error, wrapped
```

An argument that is simply wrong is `core.validation`, because the request was
malformed. A path or a gcode line the printer may not be given is
`core.printer`, because the request was well formed and the machine is what
refuses it.

Codes 2 and 3 are `sdk/connectorapi/faults.go` and are raised by
`capability.Session.Do` before the driver is reached. A refusal there names the
verb or the argument rather than reporting that the printer said no.

Code 4 is the printer's own answer: an event carrying the command's id whose
name is `REJECTED` or `FAILED` (`internal/connector/xbuddy/session.go:46`).
Every other event carrying a command id completes it.

### Why a refusal sometimes says the printer does not exist

`notFound` (`internal/app/devicerender.go:393`) is the one refusal the printer
surface has. A printer the caller holds nothing on is reported exactly as one
that is not connected, so a refusal never tells anybody that a printer exists.
A listing is the only thing that says which printers there are.

## Configuration is invalid

`Core.Validate` (`internal/app/config/config.go:796`) runs before anything is
constructed, so a rejected configuration binds no port, writes no file and
starts no goroutine. It reports the first key it will not start on, and the
message names the key and the value.

Some refusals exist to stop a silent misconfiguration rather than a broken one:

| refused | because |
|---|---|
| `core.connectors.<name>.config.listener.tls` set with the connector's `listener.addr` empty | silence there is how an operator discovers on the next outage that the TLS they configured has not been running |
| `core.auth.client_id` set with `core.auth.issuer` empty | no login can be started, so the keys describe a ceremony that will never run |
| a named port rather than a number | it resolves through `/etc/services`, which makes whether the process starts depend on a file nobody deploying it looked at |
| an RSA printer certificate | the firmware offers one cipher suite and that suite needs an ECDSA key |

A resources block that does not parse fails at the first `Reload`, and an
unknown key inside an instance is refused rather than ignored: a typo that
silently left an allowlist unset is a permission the operator thinks they set.

Two things are warned about rather than refused. A printer certificate carrying
an IP address with no matching DNS name is only wrong for the printers
configured by that address (`internal/connector/xbuddy/listener.go:338`). A
`core.principal` that holds no grant is a graph written for somebody else, and
saying so at startup is the difference between a server that looks broken and
one that says which key to put back (`internal/app/app.go:412`).

## A grant is missing

The graph fails closed everywhere, and the refusal is shaped to say as little
as it can.

| surface | what a caller with nothing gets |
|---|---|
| `GET /api/v1/devices` | a listing without that printer. The permission is resolved inside the query, never by filtering rows afterwards |
| `GET /api/v1/devices/{id}` | `core.printer/NOT_FOUND`, the same answer as a printer that is not connected |
| `POST .../commands` | the same `NOT_FOUND` |
| `GET /api/v1/events` with `?origins=` | `core.auth/ACCESS_DENIED`, naming none of the origins |
| `GET /api/v1/events` with no narrowing | a stream of what the caller may see, which for a caller who may see nothing is an empty one |
| a declared sink | it receives nothing. Declaring a sink grants it nothing |

`stream.ErrNotPermitted` (`internal/transport/stream/hub.go:92`) names no
resource, and reads the same for a resource that does not exist: either answer
would confirm what the refusal exists to withhold.

A grant withdrawn while a stream is open narrows it live, within a second, with
no reconnect. A grant written while a stream is open widens it onto the new
origin the same way.

Writing a [grant](../glossary.md#grant) has two bounds of its own
(`internal/authz/grant.go:175`): a
write may confer nothing the caller does not already hold, and neither a write
nor a withdrawal may take an action from a principal who inherits more than the
caller does. `org`, `group` and `device_group` carry no action, so their
grants are not administrable through the API at all.

If every grant on an object is withdrawn there is no way back to it over the
API. The first grant is written once, into an empty graph, and a restart never
writes it again. A restart with a different `core.principal` writes the first
grant again, once, for that principal.

## Storage is full

Out of space is reported on `Close`, and on FAT and on USB media that is the
only place it is reported. A caller that discards that error reports success
for bytes that were lost.

`core.storage/NO_SPACE` (`sdk/fault/core_storage.go:32`) carries the storage id
and the path, and says to treat the target path as unusable until it is
deleted. It is registered `RetryNever`.

The write itself lands under a temporary name in the destination's own
directory and is renamed into place once the bytes are flushed.
`internal/kernel/atomicfile` does the same for the machine-owned overlay:
write, fsync the file, rename, fsync the directory.

Three storage escapes are open, are named in the code that cannot close them,
and are never described as closed: a hardlink in the store, a bind mount in the
store, and a recycled inode at the store path. Each was reproduced against the
shipped provider on Linux before it was written down. A
single-tenant appliance is the deployment they are assessed against.

## An extension misbehaves

Every call into a supervised resource goes through the
[supervisor](../glossary.md#supervisor)'s `Call` or `CallVoid`
(`internal/extension/supervisor/call.go:53`), and everything cross-cutting
happens there and nowhere else: the state gate, the circuit breaker, the
bulkhead, the per-call deadline, panic recovery, the outcome classification and
the metrics.

```
   a call arrives
     |
     +-- the instance is not serving   -> core.internal/RESOURCE_NOT_READY
     +-- the breaker is open           -> core.internal/RESOURCE_BREAKER_OPEN
     +-- the queue is full             -> core.internal/RESOURCE_QUEUE_FULL
     |
     v
   the resource is called with a deadline
     |
     +-- it took too long              -> core.internal/RESOURCE_TIMEOUT
     +-- it panicked                   -> core.internal/RESOURCE_PANIC
     v
   the result, classified
```

The codes are `internal/extension/supervisor/faults.go`. They sit in
`core.internal` because `sdk/fault` exposes no resource domain, and every one
describes something the host did to a call rather than something the resource
is.

### A resource that will not start

```
   start fails
     |
     +-- ClassPermanent      -> failed, latched. Retrying cannot fix it
     |
     +-- ClassRecoverable    -> retry on a full-jitter backoff ladder,
     |                          1 s to 5 minutes
     |
     +-- retries exhausted   -> gave up, latched
                                core.internal/RESOURCE_START_LIMIT_HIT
```

`afterFailedStart` (`internal/extension/supervisor/lifecycle.go:253`) is the
branch, and `Classify` (`internal/extension/supervisor/classify.go:77`) is what
decides which. A latched instance waits for an operator's restart rather than
spinning.

An instance declared `required: false` that never starts does not make the
process unready. One declared `required: true` does, and `GET
/api/v1/readiness` names it (`internal/app/readiness.go:75`).

### The two things the host cannot do

Both are stated at `internal/extension/supervisor/instance.go:1`, and neither
is a bug to be fixed at this tier.

- a timeout is a deadline on a [context](../glossary.md#context), and a context
  only stops work that reads it. A resource whose method takes no context, or
  ignores the one it is given, blocks its caller. The host bounds only what it
  waits for at shutdown, and the blast radius through the bulkhead
- a `recover` only catches a panic on the
  [goroutine](../glossary.md#goroutine) that deferred it. A
  resource that panics on a goroutine it spawned itself takes the process down

Containment for code that cannot be trusted that far is tier 2 and tier 3 of
the [plugin architecture](../plugin-architecture.md). Both are built:
`internal/extension/wirehost` launches and speaks to a child process for
`runtime: service`, and `internal/extension/script` compiles and evaluates an
expression for `runtime: script`.

### A sink that stops receiving

A [sink](../glossary.md#sink)'s subscription can end with nothing to report it: the hub drops a
subscriber whose authorization it could not recompute, and the instance behind
it never moved, so no status change follows. `sinkFeed.run`
(`internal/app/sinks.go:168`) therefore repeats its reconcile on a one-second
timer while there is a sink to hold or one that could not be attached. A
deployment that declares no sink arms nothing.

The log line to look for is `a declared sink is receiving no events`
(`internal/app/sinks.go:259`). A module is installed under the sink kind with
`runtime: service`, and it reads events through the event API itself. The feed
leaves a module alone and writes no such line for it.

## A reader falls behind

The event stream drops rather than growing, and says which.

| queue | when it is full |
|---|---|
| telemetry | the oldest sample for that key is superseded. A slow reader gets the newest, because a superseded temperature has no value and the queue it would fill does |
| events | the reader is told to resync with a `stream.continuity.lost` frame |

`ContinuityLost` (`internal/transport/http/httpapi/events.go:41`) is the one
frame the HTTP transport authors itself. It says the reader's place in the log
is gone, either because its queue overflowed or because the
[cursor](../glossary.md#cursor) it resumed
from is no longer replayable, and that the reader should reload state from the
API and carry on from the cursor the frame's id names. There is no partial
recovery.

A reader that reconnects with a `Last-Event-ID` this server never issued is
refused rather than quietly started live (`resumeFrom`,
`internal/transport/http/httpapi/events.go:375`). A client that resumed from
nothing and was answered as if it had resumed misses exactly the events it
reconnected to collect.

One [principal](../glossary.md#principal) holding more streams than `core.events.max_streams_per_principal`
allows gets 429 with the limit in the payload. The slot is reserved before the
authorization query and before a channel is attached, so a caller already at
the bound cannot make the hub run a policy read and replay a window per refused
attempt (`internal/transport/stream/hub.go:379`).

## The process itself fails

| failure | what happens |
|---|---|
| a panic in an HTTP handler | recovered, logged with the trace id, answered as `core.internal/UNEXPECTED` (`internal/transport/http/httpapi/middleware.go:147`) |
| a port already in use | a startup failure `Run` returns, and any port already taken is given back |
| the authorization graph will not open | the process refuses to start. There is no key that turns the graph off |
| a migration whose content changed since it was applied | refused at startup. A migration is immutable once it has run, and a change to one goes in a new file |
| the configured issuer cannot be discovered | the process refuses to start rather than refusing every login afterwards |
| the supervision plane will not stop inside the budget | the instances behind it are abandoned and `ErrPlaneWedged` is reported. The alternative is a process an operator cannot stop |

`GET /api/v1/health` always answers `ok` and reads no dependency. A probe that
fails when a dependency is degraded takes the whole instance out of service for
something a client could have been told about instead
(`internal/transport/http/httpapi/routes.go:114`). `GET /api/v1/readiness` is
the one that names what is blocking.
