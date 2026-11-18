import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '../core/store';
import { Buden } from '../buden/buden';
import { Spenden } from '../spenden/spenden';

/** The signed-in view: who you are, then the two parts of the market. */
@Component({
  selector: 'wm-market',
  imports: [Spenden, Buden],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.state(); as s) {
      <div class="mebar">
        <span class="me-chip" [attr.data-c]="s.me.color">{{ s.me.name }}</span>
        <p class="me-stat">{{ stat() }}</p>
        <button type="button" class="btn small ghost" (click)="store.logout()">Abmelden</button>
      </div>
      <wm-spenden />
      <wm-buden />
    }
  `,
  styles: `
    .mebar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 14px;
      background: var(--paper);
      border: var(--line);
      border-radius: 22px;
      padding: 10px 12px;
      box-shadow: var(--shadow);
      animation: rise-in 0.5s var(--spring) both;
    }
    .me-chip {
      font: 400 1.25rem/1 var(--display);
      background: var(--c);
      border: var(--line);
      border-radius: 999px;
      padding: 0.32em 0.7em 0.36em;
      animation: wave 0.9s ease-in-out 0.5s 2;
      transform-origin: 20% 80%;
    }
    .me-stat {
      flex: 1 1 12ch;
      margin: 0;
      font-weight: 600;
    }
    @keyframes wave {
      0%,
      100% {
        transform: none;
      }
      30% {
        transform: rotate(-9deg);
      }
      70% {
        transform: rotate(7deg);
      }
    }
  `,
})
export class Market {
  protected readonly store = inject(Store);

  protected readonly stat = computed(() => {
    const s = this.store.state();
    if (!s) return '';
    const n = s.wishes.filter((w) => w.tickBy === s.me.key).length;
    return n === 0 ? 'Du hast noch nichts abgehakt.' : n === 1 ? 'Du hast 1 Wunsch abgehakt.' : `Du hast ${n} Wünsche abgehakt.`;
  });
}
