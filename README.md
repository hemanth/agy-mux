# agy-cloud

Cloud session layer for Antigravity CLI. Sessions survive laptop closures, continue from any device.

```bash
npm install -g agy-cloud
```

## Quick start

```bash
# On your server
AUTH_TOKEN=secret bun run server/index.js

# On any device
agy-cloud config
# → Server: http://your-server:3000
# → Token: secret

agy-cloud start my-feature
# agy starts in the cloud, terminal pipes through

# Close laptop. Open phone. Or another machine.
agy-cloud resume <session-id>
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
agy-cloud start [name]     # Create a new session and connect
agy-cloud resume <id>      # Reconnect to a running session
agy-cloud list             # Show active sessions
agy-cloud stop <id>        # Kill a session
agy-cloud logs <id>        # Show session output log
agy-cloud config           # Set server URL and token
```

- `Ctrl+\` detaches — session keeps running
- `Ctrl+C` forwards to agy — normal interrupt behavior

## How it works

```
  laptop/phone ──WebSocket──→ agy-cloud server ──stdin/stdout──→ agy subprocess
       ↑                            │
       └────── resume from ─────────┘
               any device
```

Server spawns agy as a subprocess, streams I/O over WebSocket to any connected client. History is kept in memory and on disk — reconnecting replays everything.

## License

MIT © [Hemanth.HM](https://h3manth.com)
