export interface Member {
  key: string;
  name: string;
  /** One of the palette names in styles.css: pink, teal, yellow, green, red. */
  color: string;
  isAdmin: boolean;
  hasPin: boolean;
  /** Only present once signed in. */
  hasDonation?: boolean;
  /** True once this person has marked their own donation as done. */
  donated?: boolean;
}

export interface Me {
  key: string;
  name: string;
  color: string;
  isAdmin: boolean;
}

export interface Donation {
  org: string;
  link: string;
  note: string;
}

/** The lot I drew: whom I donate for, and where they want the money to go. */
export interface Lot extends Donation {
  receiver: string;
  done: boolean;
}

export interface Wish {
  id: string;
  owner: string;
  text: string;
  link: string;
  removed: boolean;
  /** Who ticked it. Always null on my own wishes: the server never sends it. */
  tickBy: string | null;
}

/** Everything the signed-in person is allowed to see. */
export interface MarketState {
  me: Me;
  members: Member[];
  myDonation: Donation | null;
  drawn: boolean;
  myLot: Lot | null;
  wishes: Wish[];
}

export interface Fail {
  ok: false;
  error: string;
  attemptsLeft?: number;
  seconds?: number;
  by?: string;
}

export type Res<T = object> = ({ ok: true } & T) | Fail;

/** The backend contract. Implemented by SupabaseApi and by the on-device DemoApi. */
export interface Api {
  roster(familyCode: string): Promise<Res<{ members: Member[] }>>;
  login(member: string, pin: string, familyCode: string): Promise<Res<{ token: string; member: string }>>;
  logout(token: string): Promise<Res>;
  state(token: string): Promise<Res<MarketState>>;
  saveDonation(token: string, donation: Donation): Promise<Res>;
  draw(token: string): Promise<Res>;
  setDone(token: string, done: boolean): Promise<Res>;
  addWish(token: string, text: string, link: string): Promise<Res>;
  removeWish(token: string, id: string): Promise<Res>;
  tick(token: string, id: string, on: boolean): Promise<Res>;
  adminResetPin(token: string, member: string): Promise<Res>;
  adminResetDraw(token: string): Promise<Res>;
  adminWipe(token: string): Promise<Res>;
}
