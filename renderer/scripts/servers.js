'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  function formStatus(text, isError) {
    const s = document.getElementById('serverFormStatus');
    if (!s) return;
    s.textContent = text;
    s.classList.toggle('is-error', !!isError);
  }

  const statusByIp = new Map();
  let lastServers = [];

  function paintRowStatus(server) {
    const li = document.querySelector(`#serverList [data-server-id="${CSS.escape(server.id)}"]`);
    if (!li) return;
    const st = statusByIp.get(server.ip);
    const iconSlot = li.querySelector('.server-icon-slot');
    if (iconSlot) {
      iconSlot.textContent = '';
      if (st && st.state === 'ok' && st.data && st.data.favicon) {
        const img = document.createElement('img');
        img.className = 'server-icon';
        img.alt = '';
        img.loading = 'lazy';
        img.src = st.data.favicon;
        iconSlot.appendChild(img);
      } else {
        const fb = el('span', 'server-icon server-icon-fallback', (server.name || '?').slice(0, 1).toUpperCase());
        fb.setAttribute('aria-hidden', 'true');
        iconSlot.appendChild(fb);
      }
    }
    const motdEl = li.querySelector('.server-motd');
    if (motdEl) {
      if (!st || st.state === 'loading') motdEl.textContent = 'Pinging…';
      else if (st.state === 'ok') motdEl.textContent = (st.data && st.data.motd) || 'No MOTD.';
      else motdEl.textContent = 'Offline — ping failed.';
    }
    const subEl = li.querySelector('.server-sub');
    if (subEl) {
      subEl.textContent = '';
      subEl.appendChild(el('span', '', server.ip));
      if (st && st.state === 'ok' && st.data) {
        if (st.data.playersOnline !== null && st.data.playersOnline !== undefined) {
          subEl.appendChild(el('span', '', ` · ${st.data.playersOnline}/${st.data.playersMax ?? '?'} online`));
        }
        if (st.data.latencyMs !== null && st.data.latencyMs !== undefined) {
          subEl.appendChild(el('span', '', ` · ${st.data.latencyMs} ms`));
        }
      }
    }
    const refreshBtn = li.querySelector('[data-refresh]');
    if (refreshBtn) refreshBtn.disabled = !!(st && st.state === 'loading');
  }

  async function pingRow(server) {
    statusByIp.set(server.ip, { state: 'loading' });
    paintRowStatus(server);
    try {
      const res = await bridge().pingServer(server.ip);
      statusByIp.set(server.ip, { state: 'ok', data: res });
    } catch (err) {
      statusByIp.set(server.ip, { state: 'off', error: err && err.message });
    }
    paintRowStatus(server);
  }

  function pingAll() {
    for (const s of lastServers) void pingRow(s);
  }

  function renderList(servers) {
    lastServers = servers || [];
    const list = document.getElementById('serverList');
    if (!list) return;
    list.textContent = '';
    if (!lastServers.length) {
      list.appendChild(el('li', 'installed-empty', 'No servers added yet.'));
      return;
    }
    lastServers.forEach((server, index) => {
      const li = el('li', 'server-item');
      li.dataset.serverId = server.id;
      li.appendChild(el('span', 'server-icon-slot'));
      const meta = el('div', 'server-meta');
      meta.appendChild(el('span', 'server-name', server.name));
      meta.appendChild(el('span', 'server-motd', ''));
      meta.appendChild(el('span', 'server-ip server-sub', ''));
      li.appendChild(meta);

      const actions = el('div', 'server-actions');

      const refreshBtn = el('button', 'icon-btn icon-btn-tiny');
      refreshBtn.type = 'button';
      refreshBtn.title = 'Ping now';
      refreshBtn.setAttribute('data-refresh', '1');
      const refreshIcon = document.createElement('i');
      refreshIcon.setAttribute('data-lucide', 'refresh-cw');
      refreshBtn.appendChild(refreshIcon);
      refreshBtn.addEventListener('click', () => pingRow(server));
      actions.appendChild(refreshBtn);

      const upBtn = el('button', 'icon-btn icon-btn-tiny');
      upBtn.type = 'button';
      upBtn.title = 'Move up';
      upBtn.disabled = index === 0;
      const upIcon = document.createElement('i');
      upIcon.setAttribute('data-lucide', 'chevron-up');
      upBtn.appendChild(upIcon);
      upBtn.addEventListener('click', () => move(server.id, 'up'));
      actions.appendChild(upBtn);

      const downBtn = el('button', 'icon-btn icon-btn-tiny');
      downBtn.type = 'button';
      downBtn.title = 'Move down';
      downBtn.disabled = index === lastServers.length - 1;
      const downIcon = document.createElement('i');
      downIcon.setAttribute('data-lucide', 'chevron-down');
      downBtn.appendChild(downIcon);
      downBtn.addEventListener('click', () => move(server.id, 'down'));
      actions.appendChild(downBtn);

      const editBtn = el('button', 'btn btn-ghost btn-sm', 'Edit');
      editBtn.type = 'button';
      editBtn.addEventListener('click', () => startEdit(server));
      actions.appendChild(editBtn);

      const removeBtn = el('button', 'btn btn-danger-ghost btn-sm', 'Remove');
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => remove(server.id));
      actions.appendChild(removeBtn);

      li.appendChild(actions);
      list.appendChild(li);
      paintRowStatus(server);
    });
    if (window.refreshIcons) window.refreshIcons();
  }

  let editingId = null;

  function tr(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback;
  }

  function paintAddButton() {
    const addBtn = document.getElementById('serverAddButton');
    const span = addBtn ? addBtn.querySelector('span') : null;
    if (!span) return;
    if (editingId) span.textContent = tr('servers.save', 'Save changes');
    else span.textContent = tr('servers.add', 'Add');
  }

  function startEdit(server) {
    editingId = server.id;
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    if (nameInput) nameInput.value = server.name;
    if (ipInput) ipInput.value = server.ip;
    paintAddButton();
    formStatus(`Editing “${server.name}”.`);
  }

  function resetForm() {
    editingId = null;
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    if (nameInput) nameInput.value = '';
    if (ipInput) ipInput.value = '';
    paintAddButton();
  }

  async function reload() {
    try {
      const servers = await bridge().listServers();
      renderList(servers || []);
      pingAll();
      document.dispatchEvent(new CustomEvent('servers:changed'));
    } catch (err) {
      formStatus(`Could not load servers: ${err.message}`, true);
    }
  }

  async function move(id, direction) {
    try {
      await bridge().moveServer(id, direction);
      await reload();
    } catch (err) {
      toast(`Reorder failed: ${err.message}`, 'error');
    }
  }

  async function remove(id) {
    try {
      await bridge().removeServer(id);
      toast('Server removed.', 'ok');
      if (editingId === id) resetForm();
      await reload();
    } catch (err) {
      toast(`Remove failed: ${err.message}`, 'error');
    }
  }

  async function submit() {
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    const name = nameInput ? nameInput.value.trim() : '';
    const ip = ipInput ? ipInput.value.trim() : '';
    if (!name || !ip) {
      formStatus('Name and IP are both required.', true);
      return;
    }
    try {
      if (editingId) {
        await bridge().updateServer(editingId, name, ip);
        toast('Server updated.', 'ok');
      } else {
        await bridge().addServer(name, ip);
        toast('Server added.', 'ok');
      }
      resetForm();
      formStatus('');
      await reload();
    } catch (err) {
      formStatus(err.message, true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('serverAddButton');
    if (addBtn) addBtn.addEventListener('click', submit);
    const ipInput = document.getElementById('serverIpInput');
    if (ipInput) {
      ipInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }
    document.addEventListener('view:shown', (e) => {
      if (e && e.detail && e.detail.view === 'servers') pingAll();
    });
    document.addEventListener('i18n:applied', () => paintAddButton());
    reload();
  });
})();
