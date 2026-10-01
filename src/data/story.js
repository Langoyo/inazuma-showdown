// Story mode: play one game's canonical run, rival by rival, in order —
// IE1's Football Frontier from the first practice match against Royal to
// the final against Zeus, and so on. Like tournament.js this is plain data
// in, plain data out (no DOM, no Phaser, no roster): GameScene turns a step
// into an actual opposing XI (see _storySteps / _setRivalToEntrant).
//
// Each step names a team as the roster spells it, in that run's game. A
// step whose team doesn't have enough named players in the roster (see
// STORY_MIN_PLAYERS) is left out when the run is resolved rather than
// fielding a team of strangers. The orders follow the games' stories as
// closely as the roster allows; reordering a run is just editing its list.

const STORY_KEY = 'inazuma-clone:story:v1';

/** A team needs this many of its own players to be a story opponent; any
 *  gap left in the XI is filled like a hand-built rival's (see
 *  _rivalSquadPayload). */
export const STORY_MIN_PLAYERS = 10;

export const STORY_RUNS = [
  {
    id: 'ie1', game: 'IE1', title: 'Football Frontier', hero: 'Raimon',
    steps: [
      { team: 'Royal', note: 'The practice match that saved the club' },
      { team: 'Occult', note: 'Practice match' },
      { team: 'Wild', note: 'Regional qualifiers, round 1' },
      { team: 'Brainwashing', note: 'Regional qualifiers, round 2' },
      { team: 'Otaku', note: 'Regional semi-final' },
      { team: 'Royal', note: 'Regional final' },
      { team: 'Shuriken', note: 'Nationals, round 1' },
      { team: 'Farm', note: 'Nationals, round 2' },
      { team: 'Kirkwood', note: 'Nationals semi-final' },
      { team: 'Zeus', note: 'Football Frontier final' },
    ],
  },
  {
    id: 'ie2', game: 'IE2', title: 'Alius Academy', hero: 'Raimon',
    steps: [
      { team: 'Gemini Storm', note: 'The invasion begins' },
      { team: 'Epsilon', note: 'Second Rank' },
      { team: 'Diamond Dust', note: 'Master Rank' },
      { team: 'Prominence', note: 'Master Rank' },
      { team: 'Chaos', note: 'Prominence and Diamond Dust combined' },
      { team: 'Dark Emperors', note: 'Old friends, Alius stones' },
      { team: 'Genesis', note: 'Alius Academy, the Genesis' },
    ],
  },
  {
    id: 'ie3', game: 'IE3', title: 'Football Frontier International',
    steps: [
      { team: 'Big Waves', note: 'Asia preliminaries' },
      { team: 'Desert Lions', note: 'Asia preliminaries' },
      { team: 'Fire Dragon', note: 'Asia final' },
      { team: 'Knights of Queen', note: 'Liocott Island, group stage' },
      { team: 'The Kingdom', note: 'Group stage' },
      { team: 'Unicorn', note: 'Group stage' },
      { team: 'Orpheus', note: 'Group stage' },
      { team: 'The Empire', note: 'Semi-final' },
      { team: 'Little Gigantes', note: 'FFI final' },
    ],
  },
  {
    id: 'go1', game: 'GO1', title: 'Holy Road', hero: 'Raimon',
    steps: [
      { team: 'Eito', note: 'Under Fifth Sector rule' },
      { team: 'Bannouzaka', note: 'Holy Road qualifiers' },
      { team: 'Amagawara', note: 'Holy Road qualifiers' },
      { team: 'Kaiou', note: 'Holy Road, round 1' },
      { team: 'Alpine', note: 'Holy Road, round 2' },
      { team: 'Kirkwood', note: 'Holy Road quarter-final' },
      { team: 'Genei', note: 'Holy Road semi-final' },
      { team: 'Dragon Link', note: 'Holy Road final' },
    ],
  },
  {
    id: 'go2', game: 'GO2', title: 'Chrono Stone',
    steps: [
      { team: 'Protocol Omega', note: 'El Dorado strikes' },
      { team: 'Protocol Cascade', note: 'Protocol Omega, upgraded' },
      { team: 'The Terracotta Army', note: 'Across the ages' },
      { team: 'Zero Domain', note: 'Ragnarok' },
      { team: 'Zan', note: 'Ragnarok' },
      { team: 'Giru', note: 'Ragnarok' },
      { team: 'Garu', note: 'Ragnarok final' },
    ],
  },
  {
    id: 'go3', game: 'GO3', title: 'Galaxy',
    steps: [
      { team: 'Big Waves', note: 'FFIV2 Asia preliminaries' },
      { team: 'Shamshir', note: 'Asia preliminaries' },
      { team: 'Muay Tigers', note: 'Asia preliminaries' },
      { team: 'Fire Dragon', note: 'Asia final' },
      { team: 'Silica Eleven', note: 'Grand Celesta Galaxy' },
      { team: 'Fertilia Eleven', note: 'Grand Celesta Galaxy' },
      { team: 'Supernova', note: 'Grand Celesta Galaxy' },
      { team: 'Big Bang', note: 'Grand Celesta Galaxy final' },
    ],
  },
];

export function getStoryRun(id) {
  return STORY_RUNS.find((r) => r.id === id) || null;
}

/** A fresh run: your locked-in squad (and half length) for every match. */
export function startStory(runId, mySquad, halfLengthS) {
  return { runId, step: 0, mySquad, halfLengthS, results: [], startedAt: Date.now(), completedAt: null };
}

/** One played step: a win moves the run on (finishing it after the last
 *  step), anything else leaves you on the same step to try again. Every
 *  attempt is kept in `results`. */
export function recordStoryResult(state, myGoals, oppGoals, totalSteps) {
  const won = myGoals > oppGoals;
  const step = won ? state.step + 1 : state.step;
  return {
    ...state,
    results: [...state.results, { step: state.step, myGoals, oppGoals, won }],
    step,
    completedAt: won && step >= totalSteps ? Date.now() : state.completedAt,
  };
}

export function saveStory(s) {
  try { localStorage.setItem(STORY_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
export function loadStory() {
  try { return JSON.parse(localStorage.getItem(STORY_KEY) || 'null'); } catch { return null; }
}
export function clearStory() {
  try { localStorage.removeItem(STORY_KEY); } catch { /* storage unavailable */ }
}
