const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
export function findOrbit(state,text) {
  const input = normalize(text);
  return state.orbits.find(orbit => input.includes(normalize(orbit.name)) || input.includes(normalize(orbit.code)))?.id || '';
}
export function findProject(state,text) {
  const input = normalize(text);
  const matches = state.projects.filter(project => input.includes(normalize(project.title)));
  return matches.sort((a,b)=>b.title.length-a.title.length)[0]?.id || '';
}
export function inferCategory(text) {
  const input = normalize(text);
  const groups = [
    ['Alimentación',['supermercado','comida','restaurant','almuerzo','cena','delivery','pan','queso','cafe','verdura','fruta','mercado']],
    ['Transporte',['bencina','combustible','metro','bus','bip','uber','taxi','estacionamiento','peaje']],
    ['Hogar',['dividendo','arriendo','luz','agua','gas','internet','mueble','cocina','baño','lavadora','refrigerador','electrodomestico']],
    ['Tecnología',['ram','ssd','notebook','pc','cpu','gpu','procesador','servidor','server','monitor','teclado','software','hosting']],
    ['Música',['interfaz','audient','guitarra','sintetizador','microfono','audio']],
    ['Salud',['farmacia','medico','dentista','consulta','examen','medicamento','natacion','gimnasio','salud']],
    ['Viajes',['japon','viaje','hotel','vuelo','pasaje']],
    ['Suscripciones',['suscripcion','netflix','spotify','youtube','disney']],
    ['Educación',['curso','diplomado','libro','certificacion']]
  ];
  return groups.find(([,words])=>words.some(word=>input.includes(word)))?.[0] || 'Otros';
}
export function inferTags(text) {
  return [...new Set(normalize(text).split(/[^a-z0-9]+/).filter(word=>word.length>4).slice(0,6))];
}
