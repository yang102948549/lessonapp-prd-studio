const $ = id => document.getElementById(id);
const STORAGE = 'lessonapp.workspace.v1';
const definitions = Planning.steps;
const fresh = () => ({version:2,step:0,answers:{},messages:[],draft:'',draftStale:false,previousDraft:'',extraSubjects:[]});
let state = fresh();
try {const saved=Planning.migrate(JSON.parse(localStorage.getItem(STORAGE)));if(saved)state={...fresh(),...saved};}catch{}
let selected = new Set(Array.isArray(state.answers[definitions[state.step]?.id])?state.answers[definitions[state.step].id]:[]), apiKey='', model='gemini-2.5-flash', busy=false, editing=false, controller, toastTimer, chatMode='answer';
function persist(){try{localStorage.setItem(STORAGE,JSON.stringify(state));$('save-status').textContent='이 기기에 저장됨';}catch{$('save-status').textContent='저장 공간 부족 · MD로 다운로드하세요';}}
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',2800);}
function redact(text){return String(text).replace(/AIza[\w-]{20,}/g,'[API 키 삭제됨]').split(apiKey || '\u0000').join(apiKey?'[API 키 삭제됨]':'\u0000');}
function addMessage(role,text){state.messages.push({role,text:redact(text),kind:'conversation'});}
function gradeOptions(){return Array.from({length:state.answers.school==='초등학교'?6:3},(_,i)=>`${i+1}학년`);}
function answerText(id){const value=state.answers[id];return Array.isArray(value)?value.join(', '):value||'';}
function sections(){return Planning.sections(state.answers);}
function outlineMarkdown(){return '# 나의 수업 웹앱 PRD\n\n> 질문 답변을 정리한 설계 초안입니다. [미정] 항목과 자료 원문을 확인하고 상세 PRD를 생성하세요.\n\n'+sections().map(([title,value],i)=>`## ${i+1}. ${title}\n${value}`).join('\n\n');}
function markdown(){return state.draft||outlineMarkdown();}
function renderMarkdown(root,text){
  root.replaceChildren();
  text.split(/\n/).forEach(line=>{if(!line.trim())return;const heading=line.match(/^(#{1,4})\s+(.+)/);const item=document.createElement(heading?`h${Math.min(heading[1].length+1,5)}`:'p');
    item.textContent=heading?heading[2]:line.replace(/^[-*] /,'• ').replace(/^> /,'');
    if(line.includes('[미정]'))item.className='empty';root.append(item);
  });
}
function renderDocument(){
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
function goStep(index){if(busy)return;state.step=index;selected=new Set(Array.isArray(state.answers[definitions[index]?.id])?state.answers[definitions[index].id]:[]);persist();render();$('detail-panel').classList.remove('mobile-open');scrollChat();}
function render(){
  const messages=$('messages');messages.replaceChildren();state.messages.filter(m=>m.role!=='user'||m.kind==='conversation').forEach(m=>{const div=document.createElement('div');div.className=`message ${m.role==='user'?'user':'assistant'}`;const label=document.createElement('span');label.className='message-label';label.textContent='LessonApp 코치';if(m.role!=='user')div.append(label);div.append(document.createTextNode(m.text));messages.append(div);});
  $('steps').replaceChildren();
  Planning.groups.forEach((group,g)=>{const wrapper=document.createElement('details');wrapper.open=definitions[state.step]?.group===g;const summary=document.createElement('summary');const members=Planning.visibleSteps(state.answers).filter(d=>d.group===g);summary.textContent=`${g+1}. ${group}  ${members.filter(d=>state.answers[d.id]).length}/${members.length}`;wrapper.append(summary);members.forEach(def=>{const i=definitions.indexOf(def);const button=document.createElement('button');button.className=i===state.step?'current':'';button.disabled=busy;const dot=document.createElement('span');dot.className='step-dot';dot.textContent=state.answers[def.id]?'✓':'·';button.append(dot,document.createTextNode(def.title));button.onclick=()=>goStep(i);wrapper.append(button);});$('steps').append(wrapper);});
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
  $('previous-answer').hidden=!def||!answerText(def.id);$('previous-answer').textContent=def&&answerText(def.id)?`이전에 정한 내용: ${answerText(def.id)}`:'';
  let options=def?.id==='grades'?gradeOptions():Planning.options(def?.id,state.answers);if(def?.id==='subjects')options=[...options,...state.extraSubjects];
  let lastGroup='';options.forEach(raw=>{const option=typeof raw==='string'?{label:raw,value:raw}:raw;if(option.group&&option.group!==lastGroup){const label=document.createElement('div');label.className='chip-group-label';label.textContent=option.group;$('chips').append(label);lastGroup=option.group;}const button=document.createElement('button');button.className='chip';button.textContent=option.label;button.disabled=busy;button.setAttribute('aria-pressed',String(selected.has(option.value)));button.onclick=()=>{if(option.value==='기타 · 직접 입력'){$('custom-wrap').hidden=false;$('custom-subject').focus();return;}if(def.multi){selected.has(option.value)?selected.delete(option.value):selected.add(option.value);button.setAttribute('aria-pressed',String(selected.has(option.value)));$('continue').disabled=!selected.size;}else accept(option.value);};$('chips').append(button);});
  $('send').disabled=busy;$('ai-refine').disabled=busy;$('new-chat').disabled=busy;
  $('chat-input').disabled=busy;$('edit-doc').disabled=busy;
  renderDocument();
}
function accept(value){const def=definitions[state.step];if(!def)return;
  const changed=JSON.stringify(state.answers[def.id])!==JSON.stringify(value);
  if(def.id==='school'&&changed)delete state.answers.grades;
  if(def.id==='subjects'&&changed){delete state.answers.activity;delete state.answers.method;}
  if(def.id==='activity'&&changed)delete state.answers.method;
  if(def.id==='teacher'&&String(value).includes('별도 관리 화면 없음'))delete state.answers.teacherView;
  if(changed&&['school','subjects','activity','method'].includes(def.id)&&state.answers.flow){$('chat-notice').textContent='활동의 방향을 바꿨어요. 기존 자료·활동 흐름·규칙은 보존했으니 새 방향에 맞는지 다시 확인해 주세요.';}
  state.answers[def.id]=value;if(state.draft)state.draftStale=true;
  state.step++;while(definitions[state.step]?.when&&!definitions[state.step].when(state.answers))state.step++;selected=new Set(Array.isArray(state.answers[definitions[state.step]?.id])?state.answers[definitions[state.step].id]:[]);persist();render();scrollChat();
}
function scrollChat(){requestAnimationFrame(()=>{const container=$('chat-scroll');const question=$('question-card');if(question.getBoundingClientRect){container.scrollTo({top:container.scrollTop+question.getBoundingClientRect().top-container.getBoundingClientRect().top-20,behavior:'smooth'});}else container.scrollTo({top:container.scrollHeight,behavior:'smooth'});});}
function panel(name){$('document-panel').hidden=name!=='document';$('settings-panel').hidden=name!=='settings';$('document-tab').setAttribute('aria-selected',String(name==='document'));$('settings-tab').setAttribute('aria-selected',String(name==='settings'));$('detail-panel').classList.add('mobile-open');}
function keySettings(){panel('settings');$('api-fields').hidden=false;$('api-settings').setAttribute('aria-expanded','true');$('api-key').focus();}
function updateConnection(){ $('key-badge').textContent=apiKey?'연결됨 ✓':'연결 안 됨 ›';$('mode-label').lastChild.textContent=apiKey?' Gemini 연결됨':' 기본 질문 모드';}
async function requestAI(prompt,key=apiKey,chosenModel=model,maxTokens=16000){
  controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),120000);
  try{const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(chosenModel)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:maxTokens}}),signal:controller.signal});
    if(!response.ok){const messages={400:'키 또는 모델 설정을 확인해 주세요.',401:'유효한 API 키를 입력해 주세요.',403:'키 권한이나 API 사용 권한을 확인해 주세요.',404:'이 모델을 찾을 수 없습니다. AI Studio의 모델 ID를 확인해 주세요.',429:'무료 사용량 또는 요청 한도에 도달했어요. 잠시 후 다시 시도하거나 AI Studio에서 한도를 확인해 주세요.'};throw new Error(messages[response.status]||'AI 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.');}
    const data=await response.json();if(data.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('응답이 길어 중간에 멈췄어요. 기존 문서는 유지됩니다. 자료 수나 범위를 줄여 다시 요청해 주세요.');const result=data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');if(!result)throw new Error('AI가 답변을 생성하지 못했어요. 입력을 바꿔 다시 시도해 주세요.');return redact(result);
  }catch(error){if(error.name==='AbortError')throw new Error('응답 대기 시간이 지났어요. 내용은 보관되어 있으니 다시 시도해 주세요.');if(error instanceof TypeError)throw new Error('네트워크 연결을 확인해 주세요. 작성 중인 내용은 유지됩니다.');throw error;}finally{clearTimeout(timeout);controller=null;}
}
async function refine(instruction){
  if(!apiKey){keySettings();$('key-status').textContent='상세 PRD 생성에는 개인 API 키가 필요해요. 답변 기반 초안은 키 없이 다운로드할 수 있어요.';return;}
  if(busy)return;busy=true;render();$('chat-notice').textContent='자료 원문·화면 동작·피드백·완료 기준을 구체화하고 있어요…';
  try{const result=await requestAI(Planning.prompt(state.answers,markdown(),instruction));
    if(![1,2,3,4,5,6,7].every(n=>new RegExp(`^##\\s*${n}[.．]`,'m').test(result)))throw new Error('상세 문서 형식이 완성되지 않았어요. 기존 문서를 보존했으니 다시 생성해 주세요.');
    state.previousDraft=markdown();state.draft=result;state.draftStale=false;
    addMessage('assistant','상세 PRD 초안을 작성했어요. 오른쪽 문서의 [제안·교사 검토 필요] 부분과 자료·정답 연결을 확인해 주세요. 바꾸고 싶은 점을 여기서 이야기하면 문서를 수정할 수 있어요.');persist();$('chat-notice').textContent='';
  }catch(error){$('chat-notice').textContent=error.message;}finally{busy=false;render();scrollChat();}
}
async function coach(text,proposal=false){
  if(!apiKey){keySettings();$('key-status').textContent='AI와 함께 구체화하려면 개인 API 키를 연결해 주세요.';return false;}
  if(busy)return false;busy=true;if(!proposal)addMessage('user',text);persist();render();$('chat-notice').textContent=proposal?'현재 활동에 맞는 답변 초안을 제안하고 있어요…':'선택한 과목과 활동을 바탕으로 함께 생각하고 있어요…';
  try{const result=await requestAI(Planning.coachPrompt(state.answers,definitions[state.step]?.id,text,proposal),apiKey,model,6000);
    addMessage('assistant',result);if(proposal){$('chat-input').value=result;chatMode='answer';setChatMode('answer');$('chat-notice').textContent='입력창의 AI 제안을 검토·수정한 뒤 전송하면 답변으로 반영됩니다.';}else $('chat-notice').textContent='답변을 정했다면 “답변 작성”으로 바꾸어 입력하세요.';
    persist();return true;
  }catch(error){$('chat-notice').textContent=error.message;return false;}finally{busy=false;render();scrollChat();}
}
function setChatMode(mode){chatMode=mode;$('answer-mode').setAttribute('aria-pressed',String(mode==='answer'));$('coach-mode').setAttribute('aria-pressed',String(mode==='coach'));$('composer-label').textContent=mode==='coach'?'코치와 편하게 의논하세요':'직접 이야기해 주세요';if(!busy)render();}
function processText(text){const def=definitions[state.step];if(!def){if(apiKey){addMessage('user',text);persist();refine(text);}else{addMessage('user',text);state.draft=markdown()+'\n\n## 추가 요청\n'+text;addMessage('assistant','추가 요청을 기획서에 기록했어요. AI와 대화하며 보완하려면 오른쪽 설정에서 API 키를 연결해 주세요.');persist();render();scrollChat();}return;}
  if(def.id==='school'){const match=[['초등','초등학교'],['중학','중학교'],['고등','고등학교']].filter(([word])=>text.includes(word));if(match.length!==1){$('chat-notice').textContent='초등학교·중학교·고등학교 중 하나를 먼저 선택해 주세요. 학년은 다음 단계에서 여러 개 선택할 수 있어요.';return false;}const grades=[...text.matchAll(/[1-6]/g)].map(m=>`${m[0]}학년`).filter(g=>match[0][1]==='초등학교'||Number(g[0])<=3);accept(match[0][1]);if(grades.length){state.answers.grades=[...new Set(grades)];selected=new Set(state.answers.grades);persist();render();}return;}
  if(def.id==='grades'){const numbers=[...text.matchAll(/[1-6]/g)].map(m=>`${m[0]}학년`);const range=text.match(/([1-6])\s*(?:~|-|부터)\s*([1-6])/);if(range)for(let n=Number(range[1]);n<=Number(range[2]);n++)numbers.push(`${n}학년`);const valid=[...new Set(numbers)].filter(g=>gradeOptions().includes(g));if(!valid.length){$('chat-notice').textContent='해당 학교급의 학년을 선택하거나 숫자로 입력해 주세요. 예: 1, 2학년';return false;}accept(valid);return;}
  if(def.multi){const parts=def.id==='subjects'?text.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean):[text];accept([...new Set([...selected,...parts])]);}else accept(text);
}
$('composer').onsubmit=async event=>{event.preventDefault();if(busy)return;const text=$('chat-input').value.trim();if(!text)return;$('chat-notice').textContent='';if(/AIza[\w-]{20,}/.test(text)||(apiKey&&text.includes(apiKey))){$('chat-input').value='';keySettings();$('key-status').textContent='API 키는 대화가 아닌 이 입력란에 넣어 주세요.';return;}if(chatMode==='coach'){if(await coach(text))$('chat-input').value='';}else if(processText(text)!==false)$('chat-input').value='';};
$('chat-input').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}};
$('continue').onclick=()=>{if(selected.size)accept([...selected]);};
$('add-subject').onclick=()=>{const value=$('custom-subject').value.trim();if(!value)return;if(/AIza[\w-]{20,}/.test(value)){toast('API 키는 설정에 입력해 주세요.');return;}if(!state.extraSubjects.includes(value))state.extraSubjects.push(value);selected.add(value);$('custom-subject').value='';persist();render();};
$('custom-subject').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();$('add-subject').click();}};
$('document-tab').onclick=()=>panel('document');$('settings-tab').onclick=()=>panel('settings');
$('panel-toggle').onclick=()=>{$('detail-panel').classList.toggle('mobile-open');};
$('api-settings').onclick=()=>{const open=$('api-fields').hidden;$('api-fields').hidden=!open;$('api-settings').setAttribute('aria-expanded',String(open));if(open)$('api-key').focus();};
$('toggle-key').onclick=()=>{const show=$('api-key').type==='password';$('api-key').type=show?'text':'password';$('toggle-key').textContent=show?'숨기기':'보기';$('toggle-key').setAttribute('aria-label',show?'API 키 숨기기':'API 키 표시');};
$('connect-key').onclick=async()=>{if(busy)return;const key=$('api-key').value.trim();const requestedModel=$('model').value.trim();if(!key||!/^[a-zA-Z0-9._-]+$/.test(requestedModel)){$('key-status').textContent='API 키와 올바른 모델 ID를 입력해 주세요.';return;}busy=true;$('connect-key').disabled=true;$('remove-key').disabled=true;render();$('key-status').textContent='연결 확인 중… 이 확인에 API 요청 1회가 사용됩니다.';try{await requestAI('한국어로 확인이라고만 답하세요.',key,requestedModel,2048);apiKey=key;model=requestedModel;$('api-key').value='';$('key-status').textContent='연결되었습니다. 키는 새로고침 전까지만 유지됩니다.';updateConnection();}catch(error){$('key-status').textContent=error.message;}finally{busy=false;$('connect-key').disabled=false;$('remove-key').disabled=false;render();}};
$('remove-key').onclick=()=>{if(busy){toast('진행 중인 요청이 끝난 뒤 삭제해 주세요.');return;}apiKey='';$('api-key').value='';$('api-key').type='password';$('toggle-key').textContent='보기';$('key-status').textContent='키를 삭제했습니다.';updateConnection();};
$('ai-refine').onclick=()=>refine('입력 내용을 바탕으로 구현 가능한 PRD를 정리하고, 목표·화면별 기능·수용 기준·미정 사항을 명확히 작성하세요.');
$('copy-doc').onclick=async()=>{try{await navigator.clipboard.writeText(markdown());toast('기획서를 복사했어요.');}catch{toast('복사 권한이 없어요. MD 다운로드를 사용해 주세요.');}};
$('download-doc').onclick=()=>{const url=URL.createObjectURL(new Blob([markdown()],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='LessonApp-PRD.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('edit-doc').onclick=()=>{if(busy)return;if(!editing)state.previousDraft=markdown();editing=!editing;$('prd-preview').hidden=editing;$('document-editor').hidden=!editing;$('edit-doc').textContent=editing?'편집 완료':'직접 편집';if(editing){$('document-editor').value=markdown();$('document-editor').focus();}else renderDocument();};
$('document-editor').oninput=()=>{state.draft=redact($('document-editor').value);persist();};
$('theme-toggle').onclick=()=>{const dark=document.body.classList.toggle('dark');$('theme-toggle').textContent=dark?'라이트 모드':'다크 모드';};
$('new-chat').onclick=()=>$('reset-dialog').showModal();$('cancel-reset').onclick=()=>$('reset-dialog').close();$('confirm-reset').onclick=()=>{state=fresh();selected.clear();editing=false;$('document-editor').hidden=true;$('prd-preview').hidden=false;$('edit-doc').textContent='직접 편집';$('chat-input').value='';$('chat-notice').textContent='';persist();render();$('reset-dialog').close();};$('current-chat').onclick=()=>{$('detail-panel').classList.remove('mobile-open');$('chat-input').focus();};
render();

$('skip-step').onclick=()=>accept('미정 · 추가 구체화 필요');
$('ai-suggest').onclick=()=>coach($('chat-input').value.trim()||'지금 질문에 대한 구체적인 답변을 제안해 주세요.',true);
$('generate-final').onclick=()=>refine('확정 답변을 바탕으로 개발 가능한 상세 PRD 초안을 작성하세요. 부족한 콘텐츠는 제안으로 구분하여 실제 원문과 규칙까지 작성하세요.');
$('answer-mode').onclick=()=>setChatMode('answer');$('coach-mode').onclick=()=>setChatMode('coach');
$('restore-draft').onclick=()=>{if(busy)return;const current=markdown();state.draft=state.previousDraft;state.previousDraft=current;state.draftStale=true;persist();render();toast('이전 문서를 복원했어요. 최신 답변과 맞는지 확인해 주세요.');};
