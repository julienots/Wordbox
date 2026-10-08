type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub used to decouple simulation from UI/audio/render. */
export class EventBus<M extends Record<string, unknown>> {
  private handlers: { [K in keyof M]?: Handler<M[K]>[] } = {};
  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    (this.handlers[type] ??= []).push(fn);
    return () => {
      const list = this.handlers[type];
      if (list) list.splice(list.indexOf(fn), 1);
    };
  }
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (const fn of list) fn(payload);
  }
  clear(): void {
    this.handlers = {};
  }
}
