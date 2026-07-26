import { dateKey } from '../storage/store.js';

const DAY = 86400000;
const safeDate = value => new Date(`${value}T12:00:00`);
const addDays = (key, amount) => { const date = safeDate(key); date.setDate(date.getDate() + amount); return dateKey(date); };
const daysBetween = (from, to) => Math.round((safeDate(to) - safeDate(from)) / DAY);
export const weekStart = (value = dateKey()) => { const date = safeDate(value); const day = date.getDay(); date.setDate(date.getDate() - ((day + 6) % 7)); return dateKey(date); };
export const monthStart = (value = dateKey()) => `${String(value).slice(0, 7)}-01`;

export function normalizeSchedule(habit) {
  if (habit?.schedule?.type) return {
    type: habit.schedule.type,
    days: Array.isArray(habit.schedule.days) ? habit.schedule.days.map(Number) : [],
    targetCount: Math.max(1, Number(habit.schedule.targetCount) || 1),
    intervalDays: Math.max(1, Number(habit.schedule.intervalDays) || 1),
    startDate: habit.schedule.startDate || habit.startDate || habit.createdAt || dateKey(),
    endDate: habit.schedule.endDate || habit.endDate || ''
  };
  const days = Array.isArray(habit?.targetDays) ? habit.targetDays.map(Number) : [];
  return { type: days.length === 7 ? 'daily' : days.length ? 'daysOfWeek' : 'flexible', days, targetCount: 1, intervalDays: 1, startDate: habit?.startDate || habit?.createdAt || dateKey(), endDate: habit?.endDate || '' };
}
export function normalizeMeasurement(habit) {
  const measurement = habit?.measurement || {};
  return { type: measurement.type || 'boolean', target: Math.max(0, Number(measurement.target) || 1), unit: measurement.unit || (measurement.type === 'boolean' || !measurement.type ? 'sesión' : '') };
}
export function historyValue(habit, key) {
  const value = habit?.history?.[key];
  if (value === true) return normalizeMeasurement(habit).target || 1;
  if (value === false || value == null) return 0;
  if (typeof value === 'object') return Number(value.value) || 0;
  return Number(value) || 0;
}
export function isCompleted(habit, key) { return historyValue(habit, key) >= normalizeMeasurement(habit).target; }
export function isSkipped(habit, key) { return Boolean(habit?.skips?.[key]); }
function activeOn(habit, key) {
  const schedule = normalizeSchedule(habit);
  if (habit?.paused) return false;
  if (habit?.pauseUntil && key <= habit.pauseUntil) return false;
  return (!schedule.startDate || key >= schedule.startDate) && (!schedule.endDate || key <= schedule.endDate);
}
function countCompleted(habit, from, to) {
  let count = 0;
  for (let key = from; key <= to; key = addDays(key, 1)) if (isCompleted(habit, key)) count += 1;
  return count;
}
export function isHabitScheduled(habit, key) {
  if (!activeOn(habit, key)) return false;
  const schedule = normalizeSchedule(habit), day = safeDate(key).getDay();
  if (schedule.type === 'daily') return true;
  if (schedule.type === 'weekends') return [0, 6].includes(day);
  if (schedule.type === 'daysOfWeek') return schedule.days.includes(day);
  if (schedule.type === 'interval') return daysBetween(schedule.startDate, key) >= 0 && daysBetween(schedule.startDate, key) % schedule.intervalDays === 0;
  if (schedule.type === 'timesPerWeek') {
    const start = weekStart(key), end = addDays(start, 6);
    return countCompleted(habit, start, end) < schedule.targetCount || isCompleted(habit, key);
  }
  if (schedule.type === 'timesPerMonth') {
    const start = monthStart(key); const date = safeDate(start); date.setMonth(date.getMonth() + 1); date.setDate(0); const end = dateKey(date);
    return countCompleted(habit, start, end) < schedule.targetCount || isCompleted(habit, key);
  }
  return false;
}
export function isHabitDueToday(habit, today = dateKey()) { return isHabitScheduled(habit, today) && !isCompleted(habit, today) && !isSkipped(habit, today); }
function expectedBetween(habit, from, to) {
  const schedule = normalizeSchedule(habit);
  if (schedule.type === 'timesPerWeek') {
    const starts = new Set(); for (let key = from; key <= to; key = addDays(key, 1)) starts.add(weekStart(key));
    return starts.size * schedule.targetCount;
  }
  if (schedule.type === 'timesPerMonth') {
    const months = new Set(); for (let key = from; key <= to; key = addDays(key, 1)) months.add(String(key).slice(0, 7));
    return months.size * schedule.targetCount;
  }
  if (schedule.type === 'flexible') return Math.max(1, countCompleted(habit, from, to));
  let count = 0; for (let key = from; key <= to; key = addDays(key, 1)) if (isHabitScheduled(habit, key)) count += 1;
  return count;
}
export function habitPeriodStats(habit, from, to) {
  const expected = expectedBetween(habit, from, to);
  const completed = countCompleted(habit, from, to);
  const skipped = Object.keys(habit.skips || {}).filter(key => key >= from && key <= to && habit.skips[key]).length;
  const denominator = Math.max(0, expected - skipped);
  return { from, to, expected, completed, skipped, adherence: denominator ? Math.min(100, Math.round(completed / denominator * 100)) : completed ? 100 : 0 };
}
export function habitWeekStats(habit, value = dateKey()) { const start = weekStart(value); return habitPeriodStats(habit, start, addDays(start, 6)); }
export function habitFourWeekStats(habit, value = dateKey()) { const end = value; return habitPeriodStats(habit, addDays(end, -27), end); }
function periodCompleted(habit, start, end, target) { return countCompleted(habit, start, end) >= target; }
export function habitStreak(habit, value = dateKey()) {
  const schedule = normalizeSchedule(habit);
  let streak = 0;
  if (schedule.type === 'timesPerWeek') {
    let start = weekStart(value);
    for (let index = 0; index < 104; index += 1) {
      const end = addDays(start, 6);
      if (periodCompleted(habit, start, end, schedule.targetCount)) streak += 1;
      else if (index === 0 && safeDate(value) < safeDate(end)) { /* current period may still be open */ }
      else break;
      start = addDays(start, -7);
    }
    return { value: streak, unit: 'semanas' };
  }
  if (schedule.type === 'timesPerMonth') {
    let cursor = safeDate(monthStart(value));
    for (let index = 0; index < 60; index += 1) {
      const start = dateKey(cursor); const endDate = new Date(cursor); endDate.setMonth(endDate.getMonth() + 1); endDate.setDate(0); const end = dateKey(endDate);
      if (periodCompleted(habit, start, end, schedule.targetCount)) streak += 1;
      else if (index === 0) { /* open month */ }
      else break;
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return { value: streak, unit: 'meses' };
  }
  let cursor = value;
  for (let index = 0; index < 730; index += 1) {
    if (!isHabitScheduled(habit, cursor)) { cursor = addDays(cursor, -1); continue; }
    if (isCompleted(habit, cursor) || isSkipped(habit, cursor)) streak += 1;
    else if (cursor === value) { /* today is not finished */ }
    else break;
    cursor = addDays(cursor, -1);
  }
  return { value: streak, unit: 'oportunidades' };
}
export function nextHabitOpportunity(habit, from = dateKey()) {
  for (let offset = 0; offset < 370; offset += 1) { const key = addDays(from, offset); if (isHabitScheduled(habit, key) && !isCompleted(habit, key) && !isSkipped(habit, key)) return key; }
  return '';
}
export function habitScheduleLabel(habit) {
  const schedule = normalizeSchedule(habit);
  const names = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  if (schedule.type === 'daily') return 'Todos los días';
  if (schedule.type === 'weekends') return 'Fines de semana';
  if (schedule.type === 'daysOfWeek') return schedule.days.map(day => names[day]).join(' · ') || 'Días específicos';
  if (schedule.type === 'timesPerWeek') return `${schedule.targetCount} ${schedule.targetCount === 1 ? 'vez' : 'veces'} por semana`;
  if (schedule.type === 'timesPerMonth') return `${schedule.targetCount} ${schedule.targetCount === 1 ? 'vez' : 'veces'} por mes`;
  if (schedule.type === 'interval') return `Cada ${schedule.intervalDays} ${schedule.intervalDays === 1 ? 'día' : 'días'}`;
  return 'Sin frecuencia fija';
}
export function measurementLabel(habit) {
  const measurement = normalizeMeasurement(habit);
  if (measurement.type === 'boolean') return 'Completar sesión';
  return `${measurement.target.toLocaleString('es-CL')} ${measurement.unit || ''}`.trim();
}
export function weekDays(value = dateKey()) { const start = weekStart(value); return Array.from({ length: 7 }, (_, index) => addDays(start, index)); }
