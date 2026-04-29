'use strict';

// ============================================================================
// PVE Vitals — Transit theme renderer (DB Abfahrtstafel).
// Ports the static preview into a live, severity-driven departure board.
// Owns the entire #theme-host. Re-renders on each fetchAll cycle (~10s)
// and updates the big clock + via "ab" times in tick() once a second.
// ============================================================================

(function () {
  // Page-load anchor: the "scheduled" trip starts when the dashboard boots
  // and ends four hours later. Pure theatre — keeps the Zugnummer plausible.
  const TRIP_START_MS = Date.now();
  const TRIP_END_MS   = TRIP_START_MS + 4 * 60 * 60 * 1000;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtHHMM(d) {
    if (!(d instanceof Date)) d = new Date(d);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // Map cluster severity to a fake delay in minutes.
  // ok  -> 0, warn -> 5..15 by max metric, crit -> 30+.
  function classifyCluster(state, helpers) {
    const th = state.thresholds;
    const offlineNodes = (state.nodes || []).filter((n) => n.status !== 'online').length;

    let worst = 'ok';
    let maxOver = 0; // 0..1, how far over warn threshold any metric is
    (state.nodes || []).forEach((n) => {
      if (n.status !== 'online') return;
      const cpuPct  = Math.round((n.cpu ?? 0) * 100);
      const memPct  = helpers.pct(n.mem,  n.maxmem);
      const diskPct = helpers.pct(n.disk, n.maxdisk);
      [
        [cpuPct,  th.cpuWarn,  th.cpuCrit],
        [memPct,  th.memWarn,  th.memCrit],
        [diskPct, th.diskWarn, th.diskCrit],
      ].forEach(([p, warn, crit]) => {
        const sev = helpers.sevForPct(p, warn, crit);
        if (sev === 'crit') worst = 'crit';
        else if (sev === 'warn' && worst !== 'crit') worst = 'warn';
        if (p >= warn) {
          const span = Math.max(1, crit - warn);
          maxOver = Math.max(maxOver, Math.min(1, (p - warn) / span));
        }
      });
    });

    Object.values(state.storage || {}).forEach((pools) => {
      (pools || []).forEach((s) => {
        const p = helpers.pct(s.used, s.total);
        const sev = helpers.sevForPct(p, th.storageWarn, th.storageCrit);
        if (sev === 'crit') worst = 'crit';
        else if (sev === 'warn' && worst !== 'crit') worst = 'warn';
      });
    });

    if (offlineNodes > 0 || state.fetchFailCount >= 2) worst = 'crit';

    let delayMin = 0;
    if (worst === 'warn') delayMin = Math.max(5, Math.min(15, Math.round(5 + maxOver * 10)));
    else if (worst === 'crit') delayMin = 30 + offlineNodes * 5;

    return { sev: worst, delayMin, offlineNodes };
  }

  // Build the via-list from nodes + a hint of shared storage + failed tasks.
  function buildVia(state, helpers, nowDate) {
    const t = helpers.t;
    const th = state.thresholds;
    const rows = [];
    const ab = fmtHHMM(nowDate);

    (state.nodes || []).forEach((n) => {
      if (n.status !== 'online') {
        rows.push({
          ab,
          name: `${helpers.esc(n.node)} · ${helpers.esc(t('transit_compute'))}`,
          statusKey: 'crit', statusLabel: t('transit_via_crit'),
          load: '—',
        });
        return;
      }
      const cpuPct = Math.round((n.cpu ?? 0) * 100);
      const memPct = helpers.pct(n.mem, n.maxmem);
      const worst = helpers.maxSev
        ? helpers.maxSev([
            helpers.sevForPct(cpuPct, th.cpuWarn, th.cpuCrit),
            helpers.sevForPct(memPct, th.memWarn, th.memCrit),
          ])
        : (cpuPct >= th.cpuCrit || memPct >= th.memCrit ? 'crit'
           : (cpuPct >= th.cpuWarn || memPct >= th.memWarn ? 'warn' : 'ok'));
      const statusLabel = worst === 'crit' ? t('transit_via_crit')
                        : worst === 'warn' ? t('transit_via_warn')
                                            : t('transit_via_ok');
      rows.push({
        ab,
        name: `${helpers.esc(n.node)} · ${helpers.esc(t('transit_compute'))}`,
        statusKey: worst,
        statusLabel,
        load: Math.max(cpuPct, memPct) + '%',
      });
    });

    // One representative shared storage row, if any.
    const seen = new Set();
    Object.entries(state.storage || {}).forEach(([node, pools]) => {
      (pools || []).forEach((s) => {
        if (!s.shared) return;
        if (seen.has(s.storage)) return;
        seen.add(s.storage);
        const p = helpers.pct(s.used, s.total);
        const sev = helpers.sevForPct(p, th.storageWarn, th.storageCrit);
        const label = sev === 'crit' ? t('transit_via_crit')
                    : sev === 'warn' ? t('transit_via_warn')
                                       : t('transit_via_ok');
        rows.push({
          ab,
          name: `${helpers.esc(s.storage)} · ${helpers.esc(t('storage'))}`,
          statusKey: sev,
          statusLabel: label,
          load: p + '%',
        });
      });
    });

    // Recent failed tasks become "scheduled stop with disruption" rows.
    const cutoff = Math.floor(Date.now() / 1000) - 7200;
    const failed = [];
    Object.entries(state.tasks || {}).forEach(([node, tasks]) => {
      (tasks || []).forEach((tk) => {
        if (tk.status && tk.status !== 'OK' && tk.endtime && tk.endtime > cutoff) {
          failed.push({ node, type: tk.type || '?', endtime: tk.endtime });
        }
      });
    });
    failed.slice(0, 2).forEach((f) => {
      rows.push({
        ab: fmtHHMM(new Date(f.endtime * 1000)),
        name: `${helpers.esc(f.type)} · ${helpers.esc(f.node)}`,
        statusKey: 'crit',
        statusLabel: t('transit_via_crit'),
        load: '—',
      });
    });

    // A "scheduled stop" line at the planned trip end (theatrical).
    rows.push({
      ab: fmtHHMM(new Date(TRIP_END_MS)),
      name: `vzdump · ${helpers.esc(t('transit_via_planned'))}`,
      statusKey: 'planned',
      statusLabel: t('transit_via_planned'),
      load: '—',
    });

    return rows;
  }

  function statusClass(key) {
    if (key === 'crit')    return 'red';
    if (key === 'warn')    return 'yel';
    if (key === 'ok')      return 'ok';
    return 'gray';
  }

  function buildAnschluss(state, helpers) {
    const t = helpers.t;
    const items = [];
    (state.resources || []).forEach((r) => {
      if (r.type !== 'qemu' && r.type !== 'lxc') return;
      const isVm = r.type === 'qemu';
      const running = r.status === 'running';
      items.push({
        chip: isVm ? 'IC' : 'RE',
        chipClass: isVm ? 'ic' : 're',
        name: r.name || (isVm ? `vm-${r.vmid}` : `ct-${r.vmid}`),
        node: r.node || '',
        running,
      });
    });
    items.sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });

    const total = items.length;
    return { items, total };
  }

  function tickerText(state, helpers) {
    const alerts = (helpers.computeAlerts() || []).map((a) => a.msg);
    if (alerts.length === 0) return helpers.t('transit_no_notices');
    return alerts.join(' · ');
  }

  function render(state, helpers) {
    const host = document.getElementById('theme-host');
    if (!host) return;
    const t = helpers.t;
    const esc = helpers.esc;
    const now = new Date();

    const cls = classifyCluster(state, helpers);
    const sev = cls.sev;
    const delayLabel = (sev === 'ok' ? '+0' : `+${cls.delayMin}`);
    const delayClass = sev === 'ok' ? 'ok' : (sev === 'warn' ? 'warn' : 'crit');

    const labelKey = sev === 'crit' ? 'transit_label_crit'
                   : sev === 'warn' ? 'transit_label_warn'
                                     : 'transit_label_ok';
    const destKey  = sev === 'crit' ? 'transit_status_crit'
                   : sev === 'warn' ? 'transit_status_warn'
                                     : 'transit_status_ok';

    const onlineNodes = (state.nodes || []).filter((n) => n.status === 'online').length;
    const totalNodes  = (state.nodes || []).length;

    const via = buildVia(state, helpers, now);
    const viaHtml = via.map((r) =>
      `<span class="t" data-via-ab>${esc(r.ab)}</span>`
      + `<span class="s">${r.name}</span>`
      + `<span class="${statusClass(r.statusKey)}">${esc(r.statusLabel)}</span>`
      + `<span class="pct">${esc(r.load)}</span>`
    ).join('');

    const ans = buildAnschluss(state, helpers);
    const ansRowsHtml = ans.items.length === 0
      ? `<div class="row empty"><span class="nm">${esc(t('empty'))}</span></div>`
      : ans.items.map((g) => {
          const dst = g.running
            ? `<span class="dst">→ ${esc(g.node)}</span>`
            : `<span class="dst">${esc(t('transit_parked'))}</span>`;
          return `<div class="row${g.running ? '' : ' parked'}">`
               + `<span class="nm"><span class="chip ${g.chipClass}">${g.chip}</span>${esc(g.name)}</span>`
               + dst
               + `</div>`;
        }).join('');

    const trainNumber = `PVE ${TRIP_START_MS.toString().slice(-4)}`;
    const clusterName = (state.hostInfo && state.hostInfo.cluster) || 'vitals.lan';
    const tripWindow  = `${fmtHHMM(new Date(TRIP_START_MS))} → ${fmtHHMM(new Date(TRIP_END_MS))}`;

    const ticker = tickerText(state, helpers);

    host.innerHTML = `
      <div class="db-inner" data-sev="${sev}">
        <div class="db-logo">DB</div>
        <div class="db-zugnr">
          <span><span class="ic">IC</span>${esc(trainNumber)} → ${esc(clusterName)}</span>
          <span data-trip-window>${esc(tripWindow)}</span>
        </div>
        <div class="db-plate">${esc(t('transit_status_plate'))}</div>

        <div class="db-main${sev === 'crit' ? ' is-crit' : ''}">
          <div class="db-zeit">
            <span class="clock" data-clock>${esc(fmtHHMM(now))}</span>
            <span class="delay ${delayClass}" data-delay>${esc(delayLabel)}</span>
            <span class="label">${esc(t(labelKey))}</span>
          </div>
          <div class="db-dest ${sev}">${esc(t(destKey))}</div>
          <div class="db-via">
            <span class="head">${esc(t('transit_via_head_ab'))}</span>
            <span class="head">${esc(t('transit_via_head_ueber'))}</span>
            <span class="head">${esc(t('transit_via_head_status'))}</span>
            <span class="head">${esc(t('transit_via_head_last'))}</span>
            ${viaHtml}
          </div>
        </div>

        <div class="db-gleis">
          <div class="lbl">${esc(t('transit_platform'))}</div>
          <div class="num" data-gleis>${onlineNodes}${totalNodes && totalNodes !== onlineNodes ? `<span style="font-size:.4em;opacity:.5">/${totalNodes}</span>` : ''}</div>
          <div class="sub">${esc(t('transit_platform_sub'))}</div>
        </div>

        <div class="db-anschluss">
          <span class="head">${esc(t('transit_anschluesse'))} (${ans.total})</span>
          ${ansRowsHtml}
        </div>

        <div class="db-ticker">
          <b>${esc(t('transit_notice'))}</b>
          <span class="scroll-wrap"><span class="scroll">${esc(ticker)}</span></span>
        </div>
      </div>
    `;
  }

  function tick(state, helpers) {
    const host = document.getElementById('theme-host');
    if (!host) return;
    const clockEl = host.querySelector('[data-clock]');
    if (!clockEl) return; // not yet rendered
    const now = new Date();
    const hhmm = fmtHHMM(now);
    if (clockEl.textContent !== hhmm) clockEl.textContent = hhmm;
    // Update the via "ab" cells to reflect "now" (theatrical, but consistent).
    const abEls = host.querySelectorAll('[data-via-ab]');
    abEls.forEach((el, idx) => {
      // Don't touch the planned-stop row (last) or task rows that show fixed times.
      // Heuristic: only refresh rows that originally matched the current minute.
      if (el.dataset.fixed === '1') return;
      // If the ab cell is the last one (scheduled stop), leave it alone.
      if (idx === abEls.length - 1) return;
      // Skip rows whose original time differs by more than 2 minutes from now
      // (those are failed-task rows tied to a real endtime).
      const cur = el.textContent;
      if (!/^\d{2}:\d{2}$/.test(cur)) return;
      const [h, m] = cur.split(':').map(Number);
      const diff = Math.abs((now.getHours() * 60 + now.getMinutes()) - (h * 60 + m));
      if (diff > 2) { el.dataset.fixed = '1'; return; }
      if (cur !== hhmm) el.textContent = hhmm;
    });
  }

  window.PVE_THEMES = window.PVE_THEMES || {};
  window.PVE_THEMES.transit = { render, tick };
})();
