const $ = id => document.getElementById(id);
const PROJECTS_KEY = 'oni.prdai.projects.v1', DEFAULT_NAME = '나의 수업 웹앱', MAX_PROJECTS = 20;
const SECTIONS = Prompt.sections;
const fresh = () => ({version:1, messages:[], doc:{}, chips:Prompt.welcome.chips.slice(), ready:false, focus:''});
let projects = [], currentId = '', state = fresh(), apiKey = '', model = 'gemini-3.8-flash', modelList = [], busy = false, toastTimer, editingId = '', mapOpen = new Set(['T0', 'G0']), mapSel = '', mapSeen = '';
const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const currentProject = () => projects.find(p => p.id === currentId);
/* 이전 버전의 섹션 id를 새 질문 항목으로 옮긴다(예전 기획서 내용 보존) */
const OLD_IDS = {tool:'project', context:'idea', goal:'objective', why:'idea', action:'interaction', content:'materials', env:'devices', ops:'stack', done:'acceptance', open:'extra', nongoals:'extra'};
function migrateDoc(st) {
  const known = new Set(Prompt.sections.map(s => s.id)), doc = {};
  Object.entries(st.doc || {}).forEach(([k, v]) => { const id = known.has(k) ? k : (OLD_IDS[k] || 'extra'); if (typeof v === 'string' && v.trim()) doc[id] = doc[id] ? doc[id] + '\n\n' + v : v; });
  st.doc = doc; if (st.focus && !known.has(st.focus)) st.focus = OLD_IDS[st.focus] || ''; return st;
}
const loadState = raw => migrateDoc({...fresh(), ...(raw && typeof raw === 'object' ? raw : {})});

try {
  const all = JSON.parse(localStorage.getItem(PROJECTS_KEY) || 'null');
  if (all && Array.isArray(all.items) && all.items.length) {
    projects = all.items.map(p => ({id:p.id || uid(), name:p.name || DEFAULT_NAME, updated:p.updated || 0, state:p.state}));
    currentId = projects.some(p => p.id === all.current) ? all.current : projects[0].id;
  }
} catch {}
if (!projects.length) { projects = [{id:uid(), name:DEFAULT_NAME, updated:Date.now(), state:fresh()}]; currentId = projects[0].id; }
state = loadState(currentProject().state);

function redact(text) { return String(text).replace(/AIza[\w-]{20,}/g, '[API 키 삭제됨]').split(apiKey || '\u0000').join(apiKey ? '[API 키 삭제됨]' : '\u0000'); }
function renderSaveStatus() { $('save-status').textContent = `${projects.length}/${MAX_PROJECTS}개 · 이 브라우저에만 저장`; }
function persist() {
  try {
    const p = currentProject(); p.state = state; p.updated = Date.now();
    localStorage.setItem(PROJECTS_KEY, JSON.stringify({current:currentId, items:projects}));
    renderSaveStatus();
  } catch { $('save-status').textContent = '저장 공간 부족 · MD로 다운로드하세요'; }
}
function toast(message, action) {
  const el = $('toast'); el.replaceChildren(document.createTextNode(message));
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = () => { el.style.display = 'none'; action.run(); }; el.append(b); }
  el.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.display = 'none', action ? 7000 : 2800);
}
function openModal({title, message = '', input = null, ok = '확인'}) {
  return new Promise(resolve => {
    const d = $('modal'), inp = $('modal-input'), okb = $('modal-ok'), cancel = $('modal-cancel');
    const none = input === null ? false : null; let done = false;
    const finish = v => { if (done) return; done = true; d.close(); resolve(v); };
    $('modal-title').textContent = title; $('modal-msg').textContent = message; $('modal-msg').hidden = !message;
    inp.hidden = input === null; if (input !== null) inp.value = input; okb.textContent = ok;
    okb.onclick = () => finish(input === null ? true : inp.value); cancel.onclick = () => finish(none);
    d.oncancel = e => { e.preventDefault(); finish(none); }; d.onclick = e => { if (e.target === d) finish(none); };
    inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); okb.click(); } };
    d.showModal(); if (input !== null) { inp.focus(); inp.select(); } else okb.focus();
  });
}

