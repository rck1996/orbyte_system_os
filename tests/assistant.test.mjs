import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, answerQuery, interpret } from '../modules/assistant/engine.js';

const state={
  profile:{name:'Erick'},
  settings:{monthlyBudget:100000,workdayMinutes:120},
  orbits:[{id:'o1',name:'Vida',code:'LIFE'},{id:'o2',name:'Construir',code:'BUILD'}],
  projects:[
    {id:'p1',orbitId:'o2',title:'ORBYTE_',status:'active',createdAt:'2026-07-01'},
    {id:'p2',orbitId:'o2',title:'PixelPy',status:'active',createdAt:'2026-07-02'}
  ],
  tasks:[{id:'t1',title:'Probar kernel',projectId:'p1',orbitId:'o2',priority:'high',dueDate:'2026-07-20',estimate:30,done:false}],
  habits:[],events:[],notes:[],transactions:[],assets:[],activity:[]
};

test('compra crea gasto e inventario conectados',()=>{
  const result=interpret('Compré una Audient EVO 4 por 120.000 para ORBYTE_',state);
  assert.equal(result.kind,'proposal');
  assert.deepEqual(result.proposal.operations.map(op=>op.collection),['transactions','assets']);
  assert.equal(result.proposal.operations[0].data.projectId,'p1');
});

test('orden compuesta registra dos compras y no crea un proyecto existente',()=>{
  const result=interpret('agrega estas compras: 2 ram de 16gb por 140 mil pesos, un cpu i5 por 40 mil pesos todo esto para el proyecto pixelpy',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.title,'Registrar compras conectadas');
  assert.deepEqual(result.proposal.operations.map(op=>op.collection),['transactions','assets','transactions','assets']);
  const [ramTx,ramAsset,cpuTx,cpuAsset]=result.proposal.operations.map(op=>op.data);
  assert.equal(ramTx.amount,140000);
  assert.equal(ramTx.projectId,'p2');
  assert.equal(ramAsset.quantity,2);
  assert.equal(ramAsset.unitAmount,70000);
  assert.match(ramAsset.title,/RAM/);
  assert.equal(cpuTx.amount,40000);
  assert.equal(cpuAsset.quantity,1);
  assert.match(cpuAsset.title,/CPU i5/i);
  assert.equal(result.proposal.operations.some(op=>op.collection==='projects'),false);
});

test('mencionar un proyecto no significa crear uno',()=>{
  const result=interpret('anota una idea para el proyecto PixelPy',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.operations[0].collection,'notes');
  assert.equal(result.proposal.operations[0].data.projectId,'p2');
  assert.equal(result.proposal.operations.some(op=>op.collection==='projects'),false);
});

test('si un proyecto explícito no existe lo incluye en la misma propuesta y vincula la compra',()=>{
  const result=interpret('agrega estas compras: un cpu por 40 mil pesos para el proyecto Fantasma',state);
  assert.equal(result.kind,'proposal');
  const [projectOp,transactionOp,assetOp]=result.proposal.operations;
  assert.equal(projectOp.collection,'projects');
  assert.equal(projectOp.data.title,'Fantasma');
  assert.equal(transactionOp.data.projectId,projectOp.data.id);
  assert.equal(assetOp.data.projectId,projectOp.data.id);
  assert.equal(result.proposal.createdProjectCount,1);
});

test('una lista de compras hereda un proyecto inexistente en todas sus líneas',()=>{
  const result=interpret(`Agrega estas compras para NuevoPixel:\n2 RAM de 16 GB por 140.000 pesos\n1 CPU i5 por 40.000 pesos`,state);
  assert.equal(result.kind,'proposal');
  const project=result.proposal.operations.find(op=>op.collection==='projects');
  const transactions=result.proposal.operations.filter(op=>op.collection==='transactions');
  const assets=result.proposal.operations.filter(op=>op.collection==='assets');
  assert.equal(project.data.title,'NuevoPixel');
  assert.equal(transactions.length,2);
  assert.equal(assets.length,2);
  assert.ok([...transactions,...assets].every(op=>op.data.projectId===project.data.id));
  assert.equal(transactions.reduce((sum,op)=>sum+op.data.amount,0),180000);
  assert.equal(result.proposal.sections[0].items.length,3);
});

