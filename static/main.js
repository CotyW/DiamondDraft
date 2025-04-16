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
        'avg', 'runs', 'rbi', 'steals', 'hr', 
        'wins', 'era', 'strikeouts', 'walks', 'saves'
    ].map(id => document.getElementById(id));
    
    // Initialize app
    loadData();
    
    // Event listeners
    calculateBtn.addEventListener('click', calculatePlayerValues);
    
    // Position filter event listener
    positionFilter.addEventListener('change', function() {
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
    
    // Table header sorting
    playersTable.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', function() {
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
            
            // Add sort indicator to the clicked header
            this.classList.add(currentSort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            
            sortAndDisplayPlayers();
        });
    });
    
    // Functions
    async function loadData() {
        try {
            // Fetch player data
            const response = await fetch('./data/players.json');
            allPlayers = await response.json();
            
            // Fetch last updated timestamp
            const timestampResponse = await fetch('./data/last_updated.json');
            const timestampData = await timestampResponse.json();
            
            // Format and display timestamp
            const lastUpdated = new Date(timestampData.timestamp);
            dataTimestamp.textContent = `Last updated: ${lastUpdated.toLocaleDateString()} at ${lastUpdated.toLocaleTimeString()}`;
            
            // Calculate player values with default weights
            calculatePlayerValues();
            
            // Initialize column visibility
            updateColumnVisibility();
            
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
                    avg: 0,
                    runs: 0,
                    rbi: 0,
                    steals: 0,
                    hr: 0,
                    wins: 0,
                    era: 0,
                    strikeouts: 0,
                    walks: 0,
                    saves: 0
                };
            }
            
            let points = 0;
            
            // Calculate points based on weights
            if (!player.is_pitcher) {  // Batter
                points += (stats.avg || 0) * weights.avg;
                points += (stats.runs || 0) * weights.runs;
                points += (stats.rbi || 0) * weights.rbi;
                points += (stats.steals || 0) * weights.steals;
                points += (stats.hr || 0) * weights.hr;
            } else {  // Pitcher
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
        
        // Apply position filter
        const filterValue = positionFilter.value;
        if (filterValue === 'batter') {
            filteredPlayers = filteredPlayers.filter(player => !player.is_pitcher);
        } else if (filterValue === 'pitcher') {
            filteredPlayers = filteredPlayers.filter(player => player.is_pitcher);
        }
        
        // Apply search filter
        if (searchTerm) {
            filteredPlayers = filteredPlayers.filter(player => 
                player.name.toLowerCase().includes(searchTerm) ||
                player.team.toLowerCase().includes(searchTerm) ||
                player.position.toLowerCase().includes(searchTerm)
            );
        }
        
        // Sort filtered players
        sortPlayers(filteredPlayers);
        
        // Display filtered & sorted players
        renderPlayersTable(filteredPlayers);
        
        // Update column visibility based on filter
        updateColumnVisibility();
    }
    
    function updateColumnVisibility() {
        // Get current filter value
        const filterValue = positionFilter.value;
        
        // Get all column headers and data cells
        const battingHeaders = document.querySelectorAll('th.batting-stat');
        const pitchingHeaders = document.querySelectorAll('th.pitching-stat');
        const battingCells = document.querySelectorAll('td.batting-stat');
        const pitchingCells = document.querySelectorAll('td.pitching-stat');
        
        // Show/hide columns based on filter
        if (filterValue === 'batter') {
            // Show batting stats, hide pitching stats
            battingHeaders.forEach(header => header.classList.remove('hide-column'));
            pitchingHeaders.forEach(header => header.classList.add('hide-column'));
            battingCells.forEach(cell => cell.classList.remove('hide-column'));
            pitchingCells.forEach(cell => cell.classList.add('hide-column'));
        } else if (filterValue === 'pitcher') {
            // Show pitching stats, hide batting stats
            battingHeaders.forEach(header => header.classList.add('hide-column'));
            pitchingHeaders.forEach(header => header.classList.remove('hide-column'));
            battingCells.forEach(cell => cell.classList.add('hide-column'));
            pitchingCells.forEach(cell => cell.classList.remove('hide-column'));
        } else {
            // Show all columns for "all players" option
            battingHeaders.forEach(header => header.classList.remove('hide-column'));
            pitchingHeaders.forEach(header => header.classList.remove('hide-column'));
            battingCells.forEach(cell => cell.classList.remove('hide-column'));
            pitchingCells.forEach(cell => cell.classList.remove('hide-column'));
        }
    }
    
    function sortPlayers(players) {
        players.sort((a, b) => {
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
            
            // Handle special cases for sorting
            if (currentSort.column === 'era' && aValue > 0 && bValue > 0) {
                // For ERA, lower is better, so reverse the comparison
                return currentSort.direction === 'asc' ? 
                    aValue - bValue : bValue - aValue;
            }
            
            // Standard sorting
            if (typeof aValue === 'string') {
                return currentSort.direction === 'asc' ? 
                    aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
            } else {
                return currentSort.direction === 'asc' ? 
                    aValue - bValue : bValue - aValue;
            }
        });
    }
    
    function sortAndDisplayPlayers() {
        sortPlayers(displayedPlayers);
        renderPlayersTable(displayedPlayers);
    }
    
    function renderPlayersTable(playersData) {
        // Clear table
        playersBody.innerHTML = '';
        
        // Get current filter
        const filterValue = positionFilter.value;
        
        // Add players to table
        playersData.forEach(player => {
            const row = document.createElement('tr');
            
            // Get the correct stats based on year and data type
            let stats;
            if (currentYear === '2025') {
                stats = dataType === 'actual' ? player.stats_2025_actual : player.stats_2025_projected;
            } else {
                stats = player.stats_2024;
            }
            
            // Make sure stats object exists with proper defaults
            if (!stats) {
                console.warn(`Stats missing for player: ${player.name}, year: ${currentYear}, type: ${dataType}`);
                stats = {
                    avg: 0,
                    runs: 0,
                    rbi: 0,
                    steals: 0,
                    hr: 0,
                    wins: 0,
                    era: 0,
                    strikeouts: 0,
                    walks: 0,
                    saves: 0
                };
            }
            
            // Add cells with safe access to properties
            row.innerHTML = `
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
            
            // Apply hide-column class based on filter
            if (filterValue === 'batter') {
                row.querySelectorAll('.pitching-stat').forEach(cell => {
                    cell.classList.add('hide-column');
                });
            } else if (filterValue === 'pitcher') {
                row.querySelectorAll('.batting-stat').forEach(cell => {
                    cell.classList.add('hide-column');
                });
            }
            
            // Additional styling for clarity (optional)
            if (player.is_pitcher && filterValue === 'all') {
                row.querySelectorAll('.batting-stat').forEach(cell => {
                    cell.style.opacity = '0.3';
                });
            } else if (!player.is_pitcher && filterValue === 'all') {
                row.querySelectorAll('.pitching-stat').forEach(cell => {
                    cell.style.opacity = '0.3';
                });
            }
            
            playersBody.appendChild(row);
        });
        
        // Ensure column visibility is correct
        updateColumnVisibility();
    }
});