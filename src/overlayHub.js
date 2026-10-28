export class OverlayHub {
  constructor(){this.clients=new Set();this.last=0;this.pending=null;}
  add(client){this.clients.add(client);client.onClose=()=>this.clients.delete(client);}
  broadcast(state){const now=Date.now(); if(now-this.last<100){this.pending=state; if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;const s=this.pending;this.pending=null;this.broadcastNow(s);},100-(now-this.last));return;}this.broadcastNow(state);}
  broadcastNow(state){this.last=Date.now();const data=JSON.stringify(state);for(const c of this.clients)c.send(data);}
}
