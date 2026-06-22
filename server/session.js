// agy-mux — session manager (node-pty)

import { join, dirname } from 'path';
import { mkdirSync, appendFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import pty from 'node-pty';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'sessions');

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
   * @param {string} clientType - 'terminal'
   * @returns {Session}
   */
  create(name, clientType) {
    const id = crypto.randomUUID();
    const logFile = join(DATA_DIR, `${id}.log`);

    // Ensure common bin dirs are in PATH
    const home = process.env.HOME || '/root';
    const extraPaths = [`${home}/.local/bin`, `${home}/.bun/bin`, '/usr/local/bin'];
    const fullPath = [...extraPaths, process.env.PATH || ''].join(':');

    // Resolve agy binary path (node-pty needs it)
    let agyBin = 'agy';
    for (const dir of fullPath.split(':')) {
      try {
        const candidate = join(dir, 'agy');
        if (statSync(candidate).isFile()) { agyBin = candidate; break; }
      } catch {}
    }

    let proc;
    try {
      proc = pty.spawn(agyBin, [], {
        name: clientType === 'terminal' ? (process.env.TERM || 'xterm-256color') : 'dumb',
        cols: 200,
        rows: 50,
        cwd: process.env.HOME || '/tmp',
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

    // node-pty emits 'data' events with output
    proc.onData((data) => {
      session.lastActivity = Date.now();
      const entry = { type: 'output', data, ts: Date.now() };
      session.history.push(entry);
      this._appendLog(session, entry);
      this.broadcast(session.id, { type: 'output', source: 'output', data });

      // Capture agy conversation ID for resume
      const match = data.match(/--conversation=([0-9a-f-]{36})/i);
      if (match) session.conversationId = match[1];
    });

    // Handle process exit
    proc.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.lastActivity = Date.now();
      const entry = { type: 'system', data: `Process exited with code ${exitCode}`, ts: Date.now() };
      session.history.push(entry);
      this._appendLog(session, entry);
      this.broadcast(id, { type: 'status', id, status: 'exited', code: exitCode });
    });

    return session;
  }

  _appendLog(session, entry) {
    try {
      const line = `[${new Date(entry.ts).toISOString()}] [${entry.type}] ${entry.data}`;
      appendFileSync(session.logFile, line);
    } catch {
      // Ignore log write errors
    }
  }

  get(id) {
    return this.sessions.get(id);
  }

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
   * Restart an exited session, optionally continuing the agy conversation
   */
  restart(id, clientType) {
    const old = this.sessions.get(id);
    if (!old) return null;

    // Build agy args
    const args = [];
    if (old.conversationId) {
      args.push(`--conversation=${old.conversationId}`, '-c');
    }

    // Create new session reusing the name
    const newId = crypto.randomUUID();
    const logFile = join(DATA_DIR, `${newId}.log`);

    const home = process.env.HOME || '/root';
    const extraPaths = [`${home}/.local/bin`, `${home}/.bun/bin`, '/usr/local/bin'];
    const fullPath = [...extraPaths, process.env.PATH || ''].join(':');

    let agyBin = 'agy';
    for (const dir of fullPath.split(':')) {
      try {
        const candidate = join(dir, 'agy');
        if (statSync(candidate).isFile()) { agyBin = candidate; break; }
      } catch {}
    }

    let proc;
    try {
      proc = pty.spawn(agyBin, args, {
        name: clientType === 'terminal' ? (process.env.TERM || 'xterm-256color') : 'dumb',
        cols: 200,
        rows: 50,
        cwd: process.env.HOME || '/tmp',
        env: {
          ...process.env,
          PATH: fullPath,
          TERM: clientType === 'terminal' ? (process.env.TERM || 'xterm-256color') : 'dumb',
        },
      });
    } catch (err) {
      return null;
    }

    const session = {
      id: newId,
      name: old.name,
      process: proc,
      history: [],
      clients: new Set(),
      status: 'running',
      startedAt: Date.now(),
      lastActivity: Date.now(),
      logFile,
      conversationId: old.conversationId,
      previousSessionId: id,
    };

    this.sessions.set(newId, session);

    proc.onData((data) => {
      session.lastActivity = Date.now();
      const entry = { type: 'output', data, ts: Date.now() };
      session.history.push(entry);
      this._appendLog(session, entry);
      this.broadcast(session.id, { type: 'output', source: 'output', data });
      const match = data.match(/--conversation=([0-9a-f-]{36})/i);
      if (match) session.conversationId = match[1];
    });

    proc.onExit(({ exitCode }) => {
      session.status = 'exited';
      session.lastActivity = Date.now();
      const entry = { type: 'system', data: `Process exited with code ${exitCode}`, ts: Date.now() };
      session.history.push(entry);
      this._appendLog(session, entry);
      this.broadcast(newId, { type: 'status', id: newId, status: 'exited', code: exitCode });
    });

    return session;
  }

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

  sendInput(id, data) {
    const session = this.sessions.get(id);
    if (!session || !session.process || session.status !== 'running') return;
    const entry = { type: 'input', data, ts: Date.now() };
    session.history.push(entry);
    session.lastActivity = Date.now();
    this._appendLog(session, entry);
    try {
      session.process.write(data);
    } catch {
      // stdin closed
    }
  }

  addClient(id, ws) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.clients.add(ws);
    ws._sessionId = id;
  }

  removeClient(ws) {
    for (const session of this.sessions.values()) {
      session.clients.delete(ws);
    }
  }

  broadcast(id, msg) {
    const session = this.sessions.get(id);
    if (!session) return;
    const raw = JSON.stringify(msg);
    for (const client of session.clients) {
      try { client.send(raw); } catch {}
    }
  }
}
