import { Injectable, signal } from '@angular/core';
import { readLocal, writeLocal } from './util';

const KEY = 'wichtelmarkt-motion';

/**
 * One switch for all movement. Starts from the system setting ("reduce motion")
 * and can be flipped by hand in the footer. CSS reads html[data-motion].
 */
@Injectable({ providedIn: 'root' })
export class Motion {
  readonly enabled = signal(true);

  constructor() {
    const saved = readLocal(KEY);
    const systemReduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.apply(saved ? saved === 'on' : !systemReduce);
  }

  toggle(): void {
    const next = !this.enabled();
    writeLocal(KEY, next ? 'on' : 'off');
    this.apply(next);
  }

  private apply(on: boolean): void {
    this.enabled.set(on);
    document.documentElement.dataset['motion'] = on ? 'on' : 'off';
  }
}
