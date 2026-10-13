import {STRATEGIES, METRICS} from './catalog.mjs';
import {evaluateSnapshot, validateSnapshot} from './engine.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATE = {'qualified':'Qualified','not-qualified':'Not met','waiting':'Waiting','unavailable':'No data','expired':'Window ended'};
const EVIDENCE = {watch:'Watch',fragile:'Fragile',weakened:'Weakened',untested:'Untested'};
const DIRECTION = {calls:'Call-side',puts:'Put-side',both:'Both tails',adaptive:'Direction filter',context:'Market context'};
const CARD_LABELS = {'weekly-mismatch':'Weekly vol ratio','overnight-turbulence':'Overnight turbulence','futures-burst':'Futures burst','opening-iv':'Low opening IV','xau-three-day':'3-day gold momentum','macro-preopen':'Pre-open macro','downside-touch':'Downside touch','two-cent-quotes':'Two-cent quotes'};
const LIGHT_ICON = {qualified:'✓','not-qualified':'×',waiting:'…',unavailable:'—',expired:'—'};
let snapshot, evaluation, scenarios;
let history = [];
try { history = JSON.parse(localStorage.getItem('long-vol-radar-log-v1') || '[]'); if(!Array.isArray(history)) history=[]; } catch { history=[]; }

function showNotice(message) { $('notice').textContent=message; $('notice').hidden=!message; }
function download(name, content, type='application/json') { const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function fmtDate(date) { const d=new Date(`${date}T12:00:00Z`); return Number.isNaN(d.getTime())?date:new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(d); }
function fmtTime(time) { const d=new Date(time);return Number.isNaN(d.getTime())?'Invalid timestamp':new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}).format(d)+' ET'; }
function metricValue(value) {if(value===null || value===undefined) return 'Missing';if(typeof value==='boolean')return value?'Yes':'No';if(typeof value==='object')return JSON.stringify(value);return String(value);}
function badge(signal){return `<span class="state-pill ${esc(signal.state)}"><i class="dot ${esc(signal.state)}"></i>${STATE[signal.state]||esc(signal.state)}</span>`;}
function cards(items,target){$(target).innerHTML=items.map(s=>`<button type="button" class="signal-card ${esc(s.state)}" data-signal="${esc(s.id)}" aria-label="Inspect ${esc(s.title)}: ${STATE[s.state]}"><div class="card-top"><span class="signal-code">${String(STRATEGIES.findIndex(x=>x.id===s.id)+1).padStart(2,'0')}</span><span class="card-arrow" aria-hidden="true">↗</span></div><div class="signal-light-wrap" aria-hidden="true"><span class="signal-light"><span class="light-icon">${LIGHT_ICON[s.state]||'—'}</span></span></div><h3>${esc(CARD_LABELS[s.id]||s.title)}</h3><div class="card-bottom"><span class="signal-status">${STATE[s.state]}</span><span class="signal-meta">${esc(s.category==='vol'?'':s.category==='context'?'Calendar':DIRECTION[s.direction]||s.direction)}</span></div></button>`).join('');$(target).hidden=!items.length;}
function render(){
  const valid=validateSnapshot(snapshot);if(!valid.valid){showNotice('Snapshot could not be evaluated: '+valid.errors.join(' · '));return false;}
  evaluation=evaluateSnapshot(snapshot);
  const s=evaluation.summary;
  $('qualified-count').textContent=s.volChecks ?? s.qualifiedChecks;
  $('driver-count').textContent=s.driverCount;
  $('waiting-count').textContent=s.waiting;
  $('missing-count').textContent=s.unavailable;
  $('overview-text').textContent=`${s.directionalChecks||0} directional · ${s.contextChecks||0} calendar green`;
  const families=[...new Map(STRATEGIES.filter(x=>x.category==='vol').map(x=>[x.family,x.familyLabel])).entries()];
  const activeFamilies=new Set(evaluation.signals.filter(x=>x.category==='vol' && x.state==='qualified').map(x=>x.family));
  $('driver-pills').innerHTML=families.map(([id,label])=>`<span class="driver-pill ${activeFamilies.has(id)?'on':''}" title="${esc(label)}">${activeFamilies.has(id)?'✓':'○'} ${id==='gold-realized'?'Gold activity':'Option pricing'}</span>`).join('');
  const grouped=evaluation.signals;
  cards(grouped.filter(x=>x.category==='vol'),'vol-cards');
  cards(grouped.filter(x=>x.category==='directional'||x.category==='context'),'directional-cards');
  cards(grouped.filter(x=>x.category==='experimental'),'experimental-cards');
  $('snapshot-date').textContent=fmtDate(snapshot.date);
  $('snapshot-time').textContent='As of '+fmtTime(snapshot.asOf);
  const demo=snapshot.mode==='demo';
  $('data-banner').className='data-banner'+(demo?'':' real');
  const age=(Date.now()-Date.parse(snapshot.asOf))/60000;
  const historical=age>30 || age<0;
  $('data-banner').innerHTML=demo?'<span><i class="data-mode-dot" aria-hidden="true"></i><strong>DEMO</strong><span class="data-description">Invented data · not live</span></span>':`<span><i class="data-mode-dot" aria-hidden="true"></i><strong>${esc(snapshot.mode.toUpperCase())}</strong><span class="data-description">${esc(snapshot.source)}</span></span><span>${historical?'Historical / future snapshot':'Supplied snapshot · not a live feed'}</span>`;
  if(evaluation.issues?.length)showNotice(`${s.unavailable} unavailable · click a gray light for details.`);else showNotice('');
  renderHistory();return true;
}
function inspect(id){
  const s=evaluation.signals.find(x=>x.id===id);if(!s)return;
  const inputs=(s.required||[]).map(key=>{const metric=METRICS.find(m=>m.id===key);const o=snapshot.observations[key];return `<tr><td>${esc(metric?.label||key)}</td><td>${esc(metricValue(o?.value))}${o&&metric?.unit&&metric.type!=='boolean'?' '+esc(metric.unit):''}</td><td>${o?esc(fmtDate(o.observedAt.slice(0,10)))+'<br>'+esc(fmtTime(o.observedAt)):'—'}</td></tr>`;}).join('');
  const checks=(s.checks||[]).map(c=>`<tr><td>${esc(c.label)}</td><td>${esc(metricValue(c.actual))}</td><td>${esc(metricValue(c.expected))}</td><td class="${c.passed?'check-pass':'check-fail'}">${c.passed?'✓':'—'}</td></tr>`).join('');
  $('inspector-content').innerHTML=`<h2>${esc(s.title)}</h2><div class="inspector-badges">${badge(s)}<span class="evidence-badge">Evidence: ${esc(EVIDENCE[s.evidence]||s.evidence)}</span><span class="evidence-badge">${esc(DIRECTION[s.direction]||s.direction)}</span></div><p class="inspector-summary">${esc(s.reason)}</p><div class="inspector-section"><h3>The frozen rule</h3><p>${esc(s.rule)}</p><p class="source-note">Evaluation window: ${esc(s.readyAt)}–${esc(s.expiresAt)} ET · Driver: ${esc(s.familyLabel)}</p></div>${checks?`<div class="inspector-section"><h3>Criteria at this snapshot</h3><table class="checks-table"><thead><tr><th>Criterion</th><th>Observed</th><th>Required</th><th>Met</th></tr></thead><tbody>${checks}</tbody></table></div>`:''}<div class="inspector-section"><h3>What the saved research found</h3><p>${esc(s.result)}</p></div><div class="inspector-section"><h3>What limits the interpretation</h3><p>${esc(s.caveat)}</p><p class="source-note">Research source: ${esc(s.sourceFile)}</p></div><div class="inspector-section"><h3>Input provenance</h3><table class="checks-table"><thead><tr><th>Input</th><th>Value</th><th>Observed</th></tr></thead><tbody>${inputs||'<tr><td colspan="3">No required inputs listed.</td></tr>'}</tbody></table><p class="source-note">Snapshot source: ${esc(snapshot.source)} · ${esc(snapshot.mode)} · ${esc(snapshot.asOf)}. Qualification is a research observation, not an executable order.</p></div>`;
  $('inspector').showModal();
}
function openInputs(){
  $('input-date').value=snapshot.date;
  const asOf=new Date(snapshot.asOf);
  $('input-time').value=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/New_York'}).format(asOf);
  $('input-source').value=snapshot.mode==='demo'?'Edited demonstration; invented inputs':snapshot.source;
  $('trading-day').checked=snapshot.session.isTradingDay===true;
  $('full-session').checked=snapshot.session.isFullSession===true;
  $('expiry-day').checked=snapshot.session.has0dte===true;
  $('input-fields').innerHTML=METRICS.map(m=>{const o=snapshot.observations[m.id];const value=o?.value;return `<div class="input-row"><label for="metric-${esc(m.id)}">${esc(m.label)}<span>${esc(m.unit||'Boolean')} · ${m.metadata?.historical?'Prior-history baseline':'Observed session input'}</span></label>${m.type==='boolean'?`<select id="metric-${esc(m.id)}" data-metric="${esc(m.id)}"><option value="">Missing</option><option value="true"${value===true?' selected':''}>Yes</option><option value="false"${value===false?' selected':''}>No</option></select>`:`<input id="metric-${esc(m.id)}" data-metric="${esc(m.id)}" type="number" step="any" value="${typeof value==='number'?esc(value):''}" placeholder="Missing">`}<small>${esc(m.description)}</small></div>`;}).join('');
  $('input-error').hidden=true; $('input-dialog').showModal();
}
function newYorkTimestamp(date,time){
  const d=new Date(`${date}T${time}:00Z`);
  const offset=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',timeZoneName:'longOffset'}).formatToParts(d).find(x=>x.type==='timeZoneName').value.replace('GMT','');
  return `${date}T${time}:00${offset}`;
}
function renderHistory(){
  if(!history.length){$('history-content').innerHTML='<div class="empty-message">No mornings saved yet. Save a snapshot to start an observation log.</div>';return;}
  $('history-content').innerHTML=`<table class="history-table"><thead><tr><th>Session</th><th>As of</th><th>Source</th><th>Vol checks / drivers</th><th></th></tr></thead><tbody>${history.map((h,i)=>{let sum;try{sum=evaluateSnapshot(h.snapshot).summary;}catch{return '';}return `<tr><td>${esc(h.snapshot.date)}</td><td>${esc(fmtTime(h.snapshot.asOf))}</td><td>${esc(h.snapshot.mode)}</td><td>${sum.volChecks??sum.qualifiedChecks} / ${sum.driverCount}</td><td><button data-history="${i}">Open →</button></td></tr>`;}).join('')}</tbody></table>`;
}
function setView(view){document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===view));for(const v of ['board','history','methodology'])$(v+'-view').hidden=v!==view;}

