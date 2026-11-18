import { Injectable, computed, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { Api, Donation, Fail, MarketState, Member, Res } from './types';
import { readLocal, writeLocal } from './util';

const TOKEN_KEY = 'wichtelmarkt-token';
const CODE_KEY = 'wichtelmarkt-familiencode';

/**
 * boot   starting up
 * code   the family code is missing or wrong
 * gate   pick your name
 * market signed in
 * down   backend not reachable or not set up
 */
export type Phase = 'boot' | 'code' | 'gate' | 'market' | 'down';

@Injectable({ providedIn: 'root' })
export class Store {
  /** No Supabase project configured: sample data on this device. */
  readonly demo = !environment.supabaseUrl;

  readonly phase = signal<Phase>('boot');
  readonly roster = signal<Member[]>([]);
  readonly state = signal<MarketState | null>(null);
  /** Why the gate is closed, as an error code. */
  readonly downReason = signal<string>('network');
  /** The last refresh failed: what is on screen may be out of date. */
  readonly stale = signal(false);

  readonly members = computed(() => this.state()?.members ?? this.roster());
  readonly adminName = computed(() => this.members().find((m) => m.isAdmin)?.name ?? 'Wer den Markt verwaltet');

  private api!: Api;
  private token: string | null = null;
  private familyCode = '';
  private lastJson = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  nameOf = (key: string): string => this.members().find((m) => m.key === key)?.name ?? key;

  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.api = this.demo
      ? new (await import('./demo-api')).DemoApi()
      : new (await import('./supabase-api')).SupabaseApi(environment.supabaseUrl, environment.supabaseKey);

    // An invite link carries the family code after the #. Keep it, then clean the address bar.
    const fromLink = /[#&]familie=([^&]+)/.exec(location.hash);
    if (fromLink) {
      this.familyCode = decodeURIComponent(fromLink[1]);
      writeLocal(CODE_KEY, this.familyCode);
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        /* not allowed in some embeds */
      }
    } else {
      this.familyCode = readLocal(CODE_KEY) ?? '';
    }

    this.token = readLocal(TOKEN_KEY);
    if (this.token && (await this.refresh())) {
      this.phase.set('market');
    } else {
      await this.loadRoster();
    }

    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.phase() === 'market') void this.refresh();
    }, environment.pollMs);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.phase() === 'market') void this.refresh();
    });
  }

  async loadRoster(): Promise<Res> {
    const r = await this.api.roster(this.familyCode);
    if (r.ok) {
      this.roster.set(r.members);
      this.phase.set('gate');
    } else if (r.error === 'family_code_needed' || r.error === 'family_code_wrong') {
      this.phase.set('code');
    } else {
      this.downReason.set(r.error);
      this.phase.set('down');
    }
    return r;
  }

  async submitFamilyCode(code: string): Promise<Res> {
    const previous = this.familyCode;
    this.familyCode = code.trim();
    const r = await this.api.roster(this.familyCode);
    if (r.ok) {
      writeLocal(CODE_KEY, this.familyCode);
      this.roster.set(r.members);
      this.phase.set('gate');
    } else {
      this.familyCode = previous;
    }
    return r;
  }

  async login(member: string, pin: string): Promise<Res> {
    const r = await this.api.login(member, pin, this.familyCode);
    if (!r.ok) {
      if (r.error === 'family_code_needed' || r.error === 'family_code_wrong') this.phase.set('code');
      return r;
    }
    this.token = r.token;
    writeLocal(TOKEN_KEY, r.token);
    if (!(await this.refresh())) return { ok: false, error: 'network' };
    this.phase.set('market');
    return { ok: true };
  }

  async logout(): Promise<void> {
    const t = this.token;
    this.dropSession();
    if (t) void this.api.logout(t);
    await this.loadRoster();
  }

  /** Pulls my view of the market. False when it could not be loaded. */
  async refresh(): Promise<boolean> {
    if (!this.token) return false;
    const r = await this.api.state(this.token);
    if (r.ok) {
      const { ok: _ok, ...next } = r;
      const json = JSON.stringify(next);
      if (json !== this.lastJson) {
        this.lastJson = json;
        this.state.set(next);
      }
      this.stale.set(false);
      return true;
    }
    if (r.error === 'session') {
      const wasIn = this.phase() === 'market';
      this.dropSession();
      if (wasIn) await this.loadRoster();
    } else if (this.state()) {
      this.stale.set(true);
    }
    return false;
  }

  saveDonation = (d: Donation) => this.act((t) => this.api.saveDonation(t, d));
  draw = () => this.act((t) => this.api.draw(t));
  setDone = (done: boolean) => this.act((t) => this.api.setDone(t, done));
  addWish = (text: string, link: string) => this.act((t) => this.api.addWish(t, text, link));
  removeWish = (id: string) => this.act((t) => this.api.removeWish(t, id));
  tick = (id: string, on: boolean) => this.act((t) => this.api.tick(t, id, on));
  adminResetPin = (member: string) => this.act((t) => this.api.adminResetPin(t, member));
  adminResetDraw = () => this.act((t) => this.api.adminResetDraw(t));
  adminWipe = () => this.act((t) => this.api.adminWipe(t));

  private async act(run: (token: string) => Promise<Res>): Promise<Res> {
    if (!this.token) return { ok: false, error: 'session' } satisfies Fail;
    const r = await run(this.token);
    // Refresh either way: after a refusal the screen should show what is true now.
    await this.refresh();
    return r;
  }

  private dropSession(): void {
    this.token = null;
    this.lastJson = '';
    writeLocal(TOKEN_KEY, null);
    this.state.set(null);
    this.stale.set(false);
  }
}
