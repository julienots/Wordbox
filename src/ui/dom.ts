type Child = Node | string | number | null | undefined | false;
type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'style'>> & {
  cls?: string;
  style?: string;
  onclick?: (e: MouseEvent) => void;
  data?: Record<string, string>;
};

/** Tiny hyperscript helper: h('div', { cls: 'row' }, 'text', child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props<K> | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const { cls, style, data, ...rest } = props;
    if (cls) el.className = cls;
    if (style) el.setAttribute('style', style);
    if (data) for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
    Object.assign(el, rest);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function btn(label: string, onclick: () => void, cls = 'btn', title = ''): HTMLButtonElement {
  return h('button', { cls, onclick: (e) => { e.stopPropagation(); onclick(); }, title }, label);
}

export function bar(v: number, color?: string): HTMLDivElement {
  const i = h('i', { style: `width:${Math.max(0, Math.min(100, v)).toFixed(0)}%${color ? ';background:' + color : ''}` });
  return h('div', { cls: 'bar' }, i);
}

export function kv(pairs: [string, Child][]): HTMLDivElement {
  const d = h('div', { cls: 'kv' });
  for (const [k, v] of pairs) d.append(h('span', null, k), v instanceof Node ? v : h('span', null, v === null || v === undefined || v === false ? '—' : String(v)));
  return d;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}
