// Trystero's BitTorrent-tracker strategy (trystero 0.20.1, src/torrent.js,
// MIT, © Dan Motzenbecker), copied here so two devices find each other
// faster. Two browsers only meet through a tracker "announce" (each sends
// WebRTC offers the tracker forwards to the other), and Trystero announces
// once on joining and then only every 33s, stretched up to 2 minutes when a
// tracker asks for a longer interval. After both players reload, a first
// exchange that misses meant waiting that long for the next try.
//
// What's different from the original:
//  - While nobody else is connected ("searching") it announces every
//    SEARCH_ANNOUNCE_MS, ignoring the tracker's longer interval. Once the
//    rival is connected it drops back to Trystero's own pace, so a match
//    doesn't keep signalling. network.js flips it with setSearching().
//  - Each announce carries OFFERS_PER_ANNOUNCE offers instead of 10: a room
//    is two players (plus at most a stray extra tab), and every offer is a
//    WebRTC connection made up front, so the faster pace stays cheap.
//  - Offers nobody answered are closed once KEEP_BATCHES newer announces
//    have gone out. The original never closes them, which at its slow pace
//    is ~1 a second; at the searching pace it would pile up to the
//    browser's connection limit within minutes. An answer to any offer
//    still kept is used (the original only matched the latest announce's).
//
// Trystero's core (strategy, utils, crypto) isn't in its package "exports",
// so it's imported by path; the version is pinned in package-lock.json.
import { sha1 } from '../../node_modules/trystero/src/crypto.js';
import strategy from '../../node_modules/trystero/src/strategy.js';
import {
  entries,
  genId,
  fromEntries,
  fromJson,
  getRelays,
  libName,
  makeSocket,
  selfId,
  toJson,
} from '../../node_modules/trystero/src/utils.js';

export { selfId };

export const SEARCH_ANNOUNCE_MS = 3_000;
export const IDLE_ANNOUNCE_MS = 33_333; // Trystero's own default
export const MAX_ANNOUNCE_MS = 120_333; // Trystero's own cap on a tracker's interval
const OFFERS_PER_ANNOUNCE = 3;
const KEEP_BATCHES = 2;
const hashLimit = 20;
const defaultRedundancy = 3;
const trackerAction = 'announce';

/** How long until the next announce: every few seconds while looking for
 *  the rival; once connected, the tracker's own interval (never below
 *  Trystero's default, never above its cap). */
export function announceDelay(searching, trackerIntervalMs) {
  if (searching) return SEARCH_ANNOUNCE_MS;
  return Math.min(Math.max(trackerIntervalMs || IDLE_ANNOUNCE_MS, IDLE_ANNOUNCE_MS), MAX_ANNOUNCE_MS);
}

let searching = true;
export const isSearching = () => searching;

const clients = {};
const topicToInfoHash = {};
const infoHashToTopic = {};
const announceIntervals = {}; // url → topic → interval id
const announceFns = {}; // url → topic → announce()
const trackerIntervalMs = {}; // url → interval the tracker asked for
const handledOffers = {};
const msgHandlers = {};

const delayFor = (url) => announceDelay(searching, trackerIntervalMs[url]);

/** (Re)arms one tracker/topic's announce timer at the current pace. */
function arm(url, topic) {
  clearInterval(announceIntervals[url]?.[topic]);
  const fn = announceFns[url]?.[topic];
  if (!fn) return;
  (announceIntervals[url] ||= {})[topic] = setInterval(fn, delayFor(url));
}

/** Switches between looking for the rival (fast announces) and connected
 *  (Trystero's pace). Turning it on also announces at once, so a rival who
 *  just dropped out is looked for straight away. */
export function setSearching(on) {
  on = !!on;
  if (on === searching) return;
  searching = on;
  for (const url of Object.keys(announceFns)) {
    for (const topic of Object.keys(announceFns[url])) {
      arm(url, topic);
      if (on) announceFns[url][topic]();
    }
  }
}