test('un mensaje largo puede operar sobre varios proyectos en una confirmación',()=>{
  const result=interpret(`Para HomeLab:\n- compra un SSD por 50 mil pesos\n- crea una tarea montar servidor mañana\nPara PixelPy:\n- agrega nota: mantener compatibilidad con teclado\n- agenda revisión el viernes a las 19:00`,state);
  assert.equal(result.kind,'proposal');
  const homeLab=result.proposal.operations.find(op=>op.collection==='projects'&&op.data.title==='HomeLab');
  assert.ok(homeLab);
  const homeLabOps=result.proposal.operations.filter(op=>op.data?.projectId===homeLab.data.id);
  assert.deepEqual(homeLabOps.map(op=>op.collection),['transactions','assets','tasks']);
  const pixelOps=result.proposal.operations.filter(op=>op.data?.projectId==='p2');
  assert.deepEqual(pixelOps.map(op=>op.collection),['notes','events']);
  assert.equal(result.proposal.logicalActions,4);
  assert.equal(result.proposal.sections.length,2);
});

test('acciones simultáneas en una misma línea conservan el contexto del proyecto',()=>{
  const result=interpret('Para PixelPy: crea una tarea revisar la interfaz mañana y agrega una nota: mantener el diseño editorial',state);
  assert.equal(result.kind,'proposal');
  const collections=result.proposal.operations.map(op=>op.collection);
  assert.deepEqual(collections,['tasks','notes']);
  assert.ok(result.proposal.operations.every(op=>op.data.projectId==='p2'));
});

test('puede crear varios proyectos explícitos sin duplicarlos',()=>{
  const result=interpret('Crea los proyectos Casa, Música y HomeLab',state);
  assert.equal(result.kind,'proposal');
  const projectOps=result.proposal.operations.filter(op=>op.collection==='projects');
  assert.deepEqual(projectOps.map(op=>op.data.title),['Casa','Música','HomeLab']);
  assert.equal(new Set(projectOps.map(op=>op.data.id)).size,3);
});

test('una orden de tarea produce propuesta, no escritura directa',()=>{
  const result=interpret('Preparar presentación mañana urgente para ORBYTE_',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.operations[0].data.priority,'high');
  assert.equal(result.proposal.operations[0].data.projectId,'p1');
});

test('consulta de proyecto usa kernel',()=>{
  const result=interpret('Resume el proyecto ORBYTE_',state);
  assert.equal(result.query,'project');
  assert.match(answerQuery(result,state,new Date('2026-07-24T10:00:00')),/riesgo/);
});

test('aplica operaciones auditables',()=>{
  const copy=structuredClone(state);
  applyOperations(copy,[{type:'update',collection:'tasks',id:'t1',patch:{done:true}}]);
  assert.equal(copy.tasks[0].done,true);
});

test('aplica primero proyectos nuevos y luego sus elementos conectados',()=>{
  const copy=structuredClone(state);
  const result=interpret(`Para HomeLab:\n- crea tarea montar switch\n- compra un SSD por 60 mil pesos`,copy);
  assert.equal(result.proposal.operations[0].collection,'projects');
  applyOperations(copy,result.proposal.operations);
  const project=copy.projects.find(item=>item.title==='HomeLab');
  assert.ok(project);
  assert.equal(copy.tasks.at(-1).projectId,project.id);
  assert.equal(copy.assets.at(-1).projectId,project.id);
});

test('una pregunta libre conversa y no crea una tarea',()=>{
  const current=structuredClone(state);
  const result=interpret('¿Qué me recomiendas hacer con PixelPy esta semana?',current);
  assert.equal(result.kind,'query');
  assert.equal(result.query,'project');
});

test('una pregunta general se deriva a conversación',()=>{
  const current=structuredClone(state);
  const result=interpret('¿Puedes ayudarme a ordenar mis prioridades?',current);
  assert.equal(result.kind,'query');
  assert.equal(result.query,'general');
});


test('compras consecutivas en una línea pueden cambiar de proyecto sin repetir el verbo',()=>{
  const result=interpret('compre 1 servidor por 3000 para el proyecto orbyte, tambien 1 pc por 10 mil para el proyecto nuevo Drawing',state);
  assert.equal(result.kind,'proposal');
  const project=result.proposal.operations.find(op=>op.collection==='projects');
  assert.ok(project);
  assert.equal(project.data.title,'Drawing');
  const transactions=result.proposal.operations.filter(op=>op.collection==='transactions');
  const assets=result.proposal.operations.filter(op=>op.collection==='assets');
  assert.equal(transactions.length,2);
  assert.equal(transactions[0].data.amount,3000);
  assert.equal(transactions[0].data.projectId,'p1');
  assert.equal(transactions[1].data.amount,10000);
  assert.equal(transactions[1].data.projectId,project.data.id);
  assert.equal(assets[1].data.title,'PC');
  assert.equal(assets[0].data.category,'Tecnología');
  assert.deepEqual(result.proposal.sections.map(section=>section.title),['ORBYTE_','Drawing']);
  assert.equal(result.proposal.createdProjectCount,1);
});

