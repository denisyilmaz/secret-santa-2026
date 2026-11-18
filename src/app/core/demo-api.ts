import { Api, Donation, MarketState, Member, Res } from './types';
import { readLocal, wait, writeLocal } from './util';

/**
 * Stand-in backend for the demo: same rules as the SQL functions, but the data
 * lives in this browser only. Used when environment.supabaseUrl is empty.
 */
interface DemoWish {
  id: string;
  owner: string;
  text: string;
  link: string;
  removed: boolean;
}
interface DemoDb {
  pins: Record<string, string>;
  sessions: Record<string, string>;
  donations: Record<string, Donation>;
  pairs: Record<string, string> | null;
  done: Record<string, boolean>;
  wishes: DemoWish[];
  ticks: Record<string, string>;
}

const KEY = 'wichtelmarkt-demo-v2';
const PEOPLE = [
  { key: 'anna', name: 'Anna', color: 'pink', isAdmin: false },
  { key: 'ben', name: 'Ben', color: 'yellow', isAdmin: false },
  { key: 'clara', name: 'Clara', color: 'green', isAdmin: false },
  { key: 'dora', name: 'Dora', color: 'red', isAdmin: false },
  { key: 'emil', name: 'Emil', color: 'teal', isAdmin: true },
];

function sample(): DemoDb {
  return {
    pins: {},
    sessions: {},
    donations: {
      anna: { org: 'Berliner Tafel', link: 'https://www.berliner-tafel.de/', note: 'Beispiel: für die Ausgabe an Weihnachten.' },
      ben: { org: 'Tierheim Berlin', link: '', note: '' },
      clara: { org: 'Ärzte ohne Grenzen', link: 'https://www.aerzte-ohne-grenzen.de/', note: 'Beispiel: Nothilfe, wo sie gerade gebraucht wird.' },
      dora: { org: 'Deutsches Kinderhilfswerk', link: '', note: '' },
    },
    pairs: null,
    done: {},
    wishes: [
      { id: 'd1', owner: 'anna', text: 'Ein Wochenende an der Ostsee', link: '', removed: false },
      { id: 'd2', owner: 'anna', text: 'Neue Laufschuhe', link: '', removed: false },
      { id: 'd3', owner: 'ben', text: 'Kopfhörer', link: '', removed: false },
      { id: 'd4', owner: 'clara', text: 'Gutschein für die Kletterhalle', link: 'https://example.com/kletterhalle', removed: false },
      { id: 'd5', owner: 'clara', text: 'Espressotassen', link: '', removed: false },
      { id: 'd6', owner: 'clara', text: 'Ein dicker Roman für den Winter', link: '', removed: false },
      { id: 'd7', owner: 'dora', text: 'Neue Gartenschere', link: '', removed: false },
      { id: 'd8', owner: 'emil', text: 'Wollsocken, Größe 43', link: '', removed: false },
    ],
    ticks: { d6: 'dora', d8: 'clara' },
  };
}

