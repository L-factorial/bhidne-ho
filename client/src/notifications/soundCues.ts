export const soundCues = {
  turn: {notes:[660,880], duration:0.14, volume:0.30, priority:8},
  invitation: {notes:[784,988,1175], duration:0.12, volume:0.25, priority:6},
  chat: {notes:[560], duration:0.07, volume:0.18, priority:3},
  joined: {notes:[440,554], duration:0.08, volume:0.16, priority:2},
  left: {notes:[554,440], duration:0.08, volume:0.14, priority:2},
  started: {notes:[440,554,660], duration:0.10, volume:0.24, priority:5},
  round: {notes:[660,554], duration:0.16, volume:0.23, priority:10},
  won: {notes:[523,659,784,1047], duration:0.13, volume:0.28, priority:9},
  tunnelaDeclaration: {notes:[587,740,880], duration:0.11, volume:0.24, priority:9},
  maalDeclaration: {notes:[698,1047], duration:0.16, volume:0.24, priority:9},
  move: {notes:[320], duration:0.035, volume:0.10, priority:1},
} as const;
export type SoundCue = keyof typeof soundCues;

// Shared by every sound source: nearby events produce one highest-priority cue.
export class SoundQueue {
  private pending: {kind:SoundCue;play:()=>void} | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seen = new Map<string,number>();
  private until=0;
  private priority=0;
  request(kind:SoundCue,key:string,play:()=>void) {
    const now=Date.now();
    if(this.seen.has(key))return;
    this.seen.set(key,now);
    for(const [id,time] of this.seen)if(now-time>60000)this.seen.delete(id);
    if(now<this.until&&soundCues[kind].priority<=this.priority)return;
    if(!this.pending||soundCues[kind].priority>soundCues[this.pending.kind].priority)this.pending={kind,play};
    if(this.timer)return;
    this.timer=setTimeout(()=>{
      this.timer=null;const next=this.pending;this.pending=null;
      if(next){const cue=soundCues[next.kind];this.priority=cue.priority;this.until=Date.now()+cue.notes.length*cue.duration*1000+120;next.play();}
    },60);
  }
  cancel(){if(this.timer)clearTimeout(this.timer);this.timer=null;this.pending=null;this.until=0;}
}
export const foregroundSounds = new SoundQueue();
