/**
 * Supabase client for frontend
 * Provides functions to fetch players and stats from Supabase
 */

let supabaseClient = null;
let dataSource = 'static';
let staticDataPromise = null;
let configReady = null;

const STATIC_SEASON_KEYS = {
    2024: 'stats_2024',
    2025: 'stats_2025_actual',
    2026: 'stats_2026_actual',
    2027: 'stats_2027_projected'
};

function loadConfig() {
    if (!configReady) {
        configReady = fetch('api/supabase-config')
            .then(r => r.json())
            .catch(() => ({ data_source: 'static' }))
            .then(config => {
                dataSource = config.data_source || 'static';
                return config;
            });
    }
    return configReady;
}

function loadStaticPlayers() {
    if (!staticDataPromise) {
        staticDataPromise = fetch('data/players.json').then(r => {
            if (!r.ok) throw new Error(`players.json: HTTP ${r.status}`);
            return r.json();
        });
    }
    return staticDataPromise;
}

async function fetchStaticPlayers(filter, seasons) {
    const players = await loadStaticPlayers();
    const list = players.map(p => {
        const statsBySeason = {};
        seasons.forEach(season => {
            const flat = p[STATIC_SEASON_KEYS[season]] || {};
            statsBySeason[season] = { batting: { ...flat }, pitching: { ...flat } };
        });
        return { ...p, player_id: p.id, stats_by_season: statsBySeason };
    });
    if (filter === 'batter') return list.filter(p => !p.is_pitcher);
    if (filter === 'pitcher') return list.filter(p => p.is_pitcher);
    return list;
}

/**
 * Initialize Supabase client with config from backend
 */
