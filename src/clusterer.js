export const cosine = (a,b) => { let s=0; for(let i=0;i<Math.min(a.length,b.length);i++) s+=a[i]*b[i]; return s; };
export class Clusterer {
  constructor(threshold=.36) { this.threshold=threshold; }
  add(groups, hint, embedding) {
    let best=null, score=this.threshold; for(const g of groups){const x=cosine(g.centroid,embedding); if(x>=score){score=x;best=g;}}
    if(!best){best={id:`g${groups.length+1}`, centroid:new Float32Array(embedding), memberHintIds:[], distinctUsers:new Set(), level:3, repText:hint.text}; groups.push(best);}
    const n=best.memberHintIds.length; for(let i=0;i<embedding.length;i++) best.centroid[i]=(best.centroid[i]*n+embedding[i])/(n+1);
    best.memberHintIds.push(hint.id); best.distinctUsers.add(hint.userId); best.level=Math.min(best.level,hint.level ?? 0); if(n===0) best.repText=hint.text; return best;
  }
}
