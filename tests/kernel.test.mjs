import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionSignals, buildDailyBrief, dailyPlan, financeSnapshot, projectHealth, rankTask } from '../core/kernel.js';
const now=new Date('2026-07-24T10:00:00');
const state={
 settings:{monthlyBudget:100000,workdayMinutes:120},activity:[],
 projects:[{id:'p1',title:'Proyecto',status:'active',dueDate:'2026-07-30',createdAt:'2026-07-01'}],
 tasks:[{id:'late',projectId:'p1',title:'Vencida',priority:'high',dueDate:'2026-07-20',estimate:30,done:false},{id:'today',projectId:'p1',title:'Hoy',priority:'medium',dueDate:'2026-07-24',estimate:30,done:false}],
 events:[],habits:[],transactions:[{type:'expense',amount:80000,category:'Comida',date:'2026-07-10'},{type:'expense',amount:20000,category:'Comida',date:'2026-06-10'}]
};
test('prioriza vencidas por sobre tareas de hoy',()=>assert.ok(rankTask(state.tasks[0],state,now)>rankTask(state.tasks[1],state,now)));
test('calcula salud y riesgo de proyecto',()=>{const health=projectHealth(state,state.projects[0],now);assert.equal(health.overdue,1);assert.ok(health.risk>=35);});
test('construye plan de capacidad limitada',()=>{const plan=dailyPlan(state,now);assert.equal(plan.focus.length,2);assert.equal(plan.used,60);});
test('detecta anomalía financiera',()=>assert.equal(financeSnapshot(state,now).anomalies[0].category,'Comida'));
test('genera edición con alertas',()=>{const brief=buildDailyBrief(state,now);assert.ok(brief.warnings.length);assert.equal(attentionSignals(state,now).overdue.length,1);});
