// Player comparison modal: two players side by side, with the better value in each stat marked.
// Stats come from static/stats.js, the same list the table and player card use.
document.addEventListener('DOMContentLoaded', function() {
    const playersTable = document.getElementById('players-table');
    if (!playersTable) return;
    const S = window.DDStats;

    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function statsFor(player, year) {
        const season = player.stats_by_season ? player.stats_by_season[year] : null;
        return (season && (player.is_pitcher ? season.pitching : season.batting)) || {};
    }

    // Class and "(+n)" suffix for one player's value against the other's
    function compare(def, mine, theirs) {
        if (theirs === undefined || mine === theirs) return { cls: '', diff: '' };
        const better = def.lower ? mine < theirs : mine > theirs;
        const gap = Math.abs(mine - theirs);
        const shown = def.key ? S.format(gap, def) : String(Math.round(gap * 100) / 100);
        return { cls: better ? 'stat-better' : 'stat-worse', diff: ` (${better ? '+' : '-'}${shown})` };
    }

    window.showComparisonModal = function(playerIds, allPlayersData, currentYear) {
        const modal = document.getElementById('comparison-tool');
        const container = document.getElementById('comparison-container');
        container.innerHTML = '';

        const players = playerIds.map(id => allPlayersData.find(p =>
            String(p.player_id) === String(id) || String(p.id) === String(id))).filter(Boolean);
        if (players.length < 2) {
            container.innerHTML = '<p>Unable to load player data for comparison.</p>';
            modal.style.display = 'block';
            return;
        }

        // Points shown in the table were calculated on the page's own copies of the players
        const shown = window.DDState ? window.DDState.players : [];
        const pointsOf = p => (shown.find(x => String(x.id) === String(p.id)) || p).points || 0;
        const stats = players.map(p => statsFor(p, currentYear));
        const groups = players.map(p => S.groupOf(p));
        const pointsDef = {}; // plain number: points can be fractional with fractional weights

        players.forEach((player, i) => {
            const other = 1 - i;
            const group = groups[i];
            const sameKind = groups[other] === group;
            const items = S.groups[group].map(def => {
                const mine = Number(stats[i][def.key]) || 0;
                const theirs = sameKind ? Number(stats[other][def.key]) || 0 : undefined;
                const c = compare(def, mine, theirs);
                return `<li>${esc(def.name)}: <span class="${c.cls}">${S.format(mine, def)}${c.diff}</span></li>`;
            }).join('');
            const pts = compare(pointsDef, pointsOf(player), pointsOf(players[other]));

            const card = document.createElement('div');
            card.className = 'comparison-card';
            card.innerHTML = `
                <div class="comparison-header">
                    <h3 class="comparison-player-name">${esc(player.name)}</h3>
                    <div class="comparison-player-info">
                        <span class="comparison-team">${esc(player.team)}</span>
                        <span class="comparison-position">${esc(player.position)}</span>
                    </div>
                </div>
                <div class="comparison-stats">
                    <div class="comparison-section">
                        <h4>${group === 'pit' ? 'Pitching' : 'Batting'} Stats</h4>
                        <ul class="comparison-stat-list">${items}</ul>
                    </div>
                    <div class="comparison-section comparison-points">
                        <h4>Fantasy Points</h4>
                        <div class="points-comparison">
                            <span class="points-value ${pts.cls}">${pointsOf(player)}${pts.diff}</span>
                        </div>
                    </div>
                </div>`;
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
