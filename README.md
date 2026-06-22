# agy-mux

Cloud session layer for Antigravity CLI. Sessions survive laptop closures, continue from any device.

```bash
npm install -g agy-mux
```

## Quick start

```bash
# Deploy to GCE (one command)
agy-mux deploy

# That's it. Start a session:
agy-mux start my-feature

# Close laptop. agy keeps running.
# Open another machine:
agy-mux resume <session-id>
```

`start` spawns agy on the server. `resume` reconnects to a running session. `Ctrl+\` detaches without killing. That's the whole idea.

## CLI

```bash
agy-mux deploy              # Provision GCE VM, install everything, auto-configure
agy-mux deploy status       # Check server health
agy-mux deploy teardown     # Delete the VM

agy-mux start [name]        # Create a new session and connect
agy-mux resume <id>         # Reconnect to a running session
agy-mux list                # Show active sessions
agy-mux stop <id>           # Kill a session
agy-mux logs <id>           # Show session output log
agy-mux config              # Set server URL and token manually
```

- `Ctrl+\` detaches — session keeps running
- `Ctrl+C` forwards to agy — normal interrupt behavior

## How it works

```
  terminal ──WebSocket──→ agy-mux server ──stdin/stdout──→ agy subprocess
     ↑                          │
     └───── resume from ────────┘
             any device
```

Server spawns agy as a subprocess, streams I/O over WebSocket to any connected client. History is kept in memory and on disk — reconnecting replays everything.

## License

MIT © [Hemanth.HM](https://h3manth.com)