/* ---------- 마크다운 렌더링(안전: textContent만 사용) ---------- */
function inlineMd(parent, text) {
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(t => {
    if (!t) return;
    if (t.startsWith('**') && t.endsWith('**') && t.length > 4) { const b = document.createElement('strong'); b.textContent = t.slice(2, -2); parent.append(b); }
    else if (t.startsWith('`') && t.endsWith('`') && t.length > 2) { const c = document.createElement('code'); c.textContent = t.slice(1, -1); parent.append(c); }
    else parent.append(document.createTextNode(t));
  });
}
function renderMd(text) {
  const box = document.createElement('div'); box.className = 'md'; const lines = text.replace(/\r/g, '').split('\n');
  let i = 0, list = null, para = null; const flush = () => { list = null; para = null; };
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { flush(); i++; continue; }
    if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
      flush(); const wrap = document.createElement('div'); wrap.className = 'md-table'; const table = document.createElement('table');
      const thead = document.createElement('thead'), hr = document.createElement('tr');
      cells(t).forEach(h => { const th = document.createElement('th'); inlineMd(th, h); hr.append(th); }); thead.append(hr);
      const tbody = document.createElement('tbody'); i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { const tr = document.createElement('tr'); cells(lines[i]).forEach(c => { const td = document.createElement('td'); inlineMd(td, c); tr.append(td); }); tbody.append(tr); i++; }
      table.append(thead, tbody); wrap.append(table); box.append(wrap); continue;
    }
    if (/^-{3,}$|^\*{3,}$/.test(t)) { flush(); box.append(document.createElement('hr')); i++; continue; }
    const h = t.match(/^#{1,6}\s+(.*)$/); if (h) { flush(); const e = document.createElement('p'); e.className = 'md-heading'; inlineMd(e, h[1]); box.append(e); i++; continue; }
    const li = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { para = null; if (!list) { list = document.createElement('ul'); box.append(list); } const item = document.createElement('li'); inlineMd(item, li[1]); list.append(item); i++; continue; }
    list = null; if (!para) { para = document.createElement('p'); box.append(para); } else para.append(document.createElement('br')); inlineMd(para, t); i++;
  }
  return box;
}

