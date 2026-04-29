/* ==========================================================================
   PVE Vitals - Architecture theme renderer
   Three-tier system map (storage / nodes / guests) drawn into a single SVG.
   Registers itself on window.PVE_THEMES.architecture so app.js dispatches
   render() on every fetch cycle and tick() on the 1s clock interval.
   ========================================================================== */

(function () {
  'use strict';

  // === Static layout (matches preview viewBox 0..700 x 0..360) ==============
  const VIEW_W = 700;
  const VIEW_H = 360;
  const CARD_W = 140;
  const NODE_H = 80;
  const STORAGE_H = 52;
  const GUEST_H = 28;
  const GUEST_ROWS = 4;
  const X_FIRST = 80;     // first column x
  const X_LAST = 620;     // last column right edge
  const STORAGE_Y = 20;
  const NODE_Y = 132;
  const GUEST_Y0 = 224;

  // NATO/German letter ids for the decorative sub-line under node names.
  const NATO_EN = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT',
    'GOLF', 'HOTEL', 'INDIA', 'JULIETT', 'KILO', 'LIMA',
    'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO',
    'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY', 'X-RAY',
    'YANKEE', 'ZULU'];
  const NATO_DE = ['ANTON', 'BERTA', 'CAESAR', 'DORA', 'EMIL', 'FRIEDRICH',
    'GUSTAV', 'HEINRICH', 'IDA', 'JULIUS', 'KONRAD', 'LUDWIG',
    'MARTHA', 'NORDPOL', 'OTTO', 'PAULA', 'QUELLE', 'RICHARD',
    'SIEGFRIED', 'THEODOR', 'ULRICH', 'VIKTOR', 'WILHELM', 'XAVER',
    'YPSILON', 'ZACHARIAS'];

  function letterId(i, lang) {
    const list = lang === 'de' ? NATO_DE : NATO_EN;
    return i < list.length ? list[i] : String(i + 1);
  }

  // === Helpers ==============================================================
  function svgEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function storageColor(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'nfs' || t === 'pbs' || t === 'dir' || t === 'cifs') return 'var(--storage-nfs)';
    if (t === 'ceph' || t === 'rbd' || t === 'cephfs') return 'var(--storage-ceph)';
    if (t === 'zfs' || t === 'zfspool' || t === 'lvm' || t === 'lvmthin') return 'var(--storage-zfs)';
    return 'var(--storage-other)';
  }

  function sevColor(sev) {
    if (sev === 'crit') return 'var(--crit-red)';
    if (sev === 'warn') return 'var(--warn-amber)';
    return 'var(--ok-green)';
  }

  // Spread N node cards across [X_FIRST, X_LAST] returning each card's left x.
  // 1 or 2 nodes are pulled inward instead of pinned to the edges so the
  // diagram does not look hollow when the cluster is small.
  function spreadXs(count) {
    if (count <= 0) return [];
    if (count === 1) return [Math.round((VIEW_W - CARD_W) / 2)];
    if (count === 2) {
      const a = Math.round(VIEW_W * 0.30 - CARD_W / 2);
      const b = Math.round(VIEW_W * 0.70 - CARD_W / 2);
      return [a, b];
    }
    const span = X_LAST - X_FIRST - CARD_W;
    const step = span / (count - 1);
    const xs = [];
    for (let i = 0; i < count; i += 1) xs.push(Math.round(X_FIRST + step * i));
    return xs;
  }

  // Storages get their own width-adaptive spread because they typically
  // outnumber nodes and would otherwise overlap when squeezed into the node
  // x-range. Returns { xs, cardW }: cardW shrinks toward 70px when the row
  // is dense, so 8 storages still fit without collision.
  const STORAGE_LEFT = 40;
  const STORAGE_RIGHT = VIEW_W - 40;
  const STORAGE_GAP = 8;
  const STORAGE_W_MIN = 70;
  function spreadStorages(count) {
    if (count <= 0) return { xs: [], cardW: CARD_W };
    if (count === 1) {
      return { xs: [Math.round((VIEW_W - CARD_W) / 2)], cardW: CARD_W };
    }
    const totalSpan = STORAGE_RIGHT - STORAGE_LEFT;
    const fitW = Math.floor((totalSpan - (count - 1) * STORAGE_GAP) / count);
    const cardW = Math.max(STORAGE_W_MIN, Math.min(CARD_W, fitW));
    const step = (totalSpan - cardW) / (count - 1);
    const xs = [];
    for (let i = 0; i < count; i += 1) xs.push(Math.round(STORAGE_LEFT + step * i));
    return { xs, cardW };
  }

  // Truncate a string to roughly cardW pixels at the given font size, using
  // an ellipsis suffix. Cheap heuristic, no DOM measurement needed.
  function fitText(s, cardW, charPx) {
    const max = Math.max(2, Math.floor((cardW - 8) / charPx));
    const str = String(s == null ? '' : s);
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  // === Aggregate cluster-wide storages ======================================
  // state.storage is keyed by node; we want one card per unique storage name.
  // For a shared storage we pick the entry with the largest "total". For
  // node-local storages we keep them as-is and label with node suffix.
  function gatherStorages(state) {
    const seen = new Map();
    const stMap = state.storage || {};
    Object.keys(stMap).forEach((node) => {
      const arr = stMap[node] || [];
      arr.forEach((s) => {
        if (!s || !s.storage) return;
        const sharedKey = s.shared ? `shared:${s.storage}` : `${node}:${s.storage}`;
        const prev = seen.get(sharedKey);
        const total = Number(s.total || 0);
        const used = Number(s.used || 0);
        if (!prev || total > Number(prev.total || 0)) {
          seen.set(sharedKey, {
            storage: s.storage,
            type: s.type || '',
            total,
            used,
            shared: !!s.shared,
            node: s.shared ? null : node,
          });
        }
      });
    });
    // Stable order: shared first, then by name.
    return Array.from(seen.values()).sort((a, b) => {
      if (a.shared !== b.shared) return a.shared ? -1 : 1;
      return String(a.storage).localeCompare(String(b.storage));
    });
  }

  // === Header ===============================================================
  function renderHeader(state, helpers, counts) {
    // The Proxmox cluster resource carries the real cluster name; fall back
    // only if /api/cluster/resources hasn't returned anything yet.
    const clusterRes = (state.resources || []).find((r) => r && r.type === 'cluster');
    const host = (clusterRes && clusterRes.name) || 'pve-cluster';
    const title = `${host} · cluster architecture`;
    const lang = state.lang || 'en';
    const metaParts = [
      `${counts.nodes} ${helpers.t('nodes')}`,
      `${counts.storages} ${helpers.t('storage').toLowerCase()}`,
      `${counts.guests} ${helpers.t('guests').toLowerCase()}`,
    ];
    const live = lang === 'de' ? 'live' : 'live';
    return [
      '<div class="arch-head">',
      '<span class="roundel">V</span>',
      `<h3>${helpers.esc(title)}</h3>`,
      `<span class="meta">${helpers.esc(metaParts.join(' · '))}</span>`,
      `<span class="effective" data-arch-clock>${live} · ${currentClock()}</span>`,
      '</div>',
    ].join('');
  }

  function currentClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // === SVG: tier labels =====================================================
  function svgTierLabels(lang) {
    const labels = lang === 'de'
      ? ['SPEICHER', 'KNOTEN', 'VMs & CTs']
      : ['STORAGE', 'NODES', 'VMs & CTs'];
    return [
      '<g font-size="8.5" font-weight="800" letter-spacing=".22em" fill="var(--diagram-quiet)" text-anchor="middle">',
      `<text x="14" y="50" transform="rotate(-90, 14, 50)">${svgEsc(labels[0])}</text>`,
      `<text x="14" y="170" transform="rotate(-90, 14, 170)">${svgEsc(labels[1])}</text>`,
      `<text x="14" y="290" transform="rotate(-90, 14, 290)">${svgEsc(labels[2])}</text>`,
      '</g>',
    ].join('');
  }

  // === SVG: tier 1 storage cards + bus =====================================
  function svgStorages(storages, nodeXs, helpers, lang) {
    if (storages.length === 0) return '';
    const { xs, cardW } = spreadStorages(storages.length);
    const parts = [];

    // Adaptive font size: shrink the big "name" line when cards are narrow.
    const nameFont = cardW < 110 ? 11 : 13;
    const nameCharPx = nameFont * 0.62;       // rough advance for a heavy weight
    const labelCharPx = 5.6;                  // 9px/800 with .18em tracking
    const usedCharPx = 4.7;                   // 9.5px/500

    storages.forEach((s, i) => {
      const x = xs[i];
      const cx = x + cardW / 2;
      const color = storageColor(s.type);
      const labelRaw = `${(s.type || 'STO').toUpperCase()} · ${helpers.fmtBytes(s.total)}`;
      const label = fitText(labelRaw, cardW, labelCharPx);
      const name = fitText(s.storage, cardW, nameCharPx);
      const usedPct = helpers.pct(s.used, s.total);
      const usedRaw = (lang === 'de' ? 'verw.' : 'used') + ` ${helpers.fmtBytes(s.used)} · ${usedPct}%`;
      const used = fitText(usedRaw, cardW, usedCharPx);

      parts.push('<g>');
      parts.push(`<rect x="${x}" y="${STORAGE_Y}" width="${cardW}" height="${STORAGE_H}" rx="6" fill="var(--diagram-card)" stroke="var(--diagram-card-stroke)" stroke-width="1.5"/>`);
      parts.push(`<path d="M ${x} ${STORAGE_Y} h ${cardW - 6} a 6 6 0 0 1 6 6 v 8 h -${cardW} v -8 a 6 6 0 0 1 6 -6 z" fill="${color}"/>`);
      parts.push(`<text x="${cx}" y="${STORAGE_Y + 12}" text-anchor="middle" fill="#fff" font-size="9" font-weight="800" letter-spacing=".18em">${svgEsc(label)}</text>`);
      parts.push(`<text x="${cx}" y="${STORAGE_Y + 35}" text-anchor="middle" font-size="${nameFont}" font-weight="800" fill="var(--diagram-text)">${svgEsc(name)}</text>`);
      parts.push(`<text x="${cx}" y="${STORAGE_Y + 48}" text-anchor="middle" font-size="9.5" font-weight="500" fill="var(--diagram-muted)">${svgEsc(used)}</text>`);
      parts.push('</g>');
    });

    // Storage -> node bus at y=104.
    parts.push('<g stroke="var(--diagram-rule)" stroke-width="1.4" fill="none" stroke-linecap="round">');
    xs.forEach((sx) => {
      const cx = sx + cardW / 2;
      parts.push(`<path d="M ${cx} ${STORAGE_Y + STORAGE_H} L ${cx} 104"/>`);
    });
    if (nodeXs.length > 0) {
      const minX = Math.min(...nodeXs.map((x) => x + CARD_W / 2));
      const maxX = Math.max(...nodeXs.map((x) => x + CARD_W / 2));
      const minS = Math.min(...xs.map((x) => x + cardW / 2));
      const maxS = Math.max(...xs.map((x) => x + cardW / 2));
      const busL = Math.min(minX, minS);
      const busR = Math.max(maxX, maxS);
      parts.push(`<path d="M ${busL} 104 L ${busR} 104"/>`);
      nodeXs.forEach((nx) => {
        const cx = nx + CARD_W / 2;
        parts.push(`<path d="M ${cx} 104 L ${cx} ${NODE_Y}"/>`);
      });
    }
    parts.push('</g>');

    parts.push('<g fill="var(--diagram-rule)" stroke="none">');
    xs.forEach((sx) => {
      parts.push(`<circle cx="${sx + cardW / 2}" cy="104" r="2.5"/>`);
    });
    nodeXs.forEach((nx) => {
      parts.push(`<circle cx="${nx + CARD_W / 2}" cy="104" r="2.5"/>`);
    });
    parts.push('</g>');

    const microcopy = lang === 'de' ? 'geteilt mit allen Knoten' : 'shared on all nodes';
    parts.push(`<text x="${VIEW_W - 12}" y="100" text-anchor="end" font-size="8" font-style="italic" fill="var(--diagram-quiet)">${svgEsc(microcopy)}</text>`);

    return parts.join('');
  }

  // === SVG: tier 2 nodes ===================================================
  function svgNodes(nodes, nodeXs, helpers, lang, thresholds) {
    if (nodes.length === 0) return '';
    const parts = [];

    nodes.forEach((n, i) => {
      const x = nodeXs[i];
      const cx = x + CARD_W / 2;
      const cpuPct = helpers.pct(Number(n.cpu || 0) * Number(n.maxcpu || 1), Number(n.maxcpu || 1));
      const memPct = helpers.pct(n.mem, n.maxmem);
      const dskPct = helpers.pct(n.disk, n.maxdisk);
      const cpuSev = (n.status === 'online') ? helpers.sevForPct(cpuPct, thresholds.cpuWarn, thresholds.cpuCrit) : 'crit';
      const memSev = (n.status === 'online') ? helpers.sevForPct(memPct, thresholds.memWarn, thresholds.memCrit) : 'crit';
      const dskSev = (n.status === 'online') ? helpers.sevForPct(dskPct, thresholds.diskWarn, thresholds.diskCrit) : 'crit';
      const dotSev = n.status === 'online' ? helpers.maxSev(cpuSev, memSev, dskSev) : 'crit';
      const dotColor = n.status === 'online' ? sevColor(dotSev) : 'var(--diagram-quiet)';

      const subUp = n.uptime ? `· ${(lang === 'de' ? 'AN' : 'UP')} ${helpers.fmtUptime(n.uptime).toUpperCase()}` : '';
      const subLine = `${letterId(i, lang)} ${subUp}`.trim();

      parts.push('<g>');
      parts.push(`<rect x="${x}" y="${NODE_Y}" width="${CARD_W}" height="${NODE_H}" rx="6" fill="var(--diagram-card)" stroke="var(--diagram-card-stroke)" stroke-width="2"/>`);
      parts.push(`<circle cx="${x + 18}" cy="${NODE_Y + 18}" r="3.8" fill="${dotColor}"/>`);
      parts.push(`<text x="${cx}" y="${NODE_Y + 23}" text-anchor="middle" font-size="14" font-weight="800" fill="var(--diagram-text)">${svgEsc(n.node)}</text>`);
      parts.push(`<text x="${cx}" y="${NODE_Y + 35}" text-anchor="middle" font-size="8" font-weight="700" fill="var(--diagram-muted)" letter-spacing=".15em">${svgEsc(subLine)}</text>`);

      const barX = x + 35;
      const barW = 80;
      const labelX = x + 13;
      const pctX = x + CARD_W - 10;
      const drawBar = (label, value, sev, by) => {
        const fillW = Math.max(0, Math.min(80, (value / 100) * barW));
        parts.push(`<text x="${labelX}" y="${by + 6}" font-size="8" font-weight="800" fill="var(--diagram-muted)">${label}</text>`);
        parts.push(`<rect x="${barX}" y="${by}" width="${barW}" height="6" rx="3" fill="var(--diagram-rule)"/>`);
        parts.push(`<rect x="${barX}" y="${by}" width="${fillW.toFixed(1)}" height="6" rx="3" fill="${sevColor(sev)}"/>`);
        parts.push(`<text x="${pctX}" y="${by + 6}" text-anchor="end" font-size="8" font-weight="800" fill="var(--diagram-text)">${value}%</text>`);
      };
      drawBar('CPU', cpuPct, cpuSev, NODE_Y + 46);
      drawBar('MEM', memPct, memSev, NODE_Y + 58);
      drawBar('DSK', dskPct, dskSev, NODE_Y + 70);
      parts.push('</g>');
    });

    return parts.join('');
  }

  // === SVG: tier 3 guests ==================================================
  function pickGuestsForNode(state, nodeName) {
    const out = [];
    const res = state.resources || [];
    for (let i = 0; i < res.length; i += 1) {
      const r = res[i];
      if (!r) continue;
      if (r.type !== 'qemu' && r.type !== 'lxc') continue;
      if (r.node !== nodeName) continue;
      out.push(r);
    }
    // Running first, then stopped, then by name.
    out.sort((a, b) => {
      const ar = a.status === 'running' ? 0 : 1;
      const br = b.status === 'running' ? 0 : 1;
      if (ar !== br) return ar - br;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return out;
  }

  function svgGuestSpines(nodeXs, hasGuestsByIdx) {
    if (nodeXs.length === 0) return '';
    const parts = ['<g stroke="var(--diagram-rule)" stroke-width="1.3" fill="none" stroke-linecap="round">'];
    nodeXs.forEach((x, i) => {
      const cx = x + CARD_W / 2;
      // drop from node to guest column
      parts.push(`<path d="M ${cx} ${NODE_Y + NODE_H} L ${cx} ${GUEST_Y0}"/>`);
      if (hasGuestsByIdx[i]) {
        parts.push(`<path d="M ${cx} ${GUEST_Y0} L ${cx} 350"/>`);
      }
    });
    parts.push('</g>');
    return parts.join('');
  }

  function svgGuests(state, nodes, nodeXs, helpers, lang) {
    if (nodes.length === 0) return '';
    const parts = [];

    nodes.forEach((n, ni) => {
      const x = nodeXs[ni];
      const all = pickGuestsForNode(state, n.node);
      if (all.length === 0) return;

      const slots = Math.min(all.length, GUEST_ROWS);
      for (let row = 0; row < slots; row += 1) {
        const isOverflow = (row === GUEST_ROWS - 1) && all.length > GUEST_ROWS;
        const y = GUEST_Y0 + row * 30;
        if (isOverflow) {
          const remaining = all.length - (GUEST_ROWS - 1);
          const moreLabel = lang === 'de' ? `+${remaining} weitere` : `+${remaining} more`;
          parts.push('<g>');
          parts.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${GUEST_H}" rx="4" fill="var(--diagram-card)" stroke="var(--diagram-rule)" stroke-width="1" stroke-dasharray="3 2" opacity="0.7"/>`);
          parts.push(`<text x="${x + CARD_W / 2}" y="${y + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--diagram-muted)" font-style="italic">${svgEsc(moreLabel)}</text>`);
          parts.push('</g>');
          continue;
        }

        const g = all[row];
        const isVm = g.type === 'qemu';
        const banner = isVm ? 'var(--vm-blue)' : 'var(--ct-amber)';
        const tag = isVm ? 'VM' : 'CT';
        const stopped = g.status !== 'running';
        const name = g.name || (isVm ? `vm-${g.vmid}` : `ct-${g.vmid}`);

        // Severity dot for running guests.
        let dotSev = 'ok';
        if (!stopped) {
          const memPct = helpers.pct(g.mem, g.maxmem);
          dotSev = helpers.sevForPct(memPct, state.thresholds.memWarn, state.thresholds.memCrit);
        }

        parts.push('<g>');
        if (stopped) {
          parts.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${GUEST_H}" rx="4" fill="var(--diagram-card)" stroke="var(--diagram-quiet)" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`);
          parts.push(`<rect x="${x}" y="${y}" width="26" height="${GUEST_H}" rx="4" fill="var(--diagram-quiet)"/>`);
          parts.push(`<rect x="${x + 20}" y="${y}" width="6" height="${GUEST_H}" fill="var(--diagram-quiet)"/>`);
          parts.push(`<text x="${x + 13}" y="${y + 18}" text-anchor="middle" fill="#fff" font-size="9" font-weight="800" letter-spacing=".06em">${tag}</text>`);
          parts.push(`<text x="${x + 33}" y="${y + 18}" font-size="11" font-weight="700" font-style="italic" fill="var(--diagram-muted)">${svgEsc(name)}</text>`);
          parts.push(`<text x="${x + CARD_W - 12}" y="${y + 18}" text-anchor="end" font-size="10" font-weight="700" fill="var(--diagram-muted)">⏸</text>`);
        } else {
          parts.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${GUEST_H}" rx="4" fill="var(--diagram-card)" stroke="var(--diagram-card-stroke)" stroke-width="1" opacity="0.9"/>`);
          parts.push(`<rect x="${x}" y="${y}" width="26" height="${GUEST_H}" rx="4" fill="${banner}"/>`);
          parts.push(`<rect x="${x + 20}" y="${y}" width="6" height="${GUEST_H}" fill="${banner}"/>`);
          parts.push(`<text x="${x + 13}" y="${y + 18}" text-anchor="middle" fill="#fff" font-size="9" font-weight="800" letter-spacing=".06em">${tag}</text>`);
          parts.push(`<text x="${x + 33}" y="${y + 18}" font-size="11" font-weight="700" fill="var(--diagram-text)">${svgEsc(name)}</text>`);
          parts.push(`<circle cx="${x + CARD_W - 12}" cy="${y + 14}" r="3" fill="${sevColor(dotSev)}"/>`);
        }
        parts.push('</g>');
      }
    });

    return parts.join('');
  }

  // === Footer ==============================================================
  function renderFooter(state, helpers) {
    const lang = state.lang || 'en';
    const labels = lang === 'de'
      ? { vm: 'VM', ct: 'CT', ok: 'gesund', warm: 'warm', stop: 'gestoppt' }
      : { vm: 'VM', ct: 'CT', ok: 'healthy', warm: 'warming', stop: 'stopped' };

    const alerts = (helpers.computeAlerts() || []);
    let cls = 'ok';
    let badge;
    let body;
    if (alerts.length === 0) {
      cls = 'ok';
      badge = lang === 'de' ? 'alles ruhig' : 'all clear';
      body = lang === 'de' ? 'Cluster betriebsbereit. Keine offenen Meldungen.' : 'Cluster operational. No active alerts.';
    } else {
      const hasCrit = alerts.some((a) => a.sev === 'crit');
      cls = hasCrit ? 'crit' : '';
      badge = hasCrit
        ? (lang === 'de' ? 'kritisch' : 'critical')
        : (lang === 'de' ? 'beachten' : 'heads-up');
      body = alerts.slice(0, 3).map((a) => a.msg).join(' · ');
    }
    if (cls === '') cls = 'warn';

    return [
      '<div class="arch-foot">',
      '<div class="arch-legend">',
      `<span class="vm-key"><i></i>${helpers.esc(labels.vm)}</span>`,
      `<span class="ct-key"><i></i>${helpers.esc(labels.ct)}</span>`,
      `<span class="ok"><i class="dot"></i>${helpers.esc(labels.ok)}</span>`,
      `<span class="warn"><i class="dot"></i>${helpers.esc(labels.warm)}</span>`,
      `<span class="stop"><i class="dot"></i>${helpers.esc(labels.stop)}</span>`,
      '</div>',
      `<div class="arch-alerts ${cls === 'ok' ? 'ok' : cls === 'crit' ? 'crit' : ''}">`,
      `<span class="badge">${helpers.esc(badge)}</span>`,
      `<span class="body">${helpers.esc(body)}</span>`,
      '</div>',
      '</div>',
    ].join('');
  }

  // === Main render =========================================================
  function render(state, helpers) {
    const host = document.getElementById('theme-host');
    if (!host) return;

    const nodes = Array.isArray(state.nodes) ? state.nodes.slice() : [];
    nodes.sort((a, b) => String(a.node || '').localeCompare(String(b.node || '')));
    const storages = gatherStorages(state);

    const guestCount = (state.resources || []).filter((r) => r && (r.type === 'qemu' || r.type === 'lxc')).length;
    const counts = { nodes: nodes.length, storages: storages.length, guests: guestCount };

    // Build wrapper once; only swap header + map + footer innerHTML on re-renders.
    let stage = host.querySelector('.arch-stage');
    if (!stage) {
      host.innerHTML = '<div class="arch-stage"><div class="arch-head-wrap"></div><div class="arch-map-wrap"></div><div class="arch-foot-wrap"></div></div>';
      stage = host.querySelector('.arch-stage');
    }

    const headWrap = stage.querySelector('.arch-head-wrap');
    const mapWrap = stage.querySelector('.arch-map-wrap');
    const footWrap = stage.querySelector('.arch-foot-wrap');

    headWrap.innerHTML = renderHeader(state, helpers, counts);

    if (nodes.length === 0) {
      mapWrap.innerHTML = `<div class="arch-empty">${helpers.esc(helpers.t('empty'))}</div>`;
      footWrap.innerHTML = renderFooter(state, helpers);
      return;
    }

    const nodeXs = spreadXs(nodes.length);
    const hasGuests = nodes.map((n) => pickGuestsForNode(state, n.node).length > 0);
    const lang = state.lang || 'en';

    const svg = [
      `<svg class="arch-map" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" font-family="Inter, sans-serif">`,
      svgTierLabels(lang),
      svgStorages(storages, nodeXs, helpers, lang),
      svgNodes(nodes, nodeXs, helpers, lang, state.thresholds || {}),
      svgGuestSpines(nodeXs, hasGuests),
      svgGuests(state, nodes, nodeXs, helpers, lang),
      '</svg>',
    ].join('');

    mapWrap.innerHTML = svg;
    footWrap.innerHTML = renderFooter(state, helpers);
  }

  // === Tick: cheap clock-only update =======================================
  function tick(state /* , helpers */) {
    const el = document.querySelector('#theme-host [data-arch-clock]');
    if (!el) return;
    const lang = state.lang || 'en';
    const live = lang === 'de' ? 'live' : 'live';
    el.textContent = `${live} · ${currentClock()}`;
  }

  window.PVE_THEMES = window.PVE_THEMES || {};
  window.PVE_THEMES.architecture = { render, tick };
}());
