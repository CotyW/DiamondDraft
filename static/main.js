document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const calculateBtn = document.getElementById('calculate-btn');
    const playersTable = document.getElementById('players-table');
    const playersBody = document.getElementById('players-body');
    const tableContainer = document.querySelector('.table-container');
    const positionFilter = document.getElementById('position-filter');
    const yearBtns = document.querySelectorAll('.year-btn');
    const playerSearch = document.getElementById('player-search');
    const dataTimestamp = document.getElementById('data-timestamp');
    const loginBtn = document.getElementById('login-btn');
    const loginModal = document.getElementById('login-modal');
    const loginForm = document.getElementById('login-form');
    const siteHeader = document.querySelector('.site-header');
    const logoEl = document.querySelector('.logo');
    let activeModal = null;
    
    // State variables
    const INITIAL_SEASONS = [2024, 2025];
    const loadedSeasons = new Set(INITIAL_SEASONS.map(String));
    const playerCardCache = new Map();
    let allPlayers = [];
    let displayedPlayers = [];
    let currentYear = '2025';
    let dataType = 'actual'; // 'actual' or 'projected'
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
    
    // Get all scoring input elements
    const scoringInputs = [
        'hits', 'runs', 'rbi', 'steals', 'hr', 
        'wins', 'runs_scored', 'strikeouts', 'walks', 'saves'
    ].map(id => document.getElementById(id));
    
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
    calculateBtn.addEventListener('click', calculatePlayerValues);
    
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
    
    // Year toggle buttons
    yearBtns.forEach(btn => {
        btn.addEventListener('click', async function() {
            yearBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const yearData = this.dataset.year;
            if (yearData.includes('_')) {
                const [year, type] = yearData.split('_');
                currentYear = year;
                dataType = type;
            } else {
                currentYear = yearData;
                dataType = 'actual';
            }
            await ensureSeasonLoaded(currentYear);
            
            // Recalculate points for new year selection
            calculatePlayerValues();
        });
    });
    
    // Table header sorting - improved with debugging
    const sortableHeaders = playersTable.querySelectorAll('th[data-sort]');
    console.log(`Found ${sortableHeaders.length} sortable headers`);
    
    sortableHeaders.forEach(th => {
        // Add visual indicator that header is clickable
        th.style.cursor = 'pointer';
        
        // Clean up and re-add event listener to prevent duplicates
        const oldTh = th.cloneNode(true);
        th.parentNode.replaceChild(oldTh, th);
        
        oldTh.addEventListener('click', function() {
            console.log(`Sorting by: ${this.dataset.sort}`);
            const column = this.dataset.sort;
            
            // Clear previous sort indicators
            playersTable.querySelectorAll('th').forEach(header => {
                header.classList.remove('sort-asc', 'sort-desc');
            });
            
            // If clicking the same column, reverse the direction
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'desc'; // Default to descending
            }
            
            console.log(`Sort direction: ${currentSort.direction}`);
            
            // Add sort indicator to the clicked header
            this.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            
            // Force browser to recognize style changes (sometimes needed)
            this.offsetHeight;
            
            sortAndDisplayPlayers();
        });
    });
    
    // Helper function to get the index of the currently sorted column
    function getSortColumnIndex(columnName) {
        // Map column names to their index in the table
        const columnMap = {
            'name': 0,
            'team': 1,
            'position': 2,
            'hits': 3,
            'avg': 4,
            'babip': 5,
            'runs': 6,
            'rbi': 7,
            'steals': 8,
            'hr': 9,
            'wins': 10,
            'runs_scored': 11,
            'era': 12,
            'fip': 13,
            'strikeouts': 14,
            'walks': 15,
            'saves': 16,
            'points': 17
        };
        
        return columnMap[columnName] !== undefined ? columnMap[columnName] : -1;
    }
    
    // Functions
    async function loadData(filter = 'all') {
        try {
            // Fetch players with stats from Supabase (initial seasons only)
            allPlayers = await fetchPlayersWithStats(filter, INITIAL_SEASONS);
            loadedSeasons.clear();
            INITIAL_SEASONS.forEach(season => loadedSeasons.add(String(season)));
            
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
            } else {
                allPlayers.push(np);
            }
        });

        loadedSeasons.add(yearStr);
    }
    
    function calculatePlayerValues() {
        // Get weights from input fields
        const weights = {};
        scoringInputs.forEach(input => {
            weights[input.id] = parseFloat(input.value) || 0;
        });
        
        // Calculate points for each player
        displayedPlayers = allPlayers.map(player => {
            const playerCopy = {...player};
            
            // Pick stats for selected year
            const seasonStats = player.stats_by_season ? player.stats_by_season[currentYear] : null;
            let stats;
            let points = 0;
            
            // Calculate points based on player type
            if (!player.is_pitcher) {  // Batter
                stats = seasonStats ? seasonStats.batting : {};
                points += (stats.hits || 0) * weights.hits;
                points += (stats.runs || 0) * weights.runs;
                points += (stats.rbi || 0) * weights.rbi;
                points += (stats.steals || 0) * weights.steals;
                points += (stats.hr || 0) * weights.hr;
            } else {  // Pitcher
                stats = seasonStats ? seasonStats.pitching : {};
                points += (stats.wins || 0) * weights.wins;
                // For runs_scored (ERA proxy), lower is better, so we invert
                if (weights.runs_scored !== 0) {
                    points += (50 - (stats.era || 0)) * weights.runs_scored / 10;
                }
                points += (stats.strikeouts || 0) * weights.strikeouts;
                // For walks, lower is better, so we invert
                if (weights.walks !== 0) {
                    points += (100 - (stats.walks || 0)) * weights.walks / 100;
                }
                points += (stats.saves || 0) * weights.saves;
            }
            
            // Add points to the result
            playerCopy.points = Math.round(points * 100) / 100;
            return playerCopy;
        });
        
        // Apply filters and display
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
        // Get all header elements
        const battingHeaders = document.querySelectorAll('th.batting-stat');
        const pitchingHeaders = document.querySelectorAll('th.pitching-stat');
        
        // Handle header visibility based on filter
        if (filter === 'batter') {
            // Show batting headers, hide pitching headers
            battingHeaders.forEach(header => header.style.display = 'table-cell');
            pitchingHeaders.forEach(header => header.style.display = 'none');
        } else if (filter === 'pitcher') {
            // Show pitching headers, hide batting headers
            battingHeaders.forEach(header => header.style.display = 'none');
            pitchingHeaders.forEach(header => header.style.display = 'table-cell');
        } else {
            // Show all headers in "all players" view
            battingHeaders.forEach(header => header.style.display = 'table-cell');
            pitchingHeaders.forEach(header => header.style.display = 'table-cell');
        }
    }
    
    function sortPlayers(players) {
        console.log(`Sorting ${players.length} players by ${currentSort.column} (${currentSort.direction})`);
        
        // Create a copy to avoid modifying the original array
        const sortedPlayers = [...players];
        
        sortedPlayers.sort((a, b) => {
            let aValue, bValue;
            
            if (currentSort.column === 'name' || currentSort.column === 'team' || currentSort.column === 'position') {
                aValue = a[currentSort.column] || '';
                bValue = b[currentSort.column] || '';
            } else if (currentSort.column === 'points') {
                aValue = a.points || 0;
                bValue = b.points || 0;
            } else {
                const aSeason = a.stats_by_season ? a.stats_by_season[currentYear] : null;
                const bSeason = b.stats_by_season ? b.stats_by_season[currentYear] : null;
                const aStats = (a.is_pitcher ? aSeason?.pitching : aSeason?.batting) || {};
                const bStats = (b.is_pitcher ? bSeason?.pitching : bSeason?.batting) || {};
                
                aValue = aStats[currentSort.column] || 0;
                bValue = bStats[currentSort.column] || 0;
            }
            
            // Null/undefined check
            if (aValue === null || aValue === undefined) aValue = 0;
            if (bValue === null || bValue === undefined) bValue = 0;
            
            // Log a few examples of the sorting values (avoid flooding the console)
            if (Math.random() < 0.01) {
                console.log(`Sorting example: ${a.name} (${aValue}) vs ${b.name} (${bValue})`);
            }
            
            // Handle special cases for sorting
            if ((currentSort.column === 'era' || currentSort.column === 'fip') && aValue > 0 && bValue > 0) {
                // For ERA and FIP, lower is better, so reverse the comparison
                return currentSort.direction === 'asc' ? 
                    aValue - bValue : bValue - aValue;
            }
            
            // Standard sorting
            let result;
            if (typeof aValue === 'string') {
                result = currentSort.direction === 'asc' ? 
                    aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            } else {
                result = currentSort.direction === 'asc' ? 
                    aValue - bValue : bValue - aValue;
            }
            
            return result;
        });
        
        // Replace the original array content with the sorted content
        // This ensures the displayed players are updated
        while (players.length) players.pop();
        sortedPlayers.forEach(player => players.push(player));
        
        console.log('Sorting complete');
        return players;
    }
    
    function sortAndDisplayPlayers() {
        console.log('Running sortAndDisplayPlayers');
        sortPlayers(displayedPlayers);
        renderPlayersTable(displayedPlayers, positionFilter.value);
        
        // Add visual indicator for the current sort column
        const currentSortHeader = document.querySelector(`th[data-sort="${currentSort.column}"]`);
        if (currentSortHeader) {
            currentSortHeader.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
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
        const battingStats = seasonStats ? seasonStats.batting : {};
        const pitchingStats = seasonStats ? seasonStats.pitching : {};

        const stats = {
            hits: battingStats.hits || 0,
            avg: battingStats.avg || 0,
            babip: battingStats.babip || 0,
            runs: battingStats.runs || 0,
            rbi: battingStats.rbi || 0,
            steals: battingStats.steals || 0,
            hr: battingStats.hr || 0,
            wins: pitchingStats.wins || 0,
            runs_scored: pitchingStats.era || 0,
            era: pitchingStats.era || 0,
            fip: 0,
            strikeouts: pitchingStats.strikeouts || 0,
            walks: pitchingStats.walks || 0,
            saves: pitchingStats.saves || 0
        };

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

        if (filterValue === 'pitcher') {
            cells.push(`<td class="batting-stat" style="display: none">${stats.hits || 0}</td>`);
            cells.push(`<td class="batting-stat" style="display: none">${(stats.avg || 0).toFixed(3)}</td>`);
            cells.push(`<td class="batting-stat" style="display: none">${(stats.babip || 0).toFixed(3)}</td>`);
            cells.push(`<td class="batting-stat" style="display: none">${stats.runs || 0}</td>`);
            cells.push(`<td class="batting-stat" style="display: none">${stats.rbi || 0}</td>`);
            cells.push(`<td class="batting-stat" style="display: none">${stats.steals || 0}</td>`);
            cells.push(`<td class="batting-stat" style="display: none">${stats.hr || 0}</td>`);
        } else if (filterValue === 'all' && player.is_pitcher) {
            cells.push(`<td class="batting-stat">-</td>`);
            cells.push(`<td class="batting-stat">-</td>`);
            cells.push(`<td class="batting-stat">-</td>`);
            cells.push(`<td class="batting-stat">-</td>`);
            cells.push(`<td class="batting-stat">-</td>`);
            cells.push(`<td class="batting-stat">-</td>`);
            cells.push(`<td class="batting-stat">-</td>`);
        } else {
            cells.push(`<td class="batting-stat">${stats.hits || 0}</td>`);
            cells.push(`<td class="batting-stat">${(stats.avg || 0).toFixed(3)}</td>`);
            cells.push(`<td class="batting-stat">${(stats.babip || 0).toFixed(3)}</td>`);
            cells.push(`<td class="batting-stat">${stats.runs || 0}</td>`);
            cells.push(`<td class="batting-stat">${stats.rbi || 0}</td>`);
            cells.push(`<td class="batting-stat">${stats.steals || 0}</td>`);
            cells.push(`<td class="batting-stat">${stats.hr || 0}</td>`);
        }

        if (filterValue === 'batter') {
            cells.push(`<td class="pitching-stat" style="display: none">${stats.wins || 0}</td>`);
            cells.push(`<td class="pitching-stat" style="display: none">${stats.runs_scored || 0}</td>`);
            cells.push(`<td class="pitching-stat" style="display: none">${(stats.era || 0).toFixed(2)}</td>`);
            cells.push(`<td class="pitching-stat" style="display: none">${(stats.fip || 0).toFixed(2)}</td>`);
            cells.push(`<td class="pitching-stat" style="display: none">${stats.strikeouts || 0}</td>`);
            cells.push(`<td class="pitching-stat" style="display: none">${stats.walks || 0}</td>`);
            cells.push(`<td class="pitching-stat" style="display: none">${stats.saves || 0}</td>`);
        } else if (filterValue === 'all' && !player.is_pitcher) {
            cells.push(`<td class="pitching-stat">-</td>`);
            cells.push(`<td class="pitching-stat">-</td>`);
            cells.push(`<td class="pitching-stat">-</td>`);
            cells.push(`<td class="pitching-stat">-</td>`);
            cells.push(`<td class="pitching-stat">-</td>`);
            cells.push(`<td class="pitching-stat">-</td>`);
            cells.push(`<td class="pitching-stat">-</td>`);
        } else {
            cells.push(`<td class="pitching-stat">${stats.wins || 0}</td>`);
            cells.push(`<td class="pitching-stat">${stats.runs_scored || 0}</td>`);
            cells.push(`<td class="pitching-stat">${(stats.era || 0).toFixed(2)}</td>`);
            cells.push(`<td class="pitching-stat">${(stats.fip || 0).toFixed(2)}</td>`);
            cells.push(`<td class="pitching-stat">${stats.strikeouts || 0}</td>`);
            cells.push(`<td class="pitching-stat">${stats.walks || 0}</td>`);
            cells.push(`<td class="pitching-stat">${stats.saves || 0}</td>`);
        }

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

        const cacheKey = `${playerId}-${currentYear}-${dataType}`;

        const modal = document.getElementById('player-card-modal');
        const container = document.getElementById('player-card-container');
        if (playerCardCache.has(cacheKey)) {
            container.innerHTML = playerCardCache.get(cacheKey);
            modal.style.display = 'block';
            activeModal = modal;
            activateFocusTrap(modal);
            return;
        }
        

        // Get current stats based on year and data type
        const statsKey = {
            '2024': 'stats_2024',
            '2025': 'stats_2025_actual',
            '2026': 'stats_2026_actual',
            '2027': 'stats_2027_projected'
        }[currentYear];
        let stats = player[statsKey];

        if (!stats) {
            stats = {
                hits: 0, avg: 0, babip: 0, runs: 0, rbi: 0, steals: 0, hr: 0,
                wins: 0, runs_scored: 0, era: 0, fip: 0, strikeouts: 0, walks: 0, saves: 0
            };
        }

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
                    ${player.is_pitcher ? `
                        <div class="stats-section">
                            <h3>Pitching Stats (${currentYear})</h3>
                            <div class="stats-grid">
                                <div class="stat-item">
                                    <span class="stat-label">Wins</span>
                                    <span class="stat-value">${stats.wins || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Runs</span>
                                    <span class="stat-value">${stats.runs_scored || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">ERA</span>
                                    <span class="stat-value">${(stats.era || 0).toFixed(2)}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">FIP</span>
                                    <span class="stat-value">${(stats.fip || 0).toFixed(2)}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Strikeouts</span>
                                    <span class="stat-value">${stats.strikeouts || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Walks</span>
                                    <span class="stat-value">${stats.walks || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Saves</span>
                                    <span class="stat-value">${stats.saves || 0}</span>
                                </div>
                            </div>
                        </div>
                    ` : `
                        <div class="stats-section">
                            <h3>Batting Stats (${currentYear})</h3>
                            <div class="stats-grid">
                                <div class="stat-item">
                                    <span class="stat-label">Hits</span>
                                    <span class="stat-value">${stats.hits || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Average</span>
                                    <span class="stat-value">${(stats.avg || 0).toFixed(3)}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">BABIP</span>
                                    <span class="stat-value">${(stats.babip || 0).toFixed(3)}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Runs</span>
                                    <span class="stat-value">${stats.runs || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">RBI</span>
                                    <span class="stat-value">${stats.rbi || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Steals</span>
                                    <span class="stat-value">${stats.steals || 0}</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Home Runs</span>
                                    <span class="stat-value">${stats.hr || 0}</span>
                                </div>
                            </div>
                        </div>
                    `}
                    
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
