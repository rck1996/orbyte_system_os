import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampScrollTop,
  composerHeight,
  conversationScrollTarget,
  formatBytes,
  isNearScrollEnd,
  shouldRestoreDocumentScroll,
  shouldSubmitComposerKey
} from '../shared/ui.js';

test('Enter envía, Shift+Enter crea línea y composición IME no envía',()=>{
  assert.equal(shouldSubmitComposerKey({key:'Enter',shiftKey:false,isComposing:false}),true);
  assert.equal(shouldSubmitComposerKey({key:'Enter',shiftKey:true,isComposing:false}),false);
  assert.equal(shouldSubmitComposerKey({key:'Enter',shiftKey:false,isComposing:true}),false);
});

test('detecta si el registro de conversación está cerca del final',()=>{
  assert.equal(isNearScrollEnd({scrollHeight:1000,scrollTop:500,clientHeight:450}),true);
  assert.equal(isNearScrollEnd({scrollHeight:1000,scrollTop:200,clientHeight:450}),false);
});

test('limita scroll e incremento de altura del compositor',()=>{
  assert.equal(clampScrollTop(900,1000,450),550);
  assert.equal(clampScrollTop(-20,1000,450),0);
  assert.equal(composerHeight(20),48);
  assert.equal(composerHeight(96),96);
  assert.equal(composerHeight(260),160);
});

test('solo restaura el documento en actualizaciones de la misma pantalla',()=>{
  assert.equal(shouldRestoreDocumentScroll({route:'edition',routeChanged:false,pendingPageScroll:false}),true);
  assert.equal(shouldRestoreDocumentScroll({route:'edition',routeChanged:true,pendingPageScroll:false}),false);
  assert.equal(shouldRestoreDocumentScroll({route:'terminal',routeChanged:false,pendingPageScroll:false}),false);
});


test('el chat restaura el final o la posición guardada de forma determinista',()=>{
  assert.equal(conversationScrollTarget({forceBottom:true,stickToBottom:false,scrollTop:120,scrollHeight:1000,clientHeight:400}),600);
  assert.equal(conversationScrollTarget({forceBottom:false,stickToBottom:true,scrollTop:120,scrollHeight:1000,clientHeight:400}),600);
  assert.equal(conversationScrollTarget({forceBottom:false,stickToBottom:false,scrollTop:120,scrollHeight:1000,clientHeight:400}),120);
});

test('formatea tamaños de modelos para ajustes',()=>{
  assert.equal(formatBytes(5225388164),'4.9 GB');
});


test('el enrutador delegado solo acepta controles de navegación reales',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const source=readFileSync(join(root,'app/main.js'),'utf8');
  assert.match(source,/closest\('button\[data-route\],a\[data-route\]'\)/);
  assert.doesNotMatch(source,/closest\('\[data-route\]'\)/);
});

test('Más usa un menú controlado y el chat conserva comandos interactivos',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const main=readFileSync(join(root,'app/main.js'),'utf8');
  const index=readFileSync(join(root,'index.html'),'utf8');
  assert.match(main,/data-more-toggle/);
  assert.match(main,/moreNavMenu/);
  assert.match(main,/const waiting=assistantBusy/);
  assert.match(index,/id="moreNavMenu"/);
  assert.match(index,/app\/main\.js\?v=4\.3\.0/);
});


test('el historial se restaura sin esperar al siguiente frame y no hay render final duplicado',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const main=readFileSync(join(root,'app/main.js'),'utf8');
  const immediate=main.indexOf('resizeComposer();\n  restoreConversationScroll();\n  requestAnimationFrame');
  assert.ok(immediate>=0,'la restauración síncrona debe ocurrir antes de requestAnimationFrame');
  assert.match(main,/log\?\.dataset\.scrollReady===['"]true['"]/);
  assert.doesNotMatch(main,/finally\s*\{\s*assistantBusy=false;\s*render\(\);/);
});


test('las propuestas operativas son estructuradas, bloqueables y editables después de aplicar',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const main=readFileSync(join(root,'app/main.js'),'utf8');
  const styles=readFileSync(join(root,'shared/styles.css'),'utf8');
  assert.match(main,/proposalOperationSummary/);
  assert.match(main,/proposal\.sections/);
  assert.match(main,/proposal\.assumptions/);
  assert.match(main,/PROPUESTA ESTRUCTURADA/);
  assert.match(main,/Confirmar y aplicar/);
  assert.match(main,/Editar aplicación/);
  assert.match(main,/reconcileAppliedOperations/);
  assert.match(main,/kind==='blocked'/);
  assert.match(styles,/\.proposal-sections/);
  assert.match(styles,/\.proposal-warnings/);
  assert.match(styles,/\.proposal-assumptions/);
  assert.match(styles,/\.proposal-blockers/);
  assert.match(styles,/\.blocked-request-card/);
  assert.match(styles,/\.operation-controls/);
});

test('el editor adapta campos de hábitos y permite corregir segmentos ambiguos',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const main=readFileSync(join(root,'app/main.js'),'utf8');
  const styles=readFileSync(join(root,'shared/styles.css'),'utf8');
  assert.match(main,/data-habit-schedule-select/);
  assert.match(main,/data-habit-field="targetCount"/);
  assert.match(main,/syncHabitScheduleFields/);
  assert.match(main,/ambiguity_\$\{item\.id\}_replacement/);
  assert.match(main,/Segmento corregido y convertido en operaciones editables/);
  assert.match(styles,/\.proposal-ambiguities/);
  assert.match(styles,/\.ambiguity-item/);
});


test('finanzas usa un panel visual y el chat muestra una tarjeta determinista',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const main=readFileSync(join(root,'app/main.js'),'utf8');
  const styles=readFileSync(join(root,'shared/styles.css'),'utf8');
  assert.match(main,/function financeCardData/);
  assert.match(main,/assistant-finance-card/);
  assert.match(main,/finance-dashboard/);
  assert.match(main,/Resultado del mes/);
  assert.match(main,/No es el saldo de tu cuenta/);
  assert.match(main,/\['finance','spending'\]\.includes\(result\.query\)/);
  assert.match(main,/data-open-finance/);
  assert.match(styles,/\.assistant-finance-card/);
  assert.match(styles,/\.finance-hero-panel/);
  assert.match(styles,/\.finance-focus-grid/);
});


test('ajustes ofrece limpieza total con confirmación explícita y respaldo previo',()=>{
  const root=dirname(dirname(fileURLToPath(import.meta.url)));
  const main=readFileSync(join(root,'app/main.js'),'utf8');
  const styles=readFileSync(join(root,'shared/styles.css'),'utf8');
  assert.match(main,/function openFreshStartDialog/);
  assert.match(main,/BORRAR TODO/);
  assert.match(main,/data-export-before-clean/);
  assert.match(main,/startFresh\(\)/);
  assert.match(main,/id="freshStart"/);
  assert.match(main,/El presupuesto mensual queda en \$0/);
  assert.match(styles,/\.fresh-start-dialog/);
  assert.match(styles,/\.danger-zone-card/);
  assert.match(styles,/\.fresh-workspace-banner/);
  assert.match(styles,/\.terminal-empty-state/);
});
