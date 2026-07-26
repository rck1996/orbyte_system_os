import { id } from '../../storage/store.js';

const COLLECTIONS = new Set([
  'projects','tasks','notes','events','habits','transactions','recurringTransactions',
  'installmentPlans','budgets','financialGoals','assets','skippedOccurrences','monthReviews',
  'captures'
]);
const OPERATION_TYPES = new Set(['create','update','delete','replace']);
const PROJECT_LINKED_COLLECTIONS = new Set(['tasks','notes','events','habits','transactions','recurringTransactions','installmentPlans','financialGoals','assets']);
const ORBIT_LINKED_COLLECTIONS = new Set(['projects',...PROJECT_LINKED_COLLECTIONS]);
const clone = value => structuredClone(value);
const active = operations => (Array.isArray(operations) ? operations : []).filter(operation => operation && operation.enabled !== false);
const issue = (code,message,{severity='blocker',operationId='',field='',segmentId=''}={}) => ({code,message,severity,operationId,field,segmentId});
const operationPayload = operation => operation.type === 'update' ? operation.patch : operation.data;

export function ensureOperationIds(proposal) {
  if (!proposal || typeof proposal !== 'object') return proposal;
  proposal.operations = Array.isArray(proposal.operations) ? proposal.operations : [];
  for (const operation of proposal.operations) {
    if (!operation.opId) operation.opId = id('op');
    if (operation.enabled === undefined) operation.enabled = true;
    if (!operation.meta || typeof operation.meta !== 'object') operation.meta = {};
  }
  return proposal;
}

function validateRequired(operation, data, issues) {
  const add = (code,message,field) => issues.push(issue(code,message,{operationId:operation.opId,field}));
  const positive = field => Number(data?.[field]) > 0;
  if (operation.collection === 'projects' && !String(data?.title||'').trim()) add('project-title','El proyecto necesita un nombre.','title');
  if (operation.collection === 'tasks' && !String(data?.title||'').trim()) add('task-title','La acción necesita un título.','title');
  if (operation.collection === 'notes' && !String(data?.content||data?.title||'').trim()) add('note-content','La nota necesita contenido.','content');
  if (operation.collection === 'events') {
    if (!String(data?.title||'').trim()) add('event-title','El evento necesita un título.','title');
    if (!String(data?.date||'').trim()) add('event-date','El evento necesita una fecha concreta.','date');
  }
  if (operation.collection === 'transactions') {
    if (!String(data?.description||'').trim()) add('transaction-description','El movimiento necesita un concepto.','description');
    if (!positive('amount')) add('transaction-amount','El movimiento necesita un monto mayor que cero.','amount');
    if (!['income','expense'].includes(data?.type)) add('transaction-type','El movimiento debe ser ingreso o gasto.','type');
    if (!String(data?.date||'').trim()) add('transaction-date','El movimiento necesita una fecha.','date');
  }
  if (operation.collection === 'recurringTransactions') {
    if (!String(data?.description||'').trim()) add('recurring-description','La recurrencia necesita un concepto.','description');
    if (!positive('amount')) add('recurring-amount','La recurrencia necesita un monto mayor que cero.','amount');
    if (!String(data?.frequency||'').trim()) add('recurring-frequency','La recurrencia necesita una frecuencia.','frequency');
    if (!String(data?.startDate||'').trim()) add('recurring-start','La recurrencia necesita una fecha de inicio.','startDate');
  }
  if (operation.collection === 'habits') {
    if (!String(data?.title||'').trim()) add('habit-title','El hábito necesita un nombre.','title');
    if (!String(data?.schedule?.type||'').trim()) add('habit-schedule','El hábito necesita una frecuencia válida.','schedule');
  }
  if (operation.collection === 'installmentPlans') {
    if (!String(data?.description||'').trim()) add('installment-description','El plan de cuotas necesita un nombre.','description');
    if (!positive('totalAmount')) add('installment-total','El plan de cuotas necesita un total mayor que cero.','totalAmount');
    if (Number(data?.installments) < 2) add('installment-count','El plan de cuotas necesita al menos dos cuotas.','installments');
    if (!String(data?.firstDate||'').trim()) add('installment-date','El plan de cuotas necesita la fecha de la primera cuota.','firstDate');
  }
  if (operation.collection === 'financialGoals') {
    if (!String(data?.title||'').trim()) add('goal-title','El objetivo financiero necesita un nombre.','title');
    if (!positive('amount')) add('goal-amount','El objetivo financiero necesita un monto mayor que cero.','amount');
    if (!String(data?.targetDate||'').trim()) add('goal-date','El objetivo financiero necesita una fecha objetivo.','targetDate');
  }
  if (operation.collection === 'assets') {
    if (!String(data?.title||'').trim()) add('asset-title','El objeto de inventario necesita un nombre.','title');
    if (Number(data?.quantity||1) < 1) add('asset-quantity','La cantidad de inventario debe ser al menos uno.','quantity');
  }
}

