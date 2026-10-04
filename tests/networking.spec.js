import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

test.describe('multiplayer squad-confirm race', () => {
  test('confirming your squad before a peer connects waits, instead of silently starting a solo match vs AI', async ({ page }) => {
    // Regression test: _confirmSquad used to infer "I'm playing solo" from
    // !net.hasPeer(), but that's also just the normal state of multiplayer
    // before the WebRTC handshake finishes. Whoever clicked Confirm first
    // (likely both players, staring at the same screen) fell into the
    // AI-fallback branch and started an isolated solo match — "we saw
    // different things" from the user's report. The fix reads uiMode
    // instead, which the scene always knows unambiguously.
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    expect(await page.evaluate(() => window.__scene.uiMode)).toBe('multiplayer');
    expect(await page.evaluate(() => window.__scene.net.hasPeer())).toBe(false);

    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__scene.matchStarted)).toBe(false);
    await expect(page.locator('#squad-status')).toContainText('Not connected yet — share code');
  });

  test('once the real peer’s squad is known, the match starts with it — not a generated AI squad', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    expect(await page.evaluate(() => window.__scene.matchStarted)).toBe(false);

    // Simulate the peer connecting and sending their real squad — exactly
    // what onSquad's handler (GameScene.js's _connectNet) does with the
    // data network.js hands it once the actual WebRTC handshake completes.
    const opponentStarters = await page.evaluate(() => {
      const s = window.__scene;
      const fakeSquad = { starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [...s.benchIds], formation: s.chosenFormation, color: '#336699' };
      s.remoteSquadPayload = fakeSquad;
      s._tryStartMultiplayerMatch();
      return fakeSquad.starterIds;
    });
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 5000 });
    const teamBIds = await page.evaluate(() => window.__scene.teamB.map((e) => e.id));
    expect(teamBIds).toEqual(opponentStarters);
  });

  test('a role flip after confirming (provisional host → real guest) fixes the stale status instead of leaving it stuck', async ({ page }) => {
    // Regression test for a second report of "both players confirmed and
    // the game never started": _confirmSquad only ever checked role and
    // updated #squad-status at the moment of confirming. A player who
    // confirms fast enough to still be on the provisional "alone in the
    // room" host guess sees "Waiting for opponent…" — correct at the time.
    // But if the real comparison later says they're actually the guest,
    // nothing ever revisited that text or the start-check again: it sat on
    // "Waiting for opponent…" forever, a status that (for the real guest)
    // will never resolve, since the guest never starts the match itself.
    // _tryStartMultiplayerMatch is now re-run from _syncRoleFromNet too, so
    // a role flip immediately corrects it.
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    expect(await page.evaluate(() => window.__scene.role)).toBe('A');
    await expect(page.locator('#squad-status')).toContainText('Not connected yet');

    await page.evaluate(() => {
      const s = window.__scene;
      s.net.isHost = () => false;
      s.net.hasPeer = () => true; s.net.peerCount = () => 1;
      s._syncRoleFromNet();
    });
    expect(await page.evaluate(() => window.__scene.role)).toBe('B');
    await expect(page.locator('#squad-status')).toContainText("you're the guest · waiting for the host to confirm");
  });

  test('confirming keeps re-sending your squad every couple seconds until the match starts', async ({ page }) => {
    // Regression test in the same spirit: even once role is settled
    // correctly, a single sendSquad call has no delivery guarantee if it
    // races the data channel still finishing setup (or any other transient
    // hiccup over Trystero's public-relay signaling). _confirmSquad now
    // starts a retry loop, so a silently-dropped send gets a second chance
    // automatically instead of leaving both players stuck forever.
    await page.goto('/');
    await page.waitForFunction(
      () => document.querySelectorAll('#squad-pick-list .pick-card').length > 0,
      { timeout: 15000 }
    );
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.click('#pitch-randomize-btn');

    await page.evaluate(() => {
      const s = window.__scene;
      s.__sendSquadCalls = 0;
      s.net.sendSquad = () => { s.__sendSquadCalls++; };
    });
    await page.click('#confirm-squad-btn');
    expect(await page.evaluate(() => window.__scene.__sendSquadCalls)).toBe(1);
    expect(await page.evaluate(() => window.__scene.matchStarted)).toBe(false);

    // The retry loop fires again on its own, with nothing further clicked.
    await page.waitForFunction(() => window.__scene.__sendSquadCalls >= 2, { timeout: 5000 });

    // Once the opponent's squad genuinely arrives, the match starts and the
    // retry loop stops (checked implicitly: _startMatch clears it).
    const opponentStarters = await page.evaluate(() => {
      const s = window.__scene;
      const fakeSquad = { starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [...s.benchIds], formation: s.chosenFormation, color: '#336699' };
      s.remoteSquadPayload = fakeSquad;
      s._tryStartMultiplayerMatch();
      return fakeSquad.starterIds;
    });
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 5000 });
    const teamBIds = await page.evaluate(() => window.__scene.teamB.map((e) => e.id));
    expect(teamBIds).toEqual(opponentStarters);
    expect(await page.evaluate(() => window.__scene._squadRetryTimer)).toBeNull();
  });
});

