import {readFile,access} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";
const root=fileURLToPath(new URL("../",import.meta.url));
const data=JSON.parse(await readFile(path.join(root,"docs/IMPLEMENTATION_TASKS.json"),"utf8"));
const tasks=new Map(data.tasks.map(task=>[task.id,task]));
if(tasks.size!==data.tasks.length)throw new Error("Duplicate task IDs");
const active=new Set(),done=new Set();
function visit(id){
 const task=tasks.get(id);if(!task)throw new Error("Unknown dependency "+id);
 if(active.has(id))throw new Error("Dependency cycle at "+id);if(done.has(id))return;
 if(!Object.hasOwn(data.statusRules,task.status))throw new Error("Unknown status "+id);
 if(task.status==="verified_local" && !task.verification?.reference)throw new Error("Verification evidence missing for "+id);
 active.add(id);for(const dependency of task.dependsOn)visit(dependency);active.delete(id);done.add(id);
}
for(const task of tasks.values()){
 visit(task.id);
 for(const file of task.evidence){const target=path.resolve(root,file);if(!target.startsWith(root))throw new Error("Evidence path outside repository");await access(target);}
 if(!task.implementation?.length || !task.acceptance?.length)throw new Error("Implementation/acceptance missing for "+task.id);
}
if(!tasks.has(data.startWith))throw new Error("Invalid starting task");
console.log(JSON.stringify({tasks:tasks.size,verifiedLocal:data.tasks.filter(task=>task.status==="verified_local").map(task=>task.id),next:data.startWith,evidencePaths:"exist",dependencies:"acyclic",scope:"Plan consistency only; not application acceptance"}));

if(process.argv.includes("--next")){
 const ready=data.tasks.filter(task=>task.status==="pending" && task.dependsOn.every(id=>tasks.get(id).status==="verified_local"));
 const selected=ready.find(task=>task.id===data.startWith) || ready[0];
 console.log(JSON.stringify(selected || {next:null,message:"No pending task has verified local dependencies; inspect current verification/external blockers."},null,2));
}
