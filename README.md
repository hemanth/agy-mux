# agyd

Cloud session layer for Antigravity CLI. Sessions survive laptop closures, continue from any device.

```bash
npm install -g agyd
```

## Quick start

```bash
# On your server
AUTH_TOKEN=secret bun run server/index.js

# On any device
agyd config
# → Server: http://your-server:3000
# → Token: secret

agyd start my-feature
# agy starts in the cloud, terminal pipes through

# Close laptop. Open phone. Or another machine.
agyd resume <session-id>
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
agyd start [name]     # Create a new session and connect
agyd resume <id>      # Reconnect to a running session
agyd list             # Show active sessions
agyd stop <id>        # Kill a session
agyd logs <id>        # Show session output log
agyd config           # Set server URL and token
```

- `Ctrl+\` detaches — session keeps running
- `Ctrl+C` forwards to agy — normal interrupt behavior

## How it works

```
  laptop/phone ──WebSocket──→ agyd server ──stdin/stdout──→ agy subprocess
       ↑                            │
       └────── resume from ─────────┘
               any device
```

Server spawns agy as a subprocess, streams I/O over WebSocket to any connected client. History is kept in memory and on disk — reconnecting replays everything.

## License

MIT © [Hemanth.HM](https://h3manth.com)
