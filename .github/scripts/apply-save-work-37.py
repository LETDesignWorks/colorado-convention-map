from pathlib import Path
import json, gzip, base64, subprocess, hashlib
root = Path('.')
encoded = (root/'.github/patches/save-work-37.json.gz.b64').read_text()
encoded = encoded.replace('I5nuxube6cbCxwIeR49ed0UHWWNuufPV74Y1BH4kftv/bTBg8n37y1E1d4eqUWcvFTBx7w9FQ687FdR++N65gOaN4ePMcfSSiswcB+', 'I5nuxube6MB+')
if len(encoded) != 19540:
    raise SystemExit(f'Patch payload length mismatch: {len(encoded)}')
raw = gzip.decompress(base64.b64decode(encoded))
if hashlib.sha256(raw).hexdigest() != '858498f804389560b5befcfa57874902f7fc1a709235155184abc9a75e621621':
    raise SystemExit('Patch payload checksum mismatch')
bundle = json.loads(raw)
prepared = {}
for path, patch in bundle['patches'].items():
    actual = subprocess.check_output(['git', 'hash-object', path], text=True).strip()
    if actual != patch['sha']:
        raise SystemExit(f'Refusing to change {path}: base file changed ({actual}).')
    source = (root/path).read_text()
    for op in patch['ops']:
        if op['kind'] == 'replace':
            count = source.count(op['old'])
            if count != op['count']:
                raise SystemExit(f'{path}: expected {op["count"]} matches, found {count}: {op["old"][:100]!r}')
            source = source.replace(op['old'], op['new'])
        elif op['kind'] == 'block':
            if source.count(op['start']) != 1:
                raise SystemExit(f'{path}: ambiguous block start')
            start = source.index(op['start']); end = source.index(op['end'], start)
            source = source[:start] + op['new'] + source[end:]
        else:
            raise SystemExit('Unsupported operation')
    prepared[path] = source
for path, source in bundle['files'].items():
    if (root/path).exists():
        raise SystemExit(f'Refusing to replace unexpected existing file {path}')
    prepared[path] = source
for path, source in prepared.items():
    (root/path).parent.mkdir(parents=True, exist_ok=True)
    (root/path).write_text(source)
print(f'Prepared {len(prepared)} files for {bundle["version"]}. No database records were read or written.')
