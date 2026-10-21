"""Generate the root index.html (GitHub Pages) from templates/index.html.

Run after editing the template:  python build_pages.py
"""
import re
from pathlib import Path

root = Path(__file__).parent
html = (root / "templates" / "index.html").read_text(encoding="utf-8")
html = re.sub(r"\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}", r"static/\1", html)
if "{{" in html or "{%" in html:
    raise SystemExit("Unresolved Jinja markup left in template")
(root / "index.html").write_text(html, encoding="utf-8")
print("Wrote index.html")
