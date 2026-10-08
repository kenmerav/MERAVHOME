"""Apply only the reviewed exact-anchor pricing changes in a fresh checkout."""
import hashlib
import json
import pathlib
import subprocess

root = pathlib.Path.cwd()
manifest = json.loads((root / '.codex-pricing-release/patches.json').read_text())
changes = {}
for name, expected in manifest['expected_blobs'].items():
    path = root / name
    data = path.read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if actual != expected:
        raise RuntimeError(f'Baseline changed: {name}; refusing to overwrite newer code')
    changes[name] = data.decode()
for patch in manifest['edits']:
    text = changes[patch['path']]
    if text.count(patch['before']) != patch['count']:
        raise RuntimeError('Patch anchor mismatch: ' + patch['path'])
    changes[patch['path']] = text.replace(patch['before'], patch['after'])
for name, text in changes.items():
    (root / name).write_text(text)
# Generated database types mirror the nullable additive field. Never change other tables.
types_path = root / 'src/integrations/supabase/types.ts'
text = types_path.read_text()
start = text.index('      products: {')
end = text.index('      project', start)
section = text[start:end]
if 'price_unit' not in section:
    import re
    section, count = re.subn(r'(          price(\??): string \| null\n)', lambda m: m.group(1) + '          price_unit' + m.group(2) + ': string | null\n', section)
    if count != 3:
        raise RuntimeError(f'Expected three generated product price fields, found {count}')
    text = text[:start] + section + text[end:]
    types_path.write_text(text)
subprocess.run(['git','diff','--check'],check=True)
print('Applied reviewed pricing changes without changing quantities or permissions.')
