import { dateKey, id } from '../storage/store.js';
import { clamp, projectProgress } from '../shared/utils.js';
import { financeMonthLedger, monthKey as financeMonthKey } from './finance.js';
import { isHabitDueToday } from './habits.js';

const dayMs = 86400000;
const atNoon = key => new Date(`${key}T12:00:00`).getTime();
const daysBetween = (from,to) => Math.round((atNoon(to)-atNoon(from))/dayMs);
const monthKey = key => String(key||'').slice(0,7);
const currentMonth = now => monthKey(dateKey(now));
const previousMonth = now => { const d=new Date(now); d.setMonth(d.getMonth()-1); return monthKey(dateKey(d)); };

export function rankTask(task,state,now=new Date()) {
  if (task.done) return -999;
  const today = dateKey(now);
  let score = {high:45,medium:25,low:10}[task.priority] || 20;
  if (task.dueDate) {
    const delta = daysBetween(today,task.dueDate);
    if (delta < 0) score += 100 + Math.min(30,Math.abs(delta)*4);
    else if (delta === 0) score += 80;
    else if (delta <= 2) score += 45;
    else if (delta <= 7) score += 15;
  }
  const project = state.projects.find(item=>item.id===task.projectId);
  if (project?.status === 'active') score += 8;
  score -= Math.min(20,(Number(task.estimate)||30)/15);
  return score;
}

export function projectHealth(state,project,now=new Date()) {
  const today = dateKey(now);
  const tasks = state.tasks.filter(task=>task.projectId===project.id);
  const open = tasks.filter(task=>!task.done);
  const overdue = open.filter(task=>task.dueDate && task.dueDate < today);
  const dueSoon = open.filter(task=>task.dueDate && daysBetween(today,task.dueDate)>=0 && daysBetween(today,task.dueDate)<=7);
  const latestActivity = state.activity.find(item=>item.projectId===project.id)?.at?.slice(0,10) || project.createdAt || today;
  const inactiveDays = Math.max(0,daysBetween(latestActivity,today));
  let risk = 0;
  if (project.status === 'active' && open.length === 0) risk += 45;
  risk += Math.min(45,overdue.length*24);
  if (project.dueDate && daysBetween(today,project.dueDate)<=14 && projectProgress(state,project.id)<70) risk += 22;
  if (inactiveDays >= 10) risk += 18;
  if (dueSoon.length && projectProgress(state,project.id)<40) risk += 10;
  risk = clamp(risk,0,100);
  const status = risk>=65?'critical':risk>=35?'watch':open.length?'moving':'quiet';
  return { risk,status,progress:projectProgress(state,project.id),open:open.length,overdue:overdue.length,dueSoon:dueSoon.length,inactiveDays,nextAction:open.sort((a,b)=>rankTask(b,state,now)-rankTask(a,state,now))[0]||null };
}

export function financeSnapshot(state,now=new Date()) {
  const month=financeMonthKey(dateKey(now));
  const ledger=financeMonthLedger(state,month);
  const previousLedger=financeMonthLedger(state,previousMonth(now));
  const currentCategories=ledger.byCategory,priorCategories=previousLedger.byCategory;
  const anomalies=Object.entries(currentCategories).map(([category,value])=>({category,value,previous:priorCategories[category]||0})).filter(item=>item.value>=30000 && item.value>Math.max(item.previous*1.45,item.previous+30000)).sort((a,b)=>b.value-a.value);
  const budget=Number(state.settings.monthlyBudget)||0;
  return {
    month,
    income:ledger.actualIncome,
    expense:ledger.actualExpense,
    balance:ledger.realBalance,
    projectedIncome:ledger.projectedIncome,
    projectedExpense:ledger.projectedExpense,
    projectedBalance:ledger.projectedAfterAssumptions,
    pendingCommitments:ledger.pendingCommitments,
    variableAssumption:ledger.variableAssumption,
    budget,
    budgetUse:budget?Math.round(ledger.actualExpense/budget*100):0,
    byCategory:currentCategories,
    anomalies,
    ledger
  };
}

export function dailyPlan(state,now=new Date()) {
  const today=dateKey(now);
  const tasks=state.tasks.filter(task=>!task.done).sort((a,b)=>rankTask(b,state,now)-rankTask(a,state,now));
  const events=state.events.filter(event=>event.date>=today).sort((a,b)=>`${a.date}${a.time||''}`.localeCompare(`${b.date}${b.time||''}`)).slice(0,3);
  const habits=state.habits.filter(habit=>isHabitDueToday(habit,today));
  const capacity=Number(state.settings.workdayMinutes)||300;
  let used=0;
  const focus=[];
  for(const task of tasks){const estimate=Number(task.estimate)||30;if(focus.length>=3)break;if(used+estimate<=capacity||focus.length===0){focus.push(task);used+=estimate;}}
  return {today,focus,events,habits,used,capacity,backlog:tasks.length};
}

