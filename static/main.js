document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const calculateBtn = document.getElementById('calculate-btn');
    const playersTable = document.getElementById('players-table');
    const playersBody = document.getElementById('players-body');
    const positionFilter = document.getElementById('position-filter');
    const yearBtns = document.querySelectorAll('.year-btn');
    const playerSearch = document.getElementById('player-search');
    const dataTimestamp = document.getElementById('data-timestamp');
    
    // State variables
    let allPlayers = [];
    let displayedPlayers = [];
    let currentYear = '2024';
    let dataType = 'actual'; // 'actual' or 'projected'
    let currentSort = {column: 'points', direction: 'desc'};
    let searchTerm = '';
    
    // Get all scoring input elements
    const scoringInputs = [
        'hits', 'runs', 'rbi', 'steals', 'hr', 
        'wins', 'runs_scored', 'strikeouts', 'walks', 'saves'
    ].map(id => document.getElementById(id));
    
    // Initialize app
    loadData();
    
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
    positionFilter.addEventListener('change', async function() {
        const filterValue = this.value;
        await loadData(filterValue);
        filterAndDisplayPlayers();
    });
    
    // Search input
    playerSearch.addEventListener('input', function() {
        searchTerm = this.value.toLowerCase();
        filterAndDisplayPlayers();
    });
    
    // Year toggle buttons
    yearBtns.forEach(btn => {
        btn.addEventListener('click', function() {
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
            
            filterAndDisplayPlayers();
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
            // Determine which data file to fetch based on filter
            let dataFile;
            switch(filter) {
                case 'batter':
                    dataFile = './data/batters.json';
                    break;
                case 'pitcher':
                    dataFile = './data/pitchers.json';
                    break;
                default:
                    dataFile = './data/players.json';
            }
            
            // Fetch player data
            const response = await fetch(dataFile);
            if (!response.ok) {
                // If separated files don't exist, fall back to combined file
                console.warn(`Could not load ${dataFile}, falling back to players.json`);
                const fallbackResponse = await fetch('./data/players.json');
                allPlayers = await fallbackResponse.json();
                
                // Filter the data manually if we're using the fallback
                if (filter === 'batter') {
                    allPlayers = allPlayers.filter(player => !player.is_pitcher);
                } else if (filter === 'pitcher') {
                    allPlayers = allPlayers.filter(player => player.is_pitcher);
                }
            } else {
                allPlayers = await response.json();
            }
            
            // Fetch last updated timestamp
            const timestampResponse = await fetch('./data/last_updated.json');
            const timestampData = await timestampResponse.json();
            
            // Format and display timestamp
            const lastUpdated = new Date(timestampData.timestamp);
            dataTimestamp.textContent = `Last updated: ${lastUpdated.toLocaleDateString()} at ${lastUpdated.toLocaleTimeString()}`;
            
            // Calculate player values with default weights
            calculatePlayerValues();
            
            // Initialize column visibility based on filter
            updateColumnVisibility(filter);
            
        } catch (error) {
            console.error('Error loading data:', error);
            dataTimestamp.textContent = 'Error loading data. Please try again later.';
        }
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
            
            // Get the correct stats based on year and data type
            let stats;
            if (currentYear === '2025') {
                stats = dataType === 'actual' ? playerCopy.stats_2025_actual : playerCopy.stats_2025_projected;
            } else {
                stats = playerCopy.stats_2024;
            }
            
            // Make sure stats object exists with proper defaults
            if (!stats) {
                console.warn(`Stats missing for player: ${player.name}, year: ${currentYear}, type: ${dataType}`);
                stats = {
                    hits: 0,
                    avg: 0,
                    babip: 0,
                    runs: 0,
                    rbi: 0,
                    steals: 0,
                    hr: 0,
                    wins: 0,
                    runs_scored: 0,
                    era: 0,
                    fip: 0,
                    strikeouts: 0,
                    walks: 0,
                    saves: 0
                };
            }
            
            let points = 0;
            
            // Calculate points based on weights
            if (!player.is_pitcher) {  // Batter
                points += (stats.hits || 0) * weights.hits;
                points += (stats.runs || 0) * weights.runs;
                points += (stats.rbi || 0) * weights.rbi;
                points += (stats.steals || 0) * weights.steals;
                points += (stats.hr || 0) * weights.hr;
            } else {  // Pitcher
                points += (stats.wins || 0) * weights.wins;
                // For runs_scored (replacing ERA), lower is better, so we invert the weight
                if (weights.runs_scored !== 0) {
                    points += (50 - (stats.runs_scored || 0)) * weights.runs_scored / 10;  // 50 is a baseline runs
                }
                points += (stats.strikeouts || 0) * weights.strikeouts;
                // For walks, lower is better, so we invert the weight
                if (weights.walks !== 0) {
                    points += (100 - (stats.walks || 0)) * weights.walks / 100;  // Normalize walks
                }
                points += (stats.saves || 0) * weights.saves;
            }
            
            // Add points to the result
            playerCopy.points = Math.round(points * 100) / 100;  // Round to 2 decimal places
            return playerCopy;
        });
        
        // Apply filters and display
        filterAndDisplayPlayers();
    }
    
    function filterAndDisplayPlayers() {
        let filteredPlayers = [...displayedPlayers];
        
        // Apply search filter (position filtering is now handled by data loading)
        if (searchTerm) {
            filteredPlayers = filteredPlayers.filter(player => 
                player.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.team.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.position.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        
        // Sort filtered players
        sortPlayers(filteredPlayers);
        
        // Display filtered & sorted players
        const filterValue = positionFilter.value;
        renderPlayersTable(filteredPlayers, filterValue);
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
                // Get the correct stats based on year and data type
                let aStats, bStats;
                
                if (currentYear === '2025') {
                    aStats = dataType === 'actual' ? a.stats_2025_actual : a.stats_2025_projected;
                    bStats = dataType === 'actual' ? b.stats_2025_actual : b.stats_2025_projected;
                } else {
                    aStats = a.stats_2024;
                    bStats = b.stats_2024;
                }
                
                // Handle missing stats objects
                if (!aStats) {
                    aStats = {};
                    console.warn(`Missing stats for sorting: ${a.name}, year: ${currentYear}, type: ${dataType}`);
                }
                
                if (!bStats) {
                    bStats = {};
                    console.warn(`Missing stats for sorting: ${b.name}, year: ${currentYear}, type: ${dataType}`);
                }
                
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
            const rows = selectedPlayers.map(id => 
                Array.from(playersBody.rows).find(row => 
                    row.querySelector(`input[data-player-id="${id}"]`)
                )
            ).filter(Boolean);
            
            if (rows.length === 2) {
                window.showComparisonModal(rows);
            }
        }
    }

    function renderPlayersTable(playersData, filterValue) {
        playersBody.innerHTML = '';
        
        playersData.forEach((player) => {
            const row = document.createElement('tr');
            row.setAttribute('data-is-pitcher', player.is_pitcher);
            
            // Get the correct stats based on year and data type
            let stats;
            if (currentYear === '2025') {
                stats = dataType === 'actual' ? player.stats_2025_actual : player.stats_2025_projected;
            } else {
                stats = player.stats_2024;
            }
            
            // Make sure stats object exists with proper defaults
            if (!stats) {
                stats = {
                    hits: 0, avg: 0, babip: 0, runs: 0, rbi: 0, steals: 0, hr: 0,
                    wins: 0, runs_scored: 0, era: 0, fip: 0, strikeouts: 0, walks: 0, saves: 0
                };
            }
            
            // Create checkbox cell
            const lastCell = document.createElement('td');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'compare-checkbox';
            checkbox.setAttribute('data-player-id', player.id);
            checkbox.checked = selectedPlayers.includes(String(player.id));
            checkbox.addEventListener('change', handleCheckboxChange);
            lastCell.appendChild(checkbox);
            
            // Create all cells for the row in exact order to match headers
            const cells = [];
            
            // Add basic info cells (3 cells)
            cells.push(`<td><a href="#" class="player-name-link" data-player-id="${player.id}">${player.name || ''}</a></td>`);
            cells.push(`<td>${player.team || ''}</td>`);
            cells.push(`<td>${player.position || ''}</td>`);
            
            // Add batting stat cells (7 cells) - always add but hide for pitchers
            if (filterValue === 'pitcher') {
                // Pitcher-only view: hide all batting columns
                cells.push(`<td class="batting-stat" style="display: none">${stats.hits || 0}</td>`);
                cells.push(`<td class="batting-stat" style="display: none">${(stats.avg || 0).toFixed(3)}</td>`);
                cells.push(`<td class="batting-stat" style="display: none">${(stats.babip || 0).toFixed(3)}</td>`);
                cells.push(`<td class="batting-stat" style="display: none">${stats.runs || 0}</td>`);
                cells.push(`<td class="batting-stat" style="display: none">${stats.rbi || 0}</td>`);
                cells.push(`<td class="batting-stat" style="display: none">${stats.steals || 0}</td>`);
                cells.push(`<td class="batting-stat" style="display: none">${stats.hr || 0}</td>`);
            } else if (filterValue === 'all' && player.is_pitcher) {
                // All-players view: show empty batting cells for pitchers  
                cells.push(`<td class="batting-stat">-</td>`);
                cells.push(`<td class="batting-stat">-</td>`);
                cells.push(`<td class="batting-stat">-</td>`);
                cells.push(`<td class="batting-stat">-</td>`);
                cells.push(`<td class="batting-stat">-</td>`);
                cells.push(`<td class="batting-stat">-</td>`);
                cells.push(`<td class="batting-stat">-</td>`);
            } else {
                // Show batting stats for batters
                cells.push(`<td class="batting-stat">${stats.hits || 0}</td>`);
                cells.push(`<td class="batting-stat">${(stats.avg || 0).toFixed(3)}</td>`);
                cells.push(`<td class="batting-stat">${(stats.babip || 0).toFixed(3)}</td>`);
                cells.push(`<td class="batting-stat">${stats.runs || 0}</td>`);
                cells.push(`<td class="batting-stat">${stats.rbi || 0}</td>`);
                cells.push(`<td class="batting-stat">${stats.steals || 0}</td>`);
                cells.push(`<td class="batting-stat">${stats.hr || 0}</td>`);
            }
            
            // Add pitching stat cells (7 cells) - always add but hide for batters
            if (filterValue === 'batter') {
                // Batter-only view: hide all pitching columns
                cells.push(`<td class="pitching-stat" style="display: none">${stats.wins || 0}</td>`);
                cells.push(`<td class="pitching-stat" style="display: none">${stats.runs_scored || 0}</td>`);
                cells.push(`<td class="pitching-stat" style="display: none">${(stats.era || 0).toFixed(2)}</td>`);
                cells.push(`<td class="pitching-stat" style="display: none">${(stats.fip || 0).toFixed(2)}</td>`);
                cells.push(`<td class="pitching-stat" style="display: none">${stats.strikeouts || 0}</td>`);
                cells.push(`<td class="pitching-stat" style="display: none">${stats.walks || 0}</td>`);
                cells.push(`<td class="pitching-stat" style="display: none">${stats.saves || 0}</td>`);
            } else if (filterValue === 'all' && !player.is_pitcher) {
                // All-players view: show empty pitching cells for batters
                cells.push(`<td class="pitching-stat">-</td>`);
                cells.push(`<td class="pitching-stat">-</td>`);
                cells.push(`<td class="pitching-stat">-</td>`);
                cells.push(`<td class="pitching-stat">-</td>`);
                cells.push(`<td class="pitching-stat">-</td>`);
                cells.push(`<td class="pitching-stat">-</td>`);
                cells.push(`<td class="pitching-stat">-</td>`);
            } else {
                // Show pitching stats for pitchers
                cells.push(`<td class="pitching-stat">${stats.wins || 0}</td>`);
                cells.push(`<td class="pitching-stat">${stats.runs_scored || 0}</td>`);
                cells.push(`<td class="pitching-stat">${(stats.era || 0).toFixed(2)}</td>`);
                cells.push(`<td class="pitching-stat">${(stats.fip || 0).toFixed(2)}</td>`);
                cells.push(`<td class="pitching-stat">${stats.strikeouts || 0}</td>`);
                cells.push(`<td class="pitching-stat">${stats.walks || 0}</td>`);
                cells.push(`<td class="pitching-stat">${stats.saves || 0}</td>`);
            }
            
            // Add points and checkbox cells (always visible)
            cells.push(`<td class="points-column">${player.points || 0}</td>`);
            cells.push('<td class="checkbox-column"></td>');
            
            // Set the row HTML
            row.innerHTML = cells.join('');
            
            // Add the checkbox to the last cell
            row.querySelector('.checkbox-column').appendChild(checkbox);

            playersBody.appendChild(row);
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

        const modal = document.getElementById('player-card-modal');
        const container = document.getElementById('player-card-container');
        
        // Get current stats based on year and data type
        let stats;
        if (currentYear === '2025') {
            stats = dataType === 'actual' ? player.stats_2025_actual : player.stats_2025_projected;
        } else {
            stats = player.stats_2024;
        }

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
            </div>
        `;

        container.innerHTML = cardHTML;
        modal.style.display = 'block';
    }

    function closePlayerCard() {
        document.getElementById('player-card-modal').style.display = 'none';
    }

    // Close modal when clicking outside of it
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('player-card-modal');
        if (event.target === modal) {
            closePlayerCard();
        }
    });
});

// Global functions for modal controls
window.closePlayerCard = function() {
    document.getElementById('player-card-modal').style.display = 'none';
};