/* ---------- 화면 ---------- */
function renderMessages() {
  const root = $('messages'); root.replaceChildren();
  const add = (role, build) => { const m = document.createElement('div'); m.className = 'message ' + role; if (role === 'assistant') { const w = document.createElement('div'); w.className = 'who'; w.textContent = '✳ 수업 웹앱 개발 도우미'; m.append(w); } build(m); root.append(m); return m; };
  add('assistant', m => m.append(renderMd(Prompt.welcome.text)));
  state.messages.forEach(msg => add(msg.role, m => { if (msg.role === 'user') m.append(document.createTextNode(msg.text)); else if (msg.error) { const e = document.createElement('div'); e.className = 'error-msg'; e.textContent = msg.text; m.append(e); } else m.append(renderMd(msg.text)); }));
  const cs = !busy && sectionById(currentSection());
  if (cs) { const q = document.createElement('div'); q.className = 'q-block'; const h = document.createElement('h2'); h.textContent = cs.question; const p = document.createElement('p'); p.textContent = cs.help; q.append(h, p); root.append(q); }
  if (guideActive()) root.append(guideCard());
  if (busy) add('assistant', m => { const t = document.createElement('span'); t.className = 'typing'; t.setAttribute('aria-label', '답변을 생각하고 있어요'); t.innerHTML = '<i></i><i></i><i></i>'; m.append(t); });
}
function renderChips() {
  const root = $('chips'); root.replaceChildren();
  $('cur-open').hidden = guideActive();
  if (guideActive()) return;
  if (busy) { for (let i = 0; i < 3; i++) { const s = document.createElement('span'); s.className = 'chip skeleton'; root.append(s); } return; }
  state.chips.forEach(text => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = text; b.title = '입력창에 담기'; b.onclick = () => useChip(text); root.append(b); });
}
function useChip(text) {
  const input = $('chat-input'), cur = input.value.trim();
  input.value = cur ? cur + ' ' + text : text; input.focus(); input.setSelectionRange(input.value.length, input.value.length);
}
function sectionBody(id) { return (state.doc[id] || '').trim(); }
function renderDocument(flashIds = []) {
  const name = currentProject().name; $('doc-title').textContent = name;
  const filled = SECTIONS.filter(s => sectionBody(s.id)).length;
  $('progress').style.width = Math.round(filled / SECTIONS.length * 100) + '%';
  $('progress-text').textContent = `${SECTIONS.length}개 항목 중 ${filled}개가 채워졌어요`;
  $('copy-doc').classList.toggle('ready', state.ready && !busy);
  const root = $('prd-preview'); root.replaceChildren();
  const addSection = s => {
    const sec = document.createElement('div'); sec.className = 'prd-section' + (flashIds.includes(s.id) ? ' flash' : ''); sec.id = 'sec-' + s.id;
    const h = document.createElement('h3'); h.append(document.createTextNode(s.title));
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit'; edit.textContent = '고치기'; edit.onclick = () => { editingId = s.id; renderDocument(); }; h.append(edit); sec.append(h);
    if (editingId === s.id) {
      const ta = document.createElement('textarea'); ta.value = sectionBody(s.id); ta.setAttribute('aria-label', s.title + ' 편집');
      const acts = document.createElement('div'); acts.className = 'edit-actions';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'primary'; save.textContent = '저장'; save.onclick = () => { state.doc[s.id] = redact(ta.value).trim(); editingId = ''; persist(); renderDocument(); };
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소'; cancel.onclick = () => { editingId = ''; renderDocument(); };
      acts.append(save, cancel); sec.append(ta, acts);
    } else if (sectionBody(s.id)) sec.append(renderMd(sectionBody(s.id)));
    else { const p = document.createElement('p'); p.className = 'empty'; p.textContent = s.hint; sec.append(p); }
    root.append(sec);
  };
  Prompt.docSections.forEach(g => { const h2 = document.createElement('h2'); h2.className = 'doc-h2'; h2.textContent = g.title; root.append(h2); g.ids.forEach(id => addSection(sectionById(id))); });
}
const mk = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const isFilled = id => !!sectionBody(id);
const sectionById = id => SECTIONS.find(s => s.id === id);
const currentSection = () => (state.focus && sectionById(state.focus)) ? state.focus : (SECTIONS.find(s => !isFilled(s.id)) || {}).id || '';
const partOf = id => Prompt.parts.find(p => p.ids.includes(id));
const topOf = gid => Prompt.tops.find(t => t.groups.includes(gid));
function renderProjects() {
  renderSaveStatus();
  const list = $('project-list'); list.replaceChildren();
  projects.forEach(p => {
    const row = mk('div', 'project-row' + (p.id === currentId ? ' active' : ''));
    const open = mk('button', 'project-open', p.name); open.type = 'button'; open.title = p.name; open.disabled = busy; if (p.id === currentId) open.setAttribute('aria-current', 'true'); open.onclick = () => switchProject(p.id);
    const edit = mk('button', 'project-tool', '✎'); edit.type = 'button'; edit.setAttribute('aria-label', `${p.name} 이름 바꾸기`); edit.onclick = () => renameProject(p.id);
    const del = mk('button', 'project-tool', '✕'); del.type = 'button'; del.setAttribute('aria-label', `${p.name} 삭제`); del.disabled = busy; del.onclick = () => deleteProject(p.id);
    row.append(open, edit, del); list.append(row);
  });
  $('project-title').textContent = currentProject().name;
}
function renderMap() {
  const host = $('map-canvas'); host.replaceChildren(); const cur = currentSection(), curPart = partOf(cur), curTop = curPart && topOf(curPart.id);
  if (curPart && curPart.id !== mapSeen) { mapOpen.add(curPart.id); if (curTop) mapOpen.add(curTop.id); mapSeen = curPart.id; }
  const filled = SECTIONS.filter(s => isFilled(s.id)).length; $('map-summary').textContent = `${filled}/${SECTIONS.length} 항목이 채워졌어요`;
  const rootUl = mk('ul', 'tree'), rootLi = mk('li', 't-root');
  const rb = mk('button', 't-root-btn', currentProject().name); rb.type = 'button'; rb.title = '눌러서 프로젝트 이름 바꾸기'; rb.onclick = () => renameProject(); rootLi.append(rb);
  const label = (id, title, done, total) => {
    const open = mapOpen.has(id), b = mk('button', 't-part-label'); b.type = 'button'; b.setAttribute('aria-expanded', String(open));
    b.append(mk('span', '', `${open ? '▾' : '▸'} ${title}`), mk('span', 'cnt', `${done}/${total}`)); b.onclick = () => { open ? mapOpen.delete(id) : mapOpen.add(id); renderMap(); }; return b;
  };
  const buildPart = part => {
    const members = part.ids.map(sectionById), done = members.filter(m => isFilled(m.id)).length, open = mapOpen.has(part.id);
    const li = mk('li', 't-part' + (done === members.length ? ' complete' : '') + (curPart === part ? ' current' : ''));
    li.append(label(part.id, part.title, done, members.length));
    if (open) {
      const ul = mk('ul');
      members.forEach(m => {
        const text = sectionBody(m.id), sl = mk('li', 't-step' + (text ? ' done' : '') + (m.id === cur ? ' current' : '') + (m.id === mapSel ? ' sel' : ''));
        const row = mk('div', 't-row'), nb = mk('button', 't-step-btn'); nb.type = 'button'; nb.title = m.hint; nb.setAttribute('aria-pressed', String(m.id === mapSel));
        nb.append(mk('b', '', m.title), mk('span', '', text.replace(/\*\*/g, '') || '아직 이야기하지 않았어요')); nb.onclick = () => { mapSel = m.id === mapSel ? '' : m.id; renderMap(); };
        row.append(nb); sl.append(row); if (m.id === mapSel) sl.append(buildMapDetail(m)); ul.append(sl);
      });
      li.append(ul);
    }
    return li;
  };
  const topUl = mk('ul');
  Prompt.tops.forEach(top => {
    const groups = top.groups.map(id => Prompt.parts.find(p => p.id === id)), ids = groups.flatMap(g => g.ids), done = ids.filter(isFilled).length;
    const li = mk('li', 't-part' + (done === ids.length ? ' complete' : '') + (curTop === top ? ' current' : ''));
    li.append(label(top.id, top.title, done, ids.length));
    if (mapOpen.has(top.id)) { const ul = mk('ul'); groups.forEach(g => ul.append(buildPart(g))); li.append(ul); }
    topUl.append(li);
  });
  rootLi.append(topUl); rootUl.append(rootLi); host.append(rootUl);
}
function buildMapDetail(m) {
  const box = mk('div', 'map-detail'), head = mk('div', 'md-head'); head.append(mk('span', '', m.title));
  const close = mk('button', 'text-button', '닫기'); close.type = 'button'; close.onclick = () => { mapSel = ''; renderMap(); }; head.append(close);
  const ta = document.createElement('textarea'); ta.value = sectionBody(m.id); ta.placeholder = m.hint; ta.disabled = busy; ta.setAttribute('aria-label', m.title);
  const acts = mk('div', 'md-actions');
  const save = mk('button', 'primary', '저장'); save.type = 'button'; save.disabled = busy; save.onclick = () => { if (/AIza[\w-]{20,}/.test(ta.value)) { toast('API 키는 설정에 입력해 주세요.'); return; } const v = redact(ta.value).trim(); if (v) state.doc[m.id] = v; else delete state.doc[m.id]; persist(); render(); toast('수정했어요.'); };
  const talk = mk('button', '', '이 부분 이야기하기'); talk.type = 'button'; talk.onclick = () => { $('chat-input').value = `“${m.title.replace(/^[A-Z]-\d+\.\s*/, '')}” 부분에 대해 이야기하고 싶어요. `; $('detail-panel').classList.remove('mobile-open'); $('chat-input').focus(); };
  acts.append(save, talk);
  box.append(head, mk('div', 'md-q', m.hint), ta, acts); return box;
}
function updateConnection() {
  $('mode-label').classList.toggle('on', !!apiKey);
  $('mode-text').textContent = apiKey ? 'Gemini 연결됨' : 'AI 연결 필요 · 설정에서 API 키를 입력해 주세요';
}
function render(flashIds) {
  renderProjects(); renderMap(); renderMessages(); renderChips(); renderDocument(flashIds); updateConnection();
  $('send').disabled = busy; $('chat-input').disabled = busy; $('new-project').disabled = busy;
}
function scrollChat() { requestAnimationFrame(() => { const c = $('chat-scroll'); c.scrollTo({top:c.scrollHeight, behavior:'smooth'}); }); }
function panel(name) {
  ['map', 'document', 'settings'].forEach(n => { $(n + '-panel').hidden = name !== n; $(n + '-tab').setAttribute('aria-selected', String(name === n)); });
  $('detail-panel').classList.add('mobile-open');
}
function needKey(message) { panel('settings'); $('api-key').focus(); $('key-status').textContent = message; }

