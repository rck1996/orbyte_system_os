import { isOperationalRequest } from './engine.js';
import { contextSnapshot, financeSnapshot, dailyPlan, attentionSignals, projectHealth } from '../../core/kernel.js';

async function responsePayload(response) {
  return response.json().catch(() => ({}));
}

const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

export function assistantIntent(question, state) {
  const q = normalize(question);
  if (/gasto|dinero|balance|presupuesto|compra|finanza|ingreso|cuota|suscripcion/.test(q)) return 'finance';
  if (/proyecto|pixelpy|orbyte|japon|blueprint/.test(q) || (state.projects || []).some(project => q.includes(normalize(project.title)))) return 'project';
  if (/hoy|dia|plan|prioridad|pendiente|tarea|primero|empiezo/.test(q)) return 'day';
  if (/cambio|reciente|actividad/.test(q)) return 'activity';
  return 'general';
}

export function compactContext(question, state) {
  const intent = assistantIntent(question, state);
  const base = { intent, profile: { name: state.profile.name }, today: new Date().toISOString().slice(0, 10) };
  if (intent === 'finance') {
    const snapshot = financeSnapshot(state);
    const ledger = snapshot.ledger;
    return {
      ...base,
      finance: {
        month: snapshot.month,
        actualIncome: snapshot.income,
        actualExpense: snapshot.expense,
        confirmedResult: snapshot.balance,
        projectedIncome: snapshot.projectedIncome,
        pendingCommitments: snapshot.pendingCommitments,
        variableAssumption: snapshot.variableAssumption,
        projectedResult: snapshot.projectedBalance,
        budget: snapshot.budget,
        budgetUse: snapshot.budgetUse,
        categories: Object.entries(snapshot.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, amount]) => ({ category, amount })),
        recentConfirmed: [...ledger.actual].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 10).map(item => ({ type: item.type, description: item.description, amount: item.amount, category: item.category || 'Otros', date: item.date })),
        nextCommitments: ledger.timeline.filter(item => item.status === 'pending').sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(0, 10).map(item => ({ type: item.type, description: item.description, amount: item.amount, date: item.date, kind: item.ledgerKind }))
      }
    };
  }
  if (intent === 'project') {
    const q = normalize(question);
    const words = q.split(/\W+/).filter(word => word.length > 3);
    const project = state.projects
      .map(item => ({ item, score: words.filter(word => normalize(item.title).includes(word)).length }))
      .sort((a, b) => b.score - a.score)[0]?.item;
    if (project) return {
      ...base,
      project,
      health: projectHealth(state, project),
      tasks: state.tasks.filter(item => item.projectId === project.id),
      notes: state.notes.filter(item => item.projectId === project.id),
      events: state.events.filter(item => item.projectId === project.id),
      transactions: state.transactions.filter(item => item.projectId === project.id)
    };
  }
  if (intent === 'day') {
    const plan = dailyPlan(state);
    const signals = attentionSignals(state);
    return {
      ...base,
      plan,
      overdue: signals.overdue.slice(0, 8).map(task => ({ title: task.title, dueDate: task.dueDate, priority: task.priority })),
      riskyProjects: signals.risky.slice(0, 5).map(item => ({ title: item.project.title, risk: item.health.risk, nextAction: item.health.nextAction?.title || '' }))
    };
  }
  if (intent === 'activity') return { ...base, activity: state.activity.slice(0, 12) };
  const snapshot = contextSnapshot(state);
  return {
    ...base,
    focus: snapshot.focus,
    overdue: snapshot.overdue,
    projects: snapshot.projects.map(({ title, risk, progress, open, overdue }) => ({ title, risk, progress, open, overdue })),
    nextEvents: snapshot.nextEvents,
    habitsPending: snapshot.habitsPending
  };
}

function conversationHistory(state) {
  return state.assistantLog
    .slice(-8)
    .filter(item => item.text && !item.proposal && !item.pending && !item.blockedRequest)
    .map(item => ({ role: item.role === 'user' ? 'user' : 'assistant', content: item.text.slice(0, 700) }));
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function kernelOnlyIntent(question, intent) {
  const q = normalize(question);
  return intent === 'day' && /(?:que|como|por donde).*(?:hacer|priorizar|empezar|primero)|planifica|organiza/.test(q);
}

export function modelAnswerIssue(question, answer, intent) {
  const text = String(answer || '').trim();
  if (!text) return 'El modelo no entregó texto.';
  if (text.length > 2200) return 'La respuesta excedió el límite conversacional.';
  if (intent === 'finance' && text.length > 850) return 'La respuesta financiera fue demasiado extensa para la vista resumida.';
  if (intent === 'finance' && /\|\s*:?-{3,}:?\s*\||(?:^|\n)#{1,6}\s/m.test(text)) return 'La respuesta financiera intentó reemplazar el panel con una tabla o informe largo.';
  if (/##\s*(?:summary|income|expenses|budgeting|key findings|recommendations)|\bsummary of financial data\b|\bthe user has\b/i.test(text)) return 'El modelo respondió con una plantilla en inglés no solicitada.';
  if (intent !== 'finance' && /\b(?:income|expenses|budgeting|financial data|financial stability|investing surplus|high-yield savings)\b/i.test(text)) return 'El modelo desvió la respuesta hacia finanzas.';
  if (intent === 'day' && /\$\s?\d|(?:ingresos|gastos|balance|presupuesto)\s*:/i.test(text)) return 'El modelo mezcló finanzas con una consulta diaria.';
  const englishSignals=(text.match(/\b(?:the|and|with|from|should|review|consider|additional|provided|goals|plans)\b/gi)||[]).length;
  const spanishSignals=(text.match(/\b(?:el|la|los|las|de|que|para|primero|despues|hoy|tarea|proyecto|puedes)\b/gi)||[]).length;
  if(englishSignals>=6&&englishSignals>spanishSignals)return 'El modelo no respetó el idioma español.';
  return '';
}

export async function askAssistant(question, state, localAnswer) {
  if (isOperationalRequest(question)) return { answer: localAnswer, source: 'kernel', error: 'Solicitud operativa retenida por el enrutador estricto.' };
  const intent = assistantIntent(question, state);
  if (state.settings.assistantMode !== 'hybrid' || kernelOnlyIntent(question, intent)) return { answer: localAnswer, source: 'kernel' };
  try {
    const context = compactContext(question, state);
    const payload = await postJson('/api/ai/chat', {
      baseUrl: state.settings.ollamaUrl,
      model: state.settings.ollamaModel,
      question,
      intent,
      context,
      history: conversationHistory(state),
      localAnswer,
      requestKind: 'conversation'
    });
    const answer = payload.answer || '';
    const issue = modelAnswerIssue(question, answer, intent);
    if (issue) return { answer: localAnswer, source: 'fallback', error: `${issue} Se mostró la respuesta verificada del kernel.` };
    return {
      answer,
      source: 'ollama',
      model: payload.model,
      endpoint: payload.endpoint,
      compatibilityMode: payload.compatibilityMode,
      thinkingPolicy: payload.thinkingPolicy,
      latencyMs: payload.latencyMs
    };
  } catch (error) {
    return { answer: localAnswer, source: 'fallback', error: error.message };
  }
}

export async function discoverAssistant(settings) {
  return postJson('/api/ai/status', {
    baseUrl: settings.ollamaUrl,
    model: settings.ollamaModel,
    probe: false
  });
}

export async function testAssistant(settings) {
  return postJson('/api/ai/status', {
    baseUrl: settings.ollamaUrl,
    model: settings.ollamaModel,
    probe: true
  });
}
