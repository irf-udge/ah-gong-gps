// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// The whole home screen is ONE BIG BUTTON. Nothing else competes with it.
// The first tap must do three things at once:
//   1. request mic permission (audio/capture.requestMicPermission)
//   2. prime TTS for iOS (tts.primeForUserGesture — it will not speak later
//      unless speechSynthesis was first invoked inside a user gesture)
//   3. start recording
//
// No map. No menu. No settings.

import type { Lang } from '../../core/types';

export interface HomeScreenProps {
  lang: Lang;
  onSpeak: () => void;
}

export function HomeScreen(_props: HomeScreenProps) {
  return <div className="screen">TODO: HomeScreen — one big button</div>;
}