/* ---------- Gemini 호출 ---------- */
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(category => ({category, threshold:'BLOCK_ONLY_HIGH'}));
const noThinking = new Set();
function thinkingFor(m) { if (noThinking.has(m)) return null; if (/gemini-3/.test(m)) return {thinkingLevel:'minimal'}; if (/2\.5-flash/.test(m)) return {thinkingBudget:0}; return null; }
const USAGE_KEY = 'oni.usage.v1'; let sessionCalls = 0;
const todayKey = () => new Date().toLocaleDateString('sv');
function todayCalls() { try { const u = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null'); return u && u.date === todayKey() ? u.count : 0; } catch { return 0; } }
function countCall() { sessionCalls++; try { localStorage.setItem(USAGE_KEY, JSON.stringify({date:todayKey(), count:todayCalls() + 1})); } catch {} renderUsage(); }
function renderUsage() { $('usage-info').textContent = `이 브라우저에서 AI를 호출한 횟수: 오늘 ${todayCalls()}회 · 이번 접속 ${sessionCalls}회`; }
async function callModel(m, system, prompt, schema, maxTokens = 4096) {
  const ctl = new AbortController(), timeout = setTimeout(() => ctl.abort(), 120000);
  const levels = [{think:true, schema:true}, {think:false, schema:true}, {think:false, schema:false}]; let li = 0, waited429 = false;
  try {
    let response, detail = '';
    for (let attempt = 0;;) {
      const level = levels[li], cfg = {maxOutputTokens:maxTokens, responseMimeType:'application/json'};
      const think = level.think && thinkingFor(m); if (think) cfg.thinkingConfig = think; if (level.schema) cfg.responseSchema = schema;
      countCall();
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {method:'POST', headers:{'Content-Type':'application/json', 'x-goog-api-key':apiKey}, body:JSON.stringify({systemInstruction:{parts:[{text:system}]}, contents:[{role:'user', parts:[{text:prompt}]}], generationConfig:cfg, safetySettings:SAFETY}), signal:ctl.signal});
      if (response.ok) break;
      try { detail = await response.text(); } catch { detail = ''; }
      if (response.status === 400 && li < levels.length - 1 && /thinking|responseSchema|response_schema|schema|mime|systemInstruction/i.test(detail) && !/API key/i.test(detail)) { if (think) noThinking.add(m); li++; continue; }
      if (response.status === 429 && !waited429 && !/PerDay|per day|daily/i.test(detail)) { const m = detail.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/); const secs = m ? Number(m[1]) : 0; if (secs > 0 && secs <= 30) { waited429 = true; await sleep(secs * 1000 + 500); continue; } }
      if ([500, 503].includes(response.status) && attempt < 1) { attempt++; await sleep(1500 * attempt); continue; }
      break;
    }
    if (!response.ok) {
      const daily = response.status === 429 && /PerDay|per day|daily/i.test(detail);
      const messages = {400:'키 또는 모델 설정을 확인해 주세요.', 401:'유효한 API 키를 입력해 주세요.', 403:'키 권한이나 API 사용 권한을 확인해 주세요.', 404:'이 모델을 찾을 수 없어요. 설정에서 다른 모델을 선택해 주세요.', 500:'AI 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.', 503:'선택한 모델이 지금 혼잡해요. 잠시 후 다시 시도하거나 설정에서 다른 모델을 선택해 주세요.', 429:daily ? '오늘의 무료 사용량을 모두 썼어요. 내일 다시 시도하거나 다른 모델을 선택해 보세요.' : '분당 요청 한도에 도달했어요. 1분쯤 뒤 다시 시도하거나 더 가벼운 모델(Flash-Lite 등)을 선택해 보세요.'};
      let why = ''; try { why = JSON.parse(detail).error?.message || ''; } catch {}
      const err = new Error((messages[response.status] || 'AI 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.') + (why ? ` [${response.status}: ${redact(why).slice(0, 160)}]` : ` [${response.status}]`)); err.retryOther = [429, 503].includes(response.status); throw err;
    }
    const data = await response.json();
    if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('응답이 길어 중간에 멈췄어요. 한 번에 말씀하시는 양을 줄여 다시 시도해 주세요.');
    const result = data.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text || '').join('');
    if (!result) { const block = data.promptFeedback?.blockReason, fin = data.candidates?.[0]?.finishReason; throw new Error('AI가 답변을 만들지 못했어요. 다시 시도해 주세요.' + (block || fin ? ` [${block || fin}]` : '')); }
    return redact(result);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('응답 대기 시간이 지났어요. 다시 시도해 주세요.');
    if (error instanceof TypeError) throw new Error('네트워크 연결을 확인해 주세요. 학교 네트워크나 광고 차단 프로그램이 Google API를 막고 있을 수 있어요.');
    throw error;
  } finally { clearTimeout(timeout); }
}
const modelVer = id => Number((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
/* 자동 전환 후보: 같은 세대 이상의 Flash 계열만(종료된 2.x 모델은 제외), 정식 버전을 먼저 */
function altModels() { const base = modelVer(model); return modelList.map(x => x.id).filter(id => id !== model && /flash/.test(id) && !/image|tts|live|thinking/.test(id) && modelVer(id) >= Math.max(3, base)).sort((a, b) => /preview|exp/.test(a) - /preview|exp/.test(b) || modelVer(b) - modelVer(a)).slice(0, 2); }
async function requestAI(...args) {
  try { return await callModel(model, ...args); }
  catch (error) {
    if (!error.retryOther) throw error;
    for (const alt of altModels()) { try { const out = await callModel(alt, ...args); toast(`${model} 모델이 혼잡해서 ${alt} 모델로 답했어요.`); return out; } catch {} }
    throw error;
  }
}
function parseJSON(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)); throw new Error('AI 응답 형식을 읽지 못했어요. 다시 시도해 주세요.'); }
}

