import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { messageFor } from '../core/messages';
import { Store } from '../core/store';
import { Member } from '../core/types';
import { Dialogs } from '../ui/dialogs';
import { Toasts } from '../ui/toasts';

/** Tools for whoever runs the market. They reset things; they reveal nothing. */
@Component({
  selector: 'wm-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.state(); as s) {
      <details class="admin">
        <summary>Werkzeugkasten für {{ s.me.name }}</summary>
        <h4>Geheimzahl löschen</h4>
        <p>Die Person legt beim nächsten Besuch eine neue fest.</p>
        <div class="row">
          @for (m of s.members; track m.key) {
            <button type="button" class="btn small ghost" [disabled]="!m.hasPin" (click)="resetPin(m)">
              {{ m.name }}
            </button>
          }
        </div>
        <h4>Neu anfangen</h4>
        <p>Für den Wechsel vom Testen zum echten Wichteln. Geheimzahlen bleiben erhalten.</p>
        <div class="row">
          <button type="button" class="btn small ghost" (click)="resetDraw()">Auslosung zurücksetzen</button>
          <button type="button" class="btn small danger" (click)="wipe()">Alle Einträge löschen</button>
        </div>
      </details>
    }
  `,
  styles: `
    .admin {
      margin-top: 26px;
      max-width: 60ch;
      color: var(--ink);
      text-shadow: none;
      background: var(--paper);
      border: var(--line);
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 4px 4px 0 var(--ink);
    }
    summary {
      font-weight: 700;
      cursor: pointer;
    }
    h4 {
      margin: 16px 0 0;
      font: 600 1rem var(--body);
    }
    p {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 0.93rem;
    }
    .row {
      margin-top: 10px;
    }
  `,
})
export class Admin {
  protected readonly store = inject(Store);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);

  protected async resetPin(m: Member): Promise<void> {
    const yes = await this.dialogs.confirm({
      title: `Geheimzahl von ${m.name} löschen?`,
      text: `${m.name} wird überall abgemeldet und legt beim nächsten Besuch eine neue fest.`,
      ok: 'Löschen',
      danger: true,
    });
    if (!yes) return;
    const r = await this.store.adminResetPin(m.key);
    this.toasts.show(r.ok ? 'Geheimzahl gelöscht.' : messageFor(r));
  }

  protected async resetDraw(): Promise<void> {
    const yes = await this.dialogs.confirm({
      title: 'Auslosung zurücksetzen?',
      text: 'Alle Lose und alle Haken für erledigte Spenden verschwinden. Die Spendenwünsche bleiben.',
      ok: 'Zurücksetzen',
      danger: true,
    });
    if (!yes) return;
    const r = await this.store.adminResetDraw();
    this.toasts.show(r.ok ? 'Die Trommel ist wieder voll.' : messageFor(r));
  }

  protected async wipe(): Promise<void> {
    const yes = await this.dialogs.confirm({
      title: 'Wirklich alle Einträge löschen?',
      text: 'Spendenwünsche, Lose, Wunschzettel und Haken sind danach weg. Das lässt sich nicht zurückholen.',
      ok: 'Alles löschen',
      danger: true,
    });
    if (!yes) return;
    const r = await this.store.adminWipe();
    this.toasts.show(r.ok ? 'Alles gelöscht. Der Markt ist leer.' : messageFor(r));
  }
}
