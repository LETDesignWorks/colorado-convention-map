from pathlib import Path

source_path = Path('.github/workflows/add-territory-avoid-addresses.yml')
source = source_path.read_text(encoding='utf-8')
start_marker = "          python - <<'PY'\n"
end_marker = "\n          PY\n"
start = source.index(start_marker) + len(start_marker)
end = source.index(end_marker, start)
body = source[start:end]
body = '\n'.join(line[10:] if line.startswith('          ') else line for line in body.splitlines())

old_definition = """def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)
"""
new_definition = """def replace_once(text, old, new, label):
    count = text.count(old)
    if label == 'PDF avoid collection' and count >= 1:
        index = text.rfind(old)
        return text[:index] + new + text[index + len(old):]
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)
"""
if old_definition not in body:
    raise RuntimeError('Could not locate the patch helper definition.')
body = body.replace(old_definition, new_definition, 1)
exec(compile(body, str(source_path), 'exec'))
