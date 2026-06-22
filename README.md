# agy-mux

Cloud session layer for Antigravity CLI. Sessions survive laptop closures, continue from any device.

```bash
npm install -g agy-mux
```

## Quick start

```bash
# On your server
AUTH_TOKEN=secret bun run server/index.js

# On any device
agy-mux config
# → Server: http://your-server:3000
# → Token: secret

agy-mux start my-feature
# agy starts in the cloud, terminal pipes through

# Close laptop. Open phone. Or another machine.
agy-mux resume <session-id>
# Pick up exactly where you left off
```

`start` spawns agy on the server. `resume` reconnects to a running session. `Ctrl+\` detaches without killing. That's the whole idea.

## Deploy

```bash
./deploy.sh your-gcp-project
```

Creates a GCE VM, installs Bun + agy, generates a token, starts the server.

## CLI

```bash
agy-mux start [name]     # Create a new session and connect
agy-mux resume <id>      # Reconnect to a running session
agy-mux list             # Show active sessions
agy-mux stop <id>        # Kill a session
agy-mux logs <id>        # Show session output log
agy-mux config           # Set server URL and token
```

- `Ctrl+\` detaches — session keeps running
- `Ctrl+C` forwards to agy — normal interrupt behavior

## How it works

```
  laptop/phone ──WebSocket──→ agy-mux server ──stdin/stdout──→ agy subprocess
       ↑                            │
       └────── resume from ─────────┘
               any device
```

Server spawns agy as a subprocess, streams I/O over WebSocket to any connected client. History is kept in memory and on disk — reconnecting replays everything.

## License

MIT © [Hemanth.HM](https://h3manth.com)