async function initializeSupabase() {
    if (supabaseClient) {
        return supabaseClient;  // Return existing client if already initialized
    }
    
    try {
        const config = await loadConfig();
        if (dataSource !== 'supabase') return null;
        
        // Use supabase-js library (must be loaded in HTML)
        supabaseClient = supabase.createClient(config.url, config.key);
        console.log('Supabase client initialized');
        return supabaseClient;
    } catch (error) {
        console.error('Failed to initialize Supabase:', error);
        return null;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializeSupabase);

/**
 * Fetch all players from Supabase with their 2025 stats
 * @param {string} filter - 'batter', 'pitcher', or 'all'
 * @returns {Promise<Array>} Array of player objects with stats
 */
async function fetchPlayersWithStats(filter = 'all', seasons = [2024, 2025, 2026]) {
    await loadConfig();
    if (dataSource === 'static') {
        try {
            return await fetchStaticPlayers(filter, seasons);
        } catch (error) {
            console.error('Error loading static player data:', error);
            return [];
        }
    }

    // Wait for client to be initialized if needed
    if (!supabaseClient) {
        await new Promise(resolve => {
            const checkClient = setInterval(() => {
                if (supabaseClient) {
                    clearInterval(checkClient);
                    resolve();
                }
            }, 50);
            setTimeout(() => clearInterval(checkClient), 5000);  // Timeout after 5s
        });
    }
    
    if (!supabaseClient) {
        console.error('Supabase client not initialized');
        return [];
    }
    
    try {
        // Fetch all players
        const { data: players, error: playersError } = await supabaseClient.from('players').select('*');
        
        if (playersError) throw playersError;
        if (!players || players.length === 0) {
            console.warn('No players found');
            return [];
        }
        
        // Fetch stats for selected seasons
        const { data: stats, error: statsError } = await supabaseClient
            .from('actual_stats')
            .select('*')
            .in('season', seasons);
        
        if (statsError) throw statsError;
        
        // Combine players with their stats by season
        const playerList = players.map(player => {
            const statsBySeason = {};
            seasons.forEach(season => {
                const playerStats = (stats || []).filter(s => s.player_id === player.player_id && s.season === season);
                const battingStats = playerStats.find(s => s.stat_type === 'batting') || {};
                const pitchingStats = playerStats.find(s => s.stat_type === 'pitching') || {};
                statsBySeason[season] = {
                    batting: {
                        games_played: battingStats.games_played || 0,
                        at_bats: battingStats.at_bats || 0,
                        hits: battingStats.hits || 0,
                        runs: battingStats.runs || 0,
                        rbi: battingStats.rbi || 0,
                        hr: battingStats.home_runs || 0,
                        steals: battingStats.stolen_bases || 0,
                        avg: battingStats.avg || 0,
                        babip: battingStats.babip || 0,
                        obp: battingStats.obp || 0,
                        slg: battingStats.slg || 0
                    },
                    pitching: {
                        games_played: pitchingStats.games_played || 0,
                        wins: pitchingStats.wins || 0,
                        losses: pitchingStats.losses || 0,
                        era: pitchingStats.era || 0,
                        innings_pitched: pitchingStats.innings_pitched || 0,
                        hits_allowed: pitchingStats.hits_allowed || 0,
                        // handle multiple possible column names
                        strikeouts: (pitchingStats.strikeouts ?? pitchingStats.strikeouts_pitched ?? 0),
                        walks: (pitchingStats.walks ?? pitchingStats.walks_allowed ?? 0),
                        saves: pitchingStats.saves || 0,
                        whip: pitchingStats.whip || 0,
                        fip: pitchingStats.fip || 0,
                        runs_scored: pitchingStats.runs_scored || 0
                    }
                };
            });
            // Improve pitcher detection using multiple indicators
            const isPitcher = Object.values(statsBySeason).some(seasonStats => {
                const p = seasonStats.pitching || {};
                return (p.wins || 0) > 0 || (p.era || 0) > 0 || (p.strikeouts || 0) > 0 || (p.saves || 0) > 0;
            });
            
            return {
                id: player.player_id,
                name: player.name || player.full_name || player.fullName || '',
                player_id: player.player_id,
                team: player.team || player.team_name || player.current_team || player.team_full || player.team_abbr || '',
                position: player.position || player.primary_position || player.primaryPosition || '',
                is_pitcher: isPitcher,
                stats_by_season: statsBySeason
            };
        });
        
        // Apply filter
        if (filter === 'batter') {
            return playerList.filter(p => !p.is_pitcher);
        } else if (filter === 'pitcher') {
            return playerList.filter(p => p.is_pitcher);
        }
        
        return playerList;
    } catch (error) {
        console.error('Error fetching players with stats:', error);
        return [];
    }
}

/**
 * Fetch a single player with full details
 * @param {string} playerId - Player ID from Supabase
 * @returns {Promise<Object>} Player object with all stats
 */
async function fetchPlayerById(playerId) {
    if (!supabaseClient) {
        console.error('Supabase client not initialized');
        return null;
    }
    
    try {
        const { data: player, error: playerError } = await supabaseClient
            .from('players')
            .select('*')
            .eq('player_id', playerId)
            .single();
        
        if (playerError) throw playerError;
        
        // Fetch stats for all seasons
        const { data: stats, error: statsError } = await supabaseClient
            .from('actual_stats')
            .select('*')
            .eq('player_id', playerId);
        
        if (statsError) throw statsError;
        
        return {
            ...player,
            stats: stats || []
        };
    } catch (error) {
        console.error('Error fetching player:', error);
        return null;
    }
}

/**
 * Get last updated timestamp for stats
 * @returns {Promise<Date>} Date of last update
 */
async function getLastUpdated() {
    await loadConfig();
    if (dataSource === 'static') {
        try {
            const r = await fetch('data/last_updated.json');
            const meta = await r.json();
            return new Date(meta.timestamp);
        } catch (error) {
            return new Date();
        }
    }
    if (!supabaseClient) {
        console.error('Supabase client not initialized');
        return new Date();
    }
    
    try {
        const { data, error } = await supabaseClient
            .from('actual_stats')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            return new Date(data[0].created_at);
        }
        return new Date();
    } catch (error) {
        console.error('Error fetching last updated time:', error);
        return new Date();
    }
}