test('un conector y permite una segunda compra con proyecto propio',()=>{
  const result=interpret('compra un monitor por 80 mil para PixelPy y 1 servidor por 300 mil para el proyecto nuevo HomeLab',state);
  assert.equal(result.kind,'proposal');
  const project=result.proposal.operations.find(op=>op.collection==='projects');
  const transactions=result.proposal.operations.filter(op=>op.collection==='transactions');
  assert.equal(project.data.title,'HomeLab');
  assert.equal(transactions[0].data.projectId,'p2');
  assert.equal(transactions[1].data.projectId,project.data.id);
  assert.equal(transactions.reduce((sum,op)=>sum+op.data.amount,0),380000);
});

test('un consumible compuesto no se divide ni ensucia el inventario',()=>{
  const result=interpret('compra pan y queso por 5 mil para el proyecto ORBYTE_',state);
  assert.equal(result.kind,'proposal');
  const transactions=result.proposal.operations.filter(op=>op.collection==='transactions');
  const assets=result.proposal.operations.filter(op=>op.collection==='assets');
  assert.equal(transactions.length,1);
  assert.equal(assets.length,0);
  assert.match(transactions[0].data.description,/Pan y queso/i);
  assert.equal(transactions[0].data.category,'Alimentación');
  assert.equal(transactions[0].data.projectId,'p1');
});


test('un ingreso por venta se resume como una transacción semántica',()=>{
  const result=interpret('tuve un ingreso nuevo ya que vendi mi pc por 100 mil',state);
  assert.equal(result.kind,'proposal');
  const transaction=result.proposal.operations.find(op=>op.collection==='transactions').data;
  assert.equal(transaction.type,'income');
  assert.equal(transaction.amount,100000);
  assert.equal(transaction.description,'Venta de PC');
  assert.equal(transaction.category,'Ventas');
  assert.equal(transaction.projectId,'');
  assert.equal(transaction.orbitId,'');
  assert.match(transaction.sourceText,/vendi mi pc/i);
});

test('vender directamente también se interpreta como ingreso',()=>{
  const result=interpret('vendí una GPU por 250 mil pesos',state);
  assert.equal(result.kind,'proposal');
  const transaction=result.proposal.operations.find(op=>op.collection==='transactions').data;
  assert.equal(transaction.description,'Venta de GPU');
  assert.equal(transaction.amount,250000);
  assert.equal(transaction.category,'Ventas');
});

test('un sueldo se normaliza sin guardar la frase completa',()=>{
  const result=interpret('recibí mi sueldo de 2 millones',state);
  assert.equal(result.kind,'proposal');
  const transaction=result.proposal.operations.find(op=>op.collection==='transactions').data;
  assert.equal(transaction.description,'Sueldo');
  assert.equal(transaction.category,'Sueldo');
  assert.equal(transaction.amount,2000000);
});

test('un pago por servicio conserva solo el concepto útil',()=>{
  const result=interpret('me pagaron por desarrollar una landing por 350 mil',state);
  assert.equal(result.kind,'proposal');
  const transaction=result.proposal.operations.find(op=>op.collection==='transactions').data;
  assert.equal(transaction.description,'Pago por desarrollar una landing');
  assert.equal(transaction.category,'Trabajo');
  assert.equal(transaction.amount,350000);
});

test('las tareas conversacionales se resumen y conservan la frase original',()=>{
  const result=interpret('tengo que revisar la interfaz mañana para PixelPy',state);
  const task=result.proposal.operations.find(op=>op.collection==='tasks').data;
  assert.equal(task.title,'Revisar la interfaz');
  assert.equal(task.projectId,'p2');
  assert.match(task.sourceText,/tengo que revisar/i);
  assert.ok(task.dueDate);
});

test('las notas guardan el hecho útil y no el mandato conversacional',()=>{
  const result=interpret('recuerda que la app debe funcionar sin conexión para PixelPy',state);
  const note=result.proposal.operations.find(op=>op.collection==='notes').data;
  assert.equal(note.title,'La app debe funcionar sin conexión');
  assert.equal(note.content,'La app debe funcionar sin conexión');
  assert.match(note.sourceText,/recuerda que/i);
});

