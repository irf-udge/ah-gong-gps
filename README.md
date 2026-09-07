# Ah Gong GPS

**Voice navigation for Singaporean seniors who can't use an English map app.**

Press one big button. Say where you want to go, in your own language. Get walked
there one landmark at a time, out loud — no map, no typing, no English.

> **Bad** (what Google Maps says): *"Head northwest on Ang Mo Kio Avenue 10 for 240 metres, then turn right."*
>
> **Ours** (spoken in Mandarin or Malay): *"Walk to the market. When you see the bus stop, turn right. There's a bench here if you want to rest."*

Built for the *Vibe for Good* hackathon. Singapore became a super-aged society in
2026; English is a minority home language among citizens 65+, and every mainstream
navigation app is English-first and map-first. Seniors navigate by landmarks, not
street names and distances.

**Our defensible combination:** dialect conversation + elderly-comfort routing +
landmark-grounded guidance + a live journey companion. No existing product does
all four.

---

## Quickstart

```bash
npm install
cp .env.example .env     # then fill it in — see Keys below
npm run dev              # web on :5173, api on :8787
```

You can build and run the entire app **before any API key exists** — every
provider has a fixture implementation:

```bash
DEMO_MODE=1 npm run dev
```

Other scripts: `npm run typecheck` · `npm test` · `npm run build` · `npm run etl`

---

## Keys

All three are read by the **server only**. None ever reach the browser — that is
the entire reason `server/` exists.

| Key | Where to get it | Notes |
| --- | --- | --- |
| `MERALION_API_KEY` | `POST https://api.meralion.ai/keys/register`, or **My Key** at <https://meralion.org/api-console> | Speech-to-text. Check your tier with `GET /v1/rate-limit/status` as soon as you have it. |
| `ONEMAP_EMAIL` / `ONEMAP_PASSWORD` | <https://www.onemap.gov.sg/apidocs/register> | The server exchanges these for a ~3-day token and refreshes on 401. Don't paste a raw token. |
| `ANTHROPIC_API_KEY` | <https://console.anthropic.com/settings/keys> | Destination extraction + instruction rewrite. |

**Registration for MERaLiON and OneMap is a human step — do it first.** Everything
downstream is blocked on those two. See `DEVPLAN.md` § Phase 0.

Check what the server can see without leaking anything:

```bash
curl http://localhost:8787/api/health
```

---

## Architecture in one paragraph

The browser records **16 kHz mono WAV** and posts it to our thin Express layer,
which forwards to **MERaLiON** for transcription and to **Claude** to pull out
the destination phrase. **OneMap** resolves that to coordinates and returns walk
routes; we generate several route variants ourselves and score them for elderly
comfort (shelter, benches, toilets, segment length), because *OneMap has no
accessibility routing API*. We reverse-geocode each turn to collect **real**
nearby landmarks, hand only those to Claude to rewrite into short spoken steps,
validate the output against the landmark list, and speak it with the browser's
own speech synthesis as GPS (or a simulated walk) crosses each geofence.

Full detail, including every verified API fact and both MERaLiON traps, is in
**[`CONTRACTS.md`](./CONTRACTS.md)**. Read that before writing code.

---

## Who owns what

Ownership is **by file**. Every source file starts with an `OWNER:` header. Do
not edit a file you don't own — open an issue or message the owner instead. This
is what keeps three people out of each other's merge conflicts.

| | Person | Area | Directories |
| --- | --- | --- | --- |
| **A** | *(you)* | Pipeline spine + comfort routing | `src/core/`, `src/providers/{index,types,onemap,fixtures}.ts`, `server/`, `data/`, `fixtures/` |
| **B** | | Voice I/O | `src/audio/`, `src/providers/{stt,tts}.ts`, `src/phrases/` |
| **C** | | Journey experience | `src/ui/`, `src/journey/`, `src/main.tsx` |

Your task list is in **[`DEVPLAN.md`](./DEVPLAN.md)**.

---

## Testing on a phone

`getUserMedia` and `navigator.geolocation` both require a **secure context**, so
`http://<your-lan-ip>:5173` will not work — the mic and GPS will silently fail.

```bash
npm run dev
cloudflared tunnel --url http://localhost:5173   # or: ngrok http 5173
```

Open the HTTPS URL it prints on the phone.

**Demo device:** MERaLiON runs server-side so it's device-agnostic, but the Web
Speech *fallback* and voice availability are not. Pick the demo phone in Phase 0
and rehearse on that exact device. Android Chrome is the safe choice.

---

## Project layout

```
server/         Express: OneMap proxy + token refresh, MERaLiON proxy, Claude calls
src/
  core/         PURE logic — types, geo, comfort scoring, landmarks, validation
  providers/    The five swap points (STT, TTS, routing, places, location)
  audio/        Mic capture → 16 kHz mono WAV
  journey/      State machine + location providers
  ui/           Screens + design tokens
  phrases/      zh / ms phrase bank
data/           Dataset ETL + baked amenity index
fixtures/       Recorded responses + the curated demo route
```