export function validateProposal(state, proposal) {
  ensureOperationIds(proposal);
  const issues=[];
  const operations=active(proposal.operations);
  if (!operations.length) issues.push(issue('empty-proposal','La propuesta no contiene cambios habilitados.'));
  const createdProjects=new Set();
  const createdIds=new Map();
  for (const operation of operations) {
    if (!OPERATION_TYPES.has(operation.type)) {
      issues.push(issue('operation-type',`Tipo de operación no permitido: ${operation.type}.`,{operationId:operation.opId}));
      continue;
    }
    if (!COLLECTIONS.has(operation.collection)) {
      issues.push(issue('operation-collection',`Colección no permitida: ${operation.collection}.`,{operationId:operation.opId}));
      continue;
    }
    const data=operationPayload(operation)||{};
    if (operation.type === 'create' || operation.type === 'replace') {
      if (!data.id) issues.push(issue('missing-id','El cambio necesita un identificador estable.',{operationId:operation.opId,field:'id'}));
      else if (createdIds.has(data.id)) issues.push(issue('duplicate-id',`El identificador ${data.id} aparece más de una vez.`,{operationId:operation.opId,field:'id'}));
      else createdIds.set(data.id,operation.opId);
    }
    if (operation.type === 'update' || operation.type === 'delete' || operation.type === 'replace') {
      if (!operation.id && !data.id) issues.push(issue('target-id','La operación necesita identificar el elemento a modificar.',{operationId:operation.opId}));
    }
    if (operation.collection === 'projects' && operation.type === 'create' && data.id) createdProjects.add(data.id);
    if (operation.meta?.requiresApproval && !operation.meta?.approved) {
      issues.push(issue('project-approval',`La creación del proyecto “${data.title||'sin nombre'}” requiere autorización explícita.`,{operationId:operation.opId,field:'approval'}));
    }
    if (operation.type !== 'delete') validateRequired(operation,data,issues);
  }

  const validProjects=new Set((state.projects||[]).map(project=>project.id));
  for (const projectId of createdProjects) validProjects.add(projectId);
  const validOrbits=new Set((state.orbits||[]).map(orbit=>orbit.id));
  for (const operation of operations) {
    if (operation.type === 'delete') continue;
    const data=operationPayload(operation)||{};
    if (PROJECT_LINKED_COLLECTIONS.has(operation.collection) && data.projectId && !validProjects.has(data.projectId)) {
      issues.push(issue('project-reference',`El proyecto vinculado a “${data.title||data.description||operation.collection}” no existe o no está habilitado.`,{operationId:operation.opId,field:'projectId'}));
    }
    if (ORBIT_LINKED_COLLECTIONS.has(operation.collection) && data.orbitId && !validOrbits.has(data.orbitId)) {
      issues.push(issue('orbit-reference',`La órbita vinculada a “${data.title||data.description||operation.collection}” no existe.`,{operationId:operation.opId,field:'orbitId'}));
    }
  }

  for (const ambiguity of proposal.ambiguities||[]) {
    if (!['ignore','replaced'].includes(ambiguity.resolution)) {
      issues.push(issue('ambiguous-segment',`Debes resolver o ignorar explícitamente: “${ambiguity.text}”.`,{segmentId:ambiguity.id}));
    }
  }
  for (const warning of proposal.warnings||[]) issues.push(issue('planner-warning',warning,{severity:'warning'}));
  const blockers=issues.filter(item=>item.severity==='blocker');
  const warnings=issues.filter(item=>item.severity!=='blocker');
  return {status:blockers.length?'blocked':'ready',blockers,warnings,checkedAt:new Date().toISOString()};
}