test('los eventos limpian fecha y hora del título',()=>{
  const result=interpret('tengo una reunión con Juan el viernes a las 7 pm para ORBYTE_',state);
  const event=result.proposal.operations.find(op=>op.collection==='events').data;
  assert.equal(event.title,'Reunión con Juan');
  assert.equal(event.time,'19:00');
  assert.ok(event.date);
  assert.equal(event.projectId,'p1');
});

test('un evento sin fecha queda explícitamente sin fecha y avisa',()=>{
  const result=interpret('tengo una reunión con Ana',state);
  const event=result.proposal.operations.find(op=>op.collection==='events').data;
  assert.equal(event.title,'Reunión con Ana');
  assert.equal(event.date,'');
  assert.match(result.proposal.warnings[0],/sin fecha/i);
});

test('los hábitos extraen actividad y frecuencia semanal',()=>{
  const result=interpret('quiero empezar a nadar martes y jueves',state);
  const habit=result.proposal.operations.find(op=>op.collection==='habits').data;
  assert.equal(habit.title,'Nadar');
  assert.deepEqual(habit.targetDays,[2,4]);
  assert.equal(habit.orbitId,'');
});

test('un hábito sin frecuencia no inventa días objetivo',()=>{
  const result=interpret('crea un hábito de leer',state);
  const habit=result.proposal.operations.find(op=>op.collection==='habits').data;
  assert.equal(habit.title,'Leer');
  assert.deepEqual(habit.targetDays,[]);
  assert.match(result.proposal.assumptions[0],/sin días objetivo/i);
});

test('los proyectos naturales separan nombre y objetivo',()=>{
  const result=interpret('quiero crear un proyecto llamado HomeLab para organizar mi servidor',state);
  const project=result.proposal.operations.find(op=>op.collection==='projects').data;
  assert.equal(project.title,'HomeLab');
  assert.equal(project.goal,'Organizar mi servidor');
  assert.match(project.sourceText,/HomeLab/i);
});

test('los gastos se resumen semánticamente y quedan sin vínculo cuando corresponde',()=>{
  const result=interpret('pagué 25 mil de bencina',state);
  const transaction=result.proposal.operations.find(op=>op.collection==='transactions').data;
  assert.equal(transaction.description,'Bencina');
  assert.equal(transaction.category,'Transporte');
  assert.equal(transaction.projectId,'');
  assert.equal(transaction.orbitId,'');
});

test('una compra con cantidad ambigua muestra la suposición usada',()=>{
  const result=interpret('compré 2 RAM de 16 GB por 140 mil para PixelPy',state);
  assert.match(result.proposal.assumptions[0],/como total/i);
  const asset=result.proposal.operations.find(op=>op.collection==='assets').data;
  assert.equal(asset.quantity,2);
  assert.equal(asset.unitAmount,70000);
  assert.match(asset.sourceText,/compré 2 RAM/i);
});

test('una finalización conversacional completa la tarea correcta',()=>{
  const result=interpret('ya terminé de probar el kernel para ORBYTE_',state);
  const operation=result.proposal.operations.find(op=>op.collection==='tasks');
  assert.equal(operation.type,'update');
  assert.equal(operation.id,'t1');
  assert.equal(operation.patch.done,true);
});

test('un texto ambiguo no se convierte silenciosamente en tarea',()=>{
  const result=interpret('esto es solo una reflexión sin acción',state);
  assert.equal(result.kind,'message');
  assert.match(result.message,/no una operación segura/i);
});

test('un mensaje largo mantiene semántica y contexto en todos los módulos',()=>{
  const result=interpret(`Para PixelPy:\n- tengo que revisar la interfaz mañana\n- recuerda que debe funcionar sin conexión\n- tengo una reunión con Ana el viernes a las 18:30\n- quiero empezar a probar la app lunes y jueves\n- pagué 20 mil de hosting\n- vendí un monitor por 80 mil`,state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.logicalActions,6);
  const operations=result.proposal.operations;
  assert.deepEqual(operations.map(op=>op.collection),['tasks','notes','events','habits','transactions','transactions']);
  assert.ok(operations.every(op=>op.data?.projectId==='p2'));
  assert.equal(operations[0].data.title,'Revisar la interfaz');
  assert.equal(operations[1].data.content,'Debe funcionar sin conexión');
  assert.equal(operations[2].data.title,'Reunión con Ana');
  assert.equal(operations[3].data.title,'Probar la app');
  assert.equal(operations[4].data.description,'Hosting');
  assert.equal(operations[5].data.description,'Venta de monitor');
});

