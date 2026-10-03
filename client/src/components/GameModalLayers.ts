export type GameModalLayer<T> = { id: symbol; content: T; requestClose?: () => void };

/** Presentation order belongs to visibility, not snapshot/render updates. */
export class GameModalLayers<T> {
  private layers: GameModalLayer<T>[] = [];
  private listeners = new Set<() => void>();
  getSnapshot = () => this.layers;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  show(id: symbol, content: T, requestClose?: () => void) {
    const next = { id, content, ...(requestClose ? { requestClose } : {}) };
    const index = this.layers.findIndex(layer => layer.id === id);
    if (index < 0) this.layers = [...this.layers, next];
    else this.layers = this.layers.map(layer => layer.id === id ? next : layer);
    this.notify();
  }
  hide(id: symbol) {
    if (!this.layers.some(layer => layer.id === id)) return;
    this.layers = this.layers.filter(layer => layer.id !== id);
    this.notify();
  }
  clear() {
    if (!this.layers.length) return;
    this.layers = [];
    this.notify();
  }
  requestCloseTop() {
    const top = this.layers.at(-1);
    if (!top) return false;
    top.requestClose?.();
    return true;
  }
  private notify() { for (const listener of this.listeners) listener(); }
}
