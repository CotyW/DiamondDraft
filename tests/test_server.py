"""Tests for the local Flask server (app.py), the GitHub Pages build (build_pages.py) and the
Supabase upload script's record building. Run with: python -m unittest discover tests"""
import importlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, ROOT)


def load_app(env):
    """Import app.py fresh with the given environment (it reads .env and env vars on import)."""
    with mock.patch.dict(os.environ, env, clear=False), mock.patch('dotenv.load_dotenv'):
        for key in ('SUPABASE_URL', 'SUPABASE_KEY', 'DATA_SOURCE'):
            if key not in env:
                os.environ.pop(key, None)
        sys.modules.pop('app', None)
        module = importlib.import_module('app')
    module.app.testing = True
    return module


class AppTests(unittest.TestCase):
    def setUp(self):
        self.module = load_app({'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_KEY': 'anon-key',
                                'SUPABASE_SERVICE_ROLE_KEY': 'service-role-secret'})
        self.client = self.module.app.test_client()

    def test_index_renders_the_page_with_static_paths(self):
        resp = self.client.get('/')
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn('/static/main.js', html)
        self.assertNotIn('{{', html)

    def test_static_scripts_are_served(self):
        resp = self.client.get('/static/valuation.js')
        self.assertEqual(resp.status_code, 200)
        resp.close()

    def test_data_files_are_served(self):
        resp = self.client.get('/data/last_updated.json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('seasons', json.loads(resp.get_data(as_text=True)))
        resp.close()

    def test_data_route_cannot_reach_files_outside_data(self):
        for path in ('/data/../app.py', '/data/..%2fapp.py', '/data/%2e%2e/app.py',
                     '/data/..%5capp.py', '/data/../.env', '/data/../../Windows/win.ini'):
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 404, path)
            self.assertNotIn('Flask', resp.get_data(as_text=True), path)
            resp.close()

    def test_missing_data_file_is_404(self):
        self.assertEqual(self.client.get('/data/nope.json').status_code, 404)

    def test_config_gives_the_public_key_only(self):
        resp = self.client.get('/api/supabase-config')
        self.assertEqual(resp.status_code, 200)
        config = resp.get_json()
        self.assertEqual(config, {'data_source': 'static', 'url': 'https://example.supabase.co', 'key': 'anon-key'})
        # The service-role key bypasses row-level security: it must never reach the browser
        self.assertNotIn('service-role-secret', resp.get_data(as_text=True))

    def test_data_source_setting(self):
        client = load_app({'DATA_SOURCE': 'Supabase'}).app.test_client()
        self.assertEqual(client.get('/api/supabase-config').get_json()['data_source'], 'supabase')

    def test_config_without_credentials(self):
        client = load_app({}).app.test_client()
        self.assertEqual(client.get('/api/supabase-config').get_json(),
                         {'data_source': 'static', 'url': None, 'key': None})

    def test_only_get_is_allowed(self):
        self.assertEqual(self.client.post('/api/supabase-config').status_code, 405)
        self.assertEqual(self.client.post('/data/players.json').status_code, 405)


class BuildPagesTests(unittest.TestCase):
    def build(self, template):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, 'templates'))
            shutil.copy(os.path.join(ROOT, 'build_pages.py'), d)
            with open(os.path.join(d, 'templates', 'index.html'), 'w', encoding='utf-8') as f:
                f.write(template)
            run = subprocess.run([sys.executable, '-I', os.path.join(d, 'build_pages.py')],
                                 capture_output=True, text=True)
            out = os.path.join(d, 'index.html')
            if not os.path.exists(out):
                return run, None
            with open(out, encoding='utf-8') as f:
                return run, f.read()

    def test_url_for_becomes_relative_static_paths(self):
        run, html = self.build("<script src=\"{{ url_for('static', filename='main.js') }}\"></script>"
                               "<link href=\"{{url_for('static',filename='a/b.css')}}\">")
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(html, '<script src="static/main.js"></script><link href="static/a/b.css">')

    def test_unresolved_jinja_is_refused(self):
        run, html = self.build('<p>{{ something_else }}</p>')
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Unresolved Jinja', run.stderr)
        self.assertIsNone(html)

    def test_committed_index_html_matches_the_template(self):
        """Regression: editing templates/index.html without running build_pages.py leaves
        the published page out of date."""
        with open(os.path.join(ROOT, 'templates', 'index.html'), encoding='utf-8') as f:
            run, built = self.build(f.read())
        self.assertEqual(run.returncode, 0, run.stderr)
        with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
            committed = f.read()
        self.assertEqual(built.replace('\r\n', '\n'), committed.replace('\r\n', '\n'),
                         'index.html is stale: run python build_pages.py')

    def test_every_script_and_stylesheet_in_the_page_exists(self):
        with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
            html = f.read()
        refs = re.findall(r'(?:src|href)="(static/[^"]+)"', html)
        self.assertTrue(refs)
        for ref in refs:
            self.assertTrue(os.path.exists(os.path.join(ROOT, ref)), ref)


class SupabaseRecordTests(unittest.TestCase):
    def setUp(self):
        import upload_static_to_supabase as up
        self.up = up

    def test_batters_and_pitchers_become_rows(self):
        players = [
            {'id': 1, 'name': 'Bat', 'team': 'NYY', 'position': 'RF/CF', 'primary_position': 'RF',
             'is_pitcher': False, 'stats': {'2026': {'hits': 150, 'hr': 30, 'ab': 500, 'steals': 5,
                                                     'avg': .3, 'babip': .31, 'runs': 90, 'rbi': 95},
                                            '2025': {}}},
            {'id': '9-P', 'name': 'Arm', 'team': 'LAD', 'position': 'SP', 'primary_position': 'SP',
             'is_pitcher': True, 'stats': {'2026': {'wins': 10, 'era': 3.1, 'strikeouts': 200, 'ip': 180.0}}},
        ]
        player_rows, stat_rows = self.up.build_records(players)
        self.assertEqual(player_rows[0], {'player_id': '1', 'name': 'Bat', 'team': 'NYY',
                                          'position': 'RF/CF', 'primary_position': 'RF'})
        self.assertEqual(player_rows[1]['player_id'], '9-P')
        self.assertEqual(len(stat_rows), 2)  # the empty 2025 line is skipped
        bat, pit = stat_rows
        self.assertEqual((bat['stat_type'], bat['season'], bat['home_runs'], bat['stolen_bases']),
                         ('batting', 2026, 30, 5))
        self.assertEqual((pit['stat_type'], pit['strikeouts_pitched'], pit['innings_pitched']),
                         ('pitching', 200, 180.0))
        self.assertEqual(pit['saves'], 0)  # missing stats count as 0

    def test_primary_position_falls_back_to_first_listed(self):
        rows, _ = self.up.build_records([{'id': 1, 'name': 'X', 'position': 'SS/2B', 'stats': {}}])
        self.assertEqual(rows[0]['primary_position'], 'SS')

    def test_dry_run_reads_real_data_and_uploads_nothing(self):
        with mock.patch.object(sys, 'argv', ['upload_static_to_supabase.py', '--dry-run']), \
                mock.patch.dict(sys.modules, {'supabase': None}), \
                redirect_stdout(io.StringIO()) as out:
            self.up.main()  # importing supabase would fail: proves the dry run stops first
        self.assertRegex(out.getvalue(), r'^\d+ players, \d+ stat rows')


if __name__ == '__main__':
    unittest.main()
