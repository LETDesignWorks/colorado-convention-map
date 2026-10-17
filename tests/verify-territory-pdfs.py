"""Check exported pages, numbers, filtering, and actual PDF text and leader positions.

Run after territory-pdf.mjs. Requires pypdf and pdfplumber.
"""
import json
import math
from pathlib import Path
import sys

import pdfplumber
from pypdf import PdfReader

output = Path(sys.argv[1] if len(sys.argv) > 1 else 'tmp/pdfs')
report = json.loads((output / 'verification.json').read_text())
for sample in report:
    path = output / (sample['sample'] + '.pdf')
    texts = [page.extract_text() for page in PdfReader(path).pages]
    note = 'ANY REMAINING HOMES ON A STREET THAT ARE NOT LISTED BELONG TO ANOTHER TERRITORY AND SHOULD NOT BE WORKED.'
    assert all(note in text for text in texts), (path, 'missing footer note')
    assert 'Overview' in texts[0] and 'Closer View' in texts[1]
    assert all('Address List' in text or 'Avoid / Do Not Visit' in text for text in texts[2:])
    assert sum('Overview' in text or 'Closer View' in text for text in texts) == 2
    for forbidden in ['9999 Outside', '7777 Outside', '6666 Excluded', '5555 Other']:
        assert forbidden not in '\n'.join(texts), (path, forbidden)
    assert '8888 Avoid Street' in texts[-1]
    with pdfplumber.open(path) as pdf:
        for page_index, map_data in enumerate(sample['maps']):
            expected_leaders = [label['leader'] for label in map_data['labels'] if label.get('leader')]
            actual_leaders = [line for line in pdf.pages[page_index].lines
                              if line['stroking_color'] == (0.25, 0.33, 0.41)]
            assert len(actual_leaders) == len(expected_leaders), (path, 'missing leaders')
            for actual, expected in zip(actual_leaders, expected_leaders):
                for point, key in zip(actual['pts'], ['start', 'end']):
                    wanted = ((0.43 + expected[key]['x'] * 10.14 / 1200) * 72,
                              (1.17 + expected[key]['y'] * 6.55 / 775) * 72)
                    assert math.dist(point, wanted) < 0.01, (path, 'leader moved from home or label')
            # Halo and fill both use this text color. Their glyphs must all exist.
            chars = [char for char in pdf.pages[page_index].chars
                     if char['non_stroking_color'] == (0.098, 0.188, 0.267)]
            runs = [(label, line_index, text) for label in map_data['labels']
                    for line_index, text in enumerate(label['lines'])]
            count = sum(len(text) for _, _, text in runs)
            assert len(chars) == count * 2, (path, page_index, 'missing PDF glyphs')
            chars = chars[count:]
            cursor = 0
            for label, line_index, text in runs:
                glyphs = chars[cursor:cursor + len(text)]
                cursor += len(text)
                assert ''.join(g['text'] for g in glyphs) == text
                assert text in texts[page_index]
                offset = (line_index - (len(label['lines']) - 1) / 2) * label['fontSize'] * 1.15
                angle = math.radians(label['angle'])
                expected_x = (0.43 + (label['x'] - math.sin(angle) * offset) * 10.14 / 1200) * 72
                expected_y = (1.17 + (label['y'] + math.cos(angle) * offset) * 6.55 / 775) * 72
                actual_x = (min(g['x0'] for g in glyphs) + max(g['x1'] for g in glyphs)) / 2
                actual_y = (min(g['top'] for g in glyphs) + max(g['bottom'] for g in glyphs)) / 2
                # PDF font bounding boxes include unused descent below the digits.
                assert math.hypot(actual_x - expected_x, actual_y - expected_y) < 1.5, (
                    path, page_index, text, 'number moved off its intended label position',
                    (actual_x, actual_y), (expected_x, expected_y))
            for street in map_data['streets']:
                assert all(line in texts[page_index] for line in street['lines']), (path, 'missing street callout')
            for char in pdf.pages[page_index].chars:
                assert 0 <= char['x0'] <= char['x1'] <= pdf.pages[page_index].width
                assert 0 <= char['top'] <= char['bottom'] <= pdf.pages[page_index].height
    assert 'Main St' in '\n'.join(texts[2:]) or 'Sample St' in '\n'.join(texts[2:]) or 'Sample Ave' in '\n'.join(texts[2:])
    print(f'{path.name}: two maps, all numbers and leaders positioned correctly, lists and filtering verified')