const fail = (error: string, extra: object = {}): Res<never> => ({ ok: false, error, ...extra });
const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export class DemoApi implements Api {
  private db: DemoDb;

  constructor() {
    let stored: DemoDb | null = null;
    try {
      stored = JSON.parse(readLocal(KEY) || 'null');
    } catch {
      stored = null;
    }
    this.db = stored && stored.wishes ? stored : sample();
  }

  private save() {
    writeLocal(KEY, JSON.stringify(this.db));
  }
  private me(token: string): string | null {
    return this.db.sessions[token] ?? null;
  }
  private members(): Member[] {
    return PEOPLE.map((p) => ({
      ...p,
      hasPin: !!this.db.pins[p.key],
      hasDonation: !!this.db.donations[p.key],
      donated: !!this.db.done[p.key],
    }));
  }

  async roster(): Promise<Res<{ members: Member[] }>> {
    await wait(120);
    return { ok: true, members: this.members() };
  }

  async login(member: string, pin: string): Promise<Res<{ token: string; member: string }>> {
    await wait(250);
    if (!PEOPLE.some((p) => p.key === member)) return fail('member_unknown');
    if (!/^\d{4}$/.test(pin)) return fail('pin_format');
    const known = this.db.pins[member];
    if (!known) this.db.pins[member] = pin;
    else if (known !== pin) return fail('pin_wrong', { attemptsLeft: 4 });
    const token = 'demo-' + rid();
    this.db.sessions[token] = member;
    this.save();
    return { ok: true, token, member };
  }

  async logout(token: string): Promise<Res> {
    delete this.db.sessions[token];
    this.save();
    return { ok: true };
  }

  async state(token: string): Promise<Res<MarketState>> {
    await wait(80);
    const me = this.me(token);
    const person = PEOPLE.find((p) => p.key === me);
    if (!me || !person) return fail('session');
    const d = this.db;
    const receiver = d.pairs ? d.pairs[me] : null;
    const target = receiver ? d.donations[receiver] : null;
    return {
      ok: true,
      me: { ...person },
      members: this.members(),
      myDonation: d.donations[me] ? { ...d.donations[me] } : null,
      drawn: !!d.pairs,
      myLot: receiver
        ? { receiver, org: target?.org ?? '', link: target?.link ?? '', note: target?.note ?? '', done: !!d.done[me] }
        : null,
      // Same rule as wm_state: nothing about ticks on my own wishes.
      wishes: d.wishes
        .filter((w) => (w.owner === me ? !w.removed : !w.removed || !!d.ticks[w.id]))
        .map((w) => ({ ...w, tickBy: w.owner === me ? null : (d.ticks[w.id] ?? null) })),
    };
  }

  async saveDonation(token: string, donation: Donation): Promise<Res> {
    await wait(200);
    const me = this.me(token);
    if (!me) return fail('session');
    if (this.db.pairs) return fail('already_drawn');
    if (!donation.org.trim()) return fail('org_invalid');
    this.db.donations[me] = { org: donation.org.trim(), link: donation.link, note: donation.note.trim() };
    this.save();
    return { ok: true };
  }

  async draw(token: string): Promise<Res> {
    await wait(200);
    if (!this.me(token)) return fail('session');
    if (this.db.pairs) return fail('already_drawn');
    const keys = PEOPLE.map((p) => p.key);
    if (keys.some((k) => !this.db.donations[k])) return fail('donations_missing');
    let perm: string[];
    do {
      perm = [...keys];
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
    } while (perm.some((k, i) => k === keys[i]));
    this.db.pairs = Object.fromEntries(keys.map((k, i) => [k, perm[i]]));
    this.db.done = {};
    this.save();
    return { ok: true };
  }

  async setDone(token: string, done: boolean): Promise<Res> {
    await wait(120);
    const me = this.me(token);
    if (!me) return fail('session');
    if (!this.db.pairs) return fail('not_drawn');
    this.db.done[me] = done;
    this.save();
    return { ok: true };
  }

  async addWish(token: string, text: string, link: string): Promise<Res> {
    await wait(150);
    const me = this.me(token);
    if (!me) return fail('session');
    if (!text.trim()) return fail('text_invalid');
    if (this.db.wishes.filter((w) => w.owner === me && !w.removed).length >= 40) return fail('too_many');
    this.db.wishes.push({ id: rid(), owner: me, text: text.trim().slice(0, 140), link, removed: false });
    this.save();
    return { ok: true };
  }

  async removeWish(token: string, id: string): Promise<Res> {
    await wait(120);
    const me = this.me(token);
    if (!me) return fail('session');
    const w = this.db.wishes.find((x) => x.id === id && x.owner === me);
    if (w) w.removed = true;
    this.save();
    return { ok: true };
  }

  async tick(token: string, id: string, on: boolean): Promise<Res> {
    await wait(120);
    const me = this.me(token);
    if (!me) return fail('session');
    const w = this.db.wishes.find((x) => x.id === id);
    if (!w) return fail('wish_unknown');
    if (w.owner === me) return fail('own_wish');
    const by = this.db.ticks[id];
    if (on) {
      if (w.removed) return fail('wish_removed');
      if (by && by !== me) return fail('taken', { by });
      this.db.ticks[id] = me;
    } else if (by === me) {
      delete this.db.ticks[id];
    }
    this.save();
    return { ok: true };
  }

  private admin(token: string): Res | null {
    const me = this.me(token);
    if (!me) return fail('session');
    return PEOPLE.find((p) => p.key === me)?.isAdmin ? null : fail('not_admin');
  }

  async adminResetPin(token: string, member: string): Promise<Res> {
    const no = this.admin(token);
    if (no) return no;
    delete this.db.pins[member];
    for (const [t, m] of Object.entries(this.db.sessions)) if (m === member) delete this.db.sessions[t];
    this.save();
    return { ok: true };
  }

  async adminResetDraw(token: string): Promise<Res> {
    const no = this.admin(token);
    if (no) return no;
    this.db.pairs = null;
    this.db.done = {};
    this.save();
    return { ok: true };
  }

  async adminWipe(token: string): Promise<Res> {
    const no = this.admin(token);
    if (no) return no;
    this.db.donations = {};
    this.db.pairs = null;
    this.db.done = {};
    this.db.wishes = [];
    this.db.ticks = {};
    this.save();
    return { ok: true };
  }
}
