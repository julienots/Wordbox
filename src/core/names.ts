import { RNG } from './rng';

const ONSETS = [
  ['k', 'r', 't', 'v', 'z', 'dr', 'gr', 'th', 'kh', 'br', 'g', 'd'],
  ['l', 'm', 'n', 's', 'el', 'f', 'ph', 'sy', 'v', 'lu', 'h', 'ae'],
  ['b', 'd', 'g', 'br', 'dur', 'gr', 'k', 'th', 'm', 'st', 'dw', 'h'],
  ['s', 'ss', 'x', 'q', 'sz', 'k', 'ch', 'y', 'tz', 'h', 'zh', 'r'],
  ['a', 'o', 'i', 'y', 'e', 'u', 'au', 'io', 'ea', 'ae', 'ou', 'ia'],
  ['p', 'c', 'n', 'm', 'qu', 'v', 'tr', 'pl', 'cr', 'sc', 'l', 'fr'],
];
const NUCLEI = [
  ['a', 'o', 'u', 'ar', 'or', 'ul', 'ai'],
  ['ae', 'i', 'e', 'ia', 'ie', 'y', 'ea'],
  ['u', 'o', 'a', 'oi', 'ur', 'ol', 'ag'],
  ['a', 'i', 'e', 'ii', 'ae', 'u', 'ss'],
  ['a', 'e', 'i', 'o', 'u', 'y', 'au'],
  ['a', 'e', 'i', 'o', 'u', 'ae', 'io'],
];
const CODAS = [
  ['n', 'r', 'k', 'th', 'x', '', 'z', 'g'],
  ['l', 'n', 's', 'th', '', '', 'r', 'ys'],
  ['k', 'm', 'n', 'rd', 'r', '', 'g', 'n'],
  ['s', 'k', 'x', 'th', '', 'sh', 'z', ''],
  ['', 'n', 'l', 'r', 's', '', '', 'm'],
  ['s', 'n', 'r', 'l', '', 'm', 'x', 't'],
];

/**
 * A procedural "language": each culture owns one, giving every civilisation
 * its own recognisable naming style without any hand-written name list.
 */
export class Language {
  readonly onsets: string[];
  readonly nuclei: string[];
  readonly codas: string[];
  readonly placeSuffix: string;
  readonly familyPrefix: string;
  constructor(readonly seed: number) {
    const r = new RNG(seed);
    const base = r.int(0, ONSETS.length - 1);
    const mix = (a: string[][], n: number) => {
      const out = r.shuffle([...a[base]]).slice(0, n);
      out.push(...r.shuffle([...a[(base + r.int(1, a.length - 1)) % a.length]]).slice(0, 2));
      return out;
    };
    this.onsets = mix(ONSETS, 7);
    this.nuclei = mix(NUCLEI, 5);
    this.codas = mix(CODAS, 5);
    this.placeSuffix = r.pick(['ia', 'or', 'heim', 'grad', 'ara', 'ond', 'el', 'is', 'an', 'oth', 'mar', 'esh']);
    this.familyPrefix = r.pick(['', '', 'Van ', 'Ab ', "d'", 'Ul-', 'Mac ', 'Ter ']);
  }
  word(r: RNG, minSyl = 1, maxSyl = 3): string {
    const n = r.int(minSyl, maxSyl);
    let s = '';
    for (let i = 0; i < n; i++) {
      s += r.pick(this.onsets) + r.pick(this.nuclei);
      if (i === n - 1 || r.chance(0.3)) s += r.pick(this.codas);
    }
    return cap(s.slice(0, 12));
  }
  personName(r: RNG, female: boolean): string {
    const w = this.word(r, 1, 3);
    return female ? cap(w.replace(/[^aeiouy]$/, (m) => m + r.pick(['a', 'ia', 'e', 'is']))) : w;
  }
  familyName(r: RNG): string {
    return this.familyPrefix + this.word(r, 2, 3);
  }
  placeName(r: RNG): string {
    const w = this.word(r, 1, 2);
    return r.chance(0.5) ? cap(w + this.placeSuffix) : w;
  }
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function roman(n: number): string {
  const m: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of m) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}
