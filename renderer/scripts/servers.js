'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;

  function tr(key, fallback) {
    try {
      if (window.i18n) {
        const v = window.i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch {}
    return fallback;
  }

  function fmt(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (map && map[k] !== undefined ? map[k] : ''));
  }

  function formStatus(text, isError) {
    const s = document.getElementById('serverFormStatus');
    if (!s) return;
    s.textContent = text;
    s.classList.toggle('is-error', !!isError);
  }

  function expandFormPanel() {
    const panel = document.querySelector('#view-servers .server-form-panel.collapsible');
    if (panel && panel.classList.contains('is-collapsed')) {
      panel.classList.remove('is-collapsed');
      const head = panel.querySelector('.panel-title');
      if (head) head.setAttribute('aria-expanded', 'true');
    }
  }

  function bindCollapsible() {
    document.querySelectorAll('#view-servers .collapsible > .panel-title').forEach((head) => {
      const toggle = () => {
        const panel = head.closest('.collapsible');
        if (!panel) return;
        const collapsed = panel.classList.toggle('is-collapsed');
        head.setAttribute('aria-expanded', String(!collapsed));
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  const statusByIp = new Map();
  let lastServers = [];
  let lastCategories = [];
  let activeCatFilter = 'all';

  function catName(id) {
    if (!id) return '';
    const found = lastCategories.find((c) => c.id === id);
    return found ? found.name : '';
  }

  function visibleServers() {
    if (activeCatFilter === 'all') return lastServers;
    return lastServers.filter((s) => (s.categoryId || null) === activeCatFilter);
  }

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
      if (server.disabled) motdEl.textContent = tr('servers.disabled', 'Disabled');
      else if (!st || st.state === 'loading') motdEl.textContent = tr('servers.pinging', 'Pinging…');
      else if (st.state === 'ok') motdEl.textContent = (st.data && st.data.motd) || tr('servers.noMotd', 'No MOTD.');
      else motdEl.textContent = tr('servers.offline', 'Offline — ping failed.');
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
    for (const s of lastServers) {
      if (!s.disabled) void pingRow(s);
      else paintRowStatus(s);
    }
  }

  function renderList(servers) {
    lastServers = servers || [];
    const list = document.getElementById('serverList');
    if (!list) return;
    list.textContent = '';
    const shown = visibleServers();
    const filtered = activeCatFilter !== 'all';
    if (!shown.length) {
      list.appendChild(el('li', 'installed-empty', lastServers.length
        ? tr('servers.emptyFilter', 'No servers in this category.')
        : tr('servers.empty', 'No servers added yet.')));
      return;
    }
    shown.forEach((server) => {
      const index = lastServers.findIndex((s) => s.id === server.id);
      const li = el('li', 'server-item' + (server.disabled ? ' is-disabled' : ''));
      li.dataset.serverId = server.id;
      li.appendChild(el('span', 'server-icon-slot'));
      const meta = el('div', 'server-meta');
      const nameRow = el('div', 'server-name-row');
      nameRow.appendChild(el('span', 'server-name', server.name));
      const cat = catName(server.categoryId);
      if (cat) nameRow.appendChild(el('span', 'cat-badge', cat));
      meta.appendChild(nameRow);
      meta.appendChild(el('span', 'server-motd', ''));
      meta.appendChild(el('span', 'server-ip server-sub', ''));
      li.appendChild(meta);

      const actions = el('div', 'server-actions');

      const joinBtn = el('button', 'icon-btn icon-btn-tiny');
      joinBtn.type = 'button';
      joinBtn.title = tr('servers.join', 'Join');
      joinBtn.setAttribute('aria-label', tr('servers.join', 'Join'));
      const joinIcon = document.createElement('i');
      joinIcon.setAttribute('data-lucide', 'play');
      joinBtn.appendChild(joinIcon);
      joinBtn.disabled = !!server.disabled;
      joinBtn.addEventListener('click', () => joinServer(server));
      actions.appendChild(joinBtn);

      const sw = el('label', 'switch');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !server.disabled;
      box.title = server.disabled ? tr('inst.enableShort', 'Enable') : tr('inst.disableShort', 'Disable');
      box.setAttribute('aria-label', box.title);
      box.addEventListener('change', async () => {
        box.disabled = true;
        try {
          await bridge().toggleServer(server.id, !box.checked);
          toast(fmt(tr(box.checked ? 'servers.enabledToast' : 'servers.disabledToast', box.checked ? 'Enabled {name}.' : 'Disabled {name}.'), { name: server.name }), 'ok');
          await reload();
        } catch (err) {
          box.checked = !server.disabled;
          box.disabled = false;
          toast(fmt(tr('servers.toggleFail', 'Toggle failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      const track = el('span', 'track');
      track.setAttribute('aria-hidden', 'true');
      sw.appendChild(box);
      sw.appendChild(track);
      actions.appendChild(sw);

      const refreshBtn = el('button', 'icon-btn icon-btn-tiny');
      refreshBtn.type = 'button';
      refreshBtn.title = tr('servers.pingNow', 'Ping now');
      refreshBtn.setAttribute('aria-label', tr('servers.pingNow', 'Ping now'));
      refreshBtn.setAttribute('data-refresh', '1');
      const refreshIcon = document.createElement('i');
      refreshIcon.setAttribute('data-lucide', 'refresh-cw');
      refreshBtn.appendChild(refreshIcon);
      refreshBtn.disabled = !!server.disabled;
      refreshBtn.addEventListener('click', () => pingRow(server));
      actions.appendChild(refreshBtn);

      if (server.invite) {
        const inviteBtn = el('button', 'icon-btn icon-btn-tiny');
        inviteBtn.type = 'button';
        inviteBtn.title = tr('servers.openInvite', 'Open invite');
        inviteBtn.setAttribute('aria-label', tr('servers.openInvite', 'Open invite'));
        const inviteIcon = document.createElement('i');
        inviteIcon.setAttribute('data-lucide', 'link');
        inviteBtn.appendChild(inviteIcon);
        inviteBtn.addEventListener('click', async () => {
          try {
            await bridge().openInvite(server.invite);
          } catch (err) {
            toast(fmt(tr('servers.inviteFail', 'Invite failed: {msg}'), { msg: err.message }), 'error');
          }
        });
        actions.appendChild(inviteBtn);
      }

      const upBtn = el('button', 'icon-btn icon-btn-tiny');
      upBtn.type = 'button';
      upBtn.title = tr('servers.moveUp', 'Move up');
      upBtn.setAttribute('aria-label', tr('servers.moveUp', 'Move up'));
      upBtn.disabled = index === 0 || filtered;
      const upIcon = document.createElement('i');
      upIcon.setAttribute('data-lucide', 'chevron-up');
      upBtn.appendChild(upIcon);
      upBtn.addEventListener('click', () => move(server.id, 'up'));
      actions.appendChild(upBtn);

      const downBtn = el('button', 'icon-btn icon-btn-tiny');
      downBtn.type = 'button';
      downBtn.title = tr('servers.moveDown', 'Move down');
      downBtn.setAttribute('aria-label', tr('servers.moveDown', 'Move down'));
      downBtn.disabled = index === lastServers.length - 1 || filtered;
      const downIcon = document.createElement('i');
      downIcon.setAttribute('data-lucide', 'chevron-down');
      downBtn.appendChild(downIcon);
      downBtn.addEventListener('click', () => move(server.id, 'down'));
      actions.appendChild(downBtn);

      const editBtn = el('button', 'btn btn-ghost btn-sm', tr('servers.edit', 'Edit'));
      editBtn.type = 'button';
      editBtn.addEventListener('click', () => startEdit(server));
      actions.appendChild(editBtn);

      const removeBtn = el('button', 'btn btn-danger-ghost btn-sm', tr('servers.remove', 'Remove'));
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

  function countInCategory(id) {
    if (id === 'all') return lastServers.length;
    return lastServers.filter((s) => (s.categoryId || null) === id).length;
  }

  function renderBar() {
    const bar = document.getElementById('serverCategoryBar');
    if (!bar) return;
    bar.textContent = '';
    const all = el('span', 'cat-pill' + (activeCatFilter === 'all' ? ' is-active' : ''));
    const allBtn = el('button', 'cat-filter', `${tr('servers.all', 'All')} (${countInCategory('all')})`);
    allBtn.type = 'button';
    allBtn.addEventListener('click', () => {
      activeCatFilter = 'all';
      renderBar();
      renderList(lastServers);
    });
    all.appendChild(allBtn);
    bar.appendChild(all);
    for (const cat of lastCategories) {
      const pill = el('span', 'cat-pill' + (activeCatFilter === cat.id ? ' is-active' : ''));
      const btn = el('button', 'cat-filter', `${cat.name} (${countInCategory(cat.id)})`);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        activeCatFilter = cat.id;
        renderBar();
        renderList(lastServers);
      });
      pill.appendChild(btn);
      const ren = el('button', 'cat-edit', '✎');
      ren.type = 'button';
      ren.title = fmt(tr('servers.renameCategory', 'Rename category “{name}”'), { name: cat.name });
      ren.setAttribute('aria-label', fmt(tr('servers.renameCategory', 'Rename category “{name}”'), { name: cat.name }));
      ren.addEventListener('click', () => renameCategory(cat));
      pill.appendChild(ren);
      const del = el('button', 'cat-del', '×');
      del.type = 'button';
      del.title = fmt(tr('servers.deleteCategory', 'Delete category “{name}”'), { name: cat.name });
      del.setAttribute('aria-label', fmt(tr('servers.deleteCategory', 'Delete category “{name}”'), { name: cat.name }));
      del.addEventListener('click', () => removeCategory(cat));
      pill.appendChild(del);
      bar.appendChild(pill);
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  function fillCategorySelect(keep) {
    const select = document.getElementById('serverCategoryInput');
    if (!select) return;
    const prev = keep !== undefined ? keep : select.value;
    select.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = tr('servers.noCategory', 'None');
    select.appendChild(none);
    for (const cat of lastCategories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      select.appendChild(opt);
    }
    if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
  }

  function paintAddButton() {
    const addBtn = document.getElementById('serverAddButton');
    const span = addBtn ? addBtn.querySelector('span') : null;
    if (!span) return;
    if (editingId) span.textContent = tr('servers.save', 'Save changes');
    else span.textContent = tr('servers.add', 'Add');
  }

  function startEdit(server) {
    try {
      editingId = server.id;
      expandFormPanel();
      const nameInput = document.getElementById('serverNameInput');
      const ipInput = document.getElementById('serverIpInput');
      const inviteInput = document.getElementById('serverInviteInput');
      const catInput = document.getElementById('serverCategoryInput');
      if (nameInput) nameInput.value = server.name;
      if (ipInput) ipInput.value = server.ip;
      if (inviteInput) inviteInput.value = server.invite || '';
      if (catInput) catInput.value = server.categoryId || '';
      paintAddButton();
      formStatus(fmt(tr('servers.editing', 'Editing “{name}”.'), { name: server.name }));
    } catch (err) {
      editingId = null;
      toast(fmt(tr('servers.editFail', 'Edit failed: {msg}'), { msg: err && err.message ? err.message : err }), 'error');
    }
  }

  function resetForm() {
    editingId = null;
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    const inviteInput = document.getElementById('serverInviteInput');
    const catInput = document.getElementById('serverCategoryInput');
    if (nameInput) nameInput.value = '';
    if (ipInput) ipInput.value = '';
    if (inviteInput) inviteInput.value = '';
    if (catInput) catInput.value = '';
    paintAddButton();
  }

  async function reload() {
    try {
      const [servers, categories] = await Promise.all([bridge().listServers(), bridge().listCategories()]);
      lastCategories = categories || [];
      if (activeCatFilter !== 'all' && !lastCategories.some((c) => c.id === activeCatFilter)) {
        activeCatFilter = 'all';
      }
      fillCategorySelect();
      renderBar();
      renderList(servers || []);
      pingAll();
      document.dispatchEvent(new CustomEvent('servers:changed'));
    } catch (err) {
      formStatus(fmt(tr('servers.loadFail', 'Could not load servers: {msg}'), { msg: err.message }), true);
    }
  }

  async function joinServer(server) {
    try {
      const st = await bridge().gameStatus();
      if (st && st.running) {
        toast(tr('servers.joinRunning', 'Game is already running.'), 'error');
        return;
      }
      const inst = st && st.instance ? st.instance : null;
      if (!inst) {
        toast(tr('play.needInstance', 'Create an instance first.'), 'error');
        if (typeof window.showView === 'function') window.showView('instances');
        return;
      }
      toast(fmt(tr('servers.joining', 'Starting {instance} → {server}…'), { instance: inst.name, server: server.ip }));
      await bridge().ensureClient(inst.id);
      await bridge().launch(inst.id, server.ip);
    } catch (err) {
      toast(fmt(tr('servers.joinFail', 'Join failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  async function move(id, direction) {
    try {
      await bridge().moveServer(id, direction);
      await reload();
    } catch (err) {
      toast(fmt(tr('servers.reorderFail', 'Reorder failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  async function remove(id) {
    try {
      await bridge().removeServer(id);
      toast(tr('servers.removed', 'Server removed.'), 'ok');
      if (editingId === id) resetForm();
      await reload();
    } catch (err) {
      toast(fmt(tr('servers.removeFail', 'Remove failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  async function submit() {
    const nameInput = document.getElementById('serverNameInput');
    const ipInput = document.getElementById('serverIpInput');
    const inviteInput = document.getElementById('serverInviteInput');
    const catInput = document.getElementById('serverCategoryInput');
    const name = nameInput ? nameInput.value.trim() : '';
    const ip = ipInput ? ipInput.value.trim() : '';
    const inviteRaw = inviteInput ? inviteInput.value.trim() : '';
    const invite = inviteRaw ? inviteRaw : null;
    const categoryId = catInput && catInput.value ? catInput.value : null;
    if (!name || !ip) {
      expandFormPanel();
      formStatus(tr('servers.needBoth', 'Name and IP are both required.'), true);
      return;
    }
    try {
      if (editingId) {
        await bridge().updateServer(editingId, name, ip, categoryId, invite);
        toast(tr('servers.updated', 'Server updated.'), 'ok');
      } else {
        await bridge().addServer(name, ip, categoryId, invite);
        toast(tr('servers.added', 'Server added.'), 'ok');
      }
      resetForm();
      formStatus('');
      await reload();
    } catch (err) {
      expandFormPanel();
      formStatus(err.message, true);
    }
  }

  async function submitCategory() {
    const input = document.getElementById('serverCategoryNameInput');
    const name = input ? input.value.trim() : '';
    if (!name) {
      formStatus(tr('servers.catEmpty', 'Category name is required.'), true);
      return;
    }
    try {
      await bridge().addCategory(name);
      if (input) input.value = '';
      toast(tr('servers.catAdded', 'Category added.'), 'ok');
      await reload();
    } catch (err) {
      formStatus(err.message, true);
    }
  }

  async function removeCategory(cat) {
    if (!window.confirm(fmt(tr('servers.catConfirm', 'Delete category “{name}”? Servers are kept.'), { name: cat.name }))) return;
    try {
      await bridge().deleteCategory(cat.id);
      if (activeCatFilter === cat.id) activeCatFilter = 'all';
      if (editingId) resetForm();
      toast(tr('servers.catDeleted', 'Category deleted.'), 'ok');
      await reload();
    } catch (err) {
      toast(fmt(tr('servers.catFail', 'Category failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  async function renameCategory(cat) {
    const next = window.prompt(fmt(tr('servers.renamePrompt', 'New name for “{name}”:'), { name: cat.name }), cat.name);
    if (next === null) return;
    if (!next.trim()) {
      toast(tr('servers.catEmpty', 'Category name is required.'), 'error');
      return;
    }
    try {
      await bridge().renameCategory(cat.id, next.trim());
      toast(tr('servers.renamed', 'Category renamed.'), 'ok');
      await reload();
    } catch (err) {
      toast(fmt(tr('servers.catFail', 'Category failed: {msg}'), { msg: err.message }), 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindCollapsible();
    const addBtn = document.getElementById('serverAddButton');
    if (addBtn) addBtn.addEventListener('click', submit);
    const ipInput = document.getElementById('serverIpInput');
    if (ipInput) {
      ipInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
    }
    const catAddBtn = document.getElementById('serverCategoryAddButton');
    if (catAddBtn) catAddBtn.addEventListener('click', submitCategory);
    const catNameInput = document.getElementById('serverCategoryNameInput');
    if (catNameInput) {
      catNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCategory();
      });
    }
    document.addEventListener('view:shown', (e) => {
      if (e && e.detail && e.detail.view === 'servers') pingAll();
    });
    document.addEventListener('i18n:applied', () => { renderBar(); renderList(lastServers); paintAddButton(); });
    reload();
  });
})();