test('un gasto mensual crea una regla recurrente y no un movimiento confirmado',()=>{
  const result=interpret('Pago Netflix 8.990 todos los meses',state);
  assert.equal(result.kind,'proposal');
  const operation=result.proposal.operations[0];
  assert.equal(operation.collection,'recurringTransactions');
  assert.equal(operation.data.description,'Netflix');
  assert.equal(operation.data.frequency,'monthly');
  assert.equal(operation.data.subtype,'subscription');
});

test('un ingreso recurrente reconoce el último día hábil',()=>{
  const result=interpret('Recibo mi sueldo de 2.200.000 el último día hábil de cada mes',state);
  const operation=result.proposal.operations[0];
  assert.equal(operation.collection,'recurringTransactions');
  assert.equal(operation.data.type,'income');
  assert.equal(operation.data.description,'Sueldo');
  assert.equal(operation.data.dayRule,'last-business-day');
});

test('una compra en cuotas crea plan, primera cuota e inventario sin ensuciar el nombre',()=>{
  const result=interpret('Compré un SSD de 120.000 en 3 cuotas para ORBYTE_',state);
  assert.deepEqual(result.proposal.operations.map(op=>op.collection),['installmentPlans','transactions','assets']);
  const plan=result.proposal.operations[0].data;
  assert.equal(plan.description,'SSD');
  assert.equal(plan.installments,3);
  assert.equal(plan.installmentAmount,40000);
});

test('una compra futura conecta objetivo, proyección y tarea de cotización',()=>{
  const result=interpret('Para septiembre quiero comprar un SSD de 120.000 para ORBYTE_',state);
  assert.deepEqual(result.proposal.operations.map(op=>op.collection),['financialGoals','transactions','tasks']);
  const [goal,transaction,task]=result.proposal.operations.map(op=>op.data);
  assert.equal(goal.title,'Comprar SSD');
  assert.equal(transaction.status,'planned');
  assert.equal(transaction.financialGoalId,goal.id);
  assert.equal(task.financialGoalId,goal.id);
  assert.match(task.title,/Cotizar SSD/);
});

test('frecuencias no diarias se interpretan como hábito y limpian el título',()=>{
  const monthly=interpret('Revisar presupuesto 1 vez al mes',state).proposal.operations[0].data;
  assert.equal(monthly.title,'Revisar presupuesto');
  assert.equal(monthly.schedule.type,'timesPerMonth');
  assert.equal(monthly.schedule.targetCount,1);
  const interval=interpret('Cambiar sábanas cada 14 días',state).proposal.operations[0].data;
  assert.equal(interval.title,'Cambiar sábanas');
  assert.equal(interval.schedule.type,'interval');
  assert.equal(interval.schedule.intervalDays,14);
});

test('una tarea llamada conserva su tipo y limpia el título',()=>{
  const result=interpret('Crea una tarea llamada Revisar presupuesto para mañana',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.title,'Crear tarea');
  const task=result.proposal.operations[0];
  assert.equal(task.collection,'tasks');
  assert.equal(task.data.title,'Revisar presupuesto');
  assert.ok(task.data.dueDate);
});

test('un verbo de compra dentro del título explícito no cambia la tarea a compra',()=>{
  const result=interpret('Agrega la tarea Comprar cable para mañana',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.operations.length,1);
  assert.equal(result.proposal.operations[0].collection,'tasks');
  assert.equal(result.proposal.operations[0].data.title,'Comprar cable');
});

test('una solicitud mixta conserva la operación válida y bloquea solo el segmento ambiguo',()=>{
  const result=interpret('Agrega la tarea Comprar cable para mañana\nLo otro déjalo como hablamos',state);
  assert.equal(result.kind,'proposal');
  assert.equal(result.proposal.operations.length,1);
  assert.equal(result.proposal.operations[0].collection,'tasks');
  assert.equal(result.proposal.ambiguities.length,1);
  assert.equal(result.proposal.validation.status,'blocked');
});

test('las recurrencias se describen en español',()=>{
  const result=interpret('Pago Netflix 8.990 todos los meses',state);
  assert.match(result.proposal.sections[0].items[0],/mensual/);
  assert.doesNotMatch(result.proposal.sections[0].items[0],/monthly/);
});

test('qué debería hacer primero hoy se enruta al plan diario',()=>{
  const result=interpret('¿Qué debería hacer primero hoy?',state);
  assert.equal(result.kind,'query');
  assert.equal(result.query,'plan');
  const answer=answerQuery(result,state,new Date('2026-07-24T10:00:00'));
  assert.match(answer,/Primero trabaja en/);
  assert.match(answer,/Probar kernel/);
});
