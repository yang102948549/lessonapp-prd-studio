const $ = id => document.getElementById(id);
const STORAGE = 'lessonapp.workspace.v1', PROJECTS_KEY = 'oni.projects.v1', DEFAULT_NAME = '나의 수업 웹앱', MAX_PROJECTS = 20, QUOTA_BYTES = 5*1024*1024;
const definitions = Planning.steps;
const fresh = () => ({version:3,step:0,answers:{},messages:[],draft:'',draftStale:false,previousDraft:'',extraSubjects:[]});
let state = fresh(), projects = [], currentId = '';
const uid=()=>'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const loadState=raw=>{try{const saved=Planning.migrate(raw);return saved?{...fresh(),...saved}:fresh();}catch{return fresh();}};
try{const all=JSON.parse(localStorage.getItem(PROJECTS_KEY)||'null');if(all&&Array.isArray(all.items)&&all.items.length){projects=all.items.map(p=>({id:p.id||uid(),name:p.name||DEFAULT_NAME,updated:p.updated||0,state:p.state}));currentId=projects.some(p=>p.id===all.current)?all.current:projects[0].id;}}catch{}
if(!projects.length){let old=null;try{old=JSON.parse(localStorage.getItem(STORAGE));}catch{}projects=[{id:uid(),name:DEFAULT_NAME,updated:Date.now(),state:loadState(old)}];currentId=projects[0].id;}
state=loadState(projects.find(p=>p.id===currentId).state);
const currentProject=()=>projects.find(p=>p.id===currentId);
let selected = new Set(Array.isArray(state.answers[definitions[state.step]?.id])?state.answers[definitions[state.step].id]:[]), apiKey='', model='gemini-3.8-flash', busy=false, editing=false, toastTimer, chatMode='answer';
const deletedIds=new Set();
function mergeStored(){try{const all=JSON.parse(localStorage.getItem(PROJECTS_KEY)||'null');(all?.items||[]).forEach(p=>{if(p.id&&!deletedIds.has(p.id)&&!projects.some(x=>x.id===p.id))projects.push({id:p.id,name:p.name||DEFAULT_NAME,updated:p.updated||0,state:p.state});});}catch{}}
function persist(){try{mergeStored();const p=currentProject();p.state=state;p.updated=Date.now();localStorage.setItem(PROJECTS_KEY,JSON.stringify({current:currentId,items:projects}));$('save-status').textContent='브라우저에 저장됨';}catch{$('save-status').textContent='저장 공간 부족 · MD로 다운로드하세요';}}
function toast(message,action){const el=$('toast');el.replaceChildren(document.createTextNode(message));if(action){const b=document.createElement('button');b.type='button';b.textContent=action.label;b.onclick=()=>{el.style.display='none';action.run();};el.append(b);}el.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',action?7000:2800);}
function redact(text){return String(text).replace(/AIza[\w-]{20,}/g,'[API 키 삭제됨]').split(apiKey || '\u0000').join(apiKey?'[API 키 삭제됨]':'\u0000');}
function addMessage(role,text){state.messages.push({role,text:redact(text),kind:'conversation'});}
function inlineMd(parent,text){text.split(/<br\s*\/?>/i).forEach((part,i)=>{if(i)parent.append(document.createElement('br'));part.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(t=>{if(!t)return;if(t.startsWith('**')&&t.endsWith('**')&&t.length>4){const b=document.createElement('strong');b.textContent=t.slice(2,-2);parent.append(b);}else if(t.startsWith('`')&&t.endsWith('`')&&t.length>2){const c=document.createElement('code');c.textContent=t.slice(1,-1);parent.append(c);}else parent.append(document.createTextNode(t));});});}
function renderMd(text){
  const box=document.createElement('div');box.className='md';const lines=text.replace(/\r/g,'').split('\n');let i=0,list=null,para=null;
  const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
  const flush=()=>{list=null;para=null;};
  while(i<lines.length){const line=lines[i],t=line.trim();
    if(!t){flush();i++;continue;}
    if(/^\|.*\|$/.test(t)&&i+1<lines.length&&/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i+1].trim())){flush();const wrap=document.createElement('div');wrap.className='md-table';const table=document.createElement('table');const head=cells(t);const thead=document.createElement('thead'),hr=document.createElement('tr');head.forEach(h=>{const th=document.createElement('th');inlineMd(th,h);hr.append(th);});thead.append(hr);const tbody=document.createElement('tbody');i+=2;while(i<lines.length&&/^\|.*\|$/.test(lines[i].trim())){const tr=document.createElement('tr');cells(lines[i]).forEach(c=>{const td=document.createElement('td');inlineMd(td,c);tr.append(td);});tbody.append(tr);i++;}table.append(thead,tbody);wrap.append(table);box.append(wrap);continue;}
    if(/^-{3,}$|^\*{3,}$/.test(t)){flush();box.append(document.createElement('hr'));i++;continue;}
    const h=t.match(/^#{1,6}\s+(.*)$/);if(h){flush();const e=document.createElement('p');e.className='md-heading';inlineMd(e,h[1]);box.append(e);i++;continue;}
    const li=t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);if(li){para=null;if(!list){list=document.createElement('ul');box.append(list);}const item=document.createElement('li');inlineMd(item,li[1]);list.append(item);i++;continue;}
    list=null;if(!para){para=document.createElement('p');box.append(para);}else para.append(document.createElement('br'));inlineMd(para,t);i++;}
  return box;
}
function splitChoices(text){const m=text.match(/\n*\[선택지\]\s*\n([\s\S]*)$/);if(!m)return{body:text,choices:[]};return{body:text.slice(0,m.index).trim(),choices:m[1].split('\n').map(l=>l.trim().replace(/^(?:[-*•]|\d+[.)])\s*/,'')).filter(Boolean).slice(0,6)};}

