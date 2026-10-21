-- Run once in the Supabase SQL editor (Project -> SQL Editor).
create table if not exists players (
    player_id text primary key,
    name text not null,
    team text,
    position text,
    primary_position text,
    mlb_debut date,
    birth_date date,
    bats text,
    throws text,
    active boolean default true
);

create table if not exists actual_stats (
    id bigint generated always as identity primary key,
    player_id text not null references players(player_id) on delete cascade,
    season int not null,
    stat_type text not null check (stat_type in ('batting', 'pitching')),
    games_played int default 0,
    at_bats int default 0,
    runs int default 0,
    hits int default 0,
    doubles int default 0,
    triples int default 0,
    home_runs int default 0,
    rbi int default 0,
    stolen_bases int default 0,
    walks int default 0,
    strikeouts int default 0,
    avg numeric default 0,
    obp numeric default 0,
    slg numeric default 0,
    babip numeric default 0,
    wins int default 0,
    losses int default 0,
    era numeric default 0,
    fip numeric default 0,
    runs_scored int default 0,
    innings_pitched numeric default 0,
    hits_allowed int default 0,
    earned_runs int default 0,
    walks_allowed int default 0,
    strikeouts_pitched int default 0,
    saves int default 0,
    whip numeric default 0,
    created_at timestamptz default now(),
    unique (player_id, season, stat_type)
);

-- Public read-only access for the frontend (anon key); writes need the service role key.
alter table players enable row level security;
alter table actual_stats enable row level security;
drop policy if exists "public read players" on players;
drop policy if exists "public read actual_stats" on actual_stats;
create policy "public read players" on players for select using (true);
create policy "public read actual_stats" on actual_stats for select using (true);