test.describe('role assignment vs. a late-connecting peer', () => {
  test('re-derives role once a peer is actually known, but freezes it at kickoff', async ({ page }) => {
    // Regression test: role used to be decided once, synchronously, right
    // when the scene was created — before Trystero's WebRTC handshake had
    // any chance to complete. Two browsers loading the page at the same
    // moment each see "nobody else here yet" and both provisionally became
    // host ('A'), so a real two-player match ran as two independent,
    // disagreeing simulations instead of one host and one client. The fix
    // re-runs the host comparison (_syncRoleFromNet) once a peer is
    // actually known, via net.onPeerConnect.
    await waitForRosterLoaded(page);

    const solo = await page.evaluate(() => window.__scene.role);
    expect(solo).toBe('A'); // alone in the room = provisional host, as before

    const afterLateJoin = await page.evaluate(() => {
      const s = window.__scene;
      // Simulate what onPeerConnect fires after: a peer whose id sorts
      // after ours has now been detected, so the real comparison flips us
      // to 'B' — this is exactly what a stale, never-revisited role missed.
      // Only in Multiplayer: any other mode is always its own host.
      s.uiMode = 'multiplayer';
      const original = s.net.isHost;
      s.net.isHost = () => false;
      s._syncRoleFromNet();
      const role = s.role;
      s.net.isHost = original;
      return role;
    });
    expect(afterLateJoin).toBe('B');

    const afterMatchStart = await page.evaluate(() => {
      const s = window.__scene;
      s.matchStarted = true;
      const original = s.net.isHost;
      s.net.isHost = () => true; // even a genuine flip shouldn't apply mid-match
      s._syncRoleFromNet();
      const role = s.role;
      s.net.isHost = original;
      s.matchStarted = false;
      return role;
    });
    expect(afterMatchStart).toBe('B'); // unchanged — role is frozen once kickoff has happened
  });
});

