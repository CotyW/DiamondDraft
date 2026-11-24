/**
 * Position Tiers tab of the Draft Analysis panel: a tier sheet with one column per position.
 * Each position's tiers are adjustable: +/− sets how many automatic tiers it has, and the
 * player rows can be split ("start a new tier here") or tiers merged by hand. Changes are
 * kept in this browser. The tier math is in tiers.js; analysis.js calls compute() for the
 * Draft Board and Live Draft, render() for this tab, and sends clicks here through init().
 */
(function () {
    const T = window.DDTiers;
    if (!T) return;

    const STORAGE_KEY = 'dd-pos-tiers';
    let custom = load();   // { pos: {count} | {starts: [playerId]} }
    let cache = { result: null, version: -1, value: null };
    let version = 0;       // bumps on every change, so compute() knows to redo the tiers
    let ctx = null;
    const shown = {};      // pos -> rows shown, when "show more" was used

    function load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function save() {
        version++;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch (e) { /* storage blocked */ }
    }

    /** { tiered: {pos: applyTiers result}, index: {playerId: {pos: tier}}, keyOf(row) } */
    function compute(result) {
        if (cache.result === result && cache.version === version) return cache.value;
        const lists = T.positionLists(result);
        const tiered = {};
        T.POSITIONS.forEach(pos => { tiered[pos] = T.applyTiers(lists[pos], custom[pos]); });
        const value = { lists, tiered, index: T.tierIndex(tiered), keyOf };
        cache = { result, version, value };
        return value;
    }

    // The position a player's tier is shown at elsewhere: where his value counts; pitchers by role
    function keyOf(row) {
        if (row.isPitcher) return T.pitcherColumns(row)[0];
        return row.pos === 'DH' || !T.POSITIONS.includes(row.pos) ? 'DH' : row.pos;
    }

    function render(c) {
        ctx = c;
        const { result, esc, fmt } = c;
        const { tiered } = compute(result);
        const auction = result.settings.draftType === 'auction' && result.auction;
        const pickOf = id => (window.DDTracker ? window.DDTracker.pickOf(id) : null);
        const anyCustom = Object.keys(custom).length > 0;

        const columns = T.POSITIONS.filter(pos => tiered[pos].entries.length).map(pos => {
            const t = tiered[pos];
            const limit = shown[pos] || 30;
            const entries = t.entries.slice(0, limit);
            const tierSize = {}, tierLeft = {};
            t.entries.forEach(e => {
                tierSize[e.tier] = (tierSize[e.tier] || 0) + 1;
                if (!pickOf(e.row.id)) tierLeft[e.tier] = (tierLeft[e.tier] || 0) + 1;
            });
            let html = '';
            entries.forEach((e, i) => {
                if (i === 0 || e.tier !== entries[i - 1].tier) {
                    if (i > 0) html += '</div>';
                    const left = tierLeft[e.tier] || 0;
                    html += `<div class="pt-tier${left ? '' : ' empty'}">
                        <div class="pt-tier-head"><span class="tier-pill tier-${Math.min(e.tier, 10)}">T${e.tier}</span>
                            <span class="muted">${left} of ${tierSize[e.tier]} left</span>
                            ${e.tier > 1 ? `<button type="button" class="pt-merge" data-pt="merge" data-pos="${pos}" data-index="${i}" title="Merge into tier ${e.tier - 1}" aria-label="Merge ${pos} tier ${e.tier} into tier ${e.tier - 1}">×</button>` : ''}
                        </div>`;
                } else {
                    html += `<button type="button" class="pt-split" data-pt="split" data-pos="${pos}" data-index="${i}" title="Start a new tier at ${esc(e.row.name)}" aria-label="Start a new ${pos} tier at ${esc(e.row.name)}"></button>`;
                }
                const pick = pickOf(e.row.id);
                const a = c.adpOf ? c.adpOf(e.row) : null;
                // Round tiny values to 0 so they don't show as "-0.0"
                const val = auction && e.row.dollars ? `$${Math.round(e.row.dollars)}` : fmt(Math.abs(e.v) < 0.05 ? 0 : e.v, 1);
                html += `<div class="pt-player${pick ? ' picked' : ''}"${pick ? ` title="${pick.mine ? 'On your team' : 'Drafted'}"` : ''}>
                    <a href="#" class="player-name-link" data-player-id="${esc(e.row.id)}">${esc(e.row.name)}</a>
                    ${a ? `<span class="pt-adp" title="ADP">${fmt(a.adp, 0)}</span>` : ''}
                    <span class="pt-val">${val}</span></div>`;
            });
            if (entries.length) html += '</div>';
            const more = t.entries.length > entries.length
                ? `<button type="button" class="pt-more" data-pt="more" data-pos="${pos}">Show more (${t.entries.length - entries.length})</button>` : '';
            return `<div class="pt-col">
                <div class="pt-col-head">
                    <strong>${pos}</strong>
                    <span class="pt-stepper" role="group" aria-label="${pos} tiers">
                        <button type="button" data-pt="less" data-pos="${pos}" aria-label="Fewer ${pos} tiers"${t.count <= 1 ? ' disabled' : ''}>−</button>
                        <span>${t.count} tier${t.count === 1 ? '' : 's'}</span>
                        <button type="button" data-pt="more-tiers" data-pos="${pos}" aria-label="More ${pos} tiers"${t.count >= Math.floor(t.entries.length / 2) ? ' disabled' : ''}>+</button>
                    </span>
                    ${custom[pos] ? `<button type="button" class="link-btn pt-reset" data-pt="auto" data-pos="${pos}" title="Back to automatic tiers">${t.manual ? 'hand-set' : 'custom'} · reset</button>` : ''}
                </div>
                ${html}${more}
            </div>`;
        }).join('');

        return `<p class="analysis-note">Tiers within each position, best value first${auction ? ' ($ = auction value)' : ' (value at that position, above replacement)'}. Draft before a tier runs dry: once the last player in a tier goes, the next one at that position is a clear step down.
            Adjust any position: <strong>−/+</strong> changes how many tiers it splits into at the biggest drops in value; click <strong>between two players</strong> to start a new tier there, or <strong>×</strong> to merge a tier into the one above.
            ${anyCustom ? '<button type="button" class="link-btn" data-pt="reset-all">Reset all positions to automatic</button>' : ''}</p>
            <div class="pt-grid">${columns}</div>`;
    }

    function init(outputEl) {
        outputEl.addEventListener('click', e => {
            const btn = e.target.closest('[data-pt]');
            if (!btn || !ctx) return;
            const pos = btn.dataset.pos;
            const act = btn.dataset.pt;
            const t = pos ? compute(ctx.result).tiered[pos] : null;
            const list = pos ? compute(ctx.result).lists[pos] : null;
            if (act === 'less' || act === 'more-tiers') {
                const count = Math.max(1, t.count + (act === 'less' ? -1 : 1));
                custom[pos] = { count };
            } else if (act === 'split' || act === 'merge') {
                // Start from the current breaks (automatic ones too), then add or remove this one
                custom[pos] = { starts: T.toggleStart(list, t.starts, Number(btn.dataset.index)) };
            } else if (act === 'auto') {
                delete custom[pos];
            } else if (act === 'reset-all') {
                custom = {};
            } else if (act === 'more') {
                shown[pos] = (shown[pos] || 30) + 30;
                ctx.rerender();
                return;
            } else {
                return;
            }
            save();
            ctx.rerender();
        });
    }

    window.DDPosTiers = { compute, render, init, keyOf };
})();
