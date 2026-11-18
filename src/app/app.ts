import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, signal } from '@angular/core';
import { Motion } from './core/motion';
import { Store } from './core/store';
import { nameList } from './core/util';
import { Admin } from './admin/admin';
import { Backdrop } from './fx/backdrop';
import { Gate } from './gate/gate';
import { Market } from './market/market';
import { DialogHost } from './ui/dialogs';
import { ToastHost } from './ui/toasts';

@Component({
  selector: 'wm-root',
  imports: [Backdrop, Gate, Market, Admin, DialogHost, ToastHost],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly store = inject(Store);
  protected readonly motion = inject(Motion);

  protected readonly ribbon = ['Spenden verlosen', 'Wünsche aufschreiben', 'Heimlich abhaken'];
  protected readonly ribbonRepeat = [0, 1, 2, 3, 4, 5, 6, 7];

  /** One bulb per 36px of screen width. */
  protected readonly bulbs = signal<number[]>([]);
  protected readonly dayBig = signal('24');
  protected readonly dayLabel = signal('Tage bis Heiligabend');

  protected readonly familyLine = computed(() => {
    const names = this.store.members().map((m) => m.name);
    return names.length ? `Gebaut für ${nameList(names)}.` : '';
  });

  constructor() {
    void this.store.init();
    afterNextRender(() => {
      const fit = () => this.bulbs.set(Array.from({ length: Math.ceil(innerWidth / 36) + 2 }, (_, i) => i));
      fit();
      let t: ReturnType<typeof setTimeout>;
      addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(fit, 200);
      });
      this.countdown();
    });
  }

  private countdown(): void {
    const now = new Date();
    const year = now.getFullYear();
    const today = new Date(year, now.getMonth(), now.getDate()).getTime();
    const days = Math.round((new Date(year, 11, 24).getTime() - today) / 86_400_000);
    if (days > 1) {
      this.dayLabel.set('Tage bis Heiligabend');
      this.countUp(days);
    } else if (days === 1) {
      this.dayBig.set('1');
      this.dayLabel.set('Tag bis Heiligabend');
    } else if (days === 0) {
      this.dayBig.set('24.');
      this.dayLabel.set('Heute ist Heiligabend');
    } else {
      this.dayBig.set('Ho!');
      this.dayLabel.set('Frohe Weihnachten');
    }
  }

  /** The number on the ornament counts up once. */
  private countUp(target: number): void {
    if (!this.motion.enabled()) {
      this.dayBig.set(String(target));
      return;
    }
    const start = performance.now() + 900;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 900));
      this.dayBig.set(String(Math.round(target * (1 - Math.pow(1 - k, 3)))));
      if (k < 1) requestAnimationFrame(step);
    };
    this.dayBig.set('0');
    requestAnimationFrame(step);
  }
}
