// agy-cloud — WebSocket client (multi-session)
(() => {
  const $ = (sel) => document.querySelector(sel);
  const authScreen = $('#auth-screen');
  const sessionsScreen = $('#sessions-screen');
  const chatScreen = $('#chat-screen');
  const tokenInput = $('#token-input');
  const tokenSubmit = $('#token-submit');
  const statusDot = $('#status-dot');
  const statusText = $('#status-text');
  const messages = $('#messages');
  const msgInput = $('#msg-input');
  const sendBtn = $('#send-btn');
  const sessionList = $('#session-list');
  const newSessionBtn = $('#new-session-btn');
  const backBtn = $('#back-btn');
  const sessionTitle = $('#session-title');

  let ws = null;
  let token = localStorage.getItem('agy-token') || '';
  let retryDelay = 1000;
  let retryTimer = null;
  let currentSessionId = null;

  // Message batching
  let msgBuffer = [];
  let flushTimer = null;
  const FLUSH_INTERVAL = 50;

  // --- Boot ---
  if (token) {
    showSessions();
    connect();
  } else {
    const hashToken = location.hash.slice(1);
    if (hashToken) {
      token = hashToken;
      localStorage.setItem('agy-token', token);
      location.hash = '';
      showSessions();
      connect();
    }
  }

  tokenSubmit.addEventListener('click', submitToken);
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitToken();
  });

  newSessionBtn.addEventListener('click', () => {
    const name = prompt('Session name:', `session-${Date.now()}`);
    if (name && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'start', name }));
    }
  });

  backBtn.addEventListener('click', () => {
    currentSessionId = null;
    messages.innerHTML = '';
    showSessions();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'list' }));
    }
  });

  function submitToken() {
    const val = tokenInput.value.trim();
    if (!val) return;
    token = val;
    localStorage.setItem('agy-token', token);
    showSessions();
    connect();
  }

  function showSessions() {
    authScreen.classList.add('hidden');
    sessionsScreen.classList.remove('hidden');
    chatScreen.classList.add('hidden');
  }

  function showChat(name) {
    authScreen.classList.add('hidden');
    sessionsScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    sessionTitle.textContent = name || 'agy-cloud';
  }

  // --- WebSocket ---
  function connect() {
    clearTimeout(retryTimer);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&client=web`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      retryDelay = 1000;
      setStatus('connected', true);
      // Request session list
      ws.send(JSON.stringify({ type: 'list' }));
    });

    ws.addEventListener('close', () => {
      setStatus('disconnected', false);
      setInputEnabled(false);
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {});

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch {
        queueMessage('agy', event.data);
      }
    });
  }

  function scheduleReconnect() {
    retryTimer = setTimeout(() => {
      setStatus('reconnecting…', false);
      connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'connected':
        break;

      case 'sessions':
        renderSessionList(msg.list);
        break;

      case 'started':
        currentSessionId = msg.id;
        showChat(msg.name);
        setInputEnabled(true);
        msgInput.focus();
        addSystemMessage(`Session started: ${msg.name} (${msg.id})`);
        break;

      case 'output':
        queueMessage('agy', msg.data);
        break;

      case 'history':
        if (msg.entries && msg.entries.length > 0) {
          addSystemMessage('— replaying history —');
          for (const entry of msg.entries) {
            if (entry.type === 'input') {
              addMessage('user', entry.data);
            } else if (entry.type === 'output' || entry.type === 'error') {
              addMessage('agy', entry.data);
            } else if (entry.type === 'system') {
              addSystemMessage(entry.data);
            }
          }
          addSystemMessage('— end of history —');
        }
        break;

      case 'status':
        if (msg.status === 'exited') {
          addSystemMessage(`Session exited (code ${msg.code ?? '?'})`);
        } else if (msg.status === 'stopped') {
          addSystemMessage('Session stopped.');
        } else if (msg.status === 'error') {
          addSystemMessage('Session error.');
        } else if (msg.name) {
          currentSessionId = msg.id;
          showChat(msg.name);
          setInputEnabled(true);
          msgInput.focus();
        }
        break;

      case 'error':
        addSystemMessage(`Error: ${msg.message}`);
        break;
    }
  }

  function renderSessionList(sessions) {
    sessionList.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<div class="no-sessions">No sessions yet. Create one to get started.</div>';
      return;
    }
    for (const s of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.addEventListener('click', () => {
        currentSessionId = s.id;
        messages.innerHTML = '';
        showChat(s.name);
        setInputEnabled(true);
        ws.send(JSON.stringify({ type: 'resume', id: s.id }));
      });

      const started = new Date(s.startedAt).toLocaleString();
      item.innerHTML = `
        <div class="session-info">
          <div class="session-name">${escapeHtml(s.name)}</div>
          <div class="session-meta">${s.id.slice(0, 8)}… · ${started} · ${s.clientCount} client${s.clientCount !== 1 ? 's' : ''}</div>
        </div>
        <span class="session-status ${s.status}">${s.status}</span>
      `;
      sessionList.appendChild(item);
    }
  }

  // --- Message batching ---
  function queueMessage(type, content) {
    msgBuffer.push({ type, content });
    if (!flushTimer) {
      flushTimer = setTimeout(flushMessages, FLUSH_INTERVAL);
    }
  }

  function flushMessages() {
    flushTimer = null;
    if (msgBuffer.length === 0) return;
    const merged = [];
    for (const m of msgBuffer) {
      const last = merged[merged.length - 1];
      if (last && last.type === 'agy' && m.type === 'agy') {
        last.content += m.content;
      } else {
        merged.push({ ...m });
      }
    }
    msgBuffer = [];
    for (const m of merged) {
      addMessage(m.type, m.content);
    }
  }

  // --- Rendering ---
  function addMessage(type, content) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (type === 'agy') {
      bubble.innerHTML = renderMarkdown(content);
    } else {
      bubble.textContent = content;
    }
    div.appendChild(bubble);
    messages.appendChild(div);
    scrollToBottom();
  }

  function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    div.appendChild(bubble);
    messages.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${code}</code></pre>`;
    });
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/(https?:\/\/[^\s<"']+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return html;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Input ---
  sendBtn.addEventListener('click', send);
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function send() {
    const text = msgInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || !currentSessionId) return;
    addMessage('user', text);
    ws.send(JSON.stringify({ type: 'input', id: currentSessionId, data: text + '\n' }));
    msgInput.value = '';
    msgInput.focus();
  }

  function setStatus(text, connected) {
    statusText.textContent = text;
    statusDot.classList.toggle('connected', connected);
    const dotS = $('#status-dot-sessions');
    const textS = $('#status-text-sessions');
    if (dotS) dotS.classList.toggle('connected', connected);
    if (textS) textS.textContent = text;
  }

  function setInputEnabled(enabled) {
    msgInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }
})();
