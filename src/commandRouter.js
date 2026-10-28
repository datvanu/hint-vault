export function parseCommand(text){const s=String(text||'').trim();const m=s.match(/^!(hint|stuck|more|solved|puzzle|vault|forgetme|vaultreset)(?:\s+([\s\S]*))?$/i);return m?{command:m[1].toLowerCase(),args:(m[2]||'').trim()}:null;}
export class CommandRouter {
  constructor({store,limiter,hub,blocklist=[],onReply=()=>{}}){Object.assign(this,{store,limiter,hub,blocklist,onReply});this.moreConfirmAt=0;}
  isPrivileged(msg){return (msg.badges||[]).some(b=>['broadcaster','moderator'].includes(b.set_id));}
  handle(msg){const p=parseCommand(msg.text);if(!p)return false;const who=msg.userId||msg.user_id||'anon';
    if(p.command==='hint'){if(p.args.length<3||p.args.length>300||!this.limiter.allowHint(who,this.store.puzzle.id))return true;const hint=this.store.addHint({userId:who,userLogin:msg.userLogin||who,displayName:msg.displayName||msg.userLogin||who,text:p.args,messageId:msg.messageId});this.publish();return true;}
    if(p.command==='vault'){if(this.limiter.allowOutgoing())this.onReply(`Vault: ${this.store.hints.length} hints from ${this.store.counts().viewers} viewers`);return true;}
    if(p.command==='forgetme'){this.store.forget(who);this.limiter.forget(who);this.publish();if(this.limiter.allowOutgoing())this.onReply(`@${msg.userLogin||who} your data was deleted`);return true;}
    if(['stuck','more','solved','puzzle','vaultreset'].includes(p.command)&&!this.isPrivileged(msg))return true;
    if(p.command==='stuck'){this.store.release(0);this.hub.broadcast({...this.store.state(),mode:'opening',released:[]});setTimeout(()=>this.publish(),1500).unref?.();}
    if(p.command==='more'){const now=Date.now();if(this.store.puzzle.maxReleasedLevel===2&&now-this.moreConfirmAt>10000){this.moreConfirmAt=now;if(this.limiter.allowOutgoing())this.onReply('Are you sure? Type !more again');return true;}this.store.more();this.moreConfirmAt=0;}
    if(p.command==='solved')this.store.solve(p.args||null);
    if(p.command==='puzzle'){this.store.reset();if(p.args)this.store.puzzle.name=p.args;}
    if(p.command==='vaultreset')this.store.reset();this.publish();return true;
  }
  publish(){this.hub.broadcast(this.store.state());}
  streamOffline(){this.store.reset();this.publish();}
}
