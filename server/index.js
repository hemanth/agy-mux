// agy-mux — server

import { verifyToken, isDevMode } from './auth.js';
import { SessionManager } from './session.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const mgr = new SessionManager();

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // API: list sessions
    if (url.pathname === '/api/sessions') {
      const token = url.searchParams.get('token');
      if (!verifyToken(token)) return new Response('Unauthorized', { status: 401 });
      return Response.json(mgr.list());
    }

    // API: health
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', sessions: mgr.list().length, devMode: isDevMode() });
    }

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const token = url.searchParams.get('token');
      if (!verifyToken(token)) return new Response('Unauthorized', { status: 401 });
      const clientType = url.searchParams.get('client') || 'terminal';
      const upgraded = server.upgrade(req, { data: { token, clientType } });
      if (!upgraded) return new Response('WebSocket upgrade failed', { status: 500 });
      return undefined;
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      ws.data.mgr = mgr;
      ws.send(JSON.stringify({ type: 'connected' }));
    },
    message(ws, raw) {
      try {
        const msg = JSON.parse(raw);
        handleMessage(ws, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: e.message }));
      }
    },
    close(ws) {
      mgr.removeClient(ws);
    },
  },
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'start': {
      const name = msg.name || `session-${Date.now()}`;
      const session = mgr.create(name, ws.data.clientType);
      mgr.addClient(session.id, ws);
      ws.send(JSON.stringify({ type: 'started', id: session.id, name: session.name }));
      break;
    }
    case 'resume': {
      const session = mgr.get(msg.id);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: `Session ${msg.id} not found` }));
        return;
      }
      mgr.addClient(session.id, ws);
      ws.send(JSON.stringify({ type: 'history', id: session.id, entries: session.history }));
      ws.send(JSON.stringify({ type: 'status', id: session.id, status: session.status, name: session.name }));
      break;
    }
    case 'input': {
      mgr.sendInput(msg.id, msg.data);
      break;
    }
    case 'stop': {
      mgr.kill(msg.id);
      ws.send(JSON.stringify({ type: 'status', id: msg.id, status: 'stopped' }));
      break;
    }
    case 'list': {
      ws.send(JSON.stringify({ type: 'sessions', list: mgr.list() }));
      break;
    }
  }
}

console.log(`\n  agy-mux running on port ${PORT}${isDevMode() ? ' (dev mode)' : ' 🔒'}\n`);
