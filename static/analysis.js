/**
 * Draft Value Analysis panel: category impact, draft board with tiers, position scarcity.
 * Depends on valuation.js and the DDState hook exposed by main.js.
 */
(function () {
    const V = window.DDValuation;
    const STORAGE_KEY = 'dd-analysis-settings';
    const POINT_IDS = ['hits', 'runs', 'rbi', 'steals', 'hr', 'wins', 'runs_scored', 'strikeouts', 'walks', 'saves'];
    const SLOT_LABELS = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', OF: 'OF', UTIL: 'UTIL', SP: 'SP', RP: 'RP', P: 'P (any)' };

    const settingsEl = document.getElementById('analysis-settings');
    const outputEl = document.getElementById('analysis-output');
    if (!V || !settingsEl || !outputEl) return;

    let activeTab = 'categories';
    let boardPos = 'all';
    let boardLimit = 60;
    let settings = loadSettings();
    let result = null;
    let timer = null;

    function loadSettings() {
        const base = JSON.parse(JSON.stringify(V.DEFAULT_SETTINGS));
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (saved.format) base.format = saved.format;
            if (saved.teams) base.teams = saved.teams;
            if (saved.slots) Object.assign(base.slots, saved.slots);
            if (saved.selected) Object.assign(base.selected, saved.selected);
            if (saved.catWeights) base.catWeights = saved.catWeights;
        } catch (e) { /* ignore corrupt storage */ }
        return base;
    }

    function saveSettings() {
        const { format, teams, slots, selected, catWeights } = settings;
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ format, teams, slots, selected, catWeights }));
    }

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v, d = 1) => (v === null || v === undefined || isNaN(v) ? '—' : Number(v).toFixed(d));
    const pct = v => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');

    function renderSettings() {
        const slotInputs = Object.keys(SLOT_LABELS).map(k =>
            `<label>${SLOT_LABELS[k]} <input type="number" min="0" max="10" data-slot="${k}" value="${settings.slots[k]}"></label>`).join('');

        let catHtml = '';
        if (settings.format !== 'points') {
            const group = (g, title) => `<div class="cat-group"><strong>${title}</strong>` +
                Object.keys(V.CATS[g]).filter(k => V.CATS[g][k].pointKey !== 'runs_scored').map(k => {
                    const on = settings.selected[g].includes(k);
                    const w = settings.catWeights[k] ?? 1;
                    const weight = settings.format === 'h2h'
                        ? `<input type="number" step="0.25" min="0" class="cat-weight" data-weight="${k}" value="${w}" title="Weight (0 = punt)">` : '';
                    return `<label class="cat-opt"><input type="checkbox" data-cat="${g}:${k}" ${on ? 'checked' : ''}> ${esc(V.CATS[g][k].label)}</label>${weight}`;
                }).join('') + '</div>';
            catHtml = `<div class="cat-picker">${group('bat', 'Batting categories')}${group('pit', 'Pitching categories')}</div>`;
        } else {
            catHtml = '<p class="analysis-note">Points format uses the Scoring Weights above.</p>';
        }

        settingsEl.innerHTML = `
            <div class="settings-row">
                <label>Format
                    <select id="analysis-format">
                        <option value="roto">Roto</option>
                        <option value="h2h">Head-to-head categories</option>
                        <option value="points">Points</option>
                    </select>
                </label>
                <label>Teams <input type="number" id="analysis-teams" min="2" max="30" value="${settings.teams}"></label>
                <span class="slot-inputs"><span class="slot-title">Starters per team:</span> ${slotInputs}</span>
            </div>
            ${catHtml}`;
        settingsEl.querySelector('#analysis-format').value = settings.format;
    }

    settingsEl.addEventListener('change', e => {
        const t = e.target;
        if (t.id === 'analysis-format') {
            settings.format = t.value;
            renderSettings();
        } else if (t.id === 'analysis-teams') {
            settings.teams = Math.max(2, parseInt(t.value, 10) || 12);
        } else if (t.dataset.slot) {
            settings.slots[t.dataset.slot] = Math.max(0, parseInt(t.value, 10) || 0);
        } else if (t.dataset.cat) {
            const [g, k] = t.dataset.cat.split(':');
            const set = new Set(settings.selected[g]);
            t.checked ? set.add(k) : set.delete(k);
            settings.selected[g] = Array.from(set);
        } else if (t.dataset.weight) {
            settings.catWeights[t.dataset.weight] = parseFloat(t.value) || 0;
        } else {
            return;
        }
        saveSettings();
        recompute();
    });

    document.querySelectorAll('.analysis-tab').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.analysis-tab').forEach(b => b.classList.toggle('active', b === btn));
        activeTab = btn.dataset.tab;
        render();
    }));

    outputEl.addEventListener('change', e => {
        if (e.target.id === 'board-pos') { boardPos = e.target.value; boardLimit = 60; render(); }
    });
    outputEl.addEventListener('click', e => {
        if (e.target.id === 'board-more') { boardLimit += 60; render(); }
    });

    function pointWeights() {
        const w = {};
        POINT_IDS.forEach(id => {
            const el = document.getElementById(id);
            w[id] = el ? parseFloat(el.value) || 0 : 0;
        });
        return w;
    }

    function recompute() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const state = window.DDState;
            if (!state || !state.players.length) {
                outputEl.textContent = 'Waiting for player data...';
                return;
            }
            settings.pointWeights = pointWeights();
            result = V.analyze(state.players, state.year, settings);
            render();
        }, 50);
    }

    function render() {
        if (!result) return;
        if (!result.rows.length) {
            outputEl.innerHTML = '<p>No players with enough playing time in this season. Try another stats year.</p>';
            return;
        }
        if (activeTab === 'categories') outputEl.innerHTML = renderCategories();
        else if (activeTab === 'board') outputEl.innerHTML = renderBoard();
        else outputEl.innerHTML = renderPositions();
    }

    function categoryTable(title, cats) {
        if (!cats.length) return '';
        const rows = cats.map(c => `
            <tr class="${c.inLeague ? '' : 'dim'}">
                <td>${esc(c.label)}${c.inLeague ? '' : ' <small>(not in league)</small>'}</td>
                <td>${c.rate ? fmt(c.mean, 3) : fmt(c.mean, 1)}</td>
                <td>${c.rate ? fmt(c.sd, 3) : fmt(c.sd, 1)}</td>
                <td>${c.cv === null ? '—' : fmt(c.cv, 2)}</td>
                <td>${fmt(c.topGap, 1)}</td>
                <td>${pct(c.concentration)}</td>
                <td>${c.driver === null ? '—' : fmt(c.driver, 2)}</td>
                <td><span class="badge badge-${c.label2.toLowerCase()}">${c.label2}</span></td>
            </tr>`).join('');
        return `<h3>${title}</h3>
            <div class="analysis-scroll"><table class="analysis-table">
            <thead><tr>
                <th>Category</th><th title="Average among drafted players">Pool avg</th><th>Std dev</th>
                <th title="Std dev / average. High = production concentrated in a few players">Spread (CV)</th>
                <th title="How far the 12th-best player sits above the median, in std devs">Top-12 edge (σ)</th>
                <th title="Share of the category total produced by the top 20% of drafted players">Top-20% share</th>
                <th title="Correlation between this category and overall player value">Drives value (r)</th>
                <th>Tier</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    function correlationTable(title, corr) {
        if (!corr || corr.keys.length < 2) return '';
        const head = corr.keys.map(k => `<th>${esc(k)}</th>`).join('');
        const body = corr.keys.map((k, i) => `<tr><th>${esc(k)}</th>${corr.matrix[i].map((v, j) => {
            const a = i === j ? 0 : Math.min(1, Math.abs(v));
            const bg = i === j ? '#f3f4f6' : `rgba(${v > 0 ? '27,87,196' : '200,60,60'},${(a * 0.45).toFixed(2)})`;
            return `<td style="background:${bg}">${i === j ? '' : fmt(v, 2)}</td>`;
        }).join('')}</tr>`).join('');
        return `<h4>${title}</h4><div class="analysis-scroll"><table class="analysis-table corr"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }

    function takeaways() {
        const all = [...result.categories.bat.map(c => ({ ...c, g: 'Batting' })), ...result.categories.pit.map(c => ({ ...c, g: 'Pitching' }))];
        const counting = all.filter(c => !c.rate && c.cv !== null && c.inLeague);
        const lines = [];
        const scarce = counting.filter(c => c.label2 === 'Scarce').map(c => c.label);
        const deep = counting.filter(c => c.label2 === 'Deep').map(c => c.label);
        if (scarce.length) lines.push(`<li><strong>Scarce:</strong> ${scarce.join(', ')} — production is concentrated in a few players, so the specialists are worth taking earlier or punting on purpose.</li>`);
        if (deep.length) lines.push(`<li><strong>Deep:</strong> ${deep.join(', ')} — plentiful across the pool, so you can usually fill these later.</li>`);
        const drivers = all.filter(c => c.driver !== null).sort((a, b) => b.driver - a.driver).slice(0, 3);
        if (drivers.length) lines.push(`<li><strong>Biggest drivers of player value:</strong> ${drivers.map(c => `${c.label} (r=${fmt(c.driver, 2)})`).join(', ')}.</li>`);
        const batCorr = result.correlations.bat;
        if (batCorr && batCorr.keys.length > 1) {
            let best = { v: 0 };
            batCorr.matrix.forEach((row, i) => row.forEach((v, j) => { if (j > i && v > best.v) best = { v, a: batCorr.keys[i], b: batCorr.keys[j] }; }));
            if (best.v > 0.6) lines.push(`<li><strong>Overlap:</strong> ${best.a} and ${best.b} move together (r=${fmt(best.v, 2)}), so drafting for one largely gets you the other.</li>`);
        }
        return lines.length ? `<ul class="takeaways">${lines.join('')}</ul>` : '';
    }

    function renderCategories() {
        const s = result.settings;
        const fmtName = { roto: 'Roto', h2h: 'Head-to-head categories', points: 'Points' }[s.format];
        return `<p class="analysis-note">${fmtName} · ${s.teams} teams · ${result.meta.drafted} drafted players analysed out of ${result.meta.candidates} with enough playing time. "Pool" means players who would be drafted at these settings.</p>
            ${takeaways()}
            ${categoryTable('Batting', result.categories.bat)}
            ${categoryTable('Pitching', result.categories.pit)}
            ${s.format === 'points' ? '' : correlationTable('Batting category overlap', result.correlations.bat)}
            ${s.format === 'points' ? '' : correlationTable('Pitching category overlap', result.correlations.pit)}`;
    }

    function renderBoard() {
        const s = result.settings;
        let list = result.board;
        if (boardPos !== 'all') {
            const slot = boardPos === 'DH' ? 'UTIL' : boardPos;
            list = list.filter(r => r.elig.includes(slot));
        }
        const shown = list.slice(0, boardLimit);
        const zCols = s.format === 'points' ? [] : [
            ...result.categories.bat.filter(c => c.inLeague).map(c => ({ ...c, g: 'bat' })),
            ...result.categories.pit.filter(c => c.inLeague).map(c => ({ ...c, g: 'pit' }))
        ];
        const posOptions = ['all', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP', 'P'].map(p =>
            `<option value="${p}" ${p === boardPos ? 'selected' : ''}>${p === 'all' ? 'All positions' : p}</option>`).join('');
        const head = zCols.map(c => `<th title="Category z-score">${esc(c.label)}</th>`).join('');
        let lastTier = null;
        const body = shown.map(r => {
            const tierBreak = r.tier !== lastTier && boardPos === 'all';
            lastTier = r.tier;
            const zs = zCols.map(c => {
                const v = (c.g === 'pit') === r.isPitcher ? r.z[c.key] : null;
                if (v === null || v === undefined) return '<td class="muted">·</td>';
                const cls = v >= 1 ? 'zhi' : v <= -1 ? 'zlo' : '';
                return `<td class="${cls}">${fmt(v, 1)}</td>`;
            }).join('');
            return `<tr class="${tierBreak ? 'tier-start' : ''}">
                <td>${r.rank}</td>
                <td><span class="tier-pill tier-${Math.min(r.tier, 10)}">T${r.tier}</span></td>
                <td><a href="#" class="player-name-link" data-player-id="${esc(r.id)}">${esc(r.name)}</a></td>
                <td>${esc(r.team)}</td><td title="Value counted at ${esc(r.pos)}">${esc(r.position || r.pos)}</td>
                <td><strong>${fmt(r.vorp, 1)}</strong></td>
                <td>${r.posTier ? 'P' + r.posTier : ''}</td>${zs}</tr>`;
        }).join('');
        return `<div class="board-controls"><label>Position <select id="board-pos">${posOptions}</select></label>
            <span class="analysis-note">Value = ${s.format === 'points' ? 'points' : 'summed category z-scores'} above a replacement-level player at the position. Tiers (T) split where value drops sharply; P-tiers are within a position.</span></div>
            <div class="analysis-scroll"><table class="analysis-table board">
            <thead><tr><th>#</th><th>Tier</th><th>Player</th><th>Team</th><th>Pos</th><th>Value</th><th>Pos tier</th>${head}</tr></thead>
            <tbody>${body}</tbody></table></div>
            ${list.length > shown.length ? `<button id="board-more" class="analysis-more">Show more (${list.length - shown.length} left)</button>` : ''}`;
    }

    function renderPositions() {
        const rows = result.positions.map(p => `
            <tr><td><strong>${p.pos}</strong></td><td>${p.starters}</td>
            <td>${fmt(p.best, 1)}</td><td>${fmt(p.topN, 1)}</td><td>${fmt(p.lastStarter, 1)}</td>
            <td><strong>${fmt(p.spread, 1)}</strong></td></tr>`).join('');
        return `<p class="analysis-note">Positions are sorted by how much value separates the best player from the last starter. A big gap means a position where landing an elite player pays off; a small gap means you can wait.</p>
            <div class="analysis-scroll"><table class="analysis-table">
            <thead><tr><th>Position</th><th>League starters</th><th>Best</th><th title="Average of the top N players, N = number of teams">Avg top ${result.settings.teams}</th><th>Last starter</th><th>Best − last starter</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
    }

    renderSettings();
    document.addEventListener('dd:players-updated', recompute);
    if (window.DDState && window.DDState.players.length) recompute();
})();
