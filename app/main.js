import { getState, update, replace, reset, startFresh, subscribe } from '../core/state.js';
import { interpret, answerQuery } from '../modules/assistant/engine.js';
import { applyOperationsAtomic, enabledOperations, reconcileAppliedOperations, refreshProposal, validateProposal } from '../modules/assistant/operations.js';
import { askAssistant, discoverAssistant, testAssistant } from '../modules/assistant/gateway.js';
import { attentionSignals, buildDailyBrief, contextSnapshot, dailyPlan, financeSnapshot, generateSuggestions, projectHealth } from '../core/kernel.js';
import { dateKey, id } from '../storage/store.js';
import { esc, money, date, shortDate, orbitName, projectName, priorityLabel, projectProgress } from '../shared/utils.js';
import { composerHeight, conversationScrollTarget, formatBytes, isNearScrollEnd, shouldRestoreDocumentScroll, shouldSubmitComposerKey } from '../shared/ui.js';
import { addMonths, detectRecurringCandidates, financeMonthLedger, financeMonthReview, financeProjection, monthKey, monthLabel, nextRecurringDate } from '../core/finance.js';
import { habitFourWeekStats, habitScheduleLabel, habitStreak, habitWeekStats, historyValue, isCompleted, isHabitScheduled, isSkipped, measurementLabel, nextHabitOpportunity, normalizeMeasurement, normalizeSchedule, weekDays, weekStart } from '../core/habits.js';

const routes=['edition','terminal','universe','projects','tasks','habits','calendar','finance','workbench','review','settings'];
const labels={edition:'Inicio',terminal:'Conversar',universe:'Radar',projects:'Proyectos',tasks:'Acciones',habits:'Hábitos',calendar:'Tiempo',finance:'Dinero',workbench:'Mesa',review:'Registro',settings:'Ajustes'};
const visibleNav=['edition','terminal','projects','tasks','finance'];
const secondaryNav=['universe','habits','calendar','review','settings'];
const $=selector=>document.querySelector(selector);
let route=location.hash.slice(1).split('/')[0]||'edition';
if(!routes.includes(route))route='edition';
let selectedProjectId=location.hash.split('/')[1]||getState().projects[0]?.id||'';
let toastTimer;
let pendingPageScroll = false;
let previousRoute = route;
let moreMenuOpen = false;
let assistantBusy = false;
let conversationRenderId = 0;
let financeMonth = monthKey();
let financeTab = 'overview';
let habitWeek = weekStart();
const conversationUi = { draft: '', scrollTop: 0, stickToBottom: true, focusComposer: false, forceBottom: false, selectionStart: 0, selectionEnd: 0 };
const WORKSPACE_COLLECTIONS=['projects','tasks','habits','events','notes','transactions','recurringTransactions','installmentPlans','budgets','skippedOccurrences','financialGoals','monthReviews','undoBatches','assets','captures','activity'];
function substantiveAssistantLog(state){return(state.assistantLog||[]).filter(entry=>!entry.systemWelcome);}
function workspaceCounts(state){return{projects:state.projects.length,tasks:state.tasks.length,habits:state.habits.length,events:state.events.length,finance:state.transactions.length+state.recurringTransactions.length+state.installmentPlans.length+state.budgets.length+state.financialGoals.length,context:state.notes.length+state.assets.length,history:state.activity.length+substantiveAssistantLog(state).length+state.monthReviews.length+state.undoBatches.length};}
function isWorkspaceEmpty(state){return WORKSPACE_COLLECTIONS.every(key=>!state[key]?.length)&&!substantiveAssistantLog(state).length;}

