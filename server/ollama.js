import { isOperationalRequest } from '../modules/assistant/engine.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const STATUS_TIMEOUT_MS = 10_000;
const INFERENCE_TIMEOUT_MS = 180_000;
const RETRYABLE_COMPATIBILITY_STATUS = new Set([400, 404, 405, 422]);

export function localOllamaUrl(value = 'http://127.0.0.1:11434') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('La URL de Ollama debe usar http o https');
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error('Solo se permite una instancia local de Ollama');
  return url.origin;
}

export function modelMatches(installed, configured) {
  if (!installed || !configured) return false;
  const normalize = value => String(value).trim().toLowerCase();
  const left = normalize(installed);
  const right = normalize(configured);
  return left === right || left === `${right}:latest` || right === `${left}:latest`;
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function requestJson(url, options = {}, timeoutMs = STATUS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await readPayload(response);
    if (!response.ok) {
      const detail = payload.error || payload.message || payload.text || `HTTP ${response.status}`;
      const error = new Error(`Ollama respondió ${response.status}: ${detail}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Ollama no respondió dentro de ${Math.round(timeoutMs / 1000)} segundos`);
    if (error.cause?.code === 'ECONNREFUSED') throw new Error('No se pudo conectar con Ollama. Confirma que la aplicación esté abierta y escuchando en el puerto configurado.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function listOllamaModelRecords({ baseUrl }) {
  const base = localOllamaUrl(baseUrl);
  const data = await requestJson(`${base}/api/tags`);
  return (data.models || []).map(item => ({
    name: item.name || item.model,
    model: item.model || item.name,
    size: Number(item.size) || 0,
    modifiedAt: item.modified_at || '',
    details: item.details || {}
  })).filter(item => item.name);
}

export async function listOllamaModels(payload) {
  return (await listOllamaModelRecords(payload)).map(item => item.name);
}

async function showOllamaModel({ baseUrl, model }) {
  const base = localOllamaUrl(baseUrl);
  try {
    const data = await requestJson(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, verbose: false })
    });
    return {
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      details: data.details || {},
      modelInfo: data.model_info || {}
    };
  } catch (error) {
    if (RETRYABLE_COMPATIBILITY_STATUS.has(error.status)) return { capabilities: [], details: {}, modelInfo: {} };
    throw error;
  }
}

function requireModel(records, configured) {
  if (!configured) throw new Error('Debes indicar un modelo de Ollama');
  const installed = records.find(item => modelMatches(item.name, configured));
  if (!installed) throw new Error(`El modelo "${configured}" no está descargado. Ejecuta: ollama pull ${configured}`);
  return installed;
}

function normalizedFamily(record, shown) {
  const details = { ...(record?.details || {}), ...(shown?.details || {}) };
  return String(details.family || details.families?.[0] || '').toLowerCase();
}

export function modelRuntimeProfile(model, info = {}) {
  const name = String(model || '').toLowerCase();
  const capabilities = new Set(info.capabilities || []);
  const family = String(info.family || '').toLowerCase();
  const descriptor = `${name} ${family}`;
  const gptOss = /gpt[-_]?oss/.test(descriptor);
  const qwen3 = /qwen\s*3|qwen3/.test(descriptor);
  const knownThinking = gptOss || qwen3 || /deepseek[-_ ]?(r1|v3\.1)/.test(descriptor);
  const thinking = capabilities.has('thinking') || knownThinking;
  return {
    family,
    capabilities: [...capabilities],
    completionCompatible: capabilities.size === 0 || capabilities.has('completion'),
    think: gptOss ? 'low' : thinking ? false : undefined,
    noThinkToken: qwen3 ? '/no_think' : '',
    numPredict: thinking ? 720 : 420,
    numContext: 4096,
    temperature: 0.15,
    topP: 0.85
  };
}

function extractAnswer(result, endpoint) {
  const value = endpoint === 'chat' ? result?.message?.content : result?.response;
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || '').join('').trim();
  return String(value || '').trim();
}

function hasThinking(result, endpoint) {
  return Boolean(endpoint === 'chat' ? result?.message?.thinking : result?.thinking);
}

