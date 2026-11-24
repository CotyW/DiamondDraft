document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const calculateBtn = document.getElementById('calculate-btn');
    const playersTable = document.getElementById('players-table');
    const playersBody = document.getElementById('players-body');
    const tableContainer = document.querySelector('.table-container');
    const positionFilter = document.getElementById('position-filter');
    const yearButtonsEl = document.getElementById('year-buttons');
    const projectionSourceEl = document.getElementById('projection-source');
    const playerSearch = document.getElementById('player-search');
    const dataTimestamp = document.getElementById('data-timestamp');
    const loginBtn = document.getElementById('login-btn');
    const loginModal = document.getElementById('login-modal');
    const loginForm = document.getElementById('login-form');
    const siteHeader = document.querySelector('.site-header');
    const logoEl = document.querySelector('.logo');
    let activeModal = null;
    
    // State variables
    // Season years come from the data (getSeasonConfig); none are written in this file
    let projectionYear = null;
    const loadedSeasons = new Set();
    const playerCardCache = new Map();
    let allPlayers = [];
    let displayedPlayers = [];
    let currentYear = null; // set in loadData to the latest season with actual stats
    let currentSort = {column: 'points', direction: 'desc'};
    let searchTerm = '';
    let currentTableData = [];
    let currentFilterValue = 'all';

    // Virtualization state
    let measuredRowHeight = 0; // will be measured on first render
    const BUFFER_ROWS = 10;
    let virtualStart = 0;
    let virtualEnd = 0;
    const columnCount = () => (playersTable.tHead && playersTable.tHead.rows[0] ? playersTable.tHead.rows[0].cells.length : 18);
    let dataEpoch = 0;
    let lastRenderedEpoch = -1;

    // Advanced filters state
    const advanced = {
        enabled: false,
        teams: new Set(),
        positions: new Set(),
        avgMin: 0,
        avgMax: 0.4,
        eraMin: 0,
        eraMax: 10
    };

    // Advanced filters UI refs
    const advToggleBtn = document.getElementById('advanced-filters-toggle');
    const advPanel = document.getElementById('advanced-filters');
    const teamFilterEl = document.getElementById('team-filter');
    const basicTeamFilter = document.getElementById('basic-team-filter');
    const posMultiEl = document.getElementById('position-multi');
    const avgMinEl = document.getElementById('avg-min');
    const avgMaxEl = document.getElementById('avg-max');
    const avgMinVal = document.getElementById('avg-min-val');
    const avgMaxVal = document.getElementById('avg-max-val');
    const eraMinEl = document.getElementById('era-min');
    const eraMaxEl = document.getElementById('era-max');
    const eraMinVal = document.getElementById('era-min-val');
    const eraMaxVal = document.getElementById('era-max-val');
    const presetNameEl = document.getElementById('preset-name');
    const savePresetBtn = document.getElementById('save-preset');
    const presetSelectEl = document.getElementById('preset-select');
    const applyPresetBtn = document.getElementById('apply-preset');
    const deletePresetBtn = document.getElementById('delete-preset');

    // Position normalization for display (which columns to show)
    const HITTER_POSITIONS = new Set(['C','1B','2B','3B','SS','LF','CF','RF','DH']);
    const PITCHER_POSITIONS = new Set(['SP','RP']);
    function normalizeViewFilter(value) {
        if (HITTER_POSITIONS.has((value || '').toUpperCase())) return 'batter';
        if (PITCHER_POSITIONS.has((value || '').toUpperCase())) return 'pitcher';
        return value || 'all';
    }
    
    // Stat definitions shared by the table, player card, comparison and scoring inputs
    const S = window.DDStats;

    // For text from uploads (file names, player names) that goes into innerHTML
    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    // Scoring Weights: one input per scorable stat, ids like "w-bat-hr"
    function renderWeightInputs() {
        ['bat', 'pit'].forEach(group => {
            const el = document.getElementById(`weights-${group}`);
            if (!el) return;
            el.innerHTML = S.scorable(group).map(s => `
                <div class="input-group">
                    <label for="w-${group}-${s.key}">${s.name}:</label>
                    <input type="number" id="w-${group}-${s.key}" data-group="${group}" data-stat="${s.key}" value="${s.points}" step="0.1">
                </div>`).join('');
        });
    }
    renderWeightInputs();

    function readWeights() {
        const w = S.defaultWeights();
        document.querySelectorAll('.weight-inputs input[data-stat]').forEach(input => {
            w[input.dataset.group][input.dataset.stat] = parseFloat(input.value) || 0;
        });
        return w;
    }
    window.DDReadWeights = readWeights; // the analysis panel reads these for points leagues

    // Header: when the stats were last updated and which projection system the data uses
    async function showDataStatus() {
        const el = document.getElementById('data-status');
        if (!el || typeof loadMeta !== 'function') return;
        try {
            const meta = await loadMeta();
            const parts = [];
            const updated = meta.timestamp ? new Date(meta.timestamp) : null;
            if (updated && !isNaN(updated)) {
                const date = updated.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                parts.push(`Stats updated <strong>${date}</strong>`);
            }
            if (meta.projection_year) {
                const systems = (meta.projection_systems || []).map(s => s.label);
                const method = systems.length ? `${systems.join(', ')} + Marcel` : 'Marcel';
                parts.push(`${meta.projection_year} projections: <strong>${method}</strong>`);
            }
            el.innerHTML = parts.join('<br>');
        } catch (e) {
            el.textContent = '';
        }
    }
    showDataStatus();

    // Header scroll state
    const handleHeaderScroll = () => {
        if (!siteHeader) return;
        if (window.scrollY > 10) {
            siteHeader.classList.add('scrolled');
        } else {
            siteHeader.classList.remove('scrolled');
        }
    };
    window.addEventListener('scroll', handleHeaderScroll, { passive: true });
    handleHeaderScroll();

    // Initialize app
    loadData();
    // Initialize presets dropdown
    hydratePresetsDropdown();
    
    // Event listeners
    // Scoring Weights modal: opened from Player Rankings or the header's Scoring link.
    // Apply recalculates points; closing without Apply puts back the last applied weights.
    const scoringModal = document.getElementById('scoring-modal');
    let scoringOpener = null;
    let appliedWeights = null;

    function setWeightInputs(weights) {
        document.querySelectorAll('.weight-inputs input[data-stat]').forEach(input => {
            const v = weights[input.dataset.group][input.dataset.stat];
            if (v !== undefined) input.value = v;
        });
    }
    function openScoring(e) {
        if (e) e.preventDefault();
        if (!scoringModal) return;
        scoringOpener = document.activeElement;
        appliedWeights = readWeights();
        scoringModal.style.display = 'block';
        activateFocusTrap(scoringModal);
        const firstInput = scoringModal.querySelector('input');
        if (firstInput) firstInput.focus();
    }
    function closeScoring(apply) {
        if (!scoringModal || scoringModal.style.display !== 'block') return;
        if (apply) calculatePlayerValues();
        else if (appliedWeights) setWeightInputs(appliedWeights);
        scoringModal.style.display = 'none';
        activeModal = null;
        if (scoringOpener && scoringOpener.focus) scoringOpener.focus();
    }
    ['scoring-open', 'nav-scoring'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', openScoring);
    });
    calculateBtn.addEventListener('click', () => closeScoring(true));
    if (scoringModal) {
        scoringModal.querySelector('.scoring-close').addEventListener('click', () => closeScoring(false));
        document.getElementById('scoring-reset').addEventListener('click', () => setWeightInputs(S.defaultWeights()));
        // Enter in a weight box applies, like submitting a form
        scoringModal.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); closeScoring(true); }
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeScoring(false); });
        // A click outside the dialog card (the dimmed overlay, or the header) closes it;
        // the opener buttons are outside too, so skip those
        const scoringCard = scoringModal.querySelector('.modal-content');
        document.addEventListener('click', e => {
            if (scoringModal.style.display === 'block' && !scoringCard.contains(e.target)
                && !e.target.closest('#scoring-open, #nav-scoring')) closeScoring(false);
        });
    }
    
    // Use event delegation for player name clicks
    document.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('player-name-link')) {
            e.preventDefault();
            const playerId = e.target.getAttribute('data-player-id');
            showPlayerCard(playerId);
        }
    });
    
    // Position filter event listener
    positionFilter.addEventListener('change', function() {
        const filterValue = this.value;
        const viewFilter = normalizeViewFilter(filterValue);
        updateColumnVisibility(viewFilter);
        filterAndDisplayPlayers();
    });
    
    // Team filter (combines with position filter)
    if (basicTeamFilter) {
        basicTeamFilter.addEventListener('change', filterAndDisplayPlayers);
    }

    // Search input
    playerSearch.addEventListener('input', function() {
        searchTerm = this.value.toLowerCase();
        filterAndDisplayPlayers();
    });

    // Advanced filters events
    if (advToggleBtn && advPanel) {
        advToggleBtn.addEventListener('click', () => {
            const nowOpen = advPanel.hasAttribute('hidden');
            if (nowOpen) {
                advPanel.removeAttribute('hidden');
            } else {
                advPanel.setAttribute('hidden', '');
            }
            const expanded = nowOpen ? 'true' : 'false';
            advToggleBtn.setAttribute('aria-expanded', expanded);
            advanced.enabled = nowOpen; // enable when opening panel
            filterAndDisplayPlayers();
        });
    }

    function gatherMultiSelectValues(selectEl) {
        if (!selectEl) return [];
        return Array.from(selectEl.selectedOptions).map(o => o.value);
    }

    if (teamFilterEl) {
        teamFilterEl.addEventListener('change', () => {
            advanced.teams = new Set(gatherMultiSelectValues(teamFilterEl));
            advanced.enabled = true;
            filterAndDisplayPlayers();
        });
    }

    if (posMultiEl) {
        posMultiEl.addEventListener('change', () => {
            advanced.positions = new Set(gatherMultiSelectValues(posMultiEl).map(v => v.toUpperCase()));
            advanced.enabled = true;
            filterAndDisplayPlayers();
        });
    }

    function clampRanges() {
        let aMin = parseFloat(avgMinEl.value);
        let aMax = parseFloat(avgMaxEl.value);
        if (aMin > aMax) [aMin, aMax] = [aMax, aMin];
        avgMinEl.value = aMin;
        avgMaxEl.value = aMax;
        advanced.avgMin = aMin;
        advanced.avgMax = aMax;
        if (avgMinVal) avgMinVal.textContent = aMin.toFixed(3);
        if (avgMaxVal) avgMaxVal.textContent = aMax.toFixed(3);

        let eMin = parseFloat(eraMinEl.value);
        let eMax = parseFloat(eraMaxEl.value);
        if (eMin > eMax) [eMin, eMax] = [eMax, eMin];
        eraMinEl.value = eMin;
        eraMaxEl.value = eMax;
        advanced.eraMin = eMin;
        advanced.eraMax = eMax;
        if (eraMinVal) eraMinVal.textContent = eMin.toFixed(1);
        if (eraMaxVal) eraMaxVal.textContent = eMax.toFixed(1);
    }

    if (avgMinEl && avgMaxEl) {
        avgMinEl.addEventListener('input', () => { advanced.enabled = true; clampRanges(); filterAndDisplayPlayers(); });
        avgMaxEl.addEventListener('input', () => { advanced.enabled = true; clampRanges(); filterAndDisplayPlayers(); });
        clampRanges();
    }
    if (eraMinEl && eraMaxEl) {
        eraMinEl.addEventListener('input', () => { advanced.enabled = true; clampRanges(); filterAndDisplayPlayers(); });
        eraMaxEl.addEventListener('input', () => { advanced.enabled = true; clampRanges(); filterAndDisplayPlayers(); });
        clampRanges();
    }

    // Presets
    function loadPresets() {
        try {
            const raw = localStorage.getItem('dd_presets');
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }
    function savePresets(list) {
        localStorage.setItem('dd_presets', JSON.stringify(list));
    }
    function hydratePresetsDropdown() {
        if (!presetSelectEl) return;
        const list = loadPresets();
        presetSelectEl.innerHTML = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Select a preset';
        presetSelectEl.appendChild(ph);
        list.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            presetSelectEl.appendChild(opt);
        });
    }
    function snapshotCurrentFilters() {
        return {
            name: (presetNameEl && presetNameEl.value) || 'Preset',
            teams: Array.from(advanced.teams),
            positions: Array.from(advanced.positions),
            avgMin: advanced.avgMin,
            avgMax: advanced.avgMax,
            eraMin: advanced.eraMin,
            eraMax: advanced.eraMax,
            search: searchTerm,
            basicPositionFilter: positionFilter.value,
            basicTeamFilter: basicTeamFilter ? basicTeamFilter.value : 'all',
            year: currentYear
        };
    }
    function applyPreset(p) {
        if (!p) return;
        // restore state
        advanced.teams = new Set(p.teams || []);
        advanced.positions = new Set((p.positions || []).map(v => v.toUpperCase()));
        advanced.avgMin = p.avgMin ?? 0;
        advanced.avgMax = p.avgMax ?? 0.4;
        advanced.eraMin = p.eraMin ?? 0;
        advanced.eraMax = p.eraMax ?? 10;
        advanced.enabled = true;

        // update UI
        if (teamFilterEl) Array.from(teamFilterEl.options).forEach(o => o.selected = advanced.teams.has(o.value));
        if (posMultiEl) Array.from(posMultiEl.options).forEach(o => o.selected = advanced.positions.has(o.value.toUpperCase()));
        if (avgMinEl) avgMinEl.value = advanced.avgMin;
        if (avgMaxEl) avgMaxEl.value = advanced.avgMax;
        if (eraMinEl) eraMinEl.value = advanced.eraMin;
        if (eraMaxEl) eraMaxEl.value = advanced.eraMax;
        clampRanges();

        if (playerSearch) playerSearch.value = p.search || '';
        searchTerm = (p.search || '').toLowerCase();
        if (positionFilter && p.basicPositionFilter) positionFilter.value = p.basicPositionFilter;
        if (basicTeamFilter) basicTeamFilter.value = p.basicTeamFilter || 'all';
        filterAndDisplayPlayers();
    }
    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', () => {
            const snap = snapshotCurrentFilters();
            if (!snap.name) return;
            const list = loadPresets();
            const idx = list.findIndex(x => x.name === snap.name);
            if (idx >= 0) list[idx] = snap; else list.push(snap);
            savePresets(list);
            hydratePresetsDropdown();
        });
    }
    if (applyPresetBtn && presetSelectEl) {
        applyPresetBtn.addEventListener('click', () => {
            const sel = presetSelectEl.value;
            if (!sel) return;
            const p = loadPresets().find(x => x.name === sel);
            applyPreset(p);
        });
    }
    if (deletePresetBtn && presetSelectEl) {
        deletePresetBtn.addEventListener('click', () => {
            const sel = presetSelectEl.value;
            if (!sel) return;
            const list = loadPresets().filter(x => x.name !== sel);
            savePresets(list);
            hydratePresetsDropdown();
        });
    }

    // Login button and modal
    if (loginBtn && loginModal) {
        loginBtn.addEventListener('click', function() {
            loginModal.style.display = 'block';
            activeModal = loginModal;
            const emailInput = document.getElementById('login-email');
            if (emailInput) emailInput.focus();
            activateFocusTrap(loginModal);
        });
    }

    // Handle login form submission
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
            // TODO: Implement actual authentication
            console.log('Login attempt:', email);
            alert('Login functionality coming soon!');
        });
    }
    
    // Year toggle buttons: one per season in the data, plus the projection year
    const isProjected = year => projectionYear !== null && String(year) === String(projectionYear);
    const seasonLabel = year => (isProjected(year) ? `${year} Projected` : String(year));

    function renderYearButtons(seasons) {
        if (!yearButtonsEl) return;
        yearButtonsEl.innerHTML = '';
        const years = projectionYear === null ? seasons : [...seasons, projectionYear];
        years.forEach(year => {
            const btn = document.createElement('button');
            btn.className = 'year-btn';
            btn.dataset.year = String(year);
            btn.textContent = seasonLabel(year);
            btn.setAttribute('aria-label', `Show ${year} ${isProjected(year) ? 'projected ' : ''}stats`);
            btn.classList.toggle('active', String(year) === currentYear);
            yearButtonsEl.appendChild(btn);
        });
    }

    if (yearButtonsEl) {
        yearButtonsEl.addEventListener('click', async function(e) {
            const btn = e.target.closest('.year-btn');
            if (!btn) return;
            yearButtonsEl.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentYear = btn.dataset.year;
            updateProjectionSourceState();
            await ensureSeasonLoaded(currentYear);

            // Recalculate points for new year selection
            calculatePlayerValues();
        });
    }
    
    // Projection system dropdown: picks which projection the projected season shows. Options
    // come from the CSV systems in data/last_updated.json, plus Marcel and a visitor's upload;
    // every system uses Marcel for players it doesn't cover.
    const PROJECTION_SOURCE_KEY = 'dd-projection-source';
    const UPLOAD_KEY = 'dd-uploaded-projections';
    const U = window.DDUpload;
    let projectionSystems = [];  // [{key, label, players}] from the data, default first
    let uploaded = null;          // {name, files: [{kind, filename, matched, rows, unmatched}], lines}

    function readUploaded() {
        try {
            const saved = JSON.parse(localStorage.getItem(UPLOAD_KEY) || 'null');
            return saved && saved.lines ? saved : null;
        } catch (e) { return null; }
    }

    function updateProjectionSourceState() {
        if (!projectionSourceEl) return;
        const onProjection = isProjected(currentYear);
        projectionSourceEl.disabled = !onProjection || projectionSourceEl.options.length < 2;
        projectionSourceEl.title = onProjection ? '' : `Choose ${projectionYear || 'the projected season'} to switch projection systems`;
    }

    function renderProjectionOptions(selected) {
        if (!projectionSourceEl) return;
        const opts = projectionSystems.map(s => [s.key, `${s.label} + Marcel`]);
        if (uploaded) opts.push(['upload', `${uploaded.name} (upload) + Marcel`]);
        opts.push(['marcel', 'Marcel only']);
        projectionSourceEl.innerHTML = opts.map(([v, t]) => `<option value="${v}">${escapeHtml(t)}</option>`).join('');
        const keys = opts.map(o => o[0]);
        projectionSourceEl.value = keys.includes(selected) ? selected : keys[0];
        updateProjectionSourceState();
    }

    async function initProjectionSource() {
        if (!projectionSourceEl) return;
        try {
            const meta = await loadMeta();
            projectionSystems = meta.projection_systems
                || (meta.projection_method === 'steamer' ? [{ key: 'steamer', label: 'Steamer' }] : []);
        } catch (e) { projectionSystems = []; }
        uploaded = readUploaded();
        if (uploaded) setUploadedProjections(uploaded.lines);
        let saved = null;
        try { saved = localStorage.getItem(PROJECTION_SOURCE_KEY); } catch (e) { /* storage blocked */ }
        renderProjectionOptions(saved);
        setProjectionSource(projectionSourceEl.value);
    }

    // Reload the projected season with the chosen system, then rescore
    async function applyProjectionSource(source) {
        try { localStorage.setItem(PROJECTION_SOURCE_KEY, source); } catch (e) { /* storage blocked */ }
        setProjectionSource(source);
        if (projectionYear === null) return;
        const yearStr = String(projectionYear);
        const fresh = await fetchPlayersWithStats('all', [projectionYear]);
        const byId = new Map(fresh.map(p => [String(p.id), p]));
        allPlayers.forEach(p => {
            const np = byId.get(String(p.id));
            if (!np) return;
            p.stats_by_season = { ...p.stats_by_season, [yearStr]: np.stats_by_season[yearStr] };
            p.projection_source = np.projection_source;
        });
        loadedSeasons.add(yearStr);
        playerCardCache.clear();
        calculatePlayerValues();
    }

    if (projectionSourceEl) {
        projectionSourceEl.addEventListener('change', () => applyProjectionSource(projectionSourceEl.value));
    }

    // Upload modal: read the chosen CSVs, match them to our players, keep the result in this
    // browser (localStorage) and switch the projected season to it. Nothing is sent anywhere.
    const uploadModal = document.getElementById('upload-modal');
    const uploadInput = document.getElementById('upload-files');
    const uploadNameEl = document.getElementById('upload-name');
    const uploadStatus = document.getElementById('upload-status');
    const uploadCurrent = document.getElementById('upload-current');
    let uploadOpener = null;

    function showUploadStatus(html, isError) {
        uploadStatus.innerHTML = html;
        uploadStatus.classList.toggle('error', !!isError);
    }

    function renderUploadCurrent() {
        if (!uploadCurrent) return;
        if (!uploaded) { uploadCurrent.hidden = true; return; }
        const files = uploaded.files.map(f =>
            `${escapeHtml(f.filename)}: ${f.matched} of ${f.rows} ${f.kind} matched`).join('<br>');
        uploadCurrent.querySelector('.upload-current-info').innerHTML =
            `<strong>${escapeHtml(uploaded.name)}</strong><br>${files}`;
        uploadCurrent.hidden = false;
    }

    function openUpload() {
        if (!uploadModal) return;
        uploadOpener = document.activeElement;
        showUploadStatus('');
        renderUploadCurrent();
        uploadModal.style.display = 'block';
        activateFocusTrap(uploadModal);
    }
    function closeUpload() {
        if (!uploadModal || uploadModal.style.display !== 'block') return;
        uploadModal.style.display = 'none';
        activeModal = null;
        if (uploadOpener && uploadOpener.focus) uploadOpener.focus();
    }

    async function useUploadedFiles() {
        const files = Array.from(uploadInput.files || []);
        if (!files.length) { showUploadStatus('Choose a batters file, a pitchers file, or both.', true); return; }
        if (files.length > 2) { showUploadStatus('Choose at most two files: one batters, one pitchers.', true); return; }
        let meta = {};
        try { meta = await loadMeta(); } catch (e) { /* use the default FIP constant */ }
        const lastSeason = meta.seasons && meta.seasons.length ? String(Math.max(...meta.seasons)) : null;
        const fip = lastSeason && meta.league && meta.league[lastSeason] ? meta.league[lastSeason].fip_constant : undefined;
        const fresh = { name: uploadNameEl.value.trim() || 'My projections', files: [], lines: {} };
        const kinds = new Set();
        for (const file of files) {
            let parsed;
            try {
                parsed = U.readProjectionFile(await file.text());
            } catch (e) {
                showUploadStatus(`<strong>${escapeHtml(file.name)}</strong>: ${escapeHtml(e.message)}`, true);
                return;
            }
            if (kinds.has(parsed.kind)) {
                showUploadStatus(`Both files look like ${parsed.kind} files. A pitchers file needs an IP column.`, true);
                return;
            }
            kinds.add(parsed.kind);
            const result = U.matchRows(allPlayers, parsed, fip);
            Object.assign(fresh.lines, result.lines);
            fresh.files.push({ kind: parsed.kind, filename: file.name, matched: result.matched,
                rows: parsed.rows.length, unmatched: result.unmatched.slice(0, 5) });
        }
        if (!Object.keys(fresh.lines).length) {
            showUploadStatus('No rows matched our players. Check the Name column, or add an MLBAMID column.', true);
            return;
        }
        uploaded = fresh;
        let stored = true;
        try { localStorage.setItem(UPLOAD_KEY, JSON.stringify(uploaded)); } catch (e) { stored = false; }
        setUploadedProjections(uploaded.lines);
        renderProjectionOptions('upload');
        renderUploadCurrent();
        uploadInput.value = '';
        const summary = uploaded.files.map(f => {
            const missed = f.rows - f.matched;
            const examples = f.unmatched.length ? ` (e.g. ${f.unmatched.map(escapeHtml).join(', ')})` : '';
            return `${f.matched} of ${f.rows} ${f.kind} matched${missed ? `; ${missed} aren't in our player list${examples}` : ''}.`;
        }).join('<br>');
        showUploadStatus(summary + (stored ? '' : '<br>Your browser wouldn\'t save the file, so it lasts until you leave this page.'));
        // Show the result: switch to the projected season if another one is selected
        if (!isProjected(currentYear) && yearButtonsEl) {
            const btn = yearButtonsEl.querySelector(`.year-btn[data-year="${projectionYear}"]`);
            if (btn) btn.click();
        }
        await applyProjectionSource('upload');
    }

    async function removeUpload() {
        uploaded = null;
        try { localStorage.removeItem(UPLOAD_KEY); } catch (e) { /* storage blocked */ }
        setUploadedProjections({});
        const wasUpload = projectionSourceEl.value === 'upload';
        renderProjectionOptions(wasUpload ? null : projectionSourceEl.value);
        renderUploadCurrent();
        showUploadStatus('Upload removed.');
        if (wasUpload) await applyProjectionSource(projectionSourceEl.value);
    }

    function downloadTemplate(kind) {
        const url = URL.createObjectURL(new Blob([U.TEMPLATES[kind]], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `projections-${kind}-template.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    if (uploadModal && U && projectionSourceEl) {
        document.getElementById('upload-open').addEventListener('click', openUpload);
        uploadModal.querySelector('.upload-close').addEventListener('click', closeUpload);
        document.getElementById('upload-submit').addEventListener('click', useUploadedFiles);
        document.getElementById('upload-remove').addEventListener('click', removeUpload);
        uploadModal.querySelectorAll('[data-template]').forEach(btn =>
            btn.addEventListener('click', () => downloadTemplate(btn.dataset.template)));
        // The file name is a handy default name for the set: "zips-batters.csv" -> "zips"
        uploadInput.addEventListener('change', () => {
            if (!uploadNameEl.value.trim() && uploadInput.files.length) {
                uploadNameEl.value = uploadInput.files[0].name.replace(/\.csv$/i, '').replace(/[-_ ](batters|pitchers|hitters)$/i, '');
            }
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUpload(); });
        uploadModal.addEventListener('click', e => { if (e.target === uploadModal) closeUpload(); });
    }

    // Table header: built per view from the stat definitions; clicks are handled on the <thead>
    const headRow = document.getElementById('players-head');
    let tableColumns = S.columns('all');

    function renderHeader(view) {
        tableColumns = S.columns(view);
        if (!headRow) return;
        const th = (sort, label, cls = '', title = '') =>
            `<th data-sort="${sort}" class="${cls}"${title ? ` title="${title}"` : ''} style="cursor:pointer">${label}</th>`;
        headRow.innerHTML = [
            th('name', 'Player Name'),
            th('team', 'Team', 'team-column'),
            th('position', 'POS', 'position-column'),
            ...tableColumns.map(c => th(c.key, c.label, c.group === 'pit' ? 'pitching-stat' : 'batting-stat', c.name)),
            th('points', 'Points', 'points-column'),
            '<th>Select</th>'
        ].join('');
        const active = headRow.querySelector(`th[data-sort="${currentSort.column}"]`);
        if (active) active.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    if (playersTable.tHead) {
        playersTable.tHead.addEventListener('click', e => {
            const header = e.target.closest('th[data-sort]');
            if (!header) return;
            const column = header.dataset.sort;
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                // Best first: ascending for stats where lower is better (ERA, strikeouts, ...)
                const def = tableColumns.find(c => c.key === column);
                currentSort.direction = def && def.lower ? 'asc' : 'desc';
            }
            playersTable.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
            header.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            sortAndDisplayPlayers();
        });
    }

    // Functions
    async function loadData(filter = 'all') {
        try {
            // Start on the latest season with actual stats; other seasons load when selected
            const seasonConfig = await getSeasonConfig();
            projectionYear = seasonConfig.projectionYear;
            await initProjectionSource();
            const latestSeason = seasonConfig.seasons[seasonConfig.seasons.length - 1];
            currentYear = String(latestSeason);
            renderYearButtons(seasonConfig.seasons);

            allPlayers = await fetchPlayersWithStats(filter, [latestSeason]);
            loadedSeasons.clear();
            loadedSeasons.add(currentYear);
            
            if (allPlayers.length === 0) {
                console.warn('No players loaded from Supabase');
                dataTimestamp.textContent = 'No data available';
                return;
            }
            
            // Fetch and display last updated timestamp
            const lastUpdated = await getLastUpdated();
            dataTimestamp.textContent = `Last updated: ${lastUpdated.toLocaleDateString()} at ${lastUpdated.toLocaleTimeString()}`;
            
            // Calculate player values with default weights
            calculatePlayerValues();
            
            // Initialize column visibility based on filter
            updateColumnVisibility(filter);
            // Populate team multi-select once data available
            populateTeamsFilter();
            
        } catch (error) {
            console.error('Error loading data:', error);
            dataTimestamp.textContent = 'Error loading data. Please try again later.';
        }
    }

    function populateTeamsFilter() {
        const teams = Array.from(new Set(allPlayers.map(p => p.team).filter(Boolean))).sort();
        if (basicTeamFilter) {
            const selected = basicTeamFilter.value;
            basicTeamFilter.innerHTML = '<option value="all">All Teams</option>';
            teams.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                basicTeamFilter.appendChild(opt);
            });
            basicTeamFilter.value = teams.includes(selected) ? selected : 'all';
        }
        if (!teamFilterEl) return;
        teamFilterEl.innerHTML = '';
        teams.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            teamFilterEl.appendChild(opt);
        });
    }

    async function ensureSeasonLoaded(targetYear) {
        const yearStr = String(targetYear);
        if (loadedSeasons.has(yearStr)) return;

        // Fetch all players for the missing season and merge stats
        const newPlayers = await fetchPlayersWithStats('all', [Number(targetYear)]);
        if (!newPlayers || newPlayers.length === 0) {
            loadedSeasons.add(yearStr);
            return;
        }

        const playerMap = new Map(allPlayers.map(p => [String(p.id), p]));
        newPlayers.forEach(np => {
            const existing = playerMap.get(String(np.id));
            if (existing) {
                existing.stats_by_season = {
                    ...existing.stats_by_season,
                    ...np.stats_by_season
                };
                if (isProjected(yearStr)) existing.projection_source = np.projection_source;
            } else {
                allPlayers.push(np);
            }
        });

        loadedSeasons.add(yearStr);
    }
    
    function calculatePlayerValues() {
        const weights = readWeights();
        displayedPlayers = allPlayers.map(player => {
            const group = S.groupOf(player);
            const seasonStats = player.stats_by_season ? player.stats_by_season[currentYear] : null;
            const stats = seasonStats ? (group === 'pit' ? seasonStats.pitching : seasonStats.batting) : {};
            return { ...player, points: S.points(stats, group, weights) };
        });

        filterAndDisplayPlayers();
        document.dispatchEvent(new CustomEvent('dd:players-updated'));
    }

    // Read-only view of page state for the draft analysis panel
    window.DDState = {
        get players() { return displayedPlayers; },
        get year() { return currentYear; }
    };
    
    function filterAndDisplayPlayers() {
        let filteredPlayers = [...displayedPlayers];

        // Apply position filter if a specific position is selected
        const filterValue = positionFilter.value;
        if (filterValue === 'batter') {
            filteredPlayers = filteredPlayers.filter(player => !player.is_pitcher);
        } else if (filterValue === 'pitcher') {
            filteredPlayers = filteredPlayers.filter(player => player.is_pitcher);
        } else if (filterValue && filterValue !== 'all') {
            filteredPlayers = filteredPlayers.filter(player => positionMatches(player.position, filterValue));
        }

        // Basic team filter (ANDed with the position filter)
        if (basicTeamFilter && basicTeamFilter.value !== 'all') {
            filteredPlayers = filteredPlayers.filter(player => player.team === basicTeamFilter.value);
        }

        // Advanced filters: teams and positions (multi)
        if (advanced.enabled) {
            if (advanced.teams.size > 0) {
                filteredPlayers = filteredPlayers.filter(p => p.team && advanced.teams.has(p.team));
            }
            if (advanced.positions.size > 0) {
                filteredPlayers = filteredPlayers.filter(p => {
                    const pos = (p.position || '').toUpperCase();
                    for (const sel of advanced.positions) {
                        if (positionMatches(pos, sel)) return true;
                    }
                    return false;
                });
            }
        }

        // Apply search filter
        if (searchTerm) {
            filteredPlayers = filteredPlayers.filter(player => 
                player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.team.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.position.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Apply stat range filters (AVG for batters, ERA for pitchers)
        if (advanced.enabled) {
            filteredPlayers = filteredPlayers.filter(player => {
                const seasonStats = player.stats_by_season ? player.stats_by_season[currentYear] : null;
                const batting = seasonStats ? seasonStats.batting : {};
                const pitching = seasonStats ? seasonStats.pitching : {};
                if (player.is_pitcher) {
                    const era = pitching.era || 0;
                    return era >= advanced.eraMin && era <= advanced.eraMax;
                } else {
                    const avg = batting.avg || 0;
                    return avg >= advanced.avgMin && avg <= advanced.avgMax;
                }
            });
        }

        // Sort filtered players
        sortPlayers(filteredPlayers);

        // Display filtered & sorted players
        const viewFilter = normalizeViewFilter(filterValue);
        renderHeader(viewFilter);
        renderPlayersTable(filteredPlayers, viewFilter);
    }

    function positionMatches(playerPos, filterPos) {
        if (!filterPos) return true;
        const f = (filterPos || '').toUpperCase().trim();
        const raw = (playerPos || '').toUpperCase().trim();
        if (!raw) return false;
        // split common delimiters
        const tokens = raw.split(/[\s,/|-]+/).filter(Boolean);
        const set = new Set(tokens);

        // Direct match
        if (set.has(f)) return true;

        // Special mappings
        // OF covers LF/CF/RF
        if ((f === 'LF' || f === 'CF' || f === 'RF') && set.has('OF')) return true;
        // P covers SP/RP only for pitchers whose role is unknown (plain "P")
        if ((f === 'SP' || f === 'RP') && set.has('P')) return true;

        return false;
    }
    
    function updateColumnVisibility(filter = 'all') {
        renderHeader(normalizeViewFilter(filter));
    }

    function sortPlayers(players) {
        const column = currentSort.column;
        const dir = currentSort.direction === 'asc' ? 1 : -1;
        const def = tableColumns.find(c => c.key === column);
        // Rate stats (AVG, ERA, ...) only rank players with enough playing time; the rest go last
        const isRate = def && def.dec > 0;

        const value = p => {
            if (column === 'name' || column === 'team' || column === 'position') return p[column] || '';
            if (column === 'points') return p.points || 0;
            if (def && S.groupOf(p) !== def.group) return null; // a batter has no ERA
            const season = p.stats_by_season ? p.stats_by_season[currentYear] : null;
            const stats = (p.is_pitcher ? season?.pitching : season?.batting) || {};
            if (isRate && !S.qualifies(stats, def.group)) return null;
            return Number(stats[column]) || 0;
        };

        players.sort((a, b) => {
            const av = value(a), bv = value(b);
            if (av === null || bv === null) return (av === null) - (bv === null); // missing last
            if (typeof av === 'string') return dir * av.localeCompare(bv);
            return dir * (av - bv);
        });
        return players;
    }

    function sortAndDisplayPlayers() {
        // Re-run the filters too, so sorting never brings back filtered-out players
        filterAndDisplayPlayers();
    }
    
    // Initialize selectedPlayers array
    const selectedPlayers = [];

    function handleCheckboxChange(e) {
        const checkbox = e.target;
        const playerId = checkbox.getAttribute('data-player-id');
        console.log('Checkbox changed:', playerId, checkbox.checked);

        if (checkbox.checked) {
            if (selectedPlayers.length >= 2) {
                // Uncheck the first selected checkbox
                const firstId = selectedPlayers[0];
                const firstCheckbox = document.querySelector(`.compare-checkbox[data-player-id="${firstId}"]`);
                if (firstCheckbox) {
                    firstCheckbox.checked = false;
                }
                selectedPlayers.shift();
            }
            selectedPlayers.push(playerId);
        } else {
            const index = selectedPlayers.indexOf(playerId);
            if (index > -1) {
                selectedPlayers.splice(index, 1);
            }
        }

        console.log('Selected players:', selectedPlayers);

        // Show comparison modal if two players are selected
        if (selectedPlayers.length === 2 && window.showComparisonModal) {
            window.showComparisonModal(selectedPlayers, allPlayers, currentYear);
        }
    }

    function renderPlayersTable(playersData, filterValue) {
        currentTableData = playersData || [];
        currentFilterValue = filterValue || 'all';

        // Reset scroll to top on a fresh dataset
        if (tableContainer) tableContainer.scrollTop = 0;

        // Render a slice based on current scroll
        dataEpoch++;
        requestAnimationFrame(updateVirtualizedRows);
    }

    function buildRowElement(player, filterValue) {
        const row = document.createElement('tr');
        row.setAttribute('data-is-pitcher', player.is_pitcher);

        const seasonStats = player.stats_by_season ? player.stats_by_season[currentYear] : null;
        const ownStats = (seasonStats && (player.is_pitcher ? seasonStats.pitching : seasonStats.batting)) || {};
        const group = S.groupOf(player);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'compare-checkbox';
        checkbox.setAttribute('data-player-id', player.id);
        checkbox.checked = selectedPlayers.includes(String(player.id));
        checkbox.addEventListener('change', handleCheckboxChange);

        const cells = [];

        function getTeamNickname(teamName) {
            if (!teamName) return '';
            const parts = teamName.split(' ');
            if (parts.length === 1) return teamName;
            if (parts.length > 2 && parts[parts.length-2].toLowerCase() === 'of') {
                return parts.slice(-3).join(' ');
            }
            return parts.slice(-1)[0];
        }

        cells.push(`<td><a href="#" class="player-name-link" data-player-id="${player.id}">${player.name || ''}</a></td>`);
        cells.push(`<td class="team-column">${getTeamNickname(player.team)}</td>`);
        cells.push(`<td class="position-column">${player.position || ''}</td>`);

        tableColumns.forEach(c => {
            const cls = c.group === 'pit' ? 'pitching-stat' : 'batting-stat';
            const text = c.group === group ? S.format(ownStats[c.key] || 0, c) : '-';
            cells.push(`<td class="${cls}">${text}</td>`);
        });

        cells.push(`<td class="points-column">${player.points || 0}</td>`);
        cells.push('<td class="checkbox-column"></td>');

        row.innerHTML = cells.join('');
        row.querySelector('.checkbox-column').appendChild(checkbox);
        return row;
    }

    function estimateRowHeightIfNeeded() {
        if (measuredRowHeight > 0) return;
        const sampleRow = playersBody.querySelector('tr:not(.spacer-row)');
        if (sampleRow) {
            measuredRowHeight = sampleRow.offsetHeight || 36;
        } else {
            measuredRowHeight = 36; // fallback
        }
    }

    function updateVirtualizedRows() {
        const total = currentTableData.length;
        if (!tableContainer || total === 0) {
            playersBody.innerHTML = '';
            return;
        }

        const viewportHeight = tableContainer.clientHeight || 600;
        const scrollTop = tableContainer.scrollTop || 0;
        const rowH = measuredRowHeight || 36;
        const itemsPerViewport = Math.max(1, Math.ceil(viewportHeight / rowH));
        const start = Math.max(0, Math.floor(scrollTop / rowH) - BUFFER_ROWS);
        const end = Math.min(total, start + itemsPerViewport + BUFFER_ROWS * 2);

        if (start === virtualStart && end === virtualEnd && playersBody.childElementCount > 0 && lastRenderedEpoch === dataEpoch) {
            return; // no change in window
        }
        virtualStart = start;
        virtualEnd = end;
        lastRenderedEpoch = dataEpoch;

        const topSpacerHeight = start * rowH;
        const bottomSpacerHeight = Math.max(0, (total - end) * rowH);

        const frag = document.createDocumentFragment();

        // Top spacer
        const topSpacer = document.createElement('tr');
        topSpacer.className = 'spacer-row';
        const topTd = document.createElement('td');
        topTd.colSpan = columnCount();
        topTd.style.height = `${topSpacerHeight}px`;
        topSpacer.appendChild(topTd);
        frag.appendChild(topSpacer);

        // Visible rows
        for (let i = start; i < end; i++) {
            const row = buildRowElement(currentTableData[i], currentFilterValue);
            frag.appendChild(row);
        }

        // Bottom spacer
        const bottomSpacer = document.createElement('tr');
        bottomSpacer.className = 'spacer-row';
        const bottomTd = document.createElement('td');
        bottomTd.colSpan = columnCount();
        bottomTd.style.height = `${bottomSpacerHeight}px`;
        bottomSpacer.appendChild(bottomTd);
        frag.appendChild(bottomSpacer);

        playersBody.innerHTML = '';
        playersBody.appendChild(frag);

        // Measure row height once we have visible rows
        estimateRowHeightIfNeeded();
    }

    if (tableContainer) {
        tableContainer.addEventListener('scroll', () => {
            requestAnimationFrame(updateVirtualizedRows);
        }, { passive: true });
        window.addEventListener('resize', () => {
            requestAnimationFrame(updateVirtualizedRows);
        });
    }

    // Player Card Functions
    function showPlayerCard(playerId) {
        // Look for player in displayedPlayers first (which has calculated points), 
        // fallback to allPlayers if not found
        let player = displayedPlayers.find(p => p.id == playerId);
        if (!player) {
            player = allPlayers.find(p => p.id == playerId);
        }
        if (!player) return;

        const cacheKey = `${playerId}-${currentYear}`;

        const modal = document.getElementById('player-card-modal');
        const container = document.getElementById('player-card-container');
        if (playerCardCache.has(cacheKey)) {
            container.innerHTML = playerCardCache.get(cacheKey);
            modal.style.display = 'block';
            activeModal = modal;
            activateFocusTrap(modal);
            return;
        }
        

        // Get stats for the selected season
        const seasonStats = player.stats_by_season ? player.stats_by_season[currentYear] : null;
        const stats = (seasonStats && (player.is_pitcher ? seasonStats.pitching : seasonStats.batting)) || {};
        const group = S.groupOf(player);
        const statItems = S.groups[group].map(d => `
                                <div class="stat-item">
                                    <span class="stat-label">${d.name}</span>
                                    <span class="stat-value">${S.format(stats[d.key] || 0, d)}</span>
                                </div>`).join('');

        // Create player card HTML
        const cardHTML = `
            <div class="player-card">
                <div class="player-card-header">
                    <h2 class="player-card-name">${player.name}</h2>
                    <div class="player-card-info">
                        <span class="player-card-team">${player.team}</span>
                        <span class="player-card-position">${player.position}</span>
                    </div>
                </div>
                
                <div class="player-card-stats">
                    <div class="stats-section">
                        <h3>${player.is_pitcher ? 'Pitching' : 'Batting'} Stats (${seasonLabel(currentYear)}${isProjected(currentYear) ? `, ${escapeHtml(player.projection_source === 'upload' && uploaded ? uploaded.name : projectionLabel(player.projection_source))}` : ''})</h3>
                        <div class="stats-grid">${statItems}
                        </div>
                    </div>

                    <div class="stats-section">
                        <h3>Fantasy Points</h3>
                        <div class="stats-grid">
                            <div class="stat-item points-highlight">
                                <span class="stat-label">Total Points</span>
                                <span class="stat-value">${player.points || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="player-card-image-container">
                    <div class="player-card-image-placeholder"></div>
                </div>
            </div>
        `;

        playerCardCache.set(cacheKey, cardHTML);
        container.innerHTML = cardHTML;
        modal.style.display = 'block';
        activeModal = modal;
        activateFocusTrap(modal);
    }

    function closePlayerCard() {
        document.getElementById('player-card-modal').style.display = 'none';
    }

    // Close modals when clicking outside of them
    window.addEventListener('click', function(event) {
        const playerModal = document.getElementById('player-card-modal');
        if (event.target === playerModal) closePlayerCard();
        if (loginModal && event.target === loginModal) closeLoginModal();
    });

    // Focus trap for modals
    const focusableSelector = 'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';
    function activateFocusTrap(modal) {
        activeModal = modal;
        const focusables = modal.querySelectorAll(focusableSelector);
        if (focusables.length) {
            const first = focusables[0];
            first.focus();
        }
    }

    function handleFocusTrap(e) {
        if (!activeModal) return;
        if (e.key !== 'Tab') return;
        const focusables = activeModal.querySelectorAll(focusableSelector);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    document.addEventListener('keydown', handleFocusTrap);
});

// Global functions for modal controls
window.closePlayerCard = function() {
    document.getElementById('player-card-modal').style.display = 'none';
    activeModal = null;
};

// Login modal functions
window.closeLoginModal = function() {
    document.getElementById('login-modal').style.display = 'none';
    activeModal = null;
};

window.showResetPassword = function() {
    // TODO: Implement password reset functionality
    alert('Password reset functionality coming soon!');
};
