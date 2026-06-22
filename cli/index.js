#!/usr/bin/env node

// agyd — CLI entry point

import { loadConfig, saveConfig, hasConfig, configPath } from './config.js';
import { connectTerminal } from './client.js';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const command = args[0];
const arg1 = args[1];

async function main() {
  switch (command) {
    case 'start':
      await cmdStart(arg1);
      break;
    case 'resume':
      await cmdResume(arg1);
      break;
    case 'list':
      await cmdList();
      break;
    case 'stop':
      await cmdStop(arg1);
      break;
    case 'logs':
      await cmdLogs(arg1);
      break;
    case 'config':
      await cmdConfig();
      break;
    default:
      printUsage();
      break;
  }
}

function printUsage() {
  console.log(`
  agyd — cloud session layer for Antigravity CLI

  Usage:
    agyd start [name]     Create a new session and connect
    agyd resume <id>      Reconnect to a running session
    agyd list             Show active sessions
    agyd stop <id>        Kill a session
    agyd logs <id>        Show session output log
    agyd config           Set server URL and token

  Config: ${configPath()}
`);
}

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    console.error('  No config found. Run: agyd config');
    process.exit(1);
  }
  return config;
}

async function cmdStart(name) {
  const config = requireConfig();
  await connectTerminal(config.server, config.token, 'start', null, name);
}

async function cmdResume(id) {
  if (!id) {
    console.error('  Usage: agyd resume <session-id>');
    console.error('  Run "agyd list" to see active sessions.');
    process.exit(1);
  }
  const config = requireConfig();
  await connectTerminal(config.server, config.token, 'resume', id);
}

async function cmdList() {
  const config = requireConfig();
  try {
    const res = await fetch(`${config.server}/api/sessions?token=${encodeURIComponent(config.token)}`);
    if (!res.ok) {
      console.error(`  Error: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    const sessions = await res.json();
    if (sessions.length === 0) {
      console.log('\n  No active sessions.\n');
      return;
    }
    console.log('');
    const header = ['ID', 'NAME', 'STATUS', 'CLIENTS', 'STARTED'];
    console.log(`  ${pad(header[0], 36)}  ${pad(header[1], 20)}  ${pad(header[2], 8)}  ${pad(header[3], 8)}  ${header[4]}`);
    console.log(`  ${'-'.repeat(36)}  ${'-'.repeat(20)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(20)}`);
    for (const s of sessions) {
      const started = new Date(s.startedAt).toLocaleString();
      console.log(`  ${pad(s.id, 36)}  ${pad(s.name, 20)}  ${pad(s.status, 8)}  ${pad(String(s.clientCount), 8)}  ${started}`);
    }
    console.log('');
  } catch (err) {
    console.error(`  Connection error: ${err.message}`);
    process.exit(1);
  }
}

function pad(str, len) {
  if (str.length >= len) return str.slice(0, len);
  return str + ' '.repeat(len - str.length);
}

async function cmdStop(id) {
  if (!id) {
    console.error('  Usage: agyd stop <session-id>');
    process.exit(1);
  }
  const config = requireConfig();
  const wsUrl = config.server.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(config.token)}&client=terminal`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'stop', id }));
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status' && msg.status === 'stopped') {
        console.log(`  Session ${id} stopped.`);
        ws.close();
        process.exit(0);
      }
    } catch {}
  });

  ws.addEventListener('error', (err) => {
    console.error(`  Connection error: ${err.message || 'Failed to connect'}`);
    process.exit(1);
  });

  // Timeout
  setTimeout(() => {
    console.error('  Timed out waiting for response.');
    ws.close();
    process.exit(1);
  }, 5000);
}

async function cmdLogs(id) {
  if (!id) {
    console.error('  Usage: agyd logs <session-id>');
    process.exit(1);
  }
  const config = requireConfig();
  // Connect via WebSocket, resume to get history, then disconnect
  const wsUrl = config.server.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(config.token)}&client=terminal`;
  const ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'resume', id }));
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'history') {
        if (msg.entries && msg.entries.length > 0) {
          for (const entry of msg.entries) {
            const ts = new Date(entry.ts).toISOString();
            const prefix = `[${ts}] [${entry.type}] `;
            process.stdout.write(prefix + entry.data);
            if (!entry.data.endsWith('\n')) process.stdout.write('\n');
          }
        } else {
          console.log('  No history for this session.');
        }
      } else if (msg.type === 'status') {
        // Got status after history, we can disconnect
        ws.close();
        process.exit(0);
      } else if (msg.type === 'error') {
        console.error(`  Error: ${msg.message}`);
        ws.close();
        process.exit(1);
      }
    } catch {}
  });

  ws.addEventListener('error', (err) => {
    console.error(`  Connection error: ${err.message || 'Failed to connect'}`);
    process.exit(1);
  });

  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 5000);
}

async function cmdConfig() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  const existing = loadConfig();

  console.log('\n  agyd configuration\n');

  const server = (await ask(`  Server URL [${existing?.server || 'http://localhost:3000'}]: `)).trim()
    || existing?.server || 'http://localhost:3000';

  const token = (await ask(`  Auth token [${existing?.token ? '****' : ''}]: `)).trim()
    || existing?.token || '';

  rl.close();

  saveConfig({ server: server.replace(/\/+$/, ''), token });
  console.log(`\n  Saved to ${configPath()}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
