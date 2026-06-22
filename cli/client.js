// agy-mux — terminal WebSocket client

/**
 * Connect to agy-mux server and pipe terminal I/O
 * @param {string} serverUrl - Base server URL (e.g. http://localhost:3000)
 * @param {string} token - Auth token
 * @param {'start'|'resume'} action
 * @param {string} [sessionId] - Required for resume
 * @param {string} [sessionName] - Required for start
 */
export async function connectTerminal(serverUrl, token, action, sessionId, sessionName) {
  const wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(token)}&client=terminal`;
  const ws = new WebSocket(wsUrl);
  let currentId = sessionId || null;
  let cleanedUp = false;

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }

  function detach() {
    cleanup();
    console.log(`\n\n  Detached from session ${currentId}`);
    console.log(`  Resume with: agy-mux resume ${currentId}\n`);
    ws.close();
    process.exit(0);
  }

  ws.addEventListener('open', () => {
    // Put terminal in raw mode
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    if (action === 'start') {
      ws.send(JSON.stringify({ type: 'start', name: sessionName || `session-${Date.now()}` }));
    } else if (action === 'resume') {
      ws.send(JSON.stringify({ type: 'resume', id: sessionId }));
    }
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'connected':
          // Server acknowledged WebSocket connection
          break;

        case 'started':
          currentId = msg.id;
          process.stderr.write(`\x1b[2m  Session: ${msg.name} (${msg.id})\x1b[0m\n`);
          process.stderr.write(`\x1b[2m  Detach: Ctrl+\\  |  Kill: agy-mux stop ${msg.id}\x1b[0m\n\n`);
          break;

        case 'restarted':
          currentId = msg.id;
          process.stderr.write(`\x1b[2m  Restarted: ${msg.name} (${msg.id})\x1b[0m\n`);
          process.stderr.write(`\x1b[2m  Continuing conversation from ${msg.previousId}\x1b[0m\n`);
          process.stderr.write(`\x1b[2m  Detach: Ctrl+\\  |  Kill: agy-mux stop ${msg.id}\x1b[0m\n\n`);
          break;

        case 'output':
          process.stdout.write(msg.data);
          break;

        case 'history':
          // Replay history entries
          if (msg.entries && msg.entries.length > 0) {
            process.stderr.write(`\x1b[2m  Replaying ${msg.entries.length} history entries...\x1b[0m\n`);
            for (const entry of msg.entries) {
              if (entry.type === 'output' || entry.type === 'error') {
                process.stdout.write(entry.data);
              }
            }
          }
          break;

        case 'status':
          if (msg.status === 'exited') {
            process.stderr.write(`\n\x1b[2m  Session exited (code ${msg.code ?? '?'})\x1b[0m\n`);
            cleanup();
            ws.close();
            process.exit(msg.code ?? 1);
          } else if (msg.status === 'error') {
            process.stderr.write(`\n\x1b[31m  Session error\x1b[0m\n`);
            cleanup();
            ws.close();
            process.exit(1);
          } else if (msg.name) {
            currentId = msg.id;
            process.stderr.write(`\x1b[2m  Resumed: ${msg.name} (${msg.id})\x1b[0m\n`);
            process.stderr.write(`\x1b[2m  Detach: Ctrl+\\  |  Kill: agy-mux stop ${msg.id}\x1b[0m\n\n`);
          }
          break;

        case 'error':
          process.stderr.write(`\n\x1b[31m  Error: ${msg.message}\x1b[0m\n`);
          cleanup();
          ws.close();
          process.exit(1);
          break;
      }
    } catch {
      // Non-JSON — write raw
      process.stdout.write(event.data);
    }
  });

  // Forward stdin to server
  process.stdin.on('data', (chunk) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();

    // Ctrl+\ (0x1c) — detach without killing
    if (str.includes('\x1c')) {
      detach();
      return;
    }

    // Forward everything (including Ctrl+C = 0x03) to agy
    if (ws.readyState === WebSocket.OPEN && currentId) {
      ws.send(JSON.stringify({ type: 'input', id: currentId, data: str }));
    }
  });

  ws.addEventListener('close', () => {
    if (!cleanedUp) {
      cleanup();
      process.stderr.write(`\n\x1b[2m  Disconnected from server.`);
      if (currentId) {
        process.stderr.write(` Resume with: agy-mux resume ${currentId}`);
      }
      process.stderr.write(`\x1b[0m\n`);
      process.exit(1);
    }
  });

  ws.addEventListener('error', (err) => {
    cleanup();
    process.stderr.write(`\n\x1b[31m  Connection error: ${err.message || 'Failed to connect'}\x1b[0m\n`);
    process.exit(1);
  });

  // Handle SIGINT — DON'T exit, forward to agy via stdin
  process.on('SIGINT', () => {
    // In raw mode, Ctrl+C is already forwarded as stdin data (0x03).
    // This handler prevents Node from exiting on SIGINT.
  });

  // Handle SIGTERM — clean exit
  process.on('SIGTERM', () => {
    cleanup();
    ws.close();
    process.exit(0);
  });
}
