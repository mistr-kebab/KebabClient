'use strict';

(function () {
  const { bridge, toast, el } = window.launcherUtil;
  const ctx = window.instancesCtx;
  const { tr, fmt, loaderLabel, notifyChanged } = ctx;

  const progressById = new Map();
  const progressTimers = new Map();

  const TILE_BANNERS = [
    'banner-01.webp',
    'banner-02.webp',
    'banner-03.webp',
    'banner-04.webp',
    'banner-05.webp',
    'banner-06.webp',
    'banner-07.webp',
    'banner-08.webp',
    'banner-09.webp',
    'banner-10.webp',
  ];

  function paintTileProgress(tile, ratio, label) {
    const prog = tile.querySelector('.tile-progress');
    const fill = tile.querySelector('.tile-progress .progress-bar');
    const lab = tile.querySelector('.tile-progress-label');
    if (!prog || !fill || !lab) return;
    if (ratio === null || ratio === undefined) {
      prog.hidden = true;
      fill.style.width = '0%';
      lab.textContent = '';
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    prog.hidden = false;
    fill.style.width = `${pct}%`;
    lab.textContent = label ? `${pct}% — ${label}` : `${pct}%`;
  }

  function onInstanceProgress(p) {
    if (!p || !p.instanceId || typeof p.ratio !== 'number') return;
    if (p.phase === 'mods' || p.phase === 'settings') return;
    const label = `${p.phase || ''} — ${p.label || ''}`.replace(/^ — | — $/g, '').trim();
    const done = p.ratio >= 1;
    if (progressTimers.has(p.instanceId)) {
      window.clearTimeout(progressTimers.get(p.instanceId));
      progressTimers.delete(p.instanceId);
    }
    if (done) {
      progressById.set(p.instanceId, { ratio: 1, label });
      const timer = window.setTimeout(() => {
        progressById.delete(p.instanceId);
        progressTimers.delete(p.instanceId);
        const tile = document.querySelector(`.instance-tile[data-instance-id="${CSS.escape(p.instanceId)}"]`);
        if (tile) paintTileProgress(tile, null);
      }, 3000);
      progressTimers.set(p.instanceId, timer);
    } else {
      progressById.set(p.instanceId, { ratio: p.ratio, label });
    }
    const tile = document.querySelector(`.instance-tile[data-instance-id="${CSS.escape(p.instanceId)}"]`);
    if (tile) {
      const state = progressById.get(p.instanceId);
      paintTileProgress(tile, state.ratio, state.label);
    }
  }

  function badge(instance) {
    const span = el('span', `loader-badge loader-${instance.loader}`, loaderLabel(instance.loader));
    return span;
  }

  function tileBanner(instance) {
    const s = String((instance && instance.id) || (instance && instance.name) || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return `./assets/${TILE_BANNERS[h % TILE_BANNERS.length]}`;
  }

  function renderTiles(instances, activeId) {
    const grid = document.getElementById('instanceGrid');
    if (!grid) return;
    grid.textContent = '';
    if (!instances.length) {
      const empty = el('div', 'instance-empty');
      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', 'boxes');
      empty.appendChild(ic);
      empty.appendChild(el('h3', 'empty-title', tr('inst.emptyTitle', 'No instances yet')));
      empty.appendChild(el('p', 'muted', tr('inst.emptySub', 'Create your first one to start playing.')));
      const btn = el('button', 'btn btn-play btn-sm', tr('instances.createTitle', 'Create instance'));
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const panel = document.getElementById('newInstancePanel');
        const newBtn = document.getElementById('newInstanceButton');
        if (panel && panel.hidden && newBtn) newBtn.click();
        if (panel) panel.scrollIntoView({ block: 'nearest' });
      });
      empty.appendChild(btn);
      grid.appendChild(empty);
      if (window.refreshIcons) window.refreshIcons();
      return;
    }
    for (const instance of instances) {
      const tile = el('article', 'instance-tile' + (instance.id === activeId ? ' is-active' : ''));
      tile.tabIndex = 0;
      tile.dataset.instanceId = instance.id;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', fmt(tr('inst.selectTile', 'Select instance {name}'), { name: instance.name }));
      const banner = el('div', 'tile-banner');
      banner.style.backgroundImage = `url("${String(tileBanner(instance)).replace(/"/g, '%22')}")`;
      banner.setAttribute('aria-hidden', 'true');
      banner.appendChild(badge(instance));
      if (instance.iconDataUrl) {
        const custom = document.createElement('img');
        custom.className = 'tile-customicon';
        custom.alt = '';
        custom.src = instance.iconDataUrl;
        banner.appendChild(custom);
      }
      if (instance.id === activeId) {
        const pill = el('span', 'tile-activepill');
        const check = document.createElement('i');
        check.setAttribute('data-lucide', 'check');
        pill.appendChild(check);
        pill.appendChild(el('span', null, tr('inst.active', 'Active')));
        banner.appendChild(pill);
      }
      tile.appendChild(banner);
      tile.appendChild(el('span', 'tile-name', instance.name));
      const sub = el('span', 'tile-sub');
      const verBadge = el('span', `ver-badge ver-loader-${instance.loader || 'vanilla'}`);
      verBadge.appendChild(el('span', 'ver-dot'));
      verBadge.appendChild(document.createTextNode(instance.mc || ''));
      sub.appendChild(verBadge);
      const loaderInfo = instance.loaderVersion
        ? `${loaderLabel(instance.loader)} ${instance.loaderVersion}`
        : loaderLabel(instance.loader);
      sub.appendChild(document.createTextNode(` · ${loaderInfo}`));
      tile.appendChild(sub);
      if (instance.lastPlayed || instance.playtimeText) {
        const bits = [];
        if (instance.lastPlayed) {
          bits.push(
            fmt(tr('inst.playedOn', 'Played {date}'), { date: new Date(instance.lastPlayed).toLocaleDateString() })
          );
        }
        if (instance.playtimeText) bits.push(fmt(tr('inst.playedTime', '{t} played'), { t: instance.playtimeText }));
        tile.appendChild(el('span', 'tile-played', bits.join(' · ')));
      }
      const actions = el('span', 'tile-actions');
      const playBtn = el('button', 'btn btn-play btn-sm-pill', tr('home.play', 'Play'));
      playBtn.type = 'button';
      playBtn.addEventListener('click', async e => {
        e.stopPropagation();
        try {
          await bridge().setActiveInstance(instance.id);
        } catch (err) {
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
          return;
        }
        notifyChanged();
        window.showView('play');
        if (typeof window.startActiveGame === 'function') window.startActiveGame();
      });
      const delBtn = el('button', 'icon-btn tile-delete', '');
      delBtn.type = 'button';
      delBtn.title = fmt(tr('inst.deleteTitle', 'Delete {name}'), { name: instance.name });
      delBtn.setAttribute('aria-label', fmt(tr('inst.deleteTitle', 'Delete {name}'), { name: instance.name }));
      const trash = document.createElement('i');
      trash.setAttribute('data-lucide', 'trash-2');
      delBtn.appendChild(trash);
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (
          !window.confirm(
            fmt(tr('inst.deleteConfirm', 'Delete instance “{name}” including its mods and worlds?'), {
              name: instance.name,
            })
          )
        )
          return;
        try {
          await bridge().deleteInstance(instance.id);
          toast(fmt(tr('inst.deleted', 'Deleted {name}.'), { name: instance.name }), 'ok');
          notifyChanged();
          await loadInstances();
        } catch (err) {
          toast(fmt(tr('inst.deleteFail', 'Delete failed: {msg}'), { msg: err.message }), 'error');
        }
      });
      actions.appendChild(playBtn);
      const infoBtn = el('button', 'icon-btn tile-delete', '');
      infoBtn.type = 'button';
      infoBtn.title = fmt(tr('inst.openDetails', 'Open {name} details'), { name: instance.name });
      infoBtn.setAttribute('aria-label', fmt(tr('inst.openDetails', 'Open {name} details'), { name: instance.name }));
      const infoIcon = document.createElement('i');
      infoIcon.setAttribute('data-lucide', 'info');
      infoBtn.appendChild(infoIcon);
      infoBtn.addEventListener('click', e => {
        e.stopPropagation();
        ctx.openDetail(instance.id);
      });
      actions.appendChild(infoBtn);
      actions.appendChild(delBtn);
      tile.appendChild(actions);
      const prog = el('span', 'tile-progress');
      prog.hidden = true;
      const track = el('span', 'progress tile-progress-track');
      track.appendChild(el('span', 'progress-bar'));
      prog.appendChild(track);
      prog.appendChild(el('span', 'tile-progress-label', ''));
      tile.appendChild(prog);
      const stored = progressById.get(instance.id);
      if (stored) paintTileProgress(tile, stored.ratio, stored.label);
      const select = async () => {
        try {
          await bridge().setActiveInstance(instance.id);
          notifyChanged();
          await loadInstances();
        } catch (err) {
          toast(fmt(tr('inst.selectFail', 'Select failed: {msg}'), { msg: err.message }), 'error');
        }
      };
      tile.addEventListener('click', e => {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        select();
      });
      tile.addEventListener('keydown', e => {
        if (e.target !== tile) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
      grid.appendChild(tile);
    }
    if (window.refreshIcons) window.refreshIcons();
  }

  async function loadInstances() {
    try {
      const res = await bridge().listInstances();
      renderTiles(res?.instances || [], res?.activeId);
    } catch (err) {
      toast(fmt(tr('inst.loadFail', 'Could not load instances: {msg}'), { msg: err.message }), 'error');
    }
  }

  ctx.loadInstances = loadInstances;
  ctx.onInstanceProgress = onInstanceProgress;
})();