function gradeOptions(){return Array.from({length:state.answers.school==='초등학교'?6:3},(_,i)=>`${i+1}학년`);}
function answerText(id){const value=state.answers[id];return Array.isArray(value)?value.join(', '):value||'';}
function sections(){return Planning.sections(state.answers);}
function outlineMarkdown(){return '# '+currentProject().name+' PRD\n\n> 질문 답변을 정리한 설계 초안입니다. [미정] 항목과 자료 원문을 확인하고 상세 PRD를 생성하세요.\n\n'+sections().map(([title,value],i)=>`## ${i+1}. ${title}\n${value}`).join('\n\n');}
function markdown(){return state.draft||outlineMarkdown();}
function renderMarkdown(root,text){
  root.replaceChildren();
  text.split(/\n/).forEach(line=>{if(!line.trim())return;const heading=line.match(/^(#{1,4})\s+(.+)/);const item=document.createElement(heading?`h${Math.min(heading[1].length+1,5)}`:'p');
    item.textContent=heading?heading[2]:line.replace(/^[-*] /,'• ').replace(/^> /,'');
    if(line.includes('[미정]'))item.className='empty';root.append(item);
  });
}
function renderDocument(){
  document.querySelector('.paper h2').textContent=currentProject().name;
  renderMarkdown($('prd-preview'),markdown());
  const checks=Planning.checks(state.answers);const done=checks.filter(c=>c.done).length;
  $('progress').style.width=`${done/checks.length*100}%`;
  $('quality-count').textContent=`설계 항목 ${done}/${checks.length} 작성 · 상세도는 최종 검토 필요`;
  $('quality-items').replaceChildren();checks.filter(c=>!c.done).forEach(c=>{const button=document.createElement('button');button.textContent=c.label+' 작성하기';button.disabled=busy;button.onclick=()=>goStep(definitions.findIndex(s=>s.id===c.id));$('quality-items').append(button);});
  $('conflict-note').textContent=Planning.conflicts(state.answers).join('\n');
  $('stale-note').hidden=!state.draftStale;
  $('restore-draft').hidden=!state.previousDraft;
  $('draft-label').textContent=state.draft?'상세 문서 · 교사 검토 필요':'답변 기반 설계 초안';
  if(!editing)$('document-editor').value=markdown();
}
const syncSelected=()=>{const id=definitions[state.step]?.id;selected=new Set(Array.isArray(state.answers[id])?state.answers[id]:[]);};
const isAnswered=id=>{const v=state.answers[id];return Array.isArray(v)?v.length>0:!!v;};
const isVisible=d=>!d.when||d.when(state.answers);
const firstUnanswered=()=>{const i=definitions.findIndex(d=>isVisible(d)&&!isAnswered(d.id));return i<0?definitions.length:i;};
const CASCADE={school:['grades'],subjects:['activity','method'],activity:['method'],teacher:['teacherView']};
function goStep(index){if(busy)return;state.step=index;syncSelected();persist();render();$('detail-panel').classList.remove('mobile-open');scrollChat();}
function removeAnswer(id){
  if(busy||!isAnswered(id))return;
  const keys=[id,...(CASCADE[id]||[])].filter(k=>k in state.answers);const removed=Object.fromEntries(keys.map(k=>[k,state.answers[k]]));
  keys.forEach(k=>delete state.answers[k]);state.draftStale=!!state.draft;
  if(definitions[state.step]&&!isVisible(definitions[state.step]))state.step=firstUnanswered();
  syncSelected();$('chat-input').value='';$('chat-notice').textContent='';persist();render();
  toast(`“${definitions.find(d=>d.id===id).title}” 답변을 지웠어요.`,{label:'되돌리기',run:()=>{if(busy)return;Object.entries(removed).forEach(([k,v])=>{if(!isAnswered(k))state.answers[k]=v;});if(state.draft)state.draftStale=true;syncSelected();persist();render();}});
}
function resetView(){selected=new Set(Array.isArray(state.answers[definitions[state.step]?.id])?state.answers[definitions[state.step].id]:[]);editing=false;$('document-editor').hidden=true;$('prd-preview').hidden=false;$('edit-doc').textContent='직접 편집';$('chat-input').value='';$('chat-notice').textContent='';$('detail-panel').classList.remove('mobile-open');}
function switchProject(id){if(busy||id===currentId)return;persist();currentId=id;state=loadState(currentProject().state);resetView();persist();render();scrollChat();}
function newProject(){if(busy)return;if(projects.length>=MAX_PROJECTS){toast(`프로젝트는 최대 ${MAX_PROJECTS}개까지 저장할 수 있어요. 안 쓰는 프로젝트를 삭제하거나 내보낸 뒤 지워 주세요.`);return;}persist();const n=projects.length+1;let name=`새 프로젝트 ${n}`;while(projects.some(p=>p.name===name))name=`새 프로젝트 ${projects.length+Math.floor(Math.random()*90+10)}`;const p={id:uid(),name,updated:Date.now(),state:fresh()};projects.push(p);currentId=p.id;state=p.state;resetView();persist();render();toast('새 프로젝트를 만들었어요.');}
function renameProject(id=currentId){const p=projects.find(x=>x.id===id);const name=(window.prompt('프로젝트 이름',p.name)||'').trim().slice(0,40);if(!name)return;p.name=name;persist();render();}
function deleteProject(id){if(busy)return;const p=projects.find(x=>x.id===id);if(!window.confirm(`“${p.name}” 프로젝트를 삭제할까요? 대화와 기획서가 모두 사라져요.`))return;if(projects.length===1){p.state=fresh();p.name=DEFAULT_NAME;state=p.state;resetView();persist();render();return;}const idx=projects.indexOf(p);projects.splice(idx,1);deletedIds.add(id);if(id===currentId){currentId=projects[Math.min(idx,projects.length-1)].id;state=loadState(currentProject().state);resetView();}persist();render();toast('프로젝트를 삭제했어요.');}
function storageUsage(){try{const raw=localStorage.getItem(PROJECTS_KEY)||'';return raw.length*2;}catch{return 0;}}
function renderStorage(){const used=storageUsage();const pct=Math.min(100,Math.round(used/QUOTA_BYTES*100));const mb=(used/1048576).toFixed(2);
  const count=`${projects.length}/${MAX_PROJECTS}개`;
  $('project-count').textContent=`${count} · 이 브라우저에만 저장`;
  $('storage-summary').textContent=`프로젝트 ${count} · 저장 공간 약 ${mb}MB 사용 (브라우저 한도 약 5MB 중 ${pct}%)`;
  $('storage-bar').style.width=pct+'%';
  $('storage-warn').textContent=projects.length>=MAX_PROJECTS?'프로젝트가 가득 찼어요. 새로 만들려면 하나를 삭제해 주세요.':pct>=80?'저장 공간이 거의 찼어요. 내보내기로 파일에 보관한 뒤 오래된 프로젝트를 삭제해 주세요.':'';
}
function renderProjects(){renderStorage();
  const list=$('project-list');list.replaceChildren();
  projects.forEach(p=>{const row=document.createElement('div');row.className='project-row'+(p.id===currentId?' active':'');
    const open=document.createElement('button');open.type='button';open.className='project-open';open.textContent=p.name;open.title=p.name;open.disabled=busy;if(p.id===currentId)open.setAttribute('aria-current','true');open.onclick=()=>switchProject(p.id);
    const edit=document.createElement('button');edit.type='button';edit.className='project-tool';edit.textContent='✎';edit.setAttribute('aria-label',`${p.name} 이름 바꾸기`);edit.onclick=()=>renameProject(p.id);
    const del=document.createElement('button');del.type='button';del.className='project-tool';del.textContent='✕';del.setAttribute('aria-label',`${p.name} 삭제`);del.disabled=busy;del.onclick=()=>deleteProject(p.id);
    row.append(open,edit,del);list.append(row);});
  $('project-title').textContent=currentProject().name;
}
function renderStackCard(def){const card=$('stack-card');card.hidden=!(def&&def.id==='stack');if(card.hidden)return;card.replaceChildren();
  const r=Planning.recommend(state.answers);const add=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;card.append(e);return e;};
  add('h3','추천: '+r.label);add('div',r.one);
  if(r.reasons.length){const ul=document.createElement('ul');r.reasons.forEach(x=>{const li=document.createElement('li');li.textContent=x;ul.append(li);});card.append(ul);}
  const dl=document.createElement('dl');[['프론트엔드',r.frontend],['백엔드·저장',r.backend],['배포',r.deploy],['무료 범위',r.free],['주의',r.caution]].forEach(([k,v])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;dl.append(dt,dd);});card.append(dl);
  r.warnings.forEach(w=>add('p','⚠ '+w,'warn'));
}
function renderAnswerLog(){
  const wrap=$('answer-log-wrap'),box=$('answer-log');const items=definitions.filter(d=>isVisible(d)&&isAnswered(d.id));
  wrap.hidden=!items.length;box.replaceChildren();$('answer-log-title').textContent=`내가 정한 답변 ${items.length}개 · 수정하거나 지울 수 있어요`;
  let last=-1;items.forEach(d=>{
    if(d.group!==last){last=d.group;const g=document.createElement('div');g.className='al-group';const part=Planning.parts.find(p=>p.groups.includes(d.group));g.textContent=`${part.title.split(' · ')[0]} · ${Planning.groups[d.group]}`;box.append(g);}
    const row=document.createElement('div');row.className='al-row'+(definitions[state.step]===d?' current':'');
    const text=document.createElement('div');text.className='al-text';const q=document.createElement('div');q.className='al-q';q.textContent=d.title;const a=document.createElement('div');a.className='al-a';a.textContent=answerText(d.id);a.title=answerText(d.id);text.append(q,a);
    const tools=document.createElement('div');tools.className='al-tools';
    const edit=document.createElement('button');edit.type='button';edit.textContent='수정';edit.disabled=busy;edit.setAttribute('aria-label',`${d.title} 답변 수정`);edit.onclick=()=>goStep(definitions.indexOf(d));
    const del=document.createElement('button');del.type='button';del.textContent='삭제';del.disabled=busy;del.setAttribute('aria-label',`${d.title} 답변 삭제`);del.onclick=()=>removeAnswer(d.id);
    tools.append(edit,del);row.append(text,tools);box.append(row);});
}
const mapOpen=new Set();let mapSecSeen=-1,mapStepSeen=-2,mapSel='';
const NO_TEXT_EDIT=new Set(['school','grades','subjects','stack']);
const sectionIndexOf=id=>Planning.sectionDefs.findIndex(([,ids])=>ids.includes(id));
const mk=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
function mapFocus(){const el=$('map-canvas').querySelector('.t-step.current');const sc=$('map-scroll');if(!el||!sc.clientHeight)return;const top=el.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop;sc.scrollTo({top:Math.max(0,top-sc.clientHeight/3),behavior:'smooth'});}
/* 계획 지도: 폴더 트리처럼 위에서 아래로. 프로젝트 → PRD 7개 섹션 → 질문. 질문을 누르면 그 자리에서 답 전체를 보고 고칠 수 있다 */
function renderMap(){
  const host=$('map-canvas');host.replaceChildren();const cur=definitions[state.step];
  const curSec=cur?sectionIndexOf(cur.id):-1;if(curSec>=0&&curSec!==mapSecSeen){mapOpen.add(curSec);mapSecSeen=curSec;}
  const vis=new Set(definitions.filter(isVisible).map(d=>d.id));$('map-summary').textContent=`${definitions.filter(d=>vis.has(d.id)&&isAnswered(d.id)).length}/${vis.size} 질문에 답했어요`;
  const rootUl=mk('ul','tree'),rootLi=mk('li','t-root');
  const rb=mk('button','t-root-btn',currentProject().name);rb.type='button';rb.title='눌러서 프로젝트 이름 바꾸기';rb.onclick=()=>renameProject();rootLi.append(rb);
  const secUl=mk('ul');
  Planning.sectionDefs.forEach(([title,ids],s)=>{
    const st=ids.filter(id=>vis.has(id)).map(id=>definitions.find(d=>d.id===id));const dn=st.filter(d=>isAnswered(d.id)).length,open=mapOpen.has(s);
    const li=mk('li','t-sec'+(st.length&&dn===st.length?' complete':'')+(curSec===s?' current':''));
    const b=mk('button','t-sec-btn');b.type='button';b.setAttribute('aria-expanded',String(open));b.append(mk('span','',`${open?'▾':'▸'} ${s+1}. ${title}`),mk('span','cnt',`${dn}/${st.length}`));b.onclick=()=>{open?mapOpen.delete(s):mapOpen.add(s);renderMap();};li.append(b);
    if(open){const ul=mk('ul');st.forEach(d=>{
      const ans=isAnswered(d.id)?answerText(d.id):'',skip=/^미정/.test(ans);
      const sl=mk('li','t-step'+(ans&&!skip?' done':'')+(skip?' skip':'')+(d===cur?' current':'')+(d.id===mapSel?' sel':''));
      const row=mk('div','t-row');const nb=mk('button','t-step-btn');nb.type='button';nb.title=d.question;nb.setAttribute('aria-pressed',String(d.id===mapSel));nb.append(mk('b','',d.title),mk('span','',ans||'아직 답하지 않았어요'));nb.onclick=()=>{mapSel=d.id===mapSel?'':d.id;renderMap();};row.append(nb);
      if(ans){const x=mk('button','t-del','✕');x.type='button';x.disabled=busy;x.setAttribute('aria-label',`${d.title} 답변 지우기`);x.onclick=()=>removeAnswer(d.id);row.append(x);}
      sl.append(row);if(d.id===mapSel)sl.append(buildMapDetail(d));ul.append(sl);});li.append(ul);}
    secUl.append(li);});
  rootLi.append(secUl);rootUl.append(rootLi);host.append(rootUl);
  if(mapStepSeen!==state.step){mapStepSeen=state.step;mapFocus();}
}
function buildMapDetail(d){
  const box=mk('div','map-detail');
  const has=isAnswered(d.id),cur=state.answers[d.id],text=has?(Array.isArray(cur)?cur.join('\n'):cur):'';
  const head=mk('div','md-head');head.append(mk('span','',d.title));const close=mk('button','text-button','닫기');close.type='button';close.onclick=()=>{mapSel='';renderMap();};head.append(close);
  box.append(head,mk('div','md-q',d.question));
  const editable=!NO_TEXT_EDIT.has(d.id);let ta=null;
  if(editable){ta=document.createElement('textarea');ta.value=text;ta.placeholder=d.placeholder;ta.disabled=busy;ta.setAttribute('aria-label',`${d.title} 답변`);box.append(ta);if(d.multi)box.append(mk('div','md-q','항목마다 줄을 나누어 적어요. 선택지는 “질문 화면에서 고르기”가 편해요.'));}
  else box.append(mk('div','md-full',has?text:'아직 답하지 않았어요'));
  const actions=mk('div','md-actions');
  if(editable){const save=mk('button','primary','저장');save.type='button';save.disabled=busy;save.onclick=()=>{const raw=ta.value.trim();if(/AIza[\w-]{20,}/.test(raw)){toast('API 키는 설정에 입력해 주세요.');return;}if(!raw){removeAnswer(d.id);return;}
    applyAnswer(d,d.multi?raw.split(/\n+/).map(s=>s.trim()).filter(Boolean):raw);if(definitions[state.step]&&!isVisible(definitions[state.step]))state.step=firstUnanswered();syncSelected();persist();render();toast('답변을 수정했어요.');};actions.append(save);}
  const go=mk('button','',has?'질문 화면에서 고르기':'이 질문에 답하기');go.type='button';go.disabled=busy;go.onclick=()=>goStep(definitions.indexOf(d));actions.append(go);
  if(has){const del=mk('button','','삭제');del.type='button';del.disabled=busy;del.onclick=()=>removeAnswer(d.id);actions.append(del);}
  box.append(actions);return box;
}
$('map-expand').onclick=()=>{Planning.sectionDefs.forEach((_,s)=>mapOpen.add(s));renderMap();};
$('map-collapse').onclick=()=>{mapOpen.clear();const c=definitions[state.step];if(c&&sectionIndexOf(c.id)>=0)mapOpen.add(sectionIndexOf(c.id));renderMap();};
$('cancel-edit').onclick=()=>{if(!busy)goStep(firstUnanswered());};
/* 선택지는 눌러서 고르거나, ✎로 그 문구를 바탕 삼아 고쳐서 답할 수 있다 */
const NO_CHIP_EDIT=new Set(['school','grades','subjects','stack']);let editingChip=null;
function renderChips(def,options){
  const box=$('chips');if(!def)return;
  const all=options.map(raw=>typeof raw==='string'?{label:raw,value:raw}:raw);
  const known=new Set(all.map(o=>o.value));[...selected].filter(v=>!known.has(v)).forEach(v=>all.push({label:v,value:v,group:'직접 입력·수정한 항목'}));
  let lastGroup='';
  all.forEach(option=>{
    if(option.group&&option.group!==lastGroup){const label=document.createElement('div');label.className='chip-group-label';label.textContent=option.group;box.append(label);lastGroup=option.group;}
    const canEdit=!NO_CHIP_EDIT.has(def.id)&&option.value!=='기타 · 직접 입력';
    if(editingChip===option.value&&canEdit){
      const wrap=document.createElement('div');wrap.className='chip-editor';
      const ta=document.createElement('textarea');ta.className='chip-edit';ta.value=option.value;ta.rows=3;ta.setAttribute('aria-label','선택지 문구 고치기');
      const row=document.createElement('div');row.className='chip-editor-actions';
      const ok=document.createElement('button');ok.type='button';ok.className='primary';ok.textContent=def.multi?'이 문구로 선택':'이 문구로 답하기';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';
      const commit=()=>{const v=ta.value.trim();editingChip=null;if(/AIza[\w-]{20,}/.test(v)){toast('API 키는 설정에 입력해 주세요.');render();return;}
        if(!v||v===option.value){render();return;}
        if(def.multi){selected.delete(option.value);selected.add(v);render();}else accept(v);};
      ok.onclick=commit;cancel.onclick=()=>{editingChip=null;render();};
      ta.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();commit();}else if(e.key==='Escape'){editingChip=null;render();}};
      row.append(ok,cancel);wrap.append(ta,row);box.append(wrap);setTimeout(()=>{ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);wrap.scrollIntoView({block:"center",behavior:"smooth"});});return;
    }
    const wrap=document.createElement('span');wrap.className='chip-wrap';
    const button=document.createElement('button');button.className='chip';button.textContent=option.label;button.disabled=busy;button.setAttribute('aria-pressed',String(selected.has(option.value)));
    button.onclick=()=>{if(option.value==='기타 · 직접 입력'){$('custom-wrap').hidden=false;$('custom-subject').focus();return;}if(def.multi){selected.has(option.value)?selected.delete(option.value):selected.add(option.value);button.setAttribute('aria-pressed',String(selected.has(option.value)));$('continue').disabled=!selected.size;if(!known.has(option.value))render();}else accept(option.value);};
    wrap.append(button);
    if(canEdit){const edit=document.createElement('button');edit.type='button';edit.className='chip-edit-btn';edit.textContent='✎';edit.disabled=busy;edit.title='이 문구를 바탕으로 고쳐서 답하기';edit.setAttribute('aria-label',`${option.label} 문구 고치기`);edit.onclick=()=>{editingChip=option.value;render();};wrap.append(edit);}
    box.append(wrap);
  });
}
function render(){
  renderProjects();
    const messages=$('messages');messages.replaceChildren();let shown=0;state.messages.forEach((m,index)=>{if(m.role==='user'&&m.kind!=='conversation')return;shown++;const div=document.createElement('div');div.className=`message ${m.role==='user'?'user':'assistant'}`;const del=document.createElement('button');del.type='button';del.className='message-delete';del.textContent='삭제';del.setAttribute('aria-label','이 메시지 삭제');del.disabled=busy;del.onclick=()=>{state.messages.splice(index,1);persist();render();};if(m.role!=='user'){const label=document.createElement('span');label.className='message-label';label.textContent='Oni 코치';div.append(label);const {body,choices}=splitChoices(m.text);div.append(renderMd(body));if(choices.length){const row=document.createElement('div');row.className='md-choices';choices.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='chip';b.textContent=c;b.disabled=busy;b.onclick=()=>{$('chat-input').value=c;$('chat-input').focus();$('chat-notice').textContent='선택한 내용을 입력창에 넣었어요. 고쳐 쓴 뒤 전송하면 답변으로 반영됩니다.';};row.append(b);});div.append(row);}}else div.append(document.createTextNode(m.text));div.append(del);messages.append(div);});$('clear-chat').hidden=!shown;$('clear-chat').disabled=busy;
  $('steps').replaceChildren();
  Planning.groups.forEach((group,g)=>{const part=Planning.parts.find(p=>p.groups[0]===g);if(part){const pl=document.createElement('div');pl.className='steps-part';pl.textContent=part.title;$('steps').append(pl);}const wrapper=document.createElement('details');wrapper.open=definitions[state.step]?.group===g;const summary=document.createElement('summary');const members=Planning.visibleSteps(state.answers).filter(d=>d.group===g);summary.textContent=`${g+1}. ${group}  ${members.filter(d=>state.answers[d.id]).length}/${members.length}`;wrapper.append(summary);members.forEach(def=>{const i=definitions.indexOf(def);const button=document.createElement('button');button.className=i===state.step?'current':'';button.disabled=busy;const dot=document.createElement('span');dot.className='step-dot';dot.textContent=state.answers[def.id]?'✓':'·';button.append(dot,document.createTextNode(def.title));button.onclick=()=>goStep(i);wrapper.append(button);});$('steps').append(wrapper);});
  const def=definitions[state.step];$('chips').replaceChildren();$('custom-wrap').hidden=true;
  const visible=Planning.visibleSteps(state.answers);
  $('step-count').textContent=def?`${Planning.groups[def.group]} · ${visible.indexOf(def)+1}/${visible.length}`:'답변 검토';
  $('question').textContent=def?def.question:'이제 구현할 수 있는 상세 PRD로 구체화해요.';
  $('question-help').textContent=def?def.help:'자료 원문, 화면별 행동, 이동 조건, 피드백 문구와 완료 기준을 정리합니다. 오른쪽의 빠진 항목과 충돌을 먼저 확인하세요.';
  $('branch-context').textContent=def&&def.group>0?[answerText('subjects'),answerText('activity'),answerText('method')].filter(Boolean).join(' → '):'';
  $('chat-input').placeholder=chatMode==='coach'?'예: 이 활동에 어떤 자료가 필요할까요? 두 방식을 비교해 주세요.':def?def.placeholder:'기획서에서 바꾸고 싶은 점을 이야기해 주세요';
  $('continue').hidden=!def?.multi;$('continue').disabled=!selected.size||busy;
  $('skip-step').hidden=!def||state.step<3;$('skip-step').disabled=busy;
  $('ai-suggest').hidden=!def||state.step<3;$('ai-suggest').disabled=busy;
  $('generate-final').hidden=!!def;$('generate-final').disabled=busy;
  $('selection-note').textContent=def?.multi?'여러 개 선택 가능 · 직접 입력한 내용도 함께 반영해요':'칩은 답변의 출발점이에요. 선택 후 다음 질문에서 구체화합니다.';
  $('previous-answer').hidden=!def||!answerText(def.id);$('clear-answer').hidden=!def||!answerText(def.id);$('clear-answer').disabled=busy;$('previous-answer').textContent=def&&answerText(def.id)?`이전에 정한 내용: ${answerText(def.id)}`:'';
  let options=def?.id==='grades'?gradeOptions():Planning.options(def?.id,state.answers);if(def?.id==='subjects')options=[...options,...state.extraSubjects];
  renderChips(def,options);
  $('send').disabled=busy;$('ai-refine').disabled=busy;$('new-chat').disabled=busy;
  $('chat-input').disabled=busy;$('edit-doc').disabled=busy;
  $('cancel-edit').hidden=!def||!isAnswered(def.id)||firstUnanswered()===state.step;$('cancel-edit').disabled=busy;
  renderStackCard(def);renderAnswerLog();renderMap();renderUsage();
  renderDocument();
}
function applyAnswer(def,value){
  const changed=JSON.stringify(state.answers[def.id])!==JSON.stringify(value);
  if(def.id==='school'&&changed){delete state.answers.grades;const list=Planning.subjectsFor(value);if(Array.isArray(state.answers.subjects)){const keep=state.answers.subjects.filter(x=>list.includes(x)||state.extraSubjects.includes(x));if(keep.length!==state.answers.subjects.length){if(keep.length)state.answers.subjects=keep;else delete state.answers.subjects;delete state.answers.activity;delete state.answers.method;}}}
  if(def.id==='subjects'&&changed){delete state.answers.activity;delete state.answers.method;}
  if(def.id==='activity'&&changed)delete state.answers.method;
  if(def.id==='teacher'&&String(value).includes('별도 관리 화면 없음'))delete state.answers.teacherView;
  if(changed&&['school','subjects','activity','method'].includes(def.id)&&state.answers.flow){$('chat-notice').textContent='활동의 방향을 바꿨어요. 기존 자료·활동 흐름·규칙은 보존했으니 새 방향에 맞는지 다시 확인해 주세요.';}
  state.answers[def.id]=value;if(state.draft)state.draftStale=true;
  return changed;
}
function accept(value){const def=definitions[state.step];if(!def)return;
  const wasAnswered=isAnswered(def.id);
  const changed=applyAnswer(def,value);
  if(wasAnswered)state.step=firstUnanswered();else{state.step++;while(definitions[state.step]?.when&&!definitions[state.step].when(state.answers))state.step++;}
  syncSelected();persist();render();scrollChat();
  if(wasAnswered&&changed)toast('답변을 바꿨어요. 진행하던 질문으로 돌아왔어요.');
}
function scrollChat(){requestAnimationFrame(()=>{const container=$('chat-scroll');const question=$('question-card');if(question.getBoundingClientRect){container.scrollTo({top:container.scrollTop+question.getBoundingClientRect().top-container.getBoundingClientRect().top-20,behavior:'smooth'});}else container.scrollTo({top:container.scrollHeight,behavior:'smooth'});});}
function panel(name){['map','document','settings'].forEach(n=>{$(n+'-panel').hidden=name!==n;$(n+'-tab').setAttribute('aria-selected',String(name===n));});$('detail-panel').classList.add('mobile-open');if(name==='map')mapFocus();}
function keySettings(){panel('settings');$('api-fields').hidden=false;$('api-settings').setAttribute('aria-expanded','true');$('api-key').focus();}
function updateConnection(){ $('key-badge').textContent=apiKey?'연결됨 ✓':'연결 안 됨 ›';$('mode-label').lastChild.textContent=apiKey?' Gemini 연결됨':' 기본 질문 모드';}
const noThinking=new Set();
function thinkingFor(m){if(noThinking.has(m))return null;if(/gemini-3/.test(m))return {thinkingLevel:'minimal'};if(/2\.5-flash/.test(m))return {thinkingBudget:0};return null;}
/* 무료 등급 보호: 호출 횟수를 세어 보여주고, 불필요한 재시도(잘못된 키·한도 초과)로 호출을 낭비하지 않는다 */
const USAGE_KEY='oni.usage.v1';let sessionCalls=0;
const todayKey=()=>new Date().toLocaleDateString('sv');
function todayCalls(){try{const u=JSON.parse(localStorage.getItem(USAGE_KEY)||'null');return u&&u.date===todayKey()?u.count:0;}catch{return 0;}}
function countCall(){sessionCalls++;try{localStorage.setItem(USAGE_KEY,JSON.stringify({date:todayKey(),count:todayCalls()+1}));}catch{}renderUsage();}
function renderUsage(){const el=$('usage-info');if(el)el.textContent=`이 브라우저에서 AI를 호출한 횟수: 오늘 ${todayCalls()}회 · 이번 접속 ${sessionCalls}회 (같은 키를 다른 곳에서 쓴 횟수는 포함되지 않아요)`;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function requestAI(prompt,key=apiKey,chosenModel=model,maxTokens=16000,schema=null){
  const ctl=new AbortController();const timeout=setTimeout(()=>ctl.abort(),120000);
  const levels=[{think:true,schema:true},{think:false,schema:true},{think:false,schema:false}];let li=0,waited429=false;
  try{let response,detail='';for(let attempt=0;;){
      const level=levels[li];const cfg={maxOutputTokens:maxTokens};const think=level.think&&thinkingFor(chosenModel);if(think)cfg.thinkingConfig=think;if(schema){cfg.responseMimeType='application/json';if(level.schema)cfg.responseSchema=schema;}
      countCall();
      response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:cfg}),signal:ctl.signal});
      if(response.ok)break;
      try{detail=await response.text();}catch{detail='';}
      /* 400은 thinking·스키마 설정 문제일 때만 낮춰서 다시 시도한다(잘못된 키는 바로 중단) */
      if(response.status===400&&li<levels.length-1&&/thinking|responseSchema|response_schema|schema|mime/i.test(detail)&&!/API key/i.test(detail)){if(think)noThinking.add(chosenModel);li++;continue;}
      /* 429는 분당 한도일 때만 안내된 시간(짧을 때)만큼 기다렸다가 한 번만 다시 시도한다. 하루 한도는 즉시 중단 */
      if(response.status===429&&!waited429&&!/PerDay|per day|daily/i.test(detail)){const m=detail.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);const secs=m?Number(m[1]):0;if(secs>0&&secs<=30){waited429=true;await sleep(secs*1000+500);continue;}}
      if([500,503].includes(response.status)&&attempt<2){attempt++;await sleep(1500*attempt);continue;}
      break;}
    if(!response.ok){const daily=response.status===429&&/PerDay|per day|daily/i.test(detail);const messages={400:'키 또는 모델 설정을 확인해 주세요.',401:'유효한 API 키를 입력해 주세요.',403:'키 권한이나 API 사용 권한을 확인해 주세요.',404:'이 모델을 찾을 수 없습니다. 설정에서 다른 모델을 선택해 주세요.',500:'AI 서버에 일시적인 문제가 있어요. 잠시 후 다시 시도하거나 다른 모델을 선택해 주세요.',503:'선택한 모델이 지금 혼잡해요(자동으로 재시도했어요). 잠시 후 다시 시도하거나 설정에서 다른 모델을 선택해 주세요.',429:daily?'오늘의 무료 사용량을 모두 썼어요. 내일 다시 시도하거나 설정에서 다른 모델을 선택해 보세요. 기획서 초안 다운로드는 키 없이도 가능해요.':'무료 등급의 분당 요청 한도에 도달했어요. 1분쯤 기다린 뒤 다시 시도하거나, 설정에서 더 가벼운 모델(Flash-Lite 등)을 선택해 보세요.'};throw new Error(messages[response.status]||'AI 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.');}
    const data=await response.json();if(data.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('응답이 길어 중간에 멈췄어요. 기존 문서는 유지됩니다. 자료 수나 범위를 줄여 다시 요청해 주세요.');const result=data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');if(!result)throw new Error('AI가 답변을 생성하지 못했어요. 입력을 바꿔 다시 시도해 주세요.');return redact(result);
  }catch(error){if(error.name==='AbortError')throw new Error('응답 대기 시간이 지났어요. 내용은 보관되어 있으니 다시 시도해 주세요.');if(error instanceof TypeError)throw new Error('네트워크 연결을 확인해 주세요. 작성 중인 내용은 유지됩니다.');throw error;}finally{clearTimeout(timeout);}
}
function parseJSON(text){const t=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'');try{return JSON.parse(t);}catch{const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(t.slice(a,b+1));throw new Error('AI 응답 형식을 읽지 못했어요. 다시 시도해 주세요.');}}
const SECTION_SCHEMA={type:'OBJECT',properties:{sections:{type:'ARRAY',items:{type:'OBJECT',properties:{n:{type:'INTEGER'},markdown:{type:'STRING'}},required:['n','markdown']}}},required:['sections']};
const COACH_SCHEMA={type:'OBJECT',properties:{answer:{type:'STRING'},choices:{type:'ARRAY',items:{type:'STRING'}}},required:['answer','choices']};
const DRAFT_SCHEMA={type:'OBJECT',properties:{draft:{type:'STRING'}},required:['draft']};
/* 기존 문서를 "## 번호." 단위로 나눈다. 필요한 섹션만 AI에 보내 토큰과 호출을 줄인다 */
function draftMarks(text){const marks=[];const re=/^##\s*(\d)[.．]/gm;let m;while((m=re.exec(text)))marks.push({n:Number(m[1]),start:m.index});marks.forEach((k,i)=>{k.end=i+1<marks.length?marks[i+1].start:text.length;});return marks;}
function pickSections(text,nums){if(!text)return '';const marks=draftMarks(text);return nums.map(n=>marks.find(k=>k.n===n)).filter(Boolean).map(k=>text.slice(k.start,k.end).trim()).join('\n\n');}
function replaceSections(text,got){let out=text;const missing=[];Object.entries(got).forEach(([n,md])=>{const k=draftMarks(out).find(x=>x.n===Number(n));if(k)out=out.slice(0,k.start)+md.trim()+'\n\n'+out.slice(k.end);else missing.push(md.trim());});return (out.trim()+(missing.length?'\n\n'+missing.join('\n\n'):'')).trim();}
const SECTION_TITLES={1:'기본 수업 정보',2:'사용 환경 및 접속 방식',3:'활동 구성·실행 방식과 진행 규칙',4:'핵심 구현 기능: 교사 화면과 학생 화면',5:'디자인 및 화면 스타일',6:'운영 조건·기술 구성',7:'완료 기준'};
const withTitle=(n,md)=>new RegExp(`^##\\s*${n}[.．]`).test(md)?md:`## ${n}. ${SECTION_TITLES[n]}\n${md}`;
async function refine(instruction){
  if(!apiKey){keySettings();$('key-status').textContent='상세 PRD 생성에는 개인 API 키가 필요해요. 답변 기반 초안은 키 없이 다운로드할 수 있어요.';return;}
  if(busy)return;busy=true;render();$('chat-notice').textContent='상세 PRD를 작성하고 있어요… (AI 호출 4회, 2번씩 나누어 진행)';
  try{const current=state.draft||'';const got={};let done=0;
    const run=async(nums,context='')=>{const json=parseJSON(await requestAI(Planning.promptPart(state.answers,pickSections(current,nums),instruction,nums,context),apiKey,model,8192,SECTION_SCHEMA));(json.sections||[]).forEach(x=>{if(nums.includes(Number(x.n))&&x.markdown)got[Number(x.n)]=String(x.markdown).trim();});done++;$('chat-notice').textContent=`상세 PRD 작성 중… (${done}/4)`;};
    await Promise.all(Planning.prdWaves[0].map(nums=>run(nums)));
    await Promise.all(Planning.prdWaves[1].map(nums=>run(nums,nums.includes(7)?got[3]||'':'')));
    const missing=[1,2,3,4,5,6,7].filter(n=>!got[n]);if(missing.length)throw new Error(`일부 섹션(${missing.join(', ')}번)이 만들어지지 않았어요. 기존 문서를 보존했으니 다시 생성해 주세요.`);
    const result=[1,2,3,4,5,6,7].map(n=>withTitle(n,got[n])).join('\n\n');
    state.previousDraft=markdown();state.draft=result;state.draftStale=false;
    addMessage('assistant','상세 PRD 초안을 작성했어요. 기획서 탭의 [제안·교사 검토 필요] 부분과 자료·정답 연결을 확인해 주세요. 바꾸고 싶은 점을 여기서 이야기하면 문서에서 해당 부분만 수정해요(AI 호출 1회).');persist();$('chat-notice').textContent='';
  }catch(error){$('chat-notice').textContent=error.message;}finally{busy=false;render();scrollChat();}
}
/* 상세 PRD가 있을 때의 수정 요청: 전체를 다시 만들지 않고 한 번의 호출로 바뀌는 섹션만 고친다 */
async function editDraft(instruction){
  if(busy)return;busy=true;render();$('chat-notice').textContent='문서에서 바꿀 부분만 수정하고 있어요… (AI 호출 1회)';
  try{const json=parseJSON(await requestAI(Planning.editPrompt(state.answers,state.draft,instruction),apiKey,model,8192,SECTION_SCHEMA));
    const got={};(json.sections||[]).forEach(x=>{const n=Number(x.n);if(n>=1&&n<=7&&x.markdown)got[n]=withTitle(n,String(x.markdown).trim());});
    if(!Object.keys(got).length)throw new Error('바꿀 부분을 찾지 못했어요. 어느 부분을 어떻게 바꿀지 조금 더 구체적으로 적어 주세요.');
    state.previousDraft=markdown();state.draft=replaceSections(state.draft,got);state.draftStale=false;
    addMessage('assistant',`문서의 ${Object.keys(got).map(n=>`${n}번`).join(', ')} 섹션을 고쳤어요. 기획서 탭에서 확인해 주세요. 마음에 들지 않으면 “이전 문서”로 되돌릴 수 있어요.`);persist();$('chat-notice').textContent='';
  }catch(error){$('chat-notice').textContent=error.message;}finally{busy=false;render();scrollChat();}
}
async function coach(text,proposal=false){
  if(!apiKey){keySettings();$('key-status').textContent='AI와 함께 구체화하려면 개인 API 키를 연결해 주세요.';return false;}
  if(busy)return false;busy=true;if(!proposal)addMessage('user',text);persist();render();$('chat-notice').textContent=proposal?'현재 활동에 맞는 답변 초안을 제안하고 있어요…':'선택한 과목과 활동을 바탕으로 함께 생각하고 있어요…';
  try{const json=parseJSON(await requestAI(Planning.coachPrompt(state.answers,definitions[state.step]?.id,text,proposal),apiKey,model,proposal?1200:1800,proposal?DRAFT_SCHEMA:COACH_SCHEMA));
    const result=proposal?String(json.draft||'').trim():String(json.answer||'').trim()+((json.choices||[]).length?'\n\n[선택지]\n'+json.choices.map(c=>'- '+String(c).trim()).join('\n'):'');if(!result)throw new Error('AI가 답변을 생성하지 못했어요. 다시 시도해 주세요.');
    addMessage('assistant',result);if(proposal){$('chat-input').value=result;chatMode='answer';setChatMode('answer');$('chat-notice').textContent='입력창의 AI 제안을 검토·수정한 뒤 전송하면 답변으로 반영됩니다.';}else $('chat-notice').textContent='마음에 드는 선택지를 누르거나, 직접 입력해 전송하세요.';
    persist();return true;
  }catch(error){$('chat-notice').textContent=error.message;return false;}finally{busy=false;render();scrollChat();}
}
function setChatMode(mode){return;chatMode=mode;$('answer-mode').setAttribute('aria-pressed',String(mode==='answer'));$('coach-mode').setAttribute('aria-pressed',String(mode==='coach'));$('composer-label').textContent=mode==='coach'?'코치와 편하게 의논하세요':'직접 이야기해 주세요';if(!busy)render();}
function processText(text){const def=definitions[state.step];if(!def){if(apiKey){addMessage('user',text);persist();state.draft?editDraft(text):refine(text);}else{addMessage('user',text);state.draft=markdown()+'\n\n## 추가 요청\n'+text;addMessage('assistant','추가 요청을 기획서에 기록했어요. AI와 대화하며 보완하려면 오른쪽 설정에서 API 키를 연결해 주세요.');persist();render();scrollChat();}return;}
  if(def.id==='school'){const match=[['초등','초등학교'],['중학','중학교'],['고등','고등학교']].filter(([word])=>text.includes(word));if(match.length!==1){$('chat-notice').textContent='초등학교·중학교·고등학교 중 하나를 먼저 선택해 주세요. 학년은 다음 단계에서 여러 개 선택할 수 있어요.';return false;}const grades=[...text.matchAll(/[1-6]/g)].map(m=>`${m[0]}학년`).filter(g=>match[0][1]==='초등학교'||Number(g[0])<=3);accept(match[0][1]);if(grades.length){state.answers.grades=[...new Set(grades)];selected=new Set(state.answers.grades);persist();render();}return;}
  if(def.id==='grades'){const numbers=[...text.matchAll(/[1-6]/g)].map(m=>`${m[0]}학년`);const range=text.match(/([1-6])\s*(?:~|-|부터)\s*([1-6])/);if(range)for(let n=Number(range[1]);n<=Number(range[2]);n++)numbers.push(`${n}학년`);const valid=[...new Set(numbers)].filter(g=>gradeOptions().includes(g));if(!valid.length){$('chat-notice').textContent='해당 학교급의 학년을 선택하거나 숫자로 입력해 주세요. 예: 1, 2학년';return false;}accept(valid);return;}
  if(def.multi){const parts=def.id==='subjects'?text.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean):[text];accept([...new Set([...selected,...parts])]);}else accept(text);
}
$('composer').onsubmit=async event=>{event.preventDefault();if(busy)return;const text=$('chat-input').value.trim();if(!text)return;$('chat-notice').textContent='';if(/AIza[\w-]{20,}/.test(text)||(apiKey&&text.includes(apiKey))){$('chat-input').value='';keySettings();$('key-status').textContent='API 키는 대화가 아닌 이 입력란에 넣어 주세요.';return;}if(chatMode==='coach'){if(await coach(text))$('chat-input').value='';}else if(processText(text)!==false)$('chat-input').value='';};
$('chat-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}};
$('continue').onclick=()=>{if(selected.size)accept([...selected]);};
$('add-subject').onclick=()=>{const value=$('custom-subject').value.trim();if(!value)return;if(/AIza[\w-]{20,}/.test(value)){toast('API 키는 설정에 입력해 주세요.');return;}if(!state.extraSubjects.includes(value))state.extraSubjects.push(value);selected.add(value);$('custom-subject').value='';persist();render();};
$('custom-subject').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();$('add-subject').click();}};
$('map-tab').onclick=()=>panel('map');$('document-tab').onclick=()=>panel('document');$('settings-tab').onclick=()=>panel('settings');
$('panel-toggle').onclick=()=>{$('detail-panel').classList.toggle('mobile-open');};
$('api-settings').onclick=()=>{const open=$('api-fields').hidden;$('api-fields').hidden=!open;$('api-settings').setAttribute('aria-expanded',String(open));if(open)$('api-key').focus();};
$('toggle-key').onclick=()=>{const show=$('api-key').type==='password';$('api-key').type=show?'text':'password';$('toggle-key').textContent=show?'숨기기':'보기';$('toggle-key').setAttribute('aria-label',show?'API 키 숨기기':'API 키 표시');};
async function listModels(key){
  const out=[];let token='';
  try{do{const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'+(token?'&pageToken='+encodeURIComponent(token):''),{headers:{'x-goog-api-key':key}});
    if(!response.ok){let detail='';try{detail=(await response.json()).error?.message||'';}catch(e){}const messages={400:'API 키가 올바르지 않아요. 키를 다시 확인해 주세요.',401:'유효한 API 키를 입력해 주세요.',403:'키 권한이 없거나 사용이 제한된 키예요. (웹사이트 제한이 걸린 키는 이 주소에서 사용할 수 없어요)',429:'요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.'};throw new Error((messages[response.status]||'AI 서비스가 응답하지 않아요.')+(detail?' ['+redact(detail).slice(0,140)+']':''));}
    const data=await response.json();for(const m of data.models||[])if((m.supportedGenerationMethods||[]).includes('generateContent'))out.push({id:m.name.replace(/^models\//,''),label:m.displayName||m.name});token=data.nextPageToken||'';}while(token);}
  catch(error){if(error instanceof TypeError)throw new Error('네트워크 연결을 확인해 주세요. 광고 차단 프로그램이나 학교 네트워크가 Google API를 막고 있을 수 있어요.');throw error;}
  return out.filter(m=>/^gemini-/.test(m.id)&&!/embedding|tts|image|live|aqa|robotics|computer-use/.test(m.id));
}
function fillModels(list){const select=$('model');select.replaceChildren();for(const m of list){const o=document.createElement('option');o.value=m.id;o.textContent=m.label+' ('+m.id+')';select.append(o);}const pick=list.find(m=>m.id===model)||list.find(m=>m.id==='gemini-3.8-flash')||list[0];select.value=pick.id;model=pick.id;select.disabled=false;}
$('model').onchange=()=>{model=$('model').value;toast('모델을 변경했어요.');};
$('connect-key').onclick=async()=>{if(busy)return;const key=$('api-key').value.trim();if(!key){$('key-status').textContent='API 키를 입력해 주세요.';return;}busy=true;$('connect-key').disabled=true;$('remove-key').disabled=true;render();$('key-status').textContent='연결 확인 중…';try{const list=await listModels(key);if(!list.length)throw new Error('이 키로 사용할 수 있는 Gemini 모델이 없어요.');apiKey=key;fillModels(list);$('api-key').value='';$('key-status').textContent='연결되었습니다. 아래 목록에서 모델을 선택하세요. 키는 새로고침 전까지만 유지됩니다.';updateConnection();}catch(error){$('key-status').textContent=error.message;}finally{busy=false;$('connect-key').disabled=false;$('remove-key').disabled=false;render();}};
$('remove-key').onclick=()=>{if(busy){toast('진행 중인 요청이 끝난 뒤 삭제해 주세요.');return;}apiKey='';$('model').replaceChildren(new Option('연결 후 선택할 수 있어요','gemini-3.8-flash'));$('model').disabled=true;model='gemini-3.8-flash';$('api-key').value='';$('api-key').type='password';$('toggle-key').textContent='보기';$('key-status').textContent='키를 삭제했습니다.';updateConnection();};
$('ai-refine').onclick=()=>refine('입력 내용을 바탕으로 구현 가능한 PRD를 정리하고, 목표·화면별 기능·수용 기준·미정 사항을 명확히 작성하세요.');
$('copy-doc').onclick=async()=>{try{await navigator.clipboard.writeText(markdown());toast('기획서를 복사했어요.');}catch{toast('복사 권한이 없어요. MD 다운로드를 사용해 주세요.');}};
$('download-doc').onclick=()=>{const url=URL.createObjectURL(new Blob([markdown()],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='Oni-PRD.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('edit-doc').onclick=()=>{if(busy)return;if(!editing)state.previousDraft=markdown();editing=!editing;$('prd-preview').hidden=editing;$('document-editor').hidden=!editing;$('edit-doc').textContent=editing?'편집 완료':'직접 편집';if(editing){$('document-editor').value=markdown();$('document-editor').focus();}else renderDocument();};
$('document-editor').oninput=()=>{state.draft=redact($('document-editor').value);persist();};
$('new-chat').onclick=newProject;$('project-title').onclick=()=>renameProject();;
render();

$('skip-step').onclick=()=>accept('미정 · 추가 구체화 필요');
$('ai-suggest').onclick=()=>coach($('chat-input').value.trim()||'지금 질문에 대한 구체적인 답변을 제안해 주세요.',true);
$('generate-final').onclick=()=>refine('확정 답변을 바탕으로 개발 가능한 상세 PRD 초안을 작성하세요. 부족한 콘텐츠는 제안으로 구분하여 실제 원문과 규칙까지 작성하세요.');
$('ask-ai').onclick=async()=>{if(busy)return;const text=$('chat-input').value.trim();if(!text){$('chat-notice').textContent='AI에게 물어볼 내용을 입력창에 적어 주세요.';$('chat-input').focus();return;}$('chat-notice').textContent='';if(/AIza[\w-]{20,}/.test(text)||(apiKey&&text.includes(apiKey))){$('chat-input').value='';keySettings();$('key-status').textContent='API 키는 대화가 아닌 이 입력란에 넣어 주세요.';return;}if(await coach(text))$('chat-input').value='';};
$('clear-chat').onclick=()=>{if(busy)return;state.messages=[];persist();render();toast('대화를 지웠어요. 기획 답변은 그대로 유지돼요.');};
$('restore-draft').onclick=()=>{if(busy)return;const current=markdown();state.draft=state.previousDraft;state.previousDraft=current;state.draftStale=true;persist();render();toast('이전 문서를 복원했어요. 최신 답변과 맞는지 확인해 주세요.');};

$('clear-answer').onclick=()=>{const def=definitions[state.step];if(def)removeAnswer(def.id);};

$('export-projects').onclick=()=>{persist();const blob=new Blob([JSON.stringify({app:'oni-studio',version:1,items:projects},null,1)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='oni-studio-projects.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import-projects').onclick=()=>$('import-file').click();
$('import-file').onchange=async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.items))throw 0;persist();let count=0;data.items.forEach(p=>{if(projects.length<MAX_PROJECTS&&p&&p.state&&Array.isArray(p.state.messages||[])){projects.push({id:uid(),name:String(p.name||DEFAULT_NAME).slice(0,40),updated:Date.now(),state:loadState(p.state)});count++;}});if(!count)throw 0;persist();render();toast(`${count}개 프로젝트를 불러왔어요.`);}catch{toast('프로젝트 파일을 읽지 못했어요.');}};

window.addEventListener('storage',e=>{if(e.key===PROJECTS_KEY&&!busy){mergeStored();renderProjects();}});

$('project-count').onclick=()=>panel('settings');
