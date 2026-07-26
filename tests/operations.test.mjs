import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, isOperationalRequest } from '../modules/assistant/engine.js';
import { applyOperationsAtomic, enabledOperations, reconcileAppliedOperations, refreshProposal, validateProposal } from '../modules/assistant/operations.js';
import { askAssistant, compactContext, modelAnswerIssue } from '../modules/assistant/gateway.js';

function baseState(){
  return {
    profile:{name:'Erick'},
    settings:{assistantMode:'hybrid',monthlyBudget:0,workdayMinutes:120,ollamaUrl:'http://127.0.0.1:11434',ollamaModel:'qwen3:8b'},
    financeSettings:{projectionMonths:6,averageWindow:3},
    orbits:[{id:'o1',name:'Construir',code:'BUILD'}],
    projects:[{id:'p1',title:'PixelPy',orbitId:'o1',status:'active'}],
    tasks:[],notes:[],events:[],habits:[],transactions:[],recurringTransactions:[],installmentPlans:[],budgets:[],financialGoals:[],assets:[],skippedOccurrences:[],monthReviews:[],captures:[],activity:[],assistantLog:[],undoBatches:[]
  };
}

test('una referencia a proyecto ausente queda bloqueada hasta autorizarla',()=>{
  const state=baseState();
  const result=interpret('compra un SSD por 60 mil para el proyecto HomeLab',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.validation.status,'blocked');
  const project=result.proposal.operations.find(operation=>operation.collection==='projects');
  assert.equal(project.meta.requiresApproval,true);
  assert.equal(project.meta.approved,false);
  assert.match(result.proposal.validation.blockers[0].message,/autorización explícita/i);
  project.meta.approved=true;
  refreshProposal(state,result.proposal);
  assert.equal(result.proposal.validation.status,'ready');
});

test('crear un proyecto de forma explícita no requiere una segunda autorización',()=>{
  const result=interpret('Crea el proyecto HomeLab',baseState());
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.validation.status,'ready');
  assert.equal(result.proposal.operations[0].meta.approved,true);
});

test('un evento sin fecha produce una propuesta editable pero bloqueada',()=>{
  const result=interpret('tengo una reunión con Ana',baseState());
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.validation.status,'blocked');
  assert.ok(result.proposal.validation.blockers.some(item=>item.code==='event-date'));
});

test('una línea ambigua dentro de un lote debe ignorarse explícitamente',()=>{
  const state=baseState();
  const result=interpret('Para PixelPy:\n- crea tarea revisar interfaz\n- quizá algo para después',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.operations.length,1);
  assert.equal(result.proposal.ambiguities.length,1);
  assert.equal(result.proposal.validation.status,'blocked');
  result.proposal.ambiguities[0].resolution='ignore';
  refreshProposal(state,result.proposal);
  assert.equal(result.proposal.validation.status,'ready');
});

test('el enrutador separa preguntas de operaciones incluso con signos de interrogación',()=>{
  const state=baseState();
  assert.equal(isOperationalRequest('¿Puedes crear una tarea para mañana?'),true);
  assert.equal(interpret('¿Puedes crear una tarea para mañana?',state).kind,'proposal');
  assert.equal(isOperationalRequest('¿Qué me recomiendas priorizar hoy?'),false);
  assert.equal(interpret('¿Qué me recomiendas priorizar hoy?',state).kind,'query');
});

test('el gateway nunca consulta Ollama para una solicitud operativa',async()=>{
  const state=baseState();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('no debe llamarse');};
  try{
    const answer=await askAssistant('crea una tarea mañana',state,'La operación debe volver al kernel.');
    assert.equal(answer.source,'kernel');
    assert.match(answer.error,/enrutador estricto/i);
  }finally{globalThis.fetch=originalFetch;}
});

test('una falla intermedia no deja cambios parciales',()=>{
  const state=baseState();
  const before=structuredClone(state);
  assert.throws(()=>applyOperationsAtomic(state,[
    {opId:'op1',type:'create',collection:'tasks',data:{id:'t1',title:'Primera',projectId:'p1',orbitId:'o1'}},
    {opId:'op2',type:'update',collection:'tasks',id:'missing',patch:{title:'Nunca'}}
  ]),/No se encontró/);
  assert.deepEqual(state,before);
});

test('aplicar y deshacer usa operaciones inversas sin restaurar colecciones completas',()=>{
  const state=baseState();
  const receipt=applyOperationsAtomic(state,[{opId:'op1',type:'create',collection:'tasks',data:{id:'t1',title:'Nueva',projectId:'p1',orbitId:'o1'}}]);
  assert.equal(state.tasks[0].title,'Nueva');
  state.notes.push({id:'n1',title:'Cambio ajeno',content:'Se conserva',projectId:'',orbitId:''});
  applyOperationsAtomic(state,receipt.inverseOperations);
  assert.equal(state.tasks.length,0);
  assert.equal(state.notes.length,1);
});

test('una propuesta aplicada puede editar sus elementos reales y deshacer solo esa edición',()=>{
  const state=baseState();
  const proposal={id:'pr1',title:'Crear tarea',summary:'1 cambio',operations:[{opId:'op1',type:'create',collection:'tasks',enabled:true,meta:{},data:{id:'t1',title:'Versión A',projectId:'p1',orbitId:'o1'}}],ambiguities:[],warnings:[]};
  refreshProposal(state,proposal);
  assert.equal(validateProposal(state,proposal).status,'ready');
  const application=applyOperationsAtomic(state,enabledOperations(proposal));
  const edited=structuredClone(proposal.operations);
  edited[0].data.title='Versión B';
  const editReceipt=reconcileAppliedOperations(state,application.forwardOperations,edited,{beforeByOperation:application.beforeByOperation});
  assert.equal(state.tasks[0].title,'Versión B');
  applyOperationsAtomic(state,editReceipt.inverseOperations);
  assert.equal(state.tasks[0].title,'Versión A');
});

