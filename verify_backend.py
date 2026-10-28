"""Run each isolated test module in a fresh process to isolate import-time API config."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
files = sorted((root/'backend/tests').glob('test_*.py'))
if not files:
    raise SystemExit('No backend tests found')
for file in files:
    result = subprocess.run([sys.executable, '-m', 'pytest', '-q', str(file)], cwd=root)
    if result.returncode:
        raise SystemExit(result.returncode)
print(f'All {len(files)} backend test modules passed in isolated processes.')
