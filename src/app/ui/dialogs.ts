import { ChangeDetectionStrategy, Component, ElementRef, Injectable, effect, inject, signal, viewChild } from '@angular/core';
import { inputValue } from '../core/util';

export interface DialogOptions {
  kind: 'confirm' | 'pin' | 'text';
  title: string;
  text?: string;
  ok: string;
  danger?: boolean;
  /** pin: "set" shows the digits, "enter" hides them and submits on the fourth. */
  mode?: 'set' | 'enter';
  /** text: label of the input. */
  label?: string;
  /** pin and text: return a sentence to keep the dialog open, or null to accept. */
  submit?: (value: string) => Promise<string | null>;
}

interface OpenDialog extends DialogOptions {
  resolve: (accepted: boolean) => void;
}

/** In-page dialogs. The browser's own alert/confirm/prompt are not used. */
@Injectable({ providedIn: 'root' })
export class Dialogs {
  readonly current = signal<OpenDialog | null>(null);

  open(options: DialogOptions): Promise<boolean> {
    this.current()?.resolve(false);
    return new Promise((resolve) => this.current.set({ ...options, resolve }));
  }

  confirm(o: { title: string; text?: string; ok: string; danger?: boolean }): Promise<boolean> {
    return this.open({ kind: 'confirm', ...o });
  }

  close(accepted: boolean): void {
    const d = this.current();
    this.current.set(null);
    d?.resolve(accepted);
  }
}

@Component({
  selector: 'wm-dialog-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dlg" aria-labelledby="dlgTitle" (cancel)="onCancel($event)" (close)="onClosed()">
      @if (dialogs.current(); as o) {
        <form novalidate [class.shake]="shaking()" (submit)="submit($event)">
          <h3 id="dlgTitle">{{ o.title }}</h3>
          @if (o.text) {
            <p>{{ o.text }}</p>
          }
          @if (o.kind === 'pin') {
            <label class="lbl" for="dlgPin">Geheimzahl, 4 Ziffern</label>
            <div class="pin">
              <input
                #field
                id="dlgPin"
                class="pin-input"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="4"
                autocomplete="off"
                [value]="value()"
                (input)="onPin($event)"
              />
              <div class="pin-cells" aria-hidden="true">
                @for (i of cells; track i) {
                  <span class="pin-cell" [class.filled]="value().length > i" [class.next]="value().length === i">{{
                    cell(i, o.mode === 'set')
                  }}</span>
                }
              </div>
            </div>
          }
          @if (o.kind === 'text') {
            <label class="lbl" for="dlgText">{{ o.label }}</label>
            <input
              #field
              id="dlgText"
              class="txt"
              autocomplete="off"
              autocapitalize="off"
              [value]="value()"
              (input)="value.set(val($event))"
            />
          }
          @if (error()) {
            <p class="form-err" role="alert">{{ error() }}</p>
          }
          <div class="row">
            <button #okBtn class="btn" type="submit" [class.danger]="o.danger" [disabled]="busy()">{{ o.ok }}</button>
            <button class="btn ghost" type="button" (click)="dialogs.close(false)">Abbrechen</button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    .dlg {
      border: var(--line);
      border-radius: 20px;
      background: var(--paper);
      color: var(--ink);
      padding: 22px;
      width: min(92vw, 390px);
      box-shadow: 8px 8px 0 var(--ink);
      font: 500 1rem/1.45 var(--body);
    }
    .dlg[open] {
      animation: dlg-in 0.38s cubic-bezier(0.2, 1.5, 0.4, 1);
    }
    .dlg::backdrop {
      background: rgba(20, 12, 6, 0.74);
    }
    h3 {
      margin: 0 0 10px;
      font: 400 1.4rem/1.1 var(--display);
    }
    p {
      margin: 0;
    }
    .shake {
      animation: shake 0.42s;
    }
    .pin {
      position: relative;
    }
    .pin-input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      font-size: 1.2rem;
      cursor: text;
    }
    .pin-cells {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .pin-cell {
      height: 62px;
      display: grid;
      place-content: center;
      background: #fff;
      border: var(--line);
      border-radius: 14px;
      font: 400 1.9rem/1 var(--display);
    }
    .pin-cell.filled {
      background: var(--yellow);
      animation: pop-in 0.26s cubic-bezier(0.2, 1.7, 0.4, 1);
    }
    .pin:focus-within .pin-cell.next {
      outline: 3px solid var(--blue);
      outline-offset: 2px;
      animation: blink 1s steps(2, jump-none) infinite;
    }
    @keyframes dlg-in {
      from {
        transform: scale(0.7) rotate(-4deg);
        opacity: 0;
      }
    }
    @keyframes blink {
      50% {
        outline-color: transparent;
      }
    }
  `,
})
export class DialogHost {
  protected readonly dialogs = inject(Dialogs);
  protected readonly value = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly shaking = signal(false);
  protected readonly cells = [0, 1, 2, 3];
  protected readonly val = inputValue;

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly okBtn = viewChild<ElementRef<HTMLButtonElement>>('okBtn');

  constructor() {
    effect(() => {
      const open = this.dialogs.current();
      const el = this.dlg().nativeElement;
      if (open) {
        this.value.set('');
        this.error.set('');
        this.busy.set(false);
        if (!el.open) el.showModal();
        setTimeout(() => (this.field() ?? this.okBtn())?.nativeElement.focus(), 30);
      } else if (el.open) {
        el.close();
      }
    });
  }

  protected cell(i: number, show: boolean): string {
    const v = this.value();
    return i < v.length ? (show ? v[i] : '●') : '';
  }

  protected onPin(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = digits;
    this.value.set(digits);
    this.error.set('');
    if (digits.length === 4 && this.dialogs.current()?.mode === 'enter') void this.run();
  }

  protected submit(event: Event): void {
    event.preventDefault();
    void this.run();
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.dialogs.close(false);
  }

  protected onClosed(): void {
    if (this.dialogs.current()) this.dialogs.close(false);
  }

  private async run(): Promise<void> {
    const o = this.dialogs.current();
    if (!o || this.busy()) return;
    if (o.kind === 'confirm') {
      this.dialogs.close(true);
      return;
    }
    const v = this.value().trim();
    let problem: string | null = null;
    if (o.kind === 'pin' && !/^\d{4}$/.test(v)) problem = 'Bitte genau 4 Ziffern eingeben.';
    else if (o.kind === 'text' && !v) problem = 'Das Feld ist noch leer.';
    else if (o.submit) {
      this.busy.set(true);
      problem = await o.submit(v);
      this.busy.set(false);
    }
    if (this.dialogs.current() !== o) return;
    if (problem) {
      this.error.set(problem);
      if (o.kind === 'pin') this.value.set('');
      this.shaking.set(true);
      setTimeout(() => this.shaking.set(false), 450);
      this.field()?.nativeElement.focus();
      return;
    }
    this.dialogs.close(true);
  }
}
