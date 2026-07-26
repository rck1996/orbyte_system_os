import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askOllama, inspectOllama, probeOllama } from './server/ollama.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
let port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';
const json = (response, status, payload) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
};
async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 150000) throw new Error('Solicitud demasiado grande');
  }
  return raw ? JSON.parse(raw) : {};
}
async function ollamaStatus(payload) {
  return payload.probe ? probeOllama(payload) : inspectOllama(payload);
}
async function serve(pathname, response) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([.][.][/\\])+/, '');
  let file = join(root, safe === '/' ? 'index.html' : safe.replace(/^[/\\]/, ''));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  } catch {
    const data = await readFile(join(root, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(data);
  }
}
function errorMessage(error) { return error?.message || 'Error desconocido'; }
function start() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'POST' && url.pathname === '/api/ai/status') return json(response, 200, await ollamaStatus(await body(request)));
      if (request.method === 'POST' && url.pathname === '/api/ai/chat') return json(response, 200, await askOllama(await body(request)));
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Método no permitido' });
      return serve(url.pathname, response);
    } catch (error) {
      return json(response, 502, { error: errorMessage(error) });
    }
  });
  server.once('error', error => {
    if (error.code === 'EADDRINUSE') {
      port += 1;
      start();
      return;
    }
    throw error;
  });
  server.listen(port, host, () => console.log(`ORBYTE_ Personal OS listo en http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`));
}
start();
