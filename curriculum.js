/* 2022 개정 교육과정(교육부 고시 제2022-33호) 성취기준 선택기. 데이터는 curriculum-data.js(처음 열 때 불러옴). 두 앱이 함께 씁니다. */
globalThis.Curriculum = (() => {
  let loading = null;
  const rows = () => (globalThis.CurriculumData ? globalThis.CurriculumData.units : []);
  function load(base = '') {
    if (globalThis.CurriculumData) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = base + 'curriculum-data.js?v=2';
      s.onload = () => resolve();
      s.onerror = () => { loading = null; s.remove(); reject(new Error('교육과정 데이터를 불러오지 못했어요.')); };
      document.head.append(s);
    });
    return loading;
  }

  /* 학교급·학년(예: 초등학교, ['5학년','6학년']) → 해당 학년군 이름. 학년이 없으면 학교급 전체 */
  function bandsFor(school, grades) {
    const nums = (Array.isArray(grades) ? grades : [grades]).map(g => parseInt(g, 10)).filter(Boolean);
    const all = [...new Set(rows().map(r => r[0]))];
    const head = /^초/.test(school) ? '초' : /^중/.test(school) ? '중' : /^고/.test(school) ? '고' : '';
    const pool = all.filter(b => !head || b.startsWith(head));
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
  const uniq = a => [...new Set(a)];
  const inBands = bands => rows().filter(r => bands.includes(r[0]));

  /* opts: {school, grades, subjects, onApply(result), submitLabel}. 선택 결과가 바뀔 때마다 result는 onChange로도 알린다 */
  function mount(root, opts = {}) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const field = (label, ...nodes) => { const w = el('label', 'cur-field'); w.append(el('span', '', label), ...nodes); return w; };
    const select = () => { const s = document.createElement('select'); return s; };
    const fill = (s, items, first, keep) => { s.replaceChildren(); if (first) s.append(new Option(first, '')); items.forEach(i => s.append(new Option(i, i))); if (keep && items.includes(keep)) s.value = keep; };

    root.replaceChildren();
    root.classList.add('cur-picker');
    const status = el('p', 'cur-note', '교육과정 데이터를 불러오는 중…');
    root.append(status);

    return load(opts.base || '').then(() => {
      const bands = bandsFor(opts.school || '', opts.grades || []);
      const pool = inBands(bands);
      if (!pool.length) { status.textContent = '선택한 학교급·학년의 교육과정 데이터가 없어요.'; return; }
      const sBand = select(), sSubject = select(), sCourse = select(), sUnit = select();
      const search = document.createElement('input'); search.type = 'search'; search.placeholder = '성취기준 안에서 검색 (예: 분수, 토론)'; search.setAttribute('aria-label', '성취기준 검색');
      const list = el('div', 'cur-list'); list.setAttribute('role', 'group'); list.setAttribute('aria-label', '성취기준');
      const foot = el('div', 'cur-foot'), count = el('span', 'cur-count'), apply = el('button', 'primary', opts.submitLabel || '선택한 내용 사용하기'); apply.type = 'button';
      foot.append(count, apply);
      const src = el('p', 'cur-note', `출처: ${globalThis.CurriculumData.source}`);
      const top = el('div', 'cur-row');
      if (bands.length > 1) top.append(field('학년군', sBand));
      top.append(field('교과', sSubject), field('과목', sCourse), field('단원(영역)', sUnit));
      root.replaceChildren(top, field('검색', search), list, foot, src);

      const picked = new Map(); // 코드 → 원문
      const scope = () => pool.filter(r => r[0] === sBand.value);
      fill(sBand, bands);
      const reload = (level) => {
        const inBand = scope();
        if (level <= 0) { const subs = uniq(inBand.map(r => r[1])); fill(sSubject, subs, null, sSubject.value || guessSubject(subs, opts.subjects)); }
        const bySub = inBand.filter(r => r[1] === sSubject.value);
        if (level <= 1) { const cs = uniq(bySub.map(r => r[2])); fill(sCourse, cs, cs.length > 1 ? '전체 과목' : null, sCourse.value); }
        const byCourse = bySub.filter(r => !sCourse.value || r[2] === sCourse.value);
        if (level <= 2) { const us = uniq(byCourse.map(r => r[3])); fill(sUnit, us, '전체 단원', sUnit.value); }
        const byUnit = byCourse.filter(r => !sUnit.value || r[3] === sUnit.value);
        paint(byUnit);
      };
      const paint = units => {
        const q = search.value.trim();
        list.replaceChildren();
        let n = 0;
        units.forEach(r => r[4].forEach(([id, text]) => {
          if (q && !text.includes(q) && !id.includes(q)) return;
          n++;
          const row = el('label', 'cur-item'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = picked.has(id);
          cb.onchange = () => { cb.checked ? picked.set(id, { id, text, band: r[0], subject: r[1], course: r[2], unit: r[3] }) : picked.delete(id); sync(); };
          const body = el('span', 'cur-text'); body.append(el('b', '', `[${id}] `), document.createTextNode(text));
          if (!sUnit.value || !sCourse.value) body.append(el('small', '', ` ${r[2] !== r[1] ? r[2] + ' · ' : ''}${r[3]}`));
          row.append(cb, body); list.append(row);
        }));
        if (!n) list.append(el('p', 'cur-note', q ? '검색 결과가 없어요.' : '이 범위에 성취기준이 없어요.'));
        sync();
      };
      const sync = () => { count.textContent = picked.size ? `성취기준 ${picked.size}개 선택` : '성취기준을 골라 주세요'; apply.disabled = !picked.size; };
      sBand.onchange = () => { sSubject.value = ''; sCourse.value = ''; sUnit.value = ''; reload(0); };
      sSubject.onchange = () => { sCourse.value = ''; sUnit.value = ''; reload(1); };
      sCourse.onchange = () => { sUnit.value = ''; reload(2); };
      sUnit.onchange = () => reload(3);
      search.oninput = () => reload(3);
      apply.onclick = () => opts.onApply && opts.onApply(result());
      const result = () => ({ standards: [...picked.values()] });
      reload(0);
    }).catch(e => { status.textContent = e.message; });
  }

  /* 선택 결과 → 문장. 같은 교과·과목·단원끼리 묶어 성취기준 원문을 그대로 싣는다 */
  function format(result) {
    const groups = new Map();
    result.standards.forEach(s => {
      const key = [s.band, s.subject, s.course, s.unit].join('\u0001');
      if (!groups.has(key)) groups.set(key, { s, items: [] });
      groups.get(key).items.push(s);
    });
    return [...groups.values()].map(({ s, items }) => {
      const where = [s.band, s.subject, s.course !== s.subject ? s.course : '', s.unit].filter(Boolean).join(' · ');
      return `${where}\n${items.map(i => `- [${i.id}] ${i.text}`).join('\n')}`;
    }).join('\n');
  }

  return { load, mount, format, bandsFor };
})();
