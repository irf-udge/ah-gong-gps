// OWNER: B (Voice I/O) — do not edit unless you are the owner.
//
// Mandarin. Starter set — read every line aloud before the demo and adjust for
// naturalness; these are written to be plain and unhurried for a 70+ listener.
//
// Keep English proper nouns (AMK Hub, NTUC, MRT) VERBATIM inside these
// sentences. That is how Singaporeans actually speak, and translating them is
// a hallucination risk. See CONTRACTS.md § Validation.

import type { PhraseBook } from './index';

export const zh: PhraseBook = {
  // Conversation
  tapToSpeak: '按一下，告诉我你要去哪里',
  listening: '请说',
  sayAgain: '请再说一次',
  notUnderstood: '我听不清楚，请再说一次',
  confirmDestination: '您是要去{place}吗？',
  planning: '好，我帮您找去{place}的路',

  // Journey
  walkTo: '走到{landmark}',
  thenTurnLeft: '然后向左转',
  thenTurnRight: '然后向右转',
  thenStraight: '然后一直走',
  crossAt: '在{landmark}过马路',
  arrived: '您到了',
  youAreNear: '您现在在{landmark}附近',
  recalculating: '我帮您重新找路',

  // Comfort rationale
  mostlySheltered: '这条路大部分有盖',
  partlySheltered: '这条路有一部分有盖',
  benchesAlongTheWay: '中途有{n}张长椅',
  toiletOnTheWay: '路上有厕所',
  shortestWalk: '这条路比较近',
};
