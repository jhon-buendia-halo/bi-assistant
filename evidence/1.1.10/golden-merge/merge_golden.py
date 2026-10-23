import json, sys
wc_path, g_path = sys.argv[1], sys.argv[2]
wc_raw = open(wc_path, encoding='utf-8').read()
g_raw = open(g_path, encoding='utf-8').read()
wc, g = json.loads(wc_raw), json.loads(g_raw)

# The golden file's cases array, as text.
start = g_raw.index('"cases": [\n') + len('"cases": [\n')
end = g_raw.rindex('\n  ]\n}')
golden_cases_text = g_raw[start:end]

# Each golden note says where the question came from.
PREFIX = 'From the former World Cup golden set (world-cup-golden, merged into this bank on 2026-10-20). '
n = golden_cases_text.count('      "notes": "')
assert n == len(g['cases']) == 11, n
golden_cases_text = golden_cases_text.replace('      "notes": "', '      "notes": "' + PREFIX)

tail = '\n  ]\n}\n'
assert wc_raw.endswith(tail)
merged = wc_raw[: -len(tail)] + ',\n' + golden_cases_text + tail
m = json.loads(merged)

# Proof: the world-cup cases are untouched, the golden cases equal apart from the note prefix.
assert m['variants'] == wc['variants']
assert m['cases'][: len(wc['cases'])] == wc['cases']
added = m['cases'][len(wc['cases']):]
assert len(added) == len(g['cases'])
for a, b in zip(added, g['cases']):
    assert a['notes'] == PREFIX + b['notes']
    assert {k: v for k, v in a.items() if k != 'notes'} == {k: v for k, v in b.items() if k != 'notes'}
# Same variants in both files, so same fixtures, dialects and prefixes.
assert [(v['fixtureId'], v['dialect'], v['caseIdPrefix']) for v in g['variants']] == \
       [(v['fixtureId'], v['dialect'], v['caseIdPrefix']) for v in wc['variants']]
ids = [c['id'] for c in m['cases']]
assert len(ids) == len(set(ids))
open(wc_path, 'w', encoding='utf-8').write(merged)
print('merged:', len(wc['cases']), '+', len(g['cases']), '=', len(m['cases']), 'cases; held-out:', sum(c.get('split') == 'held-out' for c in m['cases']))
