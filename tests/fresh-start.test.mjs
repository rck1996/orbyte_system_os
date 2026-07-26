import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreshState } from '../storage/store.js';

const dataCollections = [
  'projects','tasks','habits','events','notes','transactions','recurringTransactions',
  'installmentPlans','budgets','skippedOccurrences','financialGoals','monthReviews',
  'undoBatches','assets','captures','activity','assistantLog'
];

test('empezar desde cero elimina todo el contenido y conserva configuración técnica',()=>{
  const source={
    version:5,
    profile:{name:'Erick',locale:'es-CL',currency:'CLP'},
    orbits:[{id:'custom',name:'Personalizada',code:'CUSTOM'}],
    projects:[{id:'p1',title:'Proyecto'}],
    tasks:[{id:'t1',title:'Tarea'}],
    habits:[{id:'h1',title:'Hábito',targetDays:[],history:{},skips:{}}],
    events:[{id:'e1',title:'Evento',date:'2026-07-26'}],
    notes:[{id:'n1',content:'Nota'}],
    transactions:[{id:'tx1',type:'expense',amount:1000,date:'2026-07-26'}],
    recurringTransactions:[{id:'r1',type:'expense',amount:1000,description:'Pago'}],
    installmentPlans:[{id:'i1',description:'Cuotas',totalAmount:3000,installments:3}],
    budgets:[{id:'b1',amount:10000}],
    skippedOccurrences:[{id:'s1'}],
    financialGoals:[{id:'g1',title:'Meta',amount:10000,targetDate:'2026-12-01'}],
    monthReviews:[{id:'m1'}],
    undoBatches:[{id:'u1'}],
    assets:[{id:'a1',title:'Activo'}],
    captures:[{id:'c1'}],
    activity:[{id:'act1'}],
    assistantLog:[{id:'log1'}],
    settings:{assistantMode:'hybrid',ollamaUrl:'http://127.0.0.1:11434',ollamaModel:'gemma4:12b',monthlyBudget:900000,workdayMinutes:420},
    financeSettings:{projectionMonths:12,averageWindow:5}
  };

  const fresh=createFreshState(source);

  for(const collection of dataCollections)assert.deepEqual(fresh[collection],[],`${collection} debe quedar vacío`);
  assert.equal(fresh.profile.name,'Erick');
  assert.equal(fresh.settings.assistantMode,'hybrid');
  assert.equal(fresh.settings.ollamaModel,'gemma4:12b');
  assert.equal(fresh.settings.ollamaUrl,'http://127.0.0.1:11434');
  assert.equal(fresh.settings.workdayMinutes,420);
  assert.equal(fresh.settings.monthlyBudget,0);
  assert.deepEqual(fresh.financeSettings,{projectionMonths:12,averageWindow:5});
  assert.equal(fresh.orbits.length,4);
  assert.ok(fresh.orbits.every(orbit=>orbit.id&&orbit.name));
  assert.equal(fresh.orbits.some(orbit=>orbit.id==='custom'),false);
});

test('el estado limpio no comparte referencias con el estado anterior',()=>{
  const source={profile:{name:'Erick'},settings:{ollamaModel:'gemma4:12b'},projects:[{id:'p1'}]};
  const fresh=createFreshState(source);
  fresh.profile.name='Otro';
  fresh.orbits[0].name='Cambiada';
  assert.equal(source.profile.name,'Erick');
  assert.equal(source.orbits,undefined);
});
