# Inazuma Clone — Changelog & Feature Notes

Every feature, data source, bug fix and design decision that went into
this project, roughly in the order it happened. For what the project is
and how to run it, see [`README.md`](./README.md).

## Accounts, profile-saved formations, browse-players filters, and a few smaller fixes
A batch of independent gameplay/UX requests, landed together:

- **Accounts.** Every player now has *some* signed-in Firebase Auth user
  from the moment the app loads — anonymous by default (`src/auth/auth.js`),
  upgradeable in place to a real account via email/password sign-up or
  Google sign-in, both of which *link* onto the existing anonymous uid
  (`linkWithCredential`/`linkWithPopup`) rather than starting a separate
  account, so anything already saved while anonymous carries over. "Play
  anonymously" is simply never upgrading that session. New `👤 Profile`
  panel (reachable from the landing page) holds the sign-in/sign-up form
  and account status.
- **Profile-saved formations.** The squad editor's team-name field (next to
  Save) is saved along with the formation itself to a new Firestore-backed
  list under the signed-in user (`src/auth/profile.js`) — the Save button
  now writes both the existing local (this-browser-only) copy *and* a named
  entry in your profile, and the Profile panel lists every saved formation
  with its own Load/Delete.
  - **Note:** `src/firebase-app.js` reuses the Firebase project already set
    up for multiplayer signaling, but Auth and Firestore need their own
    setup in that project's console before this actually persists anything
    — enabling the Email/Password, Google, and Anonymous sign-in providers
    under Authentication, enabling Firestore itself (a different product
    from the Realtime Database used for signaling), and setting its
    security rules to `users/{uid}/formations/{doc}` scoped to that uid.
    The real `apiKey`/`appId`/`messagingSenderId` from that project's Web
    app config also need dropping into `FIREBASE_CONFIG` there (currently
    placeholders) — until then, sign-in attempts fail gracefully (caught,
    shown as a status message) rather than breaking anything else in the
    app.
- **Browse Players filters.** Added a position filter (GK/DF/MF/FW,
  independent of the existing "filling this pitch spot" scope-lock), a
  small "✕" next to every filter to clear just that one, and wrapped the
  whole filter row in its own collapsible section (default open) so it can
  be tucked away without closing the player list itself.
- **Font.** Swapped `Press Start 2P` (headers, scoreboard, confrontation UI)
  for `Silkscreen` — still a genuine pixel font, but without the
  1/I/l, O/0, S/5 ambiguity at the sizes this UI actually uses it at.
- Removed the landing page's descriptive paragraph.
- Added a goalkeeper-save sound (`playGkSave` in `src/audio/sfx.js`) — a
  descending two-note parry, distinct from the existing kick/pass/goal/
  whistle tones, triggered from the keeper-save branch of
  `_applyConfrontOutcome`.

## Fix: multiplayer could still get stuck after both players confirmed
Two more gaps in the same squad-confirm flow the earlier multiplayer fix
touched:

- **Stale status after a role flip.** `_confirmSquad` only ever checked
  role and updated `#squad-status` at the moment of confirming. A player
  confirming fast enough to still be on the provisional "alone in the
  room" host guess would see "Waiting for opponent…" — correct at the
  time, but if the real host/guest comparison later said they were
  actually the guest, nothing ever revisited that text or the start-check
  again. New `_tryStartMultiplayerMatch()` is now called from every event
  that could be the "last domino" — confirming, the peer's squad arriving,
  and role finally settling (`_syncRoleFromNet`) — instead of relying on
  exactly one of them to always happen last.
- **No recovery from a dropped squad message.** Trystero's data channel
  has no delivery guarantee for a message sent right as it's still
  finishing setup. Confirming now starts a retry loop that resends your
  squad and re-checks every couple of seconds until the match actually
  starts, so a single lost send no longer leaves both players stuck
  forever.

## Fix: landing screen hidden behind the canvas
A stray inline `position:relative` on `#landing-panel` (added for the sfx
toggle button) overrode `.panel-overlay`'s `position:fixed` via inline-style
specificity, so the landing screen fell into normal document flow right
after the canvas instead of covering it — the pitch/scoreboard showed
through with no menu on top. Removed; `.panel-overlay`'s own fixed
positioning already serves as the button's containing block.

## One randomize dice, star picks mixed in; multiplayer-only settings hidden
- **One "🎲" dice** on the formation pitch itself replaces the old
  "Random" / "Random (top players)" button pair. It always mixes 2–3
  deliberate top-rated "star" picks into an otherwise ordinary random XI,
  instead of either a fully mediocre squad or every slot stacked with a
  standout.
- **Multiplayer match settings**: AI difficulty is hidden entirely (no AI
  plays once a real opponent is connected), and Half length is shown only
  to whichever player is currently host — it was already host-authoritative
  gameplay-wise, so the guest's copy did nothing but invite confusion.

## Fix multiplayer, tournament as its own mode, sound effects, bigger cards
Four follow-ups after more playtesting:

- **Fix: multiplayer started two independent solo matches instead of one
  shared one.** `_confirmSquad` used to infer "I'm playing solo" from
  `!net.hasPeer()`, but that's also just the normal state of multiplayer
  before the WebRTC handshake finishes — whoever hit Confirm first (usually
  both players, staring at the same screen) silently fell back to an
  AI-generated opponent instead of waiting for the real one, so each player
  ended up watching their own separate simulated match. Now it checks
  `uiMode` instead, which the scene always knows unambiguously; multiplayer
  correctly waits for the real peer's squad every time. Also shows
  "Connecting to opponent…" while the handshake is still in progress.
- **Tournament is now its own mode from the home screen**, not a button
  tucked inside the squad editor: pick how many teams play first, then
  build your squad (locking it in), then go straight into the bracket or
  table. Leaving and coming back (even after the page reload every match
  causes) resumes the running tournament directly — the "🏆 Tournament"
  button becomes "🏆 Continue Tournament" whenever one's in progress.
- **Knockout opponents now get tougher round by round.** Standard
  single-elimination seeding: you get the weakest of the drawn opponents in
  round 1, and can only face the strongest in the final if you keep
  winning. Leagues are unchanged — one flat, uniformly random pool
  throughout, as before.
- **Synthesized sound effects** for kicks, passes, goals and the
  kickoff/full-time whistle — short chiptune-style blips generated with the
  Web Audio API (no audio files, matching the game's own pixel-art look), a
  🔊/🔇 toggle on the landing screen persists the mute preference.
- **Bigger player portraits** across the formation pitch, bench strip,
  browse-players drawer, player-stat popup and the versus/duel screen.

## Tournaments: random opponents by team count, a locked squad, a drawn standings table
Follow-up on the tournament feature after feedback:

- **Pick a number of teams, not individual opponents.** The setup screen's
  checkbox list is gone — pick 4/8/16 teams and the opponents are drawn at
  random from the viable pool (still only teams that can field a full XI).
- **Your squad locks in when the tournament starts**, not per fixture.
  Whatever's set up under Formation at that moment is snapshotted into the
  tournament itself (`mySquad`, alongside the bracket/table, so it survives
  the reload after every match) and reused for every one of your games —
  changing your live squad in between (or even starting a totally different
  one) no longer has any effect on a running tournament. "Play next" now
  starts the match immediately with that locked XI instead of detouring
  through Formation/Confirm each time, since there's nothing left to
  confirm.
- **Standings are drawn as a real table**, not plain rows — switched to
  nes.css's own pixel-art `nes-table` (dark variant, to match the rest of
  the UI) with a ranked `#` column.

## Offline tournaments — knockouts and small leagues against the game's real teams
Weighed three bigger features (tournaments, player accounts, online
matchmaking) against the game's architecture (a 100% static client, no
backend, Trystero-over-Nostr for the existing 1:1 P2P matches) before
building anything — see the session's plan file for the full writeup.
Landed the one that fit cleanly without any architectural change: offline
tournaments.

Entrants are the game's own real teams (every player already carries a
`team`/`game` — Raimon alone spans six eras), not squads built from
scratch — the setup screen is just "pick who else plays" from the same
team/era list the squad editor's team filter already knows about. Every
match that doesn't involve you (there are a lot of those once a bracket
grows past a handful of teams) is resolved instantly by a lightweight
simulated scoreline weighted by each side's average player rating — you
only ever actually play your own fixtures, through the ordinary
Formation/Confirm flow, with the rival side pre-armed with the opponent's
real roster. New `src/data/tournament.js` holds the whole bracket/league
engine as plain, framework-agnostic functions (knockout with automatic bye
padding, round-robin standings, the instant-simulation logic) — no DOM, no
Phaser, easy to test in isolation. State lives entirely in `localStorage`
(`inazuma-clone:tournament:v1`), since the game does a full page reload
after every match. New `tests/tournaments.spec.js` covers the bracket/
league math directly and the UI flow end to end, including that a result
survives a real page reload.

One data wrinkle surfaced building this: about half of the ~340 team/era
combinations in the roster have fewer than 11 named players (one-off rival
teams from the show that only ever got a couple of characters drawn) — the
entrant picker filters those out, since they can't actually field an XI.

## Fix: closing the player stat popup also closed the Browse Players drawer
On narrow screens, closing the player stat popup (the × button) would also
close the Browse Players drawer sitting behind it — annoying mid-browse,
since you'd have to reopen the drawer after every look at a player's stats.
Root cause: `#player-stat-panel` is a fixed overlay rendered outside
`#squad-columns` (so it can sit centred over the whole screen whether or not
the drawer is open), so a click on its × button fell outside the drawer's
own subtree and was caught by the "tap outside the drawer closes it"
listener as if it were a genuine outside tap. Excluded the stat panel from
that check in `GameScene.js`. Added a regression test
(`tests/squad-editor.spec.js`) covering it.

## Borderless portrait chips
The square frame around every pixel-art portrait (list cards, formation
pins, stat sheet header, duel cards) had a 1-2px border. Dropped it — the
portraits read cleaner without one. Removed from `.slot-pin .pin-avatar`,
`.bench-pin .pin-avatar`, `.av`, and `.duel-portrait` in `index.html`; the
fallback flat-color+initials chips lose the same border since they share
the markup.

## Real teams, horizontal field on PC, passes, numeric PT, formations