// The squad editor's status line says where the start handshake stands, and
// squads are acknowledged, so a match that won't start explains itself and a
// dropped message gets recovered. The real network can't run here, so the
// scene's net object is stubbed: a connected peer, and every send recorded.
test.describe('connection status line and squad receipts', () => {
  async function multiWithPeer(page, { host = true, peers = 1 } = {}) {
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.evaluate(({ host, peers }) => {
      const s = window.__scene;
      s.__sent = [];
      s.net.sendSquad = (d) => { s.__sent.push(d); };
      s.net.isHost = () => host;
      s.net.hasPeer = () => peers > 0;
      s.net.peerCount = () => peers;
      s._syncRoleFromNet();
    }, { host, peers });
    await page.click('#pitch-randomize-btn');
  }
  test('an extra tab in the room is called out instead of silently confusing who is host', async ({ page }) => {
    await multiWithPeer(page, { peers: 2 });
    await expect(page.locator('#squad-status')).toContainText('There are 2 other players in room');
  });

  test('host: shows what has arrived, acknowledges the guest\'s squad, and starts', async ({ page }) => {
    await multiWithPeer(page, { host: true });
    await expect(page.locator('#squad-status')).toContainText("you're the host · opponent's squad: waiting · yours: not confirmed");
    await page.click('#confirm-squad-btn');
    await expect(page.locator('#squad-status')).toContainText('yours: ✓ confirmed, sending…');
    await page.evaluate(() => window.__scene._onRemoteSquad({ ack: true }));
    await expect(page.locator('#squad-status')).toContainText('yours: ✓ received by opponent');
    await page.evaluate(() => { const s = window.__scene; s._onRemoteSquad({ starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [], formation: s.chosenFormation }); });
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 5000 });
    expect(await page.evaluate(() => window.__scene.__sent.some((d) => d?.ack))).toBe(true);
  });

  test('once the opponent has acknowledged your squad, the resend loop stops sending it', async ({ page }) => {
    await multiWithPeer(page, { host: false });
    await page.click('#confirm-squad-btn');
    await page.evaluate(() => window.__scene._onRemoteSquad({ ack: true }));
    const before = await page.evaluate(() => window.__scene.__sent.filter((d) => d?.starterIds).length);
    await page.waitForTimeout(4500); // two retry ticks
    const after = await page.evaluate(() => window.__scene.__sent.filter((d) => d?.starterIds).length);
    expect(after).toBe(before);
    await expect(page.locator('#squad-status')).toContainText("you're the guest · waiting for the host to confirm · yours: ✓ received by opponent");
  });

  test('a guest whose match started without the host\'s squad asks for it, and the answer builds the teams', async ({ page }) => {
    await multiWithPeer(page, { host: false });
    await page.click('#confirm-squad-btn');
    // The host's first state arrives, but its squad was lost on the way.
    await page.evaluate(() => window.__scene._incomingState({ matchStarted: true }));
    expect(await page.evaluate(() => window.__scene.__sent.some((d) => d?.request))).toBe(true);
    // A host asked for its squad sends it again.
    const resent = await page.evaluate(() => {
      const s = window.__scene; s.__sent = [];
      s._onRemoteSquad({ request: true });
      return s.__sent;
    });
    expect(resent[0].starterIds).toHaveLength(11);
    // On the guest, that squad arriving is all the client teams were waiting for.
    await page.evaluate(() => { const s = window.__scene; s._onRemoteSquad({ starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [], formation: s.chosenFormation }); s._buildClientTeams(); });
    expect(await page.evaluate(() => window.__scene.clientTeamsBuilt)).toBe(true);
  });
});

// Every page joins the room in its URL on load, so someone on a shared link
// who picks Solo (or a tournament or story) is "in the room" too. None of
// their game may leak into it, or the other player hosts or draws someone
// else's match.
test.describe('only Multiplayer plays over the network', () => {
  test('a Solo match with someone else in the room stays local: own host, AI opponent, nothing sent', async ({ page }) => {
    await waitForRosterLoaded(page); // picks Solo
    await page.evaluate(() => {
      const s = window.__scene;
      s.__sent = [];
      for (const k of ['sendSquad', 'sendState', 'sendInput']) s.net[k] = (d) => { s.__sent.push(k); };
      s.net.hasPeer = () => true; s.net.peerCount = () => 1;
      s.net.isHost = () => false; // the other player's id sorts first
      s._syncRoleFromNet();
    });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      // A multiplayer opponent's squad and state reaching us are ignored too.
      s._onRemoteSquad({ starterIds: ['x'] });
      s._incomingState({ matchStarted: true });
      return { role: s.role, sent: s.__sent, aiStatMul: s._aiStatMul('B'), remote: s.remoteSquadPayload, badge: document.getElementById('mode-badge').textContent };
    });
    expect(r.role).toBe('A');
    expect(r.sent).toEqual([]);
    expect(r.aiStatMul).toBe(1.04); // Normal's AI is playing side B, not a remote player
    expect(r.remote ?? null).toBeNull();
    expect(r.badge).toContain('Solo');
  });

  test('two hosts are detected and flagged instead of drawing a mix of both matches', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.evaluate(() => {
      const s = window.__scene;
      s.net.sendSquad = () => {}; s.net.hasPeer = () => true; s.net.peerCount = () => 1;
    });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.evaluate(() => { const s = window.__scene; s._onRemoteSquad({ starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [], formation: s.chosenFormation }); });
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 5000 });
    await expect(page.locator('#mode-badge')).toHaveText('👥 Multiplayer · host');
    // State from the other side means it is hosting its own match as well.
    await page.evaluate(() => window.__scene._incomingState({ matchStarted: true, ball: { x: 0, y: 0 } }));
    await expect(page.locator('#mode-badge')).toHaveText('⚠ Both players are hosting');
    expect(await page.evaluate(() => window.__scene.remoteState)).toBeNull();
  });
});

