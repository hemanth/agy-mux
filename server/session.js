// agy-mux — session manager

import { join } from 'path';
import { mkdirSync, appendFileSync } from 'fs';

const DATA_DIR = join(import.meta.dir, '..', 'data', 'sessions');

// Ensure data dir exists on startup
try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}

export class SessionManager {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  /**
   * Create a new agy session
   * @param {string} name
   * @param {string} clientType - 'terminal' or 'web'
   * @returns {Session}
   */
  create(name, clientType) {
    const id = crypto.randomUUID();
    const logFile = join(DATA_DIR, `${id}.log`);

    // Ensure common bin dirs are in PATH (server may lack login shell PATH)
    const home = process.env.HOME || '/root';
    const extraPaths = [`${home}/.local/bin`, `${home}/.bun/bin`, '/usr/local/bin'];
    const fullPath = [...extraPaths, process.env.PATH || ''].join(':');

    let proc;
    try {
      // agy needs a PTY to produce output. Use expect to allocate one.
      // This works on both Linux and macOS with zero npm dependencies.
      const expectScript = `
log_user 0
set timeout -1
spawn agy
log_user 1
interact {
  eof exit
}
catch wait result
exit [lindex $result 3]
`;
      proc = Bun.spawn(['expect', '-c', expectScript], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          PATH: fullPath,
          TERM: clientType === 'terminal' ? (process.env.TERM || 'xterm-256color') : 'dumb',
        },
      });
    } catch (err) {
      // agy not found or spawn failed — create a dead session
      const session = {
        id,
        name,
        process: null,
        history: [],
        clients: new Set(),
        status: 'error',
        startedAt: Date.now(),
        lastActivity: Date.now(),
        logFile,
      };
      session.history.push({
        type: 'system',
        data: `Failed to start agy: ${err.message}`,
        ts: Date.now(),
      });
      this.sessions.set(id, session);
      // Broadcast error to any connected clients
      setTimeout(() => {
        this.broadcast(id, {
          type: 'output',
          source: 'system',
          data: `Failed to start agy: ${err.message}\n`,
        });
        this.broadcast(id, { type: 'status', id, status: 'error' });
      }, 0);
      return session;
    }

    const session = {
      id,
      name,
      process: proc,
      history: [],
      clients: new Set(),
      status: 'running',
      startedAt: Date.now(),
      lastActivity: Date.now(),
      logFile,
    };

    this.sessions.set(id, session);

    // Stream stdout
    this._streamReader(session, proc.stdout, 'output');
    // Stream stderr
    this._streamReader(session, proc.stderr, 'error');

    // Handle process exit
    proc.exited.then((code) => {
      session.status = 'exited';
      session.lastActivity = Date.now();
      const entry = { type: 'system', data: `Process exited with code ${code}`, ts: Date.now() };
      session.history.push(entry);
      this._appendLog(session, entry);
      this.broadcast(id, { type: 'status', id, status: 'exited', code });
    }).catch(() => {
      session.status = 'exited';
    });

    return session;
  }

  async _streamReader(session, stream, type) {
    try {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        session.lastActivity = Date.now();
        const entry = { type, data: text, ts: Date.now() };
        session.history.push(entry);
        this._appendLog(session, entry);
        this.broadcast(session.id, { type: 'output', source: type, data: text });
      }
    } catch {
      // Stream closed
    }
  }

  _appendLog(session, entry) {
    try {
      const line = `[${new Date(entry.ts).toISOString()}] [${entry.type}] ${entry.data}`;
      appendFileSync(session.logFile, line);
    } catch {
      // Ignore log write errors
    }
  }

  /**
   * Get session by ID
   * @param {string} id
   * @returns {Session|undefined}
   */
  get(id) {
    return this.sessions.get(id);
  }

  /**
   * List all sessions
   * @returns {Array<{id, name, status, startedAt, lastActivity, clientCount}>}
   */
  list() {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      startedAt: s.startedAt,
      lastActivity: s.lastActivity,
      clientCount: s.clients.size,
    }));
  }

  /**
   * Kill a session's subprocess
   * @param {string} id
   */
  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.process && session.status === 'running') {
      try { session.process.kill(); } catch {}
    }
    session.status = 'stopped';
    session.lastActivity = Date.now();
    const entry = { type: 'system', data: 'Session stopped by user', ts: Date.now() };
    session.history.push(entry);
    this._appendLog(session, entry);
    this.broadcast(id, { type: 'status', id, status: 'stopped' });
  }

  /**
   * Write data to a session's stdin
   * @param {string} id
   * @param {string} data
   */
  sendInput(id, data) {
    const session = this.sessions.get(id);
    if (!session || !session.process || session.status !== 'running') return;
    const entry = { type: 'input', data, ts: Date.now() };
    session.history.push(entry);
    session.lastActivity = Date.now();
    this._appendLog(session, entry);
    try {
      session.process.stdin.write(data);
    } catch {
      // stdin closed
    }
  }

  /**
   * Add a WebSocket client to a session
   * @param {string} id
   * @param {WebSocket} ws
   */
  addClient(id, ws) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.clients.add(ws);
    ws.data._sessionId = id;
  }

  /**
   * Remove a WebSocket client from all sessions
   * @param {WebSocket} ws
   */
  removeClient(ws) {
    for (const session of this.sessions.values()) {
      session.clients.delete(ws);
    }
  }

  /**
   * Broadcast a message to all clients of a session
   * @param {string} id
   * @param {object} msg
   */
  broadcast(id, msg) {
    const session = this.sessions.get(id);
    if (!session) return;
    const raw = JSON.stringify(msg);
    for (const client of session.clients) {
      try { client.send(raw); } catch {}
    }
  }
}
