/**
 * DiamondDraft - Baseball Player Value Calculator
 * 
 * This script handles the functionality of the DiamondDraft application,
 * including loading player data, calculating values, sorting, and filtering.
 */

document.addEventListener('DOMContentLoaded', function() {
    // ====================================
    // DOM ELEMENT REFERENCES
    // ====================================
    const DOM = {
        calculateBtn: document.getElementById('calculate-btn'),
        playersTable: document.getElementById('players-table'),
        playersBody: document.getElementById('players-body'),
        positionFilter: document.getElementById('position-filter'),
        yearBtns: document.querySelectorAll('.year-btn'),
        playerSearch: document.getElementById('player-search'),
        dataTimestamp: document.getElementById('data-timestamp'),
        sortableHeaders: document.querySelectorAll('th[data-sort]')
    };
    
    // ====================================
    // STATE MANAGEMENT
    // ====================================
    const state = {
        allPlayers: [],
        displayedPlayers: [],
        currentYear: '2024',
        dataType: 'actual', // 'actual' or 'projected'
        currentSort: {column: 'points', direction: 'desc'},
        searchTerm: '',
        
        // Map for column index lookup
        columnMap: {
            'name': 0,
            'team': 1,
            'position': 2,
            'avg': 3,
            'runs': 4,
            'rbi': 5,
            'steals': 6,
            'hr': 7,
            'wins': 8,
            'era': 9,
            'strikeouts': 10,
            'walks': 11,
            'saves': 12,
            'points': 13
        },
        
        // Get weights from inputs
        getWeights: function() {
            const weights = {};
            scoringInputs.forEach(input => {
                weights[input.id] = parseFloat(input.value) || 0;
            });
            return weights;
        }
    };
    
    // Get all scoring input elements
    const scoringInputs = [
        'avg', 'runs', 'rbi', 'steals', 'hr', 
        'wins', 'era', 'strikeouts', 'walks', 'saves'
    ].map(id => document.getElementById(id));
    
    // ====================================
    // EVENT HANDLERS
    // ====================================
    function setupEventListeners() {
        // Calculate button
        DOM.calculateBtn.addEventListener('click', calculatePlayerValues);
        
        // Position filter
        DOM.positionFilter.addEventListener('change', filterAndDisplayPlayers);
        
        // Search input
        DOM.playerSearch.addEventListener('input', function() {
            state.searchTerm = this.value.toLowerCase();
            filterAndDisplayPlayers();
        });
        
        // Year toggle buttons
        DOM.yearBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                // Update UI
                DOM.yearBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                
                // Update state
                const yearData = this.dataset.year;
                if (yearData.includes('_')) {
                    const [year, type] = yearData.split('_');
                    state.currentYear = year;
                    state.dataType = type;
                } else {
                    state.currentYear = yearData;
                    state.dataType = 'actual';
                }
                
                filterAndDisplayPlayers();
            });
        });
        
        // Set up table header sorting
        setupTableSorting();
    }
    
    function setupTableSorting() {
        DOM.sortableHeaders.forEach(th => {
            // Make header visually appear clickable
            th.style.cursor = 'pointer';
            
            // Add event listener
            th.addEventListener('click', function() {
                const column = this.dataset.sort;
                
                // Clear previous sort indicators
                clearSortIndicators();
                
                // Update sort state
                if (state.currentSort.column === column) {
                    state.currentSort.direction = state.currentSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    state.currentSort.column = column;
                    state.currentSort.direction = 'desc'; // Default to descending
                }
                
                // Update UI to show sort direction
                this.classList.add(state.currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
                
                // Force browser to recognize style changes
                this.offsetHeight;
                
                // Execute the sort
                sortAndDisplayPlayers();
            });
        });
    }
    
    // ====================================
    // DATA HANDLING FUNCTIONS
    // ====================================
    async function loadData() {
        try {
            // Fetch player data
            const response = await fetch('./data/players.json');
            state.allPlayers = await response.json();
            
            // Fetch last updated timestamp
            const timestampResponse = await fetch('./data/last_updated.json');
            const timestampData = await timestampResponse.json();
            
            // Format and display timestamp
            const lastUpdated = new Date(timestampData.timestamp);
            DOM.dataTimestamp.textContent = `Last updated: ${lastUpdated.toLocaleDateString()} at ${lastUpdated.toLocaleTimeString()}`;
            
            // Calculate player values with default weights
            calculatePlayerValues();
            
            // Initialize column visibility
            updateColumnVisibility();
            
        } catch (error) {
            console.error('Error loading data:', error);
            DOM.dataTimestamp.textContent = 'Error loading data. Please try again later.';
        }
    }
    
    function calculatePlayerValues() {
        const weights = state.getWeights();
        
        // Calculate points for each player
        state.displayedPlayers = state.allPlayers.map(player => {
            const playerCopy = {...player};
            
            // Get the correct stats based on state
            const stats = getPlayerStats(playerCopy);
            
            // Calculate points
            let points = 0;
            
            if (!player.is_pitcher) {
                // Batter scoring
                points += calculateBatterPoints(stats, weights);
            } else {
                // Pitcher scoring
                points += calculatePitcherPoints(stats, weights);
            }
            
            // Add points to the result (rounded to 2 decimal places)
            playerCopy.points = Math.round(points * 100) / 100;
            return playerCopy;
        });
        
        // Apply filters and display
        filterAndDisplayPlayers();
    }
    
    function getPlayerStats(player) {
        // Get the correct stats based on year and data type
        let stats;
        
        if (state.currentYear === '2025') {
            stats = state.dataType === 'actual' ? player.stats_2025_actual : player.stats_2025_projected;
        } else {
            stats = player.stats_2024;
        }
        
        // Return stats with defaults for missing values
        return stats || {
            avg: 0, runs: 0, rbi: 0, steals: 0, hr: 0,
            wins: 0, era: 0, strikeouts: 0, walks: 0, saves: 0
        };
    }
    
    function calculateBatterPoints(stats, weights) {
        let points = 0;
        points += (stats.avg || 0) * weights.avg;
        points += (stats.runs || 0) * weights.runs;
        points += (stats.rbi || 0) * weights.rbi;
        points += (stats.steals || 0) * weights.steals;
        points += (stats.hr || 0) * weights.hr;
        return points;
    }
    
    function calculatePitcherPoints(stats, weights) {
        let points = 0;
        points += (stats.wins || 0) * weights.wins;
        
        // For ERA, lower is better, so we invert the weight
        if (weights.era !== 0) {
            points += (5.0 - (stats.era || 0)) * weights.era;  // 5.0 is a baseline ERA
        }
        
        points += (stats.strikeouts || 0) * weights.strikeouts;
        
        // For walks, lower is better, so we invert the weight
        if (weights.walks !== 0) {
            points += (100 - (stats.walks || 0)) * weights.walks / 100;  // Normalize walks
        }
        
        points += (stats.saves || 0) * weights.saves;
        return points;
    }
    
    // ====================================
    // UI MANIPULATION FUNCTIONS
    // ====================================
    function filterAndDisplayPlayers() {
        let filteredPlayers = [...state.displayedPlayers];
        
        // Apply position filter
        const filterValue = DOM.positionFilter.value;
        filteredPlayers = applyPositionFilter(filteredPlayers, filterValue);
        
        // Apply search filter
        if (state.searchTerm) {
            filteredPlayers = applySearchFilter(filteredPlayers, state.searchTerm);
        }
        
        // Sort and display
        sortPlayers(filteredPlayers);
        renderPlayersTable(filteredPlayers);
        updateColumnVisibility();
    }
    
    function applyPositionFilter(players, filterValue) {
        if (filterValue === 'batter') {
            return players.filter(player => !player.is_pitcher);
        } else if (filterValue === 'pitcher') {
            return players.filter(player => player.is_pitcher);
        }
        return players; // 'all' position returns all players
    }
    
    function applySearchFilter(players, term) {
        return players.filter(player => 
            player.name.toLowerCase().includes(term) ||
            player.team.toLowerCase().includes(term) ||
            player.position.toLowerCase().includes(term)
        );
    }
    
    function updateColumnVisibility() {
        const filterValue = DOM.positionFilter.value;
        const selectors = {
            battingHeaders: document.querySelectorAll('th.batting-stat'),
            pitchingHeaders: document.querySelectorAll('th.pitching-stat'),
            battingCells: document.querySelectorAll('td.batting-stat'),
            pitchingCells: document.querySelectorAll('td.pitching-stat')
        };
        
        // Apply visibility classes based on filter
        if (filterValue === 'batter') {
            toggleColumnVisibility(selectors, true, false);
        } else if (filterValue === 'pitcher') {
            toggleColumnVisibility(selectors, false, true);
        } else {
            toggleColumnVisibility(selectors, true, true);
        }
    }
    
    function toggleColumnVisibility(selectors, showBatting, showPitching) {
        toggleElementsVisibility(selectors.battingHeaders, showBatting);
        toggleElementsVisibility(selectors.pitchingHeaders, showPitching);
        toggleElementsVisibility(selectors.battingCells, showBatting);
        toggleElementsVisibility(selectors.pitchingCells, showPitching);
    }
    
    function toggleElementsVisibility(elements, show) {
        elements.forEach(el => {
            if (show) {
                el.classList.remove('hide-column');
            } else {
                el.classList.add('hide-column');
            }
        });
    }
    
    function clearSortIndicators() {
        DOM.playersTable.querySelectorAll('th').forEach(header => {
            header.classList.remove('sort-asc', 'sort-desc');
        });
    }
    
    // ====================================
    // SORTING FUNCTIONS
    // ====================================
    function sortPlayers(players) {
        const { column, direction } = state.currentSort;
        
        // Create a copy to avoid modifying the original array
        const sortedPlayers = [...players];
        
        sortedPlayers.sort((a, b) => {
            let aValue, bValue;
            
            if (column === 'name' || column === 'team' || column === 'position') {
                // Sort by player attribute
                aValue = a[column] || '';
                bValue = b[column] || '';
            } else if (column === 'points') {
                // Sort by calculated points
                aValue = a.points || 0;
                bValue = b.points || 0;
            } else {
                // Sort by stat value
                const aStats = getPlayerStats(a);
                const bStats = getPlayerStats(b);
                
                aValue = aStats[column] || 0;
                bValue = bStats[column] || 0;
            }
            
            // Special case for ERA (lower is better)
            if (column === 'era' && aValue > 0 && bValue > 0) {
                return direction === 'asc' ? aValue - bValue : bValue - aValue;
            }
            
            // Standard sorting
            if (typeof aValue === 'string') {
                return direction === 'asc' ? 
                    aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            } else {
                return direction === 'asc' ? aValue - bValue : bValue - aValue;
            }
        });
        
        // Update the players array in place
        players.length = 0;
        sortedPlayers.forEach(player => players.push(player));
        
        return players;
    }
    
    function sortAndDisplayPlayers() {
        sortPlayers(state.displayedPlayers);
        renderPlayersTable(state.displayedPlayers);
        
        // Add visual indicator for the current sort column
        const currentSortHeader = document.querySelector(`th[data-sort="${state.currentSort.column}"]`);
        if (currentSortHeader) {
            currentSortHeader.classList.add(state.currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    }
    
    // ====================================
    // RENDERING FUNCTIONS
    // ====================================
    function renderPlayersTable(playersData) {
        // Clear table
        DOM.playersBody.innerHTML = '';
        
        // Get current filter
        const filterValue = DOM.positionFilter.value;
        
        // Add players to table
        playersData.forEach(player => {
            const row = document.createElement('tr');
            
            // Get the stats for display
            const stats = getPlayerStats(player);
            
            // Create the row HTML
            row.innerHTML = createPlayerRowHTML(player, stats);
            
            // Highlight the sorted column
            highlightSortedColumn(row);
            
            // Apply visibility classes based on filter
            applyFilterClasses(row, player.is_pitcher, filterValue);
            
            // Add to the table
            DOM.playersBody.appendChild(row);
        });
    }
    
    function createPlayerRowHTML(player, stats) {
        return `
            <td>${player.name || ''}</td>
            <td>${player.team || ''}</td>
            <td>${player.position || ''}</td>
            <td class="batting-stat">${(stats.avg || 0).toFixed(3)}</td>
            <td class="batting-stat">${stats.runs || 0}</td>
            <td class="batting-stat">${stats.rbi || 0}</td>
            <td class="batting-stat">${stats.steals || 0}</td>
            <td class="batting-stat">${stats.hr || 0}</td>
            <td class="pitching-stat">${stats.wins || 0}</td>
            <td class="pitching-stat">${(stats.era || 0).toFixed(2)}</td>
            <td class="pitching-stat">${stats.strikeouts || 0}</td>
            <td class="pitching-stat">${stats.walks || 0}</td>
            <td class="pitching-stat">${stats.saves || 0}</td>
            <td class="points-column">${player.points || 0}</td>
        `;
    }
    
    function highlightSortedColumn(row) {
        const sortColumnIndex = state.columnMap[state.currentSort.column];
        if (sortColumnIndex !== -1) {
            const cells = row.querySelectorAll('td');
            if (cells[sortColumnIndex]) {
                cells[sortColumnIndex].classList.add('sorted-column');
            }
        }
    }
    
    function applyFilterClasses(row, isPitcher, filterValue) {
        // Apply hide-column class based on filter
        if (filterValue === 'batter') {
            row.querySelectorAll('.pitching-stat').forEach(cell => {
                cell.classList.add('hide-column');
            });
        } else if (filterValue === 'pitcher') {
            row.querySelectorAll('.batting-stat').forEach(cell => {
                cell.classList.add('hide-column');
            });
        } else if (filterValue === 'all') {
            // For "all" view, dim irrelevant stats
            if (isPitcher) {
                row.querySelectorAll('.batting-stat').forEach(cell => {
                    cell.style.opacity = '0.3';
                });
            } else {
                row.querySelectorAll('.pitching-stat').forEach(cell => {
                    cell.style.opacity = '0.3';
                });
            }
        }
    }
    
    // ====================================
    // INITIALIZATION
    // ====================================
    function init() {
        setupEventListeners();
        loadData();
    }
    
    // Start the application
    init();
});