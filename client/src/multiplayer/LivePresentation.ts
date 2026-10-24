/** Presentation only: never changes delivery cursors, commands or history. */
export class LivePresentation {
  private state = {epoch:0, active:true, ready:true, since:Date.now()};
  private listeners = new Set<()=>void>();
  subscribe = (listener:()=>void) => {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
  snapshot = () => this.state;
  private update(active:boolean, ready:boolean) {
    this.state = {epoch:this.state.epoch+1,active,ready,since:Date.now()};
    this.listeners.forEach(listener=>listener());
  }
  activity(active:boolean) {
    if(active!==this.state.active)this.update(active,false);
  }
  reset() {this.update(this.state.active,false);}
  confirm(epoch:number) {
    if(this.state.active&&!this.state.ready&&epoch===this.state.epoch)this.update(true,true);
  }
  fresh(sentAt:number) {
    return this.state.active&&this.state.ready&&Number.isFinite(sentAt)&&sentAt>=this.state.since;
  }
}
