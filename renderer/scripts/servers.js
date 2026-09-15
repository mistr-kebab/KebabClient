'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  function formStatus(text, isError) {
    const s = document.getElementById('serverFormStatus');
    if (!s) return;
    s.textContent = text;
    s.style.color = isError ? 'var(--danger)' : '';
  }

  function renderList(servers) {
    const list = document.getElementById('serverList');
    if (!list) return;
    list.textContent = '';
    if (!servers.length) {
      list.appendChild(el('li', 'installed-empty', 'No servers added yet.'));
      return;
    }
    servers.forEach((server, index) => {
      const li = el('li', 'server-item');
      const meta = el('div', 'server-meta');
      meta.appendChild(el('span', 'server-name', server.name));
      meta.appendChild(el('span', 'server-ip', server.ip));
      li.appendChild(meta);

      const actions = el('div', 'server-actions');

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
      downBtn.disabled = index === servers.length - 1;
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
    });
    if (window.refreshIcons) window.refreshIcons();
  }

  let editingId = null;

  function startEdit(server) {
    editingId = server.id;
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    const addBtn = document.getElementById('serverAddButton');
    if (nameInput) nameInput.value = server.name;
    if (ipInput) ipInput.value = server.ip;
    if (addBtn) addBtn.querySelector('span').textContent = 'Save changes';
    formStatus(`Editing “${server.name}”.`);
  }

  function resetForm() {
    editingId = null;
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    const addBtn = document.getElementById('serverAddButton');
    if (nameInput) nameInput.value = '';
    if (ipInput) ipInput.value = '';
    if (addBtn) addBtn.querySelector('span').textContent = 'Add';
  }

  async function reload() {
    try {
      const servers = await bridge().listServers();
      renderList(servers || []);
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
    reload();
  });
})();
