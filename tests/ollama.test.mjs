import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {askOllama, localOllamaUrl, modelMatches, probeOllama} from '../server/ollama.js';

async function mockOllama(handler){
  const server=createServer(handler);
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  return{baseUrl:`http://127.0.0.1:${address.port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}

function json(response,status,payload){response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(payload));}
async function requestBody(request){let raw='';for await(const chunk of request)raw+=chunk;return JSON.parse(raw||'{}');}

test('solo permite Ollama local',()=>{assert.equal(localOllamaUrl('http://127.0.0.1:11434'),'http://127.0.0.1:11434');assert.throws(()=>localOllamaUrl('https://example.com'),/instancia local/);});
test('normaliza la etiqueta latest del modelo',()=>{assert.equal(modelMatches('qwen2.5:3b','qwen2.5:3b'),true);assert.equal(modelMatches('qwen2.5:3b','qwen2.5:3b:latest'),true);});
test('probar conexión realiza una inferencia real y precarga el modelo',async()=>{
  let generated=false;
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'qwen2.5:3b'}]});
    if(request.url==='/api/generate'){const body=await requestBody(request);generated=body.keep_alive==='10m'&&body.stream===false;return json(response,200,{response:'OK'});}
    return json(response,404,{error:'missing'});
  });
  try{const result=await probeOllama({baseUrl:mock.baseUrl,model:'qwen2.5:3b'});assert.equal(result.ok,true);assert.equal(result.model,'qwen2.5:3b');assert.equal(generated,true);}finally{await mock.close();}
});
test('chat usa la inferencia de Ollama y devuelve metadatos',async()=>{
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'qwen2.5:3b'}]});
    if(request.url==='/api/chat'){const body=await requestBody(request);assert.equal(body.stream,false);assert.equal(body.keep_alive,'10m');return json(response,200,{message:{content:'Respuesta razonada'}});}
    return json(response,404,{error:'missing'});
  });
  try{const result=await askOllama({baseUrl:mock.baseUrl,model:'qwen2.5:3b',requestKind:'conversation',question:'¿Qué hago?',localAnswer:'Base',context:{focus:[]}});assert.equal(result.answer,'Respuesta razonada');assert.equal(result.endpoint,'chat');}finally{await mock.close();}
});
test('si chat no existe usa generate como compatibilidad',async()=>{
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'qwen2.5:3b'}]});
    if(request.url==='/api/chat')return json(response,404,{error:'endpoint no disponible'});
    if(request.url==='/api/generate')return json(response,200,{response:'Respuesta compatible'});
    return json(response,404,{error:'missing'});
  });
  try{const result=await askOllama({baseUrl:mock.baseUrl,model:'qwen2.5:3b',requestKind:'conversation',question:'Hola',localAnswer:'Base',context:{}});assert.equal(result.answer,'Respuesta compatible');assert.equal(result.endpoint,'generate');}finally{await mock.close();}
});

test('Qwen 3 desactiva pensamiento para reservar salida a la respuesta final',async()=>{
  let receivedThink;
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'qwen3:8b',details:{family:'qwen3'}}]});
    if(request.url==='/api/show')return json(response,200,{capabilities:['completion','thinking'],details:{family:'qwen3',parameter_size:'8.2B'}});
    if(request.url==='/api/chat'){const body=await requestBody(request);receivedThink=body.think;return json(response,200,{message:{content:'Respuesta final'}});}
    return json(response,404,{error:'missing'});
  });
  try{const result=await askOllama({baseUrl:mock.baseUrl,model:'qwen3:8b',requestKind:'conversation',question:'Hola',localAnswer:'Base',context:{}});assert.equal(receivedThink,false);assert.equal(result.answer,'Respuesta final');assert.equal(result.thinkingPolicy,'false');}finally{await mock.close();}
});

test('si un modelo devuelve solo razonamiento reintenta sin perder la respuesta final',async()=>{
  let calls=0;
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'qwen3:8b',details:{family:'qwen3'}}]});
    if(request.url==='/api/show')return json(response,200,{capabilities:['completion','thinking'],details:{family:'qwen3'}});
    if(request.url==='/api/chat'){
      calls+=1;
      const body=await requestBody(request);
      if(calls===1)return json(response,200,{message:{content:'',thinking:'razonamiento interno'}});
      assert.match(body.messages.at(-1).content,/\/no_think/);
      return json(response,200,{message:{content:'Respuesta recuperada'}});
    }
    return json(response,404,{error:'missing'});
  });
  try{const result=await askOllama({baseUrl:mock.baseUrl,model:'qwen3:8b',requestKind:'conversation',question:'Hola',localAnswer:'Base',context:{}});assert.equal(calls,2);assert.equal(result.answer,'Respuesta recuperada');assert.equal(result.compatibilityMode,'chat-compatible');}finally{await mock.close();}
});

test('GPT-OSS usa nivel de razonamiento bajo compatible con su API',async()=>{
  let receivedThink;
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'gpt-oss:20b',details:{family:'gptoss'}}]});
    if(request.url==='/api/show')return json(response,200,{capabilities:['completion','thinking'],details:{family:'gptoss'}});
    if(request.url==='/api/chat'){const body=await requestBody(request);receivedThink=body.think;return json(response,200,{message:{content:'Listo'}});}
    return json(response,404,{error:'missing'});
  });
  try{await askOllama({baseUrl:mock.baseUrl,model:'gpt-oss:20b',requestKind:'conversation',question:'Hola',localAnswer:'Base',context:{}});assert.equal(receivedThink,'low');}finally{await mock.close();}
});

test('rechaza modelos de embeddings antes de intentar conversar',async()=>{
  let chatted=false;
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'nomic-embed-text'}]});
    if(request.url==='/api/show')return json(response,200,{capabilities:['embedding'],details:{family:'nomic-bert'}});
    if(request.url==='/api/chat'){chatted=true;return json(response,200,{message:{content:'no'}});}
    return json(response,404,{error:'missing'});
  });
  try{await assert.rejects(()=>askOllama({baseUrl:mock.baseUrl,model:'nomic-embed-text',requestKind:'conversation',question:'Hola',localAnswer:'Base',context:{}}),/no admite generación de texto/);assert.equal(chatted,false);}finally{await mock.close();}
});

test('el endpoint generativo rechaza operaciones aunque se invoque directamente',async()=>{
  const originalFetch=globalThis.fetch;
  let fetched=false;
  globalThis.fetch=()=>{fetched=true;throw new Error('no debe consultar Ollama');};
  try{
    await assert.rejects(()=>askOllama({baseUrl:'http://127.0.0.1:11434',model:'qwen3:8b',requestKind:'conversation',question:'crea una tarea para mañana',localAnswer:'',context:{}}),/operativa bloqueada/i);
    assert.equal(fetched,false);
    await assert.rejects(()=>askOllama({baseUrl:'http://127.0.0.1:11434',model:'qwen3:8b',question:'Hola',localAnswer:'',context:{}}),/solo acepta solicitudes conversacionales/i);
    await assert.rejects(()=>askOllama({baseUrl:'http://127.0.0.1:11434',model:'qwen3:8b',requestKind:'conversation',message:'crea una tarea',localAnswer:'',context:{}}),/pregunta válida/i);
    assert.equal(fetched,false);
  }finally{globalThis.fetch=originalFetch;}
});


test('la ruta financiera pide una lectura breve y no un segundo informe',async()=>{
  let systemPrompt='';
  const mock=await mockOllama(async(request,response)=>{
    if(request.url==='/api/tags')return json(response,200,{models:[{name:'gemma4:12b'}]});
    if(request.url==='/api/show')return json(response,200,{capabilities:['completion'],details:{family:'gemma'}});
    if(request.url==='/api/chat'){
      const body=await requestBody(request);
      systemPrompt=body.messages[0].content;
      return json(response,200,{message:{content:'Los compromisos son el principal punto a vigilar.'}});
    }
    return json(response,404,{error:'missing'});
  });
  try{
    await askOllama({baseUrl:mock.baseUrl,model:'gemma4:12b',requestKind:'conversation',intent:'finance',question:'¿Cómo van mis finanzas?',localAnswer:'Base',context:{finance:{confirmedResult:1,projectedResult:1}}});
    assert.match(systemPrompt,/máximo 70 palabras/i);
    assert.match(systemPrompt,/sin títulos, tablas/i);
    assert.match(systemPrompt,/no los llames saldo bancario/i);
  }finally{await mock.close();}
});
