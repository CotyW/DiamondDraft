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
            currentYear = this.dataset.year;
            filterAndDisplayPlayers();
        });
    });
    
    // Table header sorting
    playersTable.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', function() {
            const column = this.dataset.sort;
            
            // If clicking the same column, reverse the direction
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'desc'; // Default to descending
            }
            
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
            const stats = playerCopy[`stats_${currentYear}`];
            let points = 0;
            
            // Calculate points based on weights
            if (!player.is_pitcher) {  // Batter
                points += stats.avg * weights.avg;
                points += stats.runs * weights.runs;
                points += stats.rbi * weights.rbi;
                points += stats.steals * weights.steals;
                points += stats.hr * weights.hr;
            } else {  // Pitcher
                points += stats.wins * weights.wins;
                // For ERA, lower is better, so we invert the weight
                if (weights.era !== 0) {
                    points += (5.0 - stats.era) * weights.era;  // 5.0 is a baseline ERA
                }
                points += stats.strikeouts * weights.strikeouts;
                // For walks, lower is better, so we invert the weight
                if (weights.walks !== 0) {
                    points += (100 - stats.walks) * weights.walks / 100;  // Normalize walks
                }
                points += stats.saves * weights.saves;
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
    }
    
    function sortPlayers(players) {
        players.sort((a, b) => {
            let aValue, bValue;
            
            if (currentSort.column === 'name' || currentSort.column === 'team' || currentSort.column === 'position') {
                aValue = a[currentSort.column];
                bValue = b[currentSort.column];
            } else if (currentSort.column === 'points') {
                aValue = a.points;
                bValue = b.points;
            } else {
                // Stat columns
                aValue = a[`stats_${currentYear}`][currentSort.column];
                bValue = b[`stats_${currentYear}`][currentSort.column];
            }
            
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
        
        // Add players to table
        playersData.forEach(player => {
            const row = document.createElement('tr');
            
            // Get stats for current year
            const stats = player[`stats_${currentYear}`];
            
            // Add cells
            row.innerHTML = `
                <td>${player.name}</td>
                <td>${player.team}</td>
                <td>${player.position}</td>
                <td class="batting-stat">${stats.avg.toFixed(3)}</td>
                <td class="batting-stat">${stats.runs}</td>
                <td class="batting-stat">${stats.rbi}</td>
                <td class="batting-stat">${stats.steals}</td>
                <td class="batting-stat">${stats.hr}</td>
                <td class="pitching-stat">${stats.wins}</td>
                <td class="pitching-stat">${stats.era.toFixed(2)}</td>
                <td class="pitching-stat">${stats.strikeouts}</td>
                <td class="pitching-stat">${stats.walks}</td>
                <td class="pitching-stat">${stats.saves}</td>
                <td class="points-column">${player.points}</td>
            `;
            
            // Highlight cells based on player type
            if (player.is_pitcher) {
                row.querySelectorAll('.batting-stat').forEach(cell => {
                    cell.style.opacity = '0.3';
                });
            } else {
                row.querySelectorAll('.pitching-stat').forEach(cell => {
                    cell.style.opacity = '0.3';
                });
            }
            
            playersBody.appendChild(row);
        });
    }
});