export function refreshProposal(state, proposal) {
  ensureOperationIds(proposal);
  proposal.validation=validateProposal(state,proposal);
  return proposal;
}

function assertCollection(state, collection) {
  if (!COLLECTIONS.has(collection) || !Array.isArray(state[collection])) throw new Error(`Colección inválida: ${collection}`);
  return state[collection];
}

function applyOne(target,operation,beforeByOperation) {
  const collection=assertCollection(target,operation.collection);
  const opId=operation.opId||id('op');
  operation.opId=opId;
  if (operation.type==='create') {
    const data=clone(operation.data||{});
    if (!data.id) throw new Error('Una creación requiere id');
    if (collection.some(item=>item.id===data.id)) throw new Error(`El id ${data.id} ya existe en ${operation.collection}`);
    const index=Number.isInteger(operation.meta?.index)?Math.max(0,Math.min(collection.length,operation.meta.index)):collection.length;
    collection.splice(index,0,data);
    beforeByOperation[opId]=null;
    return {type:'delete',collection:operation.collection,id:data.id,opId:id('op'),meta:{undoOf:opId}};
  }
  const targetId=operation.id||operation.data?.id;
  const index=collection.findIndex(item=>item.id===targetId);
  if (index<0) throw new Error(`No se encontró ${targetId} en ${operation.collection}`);
  const before=clone(collection[index]);
  beforeByOperation[opId]=before;
  if (operation.type==='update') {
    collection[index]={...collection[index],...clone(operation.patch||{})};
    return {type:'replace',collection:operation.collection,id:targetId,data:before,opId:id('op'),meta:{undoOf:opId}};
  }
  if (operation.type==='replace') {
    const data={...clone(operation.data||{}),id:targetId};
    collection[index]=data;
    return {type:'replace',collection:operation.collection,id:targetId,data:before,opId:id('op'),meta:{undoOf:opId}};
  }
  if (operation.type==='delete') {
    collection.splice(index,1);
    return {type:'create',collection:operation.collection,data:before,opId:id('op'),meta:{undoOf:opId,index}};
  }
  throw new Error(`Operación no soportada: ${operation.type}`);
}

function validateReferences(state) {
  const projectIds=new Set((state.projects||[]).map(item=>item.id));
  const orbitIds=new Set((state.orbits||[]).map(item=>item.id));
  for (const collection of PROJECT_LINKED_COLLECTIONS) {
    for (const item of state[collection]||[]) if (item.projectId && !projectIds.has(item.projectId)) throw new Error(`Referencia de proyecto inválida en ${collection}: ${item.projectId}`);
  }
  for (const collection of ORBIT_LINKED_COLLECTIONS) {
    for (const item of state[collection]||[]) if (item.orbitId && !orbitIds.has(item.orbitId)) throw new Error(`Referencia de órbita inválida en ${collection}: ${item.orbitId}`);
  }
}

export function applyOperationsAtomic(state, operations) {
  const enabled=active(operations).map(clone);
  const working=clone(state);
  const inverse=[];
  const beforeByOperation={};
  const touched=new Set();
  for (const operation of enabled) {
    if (!OPERATION_TYPES.has(operation.type)) throw new Error(`Operación no soportada: ${operation.type}`);
    touched.add(operation.collection);
    inverse.push(applyOne(working,operation,beforeByOperation));
  }
  validateReferences(working);
  for (const collection of touched) state[collection]=working[collection];
  return {forwardOperations:enabled,inverseOperations:inverse.reverse(),beforeByOperation,touchedCollections:[...touched]};
}

