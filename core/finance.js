import { dateKey } from '../storage/store.js';

const DAY = 86400000;
const safeDate = value => new Date(`${value}T12:00:00`);
const normalizeText = value => String(value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
const amountOf = value => Math.max(0, Number(value) || 0);

export const monthKey = value => String(value || dateKey()).slice(0, 7);
export function addMonths(month, amount) {
  const [year, index] = monthKey(month).split('-').map(Number);
  const date = new Date(year, index - 1 + Number(amount || 0), 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
export function monthLabel(month, locale = 'es-CL') {
  const [year, index] = monthKey(month).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, index - 1, 1));
}
export function daysInMonth(month) {
  const [year, index] = monthKey(month).split('-').map(Number);
  return new Date(year, index, 0).getDate();
}
function clampDay(month, day) { return Math.min(daysInMonth(month), Math.max(1, Number(day) || 1)); }
function dateForMonthDay(month, day) { return `${monthKey(month)}-${String(clampDay(month, day)).padStart(2, '0')}`; }
function lastBusinessDay(month) {
  let day = daysInMonth(month);
  const [year, index] = monthKey(month).split('-').map(Number);
  while ([0, 6].includes(new Date(year, index - 1, day, 12).getDay())) day -= 1;
  return dateForMonthDay(month, day);
}
function monthDistance(from, to) {
  const [fy, fm] = monthKey(from).split('-').map(Number);
  const [ty, tm] = monthKey(to).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
function daysBetween(from, to) { return Math.round((safeDate(to) - safeDate(from)) / DAY); }
function inRange(date, start, end) { return (!start || date >= start) && (!end || date <= end); }
function occurrenceDate(rule, month) {
  if (rule.businessDay === 'last' || rule.dayRule === 'last-business-day') return lastBusinessDay(month);
  if (rule.dayRule === 'last-day') return dateForMonthDay(month, daysInMonth(month));
  return dateForMonthDay(month, rule.day || Number(String(rule.startDate || '').slice(8, 10)) || 1);
}
function recurrenceMonthApplies(rule, month) {
  const startMonth = monthKey(rule.startDate || month);
  const distance = monthDistance(startMonth, month);
  if (distance < 0) return false;
  const frequency = rule.frequency || 'monthly';
  if (frequency === 'yearly') return distance % 12 === 0;
  if (frequency === 'quarterly') return distance % 3 === 0;
  if (frequency === 'bimonthly') return distance % 2 === 0;
  if (frequency === 'custom-months') return distance % Math.max(1, Number(rule.interval) || 1) === 0;
  return true;
}

export function recurringOccurrences(rule, month) {
  if (!rule || rule.active === false) return [];
  const key = monthKey(month);
  const start = rule.startDate || `${key}-01`;
  const end = rule.endDate || '';
  const frequency = rule.frequency || 'monthly';
  const occurrences = [];
  if (frequency === 'weekly' || frequency === 'biweekly') {
    const intervalDays = frequency === 'biweekly' ? 14 : 7;
    const weekday = Number.isInteger(Number(rule.weekday)) ? Number(rule.weekday) : safeDate(start).getDay();
    for (let day = 1; day <= daysInMonth(key); day += 1) {
      const date = dateForMonthDay(key, day);
      if (!inRange(date, start, end)) continue;
      if (safeDate(date).getDay() !== weekday) continue;
      if (daysBetween(start, date) % intervalDays !== 0) continue;
      occurrences.push({ id: `${rule.id}:${date}`, recurrenceId: rule.id, occurrenceKey: date, date });
    }
    return occurrences;
  }
  if (!recurrenceMonthApplies(rule, key)) return [];
  const date = occurrenceDate(rule, key);
  if (!inRange(date, start, end)) return [];
  return [{ id: `${rule.id}:${date}`, recurrenceId: rule.id, occurrenceKey: date, date }];
}

function isSkipped(state, occurrence) {
  return (state.skippedOccurrences || []).some(item => item.recurrenceId === occurrence.recurrenceId && item.occurrenceKey === occurrence.occurrenceKey);
}
function fuzzyMatch(rule, tx, occurrence) {
  if (monthKey(tx.date) !== monthKey(occurrence.date) || tx.type !== rule.type) return false;
  const amountDiff = Math.abs(amountOf(tx.amount) - amountOf(rule.amount));
  if (amountDiff > Math.max(2, amountOf(rule.amount) * 0.015)) return false;
  const a = normalizeText(tx.description), b = normalizeText(rule.description);
  return a === b || (a.length > 4 && b.length > 4 && (a.includes(b) || b.includes(a)));
}
function matchedTransaction(state, rule, occurrence) {
  const exact = (state.transactions || []).find(tx => tx.recurrenceId === rule.id && tx.occurrenceKey === occurrence.occurrenceKey);
  if (exact) return exact;
  return (state.transactions || []).find(tx => !tx.recurrenceId && fuzzyMatch(rule, tx, occurrence)) || null;
}
function installmentOccurrence(plan, month) {
  if (!plan || plan.active === false || !plan.firstDate || !plan.installments) return null;
  const index = monthDistance(monthKey(plan.firstDate), monthKey(month));
  if (index < 0 || index >= Number(plan.installments)) return null;
  const date = dateForMonthDay(month, Number(String(plan.firstDate).slice(8, 10)) || 1);
  return { id: `${plan.id}:${index + 1}`, installmentPlanId: plan.id, installmentNumber: index + 1, occurrenceKey: date, date };
}
function matchedInstallment(state, plan, occurrence) {
  return (state.transactions || []).find(tx => tx.installmentPlanId === plan.id && Number(tx.installmentNumber) === occurrence.installmentNumber) || null;
}
function actualTransactions(state, month) {
  return (state.transactions || []).filter(tx => monthKey(tx.date) === monthKey(month) && !['planned', 'projected', 'skipped', 'cancelled'].includes(tx.status));
}
function plannedTransactions(state, month) {
  return (state.transactions || []).filter(tx => monthKey(tx.date) === monthKey(month) && ['planned', 'projected'].includes(tx.status));
}
function sum(items, type) { return items.filter(item => item.type === type).reduce((total, item) => total + amountOf(item.amount), 0); }
function byCategory(items) {
  return items.filter(item => item.type === 'expense').reduce((map, item) => {
    const category = item.category || 'Otros';
    map[category] = (map[category] || 0) + amountOf(item.amount);
    return map;
  }, {});
}
function historicalVariableAverage(state, beforeMonth, window = 3) {
  const months = Array.from({ length: window }, (_, index) => addMonths(beforeMonth, -(index + 1)));
  const totals = months.map(month => actualTransactions(state, month)
    .filter(tx => tx.type === 'expense' && !tx.recurrenceId && !tx.installmentPlanId && tx.status !== 'planned')
    .reduce((sumValue, tx) => sumValue + amountOf(tx.amount), 0));
  return Math.round(totals.reduce((total, value) => total + value, 0) / Math.max(1, totals.length));
}
function budgetRows(state, month, actual) {
  const rows = [];
  const totalBudget = amountOf(state.settings?.monthlyBudget);
  if (totalBudget) rows.push({ id: 'global', scope: 'total', label: 'Presupuesto total', amount: totalBudget, spent: sum(actual, 'expense') });
  for (const budget of state.budgets || []) {
    if (budget.active === false) continue;
    if (budget.month && budget.month !== monthKey(month)) continue;
    let spent = 0, label = budget.label || 'Presupuesto';
    if (budget.scope === 'category') {
      spent = actual.filter(tx => tx.type === 'expense' && (tx.category || 'Otros') === budget.reference).reduce((total, tx) => total + amountOf(tx.amount), 0);
      label = budget.reference || label;
    } else if (budget.scope === 'project') {
      spent = actual.filter(tx => tx.type === 'expense' && tx.projectId === budget.reference).reduce((total, tx) => total + amountOf(tx.amount), 0);
      label = state.projects?.find(project => project.id === budget.reference)?.title || label;
    }
    rows.push({ ...budget, label, spent });
  }
  return rows.map(row => ({ ...row, use: row.amount ? Math.round(row.spent / row.amount * 100) : 0, remaining: row.amount - row.spent }));
}

export function financeMonthLedger(state, month = monthKey()) {
  const key = monthKey(month);
  const actual = actualTransactions(state, key);
  const planned = plannedTransactions(state, key).map(tx => ({ ...tx, ledgerKind: 'planned', projected: true, occurrenceKey: tx.occurrenceKey || tx.id }));
  const recurring = [];
  for (const rule of state.recurringTransactions || []) {
    for (const occurrence of recurringOccurrences(rule, key)) {
      const matched = matchedTransaction(state, rule, occurrence);
      recurring.push({
        ...occurrence,
        rule,
        type: rule.type,
        amount: amountOf(rule.amount),
        description: rule.description,
        category: rule.category || (rule.type === 'income' ? 'Ingresos' : 'Otros'),
        projectId: rule.projectId || '',
        orbitId: rule.orbitId || '',
        subtype: rule.subtype || 'fixed',
        ledgerKind: 'recurring',
        status: matched ? 'confirmed' : isSkipped(state, occurrence) ? 'skipped' : 'pending',
        transaction: matched
      });
    }
  }
  const installments = [];
  for (const plan of state.installmentPlans || []) {
    const occurrence = installmentOccurrence(plan, key);
    if (!occurrence) continue;
    const matched = matchedInstallment(state, plan, occurrence);
    installments.push({
      ...occurrence,
      plan,
      type: plan.type || 'expense',
      amount: amountOf(plan.installmentAmount || Math.round(amountOf(plan.totalAmount) / Number(plan.installments || 1))),
      description: plan.description,
      category: plan.category || 'Compras',
      projectId: plan.projectId || '',
      orbitId: plan.orbitId || '',
      ledgerKind: 'installment',
      status: matched ? 'confirmed' : 'pending',
      transaction: matched
    });
  }
  const plannedGoalIds = new Set(planned.map(tx => tx.financialGoalId).filter(Boolean));
  const goals = (state.financialGoals || []).filter(goal => goal.status !== 'completed' && monthKey(goal.targetDate) === key && !plannedGoalIds.has(goal.id)).map(goal => ({
    id: goal.id,
    occurrenceKey: goal.targetDate,
    date: goal.targetDate,
    goal,
    type: 'expense',
    amount: amountOf(goal.amount),
    description: goal.title,
    category: goal.category || 'Objetivos',
    projectId: goal.projectId || '',
    orbitId: goal.orbitId || '',
    ledgerKind: 'goal',
    status: 'pending'
  }));
  const pendingRecurring = recurring.filter(item => item.status === 'pending');
  const pendingInstallments = installments.filter(item => item.status === 'pending');
  const projectedItems = [...pendingRecurring, ...pendingInstallments, ...planned, ...goals];
  const actualIncome = sum(actual, 'income');
  const actualExpense = sum(actual, 'expense');
  const projectedIncome = sum(projectedItems, 'income');
  const projectedExpense = sum(projectedItems, 'expense');
  const variableAverage = historicalVariableAverage(state, key, Number(state.financeSettings?.averageWindow) || 3);
  const currentKey = monthKey();
  const actualVariable = actual.filter(tx => tx.type === 'expense' && !tx.recurrenceId && !tx.installmentPlanId).reduce((total, tx) => total + amountOf(tx.amount), 0);
  const variableAssumption = key < currentKey ? 0 : key === currentKey ? Math.max(0, variableAverage - actualVariable) : variableAverage;
  const realBalance = actualIncome - actualExpense;
  const projectedBalance = realBalance + projectedIncome - projectedExpense;
  const projectedAfterAssumptions = projectedBalance - variableAssumption;
  const timeline = [
    ...actual.map(tx => ({ ...tx, ledgerKind: 'actual', status: 'confirmed' })),
    ...projectedItems,
    ...recurring.filter(item => item.status === 'skipped')
  ].sort((a, b) => `${a.date || ''}${a.description || ''}`.localeCompare(`${b.date || ''}${b.description || ''}`));
  return {
    month: key,
    actual,
    recurring,
    installments,
    goals,
    planned,
    timeline,
    actualIncome,
    actualExpense,
    projectedIncome,
    projectedExpense,
    pendingCommitments: projectedExpense,
    realBalance,
    projectedBalance,
    projectedAfterAssumptions,
    variableAverage,
    variableAssumption,
    byCategory: byCategory(actual),
    budgets: budgetRows(state, key, actual)
  };
}

export function financeProjection(state, startMonth = monthKey(), count = 6) {
  return Array.from({ length: Math.max(1, Number(count) || 6) }, (_, index) => {
    const month = addMonths(startMonth, index);
    const ledger = financeMonthLedger(state, month);
    return {
      month,
      income: ledger.actualIncome + ledger.projectedIncome,
      expense: ledger.actualExpense + ledger.projectedExpense,
      variableAssumption: ledger.variableAssumption,
      balance: ledger.projectedAfterAssumptions,
      confirmedBalance: ledger.projectedBalance,
      commitments: ledger.pendingCommitments
    };
  });
}

export function financeMonthReview(state, month = addMonths(monthKey(), -1)) {
  const current = financeMonthLedger(state, month), prior = financeMonthLedger(state, addMonths(month, -1)), next = financeMonthLedger(state, addMonths(month, 1));
  const categories = Object.entries(current.byCategory).sort((a, b) => b[1] - a[1]);
  const top = categories[0] || ['', 0];
  const priorTop = prior.byCategory[top[0]] || 0;
  const delta = priorTop ? Math.round((top[1] - priorTop) / priorTop * 100) : top[1] ? 100 : 0;
  const savings = current.realBalance;
  const savingsRate = current.actualIncome > 0 ? Math.round(savings / current.actualIncome * 100) : 0;
  const insights = [];
  if (top[0]) insights.push(`${top[0]} fue la categoría principal con ${top[1].toLocaleString('es-CL')} CLP${priorTop ? ` (${delta >= 0 ? '+' : ''}${delta}% frente al mes anterior)` : ''}.`);
  if (savingsRate >= 0) insights.push(`La tasa de ahorro real fue ${savingsRate}%.`);
  else insights.push(`El mes cerró con déficit equivalente al ${Math.abs(savingsRate)}% de los ingresos.`);
  insights.push(`El mes siguiente ya tiene ${next.pendingCommitments.toLocaleString('es-CL')} CLP comprometidos.`);
  return { month: monthKey(month), income: current.actualIncome, expense: current.actualExpense, balance: current.realBalance, savingsRate, topCategory: top[0], topCategoryAmount: top[1], nextCommitments: next.pendingCommitments, insights };
}

export function detectRecurringCandidates(state) {
  const groups = new Map();
  for (const tx of state.transactions || []) {
    if (tx.recurrenceId || tx.status === 'planned') continue;
    const rounded = Math.round(amountOf(tx.amount) / 1000) * 1000;
    const key = `${tx.type}|${normalizeText(tx.description)}|${rounded}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }
  return [...groups.values()].map(items => {
    const months = [...new Set(items.map(item => monthKey(item.date)))].sort();
    return { items, months, latest: items.slice().sort((a, b) => b.date.localeCompare(a.date))[0] };
  }).filter(group => group.months.length >= 3).map(group => ({
    id: `candidate:${group.latest.id}`,
    type: group.latest.type,
    description: group.latest.description,
    amount: amountOf(group.latest.amount),
    category: group.latest.category,
    projectId: group.latest.projectId || '',
    orbitId: group.latest.orbitId || '',
    months: group.months.length
  }));
}

export function nextRecurringDate(rule, from = dateKey()) {
  for (let offset = 0; offset < 24; offset += 1) {
    const month = addMonths(monthKey(from), offset);
    const occurrence = recurringOccurrences(rule, month).find(item => item.date >= from);
    if (occurrence) return occurrence.date;
  }
  return '';
}
