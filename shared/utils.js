export const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
export const money = value => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(Number(value)||0);
export const date = value => value ? new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`)) : 'Sin fecha';
export const shortDate = value => value ? new Intl.DateTimeFormat('es-CL',{day:'numeric',month:'short'}).format(new Date(`${value}T12:00:00`)) : '—';
export const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
export const projectProgress = (state, projectId) => {
  const tasks = state.tasks.filter(task => task.projectId === projectId);
  return tasks.length ? Math.round(tasks.filter(task => task.done).length / tasks.length * 100) : 0;
};
export const orbitName = (state,id) => state.orbits.find(item=>item.id===id)?.name || 'Sin vínculo';
export const projectName = (state,id) => state.projects.find(item=>item.id===id)?.title || '';
export const priorityLabel = value => ({high:'Alta',medium:'Media',low:'Baja'}[value] || value || 'Media');