function chatPrompt(payload, suffix = '') {
  const financeRules = payload.intent === 'finance'
    ? 'En finanzas, el panel visual ya muestra todas las cifras. Escribe solo 2 o 3 observaciones útiles, máximo 70 palabras, sin títulos, tablas, listas de transacciones ni repetir todo el resumen. Usa exactamente los nombres confirmedResult como resultado confirmado y projectedResult como cierre proyectado. No los llames saldo bancario ni dinero disponible.'
    : 'Máximo 120 palabras, salvo petición explícita de detalle.';
  const system = `Eres ORBYTE_AI, una capa exclusivamente conversacional. Responde siempre en español, de forma directa y sin plantillas genéricas. La RESPUESTA DEL KERNEL es la conclusión verificada y el CONTEXTO JSON contiene únicamente hechos disponibles: no inventes datos, cálculos, fechas, metas, causas ni relaciones. Mantén la intención indicada y no cambies de tema. Para consultas sobre el día, empieza por la primera acción concreta del kernel y no menciones finanzas salvo que la pregunta sea financiera. Para finanzas, no recalcules cifras ni introduzcas importes ausentes. No uses encabezados en inglés. Nunca narres una operación como si se hubiera ejecutado. ${financeRules} Entrega solo la respuesta final y no expongas razonamiento interno.`;
  const user = `INTENCIÓN: ${payload.intent || payload.context?.intent || 'general'}

PREGUNTA ACTUAL:
${payload.question}

RESPUESTA DEL KERNEL — CONCLUSIÓN OBLIGATORIA:
${payload.localAnswer}

CONTEXTO ESTRUCTURADO SELECTIVO:
${JSON.stringify(payload.context)}${suffix ? `

${suffix}` : ''}`;
  return { system, user };
}

function completionOptions(profile, multiplier = 1) {
  return {
    temperature: profile.temperature,
    num_predict: Math.round(profile.numPredict * multiplier),
    num_ctx: profile.numContext,
    top_p: profile.topP
  };
}

async function requestCompletion({ base, model, payload, profile, endpoint, think, multiplier = 1, useNoThinkToken = false }) {
  const suffix = useNoThinkToken && profile.noThinkToken ? profile.noThinkToken : '';
  const { system, user } = chatPrompt(payload, suffix);
  const body = endpoint === 'chat'
    ? {
        model,
        stream: false,
        keep_alive: '10m',
        messages: [
          { role: 'system', content: system },
          ...(Array.isArray(payload.history) ? payload.history.slice(-6) : []),
          { role: 'user', content: user }
        ],
        options: completionOptions(profile, multiplier)
      }
    : {
        model,
        system,
        prompt: user,
        stream: false,
        keep_alive: '10m',
        options: completionOptions(profile, multiplier)
      };
  if (think !== undefined) body.think = think;
  const result = await requestJson(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, INFERENCE_TIMEOUT_MS);
  return { result, answer: extractAnswer(result, endpoint), hadThinking: hasThinking(result, endpoint) };
}

async function completeWithCompatibility({ base, model, payload, profile }) {
  const attempts = [];
  const plans = [
    { endpoint: 'chat', think: profile.think, multiplier: 1, label: 'chat-adaptativo' },
    { endpoint: 'chat', think: undefined, multiplier: 1.4, useNoThinkToken: true, label: 'chat-compatible' },
    { endpoint: 'generate', think: profile.think, multiplier: 1.25, label: 'generate-adaptativo' },
    { endpoint: 'generate', think: undefined, multiplier: 1.6, useNoThinkToken: true, label: 'generate-compatible' }
  ];

  let lastError;
  for (const plan of plans) {
    try {
      const output = await requestCompletion({ base, model, payload, profile, ...plan });
      attempts.push({ endpoint: plan.endpoint, mode: plan.label, ok: Boolean(output.answer), hadThinking: output.hadThinking });
      if (output.answer) return { ...output, endpoint: plan.endpoint, mode: plan.label, attempts };
      lastError = new Error(output.hadThinking
        ? 'El modelo agotó la salida en razonamiento y no entregó una respuesta final.'
        : 'El modelo terminó sin texto de respuesta.');
    } catch (error) {
      lastError = error;
      attempts.push({ endpoint: plan.endpoint, mode: plan.label, ok: false, status: error.status || 0, error: error.message });
      if (!RETRYABLE_COMPATIBILITY_STATUS.has(error.status) && plan.endpoint === 'chat') throw error;
    }
  }
  const diagnostic = attempts.map(item => `${item.mode}: ${item.ok ? 'ok' : item.error || (item.hadThinking ? 'solo razonamiento' : 'vacío')}`).join(' · ');
  throw new Error(`${lastError?.message || 'Ollama respondió sin contenido'} Intentos: ${diagnostic}`);
}