const getInfoHash = async (topic) => {
  if (topicToInfoHash[topic]) return topicToInfoHash[topic];
  const hash = (await sha1(topic)).slice(0, hashLimit);
  topicToInfoHash[topic] = hash;
  infoHashToTopic[hash] = topic;
  return hash;
};

const send = async (client, topic, payload) =>
  client.send(toJson({ action: trackerAction, info_hash: await getInfoHash(topic), peer_id: selfId, ...payload }));

const warn = (url, msg, didFail) =>
  console.warn(`${libName}: torrent tracker ${didFail ? 'failure' : 'warning'} from ${url} - ${msg}`);

export const joinRoom = strategy({
  init: (config) =>
    getRelays(config, defaultRelayUrls, defaultRedundancy).map((rawUrl) => {
      const client = makeSocket(rawUrl, (rawData) => {
        const data = fromJson(rawData);
        const errMsg = data['failure reason'];
        const warnMsg = data['warning message'];
        const { interval } = data;
        const topic = infoHashToTopic[data.info_hash];

        if (errMsg) { warn(url, errMsg, true); return; }
        if (warnMsg) warn(url, warnMsg);

        // Remember what the tracker asked for; it only applies once we're
        // connected (see announceDelay), and only re-arms when it changes
        // the pace.
        if (interval && interval * 1000 > (trackerIntervalMs[url] || 0) && announceFns[url]?.[topic]) {
          const before = delayFor(url);
          trackerIntervalMs[url] = interval * 1000;
          if (delayFor(url) !== before) arm(url, topic);
        }

        if (handledOffers[data.offer_id]) return;
        if (data.offer || data.answer) {
          handledOffers[data.offer_id] = true;
          msgHandlers[url][topic]?.(data);
        }
      });

      const { url } = client;
      clients[url] = client;
      msgHandlers[url] = {};
      return client.ready;
    }),

  subscribe: (client, rootTopic, _, onMessage, getOffers) => {
    const { url } = client;

    const live = {}; // offer id → {peer, offer} still waiting for an answer
    const batches = []; // the ids each recent announce sent, oldest first
    const drop = (id) => { live[id]?.peer.destroy(); delete live[id]; };

    const announce = async () => {
      const offers = fromEntries(
        (await getOffers(OFFERS_PER_ANNOUNCE)).map((peerAndOffer) => [genId(hashLimit), peerAndOffer])
      );
      Object.assign(live, offers);
      batches.push(Object.keys(offers));
      while (batches.length > KEEP_BATCHES) batches.shift().forEach(drop);

      msgHandlers[client.url][rootTopic] = (data) => {
        if (data.offer) {
          onMessage(rootTopic, { offer: data.offer, peerId: data.peer_id }, (_, signal) =>
            send(client, rootTopic, {
              // certain trackers will reject if answer contains extra fields
              answer: fromJson(signal).answer,
              offer_id: data.offer_id,
              to_peer_id: data.peer_id,
            })
          );
        } else if (data.answer) {
          const offer = live[data.offer_id];
          if (offer) {
            delete live[data.offer_id]; // answered: Trystero owns it now
            onMessage(rootTopic, { answer: data.answer, peerId: data.peer_id, peer: offer.peer });
          }
        }
      };

      send(client, rootTopic, {
        numwant: OFFERS_PER_ANNOUNCE,
        offers: entries(offers).map(([id, { offer }]) => ({ offer_id: id, offer })),
      });
    };

    (announceFns[url] ||= {})[rootTopic] = announce;
    arm(url, rootTopic);
    announce();

    return () => {
      clearInterval(announceIntervals[url]?.[rootTopic]);
      delete msgHandlers[url][rootTopic];
      delete announceFns[url][rootTopic];
      Object.keys(live).forEach(drop);
    };
  },

  announce: (client) => delayFor(client.url),
});

export const defaultRelayUrls = [
  'tracker.webtorrent.dev',
  'tracker.openwebtorrent.com',
  'tracker.btorrent.xyz',
  'tracker.files.fm:7073/announce',
].map((url) => 'wss://' + url);
