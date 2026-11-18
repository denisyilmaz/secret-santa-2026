import { ChangeDetectionStrategy, Component, Injectable, inject, signal } from '@angular/core';

interface Toast {
  id: number;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly list = signal<Toast[]>([]);
  private next = 1;

  show(text: string): void {
    const id = this.next++;
    this.list.update((l) => [...l.slice(-1), { id, text }]);
    setTimeout(() => this.list.update((l) => l.filter((t) => t.id !== id)), 4200);
  }
}

@Component({
  selector: 'wm-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack" role="status" aria-live="polite">
      @for (t of toasts.list(); track t.id) {
        <p class="toast">{{ t.text }}</p>
      }
    </div>
  `,
  styles: `
    .stack {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 20px;
      z-index: 40;
      display: grid;
      justify-items: center;
      gap: 8px;
      padding: 0 16px;
      pointer-events: none;
    }
    .toast {
      margin: 0;
      max-width: 100%;
      background: var(--ink);
      color: var(--paper);
      border: 3px solid var(--yellow);
      border-radius: 14px;
      padding: 11px 16px;
      font-weight: 600;
      text-align: center;
      animation: toast-in 0.42s cubic-bezier(0.2, 1.6, 0.4, 1);
    }
    @keyframes toast-in {
      from {
        transform: translateY(40px) scale(0.8) rotate(3deg);
        opacity: 0;
      }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
}
