import { load, save, id, reset as resetStore, startFresh as startFreshStore, prepareImport } from '../storage/store.js';
let state = load();
const listeners = new Set();
export const getState = () => state;
export function update(mutator, message = '', meta = {}) {
  mutator(state);
  if (message) {
    state.activity.unshift({ id: id('a'), message, at: new Date().toISOString(), ...meta });
    state.activity = state.activity.slice(0, 150);
  }
  save(state);
  listeners.forEach(listener => listener(state));
}
export function replace(next, message = '') {
  state = prepareImport(next);
  if (message) state.activity.unshift({ id: id('a'), message, at: new Date().toISOString() });
  save(state);
  listeners.forEach(listener => listener(state));
}
export function reset() { state = resetStore(); listeners.forEach(listener => listener(state)); }
export function startFresh() { state = startFreshStore(state); listeners.forEach(listener => listener(state)); }
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
