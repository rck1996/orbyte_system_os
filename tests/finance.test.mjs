import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurringCandidates, financeMonthLedger, financeProjection, recurringOccurrences } from '../core/finance.js';

const baseState=()=>({
  settings:{monthlyBudget:1000000},financeSettings:{averageWindow:3,projectionMonths:6},projects:[{id:'p',title:'Proyecto'}],
  transactions:[],recurringTransactions:[],installmentPlans:[],budgets:[],skippedOccurrences:[],financialGoals:[]
});

test('una regla mensual genera compromiso pendiente y se confirma una sola vez',()=>{
  const state=baseState();
  state.recurringTransactions.push({id:'r',type:'expense',description:'Dividendo',amount:630000,category:'Vivienda',frequency:'monthly',day:5,startDate:'2026-01-05',active:true});
  let ledger=financeMonthLedger(state,'2026-09');
  assert.equal(ledger.recurring.length,1);
  assert.equal(ledger.recurring[0].date,'2026-09-05');
  assert.equal(ledger.recurring[0].status,'pending');
  assert.equal(ledger.pendingCommitments,630000);
  state.transactions.push({id:'tx',type:'expense',description:'Dividendo',amount:630000,category:'Vivienda',date:'2026-09-05',status:'confirmed',recurrenceId:'r',occurrenceKey:'2026-09-05'});
  ledger=financeMonthLedger(state,'2026-09');
  assert.equal(ledger.recurring[0].status,'confirmed');
  assert.equal(ledger.actualExpense,630000);
  assert.equal(ledger.pendingCommitments,0);
});

test('soporta último día hábil, frecuencia semanal y cuotas mensuales',()=>{
  assert.equal(recurringOccurrences({id:'salary',frequency:'monthly',dayRule:'last-business-day',startDate:'2026-01-01',active:true},'2026-08')[0].date,'2026-08-31');
  assert.equal(recurringOccurrences({id:'weekly',frequency:'weekly',weekday:1,startDate:'2026-08-03',active:true},'2026-08').length,5);
  const state=baseState();
  state.installmentPlans.push({id:'ip',type:'expense',description:'SSD',totalAmount:120000,installments:3,installmentAmount:40000,firstDate:'2026-08-10',active:true});
  const september=financeMonthLedger(state,'2026-09');
  assert.equal(september.installments[0].installmentNumber,2);
  assert.equal(september.installments[0].amount,40000);
});

test('una compra planificada vinculada a un objetivo no se proyecta dos veces',()=>{
  const state=baseState();
  state.financialGoals.push({id:'goal',title:'Comprar SSD',amount:120000,targetDate:'2026-09-01',status:'planned'});
  state.transactions.push({id:'planned',type:'expense',description:'Compra planificada: SSD',amount:120000,date:'2026-09-01',status:'planned',financialGoalId:'goal'});
  const ledger=financeMonthLedger(state,'2026-09');
  assert.equal(ledger.goals.length,0);
  assert.equal(ledger.projectedExpense,120000);
});

test('la proyección mantiene separados compromisos y supuesto variable',()=>{
  const state=baseState();
  state.recurringTransactions.push({id:'salary',type:'income',description:'Sueldo',amount:2000000,frequency:'monthly',day:28,startDate:'2026-01-01',active:true});
  state.recurringTransactions.push({id:'rent',type:'expense',description:'Dividendo',amount:600000,frequency:'monthly',day:5,startDate:'2026-01-01',active:true});
  state.transactions.push({id:'a',type:'expense',description:'Comida',amount:100000,date:'2026-05-12',status:'confirmed'});
  state.transactions.push({id:'b',type:'expense',description:'Comida',amount:140000,date:'2026-06-12',status:'confirmed'});
  state.transactions.push({id:'c',type:'expense',description:'Comida',amount:120000,date:'2026-07-12',status:'confirmed'});
  const [row]=financeProjection(state,'2026-08',1);
  assert.equal(row.income,2000000);
  assert.equal(row.expense,600000);
  assert.equal(row.variableAssumption,120000);
  assert.equal(row.balance,1280000);
});

test('sugiere recurrencia solo después de aparecer en tres meses',()=>{
  const state=baseState();
  for(const date of ['2026-05-04','2026-06-04','2026-07-04'])state.transactions.push({id:date,type:'expense',description:'Netflix',amount:8990,category:'Suscripciones',date,status:'confirmed'});
  const candidates=detectRecurringCandidates(state);
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].description,'Netflix');
  assert.equal(candidates[0].months,3);
});
