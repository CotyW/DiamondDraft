document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const calculateBtn = document.getElementById('calculate-btn');
    const playersTable = document.getElementById('players-table');
    const playersBody = document.getElementById('players-body');
    const positionFilter = document.getElementById('position-filter');
    const yearBtns = document.querySelectorAll('.year-btn');
    
    // State variables
    let players = [];
    let currentYear = '2024';
    let currentSort = {column: 'points', direction: 'desc'};
    
    // Get all scoring input elements
    const scoringInputs = [
        'avg', 'runs', 'rbi', 'steals', 'hr', 
        'wins', 'era', 'strikeouts', 'walks', 'saves'
    ].map(id => document.getElementById(id));
    
    // Initialize app
    fetchPlayers();
    
    // Event listeners
    calculateBtn.addEventListener('click', calculatePlayerValues);
    
    // Position filter event listener
    positionFilter.addEventListener('change', function() {
        renderPlayersTable(players);
    });
    
    // Year toggle buttons
    yearBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            yearBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentYear = this.dataset.year;
            renderPlayersTable(players);
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
            
            renderPlayersTable(players);
        });
    });
    
    // Functions
    function fetchPlayers() {
        fetch(`/api/players?year=${currentYear}`)
            .then(response => response.json())
            .then(data => {
                players = data;
                calculatePlayerValues();
            })
            .catch(error => {
                console.error('Error fetching players:', error);
                alert('Error loading player data');
            });
    }
    
    function calculatePlayerValues() {
        // Get weights from input fields
        const weights = {};
        scoringInputs.forEach(input => {
            weights[input.id] = parseFloat(input.value) || 0;
        });
        
        weights.year = currentYear;
        
        // Send weights to server to calculate player values
        fetch('/api/calculate', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(weights)
        })
        .then(response => response.json())
        .then(data => {
            players = data;
            renderPlayersTable(players);
        })
        .catch(error => {
            console.error('Error calculating player values:', error);
            alert('Error calculating player values');
        });
    }
    
    function renderPlayersTable(playersData) {
        // Apply position filter
        let filteredPlayers = [...playersData];
        
        const filterValue = positionFilter.value;
        if (filterValue === 'batter') {
            filteredPlayers = filteredPlayers.filter(player => !player.is_pitcher);
        } else if (filterValue === 'pitcher') {
            filteredPlayers = filteredPlayers.filter(player => player.is_pitcher);
        }
        
        // Apply sorting
        filteredPlayers.sort((a, b) => {
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
        
        // Clear table
        playersBody.innerHTML = '';
        
        // Add players to table
        filteredPlayers.forEach(player => {
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
    
    // Additional function to refresh data
    function refreshData() {
        fetch('/api/refresh-data')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    fetchPlayers();
                    alert('Player data refreshed successfully');
                } else {
                    alert('Failed to refresh player data');
                }
            })
            .catch(error => {
                console.error('Error refreshing data:', error);
                alert('Error refreshing data');
            });
    }
    
    // Add refresh button
    const controlsDiv = document.querySelector('.controls');
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh Player Data';
    refreshBtn.style.marginLeft = '10px';
    refreshBtn.style.backgroundColor = '#ff9800';
    refreshBtn.addEventListener('click', refreshData);
    
    controlsDiv.appendChild(refreshBtn);
});