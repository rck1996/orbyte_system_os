const KEY = 'orbyte.personal-os.v2';
const clone = value => structuredClone(value);
const DATA_COLLECTIONS = ['projects','tasks','habits','events','notes','transactions','recurringTransactions','installmentPlans','budgets','skippedOccurrences','financialGoals','monthReviews','undoBatches','assets','captures','activity','assistantLog'];
export const id = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
export const dateKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
export const today = () => dateKey();
const daysAgo = amount => { const d = new Date(); d.setDate(d.getDate() - amount); return dateKey(d); };
const daysFromNow = amount => { const d = new Date(); d.setDate(d.getDate() + amount); return dateKey(d); };

const seed = {
  version: 5,
  profile: { name: 'Erick', locale: 'es-CL', currency: 'CLP' },
  orbits: [
    { id: 'o_work', name: 'Trabajo', code: 'WORK', description: 'Carrera, aprendizaje y proyectos profesionales.', x: 18, y: 22 },
    { id: 'o_life', name: 'Vida', code: 'LIFE', description: 'Salud, hogar, relaciones y experiencias.', x: 72, y: 20 },
    { id: 'o_build', name: 'Construir', code: 'BUILD', description: 'Productos, ideas y sistemas personales.', x: 20, y: 70 },
    { id: 'o_money', name: 'Finanzas', code: 'MONEY', description: 'Presupuesto, compromisos y decisiones.', x: 72, y: 70 }
  ],
  projects: [
    { id: 'p_orbyte', orbitId: 'o_build', title: 'ORBYTE_', goal: 'Construir un sistema operativo personal útil, contextual y auditable.', status: 'active', budget: 250000, dueDate: daysFromNow(45), createdAt: daysAgo(24) },
    { id: 'p_japan', orbitId: 'o_life', title: 'Viaje Japón 2027', goal: 'Preparar el viaje con ahorro, salud e itinerario bajo control.', status: 'active', budget: 6000000, dueDate: '2027-10-02', createdAt: daysAgo(70) }
  ],
  tasks: [
    { id: 't_kernel', orbitId: 'o_build', projectId: 'p_orbyte', title: 'Validar el kernel de contexto', priority: 'high', dueDate: today(), estimate: 60, done: false, createdAt: daysAgo(3) },
    { id: 't_ollama', orbitId: 'o_build', projectId: 'p_orbyte', title: 'Probar conexión local con Ollama', priority: 'medium', dueDate: daysFromNow(2), estimate: 30, done: false, createdAt: daysAgo(2) },
    { id: 't_japan_budget', orbitId: 'o_life', projectId: 'p_japan', title: 'Definir meta mensual de ahorro para Japón', priority: 'high', dueDate: daysAgo(2), estimate: 40, done: false, createdAt: daysAgo(12) },
    { id: 't_week', orbitId: 'o_life', projectId: '', title: 'Planificar la semana', priority: 'medium', dueDate: today(), estimate: 25, done: false, createdAt: daysAgo(1) },
    { id: 't_done', orbitId: 'o_build', projectId: 'p_orbyte', title: 'Definir identidad terminal editorial', priority: 'high', dueDate: daysAgo(4), estimate: 45, done: true, completedAt: daysAgo(3), createdAt: daysAgo(8) }
  ],
  habits: [
    { id: 'h_move', orbitId: 'o_life', projectId: '', title: 'Mover el cuerpo', targetDays: [1,2,3,4,5], schedule: { type: 'daysOfWeek', days: [1,2,3,4,5], targetCount: 1, intervalDays: 1, startDate: daysAgo(30), endDate: '' }, measurement: { type: 'minutes', target: 30, unit: 'min' }, history: { [daysAgo(1)]: 35, [daysAgo(3)]: 30 }, skips: {}, paused: false, createdAt: daysAgo(30) },
    { id: 'h_review', orbitId: 'o_build', projectId: 'p_orbyte', title: 'Revisar ORBYTE_ 15 minutos', targetDays: [1,3,5], schedule: { type: 'daysOfWeek', days: [1,3,5], targetCount: 1, intervalDays: 1, startDate: daysAgo(30), endDate: '' }, measurement: { type: 'minutes', target: 15, unit: 'min' }, history: { [daysAgo(2)]: 15 }, skips: {}, paused: false, createdAt: daysAgo(30) }
  ],
  events: [
    { id: 'e_swim', orbitId: 'o_life', projectId: '', title: 'Natación', date: daysFromNow(1), time: '19:00' }
  ],
  notes: [
    { id: 'n_principle', orbitId: 'o_build', projectId: 'p_orbyte', title: 'Principio de diseño', content: 'La terminal es la superficie principal; las vistas son proyecciones del mismo kernel.', createdAt: daysAgo(5), tags: ['orbyte', 'principio'] }
  ],
  transactions: [
    { id: 'tx_income', type: 'income', amount: 2200000, description: 'Ingreso mensual', category: 'Ingresos', orbitId: 'o_money', projectId: '', date: daysAgo(18) },
    { id: 'tx_food_prev', type: 'expense', amount: 85000, description: 'Supermercado', category: 'Alimentación', orbitId: 'o_life', projectId: '', date: daysAgo(42) },
    { id: 'tx_food_now', type: 'expense', amount: 164000, description: 'Compras del mes', category: 'Alimentación', orbitId: 'o_life', projectId: '', date: daysAgo(8) },
    { id: 'tx_japan', type: 'expense', amount: 45000, description: 'Fondo de preparación Japón', category: 'Viajes', orbitId: 'o_life', projectId: 'p_japan', date: daysAgo(5) }
  ],
  recurringTransactions: [
    { id: 'rt_salary', type: 'income', description: 'Ingreso mensual', amount: 2200000, category: 'Ingresos', subtype: 'fixed', frequency: 'monthly', businessDay: 'last', dayRule: 'last-business-day', day: 0, weekday: 0, interval: 1, startDate: daysAgo(90), endDate: '', active: true, orbitId: 'o_money', projectId: '', createdAt: daysAgo(90) },
    { id: 'rt_home', type: 'expense', description: 'Dividendo', amount: 630000, category: 'Vivienda', subtype: 'fixed', frequency: 'monthly', day: 5, weekday: 0, interval: 1, startDate: daysAgo(90), endDate: '', active: true, orbitId: 'o_money', projectId: '', createdAt: daysAgo(90) },
    { id: 'rt_insurance', type: 'expense', description: 'Seguro del auto', amount: 56000, category: 'Transporte', subtype: 'subscription', frequency: 'monthly', day: 10, weekday: 0, interval: 1, startDate: daysAgo(90), endDate: '', active: true, orbitId: 'o_money', projectId: '', createdAt: daysAgo(90) }
  ],
  installmentPlans: [],
  budgets: [
    { id: 'b_food', scope: 'category', reference: 'Alimentación', label: 'Alimentación', amount: 250000, active: true },
    { id: 'b_orbyte', scope: 'project', reference: 'p_orbyte', label: 'ORBYTE_', amount: 250000, active: true }
  ],
  skippedOccurrences: [],
  financialGoals: [],
  monthReviews: [],
  undoBatches: [],
  assets: [],
  captures: [],
  activity: [],
  assistantLog: [],
  settings: {
    assistantMode: 'local',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:8b',
    monthlyBudget: 800000,
    workdayMinutes: 300
  },
  financeSettings: { projectionMonths: 6, averageWindow: 3 }
};

