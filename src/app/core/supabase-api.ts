import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Api, Donation, MarketState, Member, Res } from './types';

/**
 * Talks to the wm_* functions from supabase/migrations. No table is touched
 * directly: the functions decide what each person gets to see.
 */
export class SupabaseApi implements Api {
  private readonly sb: SupabaseClient;

  constructor(url: string, key: string) {
    // Supabase Auth is not used. Sessions are the tokens handed out by wm_login.
    this.sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  private async call<T>(fn: string, args: Record<string, unknown>): Promise<Res<T>> {
    try {
      const { data, error } = await this.sb.rpc(fn, args);
      if (error) return { ok: false, error: error.code ? 'server' : 'network' };
      if (!data || typeof data !== 'object') return { ok: false, error: 'server' };
      return data as Res<T>;
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  roster(familyCode: string) {
    return this.call<{ members: Member[] }>('wm_roster', { p_family_code: familyCode });
  }
  login(member: string, pin: string, familyCode: string) {
    return this.call<{ token: string; member: string }>('wm_login', {
      p_member: member,
      p_pin: pin,
      p_family_code: familyCode,
    });
  }
  logout(token: string) {
    return this.call('wm_logout', { p_token: token });
  }
  state(token: string) {
    return this.call<MarketState>('wm_state', { p_token: token });
  }
  saveDonation(token: string, d: Donation) {
    return this.call('wm_save_donation', { p_token: token, p_org: d.org, p_link: d.link, p_note: d.note });
  }
  draw(token: string) {
    return this.call('wm_draw', { p_token: token });
  }
  setDone(token: string, done: boolean) {
    return this.call('wm_set_done', { p_token: token, p_done: done });
  }
  addWish(token: string, text: string, link: string) {
    return this.call('wm_add_wish', { p_token: token, p_text: text, p_link: link });
  }
  removeWish(token: string, id: string) {
    return this.call('wm_remove_wish', { p_token: token, p_wish: id });
  }
  tick(token: string, id: string, on: boolean) {
    return this.call('wm_tick', { p_token: token, p_wish: id, p_on: on });
  }
  adminResetPin(token: string, member: string) {
    return this.call('wm_admin_reset_pin', { p_token: token, p_member: member });
  }
  adminResetDraw(token: string) {
    return this.call('wm_admin_reset_draw', { p_token: token });
  }
  adminWipe(token: string) {
    return this.call('wm_admin_wipe', { p_token: token });
  }
}
