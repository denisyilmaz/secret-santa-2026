import { Fail } from './types';

/** Turns an error code from the backend into a sentence for the screen. */
export function messageFor(fail: Fail, nameOf: (key: string) => string = (k) => k): string {
  switch (fail.error) {
    case 'session':
      return 'Deine Anmeldung ist abgelaufen. Melde dich neu an.';
    case 'network':
      return 'Keine Verbindung. Versuch es gleich noch einmal.';
    case 'pin_wrong': {
      const n = fail.attemptsLeft ?? 0;
      return 'Die Geheimzahl stimmt nicht. ' + (n === 1 ? 'Noch 1 Versuch.' : `Noch ${n} Versuche.`);
    }
    case 'locked': {
      const min = Math.max(1, Math.ceil((fail.seconds ?? 900) / 60));
      return `Zu viele Versuche. Warte ${min} ${min === 1 ? 'Minute' : 'Minuten'}.`;
    }
    case 'pin_format':
      return 'Bitte genau 4 Ziffern eingeben.';
    case 'family_code_needed':
      return 'Gib zuerst den Familiencode ein.';
    case 'family_code_wrong':
      return 'Der Familiencode stimmt nicht.';
    case 'not_set_up':
      return 'Der Markt ist noch nicht eingerichtet: Es fehlt der Familiencode in der Datenbank.';
    case 'already_drawn':
      return 'Es wurde schon gelost.';
    case 'donations_missing':
      return 'Es fehlen noch Spendenwünsche.';
    case 'org_invalid':
      return 'Trag eine Organisation oder ein Projekt ein.';
    case 'text_invalid':
      return 'Schreib zuerst auf, was du dir wünschst.';
    case 'link_invalid':
      return 'Der Link sieht nicht richtig aus. Lass ihn weg oder prüfe ihn.';
    case 'note_invalid':
      return 'Der Satz ist zu lang. 300 Zeichen passen auf das Los.';
    case 'too_many':
      return 'Dein Zettel ist voll. Mehr als 40 Wünsche passen nicht drauf.';
    case 'taken':
      return `${fail.by ? nameOf(fail.by) : 'Jemand'} war schneller.`;
    case 'wish_removed':
      return 'Der Wunsch wurde gerade zurückgezogen.';
    case 'not_admin':
      return 'Das darf nur, wer den Markt verwaltet.';
    default:
      return 'Das hat nicht geklappt. Versuch es gleich noch einmal.';
  }
}