function normalize(data) {
  const next = { ...clone(seed), ...(data && typeof data === 'object' ? data : {}) };
  for (const key of ['orbits', ...DATA_COLLECTIONS]) {
    if (!Array.isArray(next[key])) next[key] = [];
  }
  next.profile = { ...seed.profile, ...(next.profile || {}) };
  next.settings = { ...seed.settings, ...(next.settings || {}) };
  next.financeSettings = { ...seed.financeSettings, ...(next.financeSettings || {}) };
  next.habits = next.habits.map(habit => {
    const days = Array.isArray(habit.targetDays) ? habit.targetDays.map(Number) : [];
    const schedule = habit.schedule?.type ? habit.schedule : { type: days.length === 7 ? 'daily' : days.length ? 'daysOfWeek' : 'flexible', days, targetCount: 1, intervalDays: 1, startDate: habit.startDate || habit.createdAt || today(), endDate: habit.endDate || '' };
    return { ...habit, targetDays: days, schedule: { days: [], targetCount: 1, intervalDays: 1, startDate: habit.createdAt || today(), endDate: '', ...schedule }, measurement: { type: 'boolean', target: 1, unit: 'sesión', ...(habit.measurement || {}) }, history: habit.history && typeof habit.history === 'object' ? habit.history : {}, skips: habit.skips && typeof habit.skips === 'object' ? habit.skips : {}, paused: Boolean(habit.paused), createdAt: habit.createdAt || schedule.startDate || today() };
  });
  next.transactions = next.transactions.map(tx => ({ status: 'confirmed', ...tx }));
  next.recurringTransactions = next.recurringTransactions.map(rule => ({ frequency: 'monthly', interval: 1, day: 1, weekday: 1, startDate: today(), endDate: '', active: true, subtype: 'fixed', ...rule }));
  next.installmentPlans = next.installmentPlans.map(plan => {
    const installments = Math.max(1, Number(plan.installments) || 1), totalAmount = Math.max(0, Number(plan.totalAmount) || 0);
    return { type: 'expense', active: true, ...plan, installments, totalAmount, installmentAmount: Number(plan.installmentAmount) || Math.round(totalAmount / installments) };
  });
  next.budgets = next.budgets.map(budget => ({ mode: 'flexible', month: '', active: true, ...budget }));
  next.financialGoals = next.financialGoals.map(goal => ({ status: 'planned', ...goal }));
  next.version = 5;
  return next;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : clone(seed);
  } catch {
    return clone(seed);
  }
}
export function save(state) { localStorage.setItem(KEY, JSON.stringify(normalize(state))); }
export function reset() { const state = clone(seed); save(state); return state; }

export function createFreshState(current = {}) {
  const source = normalize(current);
  const fresh = clone(seed);
  for (const key of DATA_COLLECTIONS) fresh[key] = [];
  fresh.orbits = clone(seed.orbits);
  fresh.profile = { ...seed.profile, ...source.profile };
  fresh.settings = {
    ...seed.settings,
    ...source.settings,
    monthlyBudget: 0
  };
  fresh.financeSettings = { ...seed.financeSettings, ...source.financeSettings };
  fresh.version = 5;
  return normalize(fresh);
}

export function startFresh(current = load()) {
  const state = createFreshState(current);
  save(state);
  return state;
}

export function prepareImport(value) {
  const normalized = normalize(value);
  if (!normalized.orbits.every(item => item.id && item.name)) throw new Error('Órbitas inválidas');
  return normalized;
}
export { KEY };