export async function inspectOllama(payload) {
  const base = localOllamaUrl(payload.baseUrl);
  const records = await listOllamaModelRecords({ baseUrl: base });
  const enriched = await Promise.all(records.map(async record => {
    const shown = await showOllamaModel({ baseUrl: base, model: record.name });
    const family = normalizedFamily(record, shown);
    const profile = modelRuntimeProfile(record.name, { capabilities: shown.capabilities, family });
    return {
      ...record,
      details: { ...record.details, ...shown.details },
      capabilities: shown.capabilities,
      compatible: profile.completionCompatible
    };
  }));
  const selected = enriched.find(item => modelMatches(item.name, payload.model)) || null;
  return {
    ok: true,
    models: enriched,
    modelAvailable: Boolean(selected),
    selectedModel: selected
  };
}

export async function probeOllama(payload) {
  const base = localOllamaUrl(payload.baseUrl);
  const records = await listOllamaModelRecords({ baseUrl: base });
  const record = requireModel(records, payload.model);
  const shown = await showOllamaModel({ baseUrl: base, model: record.name });
  const family = normalizedFamily(record, shown);
  const profile = modelRuntimeProfile(record.name, { capabilities: shown.capabilities, family });
  if (!profile.completionCompatible) throw new Error(`El modelo "${record.name}" no admite generación de texto para conversación.`);
  const started = Date.now();
  const result = await completeWithCompatibility({
    base,
    model: record.name,
    profile: { ...profile, numPredict: Math.min(profile.numPredict, 320) },
    payload: { question: 'Responde únicamente con la palabra OK.', localAnswer: 'OK', context: {}, history: [] }
  });
  return {
    ok: true,
    models: records.map(item => item.name),
    model: record.name,
    modelAvailable: true,
    probeAnswer: result.answer,
    endpoint: result.endpoint,
    compatibilityMode: result.mode,
    thinkingPolicy: profile.think === undefined ? 'automática' : String(profile.think),
    capabilities: shown.capabilities,
    family,
    parameterSize: shown.details?.parameter_size || record.details?.parameter_size || '',
    quantization: shown.details?.quantization_level || record.details?.quantization_level || '',
    latencyMs: Date.now() - started
  };
}

export async function askOllama(payload) {
  if (payload?.requestKind !== 'conversation') throw new Error('El endpoint generativo solo acepta solicitudes conversacionales clasificadas por el kernel.');
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  if (!question) throw new Error('La solicitud conversacional necesita una pregunta válida.');
  if (isOperationalRequest(question)) throw new Error('Solicitud operativa bloqueada antes de consultar Ollama.');
  payload = { ...payload, question };
  const base = localOllamaUrl(payload.baseUrl);
  const records = await listOllamaModelRecords({ baseUrl: base });
  const record = requireModel(records, payload.model);
  const shown = await showOllamaModel({ baseUrl: base, model: record.name });
  const family = normalizedFamily(record, shown);
  const profile = modelRuntimeProfile(record.name, { capabilities: shown.capabilities, family });
  if (!profile.completionCompatible) throw new Error(`El modelo "${record.name}" no admite generación de texto para conversación.`);
  const started = Date.now();
  const result = await completeWithCompatibility({ base, model: record.name, payload, profile });
  return {
    answer: result.answer,
    model: record.name,
    endpoint: result.endpoint,
    compatibilityMode: result.mode,
    thinkingPolicy: profile.think === undefined ? 'automática' : String(profile.think),
    latencyMs: Date.now() - started
  };
}
