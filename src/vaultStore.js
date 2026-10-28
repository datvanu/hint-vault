import { Clusterer } from './clusterer.js';
import { vectorize, moderate, heuristicRate } from './aiProvider.js';
export class VaultStore {
  constructor({ threshold=.36, cap=1, pricing={mock:{input:0,output:0}}, blocklist=[] }={}) {
    this.session={id:'session-1',broadcasterId:'demo',startedAt:Date.now(),demo:true,costUsd:0}; this.puzzle={id:'puzzle-1',sessionId:this.session.id,name:'Lever Hall',context:'Pull four colored levers in order; the order is shown by colored dots on a faded poster.',state:'collecting',maxReleasedLevel:-1};
    this.hints=[]; this.groups=[]; this.helpers=new Map(); this.released=[]; this.lastReleasedGroupId=null; this.open=false; this.cost={cap,pricing,spent:0,fallback:false}; this.clusterer=new Clusterer(threshold); this.blocklist=blocklist; this.lastActivity=Date.now();
  }
  addHint({userId,userLogin=userId,displayName=userLogin,text,messageId=null}, rating) {
    if (moderate(text,this.blocklist)) return null;
    const hint={id:`h${this.hints.length+1}`,puzzleId:this.puzzle.id,userId,userLogin,displayName,text,createdAt:Date.now(),messageId,level:rating?.level ?? heuristicRate(this.puzzle.context,text),flags:[]};
    hint.embedding=vectorize(text); this.hints.push(hint); const group=this.clusterer.add(this.groups,hint,hint.embedding); hint.groupId=group.id; this.lastActivity=Date.now(); return hint;
  }
  counts(){return {hints:this.hints.length,groups:this.groups.length,viewers:new Set(this.hints.map(h=>h.userId)).size};}
  release(maxLevel=this.puzzle.maxReleasedLevel) {
    this.puzzle.state='released'; this.open=true; this.puzzle.maxReleasedLevel=maxLevel;
    const available=this.groups.filter(g=>g.level<=maxLevel).sort((a,b)=>a.level-b.level||b.distinctUsers.size-a.distinctUsers.size).slice(0,3);
    this.released=available.map(g=>({groupId:g.id,level:g.level,text:g.repText,rank:g.distinctUsers.size})); if(available.length) this.lastReleasedGroupId=available[0].id; return this.released;
  }
  more(){return this.release(Math.min(3,this.puzzle.maxReleasedLevel+1));}
  solve(user=null){ if(user){const h=this.hints.find(x=>x.userId===user||x.userLogin===user.replace(/^@/,'')); if(h)this.credit(h.userId,h.displayName);} else {const group=this.groups.find(g=>g.id===this.lastReleasedGroupId); if(group) for(const id of group.distinctUsers){const h=this.hints.find(x=>x.userId===id);if(h)this.credit(id,h.displayName);}}
    this.puzzle.state='solved'; return this.board(); }
  credit(id,name){const x=this.helpers.get(id)||{userId:id,displayName:name,helps:0};x.helps++;this.helpers.set(id,x);}
  board(){return [...this.helpers.values()].sort((a,b)=>b.helps-a.helps).slice(0,10).map(({displayName,helps})=>({displayName,helps}));}
  forget(userId){const removed=new Set(this.hints.filter(h=>h.userId===userId).map(h=>h.id)); this.hints=this.hints.filter(h=>h.userId!==userId);this.helpers.delete(userId);this.groups=[];for(const h of this.hints){h.embedding ||= vectorize(h.text);this.clusterer.add(this.groups,h,h.embedding);}if(this.lastReleasedGroupId&&!this.groups.some(g=>g.id===this.lastReleasedGroupId))this.lastReleasedGroupId=null;return removed.size;}
  reset(){this.hints=[];this.groups=[];this.helpers.clear();this.released=[];this.lastReleasedGroupId=null;this.open=false;this.puzzle={id:`puzzle-${Date.now()}`,sessionId:this.session.id,name:'Lever Hall',context:'Pull four colored levers in order; the order is shown by colored dots on a faded poster.',state:'collecting',maxReleasedLevel:-1};}
  state(){return {mode:this.puzzle.state==='solved'?'solved':this.open?'open':'sealed',puzzle:{id:this.puzzle.id,name:this.puzzle.name},counts:this.counts(),released:this.open?this.released:[],helpedBoard:this.board(),costMeter:{usdSpent:this.cost.spent,usdCap:this.cost.cap,warning:this.cost.spent>=this.cost.cap*.8,aiPaused:this.cost.fallback}};}
}