/* ---------- 대화 ---------- */
function applyReply(json) {
  const reply = String(json.reply || '').trim(); if (!reply) throw new Error('AI가 답변을 만들지 못했어요. 다시 시도해 주세요.');
  const known = new Set(SECTIONS.map(s => s.id)), changed = [];
  (Array.isArray(json.updates) ? json.updates : []).forEach(u => { const id = String(u.id || ''), md = String(u.markdown || '').trim(); if (known.has(id) && md && md !== sectionBody(id)) { state.doc[id] = redact(md); changed.push(id); } });
  state.messages.push({role:'assistant', text:redact(reply)});
  state.chips = (Array.isArray(json.chips) ? json.chips : []).map(c => redact(String(c).trim())).filter(Boolean).slice(0, 5);
  state.ready = !!json.ready; state.focus = sectionById(String(json.focus || '')) ? String(json.focus) : ''; curDismissed = false;
  const title = String(json.title || '').trim().slice(0, 40);
  if (title && /^(나의 수업 웹앱|새 프로젝트 ?\d*)$/.test(currentProject().name)) currentProject().name = title;
  return changed;
}
async function askAI() {
  busy = true; $('chat-notice').textContent = ''; render(); scrollChat();
  let changed = [];
  try {
    const json = parseJSON(await requestAI(Prompt.role, Prompt.chatPrompt(state.messages, state.doc), Prompt.chatSchema, 4096));
    changed = applyReply(json);
  } catch (error) {
    state.messages.push({role:'assistant', text:error.message + ' (보내신 말씀은 보관되어 있어요. [다시 시도]를 눌러 주세요.)', error:true});
  } finally { busy = false; persist(); render(changed); scrollChat(); if (changed.length && !$('detail-panel').classList.contains('mobile-open')) toast(`기획서 ${changed.length}곳을 채웠어요`); if (state.messages.at(-1)?.error) addRetry(); $('chat-input').focus(); }
}
function addRetry() {
  const last = $('messages').lastElementChild?.querySelector('.error-msg'); if (!last) return;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = '다시 시도'; b.onclick = () => { if (busy) return; state.messages.pop(); persist(); askAI(); }; last.append(b);
}
function send(text) {
  if (busy) return false;
  text = text.trim(); if (!text) return false;
  if (/AIza[\w-]{20,}/.test(text) || (apiKey && text.includes(apiKey))) { $('chat-input').value = ''; needKey('API 키는 대화가 아니라 이 입력란에 넣어 주세요.'); return false; }
  if (!apiKey) { needKey('대화를 시작하려면 Gemini API 키를 연결해 주세요. 아래 안내를 따라 발급받을 수 있어요.'); return false; }
  state.messages.push({role:'user', text:redact(text)}); state.chips = []; persist(); askAI(); return true;
}
/* 교육과정 성취기준 안내: AI가 학년·교과를 물을 차례(처음 포함)에는 칩 대신 채팅 안에서 성취기준을 검색해 고른다 */
let curEl = null, curHandle = null, curDismissed = false, curForced = false;
const guideActive = () => !busy && !curDismissed && (curForced || ['school', 'grades', 'subjects', 'idea'].includes(state.focus) || !state.messages.length);
function guideCard() {
  if (curEl) return curEl;
  curEl = document.createElement('div'); curEl.className = 'cur-guide';
  const h = document.createElement('h3'); h.textContent = '교육과정에서 수업 고르기';
  const sub = document.createElement('p'); sub.className = 'cur-sub'; sub.textContent = '낱말을 검색하거나 학년군·교과를 골라 성취기준을 선택하세요. 고른 원문이 바로 단원과 주제의 답이 돼요.';
  const body = document.createElement('div');
  const act = document.createElement('div'); act.className = 'cur-guide-actions';
  const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'text-button'; skip.textContent = '직접 입력할게요';
  skip.onclick = () => { curDismissed = true; curForced = false; render(); };
  act.append(skip); curEl.append(h, sub, body, act);
  curHandle = Curriculum.mount(body, {base: '../', applyLabel: '이 성취기준으로 이야기하기', onApply: r => {
    if (send(`수업 교육과정은 아래 성취기준이에요. 사용 수업과 학습 목표에 반영해 주세요.
${Curriculum.format(r)}`)) { curHandle.reset(); curForced = false; }
  }});
  return curEl;
}
$('cur-open').onclick = () => { curForced = true; curDismissed = false; render(); scrollChat(); };
$('save-status').onclick = () => panel('settings');
$('composer').onsubmit = e => { e.preventDefault(); if (send($('chat-input').value)) $('chat-input').value = ''; };
$('chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } };

const docText = () => '# ' + currentProject().name + ' PRD\n\n> 질문 답변을 정리한 설계 초안입니다. [미정] 항목과 자료 원문을 확인하세요.\n\n' + Prompt.docSections.map(g => `## ${g.title}\n` + g.ids.map(id => `### ${sectionById(id).title}\n${sectionBody(id) || '[미정] 질문에 답하거나 AI 제안을 검토해 주세요.'}`).join('\n\n')).join('\n\n');
$('copy-doc').onclick = async () => { try { await navigator.clipboard.writeText(docText()); toast('기획서를 복사했어요.'); } catch { toast('복사 권한이 없어요. MD 다운로드를 사용해 주세요.'); } };
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('download-doc').onclick = () => download(new Blob([docText()], {type:'text/markdown;charset=utf-8'}), (currentProject().name.replace(/[\\/:*?"<>|]/g, '') || 'PRD') + '-PRD.md');

/* ---------- 프로젝트 ---------- */
function resetView() { editingId = ''; curDismissed = false; curForced = false; if (curHandle) curHandle.reset(); mapSel = ''; mapSeen = ''; $('chat-input').value = ''; $('chat-notice').textContent = ''; $('detail-panel').classList.remove('mobile-open'); }
function switchProject(id) { if (busy || id === currentId) return; persist(); currentId = id; state = loadState(currentProject().state); resetView(); persist(); render(); scrollChat(); }
function newProject() {
  if (busy) return; if (projects.length >= MAX_PROJECTS) { toast(`프로젝트는 최대 ${MAX_PROJECTS}개까지 저장할 수 있어요.`); return; }
  persist(); let n = projects.length + 1, name = `새 프로젝트 ${n}`; while (projects.some(p => p.name === name)) name = `새 프로젝트 ${++n}`;
  const p = {id:uid(), name, updated:Date.now(), state:fresh()}; projects.push(p); currentId = p.id; state = p.state; resetView(); persist(); render(); toast('새 프로젝트를 만들었어요.');
}
async function renameProject(id = currentId) { const p = projects.find(x => x.id === id), v = await openModal({title:'프로젝트 이름 바꾸기', input:p.name, ok:'저장'}); const name = (v || '').trim().slice(0, 40); if (!name) return; p.name = name; persist(); render(); }
async function deleteProject(id = currentId) {
  if (busy) return; const p = projects.find(x => x.id === id);
  if (!await openModal({title:'프로젝트를 삭제할까요?', message:`“${p.name}”의 대화와 기획서가 모두 사라져요.`, ok:'삭제'})) return;
  if (projects.length === 1) { p.state = fresh(); p.name = DEFAULT_NAME; if (id === currentId) state = p.state; }
  else { const idx = projects.indexOf(p); projects.splice(idx, 1); if (id === currentId) { currentId = projects[Math.min(idx, projects.length - 1)].id; state = loadState(currentProject().state); } }
  resetView(); persist(); render(); toast('프로젝트를 삭제했어요.');
}
$('new-project').onclick = newProject; $('project-title').onclick = () => renameProject();
$('export-projects').onclick = () => { persist(); download(new Blob([JSON.stringify({app:'oni-prdai', version:1, items:projects}, null, 1)], {type:'application/json'}), 'oni-prdai-projects.json'); };
$('import-projects').onclick = () => $('import-file').click();
$('import-file').onchange = async () => {
  const file = $('import-file').files[0]; $('import-file').value = ''; if (!file) return;
  try {
    const data = JSON.parse(await file.text()); if (!Array.isArray(data.items)) throw 0; persist(); let count = 0;
    data.items.forEach(p => { if (projects.length < MAX_PROJECTS && p && p.state && Array.isArray(p.state.messages)) { projects.push({id:uid(), name:String(p.name || DEFAULT_NAME).slice(0, 40), updated:Date.now(), state:loadState(p.state)}); count++; } });
    if (!count) throw 0; persist(); render(); toast(`${count}개 프로젝트를 불러왔어요.`);
  } catch { toast('프로젝트 파일을 읽지 못했어요. 이 도구에서 내보낸 파일인지 확인해 주세요.'); }
};

/* ---------- 설정/API 키 ---------- */
async function listModels(key) {
  const out = []; let token = '';
  try {
    do {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), {headers:{'x-goog-api-key':key}});
      if (!response.ok) { const messages = {400:'API 키가 올바르지 않아요. 다시 확인해 주세요.', 401:'유효한 API 키를 입력해 주세요.', 403:'키 권한이 없거나 사용이 제한된 키예요.', 429:'요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.'}; throw new Error(messages[response.status] || 'AI 서비스가 응답하지 않아요.'); }
      const data = await response.json();
      for (const m of data.models || []) if ((m.supportedGenerationMethods || []).includes('generateContent')) out.push({id:m.name.replace(/^models\//, ''), label:m.displayName || m.name});
      token = data.nextPageToken || '';
    } while (token);
  } catch (error) { if (error instanceof TypeError) throw new Error('네트워크 연결을 확인해 주세요. 학교 네트워크나 광고 차단 프로그램이 Google API를 막고 있을 수 있어요.'); throw error; }
  return out.filter(m => /^gemini-/.test(m.id) && !/embedding|tts|image|live|aqa|robotics|computer-use/.test(m.id));
}
function fillModels(list) {
  const select = $('model'); select.replaceChildren();
  for (const m of list) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label + ' (' + m.id + ')'; select.append(o); }
  modelList = list; const pick = list.find(m => m.id === model) || list.find(m => m.id === 'gemini-3.8-flash') || list[0]; select.value = pick.id; model = pick.id; select.disabled = false;
}
$('model').onchange = () => { model = $('model').value; toast('모델을 변경했어요.'); };
$('connect-key').onclick = async () => {
  if (busy) return; const key = $('api-key').value.trim(); if (!key) { $('key-status').textContent = 'API 키를 입력해 주세요.'; return; }
  $('connect-key').disabled = true; $('key-status').textContent = '연결 확인 중…';
  try { const list = await listModels(key); if (!list.length) throw new Error('이 키로 사용할 수 있는 Gemini 모델이 없어요.'); apiKey = key; fillModels(list); $('api-key').value = ''; $('key-status').textContent = '연결되었습니다. 이제 대화를 시작하세요. 모델은 위 목록에서 바꿀 수 있어요.'; updateConnection(); $('detail-panel').classList.remove('mobile-open'); $('chat-input').focus(); }
  catch (error) { $('key-status').textContent = error.message; } finally { $('connect-key').disabled = false; }
};
$('remove-key').onclick = () => { modelList = []; if (busy) { toast('진행 중인 요청이 끝난 뒤 삭제해 주세요.'); return; } apiKey = ''; $('model').replaceChildren(new Option('연결 후 선택할 수 있어요', 'gemini-3.8-flash')); $('model').disabled = true; model = 'gemini-3.8-flash'; $('api-key').value = ''; $('key-status').textContent = '키를 삭제했습니다.'; updateConnection(); };
$('api-key').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('connect-key').click(); } };
$('map-tab').onclick = () => panel('map'); $('document-tab').onclick = () => panel('document'); $('settings-tab').onclick = () => panel('settings');
$('panel-toggle').onclick = () => $('detail-panel').classList.toggle('mobile-open');
$('map-expand').onclick = () => { Prompt.parts.forEach(p => mapOpen.add(p.id)); Prompt.tops.forEach(t => mapOpen.add(t.id)); renderMap(); };
$('map-collapse').onclick = () => { mapOpen.clear(); const c = partOf(currentSection()); if (c) { mapOpen.add(c.id); const t = topOf(c.id); if (t) mapOpen.add(t.id); } renderMap(); };
const SB_KEY = 'oni.prdai.sidebar.v1'; let sbState = {}; try { sbState = JSON.parse(localStorage.getItem(SB_KEY) || '{}'); } catch {}
document.querySelectorAll('.sb-toggle').forEach(btn => { const target = $(btn.dataset.target); const apply = open => { target.hidden = !open; btn.setAttribute('aria-expanded', String(open)); }; apply(sbState[btn.dataset.target] !== false); btn.onclick = () => { const open = target.hidden; apply(open); sbState[btn.dataset.target] = open; try { localStorage.setItem(SB_KEY, JSON.stringify(sbState)); } catch {} }; });
window.addEventListener('storage', e => { if (e.key === PROJECTS_KEY) $('save-status').textContent = '다른 탭에서 변경됨 · 새로고침하면 반영돼요'; });

renderUsage(); render();
if (!apiKey) $('chat-notice').textContent = '먼저 오른쪽 [설정]에서 Gemini API 키를 연결하면 대화를 시작할 수 있어요.';
