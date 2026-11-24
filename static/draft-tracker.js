/**
 * Live Draft tab of the Draft Analysis panel: record picks as they happen and see who is
 * left, your roster, your category strength, and (auctions) the money left and inflation.
 * The math is in draft.js; analysis.js calls render() with the current analysis and sends
 * the tab's clicks here through init(). Picks are kept in this browser (localStorage).
 */
(function () {
    const D = window.DDDraft;
    const V = window.DDValuation;
    if (!D || !V) return;

    const STORAGE_KEY = 'dd-draft';
    let state = load();          // { picks: [{id, name, mine, price}], slot }
    const view = { search: '', pos: 'all', fitsOnly: false, limit: 40, confirmReset: false, marketOpen: true };
    let ctx = null;              // last render's context from analysis.js
    let host = null;

    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved && Array.isArray(saved.picks)) return { picks: saved.picks, slot: saved.slot || null };
        } catch (e) { /* ignore corrupt storage */ }
        return { picks: [], slot: null };
    }
    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    }

    const pickOf = id => state.picks.find(p => String(p.id) === String(id)) || null;

    // ---- derived state for one render ----
    function derive(c) {
        const { result } = c;
        const s = result.settings;
        const byId = new Map(result.rows.map(r => [String(r.id), r]));
        const picked = new Set(state.picks.map(p => String(p.id)));
        const auction = s.draftType === 'auction' && result.auction;
        const starters = Object.values(s.slots).reduce((a, b) => a + (b || 0), 0);
        const mineRows = state.picks.filter(p => p.mine).map(p => byId.get(String(p.id))).filter(Boolean);
        const roster = D.fillRoster(mineRows, s.slots);
        const infl = auction ? D.inflation(result.board, state.picks, byId, s) : null;
        const money = auction ? D.myBudget(state.picks, byId, s, starters) : null;
        const next = !auction && state.slot ? D.nextPick(state.slot, s.teams, state.picks.length) : null;
        return { s, byId, picked, auction, starters, mineRows, roster, infl, money, next };
    }

    // ---- rendering ----
    function render(c) {
        ctx = c;
        const d = derive(c);
        return `<div class="dt">
            ${statusBar(d)}
            ${d.auction ? marketSection(d) : ''}
            <div class="dt-layout">
                <div class="dt-main">
                    ${leftSummary(d)}
                    <div class="dt-filters">
                        <input type="search" id="dt-search" placeholder="Find any player to record a pick..." value="${c.esc(view.search)}" aria-label="Search players to record a pick">
                        <label>Position <select id="dt-pos">${['all', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP'].map(p =>
                            `<option value="${p}"${p === view.pos ? ' selected' : ''}>${p === 'all' ? 'All' : p}</option>`).join('')}</select></label>
                        <label class="dt-check"><input type="checkbox" id="dt-fits"${view.fitsOnly ? ' checked' : ''}> Only players who fill my open spots</label>
                    </div>
                    <div id="dt-available">${availableTable(d)}</div>
                </div>
                <aside class="dt-side">
                    ${rosterCard(d)}
                    ${strengthCard(d)}
                    ${picksCard(d)}
                </aside>
            </div>
        </div>`;
    }

    function statusBar(d) {
        const made = state.picks.length;
        const resetBtn = view.confirmReset
            ? '<button type="button" class="dt-btn danger" data-dt="reset-yes">Yes, clear all picks</button> <button type="button" class="dt-btn" data-dt="reset-no">Keep them</button>'
            : `<button type="button" class="dt-btn" data-dt="reset"${made ? '' : ' disabled'}>Reset draft</button>`;
        const actions = `<span class="dt-actions"><button type="button" class="dt-btn" data-dt="undo"${made ? '' : ' disabled'}>Undo last pick</button> ${resetBtn}</span>`;
        if (d.auction) {
            const pct = Math.round((d.infl.factor - 1) * 100);
            const inflText = made ? `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%` : '—';
            return `<div class="dt-status">
                <div><span class="dt-label">League money left</span><strong>$${Math.round(d.infl.left)}</strong> <span class="muted">of $${d.infl.total}, ${d.infl.spotsLeft} spots to fill</span></div>
                <div title="How far remaining prices sit above (+) or below (−) pre-draft values, given the money and spots left"><span class="dt-label">Inflation</span><strong class="${pct > 0 ? 'zlo' : pct < 0 ? 'zhi' : ''}">${inflText}</strong></div>
                <div><span class="dt-label">Your budget</span><strong>$${Math.round(d.money.left)}</strong> <span class="muted">${d.money.open} spots open · max bid $${Math.round(d.money.maxBid)}</span></div>
                ${actions}
            </div>`;
        }
        const pickNo = made + 1;
        const round = Math.ceil(pickNo / d.s.teams);
        const slotInput = `<label class="dt-slot">Your draft slot <input type="number" id="dt-slot" min="1" max="${d.s.teams}" value="${state.slot || ''}" placeholder="1-${d.s.teams}"></label>`;
        let nextText = '<span class="muted">Set your slot to see when you pick</span>';
        if (d.next) {
            nextText = d.next.away === 0
                ? '<strong class="dt-onclock">You\'re on the clock</strong>'
                : `<strong>#${d.next.pick}</strong> <span class="muted">round ${d.next.round}, ${d.next.away} pick${d.next.away === 1 ? '' : 's'} away</span>`;
        }
        return `<div class="dt-status">
            <div><span class="dt-label">On the clock</span><strong>Pick ${pickNo}</strong> <span class="muted">round ${round}</span></div>
            <div>${slotInput}</div>
            <div><span class="dt-label">Your next pick</span>${nextText}</div>
            ${actions}
        </div>`;
    }

    // Auction inflation by position and by category (draft.js marketByPosition / marketByCategory)
    function marketSection(d) {
        const { result, esc, fmt } = ctx;
        const money = v => '$' + Math.round(v);
        const prem = v => {
            if (v === null || v === undefined) return '<span class="muted">—</span>';
            const pct = Math.round(v * 100);
            const cls = pct >= 10 ? 'hot' : pct <= -10 ? 'cold' : '';
            return `<span class="dt-prem ${cls}">${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%</span>`;
        };
        const perUnit = v => (v === null || v === undefined ? '<span class="muted">—</span>' : `$${v < 10 ? v.toFixed(2) : fmt(v, 1)}`);

        const positions = D.marketByPosition(state.picks, d.byId, result.board, d.infl).map(m => `
            <tr><td><strong>${esc(m.pos === '?' ? 'Other' : m.pos)}</strong></td>
                <td>${m.bought || '<span class="muted">0</span>'}</td>
                <td>${m.bought ? `${money(m.paid)} <span class="muted">/ ${money(m.value)}</span>` : '<span class="muted">—</span>'}</td>
                <td>${prem(m.premium)}</td>
                <td>${m.left}</td>
                <td>${m.left ? money(m.leftPrice) : '<span class="muted">—</span>'}</td></tr>`).join('');
        const posTable = `<div><h4>By position</h4><table class="dt-market">
            <thead><tr><th>Pos</th><th>Bought</th><th title="Prices paid / the same players' pre-draft values">Paid / value</th><th title="How far prices ran over (+) or under (−) value">Premium</th><th title="Players left on the board here">Left</th><th title="What the players left here cost at current prices">$ left now</th></tr></thead>
            <tbody>${positions}</tbody></table></div>`;

        let catTable = '';
        if (d.s.format !== 'points') {
            const cats = [
                ...result.categories.bat.filter(c => c.inLeague).map(c => ({ key: c.key, label: c.label, g: 'bat' })),
                ...result.categories.pit.filter(c => c.inLeague).map(c => ({ key: c.key, label: c.label, g: 'pit' }))
            ].map(c => ({ ...c, weight: d.s.format === 'h2h' ? (d.s.catWeights[c.key] ?? 1) : 1 }));
            const rows = D.marketByCategory(state.picks, d.byId, result.board, cats, V.CATS).map(m => `
                <tr><td><strong>${esc(m.label)}</strong> <span class="muted">${m.g === 'pit' ? 'P' : 'H'}</span></td>
                    <td>${m.paid ? `${money(m.paid)} <span class="muted">/ ${money(m.value)}</span>` : '<span class="muted">—</span>'}</td>
                    <td>${prem(m.premium)}</td>
                    <td>${perUnit(m.perUnitPaid)}</td>
                    <td>${m.leftShare === null ? '<span class="muted">—</span>' : `<span class="dt-share"><span style="width:${Math.round(m.leftShare * 100)}%"></span></span>${Math.round(m.leftShare * 100)}%`}</td></tr>`).join('');
            catTable = `<div><h4>By category</h4><table class="dt-market">
                <thead><tr><th>Cat</th><th title="Dollars put into this category so far / their pre-draft value">Paid / value</th><th>Premium</th><th title="Dollars paid per unit (per HR, per SB...) so far">$/unit paid</th><th title="Share of the category's projected total still on the board. One running out faster than the rest is getting scarce.">Still available</th></tr></thead>
                <tbody>${rows}</tbody></table></div>`;
        }
        return `<details class="dt-market-wrap"${view.marketOpen ? ' open' : ''} data-dt-market>
            <summary>Inflation breakdown <span class="muted">by position${catTable ? ' and category' : ''}</span></summary>
            ${state.picks.length ? '' : '<p class="analysis-note">Record a few purchases to see where the room is overpaying.</p>'}
            <p class="analysis-note">Premium compares prices paid with pre-draft values: + means the room is paying up there, − means bargains. ${catTable ? 'Each price is split across the categories a player helps, by his z-score in each. Still available is the share of each category\'s projected total left on the board; one running out faster than the rest is getting scarce.' : ''}</p>
            <div class="dt-market-grid">${posTable}${catTable}</div>
        </details>`;
    }

    // Tiers and positions still available, from the draft board
    function leftSummary(d) {
        const avail = ctx.result.board.filter(r => !d.picked.has(String(r.id)));
        const tierCounts = {};
        const tierTotals = {};
        ctx.result.board.forEach(r => { tierTotals[r.tier] = (tierTotals[r.tier] || 0) + 1; });
        avail.forEach(r => { tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1; });
        const tiers = Object.keys(tierTotals).map(Number).sort((a, b) => a - b)
            .filter(t => tierCounts[t]).slice(0, 6)
            .map(t => `<span class="dt-chip"><span class="tier-pill tier-${Math.min(t, 10)}">T${t}</span> ${tierCounts[t]} of ${tierTotals[t]}</span>`).join('');
        let positions;
        if (ctx.posTiers) {
            // Each position's best tier still available, and how many are left in it
            positions = Object.keys(ctx.posTiers.tiered).map(pos => {
                const entries = ctx.posTiers.tiered[pos].entries.filter(e => !d.picked.has(String(e.row.id)));
                if (!entries.length) return '';
                const tier = entries[0].tier;
                const left = entries.filter(e => e.tier === tier).length;
                return `<span class="dt-chip${left === 1 ? ' dt-last' : ''}" title="${pos}: ${left} left in tier ${tier}">${pos} <span class="tier-pill tier-${Math.min(tier, 10)}">T${tier}</span> <strong>${left}</strong></span>`;
            }).join('');
        } else {
            const posCounts = {};
            avail.forEach(r => { posCounts[r.pos] = (posCounts[r.pos] || 0) + 1; });
            positions = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'SP', 'RP', 'P'].filter(p => posCounts[p] !== undefined)
                .map(p => `<span class="dt-chip">${p} <strong>${posCounts[p]}</strong></span>`).join('');
        }
        return `<div class="dt-left">
            <div><span class="dt-label">Tiers left</span>${tiers || '<span class="muted">Board is empty</span>'}</div>
            <div title="${ctx.posTiers ? 'The best tier still available at each position, and how many players are left in it (Position Tiers tab)' : 'Players left on the draft board, by the position their value is counted at'}"><span class="dt-label">${ctx.posTiers ? 'Position tiers' : 'Left by position'}</span>${positions}</div>
        </div>`;
    }

    function availableList(d) {
        const q = view.search.trim().toLowerCase();
        let list;
        if (q) {
            // Search everyone with stats, so picks of players off the board can be recorded too
            list = ctx.result.rows.filter(r => !d.picked.has(String(r.id))
                && (String(r.name).toLowerCase().includes(q) || String(r.team || '').toLowerCase().includes(q)))
                .sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9) || b.vorp - a.vorp);
        } else {
            list = ctx.result.board.filter(r => !d.picked.has(String(r.id)));
        }
        if (view.pos !== 'all') {
            const slot = view.pos === 'DH' ? 'UTIL' : view.pos;
            list = list.filter(r => r.elig.includes(slot));
        }
        if (view.fitsOnly) list = list.filter(r => D.fitsOpen(r, d.roster.open));
        if (d.auction) list = [...list].sort((a, b) => (b.dollars || 0) - (a.dollars || 0) || (a.rank || 1e9) - (b.rank || 1e9));
        return list;
    }

    // "last in tier" when nobody else is left in this player's tier at his position
    function lastInTier(r, d) {
        const pt = ctx.posTiers;
        if (!pt) return '';
        const key = pt.keyOf(r);
        const t = pt.tiered[key];
        const tier = (pt.index[String(r.id)] || {})[key];
        if (!t || !tier) return '';
        const left = t.entries.filter(e => e.tier === tier && !d.picked.has(String(e.row.id))).length;
        return left === 1 ? ` <span class="dt-flag last" title="The last ${key} left in tier ${tier}: the next one is a step down">last ${key} in T${tier}</span>` : '';
    }

    function availableTable(d) {
        const { esc, fmt, adpOf } = ctx;
        const list = availableList(d);
        const shown = list.slice(0, view.limit);
        const hasAdp = ctx.hasAdp;
        const rows = shown.map(r => {
            const a = hasAdp ? adpOf(r) : null;
            let adpCell = '';
            if (hasAdp) {
                let flag = '';
                if (a && d.next && d.next.away > 0) {
                    flag = a.adp < d.next.pick
                        ? ' <span class="dt-flag gone" title="ADP is before your next pick: usually taken by then">likely gone</span>'
                        : '';
                }
                adpCell = `<td>${a ? fmt(a.adp, 1) : '<span class="muted">—</span>'}${flag}</td>`;
            }
            const valueCells = d.auction
                ? `<td title="Pre-draft value $${r.dollars ? Math.round(r.dollars) : 1}"><strong>${r.dollars ? '$' + Math.round(d.infl.price(r)) : '<span class="muted">$1</span>'}</strong></td>`
                : `<td><strong>${fmt(r.vorp, 1)}</strong></td>`;
            const price = d.auction
                ? `<input type="number" class="dt-price" min="0" max="${d.s.budget}" placeholder="${r.dollars ? Math.round(d.infl.price(r)) : 1}" aria-label="Price paid for ${esc(r.name)}">`
                : '';
            return `<tr data-id="${esc(r.id)}">
                <td>${r.rank || '<span class="muted" title="Not on the draft board at these settings">—</span>'}</td>
                <td>${r.tier ? `<span class="tier-pill tier-${Math.min(r.tier, 10)}">T${r.tier}</span>` : ''}</td>
                <td><a href="#" class="player-name-link" data-player-id="${esc(r.id)}">${esc(r.name)}</a>${lastInTier(r, d)}</td>
                <td>${esc(r.position || r.pos)}</td>
                ${valueCells}${adpCell}
                <td class="dt-row-actions">${price}<button type="button" class="dt-btn mine" data-dt="mine">Mine</button><button type="button" class="dt-btn" data-dt="taken" title="Drafted by another team">Taken</button></td>
            </tr>`;
        }).join('');
        const empty = view.search ? 'No undrafted player matches that search.' : 'No players left on the board with these filters.';
        return `<div class="analysis-scroll"><table class="analysis-table board dt-table">
            <thead><tr><th>#</th><th>Tier</th><th>Player</th><th>Pos</th><th>${d.auction ? '$ now' : 'Value'}</th>${hasAdp ? '<th>ADP</th>' : ''}<th>${d.auction ? 'Price · record pick' : 'Record pick'}</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="7" class="muted">${empty}</td></tr>`}</tbody></table></div>
            ${list.length > shown.length ? `<button type="button" class="analysis-more" data-dt="more">Show more (${list.length - shown.length} left)</button>` : ''}`;
    }

    function rosterCard(d) {
        const { esc } = ctx;
        const priceOf = r => {
            const p = pickOf(r.id);
            return d.auction && p && p.price !== null && p.price !== undefined ? ` <span class="muted">$${p.price}</span>` : '';
        };
        const label = slot => (slot === 'UTIL' ? 'DH' : slot);
        const lines = d.roster.lineup.map(l => `<li class="${l.row ? '' : 'open'}"><span class="dt-slotname">${label(l.slot)}</span>${l.row
            ? `<a href="#" class="player-name-link" data-player-id="${esc(l.row.id)}">${esc(l.row.name)}</a>${priceOf(l.row)}` : '<span class="muted">open</span>'}</li>`).join('');
        const bench = d.roster.bench.map(r => `<li><span class="dt-slotname">BN</span><a href="#" class="player-name-link" data-player-id="${esc(r.id)}">${esc(r.name)}</a>${priceOf(r)}</li>`).join('');
        // Picks of players with no stats this season (not in the analysis) still belong to you
        const missing = state.picks.filter(p => p.mine && !d.byId.has(String(p.id)))
            .map(p => `<li><span class="dt-slotname">—</span>${esc(p.name || p.id)} <span class="muted">(no stats this season)</span></li>`).join('');
        return `<div class="dt-card"><h4>My team <small>${d.mineRows.length} of ${d.starters} starters</small></h4><ul class="dt-roster">${lines}${bench}${missing}</ul></div>`;
    }

    function strengthCard(d) {
        const { result, fmt } = ctx;
        if (!d.mineRows.length) return '<div class="dt-card"><h4>Category strength</h4><p class="muted">Draft a player to see how your team stacks up.</p></div>';
        if (d.s.format === 'points') {
            const pts = d.mineRows.reduce((a, r) => a + (Number(r.raw) || 0), 0);
            const avg = result.board.length ? result.board.reduce((a, r) => a + (Number(r.raw) || 0), 0) / result.board.length : 0;
            return `<div class="dt-card"><h4>Projected points</h4><p><strong>${fmt(pts, 0)}</strong> <span class="muted">from ${d.mineRows.length} players; an average drafted player scores ${fmt(avg, 0)}</span></p></div>`;
        }
        const cats = [
            ...result.categories.bat.filter(c => c.inLeague).map(c => ({ key: c.key, label: c.label, g: 'bat' })),
            ...result.categories.pit.filter(c => c.inLeague).map(c => ({ key: c.key, label: c.label, g: 'pit' }))
        ];
        const rows = D.teamCategories(d.mineRows, cats, V.CATS).map(c => {
            const width = Math.min(50, Math.abs(c.z) * 10);
            const bar = `<span class="dt-bar"><span class="${c.z >= 0 ? 'pos' : 'neg'}" style="width:${width}%;${c.z >= 0 ? 'left:50%' : `left:${50 - width}%`}"></span></span>`;
            const total = c.total === null ? '—' : c.rate ? fmt(c.total, c.key === 'avg' || c.key === 'obp' || c.key === 'slg' || c.key === 'ops' ? 3 : 2) : fmt(c.total, 0);
            return `<tr><td>${ctx.esc(c.label)}</td><td>${total}</td><td>${c.players ? bar : '<span class="muted">—</span>'}</td><td class="${c.z >= 1 ? 'zhi' : c.z <= -1 ? 'zlo' : ''}">${c.players ? (c.z > 0 ? '+' : '') + fmt(c.z, 1) : ''}</td></tr>`;
        }).join('');
        return `<div class="dt-card"><h4>Category strength</h4>
            <p class="analysis-note">Sum of your players' z-scores. 0 = an average team with the same number of players; build up the categories in red.</p>
            <table class="dt-strength"><thead><tr><th>Cat</th><th>Projected</th><th></th><th>Strength</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function picksCard(d) {
        const { esc } = ctx;
        if (!state.picks.length) return '<div class="dt-card"><h4>Picks</h4><p class="muted">No picks yet. Click Mine or Taken as players come off the board.</p></div>';
        const items = state.picks.map((p, i) => ({ p, i })).reverse().slice(0, 12).map(({ p, i }) =>
            `<li><span class="muted">#${i + 1}</span> ${esc(p.name || p.id)}${d.auction && p.price !== null && p.price !== undefined ? ` <span class="muted">$${p.price}</span>` : ''}
                ${p.mine ? '<span class="dt-flag mine">mine</span>' : ''}
                <button type="button" class="dt-x" data-dt="remove" data-index="${i}" aria-label="Remove pick ${i + 1}, ${esc(p.name || '')}">×</button></li>`).join('');
        return `<div class="dt-card"><h4>Picks <small>${state.picks.length} made, latest first</small></h4><ul class="dt-picks">${items}</ul></div>`;
    }

    // ---- events ----
    function rerender() { if (ctx) ctx.rerender(); }
    function refreshAvailable() {
        const el = host && host.querySelector('#dt-available');
        if (el && ctx) el.innerHTML = availableTable(derive(ctx));
    }

    function record(tr, mine) {
        const id = tr.dataset.id;
        if (!id || pickOf(id)) return;
        const r = ctx.result.rows.find(x => String(x.id) === id);
        let price = null;
        const input = tr.querySelector('.dt-price');
        if (input) {
            const typed = parseFloat(input.value);
            price = !isNaN(typed) ? Math.max(0, Math.round(typed)) : Math.round(parseFloat(input.placeholder) || 1);
        }
        state.picks.push({ id, name: r ? r.name : id, mine, price });
        view.confirmReset = false;
        view.search = '';  // after recording a searched-for player, show the board again
        save();
        rerender();
    }

    function init(outputEl) {
        host = outputEl;
        outputEl.addEventListener('click', e => {
            const btn = e.target.closest('[data-dt]');
            if (!btn || !outputEl.querySelector('.dt')) return;
            const act = btn.dataset.dt;
            if (act === 'mine' || act === 'taken') record(btn.closest('tr'), act === 'mine');
            else if (act === 'undo') { state.picks.pop(); save(); rerender(); }
            else if (act === 'remove') { state.picks.splice(Number(btn.dataset.index), 1); save(); rerender(); }
            else if (act === 'reset') { view.confirmReset = true; rerender(); }
            else if (act === 'reset-no') { view.confirmReset = false; rerender(); }
            else if (act === 'reset-yes') { state.picks = []; view.confirmReset = false; save(); rerender(); }
            else if (act === 'more') { view.limit += 40; refreshAvailable(); }
        });
        // Remember whether the inflation breakdown is open across re-renders
        outputEl.addEventListener('toggle', e => {
            if (e.target.matches && e.target.matches('[data-dt-market]')) view.marketOpen = e.target.open;
        }, true);
        outputEl.addEventListener('input', e => {
            if (e.target.id === 'dt-search') { view.search = e.target.value; view.limit = 40; refreshAvailable(); }
        });
        outputEl.addEventListener('change', e => {
            const t = e.target;
            if (t.id === 'dt-pos') { view.pos = t.value; view.limit = 40; refreshAvailable(); }
            else if (t.id === 'dt-fits') { view.fitsOnly = t.checked; view.limit = 40; refreshAvailable(); }
            else if (t.id === 'dt-slot') {
                const v = parseInt(t.value, 10);
                state.slot = v >= 1 ? v : null;
                save();
                rerender();
            }
        });
    }

    window.DDTracker = { render, init, pickOf, get picks() { return state.picks; } };
})();
