"""
Load player ID mapping from CSV into Supabase
This creates a mapping between MLB IDs, FanGraphs IDs, and player names
"""

import os
import pandas as pd
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()  # Load environment variables from .env
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def load_player_mapping(csv_path):
    """
    Load player mapping CSV and insert into Supabase
    """
    print(f"Loading player mapping from {csv_path}...")
    
    # Some exports contain non-UTF8 bytes; use latin-1 to be resilient.
    df = pd.read_csv(csv_path, encoding='latin-1')
    
    # Keep only the columns we need
    mapping_records = []
    
    for _, row in df.iterrows():
        fg_raw = row.get('IDFANGRAPHS') if 'IDFANGRAPHS' in row else None
        fg_id = None
        if pd.notna(fg_raw):
            try:
                fg_id = str(int(fg_raw))
            except Exception:
                fg_id = str(fg_raw).strip()

        mlb_raw = row.get('MLBID') if 'MLBID' in row else None
        mlb_id = None
        if pd.notna(mlb_raw):
            try:
                mlb_id = str(int(mlb_raw))
            except Exception:
                mlb_id = str(mlb_raw).strip()

        # Skip rows without MLB ID (required by schema)
        if not mlb_id:
            continue

        record = {
            'mlb_id': mlb_id,
            'fangraphs_id': fg_id,
            'player_name': row.get('PLAYERNAME'),
            'position': row.get('POS', ''),
            'team': row.get('TEAM', ''),
            'active': str(row.get('ACTIVE', 'Y')).upper().startswith('Y')
        }
        # Normalize NaN/NaT to None for JSON compliance
        for key, val in list(record.items()):
            if pd.isna(val):
                record[key] = None
        mapping_records.append(record)
    
    # Deduplicate by (mlb_id, fangraphs_id) to avoid ON CONFLICT repeats in same statement
    unique_records = []
    seen_keys = set()
    for rec in mapping_records:
        key = (rec.get('mlb_id'), rec.get('fangraphs_id'))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        unique_records.append(rec)

    print(f"Upserting {len(unique_records)} player mappings...")

    # Batch upsert
    batch_size = 100
    for i in range(0, len(unique_records), batch_size):
        batch = unique_records[i:i+batch_size]
        supabase.table('player_id_mapping').upsert(batch).execute()
    
    print("✅ Player mapping loaded successfully!")
    return len(mapping_records)


if __name__ == '__main__':
    csv_path = r'c:\Users\cotyw\OneDrive\Desktop\DiamondDraft\player_mapping.csv'
    
    if not os.path.exists(csv_path):
        print(f"❌ CSV file not found: {csv_path}")
        print("Please provide the correct path to your player mapping CSV")
    else:
        load_player_mapping(csv_path)