// The host is the lowest id in the room. Our own id must be Trystero's real
// one: it used to be read from room.selfId, which doesn't exist, and every
// comparison against that undefined made both players guests — then, once
// the rule was flipped, both hosts.
test.describe('host is the lowest id in the room', () => {
  test('our own id is a real Trystero id, not undefined', async ({ page }) => {
    await waitForRosterLoaded(page);
    const id = await page.evaluate(() => window.__scene.net.selfId);
    expect(typeof id).toBe('string');
    expect(id).toHaveLength(20);
  });

  test('of two players exactly one is host, seen from either side; of three, only the lowest', async ({ page }) => {
    await waitForRosterLoaded(page);
    const r = await page.evaluate(async () => {
      const { isLowestId } = await import('/src/network/network.js');
      const a = 'AAAAbbbbccccddddeeee', b = 'ZZZZbbbbccccddddeeee', c = 'MMMMbbbbccccddddeeee';
      let threw = false;
      try { isLowestId(undefined, [a]); } catch { threw = true; }
      return {
        pair: [isLowestId(a, [b]), isLowestId(b, [a])],
        trio: [isLowestId(a, [b, c]), isLowestId(b, [a, c]), isLowestId(c, [a, b])],
        alone: isLowestId(b, []),
        threw,
      };
    });
    expect(r.pair).toEqual([true, false]);
    expect(r.trio).toEqual([true, false, false]);
    expect(r.alone).toBe(true);
    expect(r.threw).toBe(true);
  });
});


