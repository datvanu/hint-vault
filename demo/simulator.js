import { readFile } from 'node:fs/promises';
export async function runSimulator(router,{speed=1,onEvent=()=>{}}={}) {
  const events=JSON.parse(await readFile(new URL('./script.json',import.meta.url),'utf8'));
  const start=Date.now();
  await Promise.all(events.map(e=>new Promise(resolve=>setTimeout(()=>{
    if(e.event==='stream.offline') router.streamOffline();
    else router.handle({text:e.text,userId:e.user,userLogin:e.user,displayName:e.name,badges:e.role?[{set_id:e.role}]:[]});
    onEvent(e); resolve();
  },e.at/Math.max(.1,speed)))));
  return {elapsedMs:Date.now()-start};
}