function toast(message){const element=$('#toast');element.textContent=message;element.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.classList.remove('show'),2200);}
function navigate(next,idValue=''){
  moreMenuOpen=false;
  const nextProjectId=idValue||selectedProjectId;
  const targetHash=`#${idValue?`${next}/${idValue}`:next}`;
  pendingPageScroll=next!==route||(next==='workbench'&&nextProjectId!==selectedProjectId);
  if(location.hash!==targetHash){location.hash=targetHash;return;}
  route=next;selectedProjectId=nextProjectId;render();
}
function positionMoreMenu(){
  const toggle=$('#mainNav [data-more-toggle]'),menu=$('#moreNavMenu');
  if(!moreMenuOpen||!toggle||!menu)return;
  const rect=toggle.getBoundingClientRect(),width=Math.min(220,window.innerWidth-16);
  const left=Math.min(Math.max(8,rect.right-width),window.innerWidth-width-8);
  menu.style.width=`${width}px`;
  menu.style.left=`${left}px`;
  menu.style.top=`${Math.round(rect.bottom+1)}px`;
}
function nav(){
  const nav=$('#mainNav'),menu=$('#moreNavMenu');
  const primary=visibleNav.map(item=>`<button type="button" class="nav-button ${item===route?'is-active':''}" data-route="${item}">${labels[item]}</button>`).join('');
  const secondaryActive=secondaryNav.includes(route);
  const more=`<button type="button" class="nav-button more-nav-toggle ${secondaryActive?'is-active':''}" data-more-toggle aria-expanded="${moreMenuOpen}" aria-controls="moreNavMenu">Más<span aria-hidden="true">${moreMenuOpen?'−':'+'}</span></button>`;
  nav.innerHTML=primary+more;
  menu.innerHTML=secondaryNav.map(item=>`<button type="button" class="${item===route?'is-active':''}" data-route="${item}">${labels[item]}</button>`).join('');
  menu.hidden=!moreMenuOpen;
  if(moreMenuOpen)requestAnimationFrame(positionMoreMenu);
}
function pageHead(kicker,title,description,actions=''){return`<header class="page-head"><div><p class="kicker">${kicker}</p><h2>${title}</h2></div><div class="page-head-copy"><p>${description}</p>${actions}</div></header>`;}
function riskLabel(status){return{critical:'Crítico',watch:'Observar',moving:'En movimiento',quiet:'En calma'}[status]||status;}
function recurrenceLabel(rule){const labels={weekly:'Semanal',biweekly:'Quincenal',monthly:'Mensual',bimonthly:'Cada 2 meses',quarterly:'Cada 3 meses',yearly:'Anual','custom-months':`Cada ${rule.interval||1} meses`};return labels[rule.frequency]||rule.frequency||'Mensual';}
function sourceLabel(source){return source==='ollama'?'OLLAMA LOCAL':source==='fallback'?'KERNEL / OLLAMA ERROR':source==='pending'?'OLLAMA / ANALIZANDO':'KERNEL LOCAL';}
function multiline(value){return esc(value).replaceAll('\n','<br>');}
function addLog(entry){update(state=>{state.assistantLog.push({id:id('log'),at:new Date().toISOString(),...entry});state.assistantLog=state.assistantLog.slice(-100);});}
function patchLog(logId,patch){update(state=>Object.assign(state.assistantLog.find(item=>item.id===logId)||{},patch));}
function dismissProposal(proposalId){update(state=>{const entry=state.assistantLog.find(item=>item.proposal?.id===proposalId);if(entry)entry.proposalStatus='cancelled';},'Propuesta descartada');}
function pushUndoBatch(state,batch){state.undoBatches.unshift(batch);state.undoBatches=state.undoBatches.slice(0,30);}
function applyProposal(proposal){
  const validation=validateProposal(getState(),proposal);
  if(validation.status!=='ready'){
    update(state=>{const entry=state.assistantLog.find(item=>item.proposal?.id===proposal.id);if(entry)entry.proposal.validation=validation;});
    toast('La propuesta tiene bloqueos. Edítala antes de confirmar.');
    openProposalEditor(proposal.id);
    return;
  }
  const batchId=id('undo');
  const projectId=enabledOperations(proposal).map(operation=>operation.data?.projectId||operation.patch?.projectId).find(Boolean)||'';
  let appliedProposal;
  try{
    update(state=>{
      const entry=state.assistantLog.find(item=>item.proposal?.id===proposal.id);if(!entry)throw new Error('La propuesta ya no existe');
      refreshProposal(state,entry.proposal);
      if(entry.proposal.validation.status!=='ready')throw new Error('La propuesta tiene validaciones pendientes');
      const receipt=applyOperationsAtomic(state,enabledOperations(entry.proposal));
      appliedProposal=structuredClone(entry.proposal);
      const appliedOperations=structuredClone(receipt.forwardOperations);
      pushUndoBatch(state,{id:batchId,at:new Date().toISOString(),summary:entry.proposal.summary,proposalId:entry.proposal.id,kind:'proposal-apply',inverseOperations:receipt.inverseOperations,forwardOperations:receipt.forwardOperations});
      entry.proposalStatus='applied';
      entry.appliedBatchId=batchId;
      entry.application={appliedAt:new Date().toISOString(),appliedOperations,beforeByOperation:receipt.beforeByOperation};
    },proposal.summary,{source:'assistant',projectId,batchId});
  }catch(error){toast(`No se aplicó: ${error.message}`);return;}
  addLog({role:'assistant',text:`✓ Aplicado atómicamente: ${appliedProposal.summary}`,source:'kernel',undoBatchId:batchId});
  toast('Cambio aplicado. Puedes editarlo o deshacerlo.');
}
function undoBatch(batchId){
  const batch=getState().undoBatches.find(item=>item.id===batchId);
  if(!batch){toast('Ese cambio ya no se puede deshacer');return;}
  try{
    update(state=>{
      if(Array.isArray(batch.inverseOperations))applyOperationsAtomic(state,batch.inverseOperations);
      else for(const [collection,value] of Object.entries(batch.collections||{}))state[collection]=structuredClone(value);
      state.undoBatches=state.undoBatches.filter(item=>item.id!==batchId);
      for(const entry of state.assistantLog)if(entry.undoBatchId===batchId)entry.undoStatus='undone';
      const proposalEntry=batch.proposalId?state.assistantLog.find(item=>item.proposal?.id===batch.proposalId):null;
      if(proposalEntry&&batch.kind==='proposal-apply')proposalEntry.proposalStatus='undone';
      if(proposalEntry&&batch.kind==='proposal-edit'&&batch.proposalBefore){
        proposalEntry.proposal=structuredClone(batch.proposalBefore);
        proposalEntry.application=structuredClone(batch.applicationBefore||proposalEntry.application);
        proposalEntry.proposalStatus='applied';
      }
    },`Deshecho: ${batch.summary}`,{source:'undo'});
  }catch(error){toast(`No se pudo deshacer: ${error.message}`);return;}
  addLog({role:'assistant',text:`↶ Deshecho atómicamente: ${batch.summary}`,source:'kernel'});
  toast('Lote restaurado sin afectar otros cambios');
}
function proposalOperationSummary(operations=[]){
  const labels={
    projects:['proyecto','proyectos'],tasks:['tarea','tareas'],notes:['nota','notas'],events:['evento','eventos'],habits:['hábito','hábitos'],
    transactions:['movimiento','movimientos'],recurringTransactions:['recurrencia','recurrencias'],installmentPlans:['plan de cuotas','planes de cuotas'],
    budgets:['presupuesto','presupuestos'],financialGoals:['objetivo financiero','objetivos financieros'],assets:['objeto de inventario','objetos de inventario']
  };
  const grouped=new Map();
  for(const operation of operations){
    const action=operation.type==='create'?'CREAR':operation.type==='update'?'ACTUALIZAR':operation.type==='replace'?'REEMPLAZAR':'ELIMINAR';
    const key=`${action}:${operation.collection}`;
    grouped.set(key,{action,collection:operation.collection,count:(grouped.get(key)?.count||0)+1});
  }
  return[...grouped.values()].map(item=>{
    const pair=labels[item.collection]||[item.collection,item.collection];
    return`${item.action} ${item.count} ${item.count===1?pair[0]:pair[1]}`;
  }).join(' · ');
}
function proposalMarkup(proposal,status='pending'){
  const validation=proposal.validation||{status:'ready',blockers:[],warnings:[]};
  const operations=enabledOperations(proposal);
  const operationLabels=proposalOperationSummary(operations);
  const sections=proposal.sections?.length?`<div class="proposal-sections">${proposal.sections.map(section=>`<section><header><strong>${esc(section.title)}</strong>${section.isNew?'<span>NUEVO</span>':''}</header><ul>${section.items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`).join('')}</div>`:'';
  const fallbackEvidence=!sections&&proposal.evidence?.length?`<ul>${proposal.evidence.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'';
  const assumptions=proposal.assumptions?.length?`<aside class="proposal-assumptions"><strong>SUPOSICIONES DETECTADAS</strong>${proposal.assumptions.map(item=>`<p>${esc(item)}</p>`).join('')}</aside>`:'';
  const warnings=validation.warnings?.length?`<aside class="proposal-warnings"><strong>ADVERTENCIAS</strong>${validation.warnings.map(item=>`<p>${esc(item.message)}</p>`).join('')}</aside>`:'';
  const blockers=validation.blockers?.length?`<aside class="proposal-blockers"><strong>${validation.blockers.length} BLOQUEO${validation.blockers.length===1?'':'S'} POR RESOLVER</strong>${validation.blockers.map(item=>`<p>${esc(item.message)}</p>`).join('')}</aside>`:'';
  const pendingSegments=(proposal.ambiguities||[]).filter(item=>!['ignore','replaced'].includes(item.resolution));
  const ambiguitySummary=pendingSegments.length?`<aside class="proposal-ambiguities"><strong>SEGMENTOS PENDIENTES</strong>${pendingSegments.map(item=>`<p><b>${esc(item.text)}</b><span>${esc(item.reason||'No verificable')}</span></p>`).join('')}</aside>`:'';
  const ready=validation.status==='ready';
  let footer='';
  if(status==='pending')footer=ready
    ?`<button class="button" data-edit-proposal="${proposal.id}">Editar propuesta</button><button class="button acid" data-apply-proposal="${proposal.id}">Confirmar y aplicar</button><button class="button" data-dismiss-proposal="${proposal.id}">Descartar</button>`
    :`<button class="button acid" data-edit-proposal="${proposal.id}">Resolver bloqueos</button><button class="button" data-dismiss-proposal="${proposal.id}">Descartar</button>`;
  else if(status==='applied')footer=`<button class="button" data-edit-proposal="${proposal.id}">Editar aplicación</button><span>APLICADA / EDITABLE</span>`;
  else footer=`<span>${status==='undone'?'DESHECHA':'DESCARTADA'}</span>`;
  return`<article class="proposal-card ${status} ${ready?'is-ready':'is-blocked'}"><div class="proposal-top"><span>PROPUESTA ESTRUCTURADA</span><span>${esc(operationLabels||'SIN CAMBIOS HABILITADOS')}</span></div><h4>${esc(proposal.title)}</h4><p>${esc(proposal.summary)}</p>${sections}${fallbackEvidence}${assumptions}${warnings}${ambiguitySummary}${blockers}<footer>${footer}</footer></article>`;
}
function blockedRequestMarkup(request){
  const ambiguities=request.ambiguities||[];
  return`<article class="blocked-request-card"><div class="proposal-top"><span>OPERACIÓN BLOQUEADA</span><span>NO ENVIADA A OLLAMA</span></div><h4>${esc(request.title||'Solicitud operativa incompleta')}</h4><p>${esc(request.message||'No se aplicó ningún cambio.')}</p>${ambiguities.length?`<ul>${ambiguities.map(item=>`<li><strong>${esc(item.text)}</strong><span>${esc(item.reason||'No verificable')}</span></li>`).join('')}</ul>`:''}</article>`;
}

function projectOptions(state,selected='',extra=[]){
  const records=[...state.projects,...extra].filter((item,index,array)=>item?.id&&array.findIndex(candidate=>candidate.id===item.id)===index);
  return`<option value="">Sin proyecto</option>${records.map(project=>`<option value="${esc(project.id)}" ${project.id===selected?'selected':''}>${esc(project.title)}</option>`).join('')}`;
}
function orbitOptions(state,selected=''){return`<option value="">Sin órbita</option>${state.orbits.map(orbit=>`<option value="${esc(orbit.id)}" ${orbit.id===selected?'selected':''}>${esc(orbit.name)}</option>`).join('')}`;}
function proposalFieldMarkup(operation,index,state,extraProjects){
  const current=operation.type==='update'?{...(state[operation.collection]?.find(item=>item.id===operation.id)||{}),...(operation.patch||{})}:operation.type==='replace'?{...(operation.data||{})}:{...(operation.data||{})};
  const name=field=>`op_${index}_${field}`;
  const text=(field,label,value=current[field]||'',type='text')=>`<label><span>${label}</span><input name="${name(field)}" type="${type}" value="${esc(value)}"></label>`;
  const textarea=(field,label,value=current[field]||'')=>`<label class="wide"><span>${label}</span><textarea name="${name(field)}">${esc(value)}</textarea></label>`;
  const project=`<label><span>Proyecto</span><select name="${name('projectId')}">${projectOptions(state,current.projectId||'',extraProjects)}</select></label>`;
  const orbit=`<label><span>Órbita</span><select name="${name('orbitId')}">${orbitOptions(state,current.orbitId||'')}</select></label>`;
  let fields='';
  if(operation.collection==='projects')fields=text('title','Nombre')+textarea('goal','Objetivo')+text('budget','Presupuesto',current.budget||0,'number')+text('dueDate','Fecha objetivo',current.dueDate||'','date')+orbit;
  else if(operation.collection==='tasks')fields=text('title','Acción')+text('dueDate','Fecha',current.dueDate||'','date')+`<label><span>Prioridad</span><select name="${name('priority')}">${['high','medium','low'].map(value=>`<option value="${value}" ${current.priority===value?'selected':''}>${priorityLabel(value)}</option>`).join('')}</select></label>`+text('estimate','Minutos',current.estimate||30,'number')+project+orbit;
  else if(operation.collection==='notes')fields=text('title','Título')+textarea('content','Contenido')+project+orbit;
  else if(operation.collection==='events')fields=text('title','Evento')+text('date','Fecha',current.date||'','date')+text('time','Hora',current.time||'','time')+project+orbit;
  else if(operation.collection==='transactions')fields=text('description','Concepto')+text('amount','Monto',current.amount||0,'number')+`<label><span>Tipo</span><select name="${name('type')}"><option value="expense" ${current.type==='expense'?'selected':''}>Gasto</option><option value="income" ${current.type==='income'?'selected':''}>Ingreso</option></select></label>`+text('category','Categoría')+text('date','Fecha',current.date||dateKey(),'date')+project+orbit;
  else if(operation.collection==='recurringTransactions')fields=text('description','Concepto')+text('amount','Monto',current.amount||0,'number')+`<label><span>Tipo</span><select name="${name('type')}"><option value="expense" ${current.type==='expense'?'selected':''}>Gasto</option><option value="income" ${current.type==='income'?'selected':''}>Ingreso</option></select></label>`+text('category','Categoría')+`<label><span>Frecuencia</span><select name="${name('frequency')}">${[['weekly','Semanal'],['biweekly','Quincenal'],['monthly','Mensual'],['bimonthly','Bimestral'],['quarterly','Trimestral'],['custom-months','Cada X meses'],['yearly','Anual']].map(([value,label])=>`<option value="${value}" ${current.frequency===value?'selected':''}>${label}</option>`).join('')}</select></label>`+text('interval','Intervalo',current.interval||1,'number')+text('day','Día del mes',current.day||1,'number')+`<label><span>Regla de día</span><select name="${name('dayRule')}"><option value="" ${!current.dayRule?'selected':''}>Día indicado</option><option value="last-day" ${current.dayRule==='last-day'?'selected':''}>Último día</option><option value="last-business-day" ${current.dayRule==='last-business-day'?'selected':''}>Último día hábil</option></select></label>`+text('startDate','Inicio',current.startDate||dateKey(),'date')+text('endDate','Término',current.endDate||'','date')+project+orbit;
  else if(operation.collection==='habits'){
    const schedule=current.schedule||{},measurement=current.measurement||{};
    fields=text('title','Hábito')+`<label><span>Frecuencia</span><select name="${name('scheduleType')}" data-habit-schedule-select>${[['daily','Todos los días'],['daysOfWeek','Días específicos'],['timesPerWeek','Veces por semana'],['timesPerMonth','Veces por mes'],['interval','Cada X días'],['weekends','Fines de semana'],['flexible','Sin frecuencia fija']].map(([value,label])=>`<option value="${value}" ${schedule.type===value?'selected':''}>${label}</option>`).join('')}</select></label>`+`<label data-habit-field="targetCount"><span>Veces objetivo</span><input name="${name('targetCount')}" type="number" min="1" value="${esc(schedule.targetCount||1)}"></label>`+`<label data-habit-field="intervalDays"><span>Intervalo en días</span><input name="${name('intervalDays')}" type="number" min="1" value="${esc(schedule.intervalDays||1)}"></label>`+`<div class="wide weekday-editor" data-habit-field="days"><span>Días</span>${[['D',0],['L',1],['M',2],['X',3],['J',4],['V',5],['S',6]].map(([label,value])=>`<label><input type="checkbox" name="${name('days')}" value="${value}" ${(schedule.days||current.targetDays||[]).includes(value)?'checked':''}><b>${label}</b></label>`).join('')}</div>`+`<label><span>Medición</span><select name="${name('measurementType')}">${[['boolean','Completado'],['minutes','Minutos'],['count','Cantidad'],['repetitions','Repeticiones'],['distance','Distancia'],['volume','Volumen'],['pages','Páginas']].map(([value,label])=>`<option value="${value}" ${measurement.type===value?'selected':''}>${label}</option>`).join('')}</select></label>`+text('measurementTarget','Objetivo',measurement.target||1,'number')+text('measurementUnit','Unidad',measurement.unit||'sesión')+project+orbit;
  } else if(operation.collection==='installmentPlans')fields=text('description','Compra')+text('totalAmount','Total',current.totalAmount||0,'number')+text('installments','Cuotas',current.installments||2,'number')+text('firstDate','Primera cuota',current.firstDate||dateKey(),'date')+text('category','Categoría')+project+orbit;
  else if(operation.collection==='financialGoals')fields=text('title','Objetivo')+text('amount','Monto',current.amount||0,'number')+text('targetDate','Fecha objetivo',current.targetDate||'','date')+text('category','Categoría')+project+orbit;
  else if(operation.collection==='assets')fields=text('title','Objeto')+text('amount','Valor total',current.amount||0,'number')+text('quantity','Cantidad',current.quantity||1,'number')+text('category','Categoría')+project+orbit;
  else fields=textarea('raw','Datos',JSON.stringify(current,null,2));
  const approval=operation.collection==='projects'&&operation.type==='create'&&operation.meta?.requiresApproval?`<label class="operation-approval"><input type="checkbox" name="${name('approved')}" ${operation.meta?.approved?'checked':''}><span>Autorizar creación del proyecto inferido</span></label>`:'';
  return`<fieldset class="proposal-operation-editor ${operation.enabled===false?'is-disabled':''}" data-operation-index="${index}"><legend>${operation.type.toUpperCase()} / ${esc(operation.collection)}</legend><div class="operation-controls"><label><input type="checkbox" name="${name('enabled')}" ${operation.enabled===false?'':'checked'}><span>Incluir este cambio</span></label>${approval}</div><div class="editor-grid">${fields}</div></fieldset>`;
}
function humanOperation(operation,state){
  const data=operation.data||operation.patch||{};
  const label=data.title||data.description||operation.collection;
  const amount=data.amount||data.totalAmount;
  const project=state.projects.find(item=>item.id===data.projectId)?.title;
  return`${operation.type==='create'?'Crear':operation.type==='update'?'Actualizar':operation.type==='replace'?'Reemplazar':'Eliminar'} ${label}${amount?` · ${money(amount)}`:''}${project?` · ${project}`:''}`;
}
function proposalDraftFromForm(proposal,form,state){
  const draft=structuredClone(proposal);
  const numberFields=new Set(['amount','budget','estimate','day','interval','targetCount','intervalDays','measurementTarget','totalAmount','installments','quantity']);
  draft.operations.forEach((operation,index)=>{
    const target=operation.type==='update'?(operation.patch||={}):(operation.data||={});
    const prefix=`op_${index}_`;
    operation.enabled=form.has(`${prefix}enabled`);
    if(operation.meta?.requiresApproval)operation.meta.approved=form.has(`${prefix}approved`);
    for(const [key,value] of form.entries()){
      if(!key.startsWith(prefix)||key===`${prefix}days`)continue;
      const field=key.slice(prefix.length);
      if(['enabled','approved','scheduleType','targetCount','intervalDays','measurementType','measurementTarget','measurementUnit'].includes(field))continue;
      target[field]=numberFields.has(field)?Number(value)||0:value;
    }
    if(operation.collection==='habits'){
      const selectedDays=form.getAll(`${prefix}days`).map(Number),type=String(form.get(`${prefix}scheduleType`)||'flexible');
      const days=type==='daily'?[0,1,2,3,4,5,6]:type==='weekends'?[0,6]:type==='daysOfWeek'?selectedDays:[];
      target.schedule={...(target.schedule||{}),type,days,targetCount:['timesPerWeek','timesPerMonth'].includes(type)?Math.max(1,Number(form.get(`${prefix}targetCount`))||1):1,intervalDays:type==='interval'?Math.max(1,Number(form.get(`${prefix}intervalDays`))||1):1,startDate:target.schedule?.startDate||dateKey(),endDate:target.schedule?.endDate||''};
      target.targetDays=days;
      target.measurement={type:String(form.get(`${prefix}measurementType`)||'boolean'),target:Number(form.get(`${prefix}measurementTarget`))||1,unit:String(form.get(`${prefix}measurementUnit`)||'sesión')};
    }
    if(operation.collection==='recurringTransactions')target.businessDay=target.dayRule==='last-business-day'?'last':'';
    if(operation.collection==='installmentPlans')target.installmentAmount=Math.round((Number(target.totalAmount)||0)/Math.max(1,Number(target.installments)||1));
  });
  for(const ambiguity of draft.ambiguities||[]){
    const ignore=form.has(`ambiguity_${ambiguity.id}_ignore`);
    const replacement=String(form.get(`ambiguity_${ambiguity.id}_replacement`)||'').trim();
    const previousReplacement=String(ambiguity.replacement||'').trim();
    if(ignore){
      draft.operations=draft.operations.filter(operation=>operation.meta?.ambiguityId!==ambiguity.id);
      ambiguity.resolution='ignore';
      ambiguity.replacement='';
      continue;
    }
    if(replacement){
      if(!(ambiguity.resolution==='replaced'&&replacement===previousReplacement)){
        draft.operations=draft.operations.filter(operation=>operation.meta?.ambiguityId!==ambiguity.id);
        const parsed=interpret(replacement,state);
        if(parsed.kind==='proposal'){
          for(const operation of parsed.proposal.operations){
            const added=structuredClone(operation);
            added.meta={...(added.meta||{}),ambiguityId:ambiguity.id};
            draft.operations.push(added);
          }
          draft.assumptions=[...(draft.assumptions||[]),...(parsed.proposal.assumptions||[])];
          draft.warnings=[...(draft.warnings||[]),...(parsed.proposal.warnings||[])];
          ambiguity.resolution='replaced';
          ambiguity.replacement=replacement;
          ambiguity.reason='Segmento corregido y convertido en operaciones editables.';
        }else{
          ambiguity.resolution='pending';
          ambiguity.replacement=replacement;
          ambiguity.reason='La corrección todavía no produce una operación verificable.';
        }
      }
    }else{
      if(ambiguity.resolution==='replaced')draft.operations=draft.operations.filter(operation=>operation.meta?.ambiguityId!==ambiguity.id);
      ambiguity.resolution='pending';
      ambiguity.replacement='';
    }
  }
  const resolvedTexts=new Set((draft.ambiguities||[]).filter(item=>['ignore','replaced'].includes(item.resolution)).map(item=>item.text));
  draft.warnings=(draft.warnings||[]).filter(warning=>![...resolvedTexts].some(text=>String(warning).includes(text)));
  const enabled=enabledOperations(draft);
  draft.sections=[{title:'Cambios editados',projectId:'',isNew:false,items:enabled.map(operation=>humanOperation(operation,state))}];
  draft.assumptions=[...(draft.assumptions||[]).filter(item=>item!=='Propuesta ajustada manualmente.'),'Propuesta ajustada manualmente.'];
  draft.summary=`${enabled.length} cambio${enabled.length===1?'':'s'} habilitado${enabled.length===1?'':'s'}. La aplicación seguirá siendo atómica y reversible.`;
  refreshProposal(state,draft);
  return draft;
}
function openProposalEditor(proposalId){
  const state=getState(),entry=state.assistantLog.find(item=>item.proposal?.id===proposalId),proposal=entry?.proposal;
  if(!proposal)return;
  const applied=entry.proposalStatus==='applied';
  const extraProjects=proposal.operations.filter(operation=>operation.collection==='projects'&&operation.type==='create').map(operation=>operation.data);
  const ambiguityEditor=(proposal.ambiguities||[]).length?`<section class="ambiguity-editor"><p class="kicker">VALIDACIÓN DE SEGMENTOS</p><h3>Segmentos no verificables</h3><p>Escribe una versión concreta para volver a interpretarla o marca explícitamente la línea para ignorarla.</p>${proposal.ambiguities.map(item=>`<article class="ambiguity-item"><strong>${esc(item.text)}</strong><small>${esc(item.reason||'No interpretada')}</small><label><span>Texto corregido</span><textarea name="ambiguity_${item.id}_replacement" placeholder="Ej: crea una tarea llamada Comprar adaptador para el viernes">${esc(item.replacement||'')}</textarea></label><label class="ambiguity-ignore"><input type="checkbox" name="ambiguity_${item.id}_ignore" ${item.resolution==='ignore'?'checked':''}><span>Ignorar esta línea explícitamente</span></label></article>`).join('')}</section>`:'';
  const currentBlockers=proposal.validation?.blockers||[];
  const validationSummary=`<div class="proposal-editor-validation" data-editor-validation ${currentBlockers.length?'':'hidden'}>${currentBlockers.map(item=>`<p>${esc(item.message)}</p>`).join('')}</div>`;
  const dialog=document.createElement('dialog');dialog.className='entity-dialog proposal-editor-dialog';
  dialog.innerHTML=`<form><header class="dialog-head"><div><p class="kicker">${applied?'EDIT APPLIED BATCH':'EDIT BEFORE COMMIT'}</p><h2>${applied?'Editar cambios aplicados':'Editar propuesta'}</h2></div><button type="button" data-dialog-cancel aria-label="Cerrar">×</button></header><p class="dialog-note">${applied?'Al guardar, ORBYTE_ actualizará únicamente los elementos de este lote y creará un nuevo deshacer atómico.':'Corrige, habilita o excluye cambios. Nada se escribirá hasta confirmar una propuesta sin bloqueos.'}</p>${validationSummary}${ambiguityEditor}<div class="proposal-editor-list">${proposal.operations.map((operation,index)=>proposalFieldMarkup(operation,index,state,extraProjects)).join('')}</div><footer><button type="button" data-dialog-cancel>Cancelar</button><button class="button acid" type="submit">${applied?'Guardar y actualizar datos':'Guardar propuesta'}</button></footer></form>`;
  document.body.append(dialog);
  const syncHabitScheduleFields=select=>{
    const fieldset=select.closest('.proposal-operation-editor'),type=select.value;
    fieldset?.querySelectorAll('[data-habit-field]').forEach(field=>{
      const kind=field.dataset.habitField;
      field.hidden=kind==='targetCount'?!['timesPerWeek','timesPerMonth'].includes(type):kind==='intervalDays'?type!=='interval':kind==='days'?type!=='daysOfWeek':false;
    });
  };
  dialog.querySelectorAll('[data-habit-schedule-select]').forEach(syncHabitScheduleFields);
  dialog.addEventListener('change',event=>{if(event.target.matches('[data-habit-schedule-select]'))syncHabitScheduleFields(event.target);});
  const close=()=>{dialog.close();dialog.remove();};
  dialog.querySelectorAll('[data-dialog-cancel]').forEach(button=>button.addEventListener('click',close));
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget),draft=proposalDraftFromForm(proposal,form,getState());
    const validationBox=dialog.querySelector('[data-editor-validation]');
    if(applied&&draft.validation.status!=='ready'){
      validationBox.hidden=false;
      validationBox.innerHTML=draft.validation.blockers.map(item=>`<p>${esc(item.message)}</p>`).join('');
      toast('Corrige los bloqueos antes de actualizar datos ya aplicados.');
      return;
    }
    if(!applied){
      update(next=>{const targetEntry=next.assistantLog.find(item=>item.proposal?.id===proposalId);if(targetEntry)targetEntry.proposal=draft;},'Propuesta editada antes de confirmar');
      close();toast(draft.validation.status==='ready'?'Propuesta lista para confirmar':'Propuesta guardada con bloqueos pendientes');
      return;
    }
    const batchId=id('undo');
    let summary='';
    try{
      update(next=>{
        const targetEntry=next.assistantLog.find(item=>item.proposal?.id===proposalId);if(!targetEntry?.application)throw new Error('No existe el recibo de aplicación original');
        const proposalBefore=structuredClone(targetEntry.proposal),applicationBefore=structuredClone(targetEntry.application);
        const receipt=reconcileAppliedOperations(next,targetEntry.application.appliedOperations,enabledOperations(draft),targetEntry.application);
        summary=`Edición posterior: ${draft.summary}`;
        pushUndoBatch(next,{id:batchId,at:new Date().toISOString(),summary,proposalId,kind:'proposal-edit',inverseOperations:receipt.inverseOperations,forwardOperations:receipt.forwardOperations,proposalBefore,applicationBefore});
        targetEntry.proposal=draft;
        targetEntry.proposalStatus='applied';
        targetEntry.appliedBatchId=batchId;
        targetEntry.application={...targetEntry.application,editedAt:new Date().toISOString(),appliedOperations:structuredClone(enabledOperations(draft)),beforeByOperation:receipt.applicationBeforeByOperation};
      },'Propuesta aplicada editada',{source:'assistant',batchId});
    }catch(error){validationBox.hidden=false;validationBox.innerHTML=`<p>${esc(error.message)}</p>`;toast(`No se actualizó: ${error.message}`);return;}
    close();
    addLog({role:'assistant',text:`✎ Aplicación actualizada atómicamente: ${draft.summary}`,source:'kernel',undoBatchId:batchId});
    toast('Datos aplicados actualizados. Puedes deshacer esta edición.');
  });
  dialog.showModal();
}

function suggestionMarkup(suggestion){return`<article class="suggestion ${suggestion.severity}"><div><span class="meta">${esc(suggestion.kind)} / ${esc(suggestion.severity)}</span><h4>${esc(suggestion.title)}</h4><p>${esc(suggestion.explanation)}</p></div><div class="evidence">${suggestion.evidence.map(item=>`<span>${esc(item)}</span>`).join('')}</div><button class="button" data-stage-suggestion="${suggestion.id}">Revisar propuesta</button></article>`;}

function updateChrome(){
  const state=getState(),brief=buildDailyBrief(state),finance=financeSnapshot(state);
  document.body.dataset.route=route;
  nav();
  $('#editionDate').textContent=new Intl.DateTimeFormat('es-CL',{month:'long',year:'numeric'}).format(new Date()).toUpperCase();
  $('#mastheadLead').textContent=`${brief.greeting}, ${state.profile.name}. ${brief.lead}`;
  $('#heroStats').innerHTML=`<div><strong>${brief.plan.focus.length}</strong><span>acciones en foco</span></div><div><strong>${brief.signals.risky.length}</strong><span>proyectos en observación</span></div><div><strong>${money(finance.balance)}</strong><span>balance mensual</span></div>`;
  const status=$('#systemStatus');status.querySelector('span').textContent=state.settings.assistantMode==='hybrid'?'KERNEL + OLLAMA':'KERNEL LOCAL';status.classList.toggle('hybrid',state.settings.assistantMode==='hybrid');
}


function conversationEntryMarkup(entry){
  const body=entry.financeCard
    ? `<p class="finance-chat-lead">Resumen calculado por el kernel. La IA solo aporta una lectura breve y no modifica estas cifras.</p>${financeConversationCard(entry.financeCard)}${entry.text?`<details class="finance-ai-note"><summary>Lectura de ORBYTE_AI</summary><p>${multiline(entry.text)}</p></details>`:''}`
    : `<p>${multiline(entry.text||'')}</p>`;
  return`<article class="terminal-entry ${entry.role||'assistant'} ${entry.pending?'is-pending':''} ${entry.financeCard?'has-finance-card':''}"><div class="entry-meta"><span>${entry.role==='user'?'TÚ':'ORBYTE_AI'}</span>${entry.source?`<small>${sourceLabel(entry.source)}</small>`:''}</div><div class="entry-body">${body}${entry.error?`<details class="assistant-error"><summary>Diagnóstico</summary><code>${esc(entry.error)}</code></details>`:''}${entry.latencyMs?`<small class="assistant-latency">${Math.round(entry.latencyMs/100)/10}s · ${esc(entry.model||'modelo local')}${entry.endpoint?` · ${esc(entry.endpoint)}`:''}${entry.compatibilityMode?` · ${esc(entry.compatibilityMode)}`:''}</small>`:''}${entry.proposal?proposalMarkup(entry.proposal,entry.proposalStatus||'pending'):''}${entry.blockedRequest?blockedRequestMarkup(entry.blockedRequest):''}${entry.undoBatchId&&entry.undoStatus!=='undone'?`<button type="button" class="undo-inline" data-undo-batch="${entry.undoBatchId}">↶ Deshacer lote</button>`:entry.undoStatus==='undone'?'<small class="undo-done">CAMBIO DESHECHO</small>':''}</div></article>`;
}

function renderEdition(){
  const state=getState(),brief=buildDailyBrief(state),warnings=brief.warnings;
  const freshBanner=isWorkspaceEmpty(state)?`<section class="fresh-workspace-banner"><div><p class="kicker">ESPACIO LIMPIO / PRIMER CONTEXTO</p><h3>ORBYTE_ está listo para conocerte desde cero.</h3><p>No hay proyectos, movimientos, hábitos ni conversaciones guardadas. Registra primero los hechos base y confirma cada propuesta antes de aplicarla.</p></div><div class="fresh-workspace-actions"><button class="button acid" data-command="Mi ingreso mensual es de 2200000 y lo recibo el último día hábil de cada mes">Registrar ingreso</button><button class="button" data-command="Crea un proyecto llamado Mi primer proyecto">Crear proyecto</button><button class="button" data-route="terminal">Conversar libremente</button></div></section>`:'';
  $('#appView').innerHTML=`${pageHead('DAILY EDITION / CONTEXT KERNEL','Edición del día','Lo esencial de hoy: foco, alertas y la siguiente decisión.',`<div class="head-actions"><button type="button" class="button" data-route="universe">Abrir radar</button><button type="button" class="button acid" data-command="Explícame la edición del día">Preguntar</button></div>`)}${freshBanner}
  <section class="edition-layout">
    <article class="lead-story"><p class="kicker">${esc(brief.greeting.toUpperCase())} / ${esc(state.profile.name.toUpperCase())}</p><h3>${esc(brief.lead)}</h3><p>${warnings.length?`Hay ${warnings.join(', ')}.`:'El sistema no detecta alertas críticas nuevas.'}</p><div class="edition-actions"><button type="button" class="button acid" data-command="Planifica mi día">Planificar el día</button><button class="button" data-route="terminal">Conversar con ORBYTE_AI</button></div></article>
    <aside class="edition-index"><p class="kicker">INDEX / TODAY</p>${brief.plan.events[0]?`<div><b>${shortDate(brief.plan.events[0].date)}</b><span>${esc(brief.plan.events[0].title)} ${esc(brief.plan.events[0].time||'')}</span></div>`:''}<div><b>${brief.signals.overdue.length}</b><span>acciones vencidas</span></div><div><b>${brief.signals.finance.budgetUse}%</b><span>presupuesto mensual utilizado</span></div><div><b>${brief.plan.habits.length}</b><span>hábitos aún no registrados hoy</span></div></aside>
  </section>
  <section class="home-conversation"><div><p class="kicker">ASK / CONTINUE</p><h3>¿Qué necesitas entender o decidir?</h3><p>ORBYTE_ puede continuar una conversación, cruzar contexto y preparar cambios confirmables.</p></div><form id="homeAsk"><input placeholder="Ej: ¿Qué debería hacer primero y qué puedo posponer?"><button class="button acid">Preguntar</button></form></section>
  <section class="focus-section"><header><p class="kicker">FOCUS / PRIORITY ENGINE</p><h3>Las tres acciones que más mueven el sistema.</h3></header><div class="focus-grid">${brief.plan.focus.map((task,index)=>`<article><span>0${index+1}</span><div><p class="meta">${esc(projectName(state,task.projectId)||orbitName(state,task.orbitId))} / ${priorityLabel(task.priority)}</p><h4>${esc(task.title)}</h4><p>${task.dueDate?`Fecha ${shortDate(task.dueDate)}`:'Sin fecha'} · ${task.estimate||30} min</p></div><button class="check" data-toggle-task="${task.id}" aria-label="Completar"></button></article>`).join('')||'<p class="empty">No hay acciones abiertas para priorizar.</p>'}</div></section>
  <section class="suggestions-section"><header><div><p class="kicker">PROACTIVE ASSISTANT / WHY NOW</p><h3>ORBYTE_ propone; tú confirmas.</h3></div><p>Cada sugerencia incluye evidencia y una operación concreta. La IA generativa nunca escribe directamente en tus datos.</p></header><div class="suggestion-grid">${brief.suggestions.map(suggestionMarkup).join('')||'<p class="empty">No hay propuestas proactivas por ahora.</p>'}</div></section>`;
  $('#homeAsk')?.addEventListener('submit',event=>{event.preventDefault();const input=event.currentTarget.querySelector('input'),text=input.value.trim();if(text){input.value='';run(text);}});
}

function renderTerminal(){
  const state=getState(),snapshot=contextSnapshot(state),suggestions=generateSuggestions(state),entries=state.assistantLog.slice(-50);
  const starters=['¿Qué debería priorizar ahora?','Planifica mi día','¿Cómo van mis proyectos?','Analiza mis gastos'];
  const waiting=assistantBusy;
  const modelLabel=state.settings.assistantMode==='hybrid'?state.settings.ollamaModel:'KERNEL LOCAL';
  const focus=snapshot.focus[0];
  const emptyConversation=isWorkspaceEmpty(state)?`<article class="terminal-empty-state"><p class="kicker">SIN CONTEXTO GUARDADO</p><h3>Empieza contándole a ORBYTE_ tus hechos reales.</h3><p>Por ejemplo: tus ingresos y pagos recurrentes, los proyectos que tienes activos o los hábitos que quieres seguir. Las órdenes se convertirán en propuestas editables antes de guardar.</p><div><button data-command="Mi sueldo mensual es de 2200000">Registrar ingreso</button><button data-command="Pago dividendo de 630000 todos los meses">Registrar gasto fijo</button><button data-command="Crea un proyecto llamado Mi primer proyecto">Crear proyecto</button></div></article>`:'';
  $('#appView').innerHTML=`<section class="conversation-layout"><div class="conversation-main"><header class="conversation-head"><div><p class="kicker">ORBYTE_AI / LOCAL-FIRST</p><h2>Conversar</h2><p>Pregunta, registra o decide. El kernel conserva los hechos; Ollama ayuda a explicarlos.</p></div><div class="ai-presence ${waiting?'is-working':''}" aria-live="polite"><i></i><span>${waiting?'ANALIZANDO':state.settings.assistantMode==='hybrid'?`OLLAMA · ${esc(modelLabel)}`:'KERNEL LOCAL'}</span></div></header><div class="conversation-starters" aria-label="Preguntas sugeridas">${starters.map(command=>`<button type="button" data-command="${esc(command)}" ${waiting?'disabled':''}>${esc(command)}</button>`).join('')}</div><div class="conversation-log-wrap"><div id="terminalLog" class="terminal-log conversation-log" role="log" aria-live="polite" aria-relevant="additions text" aria-busy="${waiting}">${emptyConversation}${entries.map(entry=>conversationEntryMarkup(entry)).join('')}</div><button id="jumpToLatest" class="jump-latest" type="button" hidden>↓ Mensaje más reciente</button></div><form id="terminalForm" class="composer" autocomplete="off"><label class="sr-only" for="terminalInput">Mensaje para ORBYTE_AI</label><textarea id="terminalInput" rows="1" spellcheck="true" enterkeyhint="send" aria-label="Mensaje para ORBYTE_AI" placeholder="Ej: Para PixelPy: crea una tarea… y agrega una nota…" ${waiting?'disabled':''}>${esc(conversationUi.draft)}</textarea><div><span>${waiting?'ORBYTE_AI está respondiendo…':'Enter envía · Shift+Enter crea una línea'}</span><button class="button acid" type="submit" ${waiting?'disabled':''}>${waiting?'PENSANDO…':'ENVIAR'}</button></div></form></div><aside class="decision-rail" aria-label="Contexto actual"><section><p class="kicker">AHORA</p><div class="rail-metric"><b>${esc(focus?.title||'Sin foco definido')}</b><span>${focus?`${focus.estimate||30} min · ${priorityLabel(focus.priority)}`:'No hay acciones abiertas'}</span></div><div class="rail-stats"><div><b>${snapshot.projects.filter(p=>p.risk>=35).length}</b><span>proyectos a revisar</span></div><div><b>${snapshot.overdue.length}</b><span>acciones vencidas</span></div></div></section><section><p class="kicker">SEÑALES</p>${suggestions.slice(0,2).map(item=>`<button class="mini-suggestion" type="button" data-stage-suggestion="${item.id}"><strong>${esc(item.title)}</strong><span>${esc(item.explanation)}</span></button>`).join('')||'<p class="rail-copy">Sin señales urgentes.</p>'}</section><section class="rail-privacy"><p class="kicker">CONTEXTO</p><p class="rail-copy">Solo se comparte con el modelo local la información relacionada con tu pregunta. Los cambios siempre requieren confirmación.</p></section></aside></section>`;

  const log=$('#terminalLog'),input=$('#terminalInput'),jump=$('#jumpToLatest'),form=$('#terminalForm');
  const renderId=++conversationRenderId;
  const resizeComposer=()=>{
    if(!input)return;
    input.style.height='0px';
    input.style.height=`${composerHeight(input.scrollHeight)}px`;
  };
  const updateJump=()=>{
    if(!log||!jump)return;
    const nearEnd=isNearScrollEnd(log);
    conversationUi.scrollTop=log.scrollTop;
    conversationUi.stickToBottom=nearEnd;
    jump.hidden=nearEnd;
  };
  const restoreConversationScroll=()=>{
    if(route!=='terminal'||renderId!==conversationRenderId||!log?.isConnected)return;
    log.scrollTop=conversationScrollTarget({
      forceBottom:conversationUi.forceBottom,
      stickToBottom:conversationUi.stickToBottom,
      scrollTop:conversationUi.scrollTop,
      scrollHeight:log.scrollHeight,
      clientHeight:log.clientHeight
    });
    log.dataset.scrollReady='true';
    updateJump();
  };
  log?.addEventListener('scroll',updateJump,{passive:true});
  jump?.addEventListener('click',()=>{
    conversationUi.forceBottom=true;
    log.scrollTo({top:log.scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    input?.focus({preventScroll:true});
  });
  input?.addEventListener('input',()=>{
    const viewportY=window.scrollY;
    conversationUi.draft=input.value;
    conversationUi.selectionStart=input.selectionStart||0;
    conversationUi.selectionEnd=input.selectionEnd||conversationUi.selectionStart;
    resizeComposer();
    if(window.scrollY!==viewportY)window.scrollTo({top:viewportY,behavior:'auto'});
  });
  input?.addEventListener('keydown',event=>{
    if(shouldSubmitComposerKey(event)){
      event.preventDefault();
      if(!waiting)event.currentTarget.form.requestSubmit();
    }
  });
  form?.addEventListener('submit',event=>{
    event.preventDefault();
    if(waiting)return;
    const text=input.value.trim();
    if(!text)return;
    conversationUi.draft='';
    conversationUi.selectionStart=0;
    conversationUi.selectionEnd=0;
    conversationUi.focusComposer=true;
    conversationUi.forceBottom=true;
    input.value='';
    resizeComposer();
    void run(text);
  });

  // Restore immediately after replacing the chat DOM. State updates can arrive
  // before the next animation frame; without this synchronous pass, a second
  // render would capture the new log at its browser default scrollTop (0).
  resizeComposer();
  restoreConversationScroll();
  requestAnimationFrame(()=>{
    if(route!=='terminal'||renderId!==conversationRenderId||!input?.isConnected)return;
    resizeComposer();
    restoreConversationScroll();
    if(conversationUi.focusComposer&&!waiting&&input){
      input.focus({preventScroll:true});
      const start=Math.min(conversationUi.selectionStart,input.value.length);
      const end=Math.min(conversationUi.selectionEnd,input.value.length);
      input.setSelectionRange(start,end);
    }
    conversationUi.forceBottom=false;
  });
}
function renderUniverse(){
  const state=getState(),signals=attentionSignals(state),projects=state.projects.map(project=>({project,health:projectHealth(state,project)})).sort((a,b)=>b.health.risk-a.health.risk),maxRisk=Math.max(1,...projects.map(item=>item.health.risk));
  const columns=[
    {key:'critical',title:'Actuar ahora',copy:'Riesgo alto, vencimientos o falta de siguiente acción.'},
    {key:'watch',title:'Observar',copy:'Conviene revisar antes de que pierda movimiento.'},
    {key:'moving',title:'En movimiento',copy:'Tiene acciones claras y actividad reciente.'},
    {key:'quiet',title:'En calma',copy:'Sin señales urgentes en este momento.'}
  ];
  $('#appView').innerHTML=`${pageHead('DECISION RADAR / CONTEXTUAL TRIAGE','Radar','Reemplaza el mapa decorativo por una lectura operativa: qué requiere atención, por qué y cuál es el siguiente movimiento.',`<button type="button" class="button acid" data-command="Lee el radar y dime dónde intervenir primero">Conversar sobre el radar</button>`)}<section class="radar-summary"><article><span>Señal dominante</span><b>${projects[0]?esc(projects[0].project.title):'Sin proyectos'}</b><p>${projects[0]?`${projects[0].health.risk}/100 de riesgo · ${projects[0].health.overdue} vencidas`:'No hay señales.'}</p></article><article><span>Capacidad inmediata</span><b>${dailyPlan(state).capacity-dailyPlan(state).used} min</b><p>disponibles en el plan actual</p></article><article><span>Dinero</span><b>${signals.finance.budgetUse}%</b><p>del presupuesto mensual utilizado</p></article><article><span>Próximo evento</span><b>${esc(dailyPlan(state).events[0]?.title||'Sin evento')}</b><p>${dailyPlan(state).events[0]?shortDate(dailyPlan(state).events[0].date):'Agenda despejada'}</p></article></section><section class="radar-board">${columns.map(column=>`<div class="radar-column"><header><p class="kicker">${column.key.toUpperCase()}</p><h3>${column.title}</h3><p>${column.copy}</p></header><div>${projects.filter(item=>item.health.status===column.key).map(({project,health})=>`<article class="radar-card ${health.status}"><div class="radar-card-top"><span>${esc(orbitName(state,project.orbitId))}</span><b>${health.risk}</b></div><h4>${esc(project.title)}</h4><div class="risk-meter"><i style="width:${Math.round(health.risk/maxRisk*100)}%"></i></div><p>${health.nextAction?`Siguiente: ${esc(health.nextAction.title)}`:'Sin próxima acción definida.'}</p><div class="radar-facts"><span>${health.progress}% progreso</span><span>${health.open} abiertas</span><span>${health.overdue} vencidas</span></div><footer><button data-open-project="${project.id}">Abrir mesa</button><button type="button" data-command="Analiza el proyecto ${esc(project.title)} y dime el siguiente paso">Preguntar</button></footer></article>`).join('')||'<p class="empty small">Nada aquí.</p>'}</div></div>`).join('')}</section>`;
}

function renderProjects(){
  const state=getState();
  $('#appView').innerHTML=`${pageHead('SYSTEMS / PROJECT HEALTH','Proyectos','El progreso, el riesgo y la próxima acción se derivan del kernel; no son estados decorativos.',`<button type="button" class="button acid" data-command='Crea proyecto "Nuevo proyecto" en Construir'>Crear desde terminal</button>`)}<div class="project-grid">${state.projects.map(project=>{const health=projectHealth(state,project);return`<article class="project-card ${health.status}"><header><span class="meta">${esc(orbitName(state,project.orbitId))} / ${riskLabel(health.status)}</span><b>${health.risk}/100</b></header><h3>${esc(project.title)}</h3><p>${esc(project.goal||'Sin objetivo descrito.')}</p><div class="progress"><span style="width:${health.progress}%"></span></div><div class="project-metrics"><div><b>${health.progress}%</b><span>progreso</span></div><div><b>${health.open}</b><span>abiertas</span></div><div><b>${health.overdue}</b><span>vencidas</span></div></div><footer><span>${health.nextAction?`Siguiente: ${esc(health.nextAction.title)}`:'Sin próxima acción'}</span><div class="project-actions"><button class="button" data-open-project="${project.id}">Abrir mesa</button><button class="button danger" data-delete-project="${project.id}">Eliminar</button></div></footer></article>`;}).join('')||'<p class="empty">No hay proyectos.</p>'}</div>`;
}

function renderTasks(){
  const state=getState(),plan=dailyPlan(state),today=dateKey();
  const tasks=[...state.tasks].sort((a,b)=>Number(a.done)-Number(b.done)||(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  $('#appView').innerHTML=`${pageHead('ACTIONS / PRIORITY ENGINE','Acciones','La lista muestra contexto, fecha, duración estimada y relación con el sistema.',`<button type="button" class="button acid" data-command="Crea tarea revisar pendientes mañana urgente">Nueva acción</button>`)}<div class="task-summary"><span>${plan.backlog} abiertas</span><span>${state.tasks.filter(t=>!t.done&&t.dueDate&&t.dueDate<today).length} vencidas</span><span>${plan.used}/${plan.capacity} min en el plan</span></div><div class="list">${tasks.map(task=>`<article class="row task-row ${task.done?'is-done':''} ${!task.done&&task.dueDate<today?'is-overdue':''}"><button class="check ${task.done?'done':''}" data-toggle-task="${task.id}"></button><div><h4>${esc(task.title)}</h4><p>${esc(projectName(state,task.projectId)||orbitName(state,task.orbitId))} · ${priorityLabel(task.priority)} · ${task.estimate||30} min</p></div><time>${date(task.dueDate)}</time><button class="button danger" data-delete-task="${task.id}">×</button></article>`).join('')||'<p class="empty">Todo despejado.</p>'}</div>`;
}

function openEntityDialog({kicker='EDIT / LOCAL DATA',title,body,submitLabel='Guardar',onSubmit}){
  const dialog=document.createElement('dialog');dialog.className='entity-dialog';
  dialog.innerHTML=`<form><header class="dialog-head"><div><p class="kicker">${esc(kicker)}</p><h2>${esc(title)}</h2></div><button type="button" data-dialog-cancel aria-label="Cerrar">×</button></header><div class="entity-form-body">${body}</div><footer><button type="button" data-dialog-cancel>Cancelar</button><button class="button acid" type="submit">${esc(submitLabel)}</button></footer></form>`;
  document.body.append(dialog);const close=()=>{dialog.close();dialog.remove();};
  dialog.querySelectorAll('[data-dialog-cancel]').forEach(button=>button.addEventListener('click',close));
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelector('form').addEventListener('submit',event=>{event.preventDefault();onSubmit(new FormData(event.currentTarget));close();});
  dialog.showModal();return dialog;
}
function openHabitEditor(habitId=''){
  const state=getState(),habit=state.habits.find(item=>item.id===habitId),schedule=normalizeSchedule(habit||{}),measurement=normalizeMeasurement(habit||{});
  const days=schedule.days||[];
  openEntityDialog({kicker:'HABIT / FLEXIBLE SCHEDULE',title:habit?'Editar hábito':'Nuevo hábito',body:`<div class="editor-grid"><label class="wide"><span>Nombre</span><input name="title" required value="${esc(habit?.title||'')}"></label><label><span>Frecuencia</span><select name="scheduleType">${[['daily','Todos los días'],['daysOfWeek','Días específicos'],['timesPerWeek','X veces por semana'],['timesPerMonth','X veces por mes'],['interval','Cada X días'],['weekends','Fines de semana'],['flexible','Sin frecuencia fija']].map(([value,label])=>`<option value="${value}" ${schedule.type===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Veces objetivo</span><input name="targetCount" type="number" min="1" value="${schedule.targetCount||1}"></label><label><span>Intervalo en días</span><input name="intervalDays" type="number" min="1" value="${schedule.intervalDays||1}"></label><label><span>Desde</span><input name="startDate" type="date" value="${schedule.startDate||dateKey()}"></label><label><span>Hasta (opcional)</span><input name="endDate" type="date" value="${schedule.endDate||''}"></label><label><span>Pausado hasta (opcional)</span><input name="pauseUntil" type="date" value="${habit?.pauseUntil||''}"></label><div class="wide weekday-editor"><span>Días específicos</span>${[['D',0],['L',1],['M',2],['X',3],['J',4],['V',5],['S',6]].map(([label,value])=>`<label><input type="checkbox" name="days" value="${value}" ${days.includes(value)?'checked':''}><b>${label}</b></label>`).join('')}</div><label><span>Medición</span><select name="measurementType">${[['boolean','Completado'],['minutes','Minutos'],['count','Cantidad'],['repetitions','Repeticiones'],['distance','Distancia'],['volume','Volumen'],['pages','Páginas']].map(([value,label])=>`<option value="${value}" ${measurement.type===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Objetivo</span><input name="measurementTarget" type="number" min="0" step="0.1" value="${measurement.target||1}"></label><label><span>Unidad</span><input name="measurementUnit" value="${esc(measurement.unit||'sesión')}"></label><label><span>Proyecto</span><select name="projectId">${projectOptions(state,habit?.projectId||'')}</select></label><label><span>Órbita</span><select name="orbitId">${orbitOptions(state,habit?.orbitId||'')}</select></label></div>`,onSubmit:form=>{
    const scheduleType=String(form.get('scheduleType')),selectedDays=form.getAll('days').map(Number);
    const scheduleData={type:scheduleType,days:selectedDays,targetCount:Number(form.get('targetCount'))||1,intervalDays:Number(form.get('intervalDays'))||1,startDate:String(form.get('startDate')||dateKey()),endDate:String(form.get('endDate')||'')};
    const targetDays=scheduleType==='daily'?[0,1,2,3,4,5,6]:scheduleType==='weekends'?[0,6]:scheduleType==='daysOfWeek'?selectedDays:[];
    const data={title:String(form.get('title')).trim(),schedule:scheduleData,targetDays,measurement:{type:String(form.get('measurementType')),target:Number(form.get('measurementTarget'))||1,unit:String(form.get('measurementUnit')||'')},projectId:String(form.get('projectId')||''),orbitId:String(form.get('orbitId')||''),pauseUntil:String(form.get('pauseUntil')||''),paused:habit?.paused||false};
    update(next=>{if(habit){Object.assign(next.habits.find(item=>item.id===habitId),data);}else next.habits.push({id:id('h'),...data,history:{},skips:{},createdAt:dateKey()});},habit?'Hábito actualizado':'Hábito creado');toast('Hábito guardado');
  }});
}
function logHabit(habitId,key){
  const habit=getState().habits.find(item=>item.id===habitId);if(!habit)return;const measurement=normalizeMeasurement(habit);
  if(measurement.type==='boolean'){update(state=>{const item=state.habits.find(entry=>entry.id===habitId);if(isCompleted(item,key))delete item.history[key];else item.history[key]=true;if(item.skips)delete item.skips[key];},`Registro de hábito: ${habit.title}`);return;}
  openEntityDialog({kicker:'HABIT / LOG VALUE',title:habit.title,body:`<div class="editor-grid"><label class="wide"><span>${esc(measurement.unit||'Valor')} · objetivo ${measurement.target}</span><input name="value" type="number" min="0" step="0.1" required value="${historyValue(habit,key)||measurement.target}"></label><p class="wide dialog-note">Fecha: ${date(key)}</p></div>`,submitLabel:'Registrar',onSubmit:form=>update(state=>{const item=state.habits.find(entry=>entry.id===habitId);item.history[key]=Number(form.get('value'))||0;if(item.skips)delete item.skips[key];},`Registro de hábito: ${habit.title}`)});
}
function renderHabits(){
  const state=getState(),days=weekDays(habitWeek),today=dateKey();
  const totalStats=state.habits.map(habit=>habitFourWeekStats(habit));
  const adherence=totalStats.length?Math.round(totalStats.reduce((sum,item)=>sum+item.adherence,0)/totalStats.length):0;
  const due=state.habits.filter(habit=>isHabitScheduled(habit,today)&&!isCompleted(habit,today)&&!isSkipped(habit,today)&&!habit.paused).length;
  const rows=state.habits.map(habit=>{
    const week=habitWeekStats(habit,habitWeek),streak=habitStreak(habit),next=nextHabitOpportunity(habit,today),measurement=normalizeMeasurement(habit),temporarilyPaused=habit.paused||Boolean(habit.pauseUntil&&today<=habit.pauseUntil);
    return`<article class="habit-week-row ${temporarilyPaused?'is-paused':''}"><header><div><span class="meta">${esc(projectName(state,habit.projectId)||orbitName(state,habit.orbitId))}</span><h3>${esc(habit.title)}</h3><p>${esc(habitScheduleLabel(habit))} · ${esc(measurementLabel(habit))}</p></div><div class="habit-row-metrics"><span><b>${week.completed}/${week.expected}</b> semana</span><span><b>${habitFourWeekStats(habit).adherence}%</b> adherencia</span><span><b>${streak.value}</b> ${esc(streak.unit)}</span></div><div class="habit-row-actions"><button type="button" data-edit-habit="${habit.id}">Editar</button><button type="button" data-pause-habit="${habit.id}">${habit.paused?'Reanudar':'Pausar'}</button></div></header><div class="habit-week-cells">${days.map(key=>{const completed=isCompleted(habit,key),skipped=isSkipped(habit,key),scheduled=isHabitScheduled(habit,key),future=key>today,value=historyValue(habit,key);return`<button type="button" class="habit-day ${completed?'is-done':skipped?'is-skipped':scheduled?'is-due':'is-optional'} ${key===today?'is-today':''}" data-habit-log="${habit.id}" data-habit-date="${key}" ${future||temporarilyPaused?'disabled':''}><span>${new Intl.DateTimeFormat('es-CL',{weekday:'short'}).format(new Date(`${key}T12:00:00`)).slice(0,2)}</span><b>${String(key).slice(8)}</b><i>${completed?(measurement.type==='boolean'?'✓':value):skipped?'—':scheduled?'○':'·'}</i></button>`;}).join('')}</div><footer><span>${temporarilyPaused?(habit.paused?'Hábito pausado':`Pausado hasta ${shortDate(habit.pauseUntil)}`):next?`Próxima oportunidad: ${shortDate(next)}`:'Sin próxima fecha fija'}</span>${isHabitScheduled(habit,today)&&!isCompleted(habit,today)&&!temporarilyPaused?`<button type="button" data-skip-habit="${habit.id}" data-habit-date="${today}">Omitir hoy con justificación</button>`:''}</footer></article>`;
  }).join('');
  $('#appView').innerHTML=`${pageHead('RITUALS / FAIR SCHEDULES','Hábitos','La adherencia se calcula solo sobre oportunidades reales: un hábito de martes y jueves no falla el miércoles.',`<div class="head-actions"><button class="button" data-habit-week="prev">‹ Semana</button><button class="button" data-habit-week="today">Hoy</button><button class="button" data-habit-week="next">Semana ›</button><button class="button acid" data-edit-habit="">Nuevo hábito</button></div>`)}<section class="habit-summary"><article><span>Semana</span><b>${shortDate(days[0])} — ${shortDate(days[6])}</b></article><article><span>Adherencia 4 semanas</span><b>${adherence}%</b></article><article><span>Pendientes hoy</span><b>${due}</b></article><article><span>Hábitos activos</span><b>${state.habits.filter(habit=>!habit.paused&&!(habit.pauseUntil&&today<=habit.pauseUntil)).length}</b></article></section><section class="habit-week-board"><div class="habit-week-head"><span>Hábito</span>${days.map(key=>`<b class="${key===today?'is-today':''}">${new Intl.DateTimeFormat('es-CL',{weekday:'short',day:'numeric'}).format(new Date(`${key}T12:00:00`))}</b>`).join('')}</div>${rows||'<p class="empty">No hay hábitos. Crea uno con frecuencia diaria, semanal, mensual o flexible.</p>'}</section>`;
}

function renderCalendar(){const state=getState(),items=[...state.events].sort((a,b)=>`${a.date}${a.time||''}`.localeCompare(`${b.date}${b.time||''}`));$('#appView').innerHTML=`${pageHead('TIME / EVENTS','Tiempo','Los eventos comparten contexto con proyectos y órbitas; la terminal puede crearlos y consultarlos.',`<button type="button" class="button acid" data-command="Agenda reunión mañana a las 18:00 para ORBYTE_">Agendar</button>`)}<div class="timeline">${items.map(event=>`<article><time>${shortDate(event.date)}<small>${esc(event.time||'')}</small></time><div><span class="meta">${esc(projectName(state,event.projectId)||orbitName(state,event.orbitId))}</span><h3>${esc(event.title)}</h3></div></article>`).join('')||'<p class="empty">No hay eventos.</p>'}</div>`;}
function openRecurringEditor(ruleId=''){
  const state=getState(),rule=state.recurringTransactions.find(item=>item.id===ruleId)||{type:'expense',description:'',amount:0,category:'',subtype:'fixed',frequency:'monthly',interval:1,day:new Date().getDate(),weekday:new Date().getDay(),startDate:dateKey(),endDate:'',active:true,projectId:'',orbitId:'o_money'};
  const weekdays=[['Domingo',0],['Lunes',1],['Martes',2],['Miércoles',3],['Jueves',4],['Viernes',5],['Sábado',6]];
  openEntityDialog({kicker:'MONEY / RECURRENCE',title:ruleId?'Editar recurrente':'Nuevo recurrente',body:`<div class="editor-grid"><label class="wide"><span>Concepto</span><input name="description" required value="${esc(rule.description)}"></label><label><span>Tipo</span><select name="type"><option value="expense" ${rule.type==='expense'?'selected':''}>Gasto</option><option value="income" ${rule.type==='income'?'selected':''}>Ingreso</option></select></label><label><span>Monto habitual</span><input name="amount" type="number" min="0" required value="${rule.amount||0}"></label><label><span>Categoría</span><input name="category" value="${esc(rule.category||'')}"></label><label><span>Clase</span><select name="subtype"><option value="fixed" ${rule.subtype==='fixed'?'selected':''}>Fijo</option><option value="subscription" ${rule.subtype==='subscription'?'selected':''}>Suscripción</option></select></label><label><span>Frecuencia</span><select name="frequency">${[['weekly','Semanal'],['biweekly','Quincenal'],['monthly','Mensual'],['bimonthly','Cada 2 meses'],['quarterly','Cada 3 meses'],['custom-months','Cada X meses'],['yearly','Anual']].map(([value,label])=>`<option value="${value}" ${rule.frequency===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Intervalo mensual (X)</span><input name="interval" type="number" min="1" max="60" value="${rule.interval||1}"></label><label><span>Día de la semana</span><select name="weekday">${weekdays.map(([label,value])=>`<option value="${value}" ${Number(rule.weekday)===value?'selected':''}>${label}</option>`).join('')}</select></label><label><span>Día del mes</span><input name="day" type="number" min="1" max="31" value="${rule.day||1}"></label><label><span>Regla de día</span><select name="dayRule"><option value="" ${!rule.dayRule?'selected':''}>Día indicado</option><option value="last-day" ${rule.dayRule==='last-day'?'selected':''}>Último día</option><option value="last-business-day" ${rule.dayRule==='last-business-day'?'selected':''}>Último día hábil</option></select></label><label><span>Inicio</span><input name="startDate" type="date" value="${rule.startDate||dateKey()}"></label><label><span>Término (opcional)</span><input name="endDate" type="date" value="${rule.endDate||''}"></label><label><span>Proyecto</span><select name="projectId">${projectOptions(state,rule.projectId||'')}</select></label><label><span>Órbita</span><select name="orbitId">${orbitOptions(state,rule.orbitId||'')}</select></label><p class="wide dialog-note">Las ocurrencias son proyecciones. El movimiento real solo se registra al marcarlo como pagado o recibido.</p></div>`,onSubmit:form=>{
    const data=Object.fromEntries(form);data.amount=Number(data.amount)||0;data.day=Number(data.day)||1;data.weekday=Number(data.weekday)||0;data.interval=Math.max(1,Number(data.interval)||1);data.businessDay=data.dayRule==='last-business-day'?'last':'';data.active=rule.active!==false;data.createdAt=rule.createdAt||dateKey();
    update(next=>{if(ruleId)Object.assign(next.recurringTransactions.find(item=>item.id===ruleId),data);else next.recurringTransactions.push({id:id('rt'),...data});},ruleId?'Recurrente actualizado':'Recurrente creado');toast('Recurrente guardado');
  }});
}
function openBudgetEditor(){
  const state=getState();
  openEntityDialog({kicker:'MONEY / LIMITS',title:'Nuevo presupuesto',body:`<div class="editor-grid"><label><span>Alcance</span><select name="scope"><option value="category">Categoría</option><option value="project">Proyecto</option></select></label><label><span>Tipo de límite</span><select name="mode"><option value="flexible">Flexible · solo avisa</option><option value="strict">Estricto · riesgo alto al exceder</option></select></label><label><span>Categoría</span><input name="category" placeholder="Alimentación"></label><label><span>Proyecto</span><select name="projectId">${projectOptions(state,'')}</select></label><label><span>Monto</span><input name="amount" type="number" min="0" required></label><label><span>Aplicación</span><select name="period"><option value="ongoing">Todos los meses</option><option value="month">Solo ${esc(monthLabel(financeMonth))}</option></select></label></div>`,onSubmit:form=>{const scope=String(form.get('scope')),reference=scope==='project'?String(form.get('projectId')):String(form.get('category')).trim();if(!reference){toast('Falta categoría o proyecto');return;}const project=state.projects.find(item=>item.id===reference);update(next=>next.budgets.push({id:id('b'),scope,reference,label:scope==='project'?(project?.title||'Proyecto'):reference,amount:Number(form.get('amount'))||0,mode:String(form.get('mode')||'flexible'),month:form.get('period')==='month'?financeMonth:'',active:true}),'Presupuesto creado');toast('Presupuesto guardado');}});
}
function openInstallmentEditor(){
  const state=getState();
  openEntityDialog({kicker:'MONEY / INSTALLMENTS',title:'Registrar compra en cuotas',body:`<div class="editor-grid"><label class="wide"><span>Compra</span><input name="description" required></label><label><span>Total</span><input name="totalAmount" type="number" min="0" required></label><label><span>Número de cuotas</span><input name="installments" type="number" min="2" required value="3"></label><label><span>Primera cuota</span><input name="firstDate" type="date" required value="${dateKey()}"></label><label><span>Categoría</span><input name="category" value="Compras"></label><label><span>Proyecto</span><select name="projectId">${projectOptions(state,'')}</select></label></div>`,onSubmit:form=>{const total=Number(form.get('totalAmount'))||0,count=Number(form.get('installments'))||1,projectId=String(form.get('projectId')||''),project=state.projects.find(item=>item.id===projectId);update(next=>next.installmentPlans.push({id:id('ip'),type:'expense',description:String(form.get('description')),totalAmount:total,installments:count,installmentAmount:Math.round(total/count),firstDate:String(form.get('firstDate')),category:String(form.get('category')),projectId,orbitId:project?.orbitId||'o_money',active:true,createdAt:dateKey()}),'Plan de cuotas creado');}});
}

function financeCardData(state,month=monthKey()){
  const ledger=financeMonthLedger(state,month);
  const globalBudget=ledger.budgets.find(row=>row.id==='global');
  const budgetAmount=Number(globalBudget?.amount||state.settings.monthlyBudget)||0;
  const budgetUse=budgetAmount?Math.round(ledger.actualExpense/budgetAmount*100):0;
  const categories=Object.entries(ledger.byCategory).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([label,amount])=>({label,amount,share:ledger.actualExpense?Math.round(amount/ledger.actualExpense*100):0}));
  const pending=ledger.timeline.filter(item=>item.status==='pending'&&item.type==='expense').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).slice(0,4).map(item=>({description:item.description,date:item.date,amount:Number(item.amount)||0,kind:item.ledgerKind}));
  const recent=[...ledger.actual].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,4).map(item=>({description:item.description,date:item.date,amount:Number(item.amount)||0,type:item.type,category:item.category||'Otros'}));
  return{version:1,month:ledger.month,actualIncome:ledger.actualIncome,actualExpense:ledger.actualExpense,confirmedResult:ledger.realBalance,projectedIncome:ledger.projectedIncome,pendingCommitments:ledger.pendingCommitments,variableAssumption:ledger.variableAssumption,projectedResult:ledger.projectedAfterAssumptions,budgetAmount,budgetUse,categories,pending,recent,generatedAt:new Date().toISOString()};
}
function financeTone(value){return Number(value)<0?'negative':Number(value)>0?'positive':'neutral';}
function financeConversationCard(data){
  const maxCategory=Math.max(1,...(data.categories||[]).map(item=>Number(item.amount)||0));
  const budgetWidth=Math.min(100,Math.max(0,Number(data.budgetUse)||0));
  return`<section class="assistant-finance-card" aria-label="Resumen financiero de ${esc(monthLabel(data.month))}"><header><div><span>FINANZAS / ${esc(monthLabel(data.month).toUpperCase())}</span><h3>Estado del mes</h3></div><strong class="${financeTone(data.projectedResult)}">${data.projectedResult<0?'RIESGO':data.projectedResult>0?'POSITIVO':'NEUTRO'}</strong></header><div class="assistant-finance-balance"><span>Resultado confirmado</span><b class="${financeTone(data.confirmedResult)}">${money(data.confirmedResult)}</b><small>${money(data.actualIncome)} recibidos − ${money(data.actualExpense)} pagados</small></div><div class="assistant-finance-metrics"><article><span>Compromisos</span><b>${money(data.pendingCommitments)}</b></article><article><span>Cierre proyectado</span><b class="${financeTone(data.projectedResult)}">${money(data.projectedResult)}</b></article><article><span>Presupuesto usado</span><b>${data.budgetUse}%</b></article></div>${data.budgetAmount?`<div class="assistant-budget-meter"><div><span>Presupuesto mensual</span><strong>${money(data.actualExpense)} de ${money(data.budgetAmount)}</strong></div><i><b style="width:${budgetWidth}%"></b></i></div>`:''}${data.categories?.length?`<div class="assistant-finance-categories"><span>Principales categorías</span>${data.categories.map(item=>`<div><b>${esc(item.label)}</b><i><span style="width:${Math.round(item.amount/maxCategory*100)}%"></span></i><strong>${money(item.amount)}</strong></div>`).join('')}</div>`:''}<footer><button type="button" class="button acid" data-open-finance="overview" data-finance-card-month="${esc(data.month)}">Abrir panel de dinero</button><button type="button" class="button" data-open-finance="projection" data-finance-card-month="${esc(data.month)}">Ver proyección</button></footer></section>`;
}
function financeRows(state,items,emptyText){return items.length?items.map(item=>financeTimelineRow(state,item)).join(''):`<p class="empty small">${esc(emptyText)}</p>`;}

function financeTimelineRow(state,item){
  const type=item.type||item.rule?.type||'expense',project=projectName(state,item.projectId)||orbitName(state,item.orbitId),projected=item.status==='pending'||item.projected;
  const status=item.ledgerKind==='actual'?'Confirmado':item.status==='skipped'?'Omitido':item.ledgerKind==='installment'?`Cuota ${item.installmentNumber}/${item.plan.installments}`:item.ledgerKind==='recurring'?'Recurrente pendiente':item.ledgerKind==='goal'?'Objetivo':'Planificado';
  let actions='';
  if(item.ledgerKind==='recurring'&&item.status==='pending')actions=`<button data-confirm-recurring="${item.recurrenceId}" data-occurrence="${item.occurrenceKey}">${type==='income'?'Recibido':'Pagado'}</button><button data-skip-recurring="${item.recurrenceId}" data-occurrence="${item.occurrenceKey}">Omitir</button>`;
  if(item.ledgerKind==='installment'&&item.status==='pending')actions=`<button data-confirm-installment="${item.installmentPlanId}" data-installment-number="${item.installmentNumber}" data-occurrence="${item.occurrenceKey}">Confirmar cuota</button>`;
  return`<article class="finance-flow-row ${projected?'is-projected':'is-actual'} ${item.status==='skipped'?'is-skipped':''}"><span class="tx-icon ${type}">${type==='income'?'↗':'↘'}</span><div><h4>${esc(item.description)}</h4><p>${esc(item.category||'Otros')} · ${esc(project||'Sin vínculo')} · <b>${status}</b></p></div><time>${shortDate(item.date)}</time><strong>${type==='income'?'+':'−'}${money(item.amount)}</strong>${actions?`<div class="row-actions">${actions}</div>`:''}</article>`;
}
function renderFinance(){
  const state=getState(),ledger=financeMonthLedger(state,financeMonth),projection=financeProjection(state,financeMonth,state.financeSettings.projectionMonths||6),review=financeMonthReview(state,financeMonth),candidates=detectRecurringCandidates(state);
  const tabs=[['overview','Resumen'],['recurring','Recurrentes'],['projection','Proyección'],['review','Cierre mensual']];
  let content='';
  if(financeTab==='overview'){
    const categories=Object.entries(ledger.byCategory).sort((a,b)=>b[1]-a[1]);
    const actualItems=ledger.timeline.filter(item=>item.ledgerKind==='actual').sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    const pendingItems=ledger.timeline.filter(item=>item.status==='pending'&&item.type==='expense').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
    const globalBudget=ledger.budgets.find(row=>row.id==='global');
    const budgetAmount=Number(globalBudget?.amount||state.settings.monthlyBudget)||0;
    const budgetUse=budgetAmount?Math.round(ledger.actualExpense/budgetAmount*100):0;
    const budgetRemaining=budgetAmount-ledger.actualExpense;
    const projectedDelta=ledger.projectedAfterAssumptions-ledger.realBalance;
    const commitmentAfterIncome=Math.max(0,ledger.pendingCommitments-ledger.projectedIncome);
    const maxCategory=Math.max(1,...categories.map(([,value])=>value));
    content=`<section class="finance-dashboard">
      <section class="finance-hero-panel">
        <article class="finance-confirmed-hero ${financeTone(ledger.realBalance)}"><p class="kicker">HECHOS CONFIRMADOS</p><span>Resultado del mes</span><h3>${money(ledger.realBalance)}</h3><p>No es el saldo de tu cuenta: es el resultado de los movimientos confirmados de ${esc(monthLabel(financeMonth))}.</p><div class="finance-equation"><div><small>Ingresos recibidos</small><b>${money(ledger.actualIncome)}</b></div><i>−</i><div><small>Gastos pagados</small><b>${money(ledger.actualExpense)}</b></div><i>=</i><div><small>Resultado confirmado</small><b>${money(ledger.realBalance)}</b></div></div></article>
        <aside class="finance-projected-hero ${financeTone(ledger.projectedAfterAssumptions)}"><p class="kicker">CIERRE PROYECTADO</p><span>Al terminar el mes</span><h3>${money(ledger.projectedAfterAssumptions)}</h3><dl><div><dt>Ingresos por recibir</dt><dd>+${money(ledger.projectedIncome)}</dd></div><div><dt>Compromisos pendientes</dt><dd>−${money(ledger.pendingCommitments)}</dd></div><div><dt>Gasto variable estimado</dt><dd>−${money(ledger.variableAssumption)}</dd></div></dl><p class="finance-projected-change ${financeTone(projectedDelta)}">${projectedDelta>=0?'Mejora':'Baja'} ${money(Math.abs(projectedDelta))} frente al resultado confirmado.</p><button type="button" class="button" data-finance-tab="projection">Abrir proyección completa</button></aside>
      </section>
      <section class="finance-kpi-strip">
        <article><span>Compromiso neto restante</span><b>${money(commitmentAfterIncome)}</b><small>compromisos menos ingresos pendientes</small></article>
        <article><span>Presupuesto consumido</span><b>${budgetUse}%</b><small>${budgetAmount?`${money(Math.max(0,budgetRemaining))} aún disponibles`:'configura un presupuesto mensual'}</small></article>
        <article><span>Gasto variable estimado</span><b>${money(ledger.variableAssumption)}</b><small>promedio histórico aún no ejecutado</small></article>
        <article><span>Movimientos confirmados</span><b>${ledger.actual.length}</b><small>${actualItems.filter(item=>item.type==='income').length} ingresos · ${actualItems.filter(item=>item.type==='expense').length} gastos</small></article>
      </section>
      <section class="finance-focus-grid">
        <article class="finance-list-panel"><header class="section-line"><div><p class="kicker">YA OCURRIÓ</p><h3>Últimos movimientos</h3><p>Solo ingresos y gastos confirmados.</p></div><span class="finance-total-chip">${money(ledger.actualExpense)} gastados</span></header><div class="finance-flow">${financeRows(state,actualItems.slice(0,6),'No hay movimientos confirmados en este mes.')}</div>${actualItems.length>6?`<details class="finance-more"><summary>Mostrar ${actualItems.length-6} movimientos anteriores</summary><div class="finance-flow">${financeRows(state,actualItems.slice(6),'')}</div></details>`:''}</article>
        <article class="finance-list-panel pending"><header class="section-line"><div><p class="kicker">AÚN FALTA</p><h3>Próximos compromisos</h3><p>Cuotas, recurrentes y compras planificadas.</p></div><span class="finance-total-chip projected">${money(ledger.pendingCommitments)}</span></header><div class="finance-flow">${financeRows(state,pendingItems.slice(0,6),'No quedan compromisos pendientes en este mes.')}</div>${pendingItems.length>6?`<details class="finance-more"><summary>Mostrar ${pendingItems.length-6} compromisos adicionales</summary><div class="finance-flow">${financeRows(state,pendingItems.slice(6),'')}</div></details>`:''}</article>
      </section>
      <section class="finance-breakdown-grid">
        <article class="finance-breakdown-card"><header><div><p class="kicker">DÓNDE SE FUE</p><h3>Gasto por categoría</h3></div><b>${money(ledger.actualExpense)}</b></header><div class="finance-category-list">${categories.map(([category,value])=>`<div><div><span>${esc(category)}</span><strong>${money(value)}</strong></div><i><b style="width:${Math.round(value/maxCategory*100)}%"></b></i><small>${ledger.actualExpense?Math.round(value/ledger.actualExpense*100):0}% del gasto confirmado</small></div>`).join('')||'<p class="empty small">Aún no hay gastos confirmados.</p>'}</div></article>
        <article class="finance-breakdown-card"><header><div><p class="kicker">LÍMITES</p><h3>Presupuestos</h3></div><button type="button" data-add-budget aria-label="Crear presupuesto">+</button></header><div class="finance-budget-list">${ledger.budgets.map(row=>`<article class="budget-row"><div><b>${esc(row.label)}</b><span>${money(row.spent)} de ${money(row.amount)}</span></div><i><b style="width:${Math.min(100,row.use)}%"></b></i><footer><small>${row.id==='global'?'GENERAL':row.mode==='strict'?'ESTRICTO':'FLEXIBLE'}${row.month?` · ${esc(monthLabel(row.month))}`:''}</small><strong class="${row.use>100?'over':''}">${row.use}%</strong>${row.id!=='global'?`<button data-delete-budget="${row.id}" aria-label="Eliminar presupuesto">×</button>`:''}</footer></article>`).join('')||'<p class="empty small">No hay presupuestos configurados.</p>'}</div></article>
      </section>
    </section>`;
  } else if(financeTab==='recurring'){
    content=`<section class="finance-management"><header class="section-line"><div><p class="kicker">RECURRENCIAS / FIJOS + SUSCRIPCIONES</p><h3>Compromisos automáticos</h3><p>Las reglas generan ocurrencias proyectadas; solo pasan a movimientos reales cuando las confirmas.</p></div><button class="button acid" data-edit-recurring="">Nuevo recurrente</button></header><div class="recurring-grid">${state.recurringTransactions.map(rule=>`<article class="recurring-card ${rule.active===false?'is-paused':''}"><span class="meta">${rule.type==='income'?'INGRESO':'GASTO'} / ${rule.subtype==='subscription'?'SUSCRIPCIÓN':'FIJO'}</span><h3>${esc(rule.description)}</h3><b>${money(rule.amount)}</b><p>${esc(recurrenceLabel(rule))} · próximo ${shortDate(nextRecurringDate(rule))} · ${esc(projectName(state,rule.projectId)||orbitName(state,rule.orbitId))}</p><footer><button data-edit-recurring="${rule.id}">Editar</button><button data-toggle-recurring="${rule.id}">${rule.active===false?'Activar':'Pausar'}</button><button data-delete-recurring="${rule.id}">Eliminar</button></footer></article>`).join('')||'<p class="empty">No hay reglas recurrentes.</p>'}</div>${candidates.length?`<section class="recurrence-candidates"><p class="kicker">DETECTADOS / REQUIEREN CONFIRMACIÓN</p><h3>Posibles recurrentes</h3>${candidates.map(item=>`<article><div><b>${esc(item.description)}</b><span>${money(item.amount)} · detectado en ${item.months} meses</span></div><button data-convert-recurring="${item.id}">Convertir</button></article>`).join('')}</section>`:''}</section>`;
  } else if(financeTab==='projection'){
    content=`<section class="projection-layout"><header class="section-line"><div><p class="kicker">PROYECCIÓN / ${state.financeSettings.projectionMonths||6} MESES</p><h3>Qué está confirmado, comprometido y estimado.</h3><p>La estimación variable usa el promedio de ${state.financeSettings.averageWindow||3} meses anteriores y siempre se muestra por separado.</p></div><div class="head-actions"><button class="button" data-add-installment>Agregar cuotas</button><button class="button acid" data-command="Para septiembre quiero comprar un SSD de 120000 para ORBYTE_">Planificar compra</button></div></header><div class="projection-table"><div class="projection-head"><span>Mes</span><span>Ingresos</span><span>Compromisos</span><span>Variable estimado</span><span>Cierre proyectado</span></div>${projection.map(row=>`<article><b>${esc(monthLabel(row.month))}</b><span>${money(row.income)}</span><span>${money(row.expense)}</span><span>${money(row.variableAssumption)}</span><strong class="${row.balance<0?'negative':''}">${money(row.balance)}</strong></article>`).join('')}</div><div class="finance-two-col compact"><section><p class="kicker">CUOTAS</p><h3>Planes activos</h3>${state.installmentPlans.map(plan=>`<article class="commitment-row"><div><b>${esc(plan.description)}</b><span>${plan.installments} cuotas · ${money(plan.installmentAmount)} · total ${money(plan.totalAmount)}</span></div><button data-delete-installment="${plan.id}">Eliminar</button></article>`).join('')||'<p class="empty small">Sin compras en cuotas.</p>'}</section><section><p class="kicker">OBJETIVOS</p><h3>Metas financieras</h3>${state.financialGoals.map(goal=>`<article class="commitment-row"><div><b>${esc(goal.title)}</b><span>${money(goal.amount)} · ${shortDate(goal.targetDate)} · ${esc(projectName(state,goal.projectId)||'Sin proyecto')}</span></div><button data-complete-goal="${goal.id}">${goal.status==='completed'?'Completado':'Completar'}</button></article>`).join('')||'<p class="empty small">Sin objetivos.</p>'}</section></div></section>`;
  } else {
    content=`<section class="month-review"><header><p class="kicker">CIERRE MENSUAL / ${esc(monthLabel(review.month).toUpperCase())}</p><h3>Qué pasó y qué viene.</h3></header><div class="review-numbers"><article><span>Ingresos</span><b>${money(review.income)}</b></article><article><span>Gastos</span><b>${money(review.expense)}</b></article><article><span>Resultado</span><b>${money(review.balance)}</b></article><article><span>Tasa de ahorro</span><b>${review.savingsRate}%</b></article></div><div class="review-insights">${review.insights.map((insight,index)=>`<article><span>0${index+1}</span><p>${esc(insight)}</p></article>`).join('')}</div><button class="button acid" data-save-month-review="${review.month}">Guardar cierre mensual</button></section>`;
  }
  $('#appView').innerHTML=`${pageHead('MONEY / CONTROL CENTER','Dinero','Los totales los calcula el kernel. La IA queda como lectura opcional y nunca reemplaza los valores del panel.',`<div class="month-switcher"><button data-finance-month="prev" aria-label="Mes anterior">‹</button><button data-finance-month="today">${esc(monthLabel(financeMonth))}</button><button data-finance-month="next" aria-label="Mes siguiente">›</button><button class="button" data-command="Analiza mis finanzas de este mes en tres observaciones breves">Preguntar</button><button class="button acid" data-edit-recurring="">+ Recurrente</button></div>`)}<nav class="section-tabs">${tabs.map(([value,label])=>`<button class="${financeTab===value?'is-active':''}" data-finance-tab="${value}">${label}</button>`).join('')}</nav>${content}`;
}

function renderWorkbench(){
  const state=getState(),project=state.projects.find(item=>item.id===selectedProjectId)||state.projects[0];if(!project){$('#appView').innerHTML='<p class="empty">No hay proyectos.</p>';return;}selectedProjectId=project.id;const health=projectHealth(state,project),tasks=state.tasks.filter(item=>item.projectId===project.id),notes=state.notes.filter(item=>item.projectId===project.id),events=state.events.filter(item=>item.projectId===project.id),transactions=state.transactions.filter(item=>item.projectId===project.id),spent=transactions.filter(item=>item.type==='expense').reduce((sum,item)=>sum+item.amount,0);
  $('#appView').innerHTML=`${pageHead(`WORKBENCH / ${esc(orbitName(state,project.orbitId).toUpperCase())}`,esc(project.title),esc(project.goal||'Mesa contextual del proyecto.'),`<select id="projectPicker">${state.projects.map(item=>`<option value="${item.id}" ${item.id===project.id?'selected':''}>${esc(item.title)}</option>`).join('')}</select>`)}<section class="workbench-grid"><article class="project-brief ${health.status}"><span class="meta">HEALTH / ${riskLabel(health.status)}</span><div class="health-score"><b>${health.risk}</b><span>riesgo / 100</span></div><div class="progress"><span style="width:${health.progress}%"></span></div><dl><div><dt>Progreso</dt><dd>${health.progress}%</dd></div><div><dt>Próxima acción</dt><dd>${esc(health.nextAction?.title||'No definida')}</dd></div><div><dt>Fecha objetivo</dt><dd>${date(project.dueDate)}</dd></div><div><dt>Presupuesto</dt><dd>${money(project.budget)}</dd></div><div><dt>Gastado</dt><dd>${money(spent)}</dd></div></dl><button type="button" class="button acid" data-command="Resume el proyecto ${esc(project.title)}">Preguntar a ORBYTE_AI</button></article><div class="workbench-columns"><section><header><p class="kicker">ACTIONS / ${tasks.filter(t=>!t.done).length} OPEN</p><button type="button" data-command="Crea tarea para ${esc(project.title)} mañana">+</button></header>${tasks.map(task=>`<article class="mini-row"><button class="check ${task.done?'done':''}" data-toggle-task="${task.id}"></button><div><b>${esc(task.title)}</b><span>${date(task.dueDate)}</span></div></article>`).join('')||'<p class="empty small">Sin acciones.</p>'}</section><section><header><p class="kicker">NOTES / CONTEXT</p><button type="button" data-command="Anota una idea para ${esc(project.title)}">+</button></header>${notes.map(note=>`<article class="note"><span>${esc(note.title)}</span><p>${esc(note.content)}</p></article>`).join('')||'<p class="empty small">Sin notas.</p>'}</section><section><header><p class="kicker">TIME + MONEY</p></header>${events.map(event=>`<article class="mini-row"><time>${shortDate(event.date)}</time><div><b>${esc(event.title)}</b><span>${esc(event.time||'')}</span></div></article>`).join('')}${transactions.map(tx=>`<article class="mini-row"><span>${tx.type==='income'?'↗':'↘'}</span><div><b>${esc(tx.description)}</b><span>${money(tx.amount)}</span></div></article>`).join('')||'<p class="empty small">Sin eventos ni movimientos.</p>'}</section></div></section>`;
  $('#projectPicker')?.addEventListener('change',event=>navigate('workbench',event.target.value));
}

function renderReview(){
  const state=getState(),latestUndo=state.undoBatches[0];
  $('#appView').innerHTML=`${pageHead('AUDIT / CHANGES + ASSETS','Registro','Todo cambio confirmado deja una huella legible. Los lotes recientes pueden revertirse sin afectar operaciones anteriores.')}<section class="review-actions">${latestUndo?`<article class="undo-card"><div><p class="kicker">LAST ATOMIC CHANGE</p><h3>${esc(latestUndo.summary)}</h3><span>${new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(latestUndo.at))}</span></div><button class="button acid" data-undo-batch="${latestUndo.id}">↶ Deshacer último lote</button></article>`:'<article class="undo-card is-empty"><p>No hay lotes recientes disponibles para deshacer.</p></article>'}</section><section class="review-grid"><div><p class="kicker">RECENT ACTIVITY</p><div class="activity-list">${state.activity.slice(0,30).map(item=>`<article><time>${new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(item.at))}</time><p>${esc(item.message)}</p></article>`).join('')||'<p class="empty small">Sin cambios.</p>'}</div></div><div><p class="kicker">CONNECTED INVENTORY</p><div class="asset-list">${state.assets.map(asset=>`<article><span class="meta">${esc(asset.category)} / ${shortDate(asset.purchasedAt)}</span><h3>${esc(asset.title)}</h3><p>${asset.quantity>1?`${asset.quantity} unidades · ${money(asset.unitAmount||Math.round(asset.amount/asset.quantity))} c/u · `:''}${money(asset.amount)} total · ${esc(projectName(state,asset.projectId)||orbitName(state,asset.orbitId)||'Sin vínculo')}</p></article>`).join('')||'<p class="empty small">Registra una compra desde la terminal para crear inventario conectado.</p>'}</div></div></section><section class="saved-reviews"><header><p class="kicker">MONTHLY CLOSES</p><h3>Revisiones guardadas</h3></header>${state.monthReviews.map(review=>`<article><div><b>${esc(monthLabel(review.month))}</b><span>Guardado ${shortDate(String(review.savedAt||'').slice(0,10))}</span></div><div><span>Ingresos ${money(review.income)}</span><span>Gastos ${money(review.expense)}</span><strong>${money(review.balance)}</strong></div></article>`).join('')||'<p class="empty small">Guarda el cierre desde Dinero → Revisión.</p>'}</section>`;
}

