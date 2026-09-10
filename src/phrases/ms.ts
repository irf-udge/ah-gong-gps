// OWNER: Irfan (Pipeline spine + comfort routing + Voice I/O) — do not edit unless you are the owner.
//
// Malay. Starter set — read every line aloud before the demo and adjust for
// naturalness; these are written to be plain and unhurried for a 70+ listener.
//
// Keep English proper nouns (AMK Hub, NTUC, MRT) VERBATIM inside these
// sentences. See CONTRACTS.md § Validation.

import type { PhraseBook } from './index';

export const ms: PhraseBook = {
  // Conversation
  tapToSpeak: 'Tekan sini, beritahu saya anda mahu ke mana',
  listening: 'Sila cakap',
  thinking: 'Sila tunggu sebentar',
  sayAgain: 'Sila cakap sekali lagi',
  notUnderstood: 'Saya tidak dengar dengan jelas, sila cakap sekali lagi',
  tryAgain: 'Cuba lagi',
  confirmDestination: 'Anda mahu pergi ke {place}?',
  planning: 'Baik, saya cari jalan ke {place}',

  // Journey
  walkTo: 'Berjalan ke {landmark}',
  thenTurnLeft: 'kemudian belok kiri',
  thenTurnRight: 'kemudian belok kanan',
  thenStraight: 'kemudian jalan terus',
  crossAt: 'Lintas jalan di {landmark}',
  arrived: 'Anda sudah sampai',
  youAreNear: 'Anda berada berhampiran {landmark}',
  recalculating: 'Saya cari jalan semula',
  goHome: 'Kembali ke skrin utama',

  // Comfort rationale
  mostlySheltered: 'Laluan ini kebanyakannya berbumbung',
  partlySheltered: 'Sebahagian laluan ini berbumbung',
  benchesAlongTheWay: 'Ada {n} bangku di sepanjang jalan',
  toiletOnTheWay: 'Ada tandas di sepanjang jalan',
  shortestWalk: 'Laluan ini lebih dekat',
};
