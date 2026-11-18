import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { messageFor } from '../core/messages';
import { Motion } from '../core/motion';
import { Store } from '../core/store';
import { MarketState } from '../core/types';
import { cleanUrl, hostOf, inputValue, nameList, wait } from '../core/util';
import { Confetti } from '../fx/confetti';
import { Dialogs } from '../ui/dialogs';
import { Toasts } from '../ui/toasts';

const EMPTY: MarketState = {
  me: { key: '', name: '', color: '', isAdmin: false },
  members: [],
  myDonation: null,
  drawn: false,
  myLot: null,
  wishes: [],
};

/** Donation wish, the lottery drum with the draw, and the light chain. */
@Component({
  selector: 'wm-spenden',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spenden.html',
  styleUrl: './spenden.css',
})
export class Spenden {
  protected readonly store = inject(Store);
  private readonly dialogs = inject(Dialogs);
  private readonly toasts = inject(Toasts);
  private readonly confetti = inject(Confetti);
  private readonly motion = inject(Motion);

  protected readonly val = inputValue;
  protected readonly host = hostOf;

  // donation form
  protected readonly org = signal('');
  protected readonly link = signal('');
  protected readonly note = signal('');
  protected readonly editing = signal(false);
  protected readonly formError = signal('');
  protected readonly saving = signal(false);

  // drum and lot
  protected readonly spinning = signal(false);
  protected readonly lot = signal<'shut' | 'turning' | 'open'>('shut');
  private readonly drum = viewChild<ElementRef<HTMLElement>>('drum');
  private readonly ticket = viewChild<ElementRef<HTMLElement>>('ticket');

  protected readonly s = computed(() => this.store.state() ?? EMPTY);
  protected readonly members = computed(() => this.s().members);
  protected readonly inPot = computed(() => this.members().filter((m) => m.hasDonation));
  protected readonly missing = computed(() => this.members().filter((m) => !m.hasDonation));
  protected readonly missingText = computed(() => {
    const miss = this.missing();
    const total = this.members().length;
    return `${total - miss.length} von ${total} Wünschen liegen im Topf. Es ${miss.length === 1 ? 'fehlt' : 'fehlen'} noch ${nameList(miss.map((m) => m.name))}.`;
  });
  protected readonly showForm = computed(() => !this.s().drawn && (!this.s().myDonation || this.editing()));
  protected readonly receiver = computed(() => {
    const key = this.s().myLot?.receiver;
    return this.members().find((m) => m.key === key) ?? null;
  });
  protected readonly lit = computed(() => this.members().filter((m) => m.donated).length);
  protected readonly chainText = computed(() => {
    const n = this.lit();
    const total = this.members().length;
    const tail = n === 0 ? 'Noch ist es dunkel.' : n === total ? 'Alle leuchten!' : `${n} von ${total} leuchten.`;
    return 'Für jede erledigte Spende geht ein Licht an. ' + tail;
  });

  private litBefore = -1;

  constructor() {
    // Confetti rain the moment the last light comes on, not on every visit.
    effect(() => {
      const n = this.lit();
      const total = this.members().length;
      if (total && this.litBefore >= 0 && n === total && this.litBefore < total) this.confetti.rain();
      this.litBefore = n;
    });
    // If the draw is reset, cover the lot again.
    effect(() => {
      if (!this.s().drawn) this.lot.set('shut');
    });
  }

  protected startEdit(): void {
    const d = this.s().myDonation;
    this.org.set(d?.org ?? '');
    this.link.set(d?.link ?? '');
    this.note.set(d?.note ?? '');
    this.formError.set('');
    this.editing.set(true);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    const org = this.org().trim();
    const link = cleanUrl(this.link());
    if (!org) return this.formError.set('Trag eine Organisation oder ein Projekt ein.');
    if (link === null) return this.formError.set('Der Link sieht nicht richtig aus. Lass ihn weg oder prüfe ihn.');
    this.formError.set('');
    this.saving.set(true);
    const r = await this.store.saveDonation({ org, link, note: this.note().trim() });
    this.saving.set(false);
    if (!r.ok) return this.formError.set(messageFor(r));
    this.editing.set(false);
    this.toasts.show('Dein Spendenwunsch liegt im Topf.');
  }

  protected async draw(): Promise<void> {
    if (this.spinning()) return;
    const yes = await this.dialogs.confirm({
      title: 'Jetzt für alle losen?',
      text: 'Die Trommel verteilt alle Lose auf einmal. Danach stehen die Spendenwünsche fest.',
      ok: 'Lose ziehen',
    });
    if (!yes) return;
    this.spinning.set(true);
    // Let the drum turn for a moment even when the server answers at once.
    const [r] = await Promise.all([this.store.draw(), wait(this.motion.enabled() ? 2600 : 0)]);
    const drum = this.drum()?.nativeElement;
    if (r.ok && drum) this.confetti.burstFrom(drum, 70);
    this.spinning.set(false);
    this.toasts.show(r.ok ? 'Gelost! Dein Los liegt bereit.' : messageFor(r));
  }

  protected reveal(): void {
    if (this.lot() !== 'shut') return;
    this.lot.set('turning');
    setTimeout(
      () => {
        this.lot.set('open');
        setTimeout(() => {
          const el = this.ticket()?.nativeElement;
          if (el) this.confetti.burstFrom(el, 50);
        }, 60);
      },
      this.motion.enabled() ? 230 : 0,
    );
  }

  protected async setDone(event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const r = await this.store.setDone(box.checked);
    if (!r.ok) {
      box.checked = !!this.s().myLot?.done;
      this.toasts.show(messageFor(r));
    } else if (box.checked) {
      this.confetti.burstFrom(box);
    }
  }
}