document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('about-board').addEventListener('click',()=>setView('methodology'));
document.querySelector('.tools-dropdown').addEventListener('click',event=>{if(event.target.closest('button'))document.querySelector('.tools-menu').open=false;});
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();setView('board');});
document.addEventListener('click',event=>{const menu=document.querySelector('.tools-menu');if(menu.open&&!menu.contains(event.target))menu.open=false;const card=event.target.closest('[data-signal]');if(card)inspect(card.dataset.signal);const h=event.target.closest('[data-history]');if(h){snapshot=structuredClone(history[Number(h.dataset.history)].snapshot);$('scenario').value='';render();setView('board');}});
$('edit-button').addEventListener('click',openInputs);
$('blank-inputs').addEventListener('click',()=>document.querySelectorAll('[data-metric]').forEach(i=>i.value=''));
$('input-form').addEventListener('submit',event=>{
  event.preventDefault();const date=$('input-date').value;const asOf=newYorkTimestamp(date,$('input-time').value);const observations={};
  for(const input of document.querySelectorAll('[data-metric]')){if(input.value==='')continue;const metric=METRICS.find(m=>m.id===input.dataset.metric);const value=metric.type==='boolean'?input.value==='true':Number(input.value);const observedAt=metric.metadata?.historical?new Date(Date.parse(asOf)-86400000).toISOString():['pennyPreviousBid','pennyPreviousAsk'].includes(metric.id)?new Date(Date.parse(asOf)-60000).toISOString():asOf;observations[metric.id]={value,observedAt,source:$('input-source').value};}
  const candidate={schemaVersion:1,date,asOf,mode:snapshot.mode==='demo'?'demo':'manual',source:$('input-source').value,session:{isTradingDay:$('trading-day').checked,isFullSession:$('full-session').checked,has0dte:$('expiry-day').checked},observations};
  const validation=validateSnapshot(candidate);if(!validation.valid){$('input-error').textContent=validation.errors.join(' · ');$('input-error').hidden=false;return;}snapshot=candidate;$('scenario').value='';render();$('input-dialog').close();setView('board');
});
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(file.size>2_000_000)throw new Error('Snapshot exceeds the 2 MB limit.');const candidate=JSON.parse(await file.text());const validation=validateSnapshot(candidate);if(!validation.valid)throw new Error(validation.errors.join(' · '));snapshot=candidate;if(snapshot.mode==='demo'){}else snapshot.mode=candidate.mode==='quantconnect'?'quantconnect':'imported';$('scenario').value='';render();setView('board');}
  catch(error){showNotice('Import failed. '+error.message);}finally{event.target.value='';}
});
$('scenario').addEventListener('change',event=>{snapshot=structuredClone(scenarios[event.target.value]);render();setView('board');});
$('export-button').addEventListener('click',()=>download(`long-vol-${snapshot.date}.json`,JSON.stringify({...snapshot,evaluation:{engineVersion:'0.1.0',signals:evaluation.signals,summary:evaluation.summary}},null,2)));
$('export-log').addEventListener('click',()=>download('long-vol-morning-log.json',JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),entries:history},null,2)));
$('save-button').addEventListener('click',()=>{const key=snapshot.date+'|'+snapshot.asOf+'|'+snapshot.mode;const item={key,savedAt:new Date().toISOString(),ruleVersion:'0.1.0',snapshot:structuredClone(snapshot)};history=history.filter(h=>h.key!==key);history.unshift(item);history=history.slice(0,100);try{localStorage.setItem('long-vol-radar-log-v1',JSON.stringify(history));renderHistory();$('save-button').textContent='Morning saved ✓';setTimeout(()=>$('save-button').innerHTML='Save morning <span aria-hidden="true">↗</span>',1800);}catch{showNotice('Browser storage is unavailable. Use Export to keep this snapshot.');}});
$('template-button').addEventListener('click',()=>{const template={schemaVersion:1,date:snapshot.date,asOf:snapshot.asOf,mode:'manual',source:'Replace with your data source',session:{isTradingDay:false,isFullSession:false,has0dte:false},observations:Object.fromEntries(METRICS.map(m=>[m.id,{value:null,observedAt:snapshot.asOf,source:'Replace with the observation source'}]))};download('morning-snapshot-template.json',JSON.stringify(template,null,2));});

async function init(){
  try{const response=await fetch('./demo.json');if(!response.ok)throw new Error('Could not load the demonstration snapshots.');scenarios=await response.json();snapshot=structuredClone(scenarios.mixed);render();$('rule-catalog').innerHTML=STRATEGIES.map(s=>`<details class="rule-entry"><summary>${esc(s.title)} · ${esc(EVIDENCE[s.evidence]||s.evidence)}</summary><p>${esc(s.rule)}</p><p>${esc(s.result)}</p><p>${esc(s.caveat)}</p><p><code>Research source: ${esc(s.sourceFile)}</code></p></details>`).join('');}
  catch(error){showNotice('The board could not load. '+error.message);}
}
init();