export function attentionSignals(state,now=new Date()) {
  const today=dateKey(now);
  const projectSignals=state.projects.filter(project=>project.status==='active').map(project=>({project,health:projectHealth(state,project,now)}));
  const overdue=state.tasks.filter(task=>!task.done&&task.dueDate&&task.dueDate<today).sort((a,b)=>rankTask(b,state,now)-rankTask(a,state,now));
  const stalled=projectSignals.filter(item=>item.health.open===0||item.health.inactiveDays>=10).sort((a,b)=>b.health.risk-a.health.risk);
  const risky=projectSignals.filter(item=>item.health.risk>=35).sort((a,b)=>b.health.risk-a.health.risk);
  const finance=financeSnapshot(state,now);
  const nextEvent=state.events.filter(event=>event.date>=today).sort((a,b)=>`${a.date}${a.time||''}`.localeCompare(`${b.date}${b.time||''}`))[0]||null;
  return {overdue,stalled,risky,finance,nextEvent};
}

export function generateSuggestions(state,now=new Date()) {
  const signals=attentionSignals(state,now),today=dateKey(now),suggestions=[];
  for(const task of signals.overdue.slice(0,2)) suggestions.push({
    id:`sg_task_${task.id}`,kind:'task',severity:'high',title:`Resolver “${task.title}”`,explanation:`Está vencida desde ${task.dueDate}.`,evidence:[`Prioridad ${task.priority}`,task.projectId?'Vinculada a un proyecto':'Sin proyecto'],proposal:{id:`pr_task_${task.id}`,title:'Mover tarea al foco de hoy',summary:`Cambiar la fecha de “${task.title}” a hoy.`,operations:[{type:'update',collection:'tasks',id:task.id,patch:{dueDate:today,priority:'high'}}]}
  });
  for(const item of signals.stalled.slice(0,2)) suggestions.push({
    id:`sg_project_${item.project.id}`,kind:'project',severity:'medium',title:`Dar próxima acción a ${item.project.title}`,explanation:item.health.open===0?'El proyecto está activo pero no tiene acciones abiertas.':`Lleva ${item.health.inactiveDays} días sin movimiento registrado.`,evidence:[`${item.health.progress}% de progreso`,`Riesgo ${item.health.risk}/100`],proposal:{id:`pr_project_${item.project.id}`,title:'Crear próxima acción',summary:`Crear una tarea de revisión para ${item.project.title}.`,operations:[{type:'create',collection:'tasks',data:{id:id('t'),title:`Definir próxima acción de ${item.project.title}`,priority:'high',dueDate:today,estimate:25,done:false,orbitId:item.project.orbitId,projectId:item.project.id,createdAt:today}}]}
  });
  if(signals.finance.anomalies[0]){const anomaly=signals.finance.anomalies[0];suggestions.push({id:`sg_finance_${anomaly.category}`,kind:'finance',severity:'medium',title:`Revisar gasto en ${anomaly.category}`,explanation:`Este mes registra ${anomaly.value.toLocaleString('es-CL')} CLP frente a ${anomaly.previous.toLocaleString('es-CL')} CLP el mes anterior.`,evidence:[`Uso presupuestario ${signals.finance.budgetUse}%`],proposal:{id:`pr_finance_${anomaly.category}`,title:'Crear revisión financiera',summary:`Crear una tarea para revisar ${anomaly.category}.`,operations:[{type:'create',collection:'tasks',data:{id:id('t'),title:`Revisar gasto en ${anomaly.category}`,priority:'medium',dueDate:today,estimate:20,done:false,orbitId:'o_money',projectId:'',createdAt:today}}]}})}
  return suggestions.slice(0,5);
}

export function buildDailyBrief(state,now=new Date()) {
  const plan=dailyPlan(state,now),signals=attentionSignals(state,now),suggestions=generateSuggestions(state,now),hour=now.getHours();
  const greeting=hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches';
  const lead=plan.focus.length?`Tu foco principal es “${plan.focus[0].title}”.`:'No hay una acción prioritaria definida.';
  const warnings=[];
  if(signals.overdue.length) warnings.push(`${signals.overdue.length} acción${signals.overdue.length===1?'':'es'} vencida${signals.overdue.length===1?'':'s'}`);
  if(signals.stalled.length) warnings.push(`${signals.stalled.length} proyecto${signals.stalled.length===1?'':'s'} sin movimiento claro`);
  if(signals.finance.anomalies.length) warnings.push(`un aumento de gasto en ${signals.finance.anomalies[0].category}`);
  return {greeting,lead,warnings,plan,signals,suggestions,generatedAt:now.toISOString()};
}

export function contextSnapshot(state,now=new Date()) {
  const brief=buildDailyBrief(state,now);
  return {
    generatedAt:brief.generatedAt,
    focus:brief.plan.focus.map(task=>({title:task.title,dueDate:task.dueDate,priority:task.priority,project:state.projects.find(p=>p.id===task.projectId)?.title||''})),
    overdue:brief.signals.overdue.map(task=>task.title),
    projects:state.projects.filter(p=>p.status==='active').map(project=>({title:project.title,...projectHealth(state,project,now)})),
    nextEvents:brief.plan.events.map(event=>({title:event.title,date:event.date,time:event.time||''})),
    finance:{expense:brief.signals.finance.expense,balance:brief.signals.finance.balance,budgetUse:brief.signals.finance.budgetUse,anomalies:brief.signals.finance.anomalies},
    habitsPending:brief.plan.habits.map(habit=>habit.title)
  };
}
