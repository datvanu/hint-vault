export class Purger {
  constructor(store,timeoutMs=12*60*60*1000){this.store=store;this.timeoutMs=timeoutMs;this.timer=setInterval(()=>{if(Date.now()-this.store.lastActivity>=this.timeoutMs)this.purge();},Math.min(timeoutMs,60_000));this.timer.unref?.();}
  purge(){this.store.reset();this.store.session.costUsd=0;this.store.lastActivity=Date.now();}
  close(){clearInterval(this.timer);this.purge();}
}