test('editar repetidamente una actualización restaura campos retirados sin tocar cambios ajenos',()=>{
  const state=baseState();
  state.tasks.push({id:'t1',title:'Original',priority:'low',projectId:'p1',orbitId:'o1',estimate:30});
  const original=[{opId:'op_update',type:'update',collection:'tasks',id:'t1',patch:{title:'Primera',priority:'high'}}];
  const application=applyOperationsAtomic(state,original);
  state.tasks[0].estimate=90;
  const edited=[{...original[0],patch:{title:'Segunda'}}];
  const firstEdit=reconcileAppliedOperations(state,application.forwardOperations,edited,{beforeByOperation:application.beforeByOperation});
  assert.equal(state.tasks[0].title,'Segunda');
  assert.equal(state.tasks[0].priority,'low');
  assert.equal(state.tasks[0].estimate,90);
  const disabled=reconcileAppliedOperations(state,edited,[],{beforeByOperation:firstEdit.applicationBeforeByOperation});
  assert.equal(state.tasks[0].title,'Original');
  assert.equal(state.tasks[0].priority,'low');
  assert.equal(state.tasks[0].estimate,90);
  assert.ok(disabled.inverseOperations.length>0);
});

test('una eliminación habilitada después de confirmar conserva su base para poder desactivarla',()=>{
  const state=baseState();
  state.notes.push({id:'n1',title:'Nota',content:'Contenido',projectId:'p1',orbitId:'o1'});
  const initial=applyOperationsAtomic(state,[]);
  const deletion=[{opId:'op_delete',type:'delete',collection:'notes',id:'n1'}];
  const enabled=reconcileAppliedOperations(state,initial.forwardOperations,deletion,{beforeByOperation:initial.beforeByOperation});
  assert.equal(state.notes.length,0);
  reconcileAppliedOperations(state,deletion,[],{beforeByOperation:enabled.applicationBeforeByOperation});
  assert.equal(state.notes.length,1);
  assert.equal(state.notes[0].content,'Contenido');
});

test('una consulta diaria usa el kernel y no llama a Ollama',async()=>{
  const state=baseState();
  state.tasks.push({id:'t1',title:'Revisar kernel',priority:'high',dueDate:'2026-07-26',estimate:30,done:false,projectId:'p1',orbitId:'o1'});
  const originalFetch=globalThis.fetch;
  let fetched=false;
  globalThis.fetch=()=>{fetched=true;throw new Error('no debe llamarse');};
  try{
    const answer=await askAssistant('¿Qué debería hacer primero hoy?',state,'Primero trabaja en “Revisar kernel”.');
    assert.equal(answer.source,'kernel');
    assert.equal(fetched,false);
  }finally{globalThis.fetch=originalFetch;}
});

test('el contexto diario excluye el bloque financiero',()=>{
  const state=baseState();
  const context=compactContext('¿Qué debería hacer primero hoy?',state);
  assert.equal(context.intent,'day');
  assert.ok(context.plan);
  assert.equal('finance' in context,false);
});

test('el filtro rechaza informes financieros en inglés fuera de finanzas',()=>{
  const issue=modelAnswerIssue('¿Qué debería hacer primero hoy?','## Summary of Financial Data:\nIncome: 100\nExpenses: 20\nRecommendations: invest the surplus.','day');
  assert.match(issue,/inglés|finanzas|desvió/i);
  assert.equal(modelAnswerIssue('¿Cómo va el proyecto?','El proyecto tiene dos tareas abiertas y conviene comenzar por la primera.','project'),'');
});

test('un segmento corregido cuenta como resuelto para la validación',()=>{
  const state=baseState();
  const result=interpret('Para PixelPy:\n- crea tarea revisar interfaz\n- quizá algo para después',state);
  result.proposal.ambiguities[0].resolution='replaced';
  refreshProposal(state,result.proposal);
  assert.equal(result.proposal.validation.status,'ready');
});


test('el contexto financiero entrega cifras compactas sin volcar colecciones completas',()=>{
  const state=baseState();
  state.settings.monthlyBudget=1000000;
  state.transactions.push(
    {id:'income',type:'income',description:'Sueldo',amount:2000000,category:'Ingresos',date:new Date().toISOString().slice(0,7)+'-01',status:'confirmed'},
    {id:'expense',type:'expense',description:'Comida',amount:120000,category:'Alimentación',date:new Date().toISOString().slice(0,7)+'-02',status:'confirmed'}
  );
  const context=compactContext('¿Cómo van mis finanzas?',state);
  assert.equal(context.intent,'finance');
  assert.equal(context.finance.actualIncome,2000000);
  assert.equal(context.finance.actualExpense,120000);
  assert.equal(context.finance.confirmedResult,1880000);
  assert.deepEqual(context.finance.categories[0],{category:'Alimentación',amount:120000});
  assert.equal('transactions' in context,false);
  assert.equal('ledger' in context.finance,false);
  assert.ok(Array.isArray(context.finance.recentConfirmed));
});

test('el filtro financiero rechaza tablas e informes extensos',()=>{
  assert.match(modelAnswerIssue('¿Cómo van mis finanzas?','| Dato | Valor |\n|---|---|\n| Ingresos | 100 |','finance'),/tabla|informe/i);
  assert.match(modelAnswerIssue('¿Cómo van mis finanzas?','a'.repeat(900),'finance'),/extensa/i);
  assert.equal(modelAnswerIssue('¿Cómo van mis finanzas?','El gasto está controlado, pero conviene revisar los compromisos pendientes antes de asumir nuevas compras.','finance'),'');
});
