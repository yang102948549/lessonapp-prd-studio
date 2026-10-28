"""성취기준 원문 데이터(curriculum-data.js) 생성.
기본: jalnanco/korea-learning-map (MIT)  — units.json, standards.json
보강: raphysicst-create/korean-secondary-learning-map-mcp (MIT)
      curriculum-standards.json, standard-texts.json
  1) 제2외국어(중 생활외국어·고 제2외국어) 교과를 추가한다.
  2) 같은 코드의 원문이 개정(고시 제2024-3호 등)으로 달라졌으면 보강 쪽 문구로 바꾼다. 한글 낱말이 바뀐 경우만 받는다.
사용: python tools/build-curriculum.py <units> <standards> <sec-curriculum-standards> <sec-standard-texts> <출력>
출처: 교육부 고시 제2022-33호, 국가교육위원회 고시 제2024-3호"""
import json, re, sys, difflib
units_p, std_p, sec_cs_p, sec_tx_p, out_p = sys.argv[1:6]
load = lambda p: json.load(open(p, encoding='utf8'))
u = load(units_p)['units']
s = {x['id']: x['text'].strip() for x in load(std_p)['standards']}
CODE_RE = re.compile(r'[\[\]]|\d{1,2}[가-힣Ⅰ-Ⅻ]+\d*-\d\d-\d\d')
HANGUL = re.compile(r'[가-힣]')
clean = lambda t: bool(t) and len(t) <= 220 and not CODE_RE.search(t)

# 보강 데이터: key → (원문, 영역)
sec_text = {t['key']: re.sub(r'\s+', ' ', t['text']).strip() for t in load(sec_tx_p)['texts']}
sec = load(sec_cs_p)['curricula']
by_code = {}
for c in sec:
    for st in c['standards']:
        by_code.setdefault(st['code'].strip('[]'), []).append(st['key'])

rows, changed, rejected = [], [], []
for x in u:
    std = []
    for i in x['standards']:
        if i not in s:
            continue
        text = s[i]
        keys = by_code.get(i, [])
        new = sec_text.get(keys[0]) if len(keys) == 1 else None  # 두 교과가 같은 코드를 쓰면 건너뜀
        if new and new != text and clean(new):
            ops = [o for o in difflib.SequenceMatcher(None, text, new).get_opcodes() if o[0] == 'replace']
            word_change = ops and all(HANGUL.search(text[a:b]) and HANGUL.search(new[c:d]) for _, a, b, c, d in ops)
            same_len = difflib.SequenceMatcher(None, text, new).ratio() >= 0.85
            if word_change and same_len and len(ops) == len([o for o in difflib.SequenceMatcher(None, text, new).get_opcodes() if o[0] != 'equal']):
                changed.append((i, text, new)); text = new
        std.append([i, text])
    if std:
        rows.append([x['grade'], x['subject'], x['course'], x['unit'], std])

added = 0
for c in sec:
    if c['subjectGroupKorean'] != '제2외국어':
        continue
    band = '중1~3' if c['schoolLevel'] == 'middle' else '고2~3'
    domains = {}
    for st in c['standards']:
        t = sec_text.get(st['key'])
        if not clean(t):
            rejected.append(st['key']); continue
        domains.setdefault(st['domainKorean'] or c['subjectKorean'], []).append([st['code'].strip('[]'), t])
    for d, items in domains.items():
        rows.append([band, '제2외국어', c['subjectKorean'], d, items]); added += len(items)

data = {'source': '교육부 고시 제2022-33호 · 국가교육위원회 고시 제2024-3호 (2022 개정 교육과정)', 'units': rows}
with open(out_p, 'w', encoding='utf8') as f:
    f.write('/* 자동 생성: tools/build-curriculum.py. units = [학년군, 교과, 과목, 단원(영역), [[성취기준 코드, 원문], ...]] */\n')
    f.write('globalThis.CurriculumData=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(rows), 'units', sum(len(r[4]) for r in rows), 'standards;', added, 'added(제2외국어);', len(changed), 'wording updated;', len(rejected), 'rejected', file=sys.stderr)
for i, a, b in changed:
    print(i, '|', a, '=>', b)
for k in rejected:
    print('REJECTED', k)