// Guest responsiveness: less traffic on the reliable channel, taps delivered
// exactly once, rarely-changing state sent only when it changes, and the
// guest's own drawn runs moving at once instead of after the round trip.
test.describe('guest responsiveness', () => {
  async function multiplayer(page, { host }) {
    await page.goto('/');
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');
    await page.click('#mode-multi-btn');
    await page.click('#mode-multi-start-btn');
    await page.evaluate((host) => {
      const s = window.__scene;
      s.__inputs = []; s.__states = [];
      s.net.sendInput = (d) => s.__inputs.push({ t: performance.now(), d });
      s.net.sendState = (d) => s.__states.push(d);
      s.net.sendSquad = () => {};
      s.net.ping = async () => 42;
      s.net.isHost = () => host; s.net.hasPeer = () => true; s.net.peerCount = () => 1;
      s._syncRoleFromNet();
    }, host);
  }
  // A host match against a stubbed peer, so its outgoing states can be read.
  async function hostMatch(page) {
    await multiplayer(page, { host: true });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.evaluate(() => { const s = window.__scene; s._onRemoteSquad({ starterIds: s.squadSlots.filter(Boolean).slice().reverse(), benchIds: [], formation: s.chosenFormation }); });
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 5000 });
  }

  test('the guest sends input a few times a second when idle, and a tap at once; the host sends none', async ({ page }) => {
    await multiplayer(page, { host: false });
    await page.evaluate(() => { window.__scene.__inputs = []; });
    await page.waitForTimeout(1000);
    const idle = await page.evaluate(() => window.__scene.__inputs.length);
    expect(idle).toBeGreaterThanOrEqual(3);
    expect(idle).toBeLessThanOrEqual(6); // a heartbeat every 250ms, not ~60 a second
    const tap = await page.evaluate(async () => {
      const s = window.__scene; s.__inputs = [];
      s.pendingPass = { x: 300, y: 400 };
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return s.__inputs.map((i) => i.d.passTarget).filter(Boolean);
    });
    expect(tap).toEqual([{ x: 300, y: 400 }]);

    const host = await page.evaluate(async () => {
      const s = window.__scene;
      s.net.isHost = () => true; s._syncRoleFromNet(); s.__inputs = [];
      await new Promise((r) => setTimeout(r, 500));
      return s.__inputs.length;
    });
    expect(host).toBe(0);
  });

  test('host: a tap followed by another message before the next frame is still used, once', async ({ page }) => {
    await multiplayer(page, { host: true });
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s._latchInput({ targets: [], passTarget: { x: 1, y: 2 } });
      s._latchInput({ targets: [{ id: 'x', x: 5, y: 5 }] }); // arrives before the host's frame
      const held = s.remoteInput.passTarget;
      const targets = s.remoteInput.targets.length;
      s._clearRemoteOneShots(); // what the host does after its frame
      return { held, targets, after: s.remoteInput.passTarget };
    });
    expect(r.held).toEqual({ x: 1, y: 2 });
    expect(r.targets).toBe(1);
    expect(r.after).toBeNull();
  });

  test('host: an offside freeze keeps sending state, so the guest sees the flag and the drop-back during it', async ({ page }) => {
    await hostMatch(page);
    const r = await page.evaluate(async () => {
      const s = window.__scene;
      s._commitOffside('A', s.time.now);
      s.__states = [];
      await new Promise((res) => setTimeout(res, 600));
      const st = s.__states.filter((d) => d.matchStarted);
      return { paused: s.paused, count: st.length, banner: st.some((d) => d.confrontResult?.title?.toLowerCase().includes('offside')) };
    });
    expect(r.paused).toBe(true); // still inside the 1.5s freeze
    expect(r.count).toBeGreaterThan(3);
    expect(r.banner).toBe(true);
  });

  test('host state: 30 a second, whole-pixel positions, squads only when they change or every 2s', async ({ page }) => {
    await hostMatch(page);
    // Counted against the frames actually rendered: a slow headless page
    // runs ~25 fps here, and states can only go out on frames.
    const r = await page.evaluate(async () => {
      const s = window.__scene; s.__states = [];
      let frames = 0; const t0 = performance.now();
      await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < 2600) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      const st = s.__states.filter((d) => d.matchStarted);
      return {
        count: st.length, expected: Math.min(frames, 30 * 2.6),
        withIds: st.filter((d) => d.starterIds).length,
        intPositions: st.every((d) => Number.isInteger(d.ball.x) && d.teamA.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y))),
      };
    });
    expect(r.count).toBeGreaterThan(r.expected * 0.6); // ~30/s, or every frame on a slower page (was 20/s)
    expect(r.withIds).toBeGreaterThanOrEqual(1); // the 2s keyframe
    expect(r.withIds).toBeLessThanOrEqual(3);
    expect(r.intPositions).toBe(true);
  });

  test('guest: states merge, and its own drawn run moves at once, pulled back when the host disagrees', async ({ browser }) => {
    // A real host state, captured from a host page…
    const hostPage = await browser.newPage();
    await hostMatch(hostPage);
    await hostPage.waitForTimeout(400);
    const { state, hostSquad } = await hostPage.evaluate(() => {
      const s = window.__scene;
      const st = s.__states.filter((d) => d.matchStarted);
      const full = st.reduce((acc, d) => ({ ...acc, ...d }), {});
      return { state: full, hostSquad: s.mySquadPayload };
    });
    await hostPage.close();

    // …fed to a guest whose squad is the host's side B.
    const page = await browser.newPage();
    await multiplayer(page, { host: false });
    const r = await page.evaluate(({ state, hostSquad }) => {
      const s = window.__scene;
      s.mySquadPayload = { starterIds: state.starterIds.b, benchIds: [], formation: '4-4-2' };
      s.mySquadConfirmed = true;
      s.remoteSquadPayload = hostSquad;
      s._incomingState(state);
      s._buildClientTeams();
      // A later state without the squads keeps them.
      const { starterIds, benchIds, maxSp, maxStamina, ...slim } = state;
      s._incomingState(slim);
      const kept = !!s.remoteState.starterIds;
      // Our player 5 draws a run 200px to the right; the host hasn't moved it yet.
      const e = s.teamB[5], p = state.teamB[5];
      e.gfx.x = p.x; e.gfx.y = p.y;
      s.myPaths.set(e.id, [{ x: p.x + 200, y: p.y }]);
      for (let i = 0; i < 10; i++) s._clientUpdate(performance.now(), 16.67);
      const lead = e.gfx.x - p.x;
      // The host has it 100px the other way (say it was knocked back).
      s.myPaths.delete(e.id);
      const far = { ...state, teamB: state.teamB.map((q, i) => (i === 5 ? { x: p.x - 100, y: p.y } : q)) };
      s._incomingState(far);
      const before = Math.abs(e.gfx.x - (p.x - 100));
      s._clientUpdate(performance.now(), 16.67);
      const after = Math.abs(e.gfx.x - (p.x - 100));
      return { kept, lead, before, after };
    }, { state, hostSquad });
    expect(r.kept).toBe(true);
    expect(r.lead).toBeGreaterThan(2); // ahead of the host's (stale) position, toward the waypoint
    expect(r.after).toBeLessThan(r.before * 0.7);
  });
  test('stamina reaches the guest: the host sends whole percents, and a tired player shows the drop there too', async ({ browser }) => {
    const hostPage = await browser.newPage();
    await hostMatch(hostPage);
    // Make two of the host's own and one of the rival's players tired, then read what it sends.
    const { state, hostSquad, tiredIds } = await hostPage.evaluate(async () => {
      const s = window.__scene;
      const setPct = (role, i, pct) => { const e = (role === 'A' ? s.teamA : s.teamB)[i]; const st = s._statsFor(role, e.id); st.stamina = st.maxStamina * pct / 100; return e.id; };
      const ids = { a3: setPct('A', 3, 30), a4: setPct('A', 4, 10), b2: setPct('B', 2, 25) };
      await new Promise((r) => setTimeout(r, 500));
      // Merged oldest to newest, as a guest does: the squads from the first
      // state, the stamina from the latest.
      const st = s.__states.filter((d) => d.matchStarted);
      return { state: st.reduce((acc, d) => ({ ...acc, ...d }), {}), hostSquad: s.mySquadPayload, tiredIds: ids };
    });
    await hostPage.close();
    expect(state.statsAll.stam.a[3]).toBe(30);
    expect(state.statsAll.stam.a[4]).toBe(10);
    expect(state.statsAll.stam.b[2]).toBe(25);

    const page = await browser.newPage();
    await multiplayer(page, { host: false });
    const r = await page.evaluate(({ state, hostSquad }) => {
      const s = window.__scene;
      s.mySquadPayload = { starterIds: state.starterIds.b, benchIds: [], formation: '4-4-2' };
      s.mySquadConfirmed = true;
      s.remoteSquadPayload = hostSquad;
      s._incomingState(state);
      s._buildClientTeams();
      s._syncClientIds(s.remoteState);
      s._highlightActive();
      const drops = (team, i) => team[i].gfx.px.drops.map((d) => d.visible);
      return { a3: drops(s.teamA, 3), a4: drops(s.teamA, 4), b2: drops(s.teamB, 2), fresh: drops(s.teamA, 5), lvl: s._tiredLevel('A', s.teamA[3].id) };
    }, { state, hostSquad });
    expect(r.a3).toEqual([true, false]);   // 30%: tired
    expect(r.a4).toEqual([true, true]);    // 10%: exhausted
    expect(r.b2).toEqual([true, false]);
    expect(r.fresh).toEqual([false, false]);
    expect(r.lvl).toBe(1);
  });
});
