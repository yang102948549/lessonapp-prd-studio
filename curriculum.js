/* 2022 개정 교육과정(교육부 고시 제2022-33호) 성취기준 선택기. 데이터는 curriculum-data.js(처음 열 때 불러옴). 두 앱이 함께 씁니다. */
globalThis.Curriculum = (() => {
  let loading = null;
  const rows = () => (globalThis.CurriculumData ? globalThis.CurriculumData.units : []);
  function load(base = '') {
    if (globalThis.CurriculumData) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + 'curriculum-data.js?v=3';
      s.onload = () => resolve();
      s.onerror = () => { loading = null; s.remove(); reject(new Error('교육과정 데이터를 불러오지 못했어요.')); };
      document.head.append(s);
    });
    return loading;
  }

  const ORDER = ['초1~2', '초3~4', '초5~6', '중1~3', '고1', '고2~3'];
  const LEVEL = {'초': '초등학교', '중': '중학교', '고': '고등학교'};
  const uniq = a => [...new Set(a)];
  const allBands = () => { const have = uniq(rows().map(r => r[0])); return ORDER.filter(b => have.includes(b)).concat(have.filter(b => !ORDER.includes(b))); };

  /* 학교급·학년(예: 초등학교, ['5학년','6학년']) → 해당 학년군 이름. 학년이 없으면 학교급 전체, 학교급이 없으면 전체 */
  function bandsFor(school, grades) {
    const nums = (Array.isArray(grades) ? grades : [grades]).map(g => parseInt(g, 10)).filter(Boolean);
    const head = /^초/.test(school || '') ? '초' : /^중/.test(school || '') ? '중' : /^고/.test(school || '') ? '고' : '';
    const pool = allBands().filter(b => !head || b.startsWith(head));
    if (!nums.length || !head) return pool;
    const fit = pool.filter(b => {
      const m = b.match(/(\d)(?:~(\d))?$/);
      const lo = Number(m[1]), hi = Number(m[2] || m[1]);
      return nums.some(n => n >= lo && n <= hi);
    });
    return fit.length ? fit : pool;
  }

  /* 앱의 과목 이름 → 데이터의 교과 이름(미리 골라 두기용) */
  const SUBJECT_ALIAS = {
    '한국사': '사회', '역사': '사회', '통합사회': '사회', '정치와 법': '사회', '경제': '사회', '세계시민과 지리': '사회',
    '통합과학': '과학', '과학탐구실험': '과학', '물리학': '과학', '화학': '과학', '생명과학': '과학', '지구과학': '과학',
    '윤리와 사상': '도덕', '기술·가정': '실과·기술가정·정보', '정보': '실과·기술가정·정보', '실과': '실과·기술가정·정보'
  };
  const guessSubject = (list, names) => {
    for (const n of names || []) { const k = SUBJECT_ALIAS[n] || n; const hit = list.find(s => s === k || s.startsWith(k)); if (hit) return hit; }
    return '';
  };
  const subjectsIn = bands => uniq(rows().filter(r => bands.includes(r[0])).map(r => r[1]));

  /* 검색: 낱말은 공백으로 나누어 모두 포함해야 한다. 원문뿐 아니라 학교급·학년군·교과·과목·단원·코드도 대상이라 "고등학교 독일어"도 찾는다 */
  function search({bands, subject = '', unitKey = '', query = '', limit = 60} = {}) {
    const words = String(query).trim().split(/\s+/).filter(Boolean);
    const out = []; let total = 0;
    for (const r of rows()) {
      if (bands && bands.length && !bands.includes(r[0])) continue;
      if (subject && r[1] !== subject) continue;
      if (unitKey && `${r[2]}\u0001${r[3]}` !== unitKey) continue;
      const head = `${LEVEL[r[0][0]] || ''} ${r[0]} ${r[1]} ${r[2]} ${r[3]}`;
      for (const [id, text] of r[4]) {
        if (words.length) { const hay = `${head} ${id} ${text}`; if (!words.every(w => hay.includes(w))) continue; }
        total++;
        if (out.length < limit) out.push({id, text, band: r[0], subject: r[1], course: r[2], unit: r[3]});
      }
    }
    return {total, items: out};
  }

  /* opts: {school, grades, subjects, base, onChange(성취기준, 선택됨)}. 선택·해제할 때마다 onChange가 불린다(reset은 부르지 않음). 돌려주는 값: {ready, reset()} */
  function mount(root, opts = {}) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const field = (label, node) => { const w = el('label', 'cur-field'); w.append(el('span', '', label), node); return w; };
    const fill = (s, items, first, keep) => {
      s.replaceChildren();
      if (first) s.append(new Option(first, ''));
      items.forEach(i => s.append(new Option(Array.isArray(i) ? i[1] : i, Array.isArray(i) ? i[0] : i)));
      if (keep != null && [...s.options].some(o => o.value === keep)) s.value = keep;
    };
    const handle = {ready: null, reset() {}};

    root.replaceChildren();
    root.classList.add('cur-picker');
    const status = el('p', 'cur-note', '교육과정 데이터를 불러오는 중…');
    root.append(status);

    handle.ready = load(opts.base || '').then(() => {
      const bands = bandsFor(opts.school || '', opts.grades || []);
      const sBand = document.createElement('select'), sSubject = document.createElement('select'), sUnit = document.createElement('select');
      const q = document.createElement('input');
      q.type = 'text'; q.className = 'cur-q'; q.placeholder = '낱말로 검색 (예: 분수, 토론, 독일어, 광합성)'; q.autocomplete = 'off'; q.spellcheck = false; q.setAttribute('aria-label', '성취기준 검색');
      const list = el('div', 'cur-list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', '검색 결과');
      const tray = el('div', 'cur-tray'), foot = el('div', 'cur-foot'), count = el('span', 'cur-count');
      foot.append(count);
      const top = el('div', 'cur-row');
      top.append(field('학년군', sBand), field('교과', sSubject), field('단원(영역)', sUnit));
      const search1 = el('div', 'cur-search'); search1.append(q);
      root.replaceChildren(search1, top, list, tray, foot, el('p', 'cur-note', `출처: ${globalThis.CurriculumData.source}`));

      const picked = new Map(); // `${코드}|${과목}` → 성취기준
      let limit = 60;
      const bandsNow = () => (sBand.value ? [sBand.value] : bands);
      const syncSubjects = () => {
        const subs = subjectsIn(bandsNow());
        fill(sSubject, subs, '전체 교과', subs.includes(sSubject.value) ? sSubject.value : guessSubject(subs, opts.subjects));
      };
      const syncUnits = () => {
        const seen = new Map();
        rows().filter(r => bandsNow().includes(r[0]) && r[1] === sSubject.value).forEach(r => seen.set(`${r[2]}\u0001${r[3]}`, r[2] !== r[1] ? `${r[2]} · ${r[3]}` : r[3]));
        fill(sUnit, [...seen], '전체 단원', sUnit.value);
        sUnit.disabled = !sSubject.value;
      };
      const change = (s, on) => opts.onChange && opts.onChange(s, on);
      const paintTray = () => {
        tray.replaceChildren();
        picked.forEach((s, key) => {
          const chip = el('span', 'cur-chip'); chip.title = s.text;
          const x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', `${s.id} 선택 취소`);
          x.onclick = () => { picked.delete(key); paint(); change(s, false); };
          chip.append(el('b', '', s.id), x); tray.append(chip);
        });
        tray.hidden = !picked.size;
        count.textContent = picked.size ? `${picked.size}개 선택` : ''; foot.hidden = !picked.size;
      };
      const paint = () => {
        list.replaceChildren();
        if (!(q.value.trim() || sSubject.value || sBand.value)) { list.append(el('p', 'cur-hint', '낱말을 검색하거나 학년군·교과를 고르면 성취기준이 나와요.')); paintTray(); return; }
        const r = search({bands: bandsNow(), subject: sSubject.value, unitKey: sUnit.value, query: q.value, limit});
        r.items.forEach(s => {
          const key = `${s.id}|${s.course}`, on = picked.has(key);
          const row = el('button', 'cur-item' + (on ? ' on' : '')); row.type = 'button'; row.setAttribute('aria-pressed', String(on));
          const body = el('span', 'cur-text');
          body.append(el('b', '', s.id), document.createTextNode(' ' + s.text), el('small', '', `${s.band} · ${s.subject}${s.course !== s.subject ? ' · ' + s.course : ''} · ${s.unit}`));
          row.append(el('span', 'cur-mark', on ? '✓' : ''), body);
          row.onclick = () => { on ? picked.delete(key) : picked.set(key, s); paint(); change(s, !on); };
          list.append(row);
        });
        if (!r.total) list.append(el('p', 'cur-hint', '검색 결과가 없어요. 낱말을 줄이거나 필터를 풀어 보세요.'));
        else if (r.total > r.items.length) {
          const more = el('button', 'cur-more', `결과 ${r.total}개 중 ${r.items.length}개 · 더 보기`); more.type = 'button';
          more.onclick = () => { limit += 60; paint(); }; list.append(more);
        }
        paintTray();
      };
      const refilter = () => { limit = 60; paint(); };
      fill(sBand, bands.map(b => [b, b]), bands.length > 1 ? '전체 학년군' : null, bands.length === 1 ? bands[0] : '');
      syncSubjects(); syncUnits(); paint();
      sBand.onchange = () => { syncSubjects(); syncUnits(); refilter(); };
      sSubject.onchange = () => { sUnit.value = ''; syncUnits(); refilter(); };
      sUnit.onchange = refilter;
      q.oninput = refilter;
      q.onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };
      handle.reset = () => { picked.clear(); q.value = ''; limit = 60; paint(); };
    }).catch(e => { status.textContent = e.message; });
    return handle;
  }

  /* 선택 결과 → 문장. 같은 교과·과목·단원끼리 묶어 성취기준 원문을 그대로 싣는다 */
  function format(result) {
    const groups = new Map();
    result.standards.forEach(s => {
      const key = [s.band, s.subject, s.course, s.unit].join('\u0001');
      if (!groups.has(key)) groups.set(key, {s, items: []});
      groups.get(key).items.push(s);
    });
    return [...groups.values()].map(({s, items}) => {
      const where = [s.band, s.subject, s.course !== s.subject ? s.course : '', s.unit].filter(Boolean).join(' · ');
      return `${where}\n${items.map(i => `- [${i.id}] ${i.text}`).join('\n')}`;
    }).join('\n');
  }

  /* 채팅 입력란에 성취기준 한 줄을 넣고 뺀다. 사용자가 고친 다른 글은 그대로 둔다 */
  const line = s => `- [${s.id}] ${s.text}`;
  const isLine = (t, s) => t.startsWith(`- [${s.id}]`);
  function syncInput(input, s, on) {
    const lines = input.value.split('\n').filter(t => !isLine(t, s));
    if (on) lines.push(line(s));
    input.value = lines.join('\n').trim();
    input.dispatchEvent(new Event('input', {bubbles: true}));
    if (on) { input.focus(); input.scrollTop = input.scrollHeight; }
  }

  return {load, mount, format, line, syncInput, bandsFor, search};
})();
