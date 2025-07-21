// Player comparison modal logic
document.addEventListener('DOMContentLoaded', function() {
    // Only run if the players table exists
    const playersTable = document.getElementById('players-table');
    const playersBody = document.getElementById('players-body');
    if (!playersTable || !playersBody) return;

    // Show comparison modal with enhanced stat differences
    window.showComparisonModal = function(rows) {
        const modal = document.getElementById('comparison-tool');
        const container = document.getElementById('comparison-container');
        container.innerHTML = '';
        
        // Extract player data from both rows
        const players = rows.map(row => {
            const cells = row.querySelectorAll('td');
            return {
                name: cells[0]?.textContent?.replace(/^\s*|\s*$/g, '') || '',
                team: cells[1]?.textContent || '',
                position: cells[2]?.textContent || '',
                stats: {
                    hits: parseFloat(cells[3]?.textContent || '0'),
                    avg: parseFloat(cells[4]?.textContent || '0'),
                    babip: parseFloat(cells[5]?.textContent || '0'),
                    runs: parseFloat(cells[6]?.textContent || '0'),
                    rbi: parseFloat(cells[7]?.textContent || '0'),
                    steals: parseFloat(cells[8]?.textContent || '0'),
                    hr: parseFloat(cells[9]?.textContent || '0'),
                    wins: parseFloat(cells[10]?.textContent || '0'),
                    runs_scored: parseFloat(cells[11]?.textContent || '0'),
                    era: parseFloat(cells[12]?.textContent || '0'),
                    fip: parseFloat(cells[13]?.textContent || '0'),
                    strikeouts: parseFloat(cells[14]?.textContent || '0'),
                    walks: parseFloat(cells[15]?.textContent || '0'),
                    saves: parseFloat(cells[16]?.textContent || '0'),
                    points: parseFloat(cells[17]?.textContent || '0')
                }
            };
        });

        // Helper function to compare stats and return formatted string with difference
        function compareStats(statName, player1Value, player2Value, lowerIsBetter = false) {
            const diff = player1Value - player2Value;
            const absDiff = Math.abs(diff);
            
            // Handle special cases where "-" appears in data
            if (isNaN(player1Value) || isNaN(player2Value)) {
                return {
                    player1: { value: player1Value, class: '', diff: '' },
                    player2: { value: player2Value, class: '', diff: '' }
                };
            }

            let player1Class = '';
            let player2Class = '';
            
            if (diff !== 0) {
                if (lowerIsBetter) {
                    // For stats like ERA, FIP, Walks where lower is better
                    player1Class = diff < 0 ? 'stat-better' : 'stat-worse';
                    player2Class = diff < 0 ? 'stat-worse' : 'stat-better';
                } else {
                    // For most stats where higher is better
                    player1Class = diff > 0 ? 'stat-better' : 'stat-worse';
                    player2Class = diff > 0 ? 'stat-worse' : 'stat-better';
                }
            }

            // Format the difference display
            const formatDiff = (value, isWinner) => {
                if (absDiff === 0) return '';
                const sign = isWinner ? '+' : '-';
                
                // Format based on stat type
                if (['avg', 'babip', 'era', 'fip'].includes(statName)) {
                    return ` (${sign}${absDiff.toFixed(3)})`;
                } else {
                    return ` (${sign}${Math.round(absDiff)})`;
                }
            };

            return {
                player1: {
                    value: ['avg', 'babip', 'era', 'fip'].includes(statName) ? player1Value.toFixed(3) : Math.round(player1Value),
                    class: player1Class,
                    diff: formatDiff(absDiff, player1Class === 'stat-better')
                },
                player2: {
                    value: ['avg', 'babip', 'era', 'fip'].includes(statName) ? player2Value.toFixed(3) : Math.round(player2Value),
                    class: player2Class,
                    diff: formatDiff(absDiff, player2Class === 'stat-better')
                }
            };
        }

        // Create comparison cards
        const statComparisons = {
            hits: compareStats('hits', players[0].stats.hits, players[1].stats.hits),
            avg: compareStats('avg', players[0].stats.avg, players[1].stats.avg),
            babip: compareStats('babip', players[0].stats.babip, players[1].stats.babip),
            runs: compareStats('runs', players[0].stats.runs, players[1].stats.runs),
            rbi: compareStats('rbi', players[0].stats.rbi, players[1].stats.rbi),
            steals: compareStats('steals', players[0].stats.steals, players[1].stats.steals),
            hr: compareStats('hr', players[0].stats.hr, players[1].stats.hr),
            wins: compareStats('wins', players[0].stats.wins, players[1].stats.wins),
            runs_scored: compareStats('runs_scored', players[0].stats.runs_scored, players[1].stats.runs_scored),
            era: compareStats('era', players[0].stats.era, players[1].stats.era, true),
            fip: compareStats('fip', players[0].stats.fip, players[1].stats.fip, true),
            strikeouts: compareStats('strikeouts', players[0].stats.strikeouts, players[1].stats.strikeouts),
            walks: compareStats('walks', players[0].stats.walks, players[1].stats.walks, true),
            saves: compareStats('saves', players[0].stats.saves, players[1].stats.saves),
            points: compareStats('points', players[0].stats.points, players[1].stats.points)
        };

        // Create player cards with comparisons
        players.forEach((player, index) => {
            const card = document.createElement('div');
            card.className = 'comparison-card';
            
            const otherIndex = index === 0 ? 1 : 0;
            const isPlayer1 = index === 0;
            
            card.innerHTML = `
                <div class="comparison-header">
                    <h3 class="comparison-player-name">${player.name}</h3>
                    <div class="comparison-player-info">
                        <span class="comparison-team">${player.team}</span>
                        <span class="comparison-position">${player.position}</span>
                    </div>
                </div>
                <div class="comparison-stats">
                    <div class="comparison-section">
                        <h4>Batting Stats</h4>
                        <ul class="comparison-stat-list">
                            <li>Hits: <span class="${isPlayer1 ? statComparisons.hits.player1.class : statComparisons.hits.player2.class}">${isPlayer1 ? statComparisons.hits.player1.value : statComparisons.hits.player2.value}${isPlayer1 ? statComparisons.hits.player1.diff : statComparisons.hits.player2.diff}</span></li>
                            <li>AVG: <span class="${isPlayer1 ? statComparisons.avg.player1.class : statComparisons.avg.player2.class}">${isPlayer1 ? statComparisons.avg.player1.value : statComparisons.avg.player2.value}${isPlayer1 ? statComparisons.avg.player1.diff : statComparisons.avg.player2.diff}</span></li>
                            <li>BABIP: <span class="${isPlayer1 ? statComparisons.babip.player1.class : statComparisons.babip.player2.class}">${isPlayer1 ? statComparisons.babip.player1.value : statComparisons.babip.player2.value}${isPlayer1 ? statComparisons.babip.player1.diff : statComparisons.babip.player2.diff}</span></li>
                            <li>Runs: <span class="${isPlayer1 ? statComparisons.runs.player1.class : statComparisons.runs.player2.class}">${isPlayer1 ? statComparisons.runs.player1.value : statComparisons.runs.player2.value}${isPlayer1 ? statComparisons.runs.player1.diff : statComparisons.runs.player2.diff}</span></li>
                            <li>RBI: <span class="${isPlayer1 ? statComparisons.rbi.player1.class : statComparisons.rbi.player2.class}">${isPlayer1 ? statComparisons.rbi.player1.value : statComparisons.rbi.player2.value}${isPlayer1 ? statComparisons.rbi.player1.diff : statComparisons.rbi.player2.diff}</span></li>
                            <li>Steals: <span class="${isPlayer1 ? statComparisons.steals.player1.class : statComparisons.steals.player2.class}">${isPlayer1 ? statComparisons.steals.player1.value : statComparisons.steals.player2.value}${isPlayer1 ? statComparisons.steals.player1.diff : statComparisons.steals.player2.diff}</span></li>
                            <li>Home Runs: <span class="${isPlayer1 ? statComparisons.hr.player1.class : statComparisons.hr.player2.class}">${isPlayer1 ? statComparisons.hr.player1.value : statComparisons.hr.player2.value}${isPlayer1 ? statComparisons.hr.player1.diff : statComparisons.hr.player2.diff}</span></li>
                        </ul>
                    </div>
                    <div class="comparison-section">
                        <h4>Pitching Stats</h4>
                        <ul class="comparison-stat-list">
                            <li>Wins: <span class="${isPlayer1 ? statComparisons.wins.player1.class : statComparisons.wins.player2.class}">${isPlayer1 ? statComparisons.wins.player1.value : statComparisons.wins.player2.value}${isPlayer1 ? statComparisons.wins.player1.diff : statComparisons.wins.player2.diff}</span></li>
                            <li>Runs Scored: <span class="${isPlayer1 ? statComparisons.runs_scored.player1.class : statComparisons.runs_scored.player2.class}">${isPlayer1 ? statComparisons.runs_scored.player1.value : statComparisons.runs_scored.player2.value}${isPlayer1 ? statComparisons.runs_scored.player1.diff : statComparisons.runs_scored.player2.diff}</span></li>
                            <li>ERA: <span class="${isPlayer1 ? statComparisons.era.player1.class : statComparisons.era.player2.class}">${isPlayer1 ? statComparisons.era.player1.value : statComparisons.era.player2.value}${isPlayer1 ? statComparisons.era.player1.diff : statComparisons.era.player2.diff}</span></li>
                            <li>FIP: <span class="${isPlayer1 ? statComparisons.fip.player1.class : statComparisons.fip.player2.class}">${isPlayer1 ? statComparisons.fip.player1.value : statComparisons.fip.player2.value}${isPlayer1 ? statComparisons.fip.player1.diff : statComparisons.fip.player2.diff}</span></li>
                            <li>Strikeouts: <span class="${isPlayer1 ? statComparisons.strikeouts.player1.class : statComparisons.strikeouts.player2.class}">${isPlayer1 ? statComparisons.strikeouts.player1.value : statComparisons.strikeouts.player2.value}${isPlayer1 ? statComparisons.strikeouts.player1.diff : statComparisons.strikeouts.player2.diff}</span></li>
                            <li>Walks: <span class="${isPlayer1 ? statComparisons.walks.player1.class : statComparisons.walks.player2.class}">${isPlayer1 ? statComparisons.walks.player1.value : statComparisons.walks.player2.value}${isPlayer1 ? statComparisons.walks.player1.diff : statComparisons.walks.player2.diff}</span></li>
                            <li>Saves: <span class="${isPlayer1 ? statComparisons.saves.player1.class : statComparisons.saves.player2.class}">${isPlayer1 ? statComparisons.saves.player1.value : statComparisons.saves.player2.value}${isPlayer1 ? statComparisons.saves.player1.diff : statComparisons.saves.player2.diff}</span></li>
                        </ul>
                    </div>
                    <div class="comparison-section comparison-points">
                        <h4>Fantasy Points</h4>
                        <div class="points-comparison">
                            <span class="points-value ${isPlayer1 ? statComparisons.points.player1.class : statComparisons.points.player2.class}">
                                ${isPlayer1 ? statComparisons.points.player1.value : statComparisons.points.player2.value}${isPlayer1 ? statComparisons.points.player1.diff : statComparisons.points.player2.diff}
                            </span>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
        
        modal.style.display = 'block';
    };

    // Close modal function (global for button)
    window.closeComparisonTool = function() {
        const modal = document.getElementById('comparison-tool');
        if (modal) modal.style.display = 'none';
    };
});
