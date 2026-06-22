// agy-mux — server (Node.js)

import { createServer } from 'http';
import { parse } from 'url';
import { WebSocketServer } from 'ws';
import { verifyToken, isDevMode } from './auth.js';
import { SessionManager } from './session.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const mgr = new SessionManager();

const server = createServer((req, res) => {
  const url = parse(req.url, true);

  // API: list sessions
  if (url.pathname === '/api/sessions') {
    const token = url.query.token;
    if (!verifyToken(token)) { res.writeHead(401); res.end('Unauthorized'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mgr.list()));
    return;
  }

  // API: health
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: mgr.list().length, devMode: isDevMode() }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = parse(req.url, true);
  const token = url.query.token;
  const clientType = url.query.client || 'terminal';

  if (!verifyToken(token)) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  ws._clientType = clientType;
  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(ws, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('close', () => {
    mgr.removeClient(ws);
  });
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'start': {
      const name = msg.name || `session-${Date.now()}`;
      const session = mgr.create(name, ws._clientType);
      mgr.addClient(session.id, ws);
      ws.send(JSON.stringify({ type: 'started', id: session.id, name: session.name }));
      break;
    }
    case 'resume': {
      let session = mgr.get(msg.id);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: `Session ${msg.id} not found` }));
        return;
      }

      // If session exited, restart agy with --conversation to continue
      if (session.status === 'exited' || session.status === 'stopped') {
        const restarted = mgr.restart(msg.id, ws._clientType);
        if (restarted) {
          session = restarted;
          ws.send(JSON.stringify({ type: 'restarted', id: session.id, name: session.name, previousId: msg.id }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to restart session' }));
          return;
        }
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

server.listen(PORT, () => {
  console.log(`\n  agy-mux running on port ${PORT}${isDevMode() ? ' (dev mode)' : ' 🔒'}\n`);
});
