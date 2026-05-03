# Suno SFX Prompts — Multiplayer Breakout

Curated list of audio cues that would lift the game's "feel" — each one is a short MP3 tied to a specific in-game moment. Copy each prompt verbatim into Suno (https://suno.com), generate, download as `.mp3`, drop into `client/public/audio/`.

**Style consistency suffix** — append this to every prompt to avoid Suno adding random vocals or wildly different mixes:

```
no vocals, no lyrics, instrumental SFX only, mono mix, normalized loudness, short and punchy
```

After download, optionally normalize to **-16 LUFS** in Audacity (`Effect → Loudness Normalization`) so all cues sit at the same level relative to the game's master mix.

---

## 14 high-leverage cues, ranked by impact

### 1. `match-start-fanfare.mp3`
- **Trigger:** Versus countdown 3-2-1 → GO
- **Length:** ~3s
- **Prompt:**
  > Short epic 8-bit chiptune battle fanfare, 3 seconds, ascending arpeggio in C major, brassy synth, ends on triumphant chord, retro arcade style

### 2. `garbage-incoming.mp3`
- **Trigger:** server emits `'garbage'` to receiver (you're being attacked)
- **Length:** ~2s
- **Prompt:**
  > Tense 2-second alarm siren rising, electronic, dystopian, low to high synth sweep with subtle metallic echo, urgency

### 3. `garbage-delivered.mp3`
- **Trigger:** you sent garbage to opponent (offensive — feels like a power move)
- **Length:** ~1.5s
- **Prompt:**
  > Satisfying 1.5-second metallic smack with reverberating low chord, industrial impact, single hit then decay

### 4. `bomb-explosion.mp3`
- **Trigger:** 💣 Bomb-brick destroyed → 3×3 chain
- **Length:** ~3s
- **Prompt:**
  > 3-second deep bass explosion, cinematic boom, sub-bass drop with high-frequency debris fizzle, single impact then decay

### 5. `diamond-chime.mp3`
- **Trigger:** 💎 Diamond brick destroyed (+50 score moment)
- **Length:** ~1.5s
- **Prompt:**
  > 1.5-second magical bell chime ascending, crystal harp glissando in high octave, sparkly, fairy-like, ends with twinkle

### 6. `gift-pickup.mp3`
- **Trigger:** 🎁 Gift brick destroyed (drops power-up)
- **Length:** ~1.5s
- **Prompt:**
  > 1.5-second playful ascending xylophone melody, three notes major chord, child-friendly, warm, rewarding ding at end

### 7. `multi-ball-spawn.mp3`
- **Trigger:** ⚡ Multi-Ball power-up activates
- **Length:** ~1.5s
- **Prompt:**
  > 1.5-second triple-tone power-up stinger, electronic 80s arcade, three rapid ascending blips with shimmer reverb tail

### 8. `long-paddle.mp3`
- **Trigger:** 📏 Long-paddle power-up activates
- **Length:** ~1.5s
- **Prompt:**
  > 1.5-second stretching whoosh with rising pitch wobble, synth pad opening up, elastic feel, satisfying expansion

### 9. `slow-mo-activate.mp3`
- **Trigger:** 🕒 Slow-mo power-up activates
- **Length:** ~2s
- **Prompt:**
  > 2-second time-warp wobble effect, pitch-bend descending then sustained, eerie hollow synth, like slowing down a record, otherworldly

### 10. `combo-tier7-fanfare.mp3`
- **Trigger:** Combo ×7 or higher (rare moment, cinematic)
- **Length:** ~2s
- **Prompt:**
  > 2-second epic horn fanfare burst, orchestral brass section ascending chord, triumphant, like a video game boss-defeated stinger

### 11. `countdown-tick.mp3`
- **Trigger:** Countdown numbers 3, 2, 1 (use 3× for each tick)
- **Length:** ~0.4s
- **Prompt:**
  > 0.4-second sharp metallic tick, single high pitched click with subtle digital echo, like a cosmic clock ticking

### 12. `countdown-go.mp3`
- **Trigger:** "GO!" moment after countdown finishes
- **Length:** ~0.8s
- **Prompt:**
  > 0.8-second triumphant gong with explosive release, deep bass impact followed by bright cymbal shimmer, start-of-race feel

### 13. `draw-suspense.mp3`
- **Trigger:** 5-min match cap reached → sudden-death extension
- **Length:** ~3s
- **Prompt:**
  > 3-second rising suspense build, orchestral strings tremolo crescendo, tension rising, ends on a held ominous chord

### 14. `lobby-ambient-loop.mp3`
- **Trigger:** Lobby scene background (looped, optional)
- **Length:** ~30s (loopable)
- **Prompt:**
  > 30-second seamless loop, calm atmospheric synth pad with subtle arpeggio, dark electronic ambience, low BPM, dreamy, no melody

---

## Integration map

| Audio | Sfx method | Code hook |
|---|---|---|
| `match-start-fanfare` | new `sfx.matchFanfare()` | replaces `sfx.matchStart()` in `GameScene.popCountdown('GO')` |
| `garbage-incoming` | new `sfx.garbageIn()` | `room.onMessage('garbage')` when `slot === mySlot` |
| `garbage-delivered` | new `sfx.garbageOut()` | same handler when `slot !== mySlot` |
| `bomb-explosion` | new `sfx.bomb()` | physics.ts when `kind === 'bomb'` chain triggers |
| `diamond-chime` | new `sfx.diamond()` | `applyBrickEffect` for `'diamond'` |
| `gift-pickup` | new `sfx.gift()` | `applyBrickEffect` for `'gift'` |
| `multi-ball-spawn` | new `sfx.multiBall()` | `applyPowerUp('multi-ball')` |
| `long-paddle` | new `sfx.longPaddle()` | `applyPowerUp('long-paddle')` |
| `slow-mo-activate` | new `sfx.slowMo()` | `applyPowerUp('slow-mo')` |
| `combo-tier7-fanfare` | replace `sfx.applause()` for tier ≥6 | `combo.register` callback |
| `countdown-tick` | replace `sfx.countdownPip()` | `popCountdown()` for numbers |
| `countdown-go` | replace `sfx.countdownGo()` | `popCountdown(text='GO')` |
| `draw-suspense` | new `sfx.suspense()` | server tick when sudden-death triggers |
| `lobby-ambient-loop` | new `sfx.lobbyAmbient(start/stop)` | `LobbyScene.create / shutdown` with `loop: true` |

---

## After download workflow

1. Drop all 14 `.mp3` files into `client/public/audio/`
2. Add filenames to `SAMPLE_URLS` in `client/src/audio/Sfx.ts`
3. Add corresponding `sfx.xxx()` shorthand methods (each one wraps `playSample(key, { volume })`)
4. Wire each one to the code hook in the integration map above
5. Build + deploy as usual

I'll handle steps 2-5 autonomously once you say "files are in" and I see them in the public/audio folder.

---

## Notes on Suno's quirks

- Suno tends to add **drum loops** even when you say "no vocals" — if a generation has unwanted percussion, just regenerate (3-5 attempts usually nails it).
- For `lobby-ambient-loop`: pick a clip where the start and end are similar so the loop seam is smooth. Audacity has a built-in crossfade tool.
- For ultra-short cues (`countdown-tick` 0.4s): Suno might generate longer tracks — trim in Audacity to keep just the impact moment.
- Save **all generations** even the ones you don't pick — sometimes the "B-side" stingers work better in context once tested live.
