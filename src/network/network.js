import { joinRoom } from 'trystero/torrent';

// APP_ID identifies this app inside Trystero's public signaling network.
const APP_ID = 'inazuma-clone-proto-v1';

// Signaling (how two browsers find each other before the direct WebRTC
// connection takes over) goes through public BitTorrent trackers, with no
// backend of our own. Nostr relays failed outright (dead DNS, expired
// certs, "not in our web of trust" rejections). BitTorrent trackers were
// judged failing too, but that test predates finding the ICE-servers bug
// patched in index.html, which made every connection fail after
// signaling no matter which strategy was used. So trackers plus TURN plus
// that fix hasn't actually been tried yet.

// Signaling alone isn't enough: the WebRTC connection itself also has to
// get through real home/mobile NATs. Trystero's own default ICE servers are STUN-only
// (a handful of Google/Twilio addresses, see node_modules/trystero/src/
// peer.js), and STUN alone only helps two peers discover their public
// address; it can't get through every NAT type real home/mobile networks
// use. Getting through those needs a TURN server, which relays the actual
// connection when a direct path isn't possible — hence a free TURN
// account (metered.ca) instead of relying on defaults that were never
// going to cover this.
//
// This is fetched once, up front, rather than passed as a fixed
// credential: Metered's TURN credentials are short-lived and generated
// per request, and Trystero pre-builds a pool of WebRTC offers using
// whatever rtcConfig is current the moment the room is first joined (see
// strategy.js's offerPool) — mutating it after the fact wouldn't reach
// connections already in that pool. A generous timeout with a STUN-only
// fallback means a slow/unreachable TURN endpoint delays the app briefly
// rather than ever hanging it, or leaves same-network/lucky-NAT matches
// working exactly as before even if TURN is unavailable.
const METERED_TURN_URL =
  'https://inazuma-showdown.metered.live/api/v1/turn/credentials?apiKey=922b1bfcaf59dce7f9f41bbf80f490d95b0f';
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

async function fetchIceServers() {
  try {
    const res = await withTimeout(fetch(METERED_TURN_URL), 4000);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[net] could not fetch TURN credentials, falling back to STUN-only (may fail behind strict NATs):', err);
    return FALLBACK_ICE_SERVERS;
  }
}

const ICE_SERVERS = await fetchIceServers();
// Exposed for index.html's RTCPeerConnection wrapper to actually use — see
// the comment there for why: Trystero's rtcConfig option doesn't reach a
// real connection in the currently-resolved trystero/simple-peer version
// pairing, so the fetched TURN servers have to be patched in at the point
// the browser's own RTCPeerConnection gets constructed instead.
if (typeof window !== 'undefined') window.__iceServers = ICE_SERVERS;

/**
 * Connects to a P2P "room" using a code shared between the two players
 * (e.g. the URL's ?room=ABCD).
 *
 * Returns:
 *  - selfId: this client's unique id
 *  - isHost(): true if this client should simulate physics (host-authoritative)
 *  - hasPeer(): true if a human opponent is currently connected
 *  - onPeerJoin/onPeerLeave: connection events
 *  - sendInput / onInput: the client sends its movement/shoot/choice intent
 *  - sendState / onState: the host broadcasts the resulting match state
 *  - sendSquad / onSquad: each player sends their chosen starter + bench
 */
export function connectToRoom(roomCode) {
  const room = joinRoom({ appId: APP_ID, rtcConfig: { iceServers: ICE_SERVERS } }, roomCode);

  const [sendInput, onInput] = room.makeAction('input');
  const [sendState, onState] = room.makeAction('state');
  const [sendSquad, onSquad] = room.makeAction('squad');

  const selfId = room.selfId;
  let peerId = null; // the opponent's id, filled in once they connect

  // Host = whichever peer's id sorts first alphabetically between the two.
  // This is deterministic: both browsers reach the same conclusion without
  // needing to negotiate it explicitly. Note this is only "provisional"
  // while peerId is still null — see onPeerConnect below for why callers
  // can't just read it once at page load and assume it's final.
  function isHost() {
    if (!peerId) return true; // alone in the room = provisional host
    return selfId < peerId;
  }

  let externalJoinHandler = null;
  room.onPeerJoin((id) => {
    peerId = id;
    console.log('[net] opponent connected:', id, 'am I host?', isHost());
    // The WebRTC handshake takes real time, so isHost() called right at
    // page load (before either browser knows the other exists) always
    // sees "alone in the room" and both sides provisionally become host —
    // that's fine as a solo-vs-AI default, but wrong the instant a real
    // peer shows up. Let the caller re-derive its role now that peerId is
    // actually known, instead of running the whole match on a stale guess.
    if (externalJoinHandler) externalJoinHandler(id);
  });

  room.onPeerLeave((id) => {
    console.log('[net] opponent disconnected:', id);
    peerId = null;
  });

  /** true if there's no human opponent connected right now (used to trigger the AI) */
  function hasPeer() {
    return peerId !== null;
  }

  /** Fires once, right after a peer's id is known (see isHost's note above). */
  function onPeerConnect(fn) {
    externalJoinHandler = fn;
  }

  return { room, selfId, isHost, hasPeer, onPeerConnect, sendInput, onInput, sendState, onState, sendSquad, onSquad };
}

/** Generates or reads a short room code from the URL (?room=XXXX). */
export function getOrCreateRoomCode() {
  const params = new URLSearchParams(window.location.search);
  let code = params.get('room');
  if (!code) {
    code = Math.random().toString(36).slice(2, 7).toUpperCase();
    params.set('room', code);
    window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
  }
  return code;
}
