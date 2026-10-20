// Static navigation inventory, not a proof of feature completeness.
import {readFile,readdir,mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {execFileSync} from "node:child_process";
const root=fileURLToPath(new URL("../",import.meta.url));
const read=name=>readFile(path.join(root,name),"utf8");
const line=(text,index)=>text.slice(0,index).split("\n").length;
const index=await read("backend/index.js"), imports=new Map();
for(const match of index.matchAll(/import\s+(\w+)\s+from\s+['"]\.\/routes\/([^'"]+)['"]/g))imports.set(match[1],"backend/routes/"+match[2]);
const mounts=[];
for(const match of index.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g))if(imports.has(match[2]))mounts.push({prefix:match[1],router:match[2],file:imports.get(match[2]),line:line(index,match.index)});
const routes=[];
for(const file of [...new Set(mounts.map(row=>row.file))]){
 const source=await read(file), prefixes=mounts.filter(row=>row.file===file).map(row=>row.prefix);
 for(const match of source.matchAll(/\w+\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,([\s\S]*?)\);/g))routes.push({method:match[1].toUpperCase(),localPath:match[2],paths:prefixes.map(prefix=>prefix+(match[2]==="/"?"":match[2])),file,line:line(source,match.index),contained:match[3].includes("pendingEncounterRepair")});
}
const app=await read("frontend/src/App.jsx"), frontendRoutes=[];
for(const match of app.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g))frontendRoutes.push({path:match[1],file:"frontend/src/App.jsx",line:line(app,match.index)});
const list=async directory=>(await readdir(path.join(root,directory))).filter(name=>name.endsWith(".test.js")||name.endsWith(".spec.js")).sort().map(name=>directory+"/"+name);
const report={formatVersion:1,generatedAt:new Date().toISOString(),reviewBaseline:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),limitations:["Regex-extracted route/navigation inventory; computed paths and inline app handlers require manual review.","Routes and files existing do not establish working authorization, persistence, UI or deployment.","Task status and acceptance evidence are maintained in IMPLEMENTATION_TASKS.json and WORK_LOG.md."],mounts,routes,frontendRoutes,checks:{integration:await list("backend/tests/integration"),browser:await list("frontend/e2e")}};
if(process.argv.includes("--write")){await mkdir(path.join(root,"docs"),{recursive:true});await writeFile(path.join(root,"docs/IMPLEMENTATION_INVENTORY.json"),JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify({mounts:mounts.length,routeDeclarations:routes.length,frontendRouteDeclarations:frontendRoutes.length,containedRoutes:routes.filter(row=>row.contained).map(row=>row.paths),written:process.argv.includes("--write")},null,2));
