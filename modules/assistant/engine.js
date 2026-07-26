import { id, dateKey } from '../../storage/store.js';
import { findOrbit, findProject, inferCategory, inferTags } from '../../core/relations.js';
import { attentionSignals, buildDailyBrief, contextSnapshot, dailyPlan, financeSnapshot, projectHealth } from '../../core/kernel.js';
import { money } from '../../shared/utils.js';
import { applyOperationsAtomic, refreshProposal } from './operations.js';

const normalize = value => String(value||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
const projectKey = value => normalize(value).replace(/[^a-z0-9]+/g,'');
const quoted = text => text.match(/["“](.+?)["”]/)?.[1];
const tomorrow = () => { const d=new Date(); d.setDate(d.getDate()+1); return dateKey(d); };
const inDays = number => { const d=new Date(); d.setDate(d.getDate()+number); return dateKey(d); };
const moneyPattern = /(\d+(?:[.,]\d+)?)\s*(millones?|mill[oó]n|mil)\s*(?:pesos?|clp)?|(?:\$|clp\s*)?(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\s*(?:pesos?|clp)?/gi;
const mutationVerbPattern = /^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:crea(?:r)?|inicia(?:r)?|empieza|comienza|agrega(?:r)?|añade|anota|apunta|guarda|recuerda|registra(?:r)?|agenda|programa|completa|complete|termina|finaliza|marcar|compr(?:a|as|ar|é|e)|adquir(?:í|i|e)|gast[eé]|pagu[eé]?|cobraron|recib(?:e|í|i)|cobra|cobr[eé]|vend(?:e|í|i|imos|ió|io)|depositaron|abonaron|tengo\s+que|necesito|debo|hay\s+que|quiero)\b/i;
const actionConnectorPattern = /\s+(?:y\s+)?(?:luego|adem[aá]s|tambi[eé]n|despu[eé]s|a\s+continuaci[oó]n)\s+(?=(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?)\s+)?(?:crea|inicia|empieza|comienza|agrega|añade|anota|apunta|guarda|recuerda|registra|agenda|programa|completa|termina|finaliza|marca|compra|adquiere|gasta|paga|recibe|vende|tengo\s+que|necesito|debo|hay\s+que|quiero)\b)|\s+y\s+(?=(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?)\s+)?(?:crea|inicia|empieza|comienza|agrega|añade|anota|apunta|guarda|recuerda|registra|agenda|programa|completa|termina|finaliza|marca|compra|adquiere|gasta|paga|recibe|vende|tengo\s+que|necesito|debo|hay\s+que|quiero)\b)|\s+y\s+(?=(?:para|en)\s+(?:el\s+)?(?:proyecto\s+)?[^:;,]{1,60}:)|\s+(?:y\s+)?(?:luego|adem[aá]s|tambi[eé]n|despu[eé]s)\s+(?=(?:\d+|un|una)\s+[^,;\n]{0,100}\b(?:por|a)\s+(?:(?:\$|clp\s*)?\d))/i;