function openFreshStartDialog(){
  const state=getState(),counts=workspaceCounts(state);
  const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
  const dialog=document.createElement('dialog');dialog.className='entity-dialog fresh-start-dialog';
  dialog.innerHTML=`<form><header class="dialog-head"><div><p class="kicker">DANGER ZONE / LOCAL DATA</p><h2>Empezar desde cero</h2></div><button type="button" data-dialog-cancel aria-label="Cerrar">×</button></header><div class="entity-form-body"><section class="fresh-start-warning"><strong>Esta limpieza no se puede deshacer desde ORBYTE_.</strong><p>Se eliminarán proyectos, acciones, hábitos, calendario, finanzas, notas, inventario, conversaciones, historial y lotes de deshacer.</p></section><div class="fresh-start-counts"><div><b>${counts.projects}</b><span>proyectos</span></div><div><b>${counts.tasks}</b><span>acciones</span></div><div><b>${counts.habits}</b><span>hábitos</span></div><div><b>${counts.events}</b><span>eventos</span></div><div><b>${counts.finance}</b><span>registros financieros</span></div><div><b>${counts.context+counts.history}</b><span>contexto e historial</span></div></div><section class="fresh-start-kept"><p class="kicker">SE CONSERVA</p><p>Tu nombre, idioma, moneda, configuración de Ollama, minutos de foco, supuestos de proyección y las cuatro órbitas base. El presupuesto mensual queda en $0.</p></section><div class="fresh-start-backup"><div><strong>${total?`${total} registros locales serán eliminados.`:'El espacio ya está vacío.'}</strong><span>Puedes exportar un respaldo JSON antes de continuar.</span></div><button type="button" class="button" data-export-before-clean>Exportar respaldo</button></div><label class="fresh-start-confirm"><span>Escribe <b>BORRAR TODO</b> para confirmar</span><input name="confirmation" autocomplete="off" spellcheck="false" placeholder="BORRAR TODO"></label></div><footer><button type="button" data-dialog-cancel>Cancelar</button><button class="button danger" type="submit" disabled>Eliminar datos y comenzar</button></footer></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),input=form.elements.confirmation,submit=form.querySelector('button[type="submit"]');
  const close=()=>{dialog.close();dialog.remove();};
  dialog.querySelectorAll('[data-dialog-cancel]').forEach(button=>button.addEventListener('click',close));
  dialog.querySelector('[data-export-before-clean]').addEventListener('click',exportData);
  input.addEventListener('input',()=>{submit.disabled=input.value.trim()!=='BORRAR TODO';});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(input.value.trim()!=='BORRAR TODO')return;
    startFresh();
    selectedProjectId='';financeMonth=monthKey();financeTab='overview';habitWeek=weekStart();
    Object.assign(conversationUi,{draft:'',scrollTop:0,stickToBottom:true,focusComposer:false,forceBottom:false,selectionStart:0,selectionEnd:0});
    close();navigate('edition');toast('ORBYTE_ quedó limpio y listo para empezar desde cero');
  });
  dialog.showModal();input.focus();
}

function renderSettings(){
  const state=getState();
  $('#appView').innerHTML=`${pageHead('SYSTEM / LOCAL-FIRST','Ajustes','El kernel funciona siempre sin conexión. Ollama es opcional y solo mejora explicaciones; nunca modifica datos directamente.')}<section class="settings-grid"><form id="assistantSettings" class="settings-card"><p class="kicker">ASSISTANT MODE</p><h3>IA híbrida local</h3><label><span>Modo</span><select name="assistantMode"><option value="local" ${state.settings.assistantMode==='local'?'selected':''}>Solo kernel local</option><option value="hybrid" ${state.settings.assistantMode==='hybrid'?'selected':''}>Kernel + Ollama</option></select></label><label><span>URL local de Ollama</span><input name="ollamaUrl" value="${esc(state.settings.ollamaUrl)}" spellcheck="false"></label><label><span>Modelo instalado</span><select id="ollamaModel" name="ollamaModel"><option value="${esc(state.settings.ollamaModel)}" selected>${esc(state.settings.ollamaModel)}</option></select></label><div id="ollamaModelMeta" class="model-meta"><span>DETECCIÓN AUTOMÁTICA</span><p>Consultando modelos instalados y sus capacidades…</p></div><div class="settings-actions"><button class="button acid" type="submit">Guardar</button><button class="button" type="button" id="refreshOllamaModels">Actualizar modelos</button><button class="button" type="button" id="testOllama">Probar modelo</button></div><output id="ollamaResult" aria-live="polite"></output></form><form id="systemSettings" class="settings-card"><p class="kicker">PERSONAL KERNEL</p><h3>Capacidad y presupuesto</h3><label><span>Nombre</span><input name="profileName" value="${esc(state.profile.name)}"></label><label><span>Minutos de foco diarios</span><input name="workdayMinutes" type="number" min="30" max="900" value="${state.settings.workdayMinutes}"></label><label><span>Presupuesto mensual CLP</span><input name="monthlyBudget" type="number" min="0" value="${state.settings.monthlyBudget}"></label><button class="button acid">Guardar</button></form><form id="financeSettings" class="settings-card"><p class="kicker">MONEY / PROJECTION</p><h3>Supuestos financieros</h3><label><span>Meses de proyección</span><input name="projectionMonths" type="number" min="1" max="24" value="${state.financeSettings.projectionMonths||6}"></label><label><span>Meses para promedio variable</span><input name="averageWindow" type="number" min="1" max="12" value="${state.financeSettings.averageWindow||3}"></label><p>Estas cifras solo afectan estimaciones. Los hechos confirmados nunca se mezclan con supuestos.</p><button class="button acid">Guardar</button></form><section class="settings-card"><p class="kicker">DATA / PORTABILITY</p><h3>Respaldo local</h3><p>Exporta el universo completo como JSON o restaura una copia. El proyecto no necesita cuenta ni backend.</p><div class="settings-actions"><button class="button" id="exportData">Exportar</button><button class="button" id="importData">Importar</button><button class="button" id="resetData">Restablecer datos de ejemplo</button></div></section><section class="settings-card danger-zone-card"><p class="kicker">DANGER ZONE / FRESH START</p><h3>Empezar desde cero</h3><p>Elimina todo el contenido guardado para construir un contexto personal limpio. Conserva la configuración técnica de Ollama y la estructura base.</p><div class="danger-zone-summary"><span>${Object.values(workspaceCounts(state)).reduce((sum,value)=>sum+value,0)}</span><small>registros locales actuales</small></div><button class="button danger" type="button" id="freshStart">Limpieza total</button></section></section>`;

  const form=$('#assistantSettings'),modelSelect=$('#ollamaModel'),modelMeta=$('#ollamaModelMeta'),output=$('#ollamaResult');
  let discoveredModels=[];
  const formData=()=>Object.fromEntries(new FormData(form));
  const selectedRecord=()=>discoveredModels.find(item=>item.name===modelSelect.value);
  const paintModelMeta=()=>{
    const model=selectedRecord();
    if(!model){modelMeta.innerHTML='<span>MODELO GUARDADO</span><p>No aparece en la lista actual. Actualiza los modelos o confirma que Ollama esté abierto.</p>';return;}
    const details=model.details||{},capabilities=model.capabilities||[];
    const compatibility=model.compatible?'Apto para conversación':'No apto para conversación';
    modelMeta.innerHTML=`<span>${esc(compatibility.toUpperCase())}</span><strong>${esc(model.name)}</strong><p>${esc(details.parameter_size||'Tamaño desconocido')} · ${esc(details.quantization_level||'Cuantización no informada')} · ${formatBytes(model.size)}</p><small>${capabilities.length?`Capacidades: ${esc(capabilities.join(', '))}`:'Ollama no informó capacidades; ORBYTE_ usará detección adaptativa.'}</small>`;
  };
  const refreshModels=async({announce=true}={})=>{
    if(announce)output.textContent='Buscando modelos instalados…';
    try{
      const result=await discoverAssistant(formData());
      if(route!=='settings'||!$('#ollamaModel'))return;
      discoveredModels=result.models||[];
      const current=modelSelect.value||state.settings.ollamaModel;
      const compatible=discoveredModels.filter(item=>item.compatible!==false);
      const unavailable=!discoveredModels.some(item=>item.name===current);
      modelSelect.innerHTML=`${unavailable?`<option value="${esc(current)}">${esc(current)} · no encontrado</option>`:''}${compatible.map(item=>`<option value="${esc(item.name)}" ${item.name===current?'selected':''}>${esc(item.name)}${item.details?.parameter_size?` · ${esc(item.details.parameter_size)}`:''}</option>`).join('')}${discoveredModels.filter(item=>item.compatible===false).map(item=>`<option value="${esc(item.name)}" disabled>${esc(item.name)} · no genera texto</option>`).join('')}`;
      if(!unavailable&&compatible.length&&!compatible.some(item=>item.name===modelSelect.value))modelSelect.value=compatible[0].name;
      paintModelMeta();
      if(announce)output.textContent=compatible.length?`${compatible.length} modelo${compatible.length===1?'':'s'} compatible${compatible.length===1?'':'s'} encontrado${compatible.length===1?'':'s'}.`:'Ollama está activo, pero no hay modelos de conversación instalados.';
    }catch(error){
      if(route!=='settings'||!$('#ollamaResult'))return;
      modelMeta.innerHTML='<span>OLLAMA NO DISPONIBLE</span><p>El kernel local sigue funcionando sin IA generativa.</p>';
      output.textContent=`No disponible: ${error.message}`;
    }
  };

  form?.addEventListener('submit',event=>{event.preventDefault();const data=formData();update(s=>Object.assign(s.settings,data),'Ajustes de asistente actualizados');toast('Ajustes guardados');});
  modelSelect?.addEventListener('change',paintModelMeta);
  $('#refreshOllamaModels')?.addEventListener('click',()=>refreshModels());
  $('#testOllama')?.addEventListener('click',async()=>{
    output.textContent='Cargando y probando el modelo seleccionado…';
    try{
      const result=await testAssistant(formData());
      const detail=[result.family,result.parameterSize,result.quantization].filter(Boolean).join(' · ');
      output.textContent=`Prueba real completada: ${result.model} respondió “${result.probeAnswer}” en ${(result.latencyMs/1000).toFixed(1)} s mediante ${result.compatibilityMode}.${detail?` ${detail}.`:''}`;
    }catch(error){output.textContent=`No disponible: ${error.message}`;}
  });
  $('#systemSettings')?.addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));update(s=>{s.profile.name=data.profileName;s.settings.workdayMinutes=Number(data.workdayMinutes);s.settings.monthlyBudget=Number(data.monthlyBudget);},'Ajustes del kernel actualizados');toast('Ajustes guardados');});
  $('#financeSettings')?.addEventListener('submit',event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));update(s=>{s.financeSettings.projectionMonths=Math.min(24,Math.max(1,Number(data.projectionMonths)||6));s.financeSettings.averageWindow=Math.min(12,Math.max(1,Number(data.averageWindow)||3));},'Supuestos financieros actualizados');toast('Proyección actualizada');});
  $('#exportData')?.addEventListener('click',exportData);$('#importData')?.addEventListener('click',()=>$('#importFile').click());$('#resetData')?.addEventListener('click',()=>{if(confirm('¿Restablecer los datos de ejemplo? Esto reemplazará el contenido actual.')){reset();toast('Datos de ejemplo restaurados');}});$('#freshStart')?.addEventListener('click',openFreshStartDialog);
  void refreshModels({announce:false});
}

const renderers={edition:renderEdition,terminal:renderTerminal,universe:renderUniverse,projects:renderProjects,tasks:renderTasks,habits:renderHabits,calendar:renderCalendar,finance:renderFinance,workbench:renderWorkbench,review:renderReview,settings:renderSettings};
function captureConversationUi(){
  const input=$('#terminalInput'),log=$('#terminalLog');
  if(input){conversationUi.draft=input.value;if(!input.disabled)conversationUi.focusComposer=document.activeElement===input;conversationUi.selectionStart=input.selectionStart||0;conversationUi.selectionEnd=input.selectionEnd||conversationUi.selectionStart;}
  if(log?.dataset.scrollReady==='true'){conversationUi.scrollTop=log.scrollTop;conversationUi.stickToBottom=isNearScrollEnd(log);}
}
function render(){
  const renderedRoute=route;
  const routeChanged=renderedRoute!==previousRoute;
  const resetPage=renderedRoute!=='terminal'&&(pendingPageScroll||routeChanged);
  const restorePage=shouldRestoreDocumentScroll({route:renderedRoute,routeChanged,pendingPageScroll});
  const scrollY=window.scrollY;
  if(renderedRoute==='terminal')captureConversationUi();
  updateChrome();
  (renderers[renderedRoute]||renderEdition)();
  pendingPageScroll=false;
  previousRoute=renderedRoute;
  if(renderedRoute==='terminal')return;
  const targetY=resetPage?0:restorePage?scrollY:window.scrollY;
  window.scrollTo({top:targetY,behavior:'auto'});
  requestAnimationFrame(()=>{
    if(route!==renderedRoute)return;
    window.scrollTo({top:targetY,behavior:'auto'});
  });
}

async function run(text){
  const commandText=String(text||'').trim();
  if(!commandText)return;
  conversationUi.forceBottom=true;
  conversationUi.focusComposer=true;
  addLog({role:'user',text:commandText});
  const state=getState(),result=interpret(commandText,state);
  if(result.kind==='help'){addLog({role:'assistant',source:'kernel',text:'Puedo priorizar tu día, explicar riesgos, resumir proyectos y analizar gastos. También entiendo mensajes largos con varios proyectos y acciones: usa encabezados como “Para PixelPy:” y lista compras, tareas, notas o eventos debajo. Si un proyecto no existe, su creación queda bloqueada hasta que la autorices explícitamente. Toda modificación requiere una propuesta validada y confirmación.'});return;}
  if(result.kind==='navigate'){if(routes.includes(result.route)){navigate(result.route);addLog({role:'assistant',source:'kernel',text:`Vista ${labels[result.route]} abierta.`});}else addLog({role:'assistant',source:'kernel',text:'No reconozco esa vista.'});return;}
  if(result.kind==='blocked'){addLog({role:'assistant',source:'kernel',text:'Detecté una solicitud operativa, pero quedó bloqueada por seguridad. No se aplicó nada ni se consultó al modelo generativo.',blockedRequest:result});navigate('terminal');return;}
  if(result.kind==='proposal'){const created=result.proposal.createdProjectCount||0,actions=result.proposal.logicalActions||1,blocked=result.proposal.validation?.status==='blocked';const text=blocked?'Preparé una propuesta estructurada, pero tiene bloqueos que debes resolver antes de confirmar.':actions>1||created?`Separé tu mensaje en ${actions} acción${actions===1?'':'es'}${created?` y ${created} proyecto${created===1?' nuevo':'s nuevos'}`:''}. Revisa la propuesta completa antes de aplicarla.`:'Interpreté tu solicitud y preparé una propuesta validable antes de escribir en el sistema.';addLog({role:'assistant',source:'kernel',text,proposal:result.proposal,proposalStatus:'pending'});navigate('terminal');return;}
  if(result.kind==='query'){
    if(assistantBusy){toast('ORBYTE_AI ya está respondiendo');return;}
    assistantBusy=true;
    const pendingId=id('log');
    conversationUi.forceBottom=true;
    conversationUi.focusComposer=true;
    update(s=>s.assistantLog.push({id:pendingId,role:'assistant',text:'Analizando el contexto compartido…',source:'pending',pending:true,at:new Date().toISOString()}));
    navigate('terminal');
    const local=answerQuery(result,getState());
    const financeCard=['finance','spending'].includes(result.query)?financeCardData(getState(),monthKey()):null;
    try{
      const answer=await askAssistant(commandText,getState(),local);
      assistantBusy=false;
      patchLog(pendingId,{text:answer.answer,source:answer.source,pending:false,error:answer.error||'',latencyMs:answer.latencyMs||0,model:answer.model||'',endpoint:answer.endpoint||'',compatibilityMode:answer.compatibilityMode||'',thinkingPolicy:answer.thinkingPolicy||'',financeCard});
      if(answer.error)toast(`Ollama no respondió: ${answer.error}`);
    }catch(error){
      assistantBusy=false;
      patchLog(pendingId,{text:local,source:'fallback',pending:false,error:error?.message||'Error inesperado al consultar el modelo',financeCard});
      toast('La respuesta local quedó disponible');
    }
    return;
  }
  addLog({role:'assistant',source:'kernel',text:result.message||'No pude interpretar la solicitud.'});navigate('terminal');
}
function stageSuggestion(suggestionId){const state=getState(),suggestion=generateSuggestions(state).find(item=>item.id===suggestionId);if(!suggestion){toast('La señal cambió; vuelve a generar la edición');return;}refreshProposal(state,suggestion.proposal);addLog({role:'assistant',source:'kernel',text:`La sugerencia se basa en: ${suggestion.explanation}`,proposal:suggestion.proposal,proposalStatus:'pending'});navigate('terminal');}
function exportData(){const blob=new Blob([JSON.stringify(getState(),null,2)],{type:'application/json'}),anchor=document.createElement('a');anchor.href=URL.createObjectURL(blob);anchor.download=`orbyte-personal-os-${dateKey()}.json`;anchor.click();URL.revokeObjectURL(anchor.href);toast('Respaldo exportado');}

function handleClick(event){
  const closeDialog=event.target.closest('[data-close-dialog]');if(closeDialog){event.preventDefault();closeDialog.closest('dialog')?.close();return;}
  const moreToggle=event.target.closest('[data-more-toggle]');
  if(moreToggle){
    event.preventDefault();
    moreMenuOpen=!moreMenuOpen;
    nav();
    requestAnimationFrame(()=>$('#mainNav [data-more-toggle]')?.focus({preventScroll:true}));
    return;
  }
  const routeTarget=event.target.closest('button[data-route],a[data-route]');if(routeTarget){event.preventDefault();moreMenuOpen=false;navigate(routeTarget.dataset.route);return;}
  const command=event.target.closest('[data-command]');if(command){event.preventDefault();if(command.disabled)return;void run(command.dataset.command);return;}
  const editProposal=event.target.closest('[data-edit-proposal]');if(editProposal){event.preventDefault();openProposalEditor(editProposal.dataset.editProposal);return;}
  const undo=event.target.closest('[data-undo-batch]');if(undo){event.preventDefault();undoBatch(undo.dataset.undoBatch);return;}
  const habitWeekButton=event.target.closest('[data-habit-week]');if(habitWeekButton){
    event.preventDefault();
    const direction=habitWeekButton.dataset.habitWeek;
    if(direction==='today')habitWeek=weekStart();
    else{
      const dateValue=new Date(`${habitWeek}T12:00:00`);
      dateValue.setDate(dateValue.getDate()+(direction==='next'?7:-7));
      habitWeek=dateKey(dateValue);
    }
    render();return;
  }
  const editHabit=event.target.closest('[data-edit-habit]');if(editHabit){event.preventDefault();openHabitEditor(editHabit.dataset.editHabit||'');return;}
  const habitLog=event.target.closest('[data-habit-log]');if(habitLog){event.preventDefault();if(habitLog.disabled)return;logHabit(habitLog.dataset.habitLog,habitLog.dataset.habitDate);return;}
  const skipHabit=event.target.closest('[data-skip-habit]');if(skipHabit){
    event.preventDefault();
    const habitId=skipHabit.dataset.skipHabit,key=skipHabit.dataset.habitDate||dateKey();
    openEntityDialog({kicker:'HABIT / JUSTIFIED SKIP',title:'Omitir oportunidad',body:`<label><span>Motivo</span><input name="reason" required placeholder="Viaje, descanso, lesión…"></label>`,submitLabel:'Omitir',onSubmit:form=>update(state=>{const item=state.habits.find(entry=>entry.id===habitId);if(!item)return;item.skips||={};item.skips[key]={reason:String(form.get('reason')).trim(),at:new Date().toISOString()};delete item.history?.[key];},'Oportunidad de hábito omitida con justificación')});
    return;
  }
  const pauseHabit=event.target.closest('[data-pause-habit]');if(pauseHabit){
    event.preventDefault();
    const habitId=pauseHabit.dataset.pauseHabit;
    update(state=>{const item=state.habits.find(entry=>entry.id===habitId);if(item)item.paused=!item.paused;},'Estado del hábito actualizado');
    return;
  }
  const openFinance=event.target.closest('[data-open-finance]');if(openFinance){event.preventDefault();financeMonth=openFinance.dataset.financeCardMonth||monthKey();financeTab=openFinance.dataset.openFinance||'overview';navigate('finance');return;}
  const financeMonthButton=event.target.closest('[data-finance-month]');if(financeMonthButton){
    event.preventDefault();const direction=financeMonthButton.dataset.financeMonth;
    financeMonth=direction==='today'?monthKey():addMonths(financeMonth,direction==='next'?1:-1);render();return;
  }
  const financeTabButton=event.target.closest('[data-finance-tab]');if(financeTabButton){event.preventDefault();financeTab=financeTabButton.dataset.financeTab;render();return;}
  const editRecurring=event.target.closest('[data-edit-recurring]');if(editRecurring){event.preventDefault();openRecurringEditor(editRecurring.dataset.editRecurring||'');return;}
  const toggleRecurring=event.target.closest('[data-toggle-recurring]');if(toggleRecurring){
    event.preventDefault();update(state=>{const item=state.recurringTransactions.find(entry=>entry.id===toggleRecurring.dataset.toggleRecurring);if(item)item.active=item.active===false;},'Recurrente actualizado');return;
  }
  const deleteRecurring=event.target.closest('[data-delete-recurring]');if(deleteRecurring){
    event.preventDefault();const rule=getState().recurringTransactions.find(item=>item.id===deleteRecurring.dataset.deleteRecurring);
    if(rule&&confirm(`¿Eliminar la regla recurrente “${rule.description}”? Los movimientos ya confirmados se conservarán.`))update(state=>{state.recurringTransactions=state.recurringTransactions.filter(item=>item.id!==rule.id);state.skippedOccurrences=state.skippedOccurrences.filter(item=>item.recurrenceId!==rule.id);},`Recurrente eliminado: ${rule.description}`);
    return;
  }
  const confirmRecurring=event.target.closest('[data-confirm-recurring]');if(confirmRecurring){
    event.preventDefault();const recurrenceId=confirmRecurring.dataset.confirmRecurring,occurrenceKey=confirmRecurring.dataset.occurrence,rule=getState().recurringTransactions.find(item=>item.id===recurrenceId);if(!rule)return;
    update(state=>{
      if(state.transactions.some(tx=>tx.recurrenceId===recurrenceId&&tx.occurrenceKey===occurrenceKey))return;
      state.transactions.push({id:id('tx'),type:rule.type,amount:Number(rule.amount)||0,description:rule.description,category:rule.category||(rule.type==='income'?'Ingresos':'Otros'),projectId:rule.projectId||'',orbitId:rule.orbitId||'',date:occurrenceKey,status:'confirmed',recurrenceId,occurrenceKey,sourceText:'Confirmado desde regla recurrente'});
      state.skippedOccurrences=state.skippedOccurrences.filter(item=>!(item.recurrenceId===recurrenceId&&item.occurrenceKey===occurrenceKey));
    },`${rule.type==='income'?'Ingreso recibido':'Gasto pagado'}: ${rule.description}`,{projectId:rule.projectId||''});
    return;
  }
  const skipRecurring=event.target.closest('[data-skip-recurring]');if(skipRecurring){
    event.preventDefault();const recurrenceId=skipRecurring.dataset.skipRecurring,occurrenceKey=skipRecurring.dataset.occurrence,rule=getState().recurringTransactions.find(item=>item.id===recurrenceId);if(!rule)return;
    openEntityDialog({kicker:'MONEY / EXCEPTION',title:`Omitir ${rule.description}`,body:`<label><span>Motivo</span><input name="reason" required placeholder="No se cobró, cancelado temporalmente…"></label>`,submitLabel:'Marcar omitido',onSubmit:form=>update(state=>{state.skippedOccurrences=state.skippedOccurrences.filter(item=>!(item.recurrenceId===recurrenceId&&item.occurrenceKey===occurrenceKey));state.skippedOccurrences.push({id:id('skip'),recurrenceId,occurrenceKey,reason:String(form.get('reason')).trim(),at:new Date().toISOString()});},`Ocurrencia omitida: ${rule.description}`)});
    return;
  }
  const confirmInstallment=event.target.closest('[data-confirm-installment]');if(confirmInstallment){
    event.preventDefault();const planId=confirmInstallment.dataset.confirmInstallment,number=Number(confirmInstallment.dataset.installmentNumber),occurrenceKey=confirmInstallment.dataset.occurrence,plan=getState().installmentPlans.find(item=>item.id===planId);if(!plan)return;
    update(state=>{if(state.transactions.some(tx=>tx.installmentPlanId===planId&&Number(tx.installmentNumber)===number))return;state.transactions.push({id:id('tx'),type:plan.type||'expense',amount:Number(plan.installmentAmount)||Math.round(Number(plan.totalAmount||0)/Math.max(1,Number(plan.installments)||1)),description:`${plan.description} · cuota ${number}/${plan.installments}`,category:plan.category||'Compras',projectId:plan.projectId||'',orbitId:plan.orbitId||'',date:occurrenceKey,status:'confirmed',installmentPlanId:planId,installmentNumber:number});},`Cuota confirmada: ${plan.description}`,{projectId:plan.projectId||''});
    return;
  }
  const convertRecurring=event.target.closest('[data-convert-recurring]');if(convertRecurring){
    event.preventDefault();const candidate=detectRecurringCandidates(getState()).find(item=>item.id===convertRecurring.dataset.convertRecurring);if(!candidate){toast('La detección cambió');return;}
    const latest=getState().transactions.filter(tx=>tx.description===candidate.description&&tx.type===candidate.type).sort((a,b)=>b.date.localeCompare(a.date))[0];
    update(state=>state.recurringTransactions.push({id:id('rt'),type:candidate.type,description:candidate.description,amount:candidate.amount,category:candidate.category||(candidate.type==='income'?'Ingresos':'Otros'),subtype:'fixed',frequency:'monthly',day:Number(String(latest?.date||dateKey()).slice(8,10))||1,weekday:0,interval:1,startDate:latest?.date||dateKey(),endDate:'',active:true,projectId:candidate.projectId||'',orbitId:candidate.orbitId||'o_money',createdAt:dateKey()}),`Recurrente detectado y confirmado: ${candidate.description}`);
    toast('Regla recurrente creada');return;
  }
  const addBudget=event.target.closest('[data-add-budget]');if(addBudget){event.preventDefault();openBudgetEditor();return;}
  const deleteBudget=event.target.closest('[data-delete-budget]');if(deleteBudget){
    event.preventDefault();const budget=getState().budgets.find(item=>item.id===deleteBudget.dataset.deleteBudget);
    if(budget&&confirm(`¿Eliminar el presupuesto “${budget.label||budget.reference}”?`))update(state=>state.budgets=state.budgets.filter(item=>item.id!==budget.id),'Presupuesto eliminado');return;
  }
  const addInstallment=event.target.closest('[data-add-installment]');if(addInstallment){event.preventDefault();openInstallmentEditor();return;}
  const deleteInstallment=event.target.closest('[data-delete-installment]');if(deleteInstallment){
    event.preventDefault();const plan=getState().installmentPlans.find(item=>item.id===deleteInstallment.dataset.deleteInstallment);
    if(plan&&confirm(`¿Eliminar el plan de cuotas “${plan.description}”? Los pagos confirmados se conservarán.`))update(state=>state.installmentPlans=state.installmentPlans.filter(item=>item.id!==plan.id),`Plan de cuotas eliminado: ${plan.description}`);
    return;
  }
  const completeGoal=event.target.closest('[data-complete-goal]');if(completeGoal){
    event.preventDefault();const goalId=completeGoal.dataset.completeGoal,goal=getState().financialGoals.find(item=>item.id===goalId);if(!goal)return;
    const completing=goal.status!=='completed';
    if(completing&&!confirm(`¿Cerrar el objetivo “${goal.title}”? El gasto planificado dejará de proyectarse; la compra real debe registrarse por separado.`))return;
    update(state=>{const item=state.financialGoals.find(entry=>entry.id===goalId);if(!item)return;item.status=completing?'completed':'planned';for(const tx of state.transactions.filter(entry=>entry.financialGoalId===goalId&&['planned','cancelled'].includes(entry.status)))tx.status=completing?'cancelled':'planned';},'Objetivo financiero actualizado');return;
  }
  const saveReview=event.target.closest('[data-save-month-review]');if(saveReview){
    event.preventDefault();const review=financeMonthReview(getState(),saveReview.dataset.saveMonthReview);
    update(state=>{state.monthReviews=state.monthReviews.filter(item=>item.month!==review.month);state.monthReviews.unshift({...review,id:id('review'),savedAt:new Date().toISOString()});},`Cierre mensual guardado: ${monthLabel(review.month)}`);toast('Cierre mensual guardado');return;
  }
  const project=event.target.closest('[data-open-project]');if(project){navigate('workbench',project.dataset.openProject);return;}
  const task=event.target.closest('[data-toggle-task]');if(task){update(state=>{const item=state.tasks.find(entry=>entry.id===task.dataset.toggleTask);if(item){item.done=!item.done;item.completedAt=item.done?new Date().toISOString():null;}},'Tarea actualizada',{projectId:getState().tasks.find(entry=>entry.id===task.dataset.toggleTask)?.projectId||''});return;}
  const deleteTask=event.target.closest('[data-delete-task]');if(deleteTask&&confirm('¿Eliminar esta acción?')){update(state=>state.tasks=state.tasks.filter(item=>item.id!==deleteTask.dataset.deleteTask),'Tarea eliminada');return;}
  const deleteProject=event.target.closest('[data-delete-project]');if(deleteProject){
    const projectId=deleteProject.dataset.deleteProject,project=getState().projects.find(item=>item.id===projectId);
    if(project&&confirm(`¿Eliminar el proyecto “${project.title}”? Los elementos vinculados quedarán sin proyecto.`)){
      update(state=>{
        state.projects=state.projects.filter(item=>item.id!==projectId);
        for(const collection of ['tasks','habits','events','notes','transactions','assets'])for(const item of state[collection])if(item.projectId===projectId)item.projectId='';
      },`Proyecto eliminado: ${project.title}`);
      if(selectedProjectId===projectId)selectedProjectId=getState().projects[0]?.id||'';
    }
    return;
  }
  const habit=event.target.closest('[data-toggle-habit]');if(habit){update(state=>{const item=state.habits.find(entry=>entry.id===habit.dataset.toggleHabit),key=dateKey();if(item.history[key])delete item.history[key];else item.history[key]=true;},'Hábito actualizado');return;}
  const apply=event.target.closest('[data-apply-proposal]');if(apply){const proposal=getState().assistantLog.find(item=>item.proposal?.id===apply.dataset.applyProposal)?.proposal;if(proposal)applyProposal(proposal);return;}
  const dismiss=event.target.closest('[data-dismiss-proposal]');if(dismiss){dismissProposal(dismiss.dataset.dismissProposal);return;}
  const stage=event.target.closest('[data-stage-suggestion]');if(stage){stageSuggestion(stage.dataset.stageSuggestion);return;}
  if(moreMenuOpen&&!event.target.closest('[data-more-toggle],#moreNavMenu')){moreMenuOpen=false;nav();}
}

document.addEventListener('click',handleClick);
$('#newCapture').addEventListener('click',()=>$('#captureDialog').showModal());
$('#captureForm').addEventListener('submit',event=>{if(event.submitter?.value!=='submit')return;event.preventDefault();const text=new FormData(event.currentTarget).get('text');event.currentTarget.reset();$('#captureDialog').close();run(text);});
$('#importFile').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{replace(JSON.parse(await file.text()),'Respaldo importado');toast('Respaldo importado');}catch(error){toast(`Importación rechazada: ${error.message}`);}event.target.value='';});
addEventListener('hashchange',()=>{captureConversationUi();const fromRoute=route,previousProjectId=selectedProjectId,parts=location.hash.slice(1).split('/');route=routes.includes(parts[0])?parts[0]:'edition';if(parts[1])selectedProjectId=parts[1];pendingPageScroll=pendingPageScroll||route!==fromRoute||(route==='workbench'&&selectedProjectId!==previousProjectId);render();});
addEventListener('keydown',event=>{
  if(event.key==='Escape'&&moreMenuOpen){event.preventDefault();moreMenuOpen=false;nav();$('#mainNav [data-more-toggle]')?.focus({preventScroll:true});return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();navigate('terminal');setTimeout(()=>$('#terminalInput')?.focus({preventScroll:true}),0);}
});
addEventListener('resize',()=>{if(moreMenuOpen)positionMoreMenu();},{passive:true});
const interruptedEntries=getState().assistantLog.filter(entry=>entry.pending);
if(interruptedEntries.length){
  update(state=>{
    for(const entry of state.assistantLog.filter(item=>item.pending)){
      entry.pending=false;
      entry.source='fallback';
      entry.text='La solicitud anterior se interrumpió. Puedes volver a enviarla.';
      entry.error='La sesión terminó antes de recibir la respuesta del modelo.';
    }
  });
}
subscribe(render);
if(!getState().assistantLog.length)addLog({role:'assistant',source:'kernel',systemWelcome:true,text:`ORBYTE_AI activo. El kernel ya conectó proyectos, acciones, tiempo, hábitos y dinero. Pregunta “qué necesita atención” o captura una acción en lenguaje natural.`});
else render();
