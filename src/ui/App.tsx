// OWNER: Lija (Journey experience) — do not edit unless you are the owner.
//
// Placeholder shell. Renders the scaffold status so anyone who clones the repo
// and runs `npm run dev` immediately sees what they own and what's left.
//
// Replace this with the real screen router once the state machine lands:
//   idle → HomeScreen, listening → ListeningScreen, clarifying → ClarifyScreen,
//   navigating → JourneyScreen, arrived → ArrivedScreen, ?judge=1 → JudgeView.

const OWNERSHIP = [
  { who: 'Irfan', area: 'Pipeline spine + comfort routing + Voice I/O', dirs: 'src/core, src/providers, src/audio, src/phrases, server, data, fixtures' },
  { who: 'Lija', area: 'Journey experience', dirs: 'src/ui, src/journey, src/main.tsx' },
];

const PHASE_0 = [
  'Register MERaLiON API key (api.meralion.ai/keys/register) — done',
  'Register OneMap account + credentials in .env — done',
  'Gemini API key in .env (free tier — aistudio.google.com/apikey)',
  'Run speechSynthesis.getVoices() on the DEMO PHONE — confirm zh-CN and ms-MY',
];

export function App() {
  return (
    <main className="screen">
      <h1 style={{ fontSize: 'var(--fs-xl)', margin: 0 }}>Ah Gong GPS</h1>
      <p style={{ color: 'var(--fg-muted)', margin: 0 }}>
        Scaffold only — no features implemented yet. See <code>DEVPLAN.md</code>.
      </p>

      <section>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>Who owns what</h2>
        <ul style={{ paddingLeft: '1.2em', margin: 0 }}>
          {OWNERSHIP.map((o) => (
            <li key={o.who} style={{ marginBottom: 12 }}>
              <strong>{o.who}</strong> — {o.area}
              <div className="debug">{o.dirs}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>Phase 0 blockers</h2>
        <ul style={{ paddingLeft: '1.2em', margin: 0 }}>
          {PHASE_0.map((task) => (
            <li key={task} style={{ marginBottom: 8, fontSize: 'var(--fs-md)' }}>
              {task}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