function parseMoneyValue(number,scale=''){
  const value=Number(String(number).replace(/\s/g,'').replace(',','.').replace(/\.(?=\d{3}\b)/g,''));
  if(!Number.isFinite(value))return 0;
  const unit=normalize(scale);
  if(unit.startsWith('millon'))return Math.round(value*1_000_000);
  if(unit==='mil')return Math.round(value*1_000);
  return Math.round(value);
}
function moneyMatches(text){
  return [...text.matchAll(moneyPattern)].map(match=>({
    value:parseMoneyValue(match[1]||match[3],match[2]||''),
    index:match.index||0,
    length:match[0].length,
    raw:match[0]
  })).filter(match=>match.value>0);
}
const amount = text => moneyMatches(text)[0]?.value||0;
function nextWeekday(day){
  const d=new Date();
  const delta=(day-d.getDay()+7)%7||7;
  d.setDate(d.getDate()+delta);
  return dateKey(d);
}
function due(text){
  const input=normalize(text);
  if(input.includes('pasado manana'))return inDays(2);
  if(input.includes('manana'))return tomorrow();
  if(input.includes('hoy'))return dateKey();
  const dayOffset=input.match(/\ben\s+(\d+)\s+dias?\b/)?.[1];
  if(dayOffset)return inDays(Number(dayOffset));
  const explicitIso=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if(explicitIso)return explicitIso;
  const explicitLocal=text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](20\d{2}))?\b/);
  if(explicitLocal){
    const [,day,month,explicitYear]=explicitLocal;
    const now=new Date(),year=explicitYear||String(now.getFullYear());
    const candidate=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    if(!explicitYear&&candidate<dateKey(now))return `${now.getFullYear()+1}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return candidate;
  }
  const months=[['enero',1],['febrero',2],['marzo',3],['abril',4],['mayo',5],['junio',6],['julio',7],['agosto',8],['septiembre',9],['setiembre',9],['octubre',10],['noviembre',11],['diciembre',12]];
  const monthMatch=input.match(/\b(?:el\s+)?(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+de\s+(20\d{2}))?\b/);
  if(monthMatch){
    const month=months.find(([name])=>name===monthMatch[2])?.[1];
    if(month){
      const now=new Date(),explicitYear=monthMatch[3],year=Number(explicitYear||now.getFullYear());
      let candidate=`${year}-${String(month).padStart(2,'0')}-${String(monthMatch[1]).padStart(2,'0')}`;
      if(!explicitYear&&candidate<dateKey(now))candidate=`${year+1}-${String(month).padStart(2,'0')}-${String(monthMatch[1]).padStart(2,'0')}`;
      return candidate;
    }
  }
  const monthOnly=input.match(/\b(?:para|en|durante)\s+([a-z]+)(?:\s+de\s+(20\d{2}))?\b/);
  if(monthOnly){
    const month=months.find(([name])=>name===monthOnly[1])?.[1];
    if(month){
      const now=new Date(),explicitYear=monthOnly[2],year=Number(explicitYear||now.getFullYear());
      let candidate=`${year}-${String(month).padStart(2,'0')}-01`;
      if(!explicitYear&&candidate<dateKey(now))candidate=`${year+1}-${String(month).padStart(2,'0')}-01`;
      return candidate;
    }
  }
  const weekdays=[['domingo',0],['lunes',1],['martes',2],['miercoles',3],['jueves',4],['viernes',5],['sabado',6]];
  const weekday=weekdays.find(([name])=>new RegExp(`\\b${name}\\b`).test(input));
  return weekday?nextWeekday(weekday[1]):'';
}
function eventTime(text){
  const input=normalize(text);
  const exact=input.match(/\b(?:a\s+las?\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if(exact)return `${String(exact[1]).padStart(2,'0')}:${exact[2]}`;
  const meridiem=input.match(/\b(?:a\s+las?\s+)?(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(am|pm)\b/);
  if(meridiem){let hour=Number(meridiem[1])%12;if(meridiem[3]==='pm')hour+=12;return `${String(hour).padStart(2,'0')}:${meridiem[2]||'00'}`;}
  const hourOnly=input.match(/\b(?:a\s+las?\s+)([01]?\d|2[0-3])(?:\s*(?:h|hrs?|horas?))?\b/);
  return hourOnly?`${String(hourOnly[1]).padStart(2,'0')}:00`:'';
}
function estimate(text){
  const hours=normalize(text).match(/\b(\d+(?:[.,]\d+)?)\s*(?:h|hora|horas)\b/)?.[1];
  if(hours)return Math.max(5,Math.round(Number(hours.replace(',','.'))*60));
  const minutes=normalize(text).match(/\b(\d+)\s*(?:min|minuto|minutos)\b/)?.[1];
  return minutes?Math.max(5,Number(minutes)):30;
}
function clean(text){
  return text
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:crea(?:r)?|agrega(?:r)?|añade|anota|guarda|registra(?:r)?|gast[eé]|pagu[eé]?|compr(?:a|as|ar|é|e)?|recib(?:e|í|i)|vend(?:e|í|i|imos|ió|io)|agenda|programa|complet[eé])\s+/i,'')
    .replace(/\b(hoy|mañana|pasado mañana|urgente|prioridad alta|prioridad baja)\b/gi,'')
    .replace(moneyPattern,'')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:h|hora|horas|min|minuto|minutos)\b/gi,'')
    .replace(/\s{2,}/g,' ')
    .trim()
    .replace(/^(una?|el|la)\s+/i,'');
}
function priority(text){const input=normalize(text);return input.includes('urgente')||input.includes('prioridad alta')?'high':input.includes('prioridad baja')||/\bbaja\b/.test(input)?'low':'medium';}
function linked(state,text){
  const projectId=findProject(state,text);
  const project=state.projects.find(item=>item.id===projectId);
  return {projectId,orbitId:project?.orbitId||findOrbit(state,text)||''};
}
function proposal(title,summary,operations,evidence=[],extra={},state=null){
  const value={id:id('pr'),title,summary,operations,evidence,...extra};
  if(state)refreshProposal(state,value);
  return{kind:'proposal',proposal:value};
}
function findTask(state,text,projectId=''){
  const input=normalize(text).replace(/^(completa|complete|termina|finaliza)\s+/,'');
  const candidates=state.tasks.filter(task=>!task.done&&(!projectId||task.projectId===projectId));
  const ranked=candidates.map(task=>({task,score:normalize(task.title).split(' ').filter(word=>word.length>3&&input.includes(word)).length})).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score?ranked[0].task:null;
}
function findProjectByQuery(state,text){
  const input=normalize(text);
  const ranked=state.projects.map(project=>({project,score:normalize(project.title).split(' ').filter(word=>word.length>3&&input.includes(word)).length})).sort((a,b)=>b.score-a.score);
  return ranked[0]?.score?ranked[0].project:null;
}
function titleCaseHardware(value){
  const title=String(value||'').replace(/\s+/g,' ').trim()
    .replace(/\bram\b/gi,'RAM')
    .replace(/\bcpu\b/gi,'CPU')
    .replace(/\bssd\b/gi,'SSD')
    .replace(/\bgpu\b/gi,'GPU')
    .replace(/\bpc\b/gi,'PC')
    .replace(/(\d+)\s*gb\b/gi,'$1 GB');
  return title?title[0].toUpperCase()+title.slice(1):'Compra';
}
function cleanPurchaseItem(value){
  return String(value||'')
    .replace(/^(?:y\s+)?(?:luego|adem[aá]s|tambi[eé]n|despu[eé]s)\s+/i,'')
    .replace(/^.*?(?:compras?|compr[eé]|comprar|adquir(?:í|i|e))(?=\s|:|$)\s*:?[\s-]*/i,'')
    .replace(/^[\s,;:.]*(?:pesos?\s*)?(?:y\s+)?(?:un|una|unos|unas|el|la|los|las)?\s*/i,'')
    .replace(/\b(?:por|a|de|del|en)\s*$/i,'')
    .replace(/\s+/g,' ')
    .trim();
}
function purchaseItems(text){
  const matches=moneyMatches(text);
  let previousEnd=0;
  return matches.map((match,index)=>{
    const prefix=text.slice(previousEnd,match.index);
    const nextIndex=matches[index+1]?.index??text.length;
    const suffix=text.slice(match.index+match.length,nextIndex);
    previousEnd=match.index+match.length;
    const rawTitle=cleanPurchaseItem(prefix);
    const quantityMatch=rawTitle.match(/^(\d+)\s+(.+)$/);
    const quantity=quantityMatch?Math.max(1,Number(quantityMatch[1])):1;
    const title=titleCaseHardware(quantityMatch?.[2]||rawTitle||'Compra');
    const perUnit=/\b(cada(?:\s+una?)?|c\s*\/\s*u|por\s+unidad)\b/i.test(`${prefix} ${suffix}`);
    const totalAmount=perUnit&&quantity>1?match.value*quantity:match.value;
    return{
      title,
      quantity,
      amount:totalAmount,
      unitAmount:quantity>1?(perUnit?match.value:Math.round(totalAmount/quantity)):totalAmount,
      category:inferCategory(title)
    };
  }).filter(item=>item.title&&item.amount>0);
}

function shouldTrackAsAsset(item){
  const input=normalize(item?.title||'');
  if(['Alimentación','Transporte','Salud','Viajes','Suscripciones','Educación'].includes(item?.category))return false;
  if(/\b(?:comida|pan|queso|bebida|bencina|combustible|pasaje|entrada|suscripcion|mensualidad|hosting|internet|servicio|reparacion|consulta|examen|medicamento|curso)\b/.test(input))return false;
  return true;
}
function isExplicitProjectCreation(text){
  const value=text.trim();
  return /^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?)\s+)?(?:crea(?:r)?|inicia(?:r)?|empieza|comienza|arma|abre|agrega|añade|nuevo|nueva)\s+(?:(?:un|una|el|la|los|las)\s+)?(?:proyectos|proyecto|objetivos|objetivo)\b/i.test(value)
    || /^(?:proyecto|objetivo)\s+nuevo\b/i.test(value)
    || /^(?:quiero|necesito|me\s+gustar[ií]a)\s+(?:crear|iniciar|empezar|comenzar|armar|abrir)\s+(?:(?:un|una)\s+)?(?:proyecto|objetivo)\b/i.test(value);
}
function cleanProjectName(value){
  return String(value||'')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .replace(/\b(?:y\s+)?todo\s+esto\b.*$/i,'')
    .replace(/^(?:el|la|un|una)\s+/i,'')
    .replace(/\s+/g,' ')
    .trim();
}
function cleanProjectReferenceName(value){
  return cleanProjectName(value)
    .replace(/^(?:nuevo|nueva)\s+(?=\S)/i,'')
    .trim();
}
function looksLikeProjectReference(value){
  const title=cleanProjectName(value),key=projectKey(title);
  if(!title||!key||title.length>70||title.split(/\s+/).length>7)return false;
  if(/^(hoy|manana|pasado manana|esta semana|la semana|el mes|revisar|hacer|comprar|pagar|agendar|esto|todo esto|ninguno)$/i.test(normalize(title)))return false;
  if(/\b(?:pesos?|clp|minutos?|horas?)\b/i.test(title))return false;
  return true;
}
function findProjectExact(state,title){
  const key=projectKey(title);
  if(!key)return null;
  const exact=state.projects.find(project=>projectKey(project.title)===key);
  if(exact)return exact;
  if(key.length<4)return null;
  return state.projects.find(project=>{
    const candidate=projectKey(project.title);
    return candidate.length>=4&&(candidate.includes(key)||key.includes(candidate));
  })||null;
}
function defaultOrbitId(state,text=''){
  return findOrbit(state,text)
    || state.orbits.find(orbit=>normalize(orbit.code)==='build'||normalize(orbit.name)==='construir')?.id
    || state.orbits[0]?.id
    || '';
}
function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function extractProjectReference(text,state){
  const original=String(text||'');
  const prefixMatch=original.match(/^(?:para|en)\s+(?:el\s+)?(?:proyecto\s+)?(.+?)\s+(?=(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?)\s+)?(?:crea|agrega|añade|anota|guarda|registra|agenda|programa|completa|termina|finaliza|compra|gasta|paga|recibe)\b)/i);
  if(prefixMatch&&looksLikeProjectReference(prefixMatch[1])){
    return{reference:cleanProjectReferenceName(prefixMatch[1]),text:original.slice(prefixMatch[0].length).trim()};
  }
  const colonMatch=original.match(/\b(?:para|en|al|del)\s+(?:el\s+)?(?:proyecto\s+)?([^:;,\n]{1,70})\s*:\s*/i);
  if(colonMatch&&looksLikeProjectReference(colonMatch[1])){
    return{reference:cleanProjectReferenceName(colonMatch[1]),text:original.replace(colonMatch[0],' ')};
  }
  const explicit=original.match(/\b(?:para|en|al|del)\s+(?:el\s+)?proyecto\s+([^,.;\n]{1,70})(?=$|[,.;\n])/i);
  if(explicit&&looksLikeProjectReference(explicit[1])){
    return{reference:cleanProjectReferenceName(explicit[1]),text:original.replace(explicit[0],' ')};
  }
  const sorted=[...state.projects].sort((a,b)=>b.title.length-a.title.length);
  for(const project of sorted){
    const pattern=new RegExp(`\\b(?:para|en|al|del)\\s+(?:el\\s+)?(?:proyecto\\s+)?${escapeRegex(project.title)}(?=$|[\\s,.;:])`,'i');
    const match=original.match(pattern);
    if(match)return{reference:project.title,text:original.replace(match[0],' ')};
  }
  const trailing=original.match(/\b(?:para|en)\s+(?:el\s+)?([^,.;:\n]{1,60})\s*$/i);
  if(trailing&&looksLikeProjectReference(trailing[1])){
    return{reference:cleanProjectReferenceName(trailing[1]),text:original.slice(0,trailing.index).trim()};
  }
  const existingId=findProject(state,original);
  if(existingId){
    const project=state.projects.find(item=>item.id===existingId);
    return{reference:project?.title||'',text:original};
  }
  return{reference:'',text:original};
}
function modeFromNoun(value){
  const noun=normalize(value);
  if(noun.startsWith('compra'))return'purchase';
  if(noun.startsWith('gasto'))return'expense';
  if(noun.startsWith('ingreso'))return'income';
  if(noun.startsWith('tarea')||noun.startsWith('accion'))return'task';
  if(noun.startsWith('nota')||noun.startsWith('idea'))return'note';
  if(noun.startsWith('evento')||noun.startsWith('reunion')||noun.startsWith('cita'))return'event';
  if(noun.startsWith('habito')||noun.startsWith('ritual'))return'habit';
  if(noun.startsWith('proyecto')||noun.startsWith('objetivo'))return'project';
  return'';
}
function parseHeader(text,state){
  const value=String(text||'').trim();
  const collection=value.match(/^(?:(?:agrega|añade|crea|registra|anota|agenda|programa)\s+)?(?:(?:estas?|estos?|las|los|siguientes?|siguientes)\s+)*(compras?|gastos?|ingresos?|tareas?|acciones?|notas?|ideas?|eventos?|reuniones?|citas?|h[aá]bitos?|rituales?|proyectos?|objetivos?)\s*(?:(?:para|en|del|al)\s+(?:el\s+)?(?:proyecto\s+)?(.+?))?\s*:\s*(.*)$/i);
  if(collection){const remainder=collection[3].trim();return{mode:modeFromNoun(collection[1]),projectRef:cleanProjectReferenceName(collection[2]||''),remainder,persistent:!remainder||/s$/i.test(normalize(collection[1]))};}
  const explicitProject=value.match(/^proyecto\s+(.+?)\s*:\s*(.*)$/i);
  if(explicitProject&&looksLikeProjectReference(explicitProject[1]))return{mode:'',projectRef:cleanProjectReferenceName(explicitProject[1]),remainder:explicitProject[2].trim(),persistent:true};
  const context=value.match(/^(?:para|en|del|al)\s+(?:el\s+)?(?:proyecto\s+)?(.+?)\s*:\s*(.*)$/i);
  if(context&&looksLikeProjectReference(context[1]))return{mode:'',projectRef:cleanProjectReferenceName(context[1]),remainder:context[2].trim(),persistent:true};
  if(mutationVerbPattern.test(value))return null;
  const bare=value.match(/^([^:]{1,70})\s*:\s*(.*)$/);
  if(bare){
    if(/\b\d{1,2}$/.test(bare[1].trim())&&/^\d{2}\b/.test(bare[2].trim()))return null;
    const candidate=cleanProjectName(bare[1]);
    const existing=findProjectExact(state,candidate);
    const properLooking=/[A-ZÁÉÍÓÚÑ_\d]/.test(candidate)||candidate.split(/\s+/).length===1;
    if((existing||properLooking)&&looksLikeProjectReference(candidate)&&!modeFromNoun(candidate))return{mode:'',projectRef:existing?.title||candidate,remainder:bare[2].trim(),persistent:true};
  }
  return null;
}
function tokenizeRequest(raw){
  const prepared=String(raw||'')
    .replace(/\r/g,'')
    .replace(/,\s*(?:y\s+)?(?:luego|adem[aá]s|tambi[eé]n|despu[eé]s)\s+(?=(?:\d+|un|una)\s+[^,;\n]{0,100}\b(?:por|a)\s+(?:(?:\$|clp\s*)?\d))/gi,'\n')
    .replace(/\s+y\s+(?=(?:\d+|un|una)\s+[^,;\n]{0,100}\b(?:por|a)\s+(?:(?:\$|clp\s*)?\d)[^,;\n]{0,100}\b(?:para|en)\s+(?:el\s+)?proyecto\b)/gi,'\n')
    .replace(/[•●▪◦]/g,'\n- ')
    .replace(/,\s+(?=(?:crea|agrega|añade|anota|guarda|registra|agenda|programa|completa|termina|finaliza|compra|gasta|paga|recibe)\b)/gi,'\n')
    .replace(/([.!?])\s+(?=(?:para|en|proyecto|crea|agrega|añade|anota|guarda|registra|agenda|programa|completa|termina|finaliza|compra|gasta|paga|recibe)\b)/gi,'$1\n');
  const tokens=[];
  for(const sourceLine of prepared.split(/\n+/)){
    const wasBullet=/^\s*(?:[-*–—]|\d+[.)])\s+/.test(sourceLine);
    const stripped=sourceLine.replace(/^\s*(?:[-*–—]|\d+[.)])\s+/,'').trim();
    if(!stripped)continue;
    const semicolonParts=stripped.split(/;\s*(?=(?:para|en|proyecto|crea|agrega|añade|anota|guarda|registra|agenda|programa|completa|termina|finaliza|compra|gasta|paga|recibe|\d+\s+\S+.*\b(?:por|a)\b))/i);
    for(const semicolonPart of semicolonParts){
      for(const part of semicolonPart.split(actionConnectorPattern)){
        const text=part.trim()
          .replace(/^[,.-]+\s*/,'')
          .replace(/^(?:y\s+)?(?:luego|adem[aá]s|tambi[eé]n|despu[eé]s)\s+/i,'')
          .trim();
        if(text)tokens.push({text,wasBullet,sourceLine:sourceLine.trim()});
      }
    }
  }
  return tokens;
}
function splitProjectNames(value){
  return String(value||'')
    .replace(/[.;]+$/,'')
    .split(/\s*,\s*|\s+\by\b\s+/i)
    .map(cleanProjectName)
    .filter(looksLikeProjectReference);
}
function stripTaskDecorators(value){
  return String(value||'')
    .replace(/^(?:yo\s+)?(?:tengo\s+que|necesito|debo|hay\s+que|quiero|quisiera|me\s+gustar[ií]a)\s+/i,'')
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:crea(?:r)?|agrega(?:r)?|añade|registra(?:r)?|programa)\s+(?:(?:una?|la)\s+)?(?:tarea|acci[oó]n|pendiente)(?:\s+(?:llamad[oa]|denominad[oa]))?\s*:?[\s-]*/i,'')
    .replace(/^(?:tarea|acci[oó]n|pendiente)(?:\s+(?:llamad[oa]|denominad[oa]))?\s*:?[\s-]*/i,'')
    .replace(/\b(?:hoy|mañana|pasado mañana|urgente|prioridad alta|prioridad baja)\b/gi,'')
    .replace(/\b(?:en\s+\d+\s+d[ií]as?|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi,'')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:h|hora|horas|min|minuto|minutos)\b/gi,'')
    .replace(/\b(?:a\s+las\s+)?(?:[01]?\d|2[0-3]):[0-5]\d\b/g,'')
    .replace(/\b(?:para|el|la|los|las)\s*$/i,'')
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .trim();
}
function stripNotePrefix(value){
  return String(value||'')
    .replace(/^(?:quiero\s+(?:dejar\s+)?anotado|deja\s+anotado|ten\s+presente|recuerda(?:me)?|apunta|anota|guarda)\s+(?:que\s+)?/i,'')
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:agrega(?:r)?|añade|anota|apunta|guarda|recuerda|registra(?:r)?|crea(?:r)?)\s+(?:(?:una?|la)\s+)?(?:nota|idea|recordatorio)\s*:?[\s-]*/i,'')
    .replace(/^(?:nota|idea|recordatorio)\s*:?[\s-]*/i,'')
    .trim();
}
function stripEventPrefix(value){
  return String(value||'')
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:crea(?:r)?|agrega(?:r)?|añade|registra(?:r)?|agenda|programa)\s+(?:(?:un|una|el|la)\s+)?(?:evento|reuni[oó]n|cita)\s*:?[\s-]*/i,'')
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:agenda|programa)\s+/i,'')
    .replace(/^(?:evento|reuni[oó]n|cita)\s*:?[\s-]*/i,'')
    .replace(/\b(?:hoy|mañana|pasado mañana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi,'')
    .replace(/\b(?:a\s+las\s+)?(?:[01]?\d|2[0-3]):[0-5]\d\b/g,'')
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g,'')
    .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]20\d{2}\b/g,'')
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .trim();
}
function stripHabitPrefix(value){
  return String(value||'')
    .replace(/^(?:quiero|necesito|me\s+gustar[ií]a)\s+(?:empezar|comenzar|volver)\s+a\s+/i,'')
    .replace(/^(?:quiero|necesito|me\s+gustar[ií]a)\s+/i,'')
    .replace(/^(?:quiero|necesito|me\s+gustar[ií]a)\s+(?:crear|tener|formar)\s+(?:(?:un|una)\s+)?(?:h[aá]bito|ritual)\s+(?:de\s+)?/i,'')
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:crea(?:r)?|agrega(?:r)?|añade|registra(?:r)?)\s+(?:(?:un|una|el|la)\s+)?(?:h[aá]bito|ritual)\s*(?:de\s+)?:?[\s-]*/i,'')
    .replace(/^(?:h[aá]bito|ritual)\s*(?:de\s+)?:?\s*/i,'')
    .replace(/\b(?:todos?\s+los?\s+d[ií]as?|cada\s+d[ií]a|diariamente|a\s+diario|entre\s+semana|de\s+lunes\s+a\s+viernes|(?:los?\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)(?:\s+y\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?))*)\b/gi,'')
    .replace(/\b\d+\s+(?:vez|veces)\s+(?:por\s+semana|a\s+la\s+semana|por\s+mes|al\s+mes)\b/gi,'')
    .replace(/\bcada\s+\d+\s+d[ií]as?\b/gi,'')
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .trim();
}
function cleanIncomeSubject(value){
  return String(value||'')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .replace(/^(?:mi|un|una|el|la|los|las)\s+/i,'')
    .replace(/\b(?:por|a)\s*$/i,'')
    .replace(/\s+/g,' ')
    .trim();
}
function incomeSemantics(text){
  const original=String(text||'').trim();
  const input=normalize(original);
  const salePatterns=[
    /\bvend(?:í|i|imos|ió|io)\s+(?:(?:mi|un|una|el|la|los|las)\s+)?(.+?)\s+(?:por|a)\s+(?=(?:\$|clp\s*)?\d)/i,
    /\bventa\s+de\s+(?:(?:mi|un|una|el|la|los|las)\s+)?(.+?)(?=\s+(?:por|a|de)\s+(?:(?:\$|clp\s*)?\d)|$)/i,
    /\bpor\s+(?:la\s+)?venta\s+de\s+(?:(?:mi|un|una|el|la|los|las)\s+)?(.+?)(?=\s+(?:por|a|de)\s+(?:(?:\$|clp\s*)?\d)|$)/i
  ];
  for(const pattern of salePatterns){
    const subject=cleanIncomeSubject(original.match(pattern)?.[1]||'');
    if(subject)return{description:titleCaseHardware(`Venta de ${subject}`),category:'Ventas',reason:'sale',subject};
  }
  const service=original.match(/\b(?:me\s+pagaron|cobr(?:é|e|o|ó)|recib(?:í|i)\s+(?:un\s+)?pago)\s+(?:por\s+)?(.+?)(?=\s+(?:por|a|de)\s+(?:(?:\$|clp\s*)?\d)|$)/i)?.[1];
  if(service){
    const subject=cleanIncomeSubject(service);
    if(subject)return{description:`Pago por ${subject}`,category:'Trabajo',reason:'service',subject};
  }
  if(/\b(sueldo|salario|remuneracion|liquidacion de sueldo)\b/.test(input))return{description:'Sueldo',category:'Sueldo',reason:'salary',subject:''};
  if(/\b(honorarios|freelance|asesoria|consultoria|servicio)\b/.test(input)){
    const withoutAmount=original.replace(moneyPattern,' ')
      .replace(/^.*?\b(?:honorarios|freelance|asesor[ií]a|consultor[ií]a|servicio)\b\s*(?:por|de)?\s*/i,'')
      .replace(/\s+/g,' ').trim();
    return{description:withoutAmount?`Ingreso por ${withoutAmount}`:'Honorarios',category:'Trabajo',reason:'service',subject:withoutAmount};
  }
  if(/\b(reembolso|devolucion)\b/.test(input)){
    const kind=/\breembolso\b/.test(input)?'Reembolso':'Devolución';
    const detail=original.replace(moneyPattern,' ')
      .replace(/^.*?\b(?:reembolso|devoluci[oó]n)\b\s*(?:de|por)?\s*/i,'')
      .replace(/\s+/g,' ').trim();
    return{description:detail?`${kind}: ${detail}`:kind,category:'Reembolsos',reason:'refund',subject:detail};
  }
  const generic=original.replace(moneyPattern,' ')
    .replace(/^(?:(?:tuve|recib(?:í|i)|obtuve|registre|registr[eé]|agrega|añade|registra)\s+)?(?:(?:un|una|el|la)\s+)?(?:ingreso|pago|cobro)(?:\s+nuevo)?\s*(?:ya\s+que|porque|por\s+que|por|de)?\s*/i,'')
    .replace(/^(?:ya\s+que|porque|por\s+que)\s+/i,'')
    .replace(/[\s:,-]+|[\s:;,.]+$/g,'')
    .replace(/\s+/g,' ')
    .trim();
  return{description:generic?titleCaseHardware(generic):'Ingreso',category:'Otros ingresos',reason:'generic',subject:generic};
}

function semanticLabel(value,fallback=''){
  const cleaned=String(value||'').replace(/\s+/g,' ').replace(/^[\s:,-]+|[\s:;,.]+$/g,'').trim();
  if(!cleaned)return fallback;
  return titleCaseHardware(cleaned);
}
function taskSemantics(text){
  const title=quoted(text)||stripTaskDecorators(text)
    .replace(/^(?:que\s+)/i,'')
    .replace(/^(?:hacer|realizar)\s+(?=(?:la|el|los|las|un|una)\b)/i,'')
    .trim();
  return semanticLabel(title,'Acción');
}
function noteSemantics(text){
  const content=stripNotePrefix(text)
    .replace(/^(?:que\s+)/i,'')
    .replace(/\s+/g,' ')
    .trim();
  const normalized=semanticLabel(content,'Idea');
  return{content:normalized,title:(quoted(content)||normalized).slice(0,62)};
}
function eventSemantics(text){
  let title=String(text||'')
    .replace(/^(?:yo\s+)?(?:tengo|tendr[eé]|quiero|necesito)\s+(?:(?:un|una|el|la)\s+)?/i,'')
    .replace(/^(?:nos\s+reunimos|me\s+re[uú]no|me\s+junto)\s+/i,'Reunión ')
    .replace(/^voy\s+(?:al|a\s+la)\s+(?:m[eé]dico|dentista)\b/i,match=>/dentista/i.test(match)?'Cita con dentista':'Cita médica')
    .replace(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)?(?:crea(?:r)?|agrega(?:r)?|añade|registra(?:r)?|agenda(?:r)?|programa(?:r)?)\s+(?:(?:un|una|el|la)\s+)?/i,'')
    .replace(/\b(?:el\s+)?(?:hoy|mañana|pasado mañana|pr[oó]ximo\s+lunes|pr[oó]ximo\s+martes|pr[oó]ximo\s+mi[eé]rcoles|pr[oó]ximo\s+jueves|pr[oó]ximo\s+viernes|pr[oó]ximo\s+s[aá]bado|pr[oó]ximo\s+domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b/gi,'')
    .replace(/\b(?:el\s+)?\d{1,2}(?:\s+de\s+[a-záéíóúñ]+|[\/-]\d{1,2}(?:[\/-]20\d{2})?)\b/gi,'')
    .replace(/\b(?:a\s+las?\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm|h|hrs?|horas?)?\b/gi,'')
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .trim();
  return semanticLabel(quoted(text)||title,'Evento');
}
function targetDaysFromText(text){
  const input=normalize(text);
  if(/todos? los? dias|cada dia|diariamente|a diario/.test(input))return[0,1,2,3,4,5,6];
  if(/entre semana|lunes a viernes/.test(input))return[1,2,3,4,5];
  if(/fin de semana/.test(input))return[0,6];
  const names=[['domingo',0],['lunes',1],['martes',2],['miercoles',3],['jueves',4],['viernes',5],['sabado',6]];
  return names.filter(([name])=>new RegExp(`\\b${name}s?\\b`).test(input)).map(([,day])=>day);
}

function habitScheduleFromText(text){
  const input=normalize(text),days=targetDaysFromText(text),startDate=dateKey();
  const weekly=input.match(/\b(\d+)\s+(?:vez|veces)\s+(?:por|a\s+la)\s+semana\b/);
  if(weekly)return{type:'timesPerWeek',days:[],targetCount:Math.max(1,Number(weekly[1])),intervalDays:1,startDate,endDate:''};
  const monthly=input.match(/\b(\d+)\s+(?:vez|veces)\s+(?:por|al)\s+mes\b/);
  if(monthly)return{type:'timesPerMonth',days:[],targetCount:Math.max(1,Number(monthly[1])),intervalDays:1,startDate,endDate:''};
  const interval=input.match(/\bcada\s+(\d+)\s+dias?\b/);
  if(interval)return{type:'interval',days:[],targetCount:1,intervalDays:Math.max(1,Number(interval[1])),startDate,endDate:''};
  if(/todos? los? dias|cada dia|diariamente|a diario/.test(input))return{type:'daily',days:[0,1,2,3,4,5,6],targetCount:1,intervalDays:1,startDate,endDate:''};
  if(/fin de semana/.test(input))return{type:'weekends',days:[0,6],targetCount:1,intervalDays:1,startDate,endDate:''};
  if(days.length)return{type:'daysOfWeek',days,targetCount:1,intervalDays:1,startDate,endDate:''};
  return{type:'flexible',days:[],targetCount:1,intervalDays:1,startDate,endDate:''};
}
function habitMeasurementFromText(text){
  const input=normalize(text);
  const patterns=[
    [/\b(\d+(?:[.,]\d+)?)\s*(?:litros?|l)\b/,'volume','litros'],
    [/\b(\d+(?:[.,]\d+)?)\s*(?:min|minutos?)\b/,'minutes','min'],
    [/\b(\d+(?:[.,]\d+)?)\s*(?:horas?|h)\b/,'minutes','min'],
    [/\b(\d+(?:[.,]\d+)?)\s*(?:km|kilometros?)\b/,'distance','km'],
    [/\b(\d+(?:[.,]\d+)?)\s*(?:pasos?)\b/,'count','pasos'],
    [/\b(\d+(?:[.,]\d+)?)\s*(?:paginas?)\b/,'count','páginas'],
    [/\b(\d+(?:[.,]\d+)?)\s*(?:repeticiones?|flexiones?|sentadillas?)\b/,'repetitions','repeticiones']
  ];
  for(const [pattern,type,unit] of patterns){const match=input.match(pattern);if(match){let value=Number(match[1].replace(',','.'));if(type==='minutes'&&/horas?|\bh\b/.test(match[0]))value*=60;return{type,target:value,unit};}}
  return{type:'boolean',target:1,unit:'sesión'};
}
function recurrenceFromText(text,type){
  const input=normalize(text);
  let frequency='';
  if(/\b(?:todos? los? meses|cada mes|mensual(?:mente)?)\b/.test(input))frequency='monthly';
  else if(/\b(?:cada semana|semanal(?:mente)?)\b/.test(input))frequency='weekly';
  else if(/\b(?:cada quincena|quincenal(?:mente)?)\b/.test(input))frequency='biweekly';
  else if(/\b(?:cada ano|anual(?:mente)?)\b/.test(input))frequency='yearly';
  else if(/\b(?:cada dos meses|bimestral(?:mente)?)\b/.test(input))frequency='bimonthly';
  else if(/\b(?:cada tres meses|trimestral(?:mente)?)\b/.test(input))frequency='quarterly';
  const custom=input.match(/\bcada\s+(\d+)\s+meses?\b/);if(custom)frequency='custom-months';
  if(!frequency)return null;
  const dayMatch=input.match(/\b(?:dia|el)\s+(\d{1,2})\b/);
  const weekdayNames=[['domingo',0],['lunes',1],['martes',2],['miercoles',3],['jueves',4],['viernes',5],['sabado',6]];
  const weekday=weekdayNames.find(([name])=>new RegExp(`\\b${name}\\b`).test(input))?.[1]??new Date().getDay();
  const lastBusiness=/ultimo dia habil/.test(input),lastDay=/ultimo dia(?: del mes)?/.test(input)&&!lastBusiness;
  return{frequency,interval:custom?Number(custom[1]):1,day:Number(dayMatch?.[1])||new Date().getDate(),weekday,businessDay:lastBusiness?'last':'',dayRule:lastBusiness?'last-business-day':lastDay?'last-day':'',startDate:dateKey(),endDate:'',active:true,type};
}
function recurrenceLabel(recurrence){
  const labels={weekly:'semanal',biweekly:'quincenal',monthly:'mensual',bimonthly:'bimestral',quarterly:'trimestral',yearly:'anual'};
  if(recurrence?.frequency==='custom-months')return `cada ${Math.max(1,Number(recurrence.interval)||1)} meses`;
  return labels[recurrence?.frequency]||'recurrente';
}
function stripRecurrenceDecorators(value){
  return String(value||'')
    .replace(/\b(?:todos? los? meses|cada mes|mensual(?:mente)?|cada semana|semanal(?:mente)?|cada quincena|quincenal(?:mente)?|cada año|anual(?:mente)?|cada dos meses|bimestral(?:mente)?|cada tres meses|trimestral(?:mente)?|cada \d+ meses?)\b/gi,' ')
    .replace(/\b(?:el|día)\s+\d{1,2}\b/gi,' ')
    .replace(/\b(?:el\s+)?último\s+día(?:\s+hábil)?(?:\s+del\s+mes)?\b/gi,' ')
    .replace(/\s{2,}/g,' ').replace(/^[\s:,-]+|[\s:;,.]+$/g,'').trim();
}
function installmentFromText(text){
  const input=normalize(text),match=input.match(/\b(?:en|a)\s+(\d+)\s+cuotas?\b/);
  return match?Math.max(2,Number(match[1])):0;
}
function futurePurchaseIntent(text){return /\b(?:quiero|planeo|pienso|necesito|me gustaria)\s+comprar\b/i.test(text)&&Boolean(due(text));}
function daysBefore(key,amount){const d=new Date(`${key}T12:00:00`);d.setDate(d.getDate()-amount);return dateKey(d);}

function habitSemantics(text){
  const value=quoted(text)||stripHabitPrefix(text)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:litros?|l|min|minutos?|horas?|h|km|kilómetros?|pasos?|páginas?|repeticiones?|flexiones?|sentadillas?)\b/gi,match=>match.replace(/^\d+(?:[.,]\d+)?\s*/,''))
    .replace(/\s{2,}/g,' ').trim();
  return semanticLabel(value,'Hábito');
}
function expenseSemantics(text){
  const original=String(text||'').trim();
  let description=original.replace(moneyPattern,' ')
    .replace(/^(?:yo\s+)?(?:gast[eé]|pagu[eé]|pagamos|gastamos|me\s+cobraron|cobraron|registra|registr[eé]|agrega|añade)\s*/i,'')
    .replace(/^(?:(?:un|una|el|la)\s+)?(?:gasto|pago|cobro)\s*(?:de|por|en)?\s*/i,'')
    .replace(/^(?:en|de|por|para)\s+/i,'')
    .replace(/\b(?:con\s+tarjeta|en\s+efectivo)\b/gi,'')
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s:,-]+|[\s:;,.]+$/g,'')
    .trim();
  if(!description)description='Gasto';
  return{description:semanticLabel(description,'Gasto'),category:inferCategory(description)};
}
function projectSemantics(text){
  const original=String(text||'').trim();
  const named=original.match(/\b(?:proyecto|objetivo)\s+(?:nuevo\s+)?(?:llamado|denominado)\s+["“]?(.+?)["”]?(?=\s+(?:para|con\s+el\s+objetivo\s+de)\s+|$)/i);
  if(named){
    const title=cleanProjectName(named[1]);
    const goal=original.match(/\s+(?:para|con\s+el\s+objetivo\s+de)\s+(.+)$/i)?.[1]||'';
    return{names:title?[title]:[],goal:semanticLabel(goal,'')};
  }
  const conventional=original.match(/^(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?)\s+)?(?:crea(?:r)?|inicia(?:r)?|empieza|comienza|arma|abre|agrega|añade|nuevo|nueva)\s+(?:(?:un|una|el|la|los|las)\s+)?(?:proyectos|proyecto|objetivos|objetivo)\s*:?\s*(.+)$/i);
  if(conventional)return{names:splitProjectNames(conventional[1]),goal:''};
  const natural=original.match(/^(?:quiero|necesito|me\s+gustar[ií]a)\s+(?:crear|iniciar|empezar|comenzar|armar|abrir)\s+(?:(?:un|una)\s+)?(?:proyecto|objetivo)(?:\s+nuevo)?\s+(?:para|de)\s+(.+)$/i);
  if(natural){const title=semanticLabel(natural[1],'');return{names:title?[title]:[],goal:title};}
  return{names:[],goal:''};
}
function looksLikeImplicitTask(text){
  const input=normalize(text).trim();
  if(/^(?:tengo que|necesito|debo|hay que)\b/.test(input))return true;
  if(/^(?:quiero|quisiera|me gustaria)\s+[a-zñ]+(?:ar|er|ir)\b/.test(input))return true;
  return /^[a-zñ]+(?:ar|er|ir)\b/.test(input)&&(Boolean(due(text))||/\b(?:urgente|prioridad|para\s+(?:el\s+)?(?:proyecto\s+)?\S+)/.test(input));
}
function looksLikeHabitIntent(text){
  const input=normalize(text);
  return /\b(?:todos? los? dias|cada dia|diariamente|a diario|entre semana|lunes a viernes|fin de semana|\d+ (?:vez|veces) (?:por semana|a la semana|por mes|al mes)|cada \d+ dias?)\b/.test(input)
    || /^(?:quiero|necesito|me gustaria)\s+(?:(?:empezar|comenzar|volver)\s+a\s+)?[a-zñ]+(?:ar|er|ir)\b/.test(input)&&targetDaysFromText(text).length>0;
}

function detectActionType(text,mode,{wasBullet=false,currentProjectRef=''}={}){
  const input=normalize(text);
  if(isExplicitProjectCreation(text)||mode==='project')return'project';
  if(/^(?:ya\s+)?(?:completa|complete|termine|termina|finaliza|finalice|marca|marcar)\b/.test(input)||/\bcomo\s+completad[oa]\b/.test(input))return'complete';
  if(/\b(nota|anota|apunta|idea|recuerda|recordatorio|ten presente|deja anotado)\b/.test(input)||mode==='note')return'note';
  // El sustantivo explícito manda sobre verbos contenidos en el título.
  // “Agrega la tarea Comprar cable” es una tarea, no una compra; “tarea llamada” tampoco es una llamada.
  if(/^(?:(?:por favor )?(?:puedes?|podrias?|me puedes?) )?(?:crea(?:r)?|agrega(?:r)?|anade|registra(?:r)?|programa)\s+(?:(?:un|una|la)\s+)?(?:tarea|accion|pendiente)\b/.test(input)||mode==='task')return'task';
  if(/\b(evento|reunion|agenda|agendar|cita|programa|llamada|videollamada|dentista|medico)\b/.test(input)||/^(?:tengo|tendre)\s+(?:una?|la)\s+(?:reunion|cita|llamada)/.test(input)||/^(?:nos\s+reunimos|me\s+reuno|me\s+junto|voy\s+al?)\b/.test(input)&&Boolean(due(text))||mode==='event')return'event';
  if(/\b(habito|ritual)\b/.test(input)||looksLikeHabitIntent(text)||mode==='habit')return'habit';
  if(/\b(compre|compra|compras|comprar|adquiri|adquiere)\b/.test(input)||mode==='purchase')return'purchase';
  if(/\b(gaste|gastamos|gasto|pague|pagamos|pago|me cobraron|cobraron)\b/.test(input)||mode==='expense')return'expense';
  if(/\b(recibi|recibe|ingreso|cobre|cobro|vendi|vendimos|vendio|venta|depositaron|abonaron|sueldo|salario|honorarios|reembolso|devolucion)\b/.test(input)||/\bme\s+pagaron\b/.test(input)||mode==='income')return'income';
  if(moneyMatches(text).length&&/\b(?:mensual|cada mes|todos los meses|semanal|quincenal|anual)\b/.test(input))return/\b(?:sueldo|salario|ingreso|honorarios|me pagan|recibo)\b/.test(input)?'income':'expense';
  if((/\b(tarea|pendiente)\b/.test(input)||/^(?:crea|agrega|registra)\s+(?:una?\s+)?accion\b/.test(input)||looksLikeImplicitTask(text)||mode==='task')&&!/\bsin\s+accion\b/.test(input))return'task';
  if(/^(crea|agrega|añade|registra|programa)\b/.test(input))return'task';
  if(currentProjectRef&&wasBullet&&moneyMatches(text).length)return'purchase';
  if(currentProjectRef&&wasBullet&&(/^[a-zñ]+(?:ar|er|ir)\b/.test(input)||looksLikeImplicitTask(text)))return'task';
  return'';
}


const explicitMutationQuestionPattern=/^(?:¿?\s*)?(?:(?:por\s+favor\s+)?(?:puedes?|podr[ií]as?|me\s+puedes?)\s+)(?:crear|crea|agregar|agrega|añadir|añade|anotar|anota|guardar|guarda|registrar|registra|agendar|agenda|programar|programa|completar|completa|editar|edita|cambiar|cambia|eliminar|elimina|borrar|borra)\b/i;
const directQuestionPattern=/^(?:¿?\s*)?(?:que|qué|como|cómo|cuando|cuándo|donde|dónde|por que|por qué|cual|cuál|conviene|recomienda|analiza|explica|compara|ayudame|ayúdame)\b/i;

export function isOperationalRequest(text){
  const raw=String(text||'').trim(),input=normalize(raw);
  if(!raw)return false;
  if(explicitMutationQuestionPattern.test(raw))return true;
  if(directQuestionPattern.test(raw)&&!/^¿?\s*(?:que|qué)\s+(?:debo|tengo que|hay que)\s+(?:crear|agregar|registrar|anotar|agendar|completar|eliminar)\b/i.test(raw))return false;
  if(/^(?:abre|ir a|mostrar)\s+/.test(input))return false;
  if(mutationVerbPattern.test(input))return true;
  if(/(?:^|[:;,.]\s*|\s+y\s+)(?:crea|crear|agrega|agregar|anade|anadir|anota|guarda|registra|agenda|programa|completa|termina|finaliza|compra|gasta|paga|recibe|vende)\b/.test(input))return true;
  if(/^(?:ya\s+)?(?:termine|complete|finalice|marca|marcar)\b/.test(input))return true;
  if(/^(?:quiero|necesito|debo|tengo\s+que|hay\s+que|me\s+gustaria)\b/.test(input))return true;
  if(/^(?:tengo|tendre)\s+(?:una?|la)\s+(?:reunion|cita|llamada|evento)\b/.test(input))return true;
  if(moneyMatches(raw).length&&/\b(?:pague|gaste|compre|recibi|vendi|me\s+pagaron|cobraron|depositaron|abonaron|sueldo|salario|mensual|cada mes|todos los meses|semanal|quincenal|anual|cuotas?)\b/.test(input))return true;
  if(/^[a-z]+(?:ar|er|ir)\b/.test(input)&&(Boolean(due(raw))||/\b(?:urgente|prioridad|cada\s+\d+\s+dias?|veces?\s+por\s+(?:semana|mes))\b/.test(input)))return true;
  return tokenizeRequest(raw).some(token=>Boolean(detectActionType(token.text,'',{wasBullet:token.wasBullet,currentProjectRef:''})));
}

function explicitProjectApproval(sourceText,title){
  const source=normalize(sourceText),target=normalize(title);
  if(isExplicitProjectCreation(sourceText))return true;
  if(/\b(?:proyecto\s+nuevo|nuevo\s+proyecto)\b/.test(source)&&(!target||source.includes(target)))return true;
  return false;
}

function createMutationPlanner(state,raw){
  const projectRegistry=new Map();
  const projectOperations=[];
  const actionOperations=[];
  const sections=new Map();
  const warnings=[];
  const assumptions=[];
  const ambiguities=[];
  const counts={project:0,purchase:0,expense:0,income:0,task:0,note:0,event:0,habit:0,complete:0};
  let purchaseTotal=0;
  let incomeTotal=0;
  let expenseTotal=0;
  let currentProjectRef='';
  let currentMode='';
  let lastActionType='';

  function sectionFor(project){
    const key=project?.id||'unlinked';
    if(!sections.has(key))sections.set(key,{title:project?.title||'Sin proyecto',projectId:project?.id||'',isNew:Boolean(project?.isNew),items:[]});
    return sections.get(key);
  }
  function addSectionItem(project,item){sectionFor(project).items.push(item);}
  function ensureProject(reference,sourceText='',explicit=false){
    const title=cleanProjectName(reference);
    if(!looksLikeProjectReference(title))return null;
    const key=projectKey(title);
    const cached=projectRegistry.get(key);
    if(cached){if(explicit)cached.explicit=true;return cached;}
    const existing=findProjectExact(state,title);
    if(existing){
      const record={id:existing.id,title:existing.title,orbitId:existing.orbitId,isNew:false,explicit};
      projectRegistry.set(projectKey(existing.title),record);
      projectRegistry.set(key,record);
      return record;
    }
    const explicitOrbitId=findOrbit(state,sourceText||title);
    const approved=Boolean(explicit||explicitProjectApproval(sourceText,title));
    const record={id:id('p'),title,orbitId:explicitOrbitId||defaultOrbitId(state,sourceText||title),isNew:true,explicit,requiresApproval:!approved,approved};
    if(!explicitOrbitId){
      const orbit=state.orbits.find(item=>item.id===record.orbitId);
      if(orbit)assumptions.push(`El proyecto “${title}” se ubicará en la órbita ${orbit.name}.`);
    }
    projectRegistry.set(key,record);
    projectOperations.push({type:'create',collection:'projects',data:{id:record.id,title:record.title,goal:'',status:'active',budget:0,dueDate:'',createdAt:dateKey(),orbitId:record.orbitId,sourceText:sourceText||title},meta:{requiresApproval:record.requiresApproval,approved:record.approved,reason:record.requiresApproval?'El proyecto fue inferido desde una referencia y no desde una orden explícita de creación.':''}});
    counts.project+=1;
    addSectionItem(record,record.requiresApproval?`Proponer proyecto “${record.title}”; requiere autorización explícita antes de crearlo.`:`Crear proyecto “${record.title}” y usarlo como contexto.`);
    return record;
  }
  function resolveLinks(actionText,explicitReference='',options={}){
    const extracted=explicitReference?{reference:explicitReference,text:actionText}:extractProjectReference(actionText,state);
    const reference=cleanProjectName(extracted.reference||currentProjectRef);
    const project=reference?ensureProject(reference,raw,false):null;
    if(project)return{project,cleanedText:extracted.text,projectId:project.id,orbitId:project.orbitId};
    const existingId=findProject(state,actionText);
    const existing=state.projects.find(item=>item.id===existingId);
    const inferredOrbitId=existing?.orbitId||findOrbit(state,actionText)||'';
    return{project:existing?{id:existing.id,title:existing.title,orbitId:existing.orbitId,isNew:false}:null,cleanedText:extracted.text,projectId:existing?.id||'',orbitId:inferredOrbitId};
  }
  function addAction(type,project,operations,label,amountValue=0){
    counts[type]+=1;
    actionOperations.push(...operations);
    addSectionItem(project,label);
    if(type==='purchase')purchaseTotal+=amountValue;
    if(type==='income')incomeTotal+=amountValue;
    if(type==='expense')expenseTotal+=amountValue;
  }
  function parseProjectAction(text,implicit=false){
    const semantic=implicit?{names:splitProjectNames(text),goal:''}:projectSemantics(text);
    const names=semantic.names;
    if(!names.length){warnings.push(`No pude identificar el nombre del proyecto en “${text}”.`);return;}
    for(const name of names){
      const before=projectOperations.length;
      const project=ensureProject(name,text,true);
      if(!project)continue;
      const operation=projectOperations.find(item=>item.data?.id===project.id);
      if(operation&&semantic.goal)operation.data.goal=semantic.goal;
      if(projectOperations.length===before)addSectionItem(project,`El proyecto “${project.title}” ya existe; no se duplicará.`);
    }
    if(names.length===1)currentProjectRef=names[0];
  }
  function parseCompleteAction(text){
    const links=resolveLinks(text);
    const task=findTask(state,links.cleanedText,links.projectId);
    if(!task){warnings.push(`No encontré una tarea abierta que coincida con “${text}”.`);return;}
    const project=state.projects.find(item=>item.id===task.projectId)||links.project;
    addAction('complete',project,[{type:'update',collection:'tasks',id:task.id,patch:{done:true,completedAt:new Date().toISOString()}}],`Completar acción: ${task.title}.`);
  }
  function parsePurchaseAction(text,sourceText=text){
    const links=resolveLinks(text,'',{preserveUnlinked:true});
    const items=purchaseItems(links.cleanedText);
    if(!items.length){warnings.push(`No pude separar productos y montos en “${text}”.`);return;}
    const targetDate=due(sourceText)||due(links.cleanedText);
    const planned=futurePurchaseIntent(sourceText);
    const installments=installmentFromText(sourceText);
    for(const item of items){
      const description=`${item.quantity>1?`${item.quantity} × `:''}${item.title}`;
      if(item.quantity>1&&!/\b(cada(?:\s+una?)?|c\s*\/\s*u|por\s+unidad|total|en\s+total)\b/i.test(links.cleanedText))assumptions.push(`${description}: interpreté ${money(item.amount)} como total, no como valor unitario.`);
      if(planned&&targetDate){
        const goalId=id('fg'),taskId=id('t');
        const operations=[
          {type:'create',collection:'financialGoals',data:{id:goalId,title:`Comprar ${item.title}`,amount:item.amount,targetDate,status:'planned',category:item.category,projectId:links.projectId,orbitId:links.orbitId,createdAt:dateKey(),sourceText}},
          {type:'create',collection:'transactions',data:{id:id('tx'),type:'expense',amount:item.amount,description:`Compra planificada: ${item.title}`,category:item.category,projectId:links.projectId,orbitId:links.orbitId,date:targetDate,status:'planned',financialGoalId:goalId,sourceText}},
          {type:'create',collection:'tasks',data:{id:taskId,title:`Cotizar ${item.title}`,priority:'medium',dueDate:daysBefore(targetDate,7),estimate:30,done:false,createdAt:dateKey(),projectId:links.projectId,orbitId:links.orbitId,financialGoalId:goalId,sourceText}}
        ];
        addAction('purchase',links.project,operations,`Compra planificada: ${description} — ${money(item.amount)} · objetivo ${targetDate} · acción de cotización.`,item.amount);
        continue;
      }
      if(installments){
        const planId=id('ip'),installmentAmount=Math.round(item.amount/installments);
        const operations=[
          {type:'create',collection:'installmentPlans',data:{id:planId,type:'expense',description:item.title,totalAmount:item.amount,installments,installmentAmount,firstDate:targetDate||dateKey(),category:item.category,projectId:links.projectId,orbitId:links.orbitId,active:true,createdAt:dateKey(),sourceText}},
          {type:'create',collection:'transactions',data:{id:id('tx'),type:'expense',amount:installmentAmount,description:`${item.title} · cuota 1/${installments}`,category:item.category,projectId:links.projectId,orbitId:links.orbitId,date:targetDate||dateKey(),status:'confirmed',installmentPlanId:planId,installmentNumber:1,sourceText}}
        ];
        if(shouldTrackAsAsset(item))operations.push({type:'create',collection:'assets',data:{id:id('as'),title:item.title,quantity:item.quantity,unitAmount:item.unitAmount,category:item.category,amount:item.amount,projectId:links.projectId,orbitId:links.orbitId,purchasedAt:targetDate||dateKey(),warrantyUntil:'',notes:`Compra en ${installments} cuotas.`,sourceText}});
        addAction('purchase',links.project,operations,`Compra en cuotas: ${description} — ${money(item.amount)} · ${installments} cuotas de ${money(installmentAmount)}.`,item.amount);
        continue;
      }
      const operations=[{type:'create',collection:'transactions',data:{id:id('tx'),type:'expense',amount:item.amount,description,category:item.category,projectId:links.projectId,orbitId:links.orbitId,date:targetDate||dateKey(),status:'confirmed',sourceText}}];
      const inventory=shouldTrackAsAsset(item);
      if(inventory)operations.push({type:'create',collection:'assets',data:{id:id('as'),title:item.title,quantity:item.quantity,unitAmount:item.unitAmount,category:item.category,amount:item.amount,projectId:links.projectId,orbitId:links.orbitId,purchasedAt:targetDate||dateKey(),warrantyUntil:'',notes:'Creado desde la terminal.',sourceText}});
      addAction('purchase',links.project,operations,`Compra: ${description} — ${money(item.amount)}${item.quantity>1?` (${money(item.unitAmount)} c/u)`:''}${inventory?' · inventario conectado':' · solo movimiento'}.`,item.amount);
    }
  }
  function parseExpenseAction(text,sourceText=text){
    const links=resolveLinks(text,'',{preserveUnlinked:true}),value=amount(links.cleanedText);
    if(!value){warnings.push(`Falta el monto del gasto en “${text}”.`);return;}
    const recurrence=recurrenceFromText(sourceText,'expense');
    const semantic=expenseSemantics(links.cleanedText);
    const description=semanticLabel(stripRecurrenceDecorators(semantic.description),'Gasto');
    if(recurrence){
      const subtype=/\b(?:suscripci[oó]n|netflix|spotify|chatgpt|hosting|dominio|membres[ií]a|seguro)\b/i.test(sourceText)?'subscription':'fixed';
      addAction('expense',links.project,[{type:'create',collection:'recurringTransactions',data:{id:id('rt'),...recurrence,amount:value,description,category:semantic.category,subtype,projectId:links.projectId,orbitId:links.orbitId,createdAt:dateKey(),sourceText}}],`Gasto recurrente: ${description} — ${money(value)} · ${recurrenceLabel(recurrence)}.`,value);
      return;
    }
    addAction('expense',links.project,[{type:'create',collection:'transactions',data:{id:id('tx'),type:'expense',amount:value,description,category:semantic.category,projectId:links.projectId,orbitId:links.orbitId,date:due(sourceText)||dateKey(),status:'confirmed',sourceText}}],`Gasto: ${description} — ${money(value)} · ${semantic.category}.`,value);
  }
  function parseIncomeAction(text,sourceText=text){
    const links=resolveLinks(text,'',{preserveUnlinked:true}),value=amount(links.cleanedText);
    if(!value){warnings.push(`Falta el monto del ingreso en “${text}”.`);return;}
    const recurrence=recurrenceFromText(sourceText,'income');
    const semantic=incomeSemantics(links.cleanedText);
    const description=semanticLabel(stripRecurrenceDecorators(semantic.description),'Ingreso');
    if(recurrence){
      addAction('income',links.project,[{type:'create',collection:'recurringTransactions',data:{id:id('rt'),...recurrence,amount:value,description,category:semantic.category,subtype:'fixed',projectId:links.projectId,orbitId:links.orbitId,createdAt:dateKey(),sourceText,incomeReason:semantic.reason}}],`Ingreso recurrente: ${description} — ${money(value)} · ${recurrenceLabel(recurrence)}.`,value);
      return;
    }
    addAction('income',links.project,[{type:'create',collection:'transactions',data:{id:id('tx'),type:'income',amount:value,description,category:semantic.category,projectId:links.projectId,orbitId:links.orbitId,date:due(sourceText)||dateKey(),status:'confirmed',sourceText,incomeReason:semantic.reason}}],`Ingreso: ${description} — ${money(value)} · ${semantic.category}.`,value);
  }
  function parseTaskAction(text,implicit=false,sourceText=text){
    const links=resolveLinks(text),title=taskSemantics(links.cleanedText);
    if(!title){warnings.push(`No pude identificar la acción en “${text}”.`);return;}
    const dueDate=due(links.cleanedText),minutes=estimate(links.cleanedText);
    addAction('task',links.project,[{type:'create',collection:'tasks',data:{id:id('t'),title,priority:priority(links.cleanedText),dueDate,estimate:minutes,done:false,createdAt:dateKey(),projectId:links.projectId,orbitId:links.orbitId,sourceText}}],`Acción: ${title}${dueDate?` · ${dueDate}`:''}${minutes!==30?` · ${minutes} min`:''}.`);
  }
  function parseNoteAction(text,sourceText=text){
    const links=resolveLinks(text),semantic=noteSemantics(links.cleanedText);
    addAction('note',links.project,[{type:'create',collection:'notes',data:{id:id('n'),title:semantic.title,content:semantic.content,tags:inferTags(semantic.content),createdAt:dateKey(),projectId:links.projectId,orbitId:links.orbitId,sourceText}}],`Nota: ${semantic.title}.`);
  }
  function parseEventAction(text,sourceText=text){
    const links=resolveLinks(text),title=eventSemantics(links.cleanedText);
    const eventDate=due(links.cleanedText),time=eventTime(links.cleanedText);
    if(!eventDate)warnings.push(`El evento “${title}” quedó sin fecha porque no mencionaste una.`);
    addAction('event',links.project,[{type:'create',collection:'events',data:{id:id('e'),title,date:eventDate,time,projectId:links.projectId,orbitId:links.orbitId,sourceText}}],`Evento: ${title}${eventDate?` · ${eventDate}`:' · sin fecha'}${time?` ${time}`:''}.`);
  }
  function parseHabitAction(text,sourceText=text){
    const links=resolveLinks(text),title=habitSemantics(links.cleanedText),schedule=habitScheduleFromText(links.cleanedText),measurement=habitMeasurementFromText(links.cleanedText);
    const targetDays=schedule.type==='daily'?[0,1,2,3,4,5,6]:schedule.type==='weekends'?[0,6]:schedule.type==='daysOfWeek'?schedule.days:[];
    if(schedule.type==='flexible')assumptions.push(`El hábito “${title}” se creó sin días objetivo ni frecuencia fija; podrás registrarlo cualquier día.`);
    const frequencyLabel=schedule.type==='timesPerWeek'?`${schedule.targetCount} ${schedule.targetCount===1?'vez':'veces'} por semana`:schedule.type==='timesPerMonth'?`${schedule.targetCount} ${schedule.targetCount===1?'vez':'veces'} por mes`:schedule.type==='interval'?`cada ${schedule.intervalDays} ${schedule.intervalDays===1?'día':'días'}`:targetDays.length?`${targetDays.length} días programados`:'sin frecuencia fija';
    const targetLabel=measurement.type==='boolean'?'sesión completada':`${measurement.target} ${measurement.unit}`;
    addAction('habit',links.project,[{type:'create',collection:'habits',data:{id:id('h'),title,targetDays,schedule,measurement,history:{},skips:{},paused:false,createdAt:dateKey(),projectId:links.projectId,orbitId:links.orbitId,sourceText}}],`Hábito: ${title} · ${frequencyLabel} · objetivo ${targetLabel}.`);
  }
  const requestTokens=tokenizeRequest(raw);
  function processToken(token){
    const header=parseHeader(token.text,state);
    if(header){
      const previousMode=currentMode;
      if(header.projectRef)currentProjectRef=header.projectRef;
      currentMode=header.mode||'';
      if(header.remainder){
        for(const nested of tokenizeRequest(header.remainder))processToken({...nested,wasBullet:token.wasBullet||nested.wasBullet});
      }
      if(!header.persistent)currentMode=previousMode;
      return;
    }
    const directType=detectActionType(token.text,currentMode,{wasBullet:token.wasBullet,currentProjectRef});
    if(directType==='project'){parseProjectAction(token.text,currentMode==='project');lastActionType='project';return;}
    const extracted=extractProjectReference(token.text,state);
    if(extracted.reference)currentProjectRef=extracted.reference;
    const explicitReference=extracted.reference||currentProjectRef;
    let type=detectActionType(extracted.text,currentMode,{wasBullet:token.wasBullet,currentProjectRef});
    if(!type&&moneyMatches(extracted.text).length&&['purchase','expense','income'].includes(lastActionType))type=lastActionType;
    if(!type){
      if(mutationVerbPattern.test(token.text)||token.wasBullet||requestTokens.length>1){
        const ambiguity={id:id('seg'),text:token.text,reason:'No se pudo convertir esta línea en una operación verificable.',resolution:'pending'};
        ambiguities.push(ambiguity);
        warnings.push(`No interpreté esta línea: “${token.text}”. Debes corregirla o ignorarla explícitamente.`);
      }
      return;
    }
    if(type==='project'){parseProjectAction(extracted.text,currentMode==='project');lastActionType='project';return;}
    if(type==='complete'){parseCompleteAction(explicitReference?`${extracted.text} para el proyecto ${explicitReference}`:extracted.text);lastActionType='complete';return;}
    const actionText=explicitReference?`${extracted.text} para el proyecto ${explicitReference}`:extracted.text;
    if(type==='purchase')parsePurchaseAction(actionText,token.text);
    else if(type==='expense')parseExpenseAction(actionText,token.text);
    else if(type==='income')parseIncomeAction(actionText,token.text);
    else if(type==='task')parseTaskAction(actionText,currentMode==='task'||(token.wasBullet&&Boolean(currentProjectRef)),token.text);
    else if(type==='note')parseNoteAction(actionText,token.text);
    else if(type==='event')parseEventAction(actionText,token.text);
    else if(type==='habit')parseHabitAction(actionText,token.text);
    lastActionType=type;
  }

  for(const token of requestTokens)processToken(token);
  const operations=[...projectOperations,...actionOperations];
  const logicalActions=Object.entries(counts).filter(([key])=>key!=='project').reduce((sum,[,value])=>sum+value,0);
  if(!operations.length){
    const recognized=[...sections.values()].flatMap(section=>section.items);
    if(recognized.length)return{kind:'message',message:`No hay cambios por aplicar. ${recognized.join(' ')}`};
    return warnings.length||isOperationalRequest(raw)?{kind:'blocked',title:'Solicitud operativa incompleta',message:'No se aplicará nada ni se enviará esta solicitud a la conversación hasta que tenga operaciones verificables.',ambiguities:warnings.length?ambiguities:[{id:id('seg'),text:raw,reason:'No pude identificar una operación segura.',resolution:'pending'}]}:null;
  }
  const activeTypes=Object.entries(counts).filter(([key,value])=>key!=='project'&&value>0).map(([key])=>key);
  const projectCount=new Set([...sections.values()].filter(section=>section.projectId&&section.items.some(item=>!item.startsWith('Crear proyecto'))).map(section=>section.projectId)).size;
  const allPurchases=activeTypes.length===1&&activeTypes[0]==='purchase';
  const allIncome=activeTypes.length===1&&activeTypes[0]==='income';
  const allExpenses=activeTypes.length===1&&activeTypes[0]==='expense';
  const singleTypeTitle={task:'Crear tarea',note:'Guardar nota',event:'Agendar evento',habit:'Crear hábito',complete:'Completar tarea'};
  const pluralTypeTitle={task:'Crear tareas',note:'Guardar notas',event:'Agendar eventos',habit:'Crear hábitos',complete:'Completar tareas'};
  const onlyType=activeTypes.length===1?activeTypes[0]:'';
  const title=logicalActions===0&&counts.project
    ?(counts.project===1?'Crear proyecto':'Crear proyectos')
    :allPurchases
      ?(counts.purchase===1?'Registrar compra conectada':'Registrar compras conectadas')
      :allIncome
        ?(counts.income===1?'Registrar ingreso':'Registrar ingresos')
        :allExpenses
          ?(counts.expense===1?'Registrar gasto':'Registrar gastos')
          :onlyType&&singleTypeTitle[onlyType]
            ?(logicalActions===1?singleTypeTitle[onlyType]:pluralTypeTitle[onlyType])
            :(logicalActions===1&&counts.project===0?'Aplicar cambio conectado':'Aplicar acciones conectadas');
  const parts=[];
  if(logicalActions)parts.push(logicalActions===1?'1 acción':`${logicalActions} acciones`);
  if(projectCount)parts.push(`${projectCount} proyecto${projectCount===1?'':'s'} relacionado${projectCount===1?'':'s'}`);
  if(counts.project)parts.push(`${counts.project} proyecto${counts.project===1?' nuevo':'s nuevos'}`);
  if(purchaseTotal)parts.push(`compras por ${money(purchaseTotal)}`);
  if(incomeTotal)parts.push(`ingresos por ${money(incomeTotal)}`);
  if(expenseTotal)parts.push(`gastos por ${money(expenseTotal)}`);
  const confirmation=logicalActions===1&&counts.project===0?'El cambio se aplicará tras tu confirmación.':'Todo se aplicará en una sola confirmación.';
  const pendingProjectApprovals=projectOperations.filter(operation=>operation.meta?.requiresApproval&&!operation.meta?.approved).length;
  const projectNotice=counts.project?(pendingProjectApprovals?` ${pendingProjectApprovals} creación${pendingProjectApprovals===1?'':'es'} de proyecto requiere${pendingProjectApprovals===1?'':'n'} autorización explícita.`:' Los proyectos nuevos autorizados se crearán antes de vincular sus elementos.'):'';
  const summary=`${parts.join(' · ')}. ${confirmation}${projectNotice}`;
  const sectionList=[...sections.values()].filter(section=>section.items.length);
  const evidence=[];
  for(const section of sectionList){
    evidence.push(`${section.title}${section.isNew?' (nuevo)':''}: ${section.items.length} cambio${section.items.length===1?'':'s'}`);
  }
  return proposal(title,summary,operations,evidence,{sections:sectionList,warnings,assumptions:[...new Set(assumptions)],ambiguities,logicalActions,createdProjectCount:counts.project},state);
}

export function interpret(text,state){
  const raw=text.trim(),lower=normalize(raw);
  if(!raw)return{kind:'empty',message:'Escribe una orden o una pregunta.'};
  if(/^(ayuda|help|comandos|que puedes hacer)$/.test(lower))return{kind:'help'};
  if(/^(abre|ir a|mostrar)\s+/.test(lower)){
    const requested=lower.replace(/^(abre|ir a|mostrar)\s+/,'');
    const aliases={edicion:'edition','edicion del dia':'edition',terminal:'terminal',universo:'universe',radar:'universe',proyectos:'projects',tareas:'tasks',habitos:'habits',calendario:'calendar',finanzas:'finance',mesa:'workbench',workbench:'workbench',revision:'review',ajustes:'settings'};
    return{kind:'navigate',route:aliases[requested]||requested};
  }
  if(/planifica mi dia|organiza mi dia|que hago hoy|que deberia hacer primero hoy|que deberia priorizar(?: primero)? hoy|que hago primero hoy|por donde empiezo hoy/.test(lower))return{kind:'query',query:'plan'};
  if(/que necesita atencion|riesgos|alertas|que esta mal/.test(lower))return{kind:'query',query:'attention'};
  if(/edicion del dia|resumen del dia|brief|buenos dias/.test(lower))return{kind:'query',query:'brief'};
  if(/que cambio|actividad reciente|ultimos cambios/.test(lower))return{kind:'query',query:'changes'};
  if(/donde gasto mas|en que estoy gastando|analiza mis gastos/.test(lower))return{kind:'query',query:'spending'};
  if(/que tengo pendiente|tareas pendientes|que debo hacer/.test(lower))return{kind:'query',query:'tasks'};
  if(/estado|pulso|resumen general/.test(lower))return{kind:'query',query:'status'};
  if(/balance|cuanto he gastado|finanzas/.test(lower))return{kind:'query',query:'finance'};
  if(/resume (el )?proyecto|como va .*proyecto|estado de/.test(lower))return{kind:'query',query:'project',projectId:findProjectByQuery(state,raw)?.id||findProject(state,raw)};

  if(isOperationalRequest(raw)){
    const mutation=createMutationPlanner(state,raw);
    return mutation||{kind:'blocked',title:'Solicitud operativa bloqueada',message:'Detecté una intención de modificar datos, pero no pude convertirla en una propuesta segura. No se enviará a Ollama.',ambiguities:[{id:id('seg'),text:raw,reason:'Operación no verificable.',resolution:'pending'}]};
  }

  const openQuestion=/[?¿]/.test(raw)||/^(que|qué|como|cómo|cuando|cuándo|donde|dónde|por que|por qué|conviene|recomienda|analiza|explica|compara|ayudame|ayúdame)\b/.test(lower);
  if(openQuestion){
    const projectQuestion=findProjectByQuery(state,raw);
    return projectQuestion?{kind:'query',query:'project',projectId:projectQuestion.id}:{kind:'query',query:'general'};
  }

  const projectQuestion=findProjectByQuery(state,raw);
  if(/^(puedes|podrias|podrías)\b/.test(lower))return projectQuestion?{kind:'query',query:'project',projectId:projectQuestion.id}:{kind:'query',query:'general'};

  return{kind:'message',message:'Entendí el texto, pero no una operación segura. Indica si quieres crear una acción, nota, evento, hábito, proyecto, compra, gasto o ingreso.'};
}

export function answerQuery(result,state,now=new Date()){
  const query=typeof result==='string'?result:result.query;
  if(query==='plan'){
    const plan=dailyPlan(state,now),today=dateKey(now);
    if(!plan.focus.length){
      const habit=plan.habits[0];
      const event=plan.events[0];
      if(habit)return`Primero completa el hábito “${habit.title}”, que está programado para hoy. No hay tareas abiertas con prioridad suficiente para entrar al foco.`;
      if(event?.date===today)return`Primero prepárate para “${event.title}”${event.time?` a las ${event.time}`:''}. No hay tareas abiertas priorizadas para hoy.`;
      return'Tu día no tiene una acción prioritaria definida. Elige una tarea concreta antes de capturar más.';
    }
    const first=plan.focus[0];
    const due=first.dueDate?first.dueDate<today?'Está vencida.':first.dueDate===today?'Vence hoy.':`Está programada para ${first.dueDate}.`:'No tiene fecha límite.';
    const next=plan.focus.slice(1).map(task=>task.title);
    const habit=plan.habits[0]?` Después, registra el hábito “${plan.habits[0].title}”.`:'';
    const queue=next.length?` Luego continúa con ${next.map(title=>`“${title}”`).join(' y ')}.`:'';
    return`Primero trabaja en “${first.title}” durante ${first.estimate||30} minutos. ${due}${queue}${habit}`;
  }
  if(query==='attention'){
    const signals=attentionSignals(state,now),lines=[];
    if(signals.overdue.length)lines.push(`${signals.overdue.length} tareas vencidas: ${signals.overdue.slice(0,3).map(t=>t.title).join(' · ')}`);
    if(signals.risky.length)lines.push(`${signals.risky.length} proyectos en observación: ${signals.risky.slice(0,3).map(x=>`${x.project.title} (${x.health.risk}/100)`).join(' · ')}`);
    if(signals.finance.anomalies.length)lines.push(`Gasto atípico: ${signals.finance.anomalies[0].category} con ${money(signals.finance.anomalies[0].value)} este mes.`);
    return lines.length?lines.join('\n'):'No detecto señales críticas con los datos actuales.';
  }
  if(query==='brief'){
    const brief=buildDailyBrief(state,now),warnings=brief.warnings.length?` Atención: ${brief.warnings.join(', ')}.`:'';
    return`${brief.greeting}, ${state.profile.name}. ${brief.lead}${warnings}`;
  }
  if(query==='changes'){
    return state.activity.length?`Cambios recientes:\n${state.activity.slice(0,6).map(item=>`• ${item.message}`).join('\n')}`:'Todavía no hay actividad registrada.';
  }
  if(query==='spending'){
    const finance=financeSnapshot(state,now),entries=Object.entries(finance.byCategory).sort((a,b)=>b[1]-a[1]);
    return entries.length?`Gasto del mes por categoría:\n${entries.slice(0,5).map(([category,value])=>`• ${category}: ${money(value)}`).join('\n')}`:'No hay gastos registrados este mes.';
  }
  if(query==='tasks'){
    const plan=dailyPlan(state,now);return plan.backlog?`Tienes ${plan.backlog} acciones abiertas. Las primeras son: ${plan.focus.map(task=>task.title).join(' · ')}.`:'No tienes acciones abiertas.';
  }
  if(query==='finance'){
    const finance=financeSnapshot(state,now);return`El resultado confirmado del mes es ${money(finance.balance)}: ${money(finance.income)} recibidos menos ${money(finance.expense)} pagados. Quedan ${money(finance.pendingCommitments)} en compromisos y el cierre proyectado es ${money(finance.projectedBalance)}, incluyendo ${money(finance.variableAssumption)} de gasto variable estimado.`;
  }
  if(query==='project'){
    const project=state.projects.find(item=>item.id===result.projectId);if(!project)return'No pude identificar el proyecto.';
    const health=projectHealth(state,project,now);return`${project.title}: ${health.progress}% de progreso, ${health.open} acciones abiertas, ${health.overdue} vencidas y riesgo ${health.risk}/100. ${health.nextAction?`Próxima acción sugerida: ${health.nextAction.title}.`:'No tiene próxima acción.'}`;
  }
  const snapshot=contextSnapshot(state,now);return`Pulso: ${snapshot.projects.length} proyectos activos, ${snapshot.focus.length} acciones en foco, ${snapshot.overdue.length} vencidas y balance mensual ${money(snapshot.finance.balance)}.`;
}

export function applyOperations(state,operations){
  return applyOperationsAtomic(state,operations);
}
