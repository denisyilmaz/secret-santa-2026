import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { messageFor } from '../core/messages';
import { Store } from '../core/store';
import { Member } from '../core/types';
import { inputValue } from '../core/util';
import { Dialogs } from '../ui/dialogs';

/** Everything before you are signed in: family code, then your name and PIN. */
@Component({
  selector: 'wm-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gate.html',
  styleUrl: './gate.css',
})
export class Gate {
  protected readonly store = inject(Store);
  private readonly dialogs = inject(Dialogs);

  protected readonly code = signal('');
  protected readonly codeError = signal('');
  protected readonly busy = signal(false);
  protected readonly val = inputValue;

  protected async submitCode(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    if (!this.code().trim()) {
      this.codeError.set('Gib den Familiencode ein. Er steht in der Einladung.');
      return;
    }
    this.busy.set(true);
    const r = await this.store.submitFamilyCode(this.code());
    this.busy.set(false);
    this.codeError.set(r.ok ? '' : messageFor(r));
  }

  protected async retry(): Promise<void> {
    this.busy.set(true);
    await this.store.loadRoster();
    this.busy.set(false);
  }

  protected downText(): string {
    return messageFor({ ok: false, error: this.store.downReason() });
  }

  protected pick(m: Member): void {
    const first = !m.hasPin;
    void this.dialogs.open({
      kind: 'pin',
      mode: first ? 'set' : 'enter',
      title: `Hallo ${m.name}!`,
      text: first
        ? 'Leg eine Geheimzahl fest. Damit kommst nur du an deine Bude und an dein Los.'
        : `Gib deine Geheimzahl ein. Vergessen? ${this.store.adminName()} kann sie zurücksetzen.`,
      ok: first ? 'Festlegen' : 'Aufschließen',
      submit: async (pin) => {
        const r = await this.store.login(m.key, pin);
        return r.ok ? null : messageFor(r);
      },
    });
  }
}
