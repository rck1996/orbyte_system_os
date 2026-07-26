import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=dirname(dirname(fileURLToPath(import.meta.url))),files=[];
function walk(path){for(const name of readdirSync(path)){const file=join(path,name);statSync(file).isDirectory()?walk(file):files.push(file);}}
walk(root);
for(const file of files.filter(file=>['.js','.mjs'].includes(extname(file)))){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status)throw new Error(`${file}\n${result.stderr}`);}
for(const required of ['index.html','server.mjs','app/main.js','core/kernel.js','core/relations.js','modules/assistant/engine.js','modules/assistant/operations.js','modules/assistant/gateway.js','shared/styles.css','shared/ui.js','sw.js'])if(!readFileSync(join(root,required),'utf8').length)throw new Error(`Falta ${required}`);
const tests=spawnSync(process.execPath,['--test','tests/*.test.mjs'],{cwd:root,encoding:'utf8',shell:true});
if(tests.status)throw new Error(tests.stdout+tests.stderr);
console.log(tests.stdout.trim());
console.log(`Verified ${files.length} files, kernel modules and assistant invariants.`);