export function reconcileAppliedOperations(state, oldOperations, newOperations, application={}) {
  const oldMap=new Map(active(oldOperations).map(operation=>[operation.opId,operation]));
  const newMap=new Map(active(newOperations).map(operation=>[operation.opId,operation]));
  const applicationBeforeByOperation=clone(application.beforeByOperation||{});
  const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const currentItem=operation=>{
    const collection=assertCollection(state,operation.collection);
    const targetId=operation.id||operation.data?.id;
    return collection.find(item=>item.id===targetId);
  };
  const rememberBaseline=operation=>{
    if(hasOwn(applicationBeforeByOperation,operation.opId))return;
    applicationBeforeByOperation[operation.opId]=operation.type==='create'?null:clone(currentItem(operation)||null);
  };
  const editedUpdate=(current,baseline,oldPatch={},nextPatch={})=>{
    const desired=clone(current);
    for(const key of Object.keys(oldPatch)){
      if(hasOwn(nextPatch,key))continue;
      if(baseline&&hasOwn(baseline,key))desired[key]=clone(baseline[key]);
      else delete desired[key];
    }
    for(const [key,value] of Object.entries(nextPatch))desired[key]=clone(value);
    return desired;
  };
  const delta=[];
  for(const [opId,oldOperation] of oldMap) {
    const next=newMap.get(opId);
    const baseline=applicationBeforeByOperation[opId];
    if (oldOperation.type==='create') {
      if(next&&next.type!=='create')throw new Error('No se puede cambiar el tipo de una creación aplicada');
      if (next) delta.push({type:'replace',collection:oldOperation.collection,id:oldOperation.data.id,data:clone(next.data),opId:id('op'),meta:{editOf:opId}});
      else delta.push({type:'delete',collection:oldOperation.collection,id:oldOperation.data.id,opId:id('op'),meta:{editOf:opId}});
    } else if (oldOperation.type==='update') {
      if(next&&next.type!=='update')throw new Error('No se puede cambiar el tipo de una actualización aplicada');
      const current=currentItem(oldOperation);
      if(!current)throw new Error(`No se encontró el elemento aplicado ${oldOperation.id}`);
      const desired=editedUpdate(current,baseline,oldOperation.patch||{},next?.patch||{});
      delta.push({type:'replace',collection:oldOperation.collection,id:oldOperation.id,data:desired,opId:id('op'),meta:{editOf:opId}});
    } else if (oldOperation.type==='replace') {
      if(next&&next.type!=='replace')throw new Error('No se puede cambiar el tipo de un reemplazo aplicado');
      if(next)delta.push({type:'replace',collection:oldOperation.collection,id:oldOperation.id||oldOperation.data?.id,data:clone(next.data),opId:id('op'),meta:{editOf:opId}});
      else if(baseline)delta.push({type:'replace',collection:oldOperation.collection,id:oldOperation.id||oldOperation.data?.id,data:clone(baseline),opId:id('op'),meta:{editOf:opId}});
    } else if (oldOperation.type==='delete') {
      if(next&&next.type!=='delete')throw new Error('No se puede cambiar el tipo de una eliminación aplicada');
      if(!next&&baseline)delta.push({type:'create',collection:oldOperation.collection,data:clone(baseline),opId:id('op'),meta:{editOf:opId}});
    }
  }
  for (const [opId,next] of newMap) if (!oldMap.has(opId)) {
    rememberBaseline(next);
    delta.push(clone(next));
  }
  const receipt=applyOperationsAtomic(state,delta);
  return {...receipt,applicationBeforeByOperation};
}

export function enabledOperations(proposalOrOperations) {
  return active(Array.isArray(proposalOrOperations)?proposalOrOperations:proposalOrOperations?.operations);
}
