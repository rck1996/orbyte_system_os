import test from 'node:test';
import assert from 'node:assert/strict';
import { habitPeriodStats, habitStreak, historyValue, isCompleted, isHabitScheduled, nextHabitOpportunity } from '../core/habits.js';

const habit=(schedule,measurement={type:'boolean',target:1,unit:'sesión'})=>({schedule,measurement,history:{},skips:{},paused:false,createdAt:schedule.startDate});

test('un hábito de martes y jueves no considera el miércoles como incumplimiento',()=>{
  const item=habit({type:'daysOfWeek',days:[2,4],targetCount:1,intervalDays:1,startDate:'2026-07-01',endDate:''});
  item.history['2026-07-07']=true;
  item.history['2026-07-09']=true;
  assert.equal(isHabitScheduled(item,'2026-07-08'),false);
  const stats=habitPeriodStats(item,'2026-07-06','2026-07-12');
  assert.deepEqual({expected:stats.expected,completed:stats.completed,adherence:stats.adherence},{expected:2,completed:2,adherence:100});
});

test('un objetivo por semana mide sesiones y no días concretos',()=>{
  const item=habit({type:'timesPerWeek',days:[],targetCount:3,intervalDays:1,startDate:'2026-07-01',endDate:''});
  item.history['2026-07-06']=true;
  item.history['2026-07-08']=true;
  item.history['2026-07-10']=true;
  const stats=habitPeriodStats(item,'2026-07-06','2026-07-12');
  assert.equal(stats.expected,3);
  assert.equal(stats.completed,3);
  assert.equal(stats.adherence,100);
  assert.equal(habitStreak(item,'2026-07-12').unit,'semanas');
});

test('un hábito flexible se puede registrar sin aparecer pendiente todos los días',()=>{
  const item=habit({type:'flexible',days:[],targetCount:1,intervalDays:1,startDate:'2026-07-01',endDate:''});
  assert.equal(isHabitScheduled(item,'2026-07-08'),false);
  item.history['2026-07-08']=true;
  const stats=habitPeriodStats(item,'2026-07-01','2026-07-31');
  assert.equal(stats.expected,1);
  assert.equal(stats.adherence,100);
  assert.equal(nextHabitOpportunity(item,'2026-07-09'),'');
});

test('cada catorce días crea oportunidades reales según la fecha de inicio',()=>{
  const item=habit({type:'interval',days:[],targetCount:1,intervalDays:14,startDate:'2026-07-01',endDate:''});
  assert.equal(isHabitScheduled(item,'2026-07-01'),true);
  assert.equal(isHabitScheduled(item,'2026-07-08'),false);
  assert.equal(isHabitScheduled(item,'2026-07-15'),true);
  assert.equal(nextHabitOpportunity(item,'2026-07-02'),'2026-07-15');
});

test('los hábitos cuantitativos se completan al alcanzar su objetivo',()=>{
  const item=habit({type:'daily',days:[0,1,2,3,4,5,6],targetCount:1,intervalDays:1,startDate:'2026-07-01',endDate:''},{type:'minutes',target:30,unit:'min'});
  item.history['2026-07-08']=25;
  assert.equal(historyValue(item,'2026-07-08'),25);
  assert.equal(isCompleted(item,'2026-07-08'),false);
  item.history['2026-07-08']=35;
  assert.equal(isCompleted(item,'2026-07-08'),true);
});
