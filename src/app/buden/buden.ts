import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { messageFor } from '../core/messages';
import { Store } from '../core/store';
import { Member, Wish } from '../core/types';
import { cleanUrl, hostOf, inputValue } from '../core/util';
import { Confetti } from '../fx/confetti';
import { Dialogs } from '../ui/dialogs';
import { Toasts } from '../ui/toasts';

interface WishRow extends Wish {
  mine: boolean;
  locked: boolean;
  status: string;
}
interface Booth {
  member: Member;
  own: boolean;
  meta: string;
  wishes: WishRow[];
}

/** One striped booth per person. Yours comes first and holds the form. */
@Component({
  selector: 'wm-buden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './buden.html',
  styleUrl: './buden.css',
})
export class Buden {
  protected readonly store = inject(Store);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly confetti = inject(Confetti);

  protected readonly val = inputValue;
  protected readonly host = hostOf;

  protected readonly text = signal('');
  protected readonly link = signal('');
  protected readonly formError = signal('');
  protected readonly adding = signal(false);

  protected readonly booths = computed<Booth[]>(() => {
    const s = this.store.state();
    if (!s) return [];
    const me = s.me.key;
    const ordered = [...s.members.filter((m) => m.key === me), ...s.members.filter((m) => m.key !== me)];
    return ordered.map((member) => {
      const own = member.key === me;
      const wishes = s.wishes.filter((w) => w.owner === member.key);
      const live = wishes.filter((w) => !w.removed);
      const ticked = live.filter((w) => w.tickBy).length;
      const meta = own
        ? live.length
          ? 'Was die anderen abhaken, bleibt für dich unsichtbar.'
          : 'Noch leer. Schreib deinen ersten Wunsch auf.'
        : live.length
          ? `${ticked} von ${live.length} abgehakt`
          : `${member.name} hat noch nichts aufgeschrieben.`;
      return {
        member,
        own,
        meta,
        wishes: wishes.map((w) => {
          const mine = w.tickBy === me;
          const status = w.removed
            ? `${member.name} hat den Wunsch zurückgezogen.`
            : mine
              ? 'Du besorgst das.'
              : w.tickBy
                ? `${this.store.nameOf(w.tickBy)} besorgt das.`
                : '';
          return { ...w, mine, locked: !!w.tickBy && !mine, status };
        }),
      };
    });
  });

  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    if (this.adding()) return;
    const text = this.text().trim();
    const link = cleanUrl(this.link());
    if (!text) return this.formError.set('Schreib zuerst auf, was du dir wünschst.');
    if (link === null) return this.formError.set('Der Link sieht nicht richtig aus. Lass ihn weg oder prüfe ihn.');
    this.formError.set('');
    this.adding.set(true);
    const r = await this.store.addWish(text, link);
    this.adding.set(false);
    if (!r.ok) return this.formError.set(messageFor(r));
    this.text.set('');
    this.link.set('');
  }

  protected async remove(w: Wish): Promise<void> {
    const yes = await this.dialogs.confirm({
      title: 'Wunsch entfernen?',
      text: `„${w.text}“ verschwindet von deinem Zettel.`,
      ok: 'Entfernen',
      danger: true,
    });
    if (!yes) return;
    const r = await this.store.removeWish(w.id);
    if (!r.ok) this.toasts.show(messageFor(r));
  }

  protected async toggle(w: WishRow, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const on = box.checked;
    const r = await this.store.tick(w.id, on);
    if (r.ok) {
      if (on) this.confetti.burstFrom(box);
      return;
    }
    // The server said no: show what is true now.
    const now = this.store.state()?.wishes.find((x) => x.id === w.id);
    box.checked = !!now?.tickBy;
    this.toasts.show(messageFor(r, this.store.nameOf));
  }
}