### Real teams — finally
You sent me `Inazuma_Eleven_Manager_2026.xlsx`, with one sheet per real
team (Raimon, Royal, Umbrella, Occult, Wild...). It was messy, as warned,
so instead of relying on fixed columns (which move around from sheet to
sheet), I looked for **structural anchors**: every player in a squad has
a row with their name right before a block starting with "Hissatsu",
"Goalkeeping" or "Technical" — that reliably identifies each player's row
no matter which column it's in. Every name found is validated against our
existing roster (so coach names or a "favourite player" mentioned
elsewhere on the sheet don't slip in).

Result: **976 roster players (out of 4986) now have a real team**, across
**49 teams**, each with its **real kit colors** (hex, pulled straight
from the "Kits" section of each sheet — no image analysis needed). The
remaining ~4000 stay without a team (this manager spreadsheet only
covers those 49 specific teams, not the ~9500 characters across every
spin-off).

`public/teams.json` stores the colors for each of the 49 teams, and every
roster player now has `team` and `teamColor` (`null` if no team was
found for them).

### About photos — still don't have them
Neither this spreadsheet nor the previous one ships actual image files,
just text (not even names, in this case). So instead of photos, each
player is told apart by their **real kit color** (or a fixed color per
game if they have no team) plus their **initials**, both on the pick
cards and on the pitch. If you ever get hold of a real image pack (files,
not text paths), let me know and we'll wire it in — the spot for it is
already prepared (`avatarHtml()` in `GameScene.js`).

### Horizontal field on wide screens
When the match loads, if the window is wider than it is tall (like a
computer), the pitch renders horizontally (goals on the left and right);
if it's taller than wide (like a phone in portrait), it renders
vertically as before. This is decided once at load time and doesn't
change if you rotate the screen mid-match.

### Passing: tap to pass, drag to move
- **Dragging** (hold and move your finger/mouse) still draws the path
  the player will follow, as before.
- **Tapping without dragging** (a quick tap, barely any movement) now
  **passes the ball** toward that point, if you have the ball — it sets
  off with real physics, so it may or may not actually reach a teammate
  depending on how it rolls.

### Technique points (PT): numbers, no cooldown, per player
- They were already per player (each of the 11 has their own), but now:
  **shown as a number** ("PT: 62/100") instead of a bar, and **no
  cooldown** — the only thing that matters is whether you still have
  enough points. Once they run out, you simply can't use that
  supertechnique until it regenerates a little (it still recovers slowly
  over time).

### Formations: 4 to choose from, changeable mid-match
Before kickoff you pick a formation (4-4-2, 4-3-3, 4-2-3-1 or 3-5-2) from
the same selection dropdown. During the match there's a **"Formation"**
button to change it on the fly (your players reposition gradually, not
instantly). What I **haven't** done yet is let you manually drag each
player around within the formation — for now it's the 4 fixed presets;
that would be the next step if you're interested.

### 5-player bench, and a randomize button
The bench now has a real cap of 5 (it used to allow more). And there's a
**"🎲 Randomize squad"** button that builds you a full XI + bench +
formation at random from the whole roster (not just the current filter),
in case you want to jump into a match quickly without picking one by one.

## Vertical pitch, 11 players per side, slower pace, and more RPG

### The missing-supertechniques bug — found and fixed
There were two real bugs behind "supertechniques don't show up":

1. **The client (the player who isn't hosting the match) never built
   their team on screen.** `startMatch()` — which creates the 11 bodies,
   their stats and their techniques — was only ever called on the host.
   The client was left with empty `teamA`/`teamB` forever, so any lookup
   of their stats came back with nothing. There's now an equivalent
   function (`buildClientTeams()`) the client runs as soon as it has both
   squads' data (its own and the rival's, which were already being
   exchanged — they just weren't being used for this).
2. **The "active player" kept recalculating during the duel itself.** If
   the player closest to the ball changed while you were choosing your
   action (it could shift due to momentum), the panel looked at the new
   player's stats instead of the one actually in the duel — and if that
   new player had no technique in that category, the button vanished.
   The panel now always uses the IDs that were locked in **at the exact
   moment** the confrontation started, and the "active player" stops
   recalculating while play is frozen for a duel/shot.

### You can now see who won the duel
When a confrontation (duel or shot) resolves, a banner shows on screen
for a couple of seconds ("So-and-so takes the ball", "GOAL! So-and-so
scores with a supertechnique", "Save! The keeper gets it") — it used to
resolve silently with no way to tell what had happened.

### More "pause and decide" than real-time
- Movement (moving players around the pitch) is still real-time, but
  **much slower** — giving you time to think before anything happens.
- As soon as there's a duel (two active players collide) or a shot,
  **play genuinely stops**: nobody moves, and you have up to **20
  seconds** to choose your action (it used to be 1.5s). The panel also
  shows the name of the player involved and their current SP.
- It's resolved by stats + probability, not reflexes — real time is only
  for the "position your players" part.

### Drawn paths are now visible, and you can move several players at once
- The path you draw with your finger/mouse **is drawn on screen** (a
  yellow line) while you trace it and while your player follows it.
- Since all of this is "marking intentions" rather than direct real-time
  control, **you can draw paths for several of your 11 players at
  once**: tap near one of your players to "grab" them and draw their
  path, release, tap near another one of your players and do the same —
  each one follows their own path independently.
- If you tap somewhere not close to any of your players, by default the
  one closest to the ball (the "active" one) moves.

### Match length
Two 3-minute halves (6 minutes total), with an automatic half-time change
(repositions everyone in formation) and a "Full time" screen once the
second half ends, which freezes the match. The scoreboard now also shows
the clock ("1st half — 2:45").

### Vertical pitch
The pitch is no longer landscape — it's vertical (480×760), with one goal
at the top and one at the bottom, like the DS games' screenshots.
`Scale.FIT` in `main.js` still scales this to any screen.

### 11 players per side — but only the one closest to the ball "fights"
You see your 11 players in formation (1-4-3-3) at all times. Whoever is
closest to the ball at any moment is the "active" one (marked with a
white outline) — they're the only one who can take the ball, enter a
duel or shoot; the other 10 hold formation (with a slight shift toward
the ball's side) but don't block or fight yet. Each of the 11 has their
own stats, techniques, SP and cooldowns — nothing is shared between them.
Each team's keeper (the starter marked with the "GK" position) is always
the one who defends shots on goal, whether or not they're the active
player at that moment.

### Squad selection: pick 11, and see what you're bringing
- You pick **11 starters** by tapping each player in the list (a
  "Starters (X/11)" counter). The first GK-position player you add
  becomes the keeper.
- A live **"your team"** panel above the list: the 11 you've picked and
  the bench, each removable with an `×`.
- "Confirm squad" only activates once all 11 slots are filled.
- **"Use this whole team"** fixed: fills your 11 starters (keeper first
  if there's one among the filtered results) plus up to 6 on the bench,
  in one go.
- On "games show up instead of teams": still the same data limitation
  already noted (no spreadsheet has real teams), not a bug — the
  dropdown groups by source game for lack of that column.

### Substitutions with 11 on the pitch
A two-step panel: first you pick who comes off your 11, then who comes
on from the bench. Reversible (whoever comes off goes to the bench). It
now also stays correctly in sync on the client side after a change (it
used to keep the old lineup if you made more than one substitution).

## Real roster: 4986 players, with real techniques (Hissatsu)

You sent me a second spreadsheet
(`Inazuma_Eleven_VR_Document_v3_06...`), much more complete, and with
this I **fully replace** the previous roster (the 9498-player one from
the first spreadsheet) — this one is better at what mattered most:
techniques.

### Why it's better
- It has a **`Hissatsu` sheet with 687 real techniques**: name, type
  (Shoot/Offense/Defense/Keep — mapped to our shot/dribble/defense/keeper
  categories) and, crucially, **an already-computed numeric power**
  (0-100) instead of having to invent one from the cost. No more
  guessing needed.
- The `Characters` sheet lists, for each player, the first 3 techniques
  they learned — I cross-reference these by name against the Hissatsu
  table, and out of **4986 players, 4946 (99%) end up with at least one
  supertechnique** assigned (before, with the other spreadsheet, most GO
  characters ended up with none).
- It covers 8 games, not just 6: besides IE1/IE2/IE3/GO1/GO2/GO3, it
  includes **Ares no Tenbin** (`Ares`, 192 players) and the mobile game
  this spreadsheet itself comes from, **Victory Road** (`VR`, 854
  players).

### How I mapped the stats
This game uses 7 stats per player (Kick, Control, Technique, Pressure,
Physical, Agility, Intelligence) instead of the classic 7 from the DS
games, so I combined them like this:
- `speed` ← Agility
- `shotPower` ← Kick
- `dribblePower` ← average of Control and Technique
- `defensePower` ← average of Pressure and Physical
- `keeperPower` ← average of Physical and Intelligence

All these spreadsheet stats sit around 80-121 (a different scale from
the original games), so I normalize them by dividing by 95 instead of by
60/100 as before.

### Breakdown by game
IE1: 1016 · IE2: 638 · IE3: 622 · GO1: 894 · GO2: 397 · GO3: 373 ·
Ares: 192 · VR: 854.

### Remaining limitation
Each player only brings their **first 3 learned techniques** in this
spreadsheet (not the full 4), so they'll almost never have all 4
categories filled at once — one will usually be missing. There are still
no real teams (same reason as before: the column doesn't exist in either
spreadsheet), so the grouping is still by game.

## The game is now in English

Every piece of text the player sees (HUD, scoreboard, squad-selection
panel, duel/shot panel) is in English. Code comments have also been
moved to English for consistency, in case it's ever shared or pushed to
a public English-language repo.

## Limitations of this skeleton (to improve)

- **Client latency**: the client doesn't simulate its own physics, so
  its player feels slightly delayed relative to the host. Client-side
  prediction (moving instantly on your own screen and reconciling later)
  would fix this, but isn't implemented yet.
- **No anti-cheat**: the host resolves everything (possession, duels,
  shots, transfers/subs), so in theory it could manipulate its own
  client. Fine for playing with friends or prototyping; if the game gets
  genuinely competitive, this same logic needs to move to a real server
  (e.g. with [Colyseus](https://colyseus.io/)).
- **No reconnection**: if the host closes the tab, the match ends.
- **Only the 2 active players actually "fight"**: as explained above, the
  other 20 players on the pitch hold formation but don't block or enter
  duels — it's tactical set dressing, not a full team AI.
- **If the opponent joins right after the AI has already started**: the
  match starts against the AI with its default team; a human who joins
  afterward doesn't get a chance to pick their own team until the next
  match. A rare case, but noted here.
- **No technique visual effects yet**: the duel/shot logic already works
  (SP, cooldown, probability, outcome), but there's no animation or
  flash specific to each technique.
- **~1% of players with no supertechnique at all**: when none of their 3
  known techniques appears in the Hissatsu table with a valid type, they
  end up with none — they'll always get the normal-action option in any
  confrontation.
- **Still no real teams for everyone**: the selector groups by game, not
  by real team (Raimon, Occult, etc.) because the spreadsheet didn't
  carry that column.
- **`roster.json` isn't validated at build time**: if you ever replace it
  by hand and the JSON ends up malformed, the squad-selection screen will
  fail with a visible on-screen error (it's caught and shown), but
  there's no automatic check before that.

## Suggested next steps

1. Get real teams to group the selector by team instead of by game (you
   mentioned this — as soon as you have them, we'll wire it in).
2. Let the other 10 players in formation also enter duels (not just the
   active one) — this would bring the match much closer to a real 11-a-
   side game, but it's a big change over what's there now.
3. Per-technique visual effects (a color flash, a particle on the shot, a
   save animation).
4. Client-side prediction for the client (see the limitation above).
5. More advanced AI: today it's a simple set of rules; difficulty could
   vary based on the opposing player's stats, or more tactical variety
   could be added (pressing, counter-attacks...).

## Level-99 stats: new spreadsheet, more shooting mechanics

You sent me a PDF (`Inazuma_Eleven_level_99_stats.pdf`, a fan compilation
with max-level stats for thousands of characters, in three different
column formats depending on the era) so the roster could reflect those
numbers instead of the ones it already had.

### How I processed it
The PDF has no real tables (it's text with columns aligned by spaces, and
sometimes not even that: two techniques in a row end up glued together
with no space if their columns happen to line up in width). To avoid
guessing blindly:

1. I extracted the ~2841 valid rows with a parser that detects the 3
   column variants (7, 8 or 9 stats depending on the page).
2. To split each player's 4 techniques (sometimes stuck together), I
   built a dictionary out of the **526 technique names that already
   existed** in the roster (with their category — shot/dribble/defense/
   keeper — already correct) and used dictionary-based segmentation (like
   splitting words in a language with no spaces) to cut the text at the
   real names it recognized. This covered 74% of techniques directly.
3. For techniques it didn't recognize, I trained a simple classifier on
   which words predict each category from those same 526 already-labeled
   names (e.g. "hand"/"catch"/"knuckle" → keeper, "slide"/"sumo"/
   "cyclone" → defense), falling back on the player's position if no word
   was conclusive.
4. I matched each PDF row against the roster **by name**. Of the 2841
   rows, 2169 found a player (some PDF names are characters invented by
   the fan compiler, those were left out) — in total **1959 roster
   players (out of 4986) updated** with their real stats, techniques, PT
   and physical condition from this document. The rest keep what they
   already had.

### What changed for each updated player
- **Combat stats**: `shotPower` ← Kick, `dribblePower` ← average of
  Body/Control (or Dribbling/Technique in the newer format),
  `defensePower` ← Guard/Block, `keeperPower` ← Guts/Catch, all
  normalized so the average still sits around 1.0 (same criterion as the
  earlier normalizations), though the range is now a bit wider (0.3–1.8)
  because level 99 brings more genuine variety between characters.
- **4 techniques per player**, not just 1 per category: if two of their
  4 moves fall into the same category, the more powerful one is the one
  usable in a match, and the other is kept in `techniquesExtra` (visible
  in the data, not yet in the player panel) — so the data is complete
  even though combat still uses 1 active supertechnique per category, as
  in the original games.
- **PT (`maxSP`) is now a real per-player stat**, pulled from the
  document's TP column (everyone used to have a fixed 100).
- **Physical condition (`maxStamina`)**, pulled from the FP column — new,
  feeds fatigue (see below).

### Fatigue
Every player now has a physical condition that drains at a fixed rate
throughout the match (regardless of half); only the size of the tank
changes based on their FP. Below 40% of their max, speed starts dropping
gradually down to 55% once it's fully empty. A substitution is the only
way for a player to come back with fresh legs. A new indicator shows next
to PT ("STA: x%", in red when low).

### Shots lose power with distance
A shot near the box comes out at full power; from there, power drops off
gradually down to 45% past ~900px (nearly the length of the pitch). A
penalty is never affected by this (it's always taken from the penalty
spot at whatever power that real distance implies, with no artificial
cap).

### Blocking long shots
If the shot is "from distance" (more than 320px) and there's a rival
defender standing near the straight line between the shooter and the
goal (not the keeper — they're still the last line), a **block**
confrontation triggers before it reaches the keeper: the defender can
spend PT on a defense supertechnique to try to stop it outright. If the
defender wins, the ball is loose at their feet and possession changes. If
the attacker wins, the shot continues on toward the keeper, but with a
further 20% power penalty (it was already weakened by distance, and now
it's grazed a defender too) — it chains automatically into the normal
shot-vs-keeper duel, with its own VS screen.

### Known limitation
The PDF is a fan compilation with variable data quality — characters with
"special"/evolved forms (with heavily stylized technique names, roman
numerals, stray kanji...) sometimes produce a slightly mangled technique
name in the "unrecognized" data (e.g. a broken name fragment). It's a
handful of cases out of nearly 4300 active moves assigned — it doesn't
affect game balance, at most the text shown for the technique's name.

## Picking the rival too, sprint while drawing, PT/stamina on the card, and block requires a supertechnique

- **Rival team selector**: the squad editor now has two tabs, "Your
  Team" and "Rival Team". The rival one comes pre-filled at random (same
  position-aware pick as the 🎲 button) and is only used if you end up
  playing solo against the AI — if a real opponent connects, they always
  pick their own team, and whatever you set here is ignored. You can
  tweak it as much or as little as you like: any gaps you leave get
  filled automatically on confirm.
- **Sprint while drawing a path**: following a drawn path is a
  determined run, so the player now moves 35% faster (and accelerates
  faster to reach that speed) while following the line, instead of
  moving at normal pace.
- **PT and stamina on the player card**: the sheet that opens when you
  double-tap a player (in the squad editor or the in-match team panel)
  now also shows their technique points and physical condition — as
  current/total if the player is already on the pitch in an ongoing
  match, or as their maximum before kickoff.
- **Blocking a shot now requires a supertechnique**: a "normal" block
  never stops the shot — only spending PT on a defense technique can. If
  the defender has no defense technique assigned, or no PT left to pay
  for it, the block screen doesn't even show up (there's nothing to
  decide) and the shot goes straight on toward the keeper, already
  weakened by distance. When they can actually attempt it, the "normal
  action" button disappears from the panel — only their supertechnique is
  offered — to make clear it's the only real option.

## Using any repeated technique, close-range blocking, and the option to do nothing

- **All of a category's techniques are usable, not just the first one**:
  if a player has, say, two shot techniques, a button now shows up for
  each one in the confrontation panel (with its own cost), instead of
  only the one that ended up as "the" technique for that category — the
  others already lived in the data (`techniquesExtra`, see the previous
  section) but couldn't be chosen. The player sheet now also lists all of
  them, not just the first per category.
- **A block can now be attempted from any distance**, even inside the
  box — it used to require the shot to be "from distance".
- **The blocking player can decide to do nothing**: the normal-action
  button no longer disappears from the panel — it's now called "Let it
  through" and still can't stop the shot on its own (only a
  supertechnique can), but it's now a real choice instead of a hidden
  option: useful for saving PT if the player would rather not risk the
  technique at that moment.

## Sprint tied to stamina, live repositioning, lines that don't kink, player/team ratings

- **The sprint while drawing a path is no longer so extreme**, and it now
  scales with stamina: at full physical condition it gives a +18% top
  speed (it used to be +35%, too much), and that extra fades away as the
  player tires until it's completely gone at zero stamina — it's not
  just the general speed cap dropping with fatigue, the sprint boost
  itself does too.
- **Live repositioning**: in the in-match team panel, tapping two pitch
  players (instead of one on the pitch and one on the bench) swaps their
  positions — without resetting their PT or physical condition, since
  unlike a substitution, neither of them is coming on fresh from the
  bench.
- **Fixed the V-shaped-line bug**: if you tapped to draw a line without
  landing exactly on the player (or the tap found nobody nearby and fell
  back to the active player, who could be far away), the first leg of the
  line used to start from the exact point you tapped instead of from
  where the player actually was — so it would first run toward that
  point and then double back toward where you'd actually drawn. The line
  now always starts from the player's real position.
- **Self-drawn "keep running" lines are no longer lines**: when a player
  runs out of your drawn line and keeps going on their own (while the
  team has the ball), that's no longer painted as a yellow line — just a
  faint dot at the destination, so it doesn't get confused with something
  you actually drew.
- **Kickoff stays inside your own half**: at the start of the match,
  after a goal, or at half-time, each team's eleven now always line up
  inside their own half — before, the bias that pulls players toward the
  ball during normal play could leave a forward slightly past the
  halfway line even at kickoff.
- **Player and team rating**: every player now has a rating (30-99)
  computed from their 5 combat stats, visible on their sheet and on the
  player-search cards. The squad editor also shows the average rating of
  the XI you currently have built, next to the "X/11 filled" counter.

## Distinguishing duplicate players, and separating formation from the player list

- **Yes, there were duplicate players**: 157 names (349 cards in total)
  appear more than once in the roster — the same character once per game
  they appeared in (e.g. Mark Evans in IE1 and in Ares), each with their
  own stats. They were already included as separate cards, but since
  they share the same real team ("Raimon", etc.) they looked identical on
  the cards. Now, only for repeated names, the game is added in
  parentheses ("Raimon (IE1)" / "Raimon (Ares)") to tell them apart at a
  glance; every other (non-repeated) player looks the same as before.
- **Separating formation from the player list**: the squad editor used
  to have everything stacked on one long screen. Now there are two extra
  tabs ("📋 Formation" / "🔍 Browse Players") to show only the
  pitch+bench or only the search+list, without having to scroll between
  them. Works the same on the "Your Team" and "Rival Team" tabs.

## Readable player names on the pitch

The text under each player had a 3px black outline over just 7px of
text — almost as thick as the letters themselves, so it read as a black
smudge with a thin white thread through it. It's now plain white with a
soft shadow (instead of a hard outline), which gives just enough contrast
against the grass without eating into the text. Size also went from 7px
to 9px so it reads better at a glance.

## Substitutions that sometimes didn't apply

While testing the previous change I found an intermittent bug:
requesting a player substitution (or a reposition) during a match would
sometimes do nothing, with no visible error. The request was stored in a
one-shot flag the main loop cleared every frame, but it was only
processed if, at that exact instant, there was no confrontation (duel)
happening anywhere on the pitch — something that can start purely by
proximity, unrelated to the substitution. If a duel kicked off in the
very frame the change was due to apply, the request was lost forever.
Substitutions and repositions are now always processed, whatever's
happening with confrontations, so they no longer get dropped.

## Overall speed down another 5%, harder AI, and a combined squad editor

- **Speed**: it still felt too high even after the sprint adjustment, so
  I lowered the general speed cap (affects everyone equally, sprinting or
  not) by another 5% — from 0.72 to 0.684 for the player with the ball/
  active target, and from 0.66 to 0.627 for automatic off-ball movement.
- **"Expert" AI level**: a fourth level added above "Hard", following the
  same philosophy as the others (sharper decisions, not more raw speed) —
  uses supertechniques more often, shoots from further out, pulls the
  trigger almost every time it has an angle, and looks for a pass a
  little more often.
- **Squad editor: pitch and player list at the same time**: the
  "📋 Formation" / "🔍 Browse Players" tabs are no longer mutually
  exclusive — they're now two independent sections that both show by
  default, and each button only collapses its own if you need more
  screen space. With both visible at once you can now tap a player in
  the list and then tap directly on a pitch spot (or the bench) to place
  them there, occupied or not — if the spot already had someone, that
  player drops to the bench (or is dropped from the squad if the bench is
  already full). A note next to the pitch shows who you're placing and
  lets you cancel the selection.

## Player list: sorting, and a full sheet on double-tap

- **Sort**: the squad-building player list now has a sort dropdown —
  Rating (default), Name, Position, or each combat stat (Speed, Shot,
  Dribble, Defense, Keeper) from highest to lowest.
- **List cards now work just like the pitch pins**: before, tapping an
  already-signed player showed their stats instantly (a single tap), and
  tapping an unsigned one placed them directly. Now any card in the
  list — whether already in the squad or not — is selected with a tap
  (just like a pitch or bench pin), a second tap on the same card shows
  the full sheet, and tapping a different card afterward
  swaps/places accordingly. This also lets you swap two starters directly
  from the list, without having to find them on the pitch.

## Possession after a goal, and a bit more room at kickoff

- **Possession after a goal**: scoring used to hand possession to
  "nobody", claimed by whoever touched the ball first at the restart —
  it's now explicitly assigned to the team that conceded, as the real
  kickoff rule states.
- **Halfway-line spacing**: at restarts (kickoff, restart after a goal,
  second half) players can no longer end up stuck on or right against
  the halfway line — a fixed margin is added on each side.

## More real teams, from your player↔team spreadsheet

You sent me `inazuma_eleven_relacion_jugador_equipo.xlsx`: 281 rows with
Saga/Game, Team, Spanish/European Name, Japanese Name and Position,
covering IE1, IE2, IE3 and the GO trilogy. I cross-referenced it by name
against the roster (filtered by each row's game) to extend `team`/
`teamColor` coverage beyond the 976 players that already came from the
earlier manager spreadsheet.

- **Only 140 of the 281 rows found an exact name match.** The other 141
  aren't a matching failure: often it's the same character with a
  different name translation between this sheet and the loaded roster
  ("Timmy Sanders" in your sheet / "Tim Saunders" in the roster; "Johan
  Taran" / "Johan Tassman"), and other times they're disguised-character
  aliases (Occult, Wild Institute) the roster doesn't have registered
  under that name. I tried a "fuzzy" match (by text similarity) to
  rescue these cases and dropped it: it matched names that have nothing
  to do with each other purely by surface resemblance (e.g. "Harry
  Potter" with "Barry Potts"), so I'd rather leave them untouched than
  introduce a wrong data point.
- **52 of those 140 matches already had a different team** saved from the
  earlier manager spreadsheet. I reviewed them one by one: almost all
  were the same real team under a different name format (your sheet
  carries the Japanese name in parentheses: "Royal" already saved / your
  sheet's "Royal Academy (Teikoku)"; "Farm" / "Farm (Senbayama)";
  "Orpheus" / "Orfeo (Italia)"…) — in those cases I kept the existing
  name and color to avoid duplicating the squad editor's team filter.
  When it really was a different team from the storyline (e.g. several
  Raimon players in IE2 mistakenly split across teams that don't fit
  that part of the story, when they were actually kidnapped and playing
  for the "Dark Emperors"), I used the one from your sheet. I verified
  every merge by checking which players each team already had in the
  roster before unifying anything — for example, I ruled out merging
  "Inazuma Japan" with the already-existing "Nihon" after confirming
  they're two completely different squads.
- **11 new teams** that didn't exist in the roster: Chrono Storm, Diamond
  Dust, Earth Eleven, Dark Emperors, Genesis, Inazuma Japan, Prominence,
  Protocol Omega, The Lagoon, Gemini Storm and Epsilon — most are Aliea
  Academy's (IE2) sub-teams and several special teams from the GO
  trilogy. Your sheet doesn't carry colors, so I picked one myself
  (unlike the manager spreadsheet's teams, which did come with real kit
  colors).
- **13 GO-trilogy players appear under more than one team** in your sheet
  (e.g. Arion Sherwind plays for both "Raimon GO" and, later in the
  story, the special team "Chrono Storm"). Since each roster card only
  supports one team, the original card keeps the first one your sheet
  mentions (their base/recognizable team) and I create a **new card** for
  each additional team — same stats and techniques, a different `id`,
  the other team — so now they're selectable under both (or all three)
  teams at once, instead of losing the rest. This produced 8 new cards.
- Every team name stored is in English (or its romanized Japanese name,
  which is how the teams from the manager spreadsheet were already
  stored) — when I use a Spanish name from your sheet here or in chat
  (e.g. "Génesis", "Instituto Zeus") it's only to make clear which row of
  your spreadsheet I mean; the stored data always uses the English name
  ("Genesis", "Zeus").

Result: the roster goes from 4986 to **4994 players** (the 8 new cards
above) and **1056 of them now have a real team**, across **58 teams** in
total (up from 976 of 4986, 49 teams).

## Team filter by era, and the real limit of "Use whole team"

While testing the squad editor with these new teams, you noticed "Zeus"
only offers 5 players to fill 11 — that's not a bug, it's the real limit
of how many players from that specific team are in the database (4 from
IE1 + 1 from IE3): neither your sheet nor the manager spreadsheet brings
the rest of each school's background roster, so "Use whole team" still
can't complete an XI for almost any team — this was already flagged
above, but it's worth repeating here since you just ran into it with a
concrete example.

What I did change: **most real teams (45 of 58) appear across several
games at once** — Raimon, for instance, has players in IE1, IE2, IE3,
GO1, GO2, GO3 and Ares, with completely different squads in each. Before,
picking "Raimon" in the filter mixed all 75 players from every era into
one bag. Now, a team that only appears in one game still shows the same
way (a single option), but one that repeats across several is grouped in
the dropdown under its name, with an "All eras" option (the old
behaviour) plus one per specific era ("IE1 (23)", "GO1 (19)"...) — so you
can ask for just IE1's Raimon instead of the seven-era mix.

## Elements (with an edge in confrontations), and position at a glance

### What came out of the "Ultimate Database" PDF
You sent me `Copy_of_Inazuma_Eleven_Ultimate_Database_Shared_2.pdf` (66
pages, exported from a spreadsheet) to see if it could help fill in
players. It has six distinct sections: the IE1/IE2/IE3 databases (name,
nickname, position, gender, size, **element**, level-1 and level-99
stats, techniques, HEX ID), one for the GO era with Keshin, another with
Japanese names + romanization, and a Spanish one for GO Galaxy with a
"Fichatron" column (where each player signs).

Extracting it had a trick to it: the IE1-IE3 sections draw **every letter
as its own "word"**, so column-based extraction destroys them ("Mark
Evans" comes out as "MEvaarkn s"). For those I pulled from the flat,
reading-order text, where the format is rigid enough to anchor on the
`POS Gender Size Element` sequence to recover each row. The GO sections
extract fine by columns.

What it does **not** add: techniques were already complete (only 4 out
of 4994 players had none), so there was no gap to fill there.

What it **does** add:
- **Element for 3584 of 4994 players** (72%). IE1/IE2/IE3 end up nearly
  complete (1015/1016, 637/639, 621/622) and GO1 almost entirely
  (798/900). The ~1400 still without an element are mostly the ones
  tagged "VR". As a sanity check that the name-matching is correct, the
  **position** the PDF carries matches the roster's in 3661 of 3680
  compared cases (99.5%).
- **A team for 92 more players** (1064 → 1156). The Galaxy section's
  "Fichatron" column carries the team in parentheses (稲妻町 with no
  parentheses is a place, not a team, so only the ones in parentheses are
  used). They're in Japanese, so I only merged the ones I could back up:
  either the roster already tags some of its players with that English
  name, or your earlier spreadsheet already spelled out that same
  Japanese name ("Royal Academy (Teikoku)" for 帝国, "Kirkwood (Kidokawa
  Seishuu)" for 木戸川清修). About ~88 more team names remain in that
  column that the roster doesn't have yet and would need naming in
  English — still pending a decision.
- As a side effect, this partly fixes the issue you saw with Zeus: for
  example **Protocol Omega goes from 4 to 31 players**, and teams able to
  field a full XI (with a keeper) go from 42 to 44.

### Elements with a combat edge
The four elements work in a cycle, as in the games: **Fire → Wood → Air
→ Earth → Fire**, each with an edge over the next (Air is what later
games call Wind/Water, and Earth what they call Electric). When both
players in a confrontation have a known element and one has the edge,
their power is multiplied by **1.15** — a nudge, not a win button: it
turns a 50/50 even confrontation into a 53% win rate, so a good technique
or better stats still decide most of them.

It shows up in two places: the choice panel now shows "🔥 Fire vs 🌿 Wood
▲ advantage" (so you can decide whether spending PT is worth it), and on
the duel-reveal VS cards, with the edge marked in green — so an unusual
result reads as "they had the element" rather than luck.

### Position at a glance
Position already showed on the list cards, but buried in small text, and
it didn't show at all on the pitch pins. There's now a **color badge**
(GK yellow, DF blue, MF green, FW orange) in the corner of every pitch
and bench pin — both in the squad editor and in the in-match team panel —
plus at the start of every card and sheet. On pitch pins, if the player
is standing in a slot that calls for a different position, the badge is
marked red: so a keeper played at center-back is visible at a glance
instead of having to open sheets one by one. Cards and sheets also show
the element now.

### Rating, on the icon too
Every pitch and bench pin now carries the **player's rating** in the
corner opposite the position badge, banded by strength (gold ≥85, silver
≥70, bronze below) so a lineup's weak spots stand out without reading
every number.

## The match pauses when you open "Team", and the panel no longer closes itself

Two fair complaints about the in-match team panel: the match kept
running while you decided, and as soon as you made **one** change the
panel would slam shut, so making two changes meant opening it twice.

- **Pause**: opening "Team" freezes the simulation — Matter stops
  stepping, the clock stops, and `_hostUpdate` skips play. What still
  gets applied are changes made from the panel itself, since those are
  one-shot requests the loop clears every frame regardless (otherwise a
  change made while paused would be lost). On resume, **every absolute
  deadline gets shifted forward** by however long it was paused (the
  confrontation timer, stuns, the result banner), so nothing silently
  expires while you're looking at the bench: verified that a duel
  showing 19.2s still shows 19.4s after a 4s pause, instead of resolving
  itself.
- **Solo only.** With a real opponent connected, it can't pause — that
  would freeze their match too. In that case the panel still opens and
  says so ("▶ Match still running — your opponent is connected"), while
  solo it says "⏸ Match paused".
- **The panel stays open** after a change or a reposition, and
  **refreshes itself** once the substitution actually lands (which
  happens a frame or two later, or over the network if you're the
  client) — it compares a cheap lineup signature and only repaints if it
  changed, not every frame. It closes with its own "Close panel" button,
  which is also where the match resumes.

## Saved squads, duplicate cards removed, and the rest of the Japanese teams

### Saving your squad
Picking an XI out of ~5000 players was work that got thrown away every
time you closed the tab. The editor now has **💾 Save squad / 📂 Load
saved**: it saves your XI, bench and formation to `localStorage` (that
browser only), storing **only ids** — on load they're resolved against
the roster, so if a player is no longer in the data that slot is skipped
and you're notified instead of it breaking. The load button shows how
many you saved ("📂 Load saved (11/11)") and is disabled if nothing's
saved.

### 46 duplicate cards removed
The roster carried repeated characters with **the same game, team, stats
and techniques** ("Arion Sherwind" twice in GO1, "Vladimir Blade" three
times), which showed up as identical cards in the search. Only one of
each survives: 4994 → **4948 cards**. The deliberate clones (the same
player on two different teams) are told apart by the `team` field, so
they survive.

### The rest of the PDF's team column
The ~88 Japanese team names left untouched turned out to be two
different things. **Many were abbreviations of teams we already had** —
(オルフェウス) Orpheus, (Lギガント) Little Gigantes, (Bウェイブス)/(大海原)
Big Waves, (FF帝国) Teikoku → Royal, (白恋) Hakuren → Alpine — and those
reuse the existing name and color instead of filling the filter with
near-duplicates. The rest are genuinely new teams: the katakana ones are
transliterated back (ドラゴンリンク → Dragon Link, デストラクチャーズ →
Destructors) and the kanji school names are romanized (白鹿組 →
Hakushika, 聖堂山 → Seidouzan), which is faithful even if it's not always
the dub's exact wording. Where I had no way to know, I kept the sheet's
own abbreviation (S Wolf, M Tiger) rather than inventing a name.

Result: **1544 players with a team** (up from 1156), **101 teams**, and
the ones able to field a full XI with a keeper go from 44 to **64**. If
any of the names I translated isn't what the dub actually uses, changing
it is a single line in the mapping table.

## The AI difficulty ladder, raised a whole step

You told me "easy" could already be the hard setting, and that the hard
ones needed to be harder still — for example by inflating the
opponent's stats. Both things:

- **The whole ladder moves up**: the old *Hard* (supertechnique 70% of
  the time, shoots from 420) is now **Easy**, and everything above it is
  new ground. *Expert* now uses a supertechnique 97% of the time and
  shoots from 620.
- **Stat inflation** from Normal up, since sharpening decisions alone
  runs out of road once the AI is already taking every chance it gets:
  **Normal +8%, Hard +18%, Expert +30%** to the AI team's combat stats,
  with **half of that bonus applied to movement** (so it's tougher
  one-on-one, not just faster than you).

The multiplier is applied **live, never touching the stored data**: it
only affects side B, and only while nobody is connected to play it, so
switching level or having a human opponent join leaves the roster's
numbers untouched — cards keep showing the real ones.

Verified with two intentionally equal players, both choosing the normal
action: the human's duel win rate drops **55.1% → 53.2% → 51.0% →
48.6%** from Easy to Expert, exactly what the formula predicts (4000
duels per level).

## Proper kickoffs, and a pass into the net is no longer a goal

### The side not kicking off starts further back
Both lines used to stay glued to the halfway line (28px on each side),
so whoever kicked off got closed down before they could play the first
pass. Now the side **without** the ball starts **150px** back — well
clear of the center circle, which has a 60px radius — while the kicking
side stays close to it. The kickoff is properly set up: possession for
whoever's kicking off, an outfield player (never the keeper) standing
over the ball at the center spot, and everyone else lined up in
formation in their own half.

### Each half is kicked off by a different team
The match and the second half used to start with the ball loose at the
center, and whoever got there first won it. There's now a coin toss at
kickoff (`kickoffRole`), and **the other team kicks off the second
half**, as in a real match. Announced with a banner: *"Kick-off"* and
*"Second half"*.

### A pass that goes into the net is no longer a goal
Real goals are always decided by the shot confrontation, which resolves
abstractly and **never physically sends the ball in**. So anything that
reached the goal sensors was a stray pass or a loose ball — and it still
counted as a goal. The most annoying case was a chipped pass, which only
collides with the goal while airborne. The keeper now simply collects it
(goal kick, *"Keeper collects it"* banner) and play continues.

## Random with club players only

New **"🎲 Random (club players)"** button next to the usual random one,
which draws the XI only from the **1544 players with a real team**
instead of the roster's full 4948. These are the ones the original
spreadsheet actually covers, and it shows: the top 10% averages **79
instead of 71**, they carry more techniques (**1.15 extra per player vs.
0.44**), and each one's best technique hits harder (**89.7 vs. 85.8**).
The button acts on whichever tab is currently open, so you can also use
it to build the AI a decent rival. The regular random button is
unchanged.

## New style: retro pixel art (nes.css)

The interface (scoreboard, buttons, panels, chips) had that generic
"made with AI" look — translucent black boxes, rounded corners, default
typography. It now uses **nes.css** (the real library, installed via
npm, not an imitation) with two retro fonts layered on top:

- **Press Start 2P** only on headlines — it's an 8-bit typeface that
  becomes unreadable below ~11px, so reserving it for large text is what
  makes it work.
- **Pixelify Sans** for everything else — buttons, player names, chips —
  a font with pixel-art character that's still designed to stay readable
  at normal UI sizes.
- **Jersey 10** only on the scoreboard (match and full-time screen) — a
  sports-scoreboard numeral typeface, which suits a "0 - 0" better than
  either of the other two.

(I originally used VT323 instead of Pixelify Sans/Jersey 10 — a retro
terminal font, not a genuine pixel-art one. The
[daisyUI trends page on the pixel-art style](https://trends.daisyui.com/trend/pixel-art/)
points to exactly those three typefaces as the right fit for this style,
so it was changed.)

Every button/panel shares the same pixel-corner-cut technique (a tiny
repeating `border-image`, the same one nes.css uses) and a colored inset
shadow acting as a bevel, so the whole page reads as one system — from
the static buttons in the HTML to the ones `GameScene.js` generates at
runtime (player pins, position/rating chips, search-list cards) — without
touching a single line of game logic: the change is entirely CSS.

One real nes.css quirk that's worth flagging: the library ships its own
global rule, `body,pre,code,kbd,samp{font-family:"Press Start 2P"}` — it
assumes you'll load that font for the whole page. Since it loads after
`index.html`'s own `<style>` (Vite injects it at runtime), it won the
specificity tie and was eating our base font and text color. Fixed by
pinning the base font/color/background with `!important` — a deliberate
choice, not a patch, to plant the project's baseline above a third-party
library's global reset.

## Real nes.css buttons, legible cost text, pagination, and less text

Four adjustments from direct feedback looking at the interface on
mobile:

- **Buttons now genuinely use the library's `nes-btn`/`is-primary`/
  `is-success`/`is-warning`/`is-error` classes**, instead of the
  hand-rolled copy that was there before. That copy was missing
  `border-image-outset` (nes.css had it, mine didn't), and on some
  renders that let a solid black edge show through under the pixel
  corner — the "black line inside the button" that looked wrong. Using
  the library's real classes, instead of reinventing them, removes the
  problem at the root. Native buttons with the `disabled` attribute
  (the form ones, not nes.css's own `is-disabled`) get their own
  compatibility rule so they look equally grayed out.

- **The technique cost in PT** used to show in yellow — the same yellow
  as the accent color — on buttons that are now white by default (only
  turning blue once selected), so it was invisible. It's now dark grey
  on white, and only turns gold once the button is selected (blue
  background), where it does contrast.

- **Pagination in the player list.** It used to just cut off at the
  first 120 results with no way to reach anything past that. It's now
  30 per page with Prev/Next buttons; searching, filtering or changing
  the sort order takes you back to page 1 (otherwise a search that
  narrowed the results could leave you stranded on an empty page with no
  clue why).

- **The AI difficulty dropdown** now just says "Easy / Normal / Hard /
  Expert" — the detail of how much each stat goes up still lives in the
  paragraph below it, no need to repeat it in every option.

## Blue marker on pass, and the "line doesn't draw" investigation

**Tapping to pass now leaves a marker.** A blue ring that fades out over
400ms right where you tapped — before, the ball just set off with no
visual confirmation of where the tap had registered.

**On "the player's line doesn't draw, only the final dot shows up":** I
investigated this thoroughly (real drags simulated with Playwright,
checking the point array, the player's physical position and the
`confrontation` state frame by frame) and the draw/follow-a-line system
itself works fine. What I did find, very consistently in testing: **any
duel anywhere on the pitch freezes all 22 players' movement until it
resolves** (on purpose — it's always worked this way, nothing new). With
players constantly moving, especially right after a kickoff, a duel
between two other players triggers very often — and if you're dragging
right when that happens, your line gets drawn but your player doesn't
move until the duel ends, which can read exactly like "it did nothing".
If this keeps happening to you without a "Duel!" banner showing on
screen, it's probably something else — let me know with that detail and
I'll keep looking.

## The "line doesn't draw" bug — actually found

With more detail from you ("it happens after finishing a line,
especially going forward, and going backward it doesn't fail"), I found
the real cause: a race condition in `_computeTargets`.

A short, fast drag that starts right where the player already is
(typical when continuing in the same direction right after finishing the
previous line, since they're still moving that way) can add a point that
falls within `WAYPOINT_RADIUS` of their current position. That point
would get consumed in the very same frame it was drawn — and since the
player still had the ball, the game instantly read it as "the line's
done, keep running on your own", which is exactly the single-dot,
no-line marker. In other words: your new line was being silently
replaced by the "keep running" dot while you were still drawing it.
Going backward rarely triggered it because it implies a longer drag,
which doesn't fit entirely inside that radius.

Fixed: while the player being dragged is still the same one
(`this.drawing && this.selectedPlayerId===e.id`), a line that reaches
zero points no longer auto-upgrades to "keep running" — it just waits
for the next point the ongoing drag adds. Genuine "keep running" (when
you release and the player runs on their own to the end of a line while
still holding the ball) still works exactly as before; I verified this
by forcing the exact race step by step, and separately confirming that
normal case doesn't break.

## Six more formations

From the original 4 (4-4-2, 4-3-3, 4-2-3-1, 3-5-2) to **10**: adding
**4-5-1**, **5-3-2**, **3-4-3**, **4-1-4-1** (holding midfielder + a
banked line of four), **5-4-1** and **4-3-1-2** (a diamond with a
support striker). The Team panel's "Formation" button and the editor's
dropdown pick these up on their own — both read the formation list
instead of having it hardcoded — so nothing else needed to change for
them to show up there.

Each one is 11 coordinates (keeper + defender/midfielder/forward lines)
within the same range the original 4 already used, plus a parallel array
assigning each slot a role (GK/DF/MF/FW) for the rest of the game — the
matching between a "formation slot" and a "real player" doesn't
distinguish a defensive midfielder from an attacking one, so the pivot
in 4-1-4-1 and the support striker in 4-3-1-2 are still plain MF; what
changes from one formation to another is the shape on the pitch, not
that role.

## A real pause at half-time, and a gentler Normal

**The switch to the second half is no longer instant.** When the first
half hits 0:00, both teams line up for the second-half kickoff (whoever
didn't start the first one now kicks off), a **"Half time"** banner
shows, and the match **genuinely freezes** for 3 seconds (physics
stopped, clock held) before kicking off on its own — the half used to
switch instantly, with the kickoff already under way. The banner clears
exactly when play resumes, not a while after: `_setPaused` extends every
active deadline (the duel timer, stuns...) by exactly the length of the
pause, so nothing silently expires while the game is frozen — and
without accounting for that here, it would have made the half-time
banner linger for an extra 3 seconds on top, with the match already
running again.

**Normal difficulty, relaxed.** Only that level was touched (Easy/Hard/
Expert stay the same):

| | before | now |
|---|---|---|
| uses a supertechnique | 80% | 75% |
| shoots from | 470 | 445 |
| shot chance | 80% | 75% |
| pass chance | 2.7% | 2.4% |
| stat inflation | +8% | +4% |

Still a clear step above Easy (which has no inflation at all) and well
below Hard (+18%) — just a gentler step up from Easy now.

## Shorter goals

The net box drawn behind each goal line was 150px deep, which read as
very tall relative to the rest of the pitch. Cut to 90px (about 40%
shorter) — purely visual: the tap-to-shoot hitbox and the goal sensors
are both sized independently of it, so shooting and scoring are
unaffected.

## An actual test suite

All the manual verification done throughout this project — clicking
through the game with Playwright to confirm each fix and feature — is
now a permanent suite instead of throwaway scripts. Run it with `npm
test`.

- `playwright.config.js` boots the real dev server and runs everything
  in a plain desktop-shaped Chromium window. Deliberately **not** one of
  Playwright's mobile device presets (`devices['Pixel 7']` etc.) — those
  set `isMobile`/`hasTouch`, which changes how Chromium dispatches
  `page.mouse.*` calls into touch-style events instead of plain mouse
  ones, breaking every drag-simulation test.
- `src/main.js` exposes `window.__scene` (the live `GameScene`), but only
  behind `import.meta.env.DEV` — Vite inlines that to `false` and
  dead-code-eliminates the whole block for `vite build`, so none of it
  ships to players.
- `tests/kickoff.spec.js` — kickoff shape (defending side starts back,
  the taker is never the keeper), the second half's kickoff swapping
  sides, the half-time pause actually freezing physics and clearing its
  own banner on resume, and the goal-sensor logic (a stray ball into the
  net is the keeper collecting it, not a goal; a real shot confrontation
  still scores).
- `tests/drag-and-pass.spec.js` — a real mouse drag producing a
  multi-point path that survives while still held; a direct regression
  test for the auto-continue race condition described above (reproduces
  the exact mid-drag race by manipulating scene state directly, since
  it's a one-tick timing window no real drag can reliably hit); and the
  tap-to-pass marker appearing and fading out on its own.
- `tests/squad-editor.spec.js` — the club-only randomizer only drawing
  players with a real team, the plain randomizer working over the whole
  roster, player-list pagination (including the reset to page 1 on a new
  search), all ten formations placing exactly 11 pins, and each
  Formation/Browse Players collapse toggle only affecting its own
  section.
- `tests/difficulty.spec.js` — AI stat inflation only ever applying to
  side B and only while nobody's connected to play it, the difficulty
  ladder driving `aiLevel` correctly, and the dropdown showing just the
  plain level names.

A couple of these needed real care to make non-flaky under a loaded
headless browser: reading two related bits of live state (a timer
deadline and "now", or a banner's title and the possession it hands
over) has to happen inside a *single* `page.evaluate`/`waitForFunction`
call — round-tripping between two separate calls leaves a real-time gap
where the match keeps simulating underneath you, which is long enough
for the AI to have already reacted (thrown a pass, moved possession
on) before your second call reads it.

## Fixed: two real players saw completely different matches

Root cause: which side you play (host/'A' vs client/'B') was decided
**once**, synchronously, the instant the scene was created — by comparing
your id against the opponent's. But at that exact moment the WebRTC
handshake hasn't happened yet, so neither browser knows the other exists.
Both independently conclude "I'm alone in the room" and both provisionally
become host. That default is right for solo play (no opponent ever
shows up), but when two people actually open the same room link, both
sides silently keep the stale 'A' verdict for the rest of the session —
so both simulate their own physics as the host, both think they're
controlling the same team, and the two screens diverge into two separate
games from the first kickoff.

Fixed by re-running that comparison once a peer is actually known
(`net.onPeerConnect`, fired right after the real handshake completes),
via a new `_syncRoleFromNet()` that's a no-op once the match has already
kicked off — role still has to stay fixed for a match's whole duration,
it just can no longer be settled on a guess made before the two players
were even talking to each other. Covered by
`tests/networking.spec.js` (a real cross-browser WebRTC handshake isn't
practical to drive from this sandbox, so it exercises the exact fixed
codepath directly: role flips once a peer is detected, and freezes once
`matchStarted` is true).

## Fixed: empty bench spots weren't clickable

Occupied bench pins had a click listener wired up; the empty placeholder
pins never did, so tapping an empty bench slot before it had ever held a
player did nothing — you had to fill a slot some other way first. All
five bench spots now share a `{type:'bench', id:null}` selection (they're
interchangeable, so there's no per-slot id to distinguish them by) and
get the same click handler as occupied ones. Covered by a new
`tests/squad-editor.spec.js` regression test.

## Filled in ~3,400 missing team affiliations, added 161 new teams

`roster.json` had 3,404 players (out of 4,948) with no `team` set at
all — mostly characters who never made it into the
`Inazuma_Eleven_Manager_2026.xlsx` sheets above. The
[`AlejandroSuarezCampos/InazumaElevenAPI`](https://github.com/AlejandroSuarezCampos/InazumaElevenAPI)
project's own source, `zukan.inazuma.jp` (the franchise's official
character database), lists a team for essentially every character —
but that domain is blocked by this sandbox's network egress policy, for
both `curl` and `WebFetch` alike. So the scrape had to happen outside
this environment: I wrote a small scraper (reading the site's own table
header row to find the "Team" column by name, rather than hardcoding an
index the way the API repo's own scraper does — which is why that repo's
JSON has no team field despite the site having the data) and handed it
back as a Colab notebook to run.

Two data-quality issues turned up in what came back:
- The site's team cell holds one badge per team a character has
  played for across the series, and stripping the cell's text with no
  separator ran them together (`"RaimonInazuma National"`,
  `"ProminenceChaos"`, even three- and four-team runs for
  long-running characters). Split back apart with a
  camelCase/digit-boundary regex
  (`(?<=[a-z0-9])(?=[A-Z])`) rather than re-scraping, since the
  concatenation was a fixed, mechanical join and reversible as such.
- Only intentionally scraped `{id, name, team}` — not the site's
  "Description" column, which is the site's own written character
  blurbs (creative text); bulk-copying thousands of those would be a
  different matter entirely from copying team names, which are just
  facts.

The cleaned team names were matched against this project's existing
49-team `teams.json` (exact and fuzzy name matching); 161 were
genuinely new and got added, each with a deterministically-generated
placeholder color (MD5 hash of the team name → HSL hue → hex) rather
than a guessed "real" kit color, since no official color source was
available for them. Result: 4,948/4,948 players now have a team.
Verified against the full Playwright suite (42/42 passing, no
regressions).

## Added 179 players the roster was missing entirely

Comparing our roster's names against `InazumaElevenAPI`'s character
list (see above) turned up 179 real, playable characters — not staff,
coordinators or managers — that never made it into this project at
all (`Zak Wallside`, `Gregory Smith`, `Stewart Vanguard`, and 176
others). Added them using the same stat-conversion formula this
project already uses everywhere else (documented further up this
file): `speed ← Agility`, `shotPower ← Kick`, `dribblePower ←
avg(Control, Technique)`, `defensePower ← avg(Pressure, Physical)`,
`keeperPower ← avg(Physical, Intelligence)`, each scaled by the same
~0.0105 factor — verified against the 4,948 players already in the
roster (matching every one of them to the API by name gives a median
ratio of 0.0105 for all five stats independently, so this isn't a
guessed constant).

Team assignment reused the team-affiliation data already scraped for
the previous entry: 162 of the 179 matched by character id directly,
the other 17 (accented names, a couple of romanization mismatches) by
normalized-name lookup. One genuinely new team turned up in the
process (`Star-Spangled Unicorns`) and got the same
deterministically-generated placeholder color as the 161 added
earlier.

What these 179 don't have, because the API simply doesn't carry it:
real Hissatsu techniques, or a per-player PT/physical-condition
figure. Rather than fabricate technique names or invent numbers,
`techniques` is left all-`null` (same as a handful of other entries
already in the roster) and `maxSP`/`maxStamina` default to 100/150 —
this project's existing fallback for players outside the core
game-by-game data (`game: "VR"`, used already by ~850 other entries).
Verified against the full Playwright suite (40/42 passing — the 2
failures are pre-existing timing-sensitive flakes in
`drag-and-pass.spec.js`/`kickoff.spec.js`, unrelated to roster data,
and pass cleanly in isolation).

## Recomputed every player's combat stats straight from the official source

This project's combat stats were originally derived from
`Inazuma_Eleven_Manager_2026.xlsx`, a fan-made spreadsheet compilation
that needed a fair amount of heuristic reconstruction to use (see
"Real teams — finally" and "Real roster: 4986 players" above:
structural-anchor row detection, a trained classifier for glued-together
technique names, and so on). `InazumaElevenAPI`'s numbers, by contrast,
come straight from `zukan.inazuma.jp` — the games' own official
character database — with no reconstruction step in between. Since
both sources ultimately trace back to the same in-game stats, and the
API's path to them is shorter and cleaner, recomputed every player's 5
combat stats directly from the API's raw 7-stat numbers instead of
keeping the Excel-derived ones.

First re-verified the conversion formula itself, more rigorously than
the original check: restricting to the 5,020 roster players whose name
matches exactly one stats entry in the API (no ambiguity possible),
the actual ratio between our stored stat and the matching raw stat has
a **median of precisely 0.0105 independently for all 5 stats**, with
the spread (std. dev. ~0.0012-0.0016) fully explained by this
project's own 2-3 decimal rounding — not by the two sources
disagreeing. So the formula documented above (`speed ← Agility`,
`shotPower ← Kick`, `dribblePower ← avg(Control,Technique)`,
`defensePower ← avg(Pressure,Physical)`, `keeperPower ←
avg(Physical,Intelligence)`, × 0.0105) was already exactly right —
this is a re-derivation from a cleaner source, not a formula change.

The one real wrinkle: 199 character names have more than one roster
entry (one per game/era they appeared in — Mark Evans in `IE1` and
`Ares`, for instance), and the API can likewise list several stat
blocks under the same name. For 147 of those names every API entry
under that name has identical stats, so which one gets used doesn't
matter. For the other 52 (`Mark Evans`, `Axel Blaze`, `David Samford`,
...) the stat blocks genuinely differ between entries, so each roster
entry needed pairing with the *right* one:
- First tried matching by team: cross-referencing each API entry's
  scraped team list (from the earlier team-affiliation merge) against
  the specific game-version's already-assigned `team` — 66 entries
  resolved this way.
- The rest (41 entries) had no team overlap to go on, so were paired
  by rank instead: sorting that name's roster entries by their
  existing stat average and the API's stat blocks by their raw stat
  average, and matching lowest-to-lowest, highest-to-highest — keeping
  each era's relative characterization (weaker/stronger version) even
  without a definitive source for which numeric block belongs to which
  game.

Net effect: precision improved (3 decimal places throughout, versus a
mix of 2 and 3 before) and a good number of previously-identical
across-game duplicates (like `David Samford`'s stats being byte-for-byte
the same in `IE1`/`IE2`/`Ares`) are now properly differentiated using
each era's real numbers. Nothing else on any player record changed —
techniques, team, PT, stamina all untouched. Verified against the full
Playwright suite (41/42 passing, the one failure being the same
pre-existing `drag-and-pass.spec.js` flake noted above, unrelated to
roster data and passing cleanly on its own).

## Stat displays now show real numbers, not the internal multiplier

The 5 combat stats are stored pre-scaled by that same ~0.0105 factor
so they plug directly into the physics/AI code (a speed multiplier,
a shot-power factor) without any conversion at match time — they're
meant to average around 1.0. But the player-info panel and the
squad-browsing pick cards were printing that raw stored value straight
to the screen (`⚡ Shot 0.94`, `SPD 1.17`), which reads as an arbitrary
decimal rather than a stat. Added `_displayStat()` — undoes the same
scale factor (`v / 0.0105`) purely for these two display spots — so
they now show numbers in the games' own stat range instead (`⚡ Shot
90`, `SPD 111`). Nothing gameplay-facing changed: the stored data and
the physics code that reads it are untouched, this only affects what
gets printed on screen.

## "Use whole team" → "Select from here", and a real top-players filter

Two small squad-builder changes:
- **"Use whole team" renamed to "Select from here"** — it never filled
  from a whole *team* specifically, just whatever the current
  team/game filter narrows the browse list down to, so the old name
  was misleading about what it actually does.
- **"Random (club players)" is now "Random (top players)"**, and
  actually does something different. It used to draw only from players
  with a `team` set — back when 3,404 players had none at all (see
  "Filled in ~3,400 missing team affiliations" above), that was a
  meaningful filter for "the recognisable ones". Now that every player
  has a team, that filter matched the entire roster and did nothing.

  Swapped it for an actual quality filter: each position (GK/DF/MF/FW)
  is now ranked separately by rating and only its top 20% enter the
  pool (`_topPercentileByPosition`), so the button draws a genuinely
  stronger, more competitive XI while still guaranteeing a fillable
  spread across every position — a global top-20% cut could easily
  have skewed toward whichever position happens to rate marginally
  higher on average instead.

  One wrinkle surfaced building this: the *displayed*, rounded
  `_playerRating` (30-99 scale) turned out to only really span **68-73**
  across the entire 5,127-player roster, because the official stat data
  recomputed a few commits back conserves a near-fixed total per
  character (a built-in game-balance choice — see "Recomputed every
  player's combat stats" above) — rounding to the nearest integer
  collapses almost everyone into the same 2-3 values. The percentile
  filter above sorts by the *unrounded* rating (`_ratingRaw`) instead,
  which still orders players meaningfully even though most of them
  would print identically if rounded.

  That same rounding also broke the pitch pins' bronze/silver/gold
  rating badge: its old thresholds (85+/70+/<70) assumed a much wider
  spread than actually exists now, so gold had become unreachable and
  nearly the entire roster landed in the same silver-or-bronze split.
  Recalibrated against the real distribution — 71+ (the rare top ~6%)
  is gold, 70 (~20%) silver, 68-69 (~74%, the common case) bronze — so
  all three bands are reachable and meaningful again.

Verified against the full Playwright suite (42/42 passing) — updated
the existing "club players" regression test to check pool membership
against `_topPercentileByPosition` instead of the now-meaningless
"has a team" condition.

## Supertechniques now show their category in the player-info panel

The panel's "Supertechniques" list just showed names and PT cost
("Gigaton Head — 24 PT"), with no way to tell from that list alone
whether a move was a shot, dribble, defense or keeper technique. Each
line now leads with the same icon the stat grid above it already uses
for that category (⚡ shot, 💨 dribble, 🛡 defense, 🧤 keeper —
`TECH_CAT_ICON`), so it reads at a glance instead of requiring you to
already know the move by name.

## Mid-match team panel can now peek at the rival's formation, read-only

The in-match "Team" panel only ever showed your own squad — no way to
check what the rival was actually lined up as without guessing from
their pitch positions. Added the same "Your Team" / "Rival Team" tab
pattern the pre-match squad editor already uses (`_setSubPanelSide`),
but view-only on the rival side, on purpose:
- Formation preset buttons are hidden entirely rather than shown
  disabled — they change *your* formation, which has no meaning (and
  isn't yours to change) while looking at the rival's side.
- Tapping a rival pin just opens their read-only stat card, instead of
  arming the usual tap-to-select-then-swap flow — that flow builds a
  cross-team pairing otherwise (a rival pin plus one of your own would
  read as "sub my player for theirs"), which was never a real
  substitution the game supports.
- The panel's status line switches from "Match paused — make as many
  changes..." to "Viewing the rival's formation — read-only" so it's
  clear at a glance which mode you're in.

Purely local UI state (`subPanelSide`, reset to "Your Team" every time
the panel opens) — never networked, since a real opponent's team is
already fully known to both clients locally (it has to be, to render
their players on the pitch at all) and each side peeking at it doesn't
need to affect the other player's screen.

## Fixed a real offside false-positive, restored lost speed, fixed AI bunching

Three separate reports, three separate bugs:

**Offside false positives** — `_offsideLineDist` excluded the goalkeeper
entirely from its list of defenders before picking the second-deepest
one as "the second-last defender". That's wrong: the keeper is normally
the actual *last* defender, so excluding them shifts the reference
point to what's really the *third*-last defender — one player further
forward than it should be. A receiver standing between the true
second-last defender and that miscounted one would get flagged even
though they're onside by the real rule (nearer to goal than the ball or
the second-last opponent, keeper included). Fixed by counting the
keeper in the distance list like everyone else. Covered by a new
regression test that reproduces the exact scenario (keeper deep in
goal, receiver sitting behind the real second-last defender but ahead
of a further-back third one).

**Speed felt off since the stats recompute** — recomputing every
player's stats straight from `InazumaElevenAPI` (see that entry
further up) dropped the average `speed` stat specifically by ~5%
(0.956 → 0.911), more than the other four stats moved. `speed` maps
1:1 from the raw Agility stat rather than averaging two raw stats like
the others, so it took the recompute's own noise more directly, and
speed feeds straight into both the steering force and the velocity cap
every player moves at — so the whole match quietly got slower without
anyone asking for that. Nudged `BASE_MAX_SPEED`/`AUTO_MAX_SPEED` back
up by the same ~5% (this project's existing lever for this exact kind
of global pace adjustment — see "Overall speed down another 5%"
earlier) to compensate.

**AI players bunching up in the middle when passing** — `_offBallTarget`'s
"offer a supporting run" logic sent every off-ball teammate on the same
side of the ball carrier to the *exact same point*
(`carrier.x ± 130, carrier.y + 130`), regardless of which player it
was computing for. With a blend weight of 0.65 toward that shared
point, most of a side's outfield players collapsed onto one of just two
spots instead of spreading across the pitch — visible as the whole team
clumping together whenever they had the ball. Fixed by anchoring the
support spot on each player's *own* formation position and nudging it
toward the ball side, instead of snapping to a carrier-relative point
shared by everyone: a quick check confirmed 9 outfield players landed
on 9 distinct spots after the fix, versus 2 shared points before it.

Verified against the full Playwright suite (44/45 passing — the one
failure is the pre-existing `drag-and-pass.spec.js` timing flake noted
several times above, unrelated to any of this, and passes cleanly on
repeat).

## Formation/Browse Players side by side, a WASD d-pad on PC, and less AI bunching

**Formation and Browse Players sit side by side on a wide screen now**
Building a squad meant scrolling down past the whole pitch to reach the
player list, picking someone, then scrolling back up to see where they
landed — the two sections stacked vertically even though both were
already shown by default. Wrapped both in `#squad-columns`, which lays
them out side by side above a 900px viewport (each still independently
collapsible, same as before) and leaves them stacked exactly as before
on anything narrower. The pitch column is narrower on the wide layout
(380px — its 2:3 aspect ratio makes it tall, so less width keeps it a
reasonable height) and the player list wider (640px, fitting 4 cards
per row instead of 3, so the same players take fewer rows).

**A WASD-styled d-pad instead of the joystick on a real mouse+keyboard**
The on-screen joystick (for panning the camera) showed on every device,
even though PC already had working arrow-key/WASD camera panning with
no visible hint that it existed. Added a 4-button pad laid out and
labeled like the actual keys (`. W .` / `A S D`), shown instead of the
joystick specifically when the device has a precise pointer and hover
(`@media (pointer: fine) and (hover: hover)` — a real mouse, not a
touchscreen, which keeps the joystick since it's easier to hit
precisely with a finger). The buttons drive the exact same
`scrollKeys` flags the keyboard bindings already do, not a separate
input path.

**AI players bunching toward the ball while defending, not just attacking**
The previous entry fixed teammates converging on a shared point while
*attacking* (an unnamed "support" bug); a similar issue existed on the
*defending* side: `_offBallTarget`'s press logic computed each
defender's target using their own already-drifted live position
(`e.body.position.x`), which fed back into itself — a player who'd
already nudged toward the ball last frame started this frame's press
already closer in, compounding every tick until the entire side,
wingers included, collapsed into a knot around the ball carrier rather
than holding their own lane. Anchored the press spot on each player's
stable formation position instead, and dialed back how many players
engage at once and how hard (`PRESS_RANGE` 260→190, `PRESS_BLEND`
0.5→0.35) so a press reads as "whoever's actually close" rather than
the whole team caving inward. A check with the opponent in possession
confirmed all 10 outfield defenders now spread across ~740px of the
960px-wide pitch, each landing on a distinct spot.

Verified against the full Playwright suite (45/45 passing) and
visually in a running browser at both a phone-sized and a desktop
viewport (screenshots) — side-by-side columns and the WASD pad both
render as expected at each.

## Fixed card grid to 3 per row, AI passes only when actually pressured

**Exactly 3 cards per row in the side-by-side player list** — the
640px-wide column from the previous entry left the grid's
`auto-fill`/`minmax(126px,1fr)` default to decide, which fit 4 fairly
cramped cards per row. Pinned it to `grid-template-columns: repeat(3,
1fr)` specifically at that width instead (mobile keeps `auto-fill`,
since there's only ever room for 1-2 there regardless).

**AI passing was flat-rate regardless of pressure** — `passChance`
(`AI_LEVELS`) rolled every tick whether or not anyone was actually
closing the ball carrier down, so the AI kept lumping the ball off
even standing alone in open space, reading as pass-happy overall
(open, unpressured play is the common case, so most rolls were
happening exactly when a real player would just carry the ball
instead). Added `_nearestOpponentDist()` — the same idea the defensive
press logic already uses to decide who's close enough to press,
reused here to ask the same question from the attacking side — and
only use the full tuned `passChance` when an opponent is within
`PRESS_RANGE`; otherwise it's cut to a quarter (`PASS_CHANCE_FREE_MULT
= 0.25`). Passing under real pressure is unchanged; passing in space
drops sharply.

Verified against the full Playwright suite (45/45 passing) and
directly: 3 cards confirmed per row at the 1280px viewport, and
`_nearestOpponentDist` correctly reads ~365px with defenders pushed
away versus 50px with one placed right next to the carrier.

## Fixed the 3-card grid overflowing, then leaving an uneven gap

Two follow-on bugs from the same change, caught in review:
- `#squad-pick-list` had been pinned to the same `640px` as the column
  and its container, but it actually sits *inside* that container's
  padded content box (640px minus padding and border on each side,
  ~606px) — matching the outer width instead of its own parent's inner
  one meant it overflowed past the container's right edge by that
  padding+border.
- Fixing that by dropping back to the element's own `width:100%`
  surfaced a second issue: its base rule's `max-width:500px` (sized
  for the old single-column mobile layout) is narrower than the ~606px
  actually available in the side-by-side layout, so the grid stopped
  overflowing but now fell short of the container's own width instead
  — a lopsided gap on the right where the left/right padding should've
  matched.

Lifted the `max-width` cap for this specific context (`max-width:
none`) so `#squad-pick-list` actually fills the space its container
gives it. Verified directly: left and right gaps both measure exactly
17px (the container's own padding+border) and the last card in a row
now reaches the same right edge the grid itself does.

## A "side by side" option for mobile too: Browse Players as a drawer

The side-by-side columns only kick in above 900px — there's no real
way to fit two ~300px+ columns on a phone. Below that, added a
different answer to the same request: Browse Players now overlays the
right ~78% of the screen as a drawer instead of navigating away from
the pitch entirely, leaving a sliver of it (and whatever's scrolled
into view behind the drawer) visible on the left for context. Same
`squadSectionOpen`/`.hidden-section` toggle mechanism as the desktop
columns already use — a new `.drawer-open` class just changes how
"open" is drawn below 900px, via `@media (max-width: 899px)`.

Since the drawer covers most of the screen while open — including,
unlike a true side-by-side column, the Formation toggle button itself
— it needed its own dedicated close button (`✕`, top-right of the
drawer) rather than relying on reaching back to the button that opened
it. It also now defaults to *closed* on a narrow screen (open by
default above 900px, same as before): starting it open would
immediately hide the formation controls behind it before you'd done
anything, which is a worse default than a drawer that opens on
request.

Two real bugs surfaced building this, both from the same root cause —
a fixed-position element with both `left` and `right` set, plus an
inherited `width` from `.section-container`'s base rule that doesn't
get overridden by the drawer's own `max-width: none`:
- `width` (not `auto`) beats `right` when a fixed-position box has all
  three of `left`/`width`/`right` set — the browser drops `right`
  rather than treat the box as over-constrained, so the drawer's
  actual right edge ended up `left + width` (past the viewport's own
  edge) instead of stopping at the screen's edge like `right: 0` asks
  for. Needed an explicit `width: auto` so `left`+`right` are what
  compute it, not a leftover `width: 100%`.
- The close button's `display: block` override lived in a `@media`
  block placed *before* its own `display: none` base rule — same
  specificity (both plain ID selectors), so cascade order made the
  later, unconditional `none` win regardless of viewport. Moved the
  media query below the base rule it's meant to override.

Also updated the existing "each toggle button only collapses its own
section" test for the new default (Browse Players starts closed under
900px) and split it into two: toggling Formation while the drawer's
closed still only affects Formation, and closing the drawer via its
own `✕` (the only reachable way once it's open, per above) leaves
Formation untouched either way. Verified against the full Playwright
suite (46/46 passing).

## Moved both toggle buttons above the pitch, not stuck below it

"🔍 Browse Players" used to sit right above the section it opens —
which meant scrolling all the way down past the entire pitch/bench
just to *find* the button, before the drawer added in the previous
entry could even come into play. Moved both toggles into a shared
`#squad-view-tabs` row at the very top of the panel instead, right
below the Your Team/Rival Team tabs — visible immediately, no
scrolling required to discover either one.

On the wide (>=900px) side-by-side layout the two tabs are sized to
match their columns below (380px/640px) so they still line up
visually; on a narrow screen they're two equal-width buttons in one
row. The drawer itself still starts from the very top of the screen
(`top: 0`), so opening it now covers the tab row too, same as
everything else behind it — the dedicated `✕` close button added in
the previous entry is what gets you back, not scrolling up to find
the toggle again.

No test changes needed — `.view-tab` is a class-based query, so moving
the buttons' position in the DOM doesn't affect anything that already
worked. Verified against the full Playwright suite (46/46 passing) and
visually at both viewport sizes.

## Tapping outside the Browse Players drawer closes it too

Not just the dedicated `✕` — tapping anywhere outside the drawer now
closes it as well, the usual modal/backdrop convention. "Outside"
turned out to need real care to define:

- It means outside `#squad-columns` entirely (the drawer *and* the
  pitch/bench beside it), not just outside the drawer element. The
  visible sliver of pitch exists specifically so a bench/pitch spot can
  be armed and then filled from the still-open drawer in one flow (see
  the bench-slots test) — closing on that same tap would break exactly
  that. First attempt scoped it to just the drawer element and broke
  that flow immediately.
- Even scoped to `#squad-columns`, a plain `.contains(e.target)` check
  still didn't work: tapping a bench/pitch pin re-renders that whole
  section synchronously inside its own click handler
  (`_onSquadPinClick` → `_renderPitch`), which replaces the DOM node
  the click actually landed on before this listener's turn comes up in
  the same bubble phase — `.contains()` against the *current* tree then
  wrongly says "not inside" for a tap that very much was, since the
  original node is now detached. Fixed with `event.composedPath()`
  instead, which is fixed at dispatch time and unaffected by DOM
  changes a handler makes along the way.
- Only applies below 900px, where Browse Players is actually a drawer
  overlaying something else — above that it's a normal always-visible
  column, and clicking the pitch beside it was never meant to hide it.

New test covers all three cases: a tap inside the drawer doesn't close
it, a tap on the pitch/bench sliver beside it doesn't either (and the
existing bench-slots test already exercises arming a spot and filling
it from the still-open drawer end to end), and a tap genuinely outside
both does close it. Verified against the full Playwright suite
(47/47 passing).

## A color picker for your own team's kit

Your team's on-pitch color was always picked automatically —
whichever real team most of the starting XI actually belongs to (see
`_squadColor`). No way to just pick a color you wanted instead, short
of building a squad entirely out of players from one specific team.
Added a "Your team color:" swatch next to the other match-setup
selectors (Half length, AI difficulty) that overrides it directly.

Left untouched (`myTeamColor` starts `null`), everything works exactly
as before — a new `_payloadColor()` helper only overrides `_squadColor`'s
usual result when the payload actually carries a `color` (added to the
`{starterIds, benchIds, formation}` squad payload sent over
`net.sendSquad`), so a remote opponent's own choice, or the absence of
one, is respected too, not just the local player's. Only affects
whichever side is *your* squad (`teamColorA`/`teamColorB` depending on
role) — the rival AI's or a real opponent's own color is untouched
either way.

Verified directly: picking a color and starting a match makes
`teamColorA` match it exactly (not the auto-derived one), and leaving
it alone still produces the same color `_squadColor` always would.
Verified against the full Playwright suite (49/49 passing).

## Tap a spot on the pitch to fill it

Filling an XI meant doing the work in the wrong order: open the player
list, find someone good, then remember which spot they were meant for
and go back to the pitch for it. On a phone that's worse still, since
the list is a drawer covering most of the pitch — so the flow was open
the drawer, pick, close the drawer, place. The drawer geometry got a
lot of attention for that reason, but the geometry was never really
the problem: two panels fighting over one screen is a fix for a
workflow that isn't actually simultaneous. Picking a player and
choosing their spot are sequential, and the editor's own selection
model already treated them as the same operation.

So tapping an *empty* pitch slot now opens the list itself, narrowed
to the position that slot asks for (`SLOT_ROLES`) and sorted as ever
by rating, and the tap that picks a player from it both fills the spot
and closes the list again — putting the next empty spot straight back
under the thumb. Two taps a player, no opening or closing in between.

Almost none of this is new machinery. A list card and a pitch pin were
already the exact same thing to `_onSquadPinClick` (see
`_squadSelForPlayer`), so an empty spot just needed to additionally
arm the list (`_armEmptySpot`: set the position narrowing, reset to
page 1, open the section) and a completed placement to retire it
(`_finishSpotFill`). Which is also why the original route — browse the
whole roster first, pick someone, then choose where they go — keeps
working untouched, and both now end the same way, with the drawer
getting out of the way once the player has somewhere to be. Arming a
player from the list deliberately does *not* close it, since tapping
the same card twice is how you read their stats.

Deliberately limited to empty spots. Tapping an occupied pin is the
start of a swap with another pin, and the list opening over the pitch
would bury the other half of that. The narrowing is transient and
announced rather than silent — a "Filling a GK spot · Show all" banner
above the list, since a roster of ~5000 suddenly showing 792 reads as
a bug otherwise — and clears itself on placement, on cancel, and on a
bulk fill (`_randomize`, `_useWholeTeam`), so it's never a filter left
set behind you. Only the narrow layout auto-closes; above 900px the
list is a permanent column beside the pitch, where collapsing it
mid-flow would just be startling.

One bug found and fixed while building it: an empty spot left armed
after closing the list without picking anyone ate the next tap, since
two empty spots resolve through `_swapSquadSelections` as a swap of
two nothings — which cleared the selection and, having "handled" the
tap, never reopened the list for the spot just tapped. Closing the
list now drops an armed empty spot (a pool player stays armed, that
being the whole point of the other route), and an empty-to-empty tap
re-arms the new spot rather than spending itself on a no-op swap.

Six new tests cover the narrowing, the two-tap fill, "Show all", the
stale-arm regression, the browse-then-place route, and an occupied pin
still being left alone.

## Another nudge up to player pace

The general pace lever (`BASE_MAX_SPEED`/`AUTO_MAX_SPEED`) up another
7%, 0.718/0.658 -> 0.768/0.704, by preference — the earlier +5% only
restored the pace the stat recompute had cost, and at that pace it
still read as sluggish. Both move together, keeping off-ball players
at the same ~92% of a carrier's top speed as before rather than
quietly changing how the team moves relative to whoever has the ball.

Worth noting why these two constants are the right lever at all and
the steering forces aren't: a player's steering force against their
0.16 air friction settles at a terminal velocity around 1.1, well
above the ~0.65 the cap actually allows, and they reach it within a
few frames. So the cap is what every run in the match is up against,
and a change here shows up in full rather than being partly absorbed
by how long players take to get up to speed.

## The camera pad was swallowing presses meant for the pitch

Turned up by a drag test that started failing intermittently after the
pace change above — which turned out to be a real input bug the speed
had only changed the odds of hitting.

The WASD camera pad is a CSS grid shaped like a d-pad, so two of its
six cells are empty (either side of W), and it sits inside a bare flex
wrapper (`#scroll-controls`). All of that is transparent and reads as
pitch, but it still covered those points, so a press there was
swallowed instead of reaching the canvas: a player standing in the
bottom-left corner of the screen simply couldn't be grabbed to draw a
run, with nothing on screen to explain why. The container and the
wrapper now let presses through (`pointer-events: none`), with only
the buttons themselves taking their own (`pointer-events: auto`) —
the same treatment the HUD elements above them already get, and for
the same reason. Verified both halves: the empty cells now hit the
canvas, and holding a button still scrolls the camera and releasing it
still stops.

Two test-side fixes came out of the same investigation, both cases of
a test assuming something the game never promised:

`findOnScreenPlayer` picked a player by viewport bounds alone, which
its own docstring says is meant to be "a point Playwright's mouse can
actually land on". The HUD puts real controls over the pitch (the
camera pad bottom-left, the subs button bottom-right), and a press on
one of those is legitimately theirs — a player standing under one is
not grabbable, so the helper now skips them instead of handing back a
point whose press never reaches the game.

The drag test also pinned the id of the player it sampled, but play is
live: between reading that position and the mouse landing on it, they
can run out of `PLAYER_SEL_RADIUS` and the drag goes to whichever
teammate is nearest the press instead. That tolerance is the whole
point of the radius, and which player got picked was never what the
test was about, so it now takes the selected player from the scene and
checks what it actually cares about — that a real drag builds a path,
on a player of ours, and that the path survives while the press is
held.

## Readable names on the pitch, and a keeper who stays home

Two things reported together, both about the match itself.

**Names.** They were 9px white Courier with a soft shadow. Legible in
isolation, not over a pitch: thin light strokes on mid-green is barely
any contrast, and the shadow was there because the obvious fix had
already been tried and failed — an outline thick enough to matter at
that size eats the letters (a 3px one on 7px text read as a black
blob). So the contrast now comes from a dark plate behind each name
instead, which gives every one of them the same footing wherever it
sits, and the text moves to 12px bold Pixelify Sans — the font the
rest of the UI already uses, and one that stays crisp small. The
roster has long since loaded by the time a match builds its teams, so
the webfont is reliably available by then.

Size and contrast weren't the whole problem, though: players bunch up
constantly, and two names on top of each other are unreadable whatever
the font — worse with a plate behind each, where the pair butts
together and reads as a single word. So a name that would land on one
already shown this frame is now dropped instead (`_declutterLabels`).
Which one survives follows a fixed order — the ball carrier first,
then whoever each side is steering, then by slot — rather than
whatever order the teams happen to be in, so a close pair resolves the
same way for as long as they're close instead of the two flickering
against each other frame to frame. Verified: three players stacked on
one spot show exactly one name, and eight consecutive frames produce a
single visibility pattern. It only ever hides a label, so a player
already off the pitch (sent off, substituted) keeps theirs hidden.

**The keeper.** When a drawn line ran out, `_runOnWaypoint` kept the
player making ground up the pitch rather than turning straight back
into the formation — which is right for everyone except the one player
with somewhere specific to be. Drawing a keeper out and having them
carry on with the rest of the attack left their goal open behind them.
Their line ending now deletes the path instead, which hands them to
`_offBallTarget` — where a keeper already stays on plain formation
logic — so they head back to their post. Drawing a run for them still
works exactly as before; this is only about where they end up once it
finishes. Outfielders are untouched, which the tests check both ways.

## Made the licensing explicit: MIT, with the fan-project line drawn

The project had no `LICENSE` file and no licensing section at all,
which in practice means all rights reserved — the opposite of the
intent. Added the MIT license (copyright Langoyo), the matching
`"license": "MIT"` field in `package.json`, and two new README
sections.

"Built with" now credits every dependency with what it actually does
here and the license it carries: Phaser (MIT, and the bundled Matter.js
it uses for physics), Trystero (MIT, the WebRTC peer-to-peer layer),
nes.css (MIT, the pixel UI kit), Vite (MIT) and Playwright
(Apache-2.0). Licenses were read from each package's own manifest
rather than from memory. No version numbers in the prose — those rot,
and `package.json` is already the source of truth.

"Data and assets" covers the parts that aren't code: the three Google
Fonts under the SIL Open Font License, and the roster/team data derived
from `InazumaElevenAPI` and its own upstream `zukan.inazuma.jp`, with a
pointer to the provenance already written up in this file.

The license section deliberately says what MIT here does *not* cover,
because for a project like this that's the part that matters: the
bundled libraries keep their own licenses, the fonts are under the OFL,
and Inazuma Eleven itself belongs to Level-5. Character names, team
names and the stats derived from them aren't this project's to
relicense, so the section says so plainly and notes the fan-project
status rather than letting a blanket MIT grant imply otherwise.

## The team color selector now says when it's on automatic

The swatch defaulted to `#3399ff` while `myTeamColor` was still `null`,
so it showed a specific blue that had nothing to do with what would
actually happen — the kit color was being derived from your XI, and
that blue was only the fallback for a squad with no team data at all.
It read as a choice somebody had made, which is exactly what it wasn't.

A native `<input type="color">` can't be blank, so rather than fake an
empty state the swatch now tells the truth: while nothing has been
picked it previews what the automatic pick currently works out to for
your XI, and an "Automatic" checkbox beside it says that's where the
color came from. Change your squad and the preview follows, since
that's what `_squadColor` derives it from (wired through `_renderPitch`,
which already runs on every squad change, and always reading your own
XI regardless of which side the pitch is showing — this setting never
affected the rival anyway).

Touching the swatch is what promotes it to a real override: it sets
`myTeamColor` and unticks Automatic, after which squad changes leave it
alone. Ticking Automatic back on clears the override and the preview
resumes; unticking it deliberately keeps whatever color is on screen
rather than snapping to some default, so the color doesn't jump at the
moment you go to adjust it.

`myTeamColor` is still the single source of truth — null means
automatic, and the payload/`_payloadColor` path is untouched. Three new
tests cover the automatic preview tracking the squad, an override
surviving a squad change, and both directions of the checkbox.

## Fixed: substitutions changed nothing visible on the pitch

Reported as "I'm changing players and I see no effect." The
substitution itself was working the whole time — `_trySub` correctly
swapped `entry.id`, moved the new player's stats into `statsMapA`/`B`,
and updated the bench — but the on-pitch name is a separate Phaser Text
object created once at kickoff in `_buildTeam`, and nothing ever told
it to update. So the substitute's stats were live from the moment they
came on, but the pitch kept showing the name of whoever they replaced,
indefinitely. From the outside that reads as exactly "no effect,"
because the one thing you can actually see didn't change.

Same gap in two other places that reassign which player an entry
represents by changing `entry.id`: `_tryReposition` (swapping two
players' spots from the team panel) and `_syncClientIds` (a client
mirroring whatever substitution or reposition the host just made) —
the latter meaning a real opponent watching your sub over the network
would never see the new name either, only you would (and only in your
own head, since your own screen was equally wrong).

Added one helper, `_relabelEntry(e)`, that looks up the roster player
for `e.id` and calls `e.label.setText(...)`, and called it from all
three sites right after each one changes `e.id`. Six tests cover it:
the three existing `_aiConsiderSub` tests still pass unchanged, and
three new ones in `tests/ai-subs.spec.js` check the label directly
after a manual sub, after a reposition (both entries, and that they
actually swapped rather than both landing on the same name), and after
`_syncClientIds` mirrors a host-side change.

## Individual stats now share the rating's own scale

Reported with the receipts: averaging the five stats shown on a
player's sheet (Shot 131, Dribble 110, Defense 85, Keeper 89, Speed 85
for one example) gave ~97-100, but the ⭐ rating next to them read 73.
Both numbers come from the same underlying raw stats, but through two
unrelated conversion factors: `_displayStat` divided the raw value by
~0.0105 (≈×95.2, meant to recover something like the original games'
own stat range), while `_playerRating` multiplied the raw 5-stat
average by 70 (a deliberate 30-99 "summary" compression). Landing in
a similar-looking numeric range was coincidental, not by design — nothing
tied the two together, so eyeballing the stat sheet the obvious way
(which is exactly what got reported) gave a plausible but wrong answer.

`_displayStat` now uses the exact same ×70 as `_playerRating`, so the
individual numbers and the star are directly comparable — verified
against 4,000 players, the largest gap between an eyeballed average of
the five displayed stats and the actual star is 0.6 (pure rounding,
since the star rounds the raw average once while the five stats each
round independently). Checked the resulting range holds up across the
whole roster too: every stat still lands under 90 (max ~89), so nothing
needed its own clamp.

The compact `SPD`/`SHT` line on a search-list card reads the same
scale automatically, same function.

## Search-list cards now show the two stats that actually matter for the position

Followed directly from the scale fix above: "para gk parar y defensa, para
defense def y dribbling" — the compact card always showed SPD/SHT no
matter the position, which told a keeper or a defender nothing about the
one stat that actually decides whether they're good at their job.

`CARD_STAT_PAIR` picks two per position — a main duty plus one supporting
skill, same idea as the two the user named for GK and DF:
- **GK**: Keeper (shot-stopping) + Defense (reading the box)
- **DF**: Defense + Dribble (defending, and carrying it out under pressure)
- **MF**: Dribble + Shot (the two roles left unassigned — carrying play
  forward and a goal threat of their own — since the user wasn't sure and
  asked for a suggestion)
- **FW**: Shot + Speed (finishing, and the pace to get on the end of one)

`_cardStatLine(p)` looks the pair up and formats it with the same
`_displayStat` the stat sheet uses (now on the unified ×70 scale from the
fix above, so these numbers and the star are still directly comparable).
Falls back to the old SPD/SHT pair for a player with no position on
record. Two new tests: each position's line matches its own formula and
the four differ from one another (not a still-fixed line that happens to
pass), and an actual rendered card shows the position-specific text.

## FW card now shows Shot + Dribble

Follow-up to the position-relevant card stats above — asked to swap
Speed out for Dribble on a forward's pair, since finishing (Shot) and
close control (Dribble) read as more forward-defining than raw pace.
`CARD_STAT_PAIR.FW` updated; the other three positions are untouched.

## Stats now have more say in who wins a confrontation

Follow-up to two things reported together: a delayed answer to "can we
make stats matter more, like 60/40 instead of 50/50" and, underneath
it, a genuine finding once I measured it. A confrontation's win chance
is `attackerPower / (attackerPower + defenderPower)`, where each side's
power is `techniquePower × theirStat × ...`. Since that's linear in the
stat, the ratio of the two POWERS equals the ratio of the two STATS —
and the roster's stats are tightly clustered (a whole position's spread
is maybe 20-40%), so even a clearly-better player against a clearly-worse
one barely moved off 50/50: a roster-median dribbler against a
roster-median defender (the two stat pools aren't centred the same, so
"average vs average" was never exactly 50/50 to begin with) won only
~54% of the time, and the roster's best dribbler against its worst
defender reached just ~58%. Stats existed, but a real gap in ability
barely showed up in the outcome.

Added `STAT_POWER_EXPONENT = 2.5`, raising each side's raw stat to that
power before the ratio (`Math.pow(stat, 2.5)`) — deliberately only the
stat, not the technique-power factor beside it or the element-edge
multiplier, so spending PT on a supertechnique (power 24 for a normal
action up to 110 for the strongest ones, untouched by this) still
swings a confrontation far more than any stat gap does. 2.5 was picked
by calibration, not guesswork: it turns that same median-vs-median
matchup into ~60/40 (matching the target given) and the roster's
best-vs-worst matchup into ~69/31 — clearly decisive without making a
stat gap alone a foregone conclusion.

Three new tests in `tests/confrontation-stats.spec.js`, each run over
1,500-3,000 trials since a single confrontation is a coin flip by
nature: the calibration case itself lands in the low-60s (not the old
~54%), a worse-stat attacker armed with a real supertechnique still
beats a better-stat defender with none most of the time (confirming
the technique-over-stats hierarchy survived), and identical stats with
no techniques on either side still land at an even 50/50 — a sanity
check that `Math.pow` on a ratio of exactly 1 introduces no bias of its
own.

## El roster pasa a las 7 estadísticas nativas del juego

Reportado con una foto de la ficha de Mark Evans en la consola: el juego
real describe a un personaje con **siete** estadísticas, y las nuestras no
eran ninguna de ellas. Guardábamos cinco (`speed`, `shotPower`,
`dribblePower`, `defensePower`, `keeperPower`) calculadas a partir de esas
siete y luego tiradas — una invención nuestra que no coincidía con nada que
un jugador pudiera consultar, y encima con pérdida: dos de las cinco
promediaban `physical`, así que las siete no se podían recuperar de lo
guardado, solo volver a buscar. El usuario aportó el volcado original.

Antes de tocar nada, tres comprobaciones sobre los datos:

- **La derivación se confirma exactamente**: `speed = agility`,
  `shotPower = kick`, `dribblePower = avg(control,technique)`,
  `defensePower = avg(pressure,physical)`,
  `keeperPower = avg(intelligence,physical)`, todo × `0.0105`.
- **Emparejar por `id` habría corrompido el roster en silencio.** Nuestros
  `vr-N` se desalinean con los ids del volcado a partir de `vr-262` (solo 223
  de 4.841 parejas compartían nombre). La migración empareja por *nombre + las
  cinco derivadas como huella*, lo que resuelve los **5.127/5.127** jugadores
  a un único origen, sin ambigüedad ni pérdidas — incluidos los 185 nombres
  repetidos, que la huella desempata sola.
- **Las siete no arreglan la "planitud" por sí solas**: su total también está
  conservado (656-693), que es la razón del cambio de valoración de abajo.

`scripts/migrate-roster-stats.mjs` hace la conversión una vez y aborta si
algún jugador no resuelve. Conserva intactos técnicas, equipo, color, PT,
apodo, posición y — importante — los `id`, porque las plantillas guardadas en
`localStorage` solo guardan ids y se habrían roto todas. De regalo, el
**elemento pasa del 69% al 100%** de cobertura (1.588 nuevos, 16 corregidos),
que el volcado sí trae para todos.

En el juego: la ficha muestra las siete con los números del juego real (Mark
Evans: Kick 90, Control 97, Technique 91, Pressure 98, Physical 105, Agility
111, Intelligence 97), el orden de la lista tiene las siete, y las categorías
de duelo van ahora a una nativa suelta (`shot→kick`, `dribble→control`,
`defense→pressure`, `keeper→intelligence`) en vez de a un promedio de dos.
`STAT_UNIT` (0.0105) queda como única constante de normalización, y solo la
usan los dos sitios que necesitan escala absoluta — el ritmo de carrera y la
probabilidad de falta. Los duelos no la necesitan: comparan un lado contra el
otro, y una razón no depende de las unidades.

`STAT_POWER_EXPONENT` baja de 2.5 a **2.0**. Una estadística nativa tiene más
dispersión que el promedio de dos que sustituye, así que el mismo exponente se
habría pasado a ~62/38; con 2.0 el duelo típico vuelve a ~60/40, que es el
objetivo pactado. Verificado con 4.000 tiradas.

## La valoración pasa a ser ponderada por posición (y centrada)

Consecuencia directa de lo anterior, y cierre de la decisión que quedó
pendiente. Con las siete nativas una media plana es inservible: da 95 al
**71%** del roster, porque el dato de origen conserva un total casi fijo por
personaje (mucho `kick` implica poco `pressure`). `RATING_WEIGHTS` pondera lo
que cada puesto necesita — portero por `intelligence`/`pressure`/`physical`,
defensa por `pressure`/`physical`/`intelligence`, medio por
`control`/`technique`/`intelligence`, delantero por `kick`/`control`/`technique`.

Eso destapó un segundo problema que la ponderación crea por sí sola: cada
puesto quedaba en una escala distinta (delanteros 108-116 contra porteros
95-99), así que **todos los delanteros del juego superaban a todos los
porteros** y ordenar por valoración no mostraba un portero jamás.
`_ratingBaseline()` centra cada posición en 100 usando su propia mediana,
calculada del roster cargado en vez de constantes que envejecen. Cada puesto
conserva su dispersión interna (y por tanto su orden), y un 103 significa lo
mismo para un portero que para un delantero.

De 68-73 con el 71% idénticos a 73-107 repartidos. Cinco tests nuevos en
`tests/roster-migration.spec.js` fijan la integridad de la migración: las
siete presentes y enteras, ninguna de las cinco antiguas superviviente, todo
lo que no debía tocarse intacto, elemento al 100%, y la valoración
discriminando con las cuatro posiciones centradas en el mismo número.

## Removed the dead root-level file copies

`roster.json`, `GameScene.js`, `players.js`, `techniques.js`, `roster.js`,
`network.js` and `AIController.js` at the repo root were stale duplicates
nothing loaded — `index.html` only ever imports `/src/main.js`, and every
real import chain runs through `src/scenes/GameScene.js` and its `src/`-tree
siblings, never these. The root `roster.json` was additionally a stale copy
of an earlier `public/roster.json`, predating the seven-native-stat
migration — keeping it around risked someone opening the wrong file to
"check the data" and drawing the wrong conclusion. Deleted; nothing else
changed, confirmed via a full test run and a working dev server.

## Press and hold a player to see their stats, not double-tap

Double-tapping a pin/card was never discoverable, and existed as a second
special case inside the same tap-to-arm/swap gesture: tap once to arm a
selection, tap the same one again to view stats, tap a different one to
swap or place. Replaced with press-and-hold, which is now completely
independent of arm state — the squad editor's pins and cards, and the
in-match Team panel's own-side pins, all use it. Tapping an already-armed
selection now simply cancels the arm (a sensible replacement on its own,
and simpler than what it replaces).

New `_armPressGestures(el, {onTap, onLongPress})` starts a `LONG_PRESS_MS`
(500ms) timer on `pointerdown`, cancels it on release/leave/cancel or if the
pointer moves more than `LONG_PRESS_MOVE_TOLERANCE` (10px — so it yields to
an actual drag/scroll rather than fighting it), and swallows the `click`
the browser sends right after a completed hold so a long press never *also*
fires the tap action. Same shape as `_setupWasdPad`'s existing press/release
handling, reused rather than invented fresh.

The read-only rival-formation view is untouched on purpose — a single tap
already opens stats there with no arm state to disambiguate from, so adding
a hold delay would only make it slower for no benefit.

Updated the two existing info popups that described the old gesture
("Building your squad", the in-match "Team panel" one) to say "press and
hold" instead. Six new tests in `tests/long-press-stats.spec.js` cover: a
quick second tap cancelling an arm instead of opening stats, holding a pin/
card/bench-spot showing stats without disturbing whatever was or wasn't
armed, the same in the in-match panel, and the info-popup text.

## Camera pans faster

`SCROLL_SPEED` 220 → 340 px/s (~55% faster). Joystick, the on-screen WASD
pad and real keyboard/WASD all read this one constant in `_tickScroll`, so
all three speed up together — there's no separate multiplier per input
method to keep in sync. Purely a personal-UI convenience (never seen by an
opponent, no gameplay-balance implication), so no calibration needed beyond
confirming the formula: calling `_tickScroll(1000)` directly moves the
camera exactly 340px, independent of the test environment's own frame
pacing (which is what an earlier, wall-clock-timing verification attempt
was actually measuring instead of the constant itself).

## Pixel-art portraits, mapped and shown everywhere except the pitch itself

The user added 5.454 pixel-art player portraits (256×256, transparent
background), already committed as `src/data/player_images/{dump id}_{name
slug}_pixel.png`, and wanted them in the search-list cards, the stat sheet,
every formation pin (squad editor and the in-match team panel), and the
duel cards — everywhere a player's identity is shown in the UI — but
explicitly *not* replacing the plain coloured circles that represent
players moving around the pitch during a live match.

**Mapping.** The filenames' numeric prefix is the same dump id
`scripts/migrate-roster-stats.mjs` already pulled the seven native stats
from — so matching a roster player to their portrait reuses that exact
groundwork, and is now *more* precise than the original stats migration:
since `public/roster.json` already stores the dump's seven stats verbatim,
a player now matches a dump entry by name + **exact** equality on all
seven (no epsilon needed, unlike the original tolerance-based fingerprint).
New `scripts/map-player-images.mjs`, same one-shot/`--write` pattern as the
stats migration. Verified coverage before writing anything: 4,839 of 5,127
players resolve to a single unambiguous dump id; 288 resolve to *several*
ids with byte-identical stats — recurring cast (Mark Evans, Axel Blaze...)
who reappear once per game they were in, always maxed out the same way, not
a real ambiguity — broken by taking the lowest id (confirmed always has an
image). **Result: 5,127/5,127 players got a portrait**, `image` field
added pointing at the actual filename found on disk (never reconstructed
from a guessed slug, so a naming-convention mismatch can't silently point
at nothing).

**Serving.** Moved from `src/data/player_images/` (where they were
committed — Vite would treat them as ~5,000 individual module imports,
not what we want) to `public/player_images/`, matching how
`public/roster.json`/`teams.json` already serve as plain static files at
`/roster.json` etc.

**Rendering.** One new helper, `_avatarFill(p, col)`, is now the single
place that decides "photo or colour-and-initials" for every avatar chip —
six call sites in `GameScene.js` (both `_renderPitch` pins, `_showPlayerStats`,
`_renderPickList`, `_renderSubPanel`, `_renderMiniPitch`) switched from
inlining `background:${col}` + initials to calling it, so a player with a
portrait gets `background-image` and empty text, one without still gets
exactly the old flat colour + initials — the same fallback that's always
been there, now reached whenever `p.image` is missing rather than as
special-cased dead code.

**Duel cards got a new field to carry, not new plumbing.**
`_prepareConfrontReveal` builds `c.reveal.a`/`c.reveal.d` from data already
in scope (`c.attackerId`/`c.defenderId`) — adding `id:` to each was a
two-line change. That object already goes over the wire as-is via
`sendState` for multiplayer, so both players see the same portraits with
no networking changes. `_renderDuelReveal` resolves the id back to a
roster player and paints a new `.duel-portrait` element (added to the
static `#duel-card-a`/`#duel-card-d` template) the same way every other
avatar chip does.

**Square frame, not circular.** The portraits aren't drawn identically
from character to character — some reach the edge of the 256×256 canvas,
some have visible padding — so a circular crop would cut hair or collars
differently per character depending on how each was composed. Dropped
`border-radius: 50%` from the `.pin-avatar`/`.av` face itself, keeping
every *token* shape around it exactly as it was (the pitch pin badge is
still a circle, the duel card still a rectangle) — only the face inside
changed shape. `image-rendering: pixelated` on both, so the art stays
crisp rather than blurring when scaled.

**What deliberately didn't change**: the actual on-pitch match sprites
(`this.add.circle(...)` in `_buildTeam`) are Phaser `Arc` graphics objects
with no texture slot to swap in the first place — there was nothing to
touch here, confirmed by a new test asserting every live entry's `.gfx` is
still an `Arc`.

Nine new tests in `tests/player-images.spec.js`: portrait coverage and
that a sampled few actually fetch; each of the four UI surfaces (card,
pin, stat sheet, sub panel, duel) shows a `background-image` rather than
flat colour for a player who has one; the fallback still works for a
player who doesn't (including a defensively-passed `null`); and the
pitch-sprite exclusion above.
