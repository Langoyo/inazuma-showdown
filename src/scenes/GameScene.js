import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate, techniquesFor, NATIVE_STATS, statMul } from '../data/players.js';
import { loadRoster, getPlayerById, getGames } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';
import { makeSeededKnockout, makeLeague, recordKnockoutResult, recordLeagueResult, leagueStandings, advanceAuto, saveTournament, loadTournament, clearTournament } from '../data/tournament.js';
import { playKick, playPass, playGoal, playWhistle, playGkSave, isSfxEnabled, setSfxEnabled } from '../audio/sfx.js';
import { initAuthSession, getUser, onAuthChange, describeUser, signUpWithEmail, signInWithEmail, signOutUser } from '../auth/auth.js';
import { saveFormationToProfile, listSavedFormations, deleteSavedFormation } from '../auth/profile.js';

// ─── Constants ────────────────────────────────────────────────────────────
// The logical field is big — the VIEWPORT (what the canvas shows) is smaller.
// Scroll is handled by moving the Phaser camera over the world.
const FIELD_LOGICAL_W   = 960;   // world size (px)
const FIELD_LOGICAL_H   = 1520;
const VIEWPORT_W        = 480;   // canvas size — what the player actually sees
const VIEWPORT_H        = 760;
const GOAL_HALF_WIDTH   = 70;
const GOAL_CLICK_MARGIN = 80;
// Room behind each goal line. The pitch itself still ends at the line, but the
// camera may scroll past it, so the goal can sit in the middle of the screen
// instead of jammed under the scoreboard or the PT bar. GOAL_DEPTH is how far
// the goal box reaches back — a box is a far easier tap target than a line.
const GOAL_RUNOFF       = 170;
const GOAL_DEPTH        = 90;
// How long the full-time screen stays up before it drops back to the menu.
const FULLTIME_MENU_MS  = 9000;
const WAYPOINT_RADIUS   = 20;
const MIN_PATH_PT_DIST  = 18;
const PLAYER_SEL_RADIUS = 36;
const DRAG_THRESHOLD    = 14;
// Squad editor / sub panel pins and cards: press and hold one to view its
// stats, instead of the old double-tap (see _armPressGestures). The move
// tolerance cancels the hold if it turns into a scroll/drag rather than a
// still press.
const LONG_PRESS_MS          = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const PASS_MARKER_MS    = 400; // how long the tap-to-pass marker stays on screen
const CONFRONT_MS       = 20000;
// Shots lose steam with distance: full power up close, easing down to a
// floor the farther out the shooter is. Values in px on the 1520-tall pitch.
const SHOT_FALLOFF_NEAR = 150;   // no penalty inside this range
const SHOT_FALLOFF_FAR  = 900;   // power bottoms out at/beyond this range
const SHOT_FALLOFF_MIN  = 0.45;  // floor multiplier at max range
// Any shot with an opposing outfield player standing in its path (not the
// keeper — they're the last line, box or no box) triggers a block attempt
// first: that defender can spend a supertechnique to try to stop it
// outright, same as a duel — or deliberately do nothing (e.g. save the PT
// for later). Losing that roll doesn't kill the shot, just costs it more
// power — it's already weakened by distance — before it reaches the keeper.
const BLOCK_MIN_DIST     = 0;    // any shot can be walled, penalty box included
const BLOCK_CORRIDOR_HALF= 70;   // how far off the direct shot line still counts as "in the way"
const BLOCK_PASS_PENALTY = 0.8;  // extra power lost grazing past a beaten blocker
const RESULT_MS         = 3500;
const RESULT_DELAY_MS   = 800;
// Once both sides have chosen, the duel holds on a VS card for a beat before
// anything moves: both moves are shown facing each other, then the winner's
// card lights up. Pure pacing — play is frozen for the whole window anyway.
const DUEL_REVEAL_MS     = 1900;
const DUEL_REVEAL_LIT_MS = 850;
const POSSESS_OFFSET    = 24;
// The ball's air friction decays its speed geometrically, so a kick covers
// roughly speed/BALL_FRICTION_AIR before dying. Passes therefore scale their
// speed to the distance instead of using one fixed value — at a flat 4.5 a
// pass always died after ~250px, well short of anything but a short ball.
// Kept in one place so the ball body and the pass maths can't drift apart.
const BALL_FRICTION_AIR = 0.018;
const PASS_REACH_BOOST  = 1.12;  // arrive with a bit of pace rather than stopping dead
const PASS_MIN_SPEED    = 3.0;
const PASS_MAX_SPEED    = 16;    // below the ball+player radius sum, so it can't tunnel through anyone
// Passes are chipped rather than rolled. The ball is airborne over the first
// stretch of its flight and can't be intercepted there, so a defender sitting
// on the passer gets played over instead of blocking everything; it lands well
// short of the target, so whoever marks the receiver can still read it.
const PASS_LOFT_FRAC    = 0.55;  // share of the pass distance spent in the air
const PASS_LOFT_MIN     = 55;    // even a short ball gets a little hop (px)
const KNOCKBACK_SPEED   = 1.8;   // was 4 — nearly as fast as a pass, which could fling the
                                  // ball if it clipped the ball on the way (see _moveTeam's
                                  // stun handling, which also keeps the ball from hitting them)
const STUN_MS           = 2500;  // how long the loser is frozen after a duel
// Fatigue: physical condition (stamina, from each player's roster FP) drains
// at a flat rate all match — it's the size of the tank that varies per
// player, not the burn rate. Tuned against the roster's average FP (~150)
// over a full 6-minute match (2x HALF_S) so an average player is running on
// empty by full time. Only kicks in once stamina drops under the threshold,
// easing speed down to the floor multiplier rather than a hard cliff.
const FATIGUE_DRAIN_PER_SEC = 150/(2*180);
const FATIGUE_THRESHOLD  = 0.4;  // fraction of maxStamina below which speed starts to drop
const FATIGUE_MIN_MUL    = 0.55; // speed multiplier floor at 0 stamina
const TEAM_SIZE         = 11;
const BENCH_MAX         = 5;
const BENCH_COVER       = ['GK','DF','MF','FW','MF']; // positions the auto-picked bench covers
const HALF_S            = 3 * 60;
const HALFTIME_PAUSE_MS = 3000; // how long play freezes for the half-time break
const GOAL_PAUSE_MS     = 2500; // how long play freezes to show the goal banner
const AI_SUB_CHECK_MS   = 8000; // how often the AI reconsiders its own lineup
const AI_SUB_STAMINA    = 0.35; // fraction of maxStamina below which a player becomes a sub candidate
const AI_MAX_SUBS       = 3;    // matches the real substitution limit
const STATE_HZ          = 20;
const SCROLL_SPEED      = 340;   // px/s when a scroll button is held (was 220 — asked for faster)

// Physics forces — the ball carrier is only slightly sharper than everyone
// else now; off-ball players used to crawl (AUTO_STEER_FORCE/MAX_SPEED were
// ~65% of the carrier's), which made the team look frozen even though
// _offBallTarget was constantly recomputing good runs for them — they just
// couldn't get there with any urgency.
const STEER_FORCE           = 0.00034;
const AUTO_STEER_FORCE      = 0.00032;
// The general pace lever: 0.684/0.627 originally, +5% to undo the slowdown
// that recomputing every player's stats straight from InazumaElevenAPI
// caused (it dropped the average `speed` stat specifically by ~5%,
// 0.956 -> 0.911, since that one is a 1:1 map of the raw Agility stat
// rather than an average of two like the others, so it took the
// recompute's own noise more directly), then +7% on top by preference —
// back at the old pace it just still read as sluggish. These are what
// actually decide top speed: the steering force alone would settle
// around 1.1 against the players' 0.16 air friction, so the cap is what
// every run hits, and a nudge here shows up almost in full.
const BASE_MAX_SPEED        = 0.768;
const AUTO_MAX_SPEED        = 0.704;
// A player following a drawn line sprints: draw somewhere and it's a
// deliberate run, so they push harder and cap out faster than everyone
// else — but only as much as their legs currently allow. The bonus scales
// with their CURRENT stamina (not just speed's own fatigue cutoff below),
// so it fades out well before a player is fully gassed instead of being a
// flat boost right up until they hit the wall.
const SPRINT_MAX_SPEED_BONUS = 0.18; // +18% top speed at full stamina, tapering to +0%
const SPRINT_MAX_FORCE_BONUS = 0.15;

// Off-ball behaviour: how strongly teammates push forward to support the
// ball carrier, and how close a defender presses the opponent on the ball.
const SUPPORT_BLEND  = 0.65;
// Was 0.5/260 — on a 960-wide pitch that let well over half the width
// press at once, and each pulled hard enough toward the ball to swamp
// their own formation spot, so the whole side (wingers included) visibly
// collapsed into a knot around the ball instead of holding their lanes.
// Fewer players engage now, and the ones who do keep more of their own
// spot's pull, so it reads as a press from whoever's actually close
// rather than the entire team caving inward.
const PRESS_BLEND    = 0.35;
const PRESS_RANGE    = 190;

// How much the AI ball carrier's per-tick pass chance (AI_LEVELS.passChance)
// gets scaled when nobody's actually marking them closely — same PRESS_RANGE
// used to decide whether a defender is pressing doubles as "am I under
// pressure" here. Passing at a flat rate regardless of pressure meant the
// AI kept lumping the ball off even in wide open space, reading as far too
// pass-happy; cut way down with nobody near, back to the tuned rate once
// someone's actually closing in.
const PASS_CHANCE_FREE_MULT = 0.25;

// The formation spans the whole pitch, not just the defending half: the
// deepest slot sits on its own goal line and the most advanced one pushes
// up near the rival box, so defenders/midfielders/forwards end up in their
// own thirds and there's room between the lines to actually pass into.
// SLOT_Y_* is the range the FORMATIONS presets below are authored in.
const SLOT_Y_MIN  = 0.06;
const SLOT_Y_MAX  = 0.66;
const FORM_DEEPEST = 0.05;  // fraction of pitch length, measured from own goal
const FORM_HIGHEST = 0.84;
// Gap kept from the halfway line at kickoff/restart (goal, half-time) so
// both lines sit a little clear of it instead of players bunching right up
// against — or exactly on — the line itself.
const KICKOFF_HALF_GAP = 28;
// ...and how far back the side that isn't kicking off starts. Bunching both
// lines on the halfway line meant the kick-off was closed down before the
// first pass got away, so the defending side drops off well clear of the
// centre circle (radius 60) and the ball actually has somewhere to go.
const KICKOFF_DEFEND_GAP = 150;

// A loose ball is worth breaking shape for — whoever is closest chases it
// down at full speed, as does anyone it has been played right next to.
const BALL_CHASE_RANGE   = 210;
const KEEPER_CHASE_RANGE = 130;

// Elements, as the games have them: Fire → Wood → Air → Earth → Fire, each
// beating the next. (Air is the same element the later games label Wind or
// Water, and Earth the one they label Electric.) Having the edge in a
// confrontation is a nudge, not a trump card — a well-picked technique or a
// much better stat still decides most of them.
const ELEMENT_BEATS = { Fire:'Wood', Wood:'Air', Air:'Earth', Earth:'Fire' };
const ELEMENT_EDGE  = 1.15; // power multiplier for the favourable side
const ELEMENT_ICON  = { Fire:'🔥', Wood:'🌿', Air:'💨', Earth:'⚡' };
// Raises each side's relevant stat to this power before the win-chance
// ratio (see _prepareConfrontReveal) — stat differences on their own used to
// barely move a duel: a median dribbler against a median defender (the
// roster's two stat pools aren't centred the same, so even "average vs
// average" isn't quite 50/50 to start with) was only 54/46, and even the
// roster's best dribbler against its worst defender reached just 58/42.
// 2.0 puts that same median-vs-median matchup at ~60/40, which is the target.
// Re-calibrated down from 2.5 when the categories moved onto single native
// stats (see STAT_FIELD_FOR_TECH): a native stat has a wider spread than the
// two-stat average it replaced, so the same exponent would have overshot to
// ~62/38. Deliberately applied only to the stat, not to technique power or
// the element edge multiplier beside it, so spending PT on a supertechnique
// (24 vs up to 110, untouched by this) still swings a confrontation far
// more than any stat gap does — this makes stats matter more, not
// techniques matter less. Scale-free: it's the ratio of the two sides'
// stats that decides the roll, so it doesn't matter that these are raw game
// numbers (~95) rather than the ~1.0 multipliers they used to be.
const STAT_POWER_EXPONENT = 2.0;
// Same icons the stat grid uses for the stats behind shot/dribble/defense/
// keeper, reused here so a technique's category reads at a glance.
const TECH_CAT_ICON = { shot:'⚡', dribble:'💨', defense:'🛡', keeper:'🧤' };

// The two stats worth showing on a compact search-list card, per position —
// there's no room there for all seven, and one fixed pair for everyone told
// a keeper or a defender nothing about the one thing that actually matters
// for their job. Each pick is the position's main duty plus one supporting
// skill, carried over from the pairs chosen when these were still our own
// five stats: a keeper reads the game and stands up to pressure; a defender
// defends and carries the ball out; a midfielder controls play and has the
// technique to use it; a forward finishes and beats their man. A position
// missing from the roster (shouldn't happen, but the data isn't ours) falls
// back to a neutral pair.
const CARD_STAT_PAIR = {
  GK: ['intelligence','pressure'],
  DF: ['pressure','control'],
  MF: ['control','technique'],
  FW: ['kick','control'],
};
const STAT_ABBR = { kick:'KCK', control:'CTL', technique:'TEC', pressure:'PRE', physical:'PHY', agility:'AGI', intelligence:'INT' };
// What each position's rating weighs, and how heavily. A plain average of
// the seven is useless as a rating here: the source data conserves a
// near-fixed total per character (high kick means low pressure and so on),
// so the mean lands on 95 for 71% of the roster — every player "the same".
// Weighing the stats that decide a given job instead makes the number mean
// something: the same Axel Blaze who averages 96 flat rates 116 as a forward
// (kick 121) and the roster spreads out across ~86-116.
// Every position's rating is centred on this, so 100 reads as "a typical
// player for this job" whatever the job is (see _ratingBaseline).
const RATING_CENTRE = 100;
const RATING_WEIGHTS = {
  GK: { intelligence:.55, pressure:.25, physical:.20 },
  DF: { pressure:.55, physical:.25, intelligence:.20 },
  MF: { control:.45, technique:.30, intelligence:.25 },
  FW: { kick:.55, control:.25, technique:.20 },
};

// AI difficulty (solo-vs-AI only). The whole ladder used to top out about
// where "easy" now starts — the old hard is this easy, and every level above
// it is new ground. Decision-making is still the main lever (how readily it
// spends PT on a supertechnique, from how far out it shoots, how decisively
// it pulls the trigger, how often it looks for a pass), but from normal up
// the AI side also gets its stats inflated, because sharper decisions alone
// run out of room once it's already taking every chance it gets.
// `statMul` scales its combat stats; movement gets half of that bonus, so a
// hard opponent is stronger in a duel without simply outrunning you.
const AI_LEVELS = {
  easy:   { techChance:0.70, shootRange:420, shootChance:0.70, passChance:0.022, statMul:1.00 },
  normal: { techChance:0.75, shootRange:445, shootChance:0.75, passChance:0.024, statMul:1.04 },
  hard:   { techChance:0.90, shootRange:530, shootChance:0.90, passChance:0.034, statMul:1.18 },
  expert: { techChance:0.97, shootRange:620, shootChance:0.97, passChance:0.042, statMul:1.30 }
};
const AI_LEVEL_DEFAULT = 'normal';
const AI_SPEED_BONUS_SHARE = 0.5; // movement gets half the stat inflation

// Fouls are meant to be a rare punctuation, not a regular interruption:
// roughly one duel in a hundred, a little more often for weaker defenders.
// Set FOUL_CHANCE_BASE to 0 to turn fouls (and so cards/penalties) off.
const FOUL_CHANCE_BASE = 0.01;
const FOUL_CHANCE_MIN  = 0.004;
const FOUL_CHANCE_MAX  = 0.015;

// Off-ball players drift around their formation anchor instead of parking
// exactly on it. Two slow, out-of-phase sine waves per player (periods are
// deliberately not multiples of each other) keep the motion smooth and
// non-repeating rather than twitchy like per-tick noise would be.
const WANDER_AMPLITUDE = 52;
const WANDER_PERIOD_X  = 3100;  // ms
const WANDER_PERIOD_Y  = 4300;  // ms

// When a drawn path runs out while the team is attacking, the player keeps
// making ground toward the rival goal instead of turning back to formation.
const RUN_ON_STEP = 170;   // how far ahead the next carry-on waypoint sits
const RUN_ON_STOP = 150;   // stop running on once this close to the byline

// Duels trigger on proximity, not physical contact — see collision
// categories below — with a slightly generous radius (bigger than the old
// ~24px body-touch distance) so they feel less pixel-perfect.
const DUEL_HITBOX_RADIUS = 42;

// Collision categories. Players share one category and don't include each
// other in their mask, so they pass through one another freely; only the
// ball (and the world-bounds walls, default category) still push them
// around. The ball itself excludes the boundary walls so it can be caught
// travelling past the touch/goal lines for throw-ins/corners/goal-kicks
// instead of bouncing off an invisible wall.
const CAT_DEFAULT = 0x0001;
const CAT_PLAYER  = 0x0002;
const CAT_BALL    = 0x0004;
const CAT_GOAL    = 0x0008;

// ─── Formation presets ───────────────────────────────────────────────────
// Slot 0 = keeper. x=0..1 secondary axis, y=0..1 primary from own goal→halfway
const FORMATIONS = {
  '4-4-2': [
    {x:.50,y:.06},{x:.15,y:.22},{x:.38,y:.18},{x:.62,y:.18},{x:.85,y:.22},
    {x:.15,y:.42},{x:.38,y:.40},{x:.62,y:.40},{x:.85,y:.42},
    {x:.35,y:.62},{x:.65,y:.62}
  ],
  '4-3-3': [
    {x:.50,y:.06},{x:.16,y:.22},{x:.38,y:.18},{x:.62,y:.18},{x:.84,y:.22},
    {x:.25,y:.42},{x:.50,y:.38},{x:.75,y:.42},
    {x:.22,y:.60},{x:.50,y:.64},{x:.78,y:.60}
  ],
  '4-2-3-1': [
    {x:.50,y:.06},{x:.15,y:.20},{x:.38,y:.16},{x:.62,y:.16},{x:.85,y:.20},
    {x:.35,y:.33},{x:.65,y:.33},
    {x:.20,y:.50},{x:.50,y:.48},{x:.80,y:.50},{x:.50,y:.66}
  ],
  '3-5-2': [
    {x:.50,y:.06},{x:.25,y:.19},{x:.50,y:.17},{x:.75,y:.19},
    {x:.12,y:.38},{x:.32,y:.34},{x:.50,y:.32},{x:.68,y:.34},{x:.88,y:.38},
    {x:.38,y:.61},{x:.62,y:.61}
  ],
  '4-5-1': [
    {x:.50,y:.06},{x:.15,y:.20},{x:.38,y:.17},{x:.62,y:.17},{x:.85,y:.20},
    {x:.10,y:.40},{x:.30,y:.36},{x:.50,y:.34},{x:.70,y:.36},{x:.90,y:.40},
    {x:.50,y:.64}
  ],
  '5-3-2': [
    {x:.50,y:.06},{x:.10,y:.20},{x:.30,y:.17},{x:.50,y:.15},{x:.70,y:.17},{x:.90,y:.20},
    {x:.28,y:.40},{x:.50,y:.37},{x:.72,y:.40},
    {x:.35,y:.63},{x:.65,y:.63}
  ],
  '3-4-3': [
    {x:.50,y:.06},{x:.25,y:.19},{x:.50,y:.16},{x:.75,y:.19},
    {x:.12,y:.38},{x:.38,y:.35},{x:.62,y:.35},{x:.88,y:.38},
    {x:.20,y:.62},{x:.50,y:.65},{x:.80,y:.62}
  ],
  '4-1-4-1': [
    {x:.50,y:.06},{x:.15,y:.20},{x:.38,y:.17},{x:.62,y:.17},{x:.85,y:.20},
    {x:.50,y:.30},
    {x:.12,y:.44},{x:.38,y:.42},{x:.62,y:.42},{x:.88,y:.44},
    {x:.50,y:.64}
  ],
  '5-4-1': [
    {x:.50,y:.06},{x:.10,y:.20},{x:.30,y:.17},{x:.50,y:.15},{x:.70,y:.17},{x:.90,y:.20},
    {x:.15,y:.40},{x:.38,y:.37},{x:.62,y:.37},{x:.85,y:.40},
    {x:.50,y:.64}
  ],
  '4-3-1-2': [
    {x:.50,y:.06},{x:.15,y:.20},{x:.38,y:.17},{x:.62,y:.17},{x:.85,y:.20},
    {x:.50,y:.30},{x:.22,y:.38},{x:.78,y:.38},
    {x:.50,y:.48},
    {x:.35,y:.64},{x:.65,y:.64}
  ]
};
const DEFAULT_FORMATION = '4-4-2';

// Slot-role mapping: GK=keeper, DF=last rows, MF=mid, FW=front (defensive-
// and attacking-mid slots inside a formation's own MF band are still just
// MF — the shape itself, not this label, is what tells them apart).
const SLOT_ROLES = {
  '4-4-2': ['GK','DF','DF','DF','DF','MF','MF','MF','MF','FW','FW'],
  '4-3-3': ['GK','DF','DF','DF','DF','MF','MF','MF','FW','FW','FW'],
  '4-2-3-1':['GK','DF','DF','DF','DF','MF','MF','MF','MF','MF','FW'],
  '3-5-2': ['GK','DF','DF','DF','MF','MF','MF','MF','MF','FW','FW'],
  '4-5-1': ['GK','DF','DF','DF','DF','MF','MF','MF','MF','MF','FW'],
  '5-3-2': ['GK','DF','DF','DF','DF','DF','MF','MF','MF','FW','FW'],
  '3-4-3': ['GK','DF','DF','DF','MF','MF','MF','MF','FW','FW','FW'],
  '4-1-4-1':['GK','DF','DF','DF','DF','MF','MF','MF','MF','MF','FW'],
  '5-4-1': ['GK','DF','DF','DF','DF','DF','MF','MF','MF','MF','FW'],
  '4-3-1-2':['GK','DF','DF','DF','DF','MF','MF','MF','MF','FW','FW']
};

// ─── Colour helpers ───────────────────────────────────────────────────────
const GAME_FALLBACK = {
  IE1:0x3399ff,IE2:0xff8800,IE3:0x44cc55,
  GO1:0xcc44ff,GO2:0xff4488,GO3:0x44cccc,
  Ares:0xddcc22,VR:0x888888
};
function hexToInt(h){ const n=parseInt((h||'').replace('#',''),16); return isNaN(n)?null:n; }

/** Guarantee two colors are visually distinct (≥100 luminance distance). */
function distinctColor(baseColor, takenColor){
  const OPTIONS=[0x3399ff,0xff4444,0x44cc55,0xffdd00,0xcc44ff,0xff8800,0x00cccc,0xff6699];
  function dist(a,b){
    const ra=(a>>16)&0xff,ga=(a>>8)&0xff,ba=a&0xff;
    const rb=(b>>16)&0xff,gb=(b>>8)&0xff,bb=b&0xff;
    return Math.abs(ra-rb)+Math.abs(ga-gb)+Math.abs(ba-bb);
  }
  if(dist(baseColor,takenColor)>100) return baseColor;
  const alt=OPTIONS.find(c=>dist(c,takenColor)>100&&dist(c,baseColor)>40);
  return alt??0xffffff;
}

export default class GameScene extends Phaser.Scene {
  constructor(){ super('GameScene'); }

  // ════════════════════════════════════════════════════════════════════
  create(){
    // Logical field is fixed; the viewport is whatever the actual canvas
    // size is (the whole screen — see main.js RESIZE mode), so a landscape
    // device sees a wide window into the pitch instead of a portrait strip.
    this.FIELD_W = FIELD_LOGICAL_W;
    this.FIELD_H = FIELD_LOGICAL_H;
    // The visible world is taller than the pitch: the run-off behind each goal
    // is scenery the camera can reach, not playable space (physics bounds stay
    // on the pitch below).
    this.WORLD_Y_MIN = -GOAL_RUNOFF;
    this.WORLD_Y_MAX = this.FIELD_H + GOAL_RUNOFF;
    this.VP_W    = this.scale.width  || VIEWPORT_W;
    this.VP_H    = this.scale.height || VIEWPORT_H;
    this.scale.on('resize', gameSize=>this._onResize(gameSize));

    this.roomCode=getOrCreateRoomCode();
    document.getElementById('room-code').textContent=this.roomCode;
    this.uiMode='solo'; // finalized once the mode-select panel resolves — see _applyUiMode
    this._connectNet(this.roomCode);

    this._drawField();
    this.pathGfx=this.add.graphics();

    this.matter.world.setBounds(0,0,this.FIELD_W,this.FIELD_H);
    this.ball=this.matter.add.circle(this.FIELD_W/2,this.FIELD_H/2,10,
      {restitution:.7,frictionAir:BALL_FRICTION_AIR,label:'ball',
       collisionFilter:{category:CAT_BALL,mask:CAT_PLAYER|CAT_GOAL}});
    this.ballGfx=this.add.circle(this.ball.position.x,this.ball.position.y,10,0xffffff).setDepth(3);
    // Sits on the ground under a ball in flight, so a chipped pass reads as
    // one rather than as a ball that ignored a defender.
    this.ballShadow=this.add.ellipse(this.ball.position.x,this.ball.position.y,17,11,0x000000,0.38).setDepth(2).setVisible(false);
    this.ballFlight=null;
    this._clientBall=null;
    this._drawGoals();

    this.possRing=this.add.circle(0,0,20).setStrokeStyle(3,0xffd966).setFillStyle(0,0).setVisible(false).setDepth(4);

    // Camera setup: camera scrolls over the logical world
    this.cameras.main.setBounds(0,this.WORLD_Y_MIN,this.FIELD_W,this.WORLD_Y_MAX-this.WORLD_Y_MIN);
    this.cameras.main.setSize(this.VP_W,this.VP_H);
    this.cameras.main.scrollX=this.FIELD_W/2-this.VP_W/2;
    this.cameras.main.scrollY=this.FIELD_H/2-this.VP_H/2;
    this._clampScroll();
    this.scrollKeys={up:false,down:false,left:false,right:false};
    this.joyVec={x:0,y:0};
    this._setupScrollInput();

    // Teams
    this.teamA=[]; this.teamB=[];
    this.statsMapA=new Map(); this.statsMapB=new Map();
    this.activeIdA=null; this.activeIdB=null;
    this.teamColorA=0x3399ff; this.teamColorB=0xff4444;
    this.stunMap=new Map(); // rosterId -> unstun timestamp
    this.bodyOwner=new Map(); // Matter body -> {role,id}, for attributing ball touches
    this.cards=new Map();  // "role:id" -> {yellow, red}
    this.lastTouch=null;   // {role,id} of whoever last touched the ball (host only)
    this.score={a:0,b:0};
    this.clientTeamsBuilt=false;
    this.formation={A:DEFAULT_FORMATION,B:DEFAULT_FORMATION};
    this.pendingFormChange=null;

    this.halfLengthS=HALF_S; // overridable via the squad editor's half-length select
    this.matchClock={half:1,secondsRemaining:this.halfLengthS,ended:false};
    this._fullTimeShown=false; this._fullTimeTimer=null;
    this.possRole=null; this.currentPossession=null;
    this.offsideFlag=null; // {role,ids} of a passer's teammates who were offside when the current pass was made
    this.duelLockUntil=0; this.confrontation=null;
    this.confrontResult=null;
    this._lastFxUntil=0;

    this.matchStarted=false;
    this.squadSlots=Array(TEAM_SIZE).fill(null);
    this.benchIds=new Set();
    this.chosenFormation=DEFAULT_FORMATION;
    // Null until the player actually touches the color picker — leaves
    // _payloadColor free to fall back to the auto-derived squad color
    // (whichever real team most of the XI belongs to) for anyone who
    // never bothers with it, same as before this existed.
    this.myTeamColor=null;
    // Rival-team state, only used solo vs AI — a real connected opponent
    // always picks their own squad regardless of what's set here.
    this.editSide='me';
    this.rivalSquadSlots=Array(TEAM_SIZE).fill(null);
    this.rivalBenchIds=new Set();
    this.rivalFormation=DEFAULT_FORMATION;
    this.aiLevel=AI_LEVEL_DEFAULT;
    this.aiSubsUsed=0; this._aiSubCheckAt=0;
    this.mySquadConfirmed=false;
    this.mySquadPayload=null;
    this.remoteSquadPayload=null;

    this.myPaths=new Map();
    // Ids whose current path is purely the automatic "keep running" carry-on
    // (see _runOnWaypoint) rather than anything the player actually drew —
    // kept separate so _drawPaths can skip rendering a line for it.
    this.autoPathIds=new Set();
    this.drawing=false;
    this.selectedPlayerId=null;
    this.gestureStart=null; this.gestureMoved=false;
    this.pendingShoot=false; this.pendingPass=null;
    this.pendingChoice=null; this.pendingSub=null; this.pendingReposition=null; this.pendingTeamPanelRequest=null; this.subSel=null; this._squadSel=null;
    this.teamPanelOpen=false;
    // Which side the mid-match team panel shows — purely local UI state,
    // never networked, since each player can independently peek at the
    // rival's read-only formation without affecting the other screen.
    this.subPanelSide='me';
    this.lastStateSent=0;

    // Pointer handlers
    this.input.on('pointerdown',(p)=>this._pointerDown(p));
    this.input.on('pointermove',(p)=>{ if(p.isDown) this._pointerMove(p); });
    this.input.on('pointerup',(p)=>this._pointerUp(p));
    this.input.on('pointerupoutside',(p)=>this._pointerUp(p));

    document.getElementById('conf-normal').addEventListener('pointerdown',(e)=>{e.stopPropagation();this.pendingChoice='normal';});
    // Technique buttons are rebuilt per confrontation (a player can have more
    // than one of the same category — see techniquesFor), so this listens on
    // their shared container instead of a single fixed button.
    document.getElementById('conf-tech-list').addEventListener('pointerdown',(e)=>{
      const btn=e.target.closest('.conf-btn'); if(!btn||btn.disabled) return;
      e.stopPropagation();
      this.pendingChoice={tech:parseInt(btn.dataset.idx,10)};
    });
    document.getElementById('fulltime-menu-btn').addEventListener('click',()=>this._returnToMenu());
    document.getElementById('sub-button').addEventListener('click',()=>this._openSubPanel());
    document.getElementById('sub-cancel-btn').addEventListener('click',()=>this._closeSubPanel());
    document.querySelectorAll('#sub-panel-side-tabs .sub-panel-side-tab').forEach(btn=>btn.addEventListener('click',()=>this._setSubPanelSide(btn.dataset.side)));

    // Roster load → squad editor
    this.rosterAll=[];
    document.getElementById('squad-pick-list').innerHTML='<p style="opacity:.8;font-size:12px;">Loading roster…</p>';
    loadRoster().then(data=>{
      this.rosterAll=data;
      const gs=document.getElementById('squad-game-filter');
      getGames().forEach(g=>{ const o=document.createElement('option'); o.value=g; o.textContent=g; gs.appendChild(o); });
      this._populateTeamFilter();
      // Several characters (Mark Evans, Axel Blaze...) show up once per game
      // they appeared in, as separate roster entries with their own stats —
      // same name, same real team, so cards need the game tag too or they're
      // indistinguishable. Precomputed once so every card render is cheap.
      const seen=new Map();
      data.forEach(p=>seen.set(p.name,(seen.get(p.name)||0)+1));
      this.duplicateNames=new Set([...seen].filter(([,n])=>n>1).map(([name])=>name));
      this._initSquadEditor();
    }).catch(err=>{ document.getElementById('squad-pick-list').innerHTML=`<p style="color:#f88">Couldn't load roster.<br>${err.message}</p>`; });

    document.getElementById('confirm-squad-btn').addEventListener('click',()=>this._confirmSquad());
    this.matter.world.on('collisionstart',ev=>this._collisions(ev));
    this._initLandingAndModeFlow();
    this._initInfoIcons();
    this._initProfilePanel();
  }

  /** Every "ⓘ" icon in the app (static HTML, or injected later like the
   *  team panel's) shares one delegated listener and one popup, keyed off
   *  its own data-info-title/-body — so an explanation lives once, next to
   *  whatever it explains, instead of as permanent text cluttering the
   *  interface. */
  _initInfoIcons(){
    document.getElementById('info-modal-close').addEventListener('click',()=>this._hideInfo());
    document.getElementById('info-modal').addEventListener('click',e=>{ if(e.target.id==='info-modal') this._hideInfo(); });
    document.body.addEventListener('click',e=>{
      const icon=e.target.closest('.info-icon'); if(!icon) return;
      e.stopPropagation();
      this._showInfo(icon.dataset.infoTitle||'Info',icon.dataset.infoBody||'');
    });
  }
  _showInfo(title,body){
    document.getElementById('info-modal-title').textContent=title;
    document.getElementById('info-modal-body').textContent=body;
    document.getElementById('info-modal').style.display='flex';
  }
  _hideInfo(){ document.getElementById('info-modal').style.display='none'; }

  /** Connects (or reconnects, via _switchRoom) to a P2P room and wires up
   *  every handler that depends on `this.net` — extracted so a manual room
   *  switch (joining a friend's code instead of your own) can redo this
   *  without duplicating it. */
  _connectNet(code){
    this.net=connectToRoom(code);
    this.role=this.net.isHost()?'A':'B';
    // isHost() at this exact instant is only a guess: the WebRTC handshake
    // hasn't happened yet, so both browsers loading the page at once see
    // "nobody else here" and both provisionally become 'A'. Once a peer
    // actually connects, redo the (now-real) comparison.
    this.net.onPeerConnect(()=>{
      this._syncRoleFromNet();
      // A squad confirmed before this exact moment was sent to whatever
      // peers existed at the time — if that was zero (confirmed faster than
      // the handshake completed), the message just went nowhere and nothing
      // ever retried it, leaving the other side waiting forever even though
      // both players had actually confirmed. Resending now that a peer
      // definitely exists costs nothing and fixes that silently-dropped case.
      if(this.mySquadConfirmed) this.net.sendSquad(this.mySquadPayload);
      else if(this.uiMode==='multiplayer') document.getElementById('squad-status').textContent='';
    });
    this.remoteState=null;
    this.remoteInput={targets:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,repositionRequest:null,formationChange:null,teamPanelRequest:null};
    this.net.onInput(d=>{ this.remoteInput=d; });
    this.net.onState(d=>this._incomingState(d));
    this.net.onSquad(d=>{ this.remoteSquadPayload=d; this._tryStartMultiplayerMatch(); });
  }

  /** Leaves the current room and joins a different one — used when the
   *  player types a friend's code into the multiplayer join field instead
   *  of sharing their own. Only ever called pre-match, from the mode
   *  panel, so there's no in-progress game state to worry about losing. */
  async _switchRoom(newCode){
    try{ await this.net.room.leave(); }catch{}
    const params=new URLSearchParams(window.location.search);
    params.set('room',newCode);
    window.history.replaceState({},'',`${window.location.pathname}?${params}`);
    this.roomCode=newCode;
    document.getElementById('room-code').textContent=newCode;
    this._connectNet(newCode);
  }

  /** The very first thing a player sees: a title screen, then a choice
   *  between solo-vs-AI and multiplayer (with room-code sharing/joining)
   *  before the squad editor itself appears. */
  _initLandingAndModeFlow(){
    const sfxBtn=document.getElementById('sfx-toggle-btn');
    sfxBtn.textContent=isSfxEnabled()?'🔊':'🔇';
    sfxBtn.addEventListener('click',()=>{
      const next=!isSfxEnabled();
      setSfxEnabled(next);
      sfxBtn.textContent=next?'🔊':'🔇';
    });
    document.getElementById('landing-play-btn').addEventListener('click',()=>this._showModeSelect());
    document.getElementById('mode-solo-btn').addEventListener('click',()=>{
      this.uiMode='solo';
      this._applyUiMode();
      document.getElementById('mode-select-panel').style.display='none';
      document.getElementById('squad-editor-panel').style.display='flex';
    });
    document.getElementById('mode-multi-btn').addEventListener('click',()=>{
      document.getElementById('mode-multi-panel').style.display='block';
      document.getElementById('mode-own-code').textContent=this.roomCode;
    });
    document.getElementById('mode-copy-code-btn').addEventListener('click',async()=>{
      const btn=document.getElementById('mode-copy-code-btn');
      try{ await navigator.clipboard.writeText(this.roomCode); btn.textContent='✅ Copied'; }
      catch{ btn.textContent='Copy failed'; }
      setTimeout(()=>{ btn.textContent='📋 Copy'; },1500);
    });
    document.getElementById('mode-multi-start-btn').addEventListener('click',async()=>{
      const code=document.getElementById('mode-join-input').value.trim().toUpperCase();
      if(code&&code!==this.roomCode) await this._switchRoom(code);
      this.uiMode='multiplayer';
      this._applyUiMode();
      document.getElementById('mode-select-panel').style.display='none';
      document.getElementById('squad-editor-panel').style.display='flex';
    });
    // Tournament is its own mode from the home screen, not a button tucked
    // inside the squad editor — pick how many teams play *first*, then
    // build your squad, then it's straight into the bracket/table. If one's
    // already running (persisted across the page reload every match causes)
    // this jumps straight to it instead of the setup form — see
    // _renderTournamentPanel's own branch on activeTournament.
    document.getElementById('mode-tournament-btn').addEventListener('click',()=>{
      document.getElementById('mode-select-panel').style.display='none';
      document.getElementById('tournament-panel').style.display='flex';
      this._renderTournamentPanel();
    });
  }

  /** Shared landing point for "Play" and for backing out of the tournament
   *  setup screen — also keeps the Tournament button's label honest about
   *  whether it's starting fresh or resuming what's already running. */
  _showModeSelect(){
    document.getElementById('landing-panel').style.display='none';
    document.getElementById('tournament-panel').style.display='none';
    document.getElementById('mode-select-panel').style.display='flex';
    document.getElementById('mode-own-code').textContent=this.roomCode;
    const hasActive=this.activeTournament&&!this.activeTournament.completedAt;
    document.getElementById('mode-tournament-btn').textContent=hasActive?'🏆 Continue Tournament':'🏆 Tournament';
  }

  /** A real opponent always picks their own squad, so the "Rival Team" tab
   *  (only ever meaningful for the solo-vs-AI matchup) has no purpose in
   *  multiplayer and would just be confusing to leave visible. */
  _applyUiMode(){
    const multi=this.uiMode==='multiplayer';
    // Tournament mode fields the opponent from the game's own canon roster
    // (see _entrantPool), exactly like multiplayer fields a real human —
    // neither one has any use for the "Rival Team" tab, which only ever
    // makes sense when you're hand-building an AI opponent yourself.
    const noRivalTab=multi||this.uiMode==='tournament';
    document.getElementById('squad-side-tabs').style.display=noRivalTab?'none':'flex';
    if(noRivalTab&&this.editSide==='rival') this._setEditSide('me');
    document.getElementById('squad-status').textContent=(multi&&!this.net.hasPeer())?'Connecting to opponent…':'';
    // No AI plays in multiplayer, so its difficulty has nothing to affect.
    document.getElementById('ai-difficulty-row').style.display=multi?'none':'flex';
    // Half length is host-authoritative once a match is running (the guest
    // just mirrors whatever the host picked — see _syncRoleFromNet's own
    // note and the client-side clock sync in _incomingState) — only the
    // host gets a selector that actually does something.
    document.getElementById('half-length-row').style.display=(multi&&this.role!=='A')?'none':'flex';
  }

  // ════════════════════════════════════════════════════════════════════
  // Field & camera
  // ════════════════════════════════════════════════════════════════════
  _drawField(){
    const w=this.FIELD_W, h=this.FIELD_H;
    // Surround: the darker apron behind each goal, so the run-off reads as part
    // of the ground rather than as empty space off the edge of the world.
    this.add.rectangle(w/2,(this.WORLD_Y_MIN+this.WORLD_Y_MAX)/2,w,this.WORLD_Y_MAX-this.WORLD_Y_MIN,0x11512a).setDepth(-1);
    // Full field background
    this.add.rectangle(w/2,h/2,w,h,0x1e7a3c).setStrokeStyle(5,0xffffff).setDepth(0);
    // Halfway line
    this.add.rectangle(w/2,h/2,w,2,0xffffff).setAlpha(0.5).setDepth(1);
    // Centre circle
    this.add.circle(w/2,h/2,60).setStrokeStyle(2,0xffffff,0.5).setFillStyle(0,0).setDepth(1);
    // Penalty areas
    const paW=w*0.5, paH=h*0.12;
    this.PA_W=paW; this.PA_H=paH; // kept for foul → penalty-vs-free-kick checks
    this.add.rectangle(w/2,paH/2,paW,paH).setStrokeStyle(2,0xffffff,0.5).setFillStyle(0,0).setDepth(1);
    this.add.rectangle(w/2,h-paH/2,paW,paH).setStrokeStyle(2,0xffffff,0.5).setFillStyle(0,0).setDepth(1);
  }

  _drawGoals(){
    const w=this.FIELD_W, h=this.FIELD_H;
    // Visual: a box reaching back from the goal line into the run-off. Tapping
    // a line was fiddly — anywhere in the box counts as "shoot here".
    const box=(lineY,dir)=>{
      const cy=lineY+dir*GOAL_DEPTH/2;
      this.add.rectangle(w/2,cy,GOAL_HALF_WIDTH*2,GOAL_DEPTH,0xffffff,0.16).setStrokeStyle(4,0xffffff,0.9).setDepth(2);
      for(let i=1;i<4;i++) this.add.rectangle(w/2-GOAL_HALF_WIDTH+i*(GOAL_HALF_WIDTH/2),cy,1,GOAL_DEPTH,0xffffff).setAlpha(0.28).setDepth(2);
      this.add.rectangle(w/2,lineY,GOAL_HALF_WIDTH*2,6,0xffffff).setDepth(2);
    };
    box(0,-1); box(h,1);
    // Physics sensors
    this.goalMin=this.matter.add.rectangle(w/2,0,GOAL_HALF_WIDTH*2,16,{isSensor:true,isStatic:true,label:'goalMin',collisionFilter:{category:CAT_GOAL,mask:CAT_BALL}});
    this.goalMax=this.matter.add.rectangle(w/2,h,GOAL_HALF_WIDTH*2,16,{isSensor:true,isStatic:true,label:'goalMax',collisionFilter:{category:CAT_GOAL,mask:CAT_BALL}});
  }

  /** True if `pos` is inside the goal-area penalty box that `defendingRole`
   *  defends (used to tell a penalty from a plain free kick after a foul). */
  _inPenaltyBox(defendingRole,pos){
    const withinX=pos.x>=this.FIELD_W/2-this.PA_W/2&&pos.x<=this.FIELD_W/2+this.PA_W/2;
    if(!withinX) return false;
    return defendingRole==='A' ? pos.y>=this.FIELD_H-this.PA_H : pos.y<=this.PA_H;
  }

  _setupScrollInput(){
    // Keyboard (PC)
    const kb=this.input.keyboard;
    // Arrows and WASD both pan the camera on desktop.
    const bind=(keys,dir)=>keys.forEach(k=>{
      kb.on(`keydown-${k}`,()=>{this.scrollKeys[dir]=true;});
      kb.on(`keyup-${k}`,  ()=>{this.scrollKeys[dir]=false;});
    });
    bind(['UP','W'],'up');     bind(['DOWN','S'],'down');
    bind(['LEFT','A'],'left'); bind(['RIGHT','D'],'right');
    this._setupJoystick();
    this._setupWasdPad();
  }

  /** On-screen WASD-styled d-pad shown instead of the joystick on a real
   *  mouse+keyboard setup (see the CSS media query around #wasd-pad) — a
   *  visible hint that the actual W/A/S/D keys do the same thing, which a
   *  generic joystick doesn't convey. Drives the exact same `scrollKeys`
   *  flags the keyboard bindings above do, not a separate code path. */
  _setupWasdPad(){
    const bind=(id,dir)=>{
      const btn=document.getElementById(id); if(!btn) return;
      const press=e=>{ e.preventDefault(); this.scrollKeys[dir]=true; btn.classList.add('is-held'); };
      const release=()=>{ this.scrollKeys[dir]=false; btn.classList.remove('is-held'); };
      btn.addEventListener('pointerdown',press);
      btn.addEventListener('pointerup',release);
      btn.addEventListener('pointerleave',release);
      btn.addEventListener('pointercancel',release);
    };
    bind('wasd-w','up'); bind('wasd-a','left');
    bind('wasd-s','down'); bind('wasd-d','right');
  }

  /** Virtual joystick (mobile) driving continuous camera-scroll velocity,
   *  replacing the old 4-button d-pad (which was fine on PC but fiddly to
   *  hit precisely on a phone). */
  _setupJoystick(){
    const base=document.getElementById('joy-base'), stick=document.getElementById('joy-stick');
    if(!base||!stick) return;
    const maxR=25;
    let activeId=null;
    const setVec=(dx,dy)=>{
      const d=Math.hypot(dx,dy), cl=Math.min(d,maxR);
      const nx=d?dx/d:0, ny=d?dy/d:0;
      this.joyVec.x=nx*(cl/maxR); this.joyVec.y=ny*(cl/maxR);
      stick.style.transform=`translate(${nx*cl}px, ${ny*cl}px)`;
    };
    const reset=()=>{ this.joyVec.x=0; this.joyVec.y=0; stick.style.transform='translate(0,0)'; };
    const fromEvent=e=>{ const r=base.getBoundingClientRect(); setVec(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2)); };
    base.addEventListener('pointerdown',e=>{ e.stopPropagation(); activeId=e.pointerId; base.setPointerCapture(e.pointerId); fromEvent(e); });
    base.addEventListener('pointermove',e=>{ if(e.pointerId!==activeId) return; fromEvent(e); });
    const end=e=>{ if(e.pointerId!==activeId) return; activeId=null; reset(); };
    base.addEventListener('pointerup',end);
    base.addEventListener('pointerleave',end);
    base.addEventListener('pointercancel',end);
  }

  /** Reflects solo-vs-AI vs. a real connected opponent in the top-right
   *  badge — visible from the squad editor onward, not just in-match, so a
   *  peer actually connecting (or dropping) is never silent. */
  _updateModeBadge(){
    const badge=document.getElementById('mode-badge');
    const multi=this.net.hasPeer();
    badge.textContent=multi?'👥 Multiplayer':'🤖 Solo (vs AI)';
    badge.classList.toggle('is-multi',multi);
  }

  /** Re-derives which side we are from the network layer's now-current
   *  view of who's connected. Only matters before kickoff — role has to
   *  stay fixed for the length of a match, and by kickoff a real peer has
   *  always long since been detected if one exists. */
  _syncRoleFromNet(){
    if(this.matchStarted) return;
    this.role=this.net.isHost()?'A':'B';
    this._applyUiMode();
    this._tryStartMultiplayerMatch();
  }

  _onResize(gameSize){
    this.VP_W=gameSize.width; this.VP_H=gameSize.height;
    this.cameras.main.setSize(this.VP_W,this.VP_H);
    this._clampScroll();
  }

  /** Keeps the camera inside the world, which now reaches past both goal lines
   *  by GOAL_RUNOFF so the goals can be centred on screen. */
  _clampScroll(){
    const cam=this.cameras.main;
    cam.scrollX=Phaser.Math.Clamp(cam.scrollX,0,Math.max(0,this.FIELD_W-this.VP_W));
    cam.scrollY=Phaser.Math.Clamp(cam.scrollY,this.WORLD_Y_MIN,Math.max(this.WORLD_Y_MIN,this.WORLD_Y_MAX-this.VP_H));
  }

  /** Smoothly pans the camera back to the centre of the pitch — used after a
   *  goal, since the ball (and wherever the camera had scrolled to follow
   *  it) could be anywhere near either goal line when it goes in, well off
   *  from the centre-spot restart everyone lines up for next. */
  _centerCameraOnField(durationMs=700){
    const cam=this.cameras.main;
    const targetX=Phaser.Math.Clamp(this.FIELD_W/2-this.VP_W/2,0,Math.max(0,this.FIELD_W-this.VP_W));
    const targetY=Phaser.Math.Clamp(this.FIELD_H/2-this.VP_H/2,this.WORLD_Y_MIN,Math.max(this.WORLD_Y_MIN,this.WORLD_Y_MAX-this.VP_H));
    this.tweens.add({targets:cam,scrollX:targetX,scrollY:targetY,duration:durationMs,ease:'Cubic.Out'});
  }

  _tickScroll(delta){
    const cam=this.cameras.main;
    const spd=SCROLL_SPEED*(delta/1000);
    const kx=(this.scrollKeys.left?-1:0)+(this.scrollKeys.right?1:0);
    const ky=(this.scrollKeys.up?-1:0)+(this.scrollKeys.down?1:0);
    const vx=Phaser.Math.Clamp(kx+this.joyVec.x,-1,1);
    const vy=Phaser.Math.Clamp(ky+this.joyVec.y,-1,1);
    cam.scrollX+=vx*spd; cam.scrollY+=vy*spd;
    this._clampScroll();
  }

  /** Convert screen (pointer) coords to world coords accounting for camera. */
  _toWorld(x,y){
    const cam=this.cameras.main;
    return {x:x+cam.scrollX, y:y+cam.scrollY};
  }

  // ════════════════════════════════════════════════════════════════════
  // Avatar / color helpers
  // ════════════════════════════════════════════════════════════════════
  _rosterColor(p){ return hexToInt(p&&p.teamColor)??(GAME_FALLBACK[p&&p.game]??0x999999); }
  _initials(p){ return (p.nickname||p.name||'?').split(' ').map(w=>w[0]||'').slice(0,2).join('').toUpperCase(); }
  _css3(intC){ return '#'+intC.toString(16).padStart(6,'0'); }
  /** The avatar chip's fill and contents, for every place a player gets a
   *  small square portrait — a pitch/bench pin, a pick-list card, the stat
   *  sheet header, a duel card. A player with a pixel-art portrait
   *  (`p.image`, from scripts/map-player-images.mjs — not every roster
   *  entry resolved to one) gets it as the chip's background, filling the
   *  square; `inner` stays empty since the art speaks for itself. Anyone
   *  without one falls back to exactly what every avatar used to be: a
   *  flat team-colour fill with their initials as text. Only this decision
   *  lives in one place, so a future format for a chip doesn't have to
   *  re-derive "image or colour+initials" on its own. */
  _avatarFill(p,col){
    if(p?.image) return {style:`background-image:url('${p.image}');background-size:cover;background-position:center;`,inner:''};
    return {style:`background:${col};`,inner:p?this._initials(p):'?'};
  }

  _squadColor(ids, fallback){
    const counts={};
    ids.forEach(id=>{ const p=getPlayerById(id); const c=p?.teamColor; if(c) counts[c]=(counts[c]||0)+1; });
    const top=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    return top?hexToInt(top[0]):fallback;
  }
  /** Keeps the "Your team color" controls honest about which mode they're
   *  in. A native colour input can't be blank, so while nothing has been
   *  picked (`myTeamColor` null) the swatch previews what the automatic
   *  pick currently works out to for your XI rather than showing some
   *  fixed value that reads as a choice you made — change the squad and it
   *  follows. Always your own XI, whichever side the pitch is showing,
   *  since that's all this setting ever affects. */
  _syncTeamColorUI(){
    const swatch=document.getElementById('my-team-color');
    const auto=document.getElementById('my-team-color-auto');
    if(!swatch||!auto) return;
    auto.checked=this.myTeamColor==null;
    if(this.myTeamColor==null) swatch.value=this._css3(this._squadColor(this.squadSlots.filter(Boolean),0x3399ff));
    else swatch.value=this.myTeamColor;
  }
  /** A squad payload's kit color: whatever that player explicitly picked
   *  (payload.color, from the "Your team color" selector), or the usual
   *  auto-derived one if they never touched it — same fallback chain
   *  _squadColor already provided, just with a manual override in front
   *  of it. */
  _payloadColor(payload, fallback){
    if(payload.color){ const c=hexToInt(payload.color); if(c!=null) return c; }
    return this._squadColor(payload.starterIds, fallback);
  }

  // ════════════════════════════════════════════════════════════════════
  // Account & profile (Firebase Auth + Firestore-backed saved formations)
  // ════════════════════════════════════════════════════════════════════
  /** Every player has *some* signed-in Firebase user from the moment the
   *  app loads — anonymous until they choose to sign up (see auth.js).
   *  This doesn't block anything else in the scene; the profile panel
   *  just reflects whatever auth state settles into, whenever that is. */
  _initProfilePanel(){
    initAuthSession().catch(err=>console.warn('[auth] init failed:',err));
    onAuthChange(()=>this._refreshProfilePanel());

    document.getElementById('profile-open-btn').addEventListener('click',()=>{
      document.getElementById('profile-panel').style.display='flex';
      this._refreshProfilePanel();
    });
    document.getElementById('profile-close-btn').addEventListener('click',()=>{
      document.getElementById('profile-panel').style.display='none';
    });
    document.getElementById('profile-signout-btn').addEventListener('click',async()=>{
      try{ await signOutUser(); this._flashProfileStatus('Signed out.'); }
      catch(err){ this._flashProfileStatus(`Couldn't sign out: ${err.message}`); }
    });
    document.getElementById('profile-signup-btn').addEventListener('click',()=>this._profileAuthAction(signUpWithEmail,'Account created.'));
    document.getElementById('profile-signin-btn').addEventListener('click',()=>this._profileAuthAction(signInWithEmail,'Signed in.'));
  }
  async _profileAuthAction(fn,successMsg){
    const email=document.getElementById('profile-email').value.trim();
    const password=document.getElementById('profile-password').value;
    if(!email||!password){ this._flashProfileStatus('Enter an email and password first.'); return; }
    try{ await fn(email,password); this._flashProfileStatus(successMsg); }
    catch(err){ this._flashProfileStatus(err.message); }
  }
  _flashProfileStatus(msg){
    const el=document.getElementById('profile-status');
    el.textContent=msg;
    clearTimeout(this._profileStatusTimer);
    this._profileStatusTimer=setTimeout(()=>{ el.textContent=''; },5000);
  }
  async _refreshProfilePanel(){
    const user=getUser();
    const signedIn=!!user&&!user.isAnonymous;
    document.getElementById('profile-signedin-view').style.display=signedIn?'block':'none';
    document.getElementById('profile-guest-view').style.display=signedIn?'none':'block';
    if(signedIn) document.getElementById('profile-user-label').textContent=describeUser(user);
    const list=document.getElementById('profile-formations-list');
    if(!user){ list.innerHTML='<p style="opacity:.7;font-size:11px;">Sign in to see your saved formations.</p>'; return; }
    list.innerHTML='<p style="opacity:.7;font-size:11px;">Loading…</p>';
    try{
      const formations=await listSavedFormations(user.uid);
      this._renderSavedFormationsList(formations);
    }catch(err){
      list.innerHTML=`<p style="opacity:.7;font-size:11px;color:#f88">Couldn't load saved formations: ${err.message}</p>`;
    }
  }
  _renderSavedFormationsList(formations){
    const list=document.getElementById('profile-formations-list');
    if(!formations.length){ list.innerHTML='<p style="opacity:.7;font-size:11px;">No saved formations yet — build a squad and hit Save.</p>'; return; }
    list.innerHTML='';
    formations.forEach(f=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;background:var(--panel);border:2px solid #000;padding:8px;';
      const filled=(f.slots||[]).filter(Boolean).length;
      row.innerHTML=`<div style="flex:1;text-align:left;font-size:12px;"><b>${f.name||'Untitled squad'}</b><br><span style="opacity:.7;font-size:10px;">${f.formation||''} · ${filled}/11</span></div>`;
      const loadBtn=document.createElement('button');
      loadBtn.className='nes-btn is-compact'; loadBtn.style.fontSize='11px'; loadBtn.textContent='📂 Load';
      loadBtn.addEventListener('click',()=>this._applySavedFormation(f));
      const delBtn=document.createElement('button');
      delBtn.className='nes-btn is-compact'; delBtn.style.fontSize='11px'; delBtn.textContent='🗑';
      delBtn.addEventListener('click',async()=>{
        const user=getUser();
        try{ await deleteSavedFormation(user.uid,f.id); this._refreshProfilePanel(); }
        catch(err){ this._flashProfileStatus(`Couldn't delete: ${err.message}`); }
      });
      row.appendChild(loadBtn); row.appendChild(delBtn);
      list.appendChild(row);
    });
  }
  /** Loads a profile-saved formation onto your own side of the pitch —
   *  same shape _loadSquad reads from localStorage, ids re-resolved
   *  against the current roster so a player no longer in the data is
   *  simply skipped instead of breaking the load. */
  _applySavedFormation(f){
    const known=id=>id&&getPlayerById(id)?id:null;
    const slots=(f.slots||[]).slice(0,TEAM_SIZE).map(known);
    while(slots.length<TEAM_SIZE) slots.push(null);
    const bench=new Set((f.bench||[]).map(known).filter(Boolean));
    if(f.formation&&FORMATIONS[f.formation]){
      this.chosenFormation=f.formation;
      document.getElementById('formation-select').value=f.formation;
    }
    this.squadSlots=slots; this.benchIds=bench;
    this._setEditSide('me');
    document.getElementById('profile-panel').style.display='none';
    this._flashSquadStatus(`Loaded "${f.name||'Untitled squad'}" (${slots.filter(Boolean).length}/11)`);
  }

  // ════════════════════════════════════════════════════════════════════
  // Squad editor (topological pitch)
  // ════════════════════════════════════════════════════════════════════
  _initSquadEditor(){
    document.getElementById('formation-select').addEventListener('change',e=>{
      this._edSetFormation(e.target.value); this._renderPitch();
    });
    document.getElementById('pitch-randomize-btn').addEventListener('click',()=>this._randomize());
    document.getElementById('squad-whole-team-btn').addEventListener('click',()=>this._useWholeTeam());
    document.getElementById('squad-search').addEventListener('input',()=>this._renderPickListReset());
    document.getElementById('squad-game-filter').addEventListener('change',()=>this._renderPickListReset());
    document.getElementById('squad-team-filter').addEventListener('change',()=>this._renderPickListReset());
    document.getElementById('squad-position-filter').addEventListener('change',()=>this._renderPickListReset());
    document.getElementById('squad-sort-select').addEventListener('change',()=>this._renderPickListReset());
    // Each filter's own "x" clears just that field (back to its default
    // value) and re-renders — data-reset names the element it resets, so
    // one listener covers all of them instead of one per button.
    document.querySelectorAll('.filter-reset-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const el=document.getElementById(btn.dataset.reset);
        el.value='';
        this._renderPickListReset();
      });
    });
    document.getElementById('squad-filters-toggle').addEventListener('click',()=>this._toggleSquadFilters());
    document.getElementById('pick-prev-btn').addEventListener('click',()=>{ this._pickPage=Math.max(0,this._pickPage-1); this._renderPickList(); });
    document.getElementById('pick-next-btn').addEventListener('click',()=>{ this._pickPage++; this._renderPickList(); });
    document.getElementById('squad-remove-btn').addEventListener('click',()=>this._removeSelectedFromSquad());
    document.getElementById('squad-place-cancel-btn').addEventListener('click',()=>{ this._squadSel=null; this._pickPosFilter=null; this._renderPitch(); this._renderPickList(); });
    document.getElementById('pick-scope-clear').addEventListener('click',()=>{ this._pickPosFilter=null; this._renderPickListReset(); });
    document.getElementById('ai-level-select').addEventListener('change',e=>{ this.aiLevel=e.target.value; });
    // Touching the swatch is what makes the colour an explicit override —
    // until then it's only previewing what Automatic works out to.
    document.getElementById('my-team-color').addEventListener('input',e=>{
      this.myTeamColor=e.target.value; this._syncTeamColorUI();
    });
    document.getElementById('my-team-color-auto').addEventListener('change',e=>{
      // Unticking keeps whatever is on screen, so the colour doesn't jump
      // the moment you take manual control of it.
      this.myTeamColor=e.target.checked?null:document.getElementById('my-team-color').value;
      this._syncTeamColorUI();
    });
    document.getElementById('half-length-select').addEventListener('change',e=>{
      this.halfLengthS=parseInt(e.target.value,10)*60;
      // Nothing's ticking yet at this point (still in the squad editor), so
      // it's safe to just overwrite the clock the match will start with.
      this.matchClock.secondsRemaining=this.halfLengthS;
      this._renderClock(this.matchClock);
    });
    document.querySelectorAll('#squad-side-tabs .squad-side-tab').forEach(btn=>btn.addEventListener('click',()=>this._setEditSide(btn.dataset.side)));
    document.querySelectorAll('.view-tab').forEach(btn=>btn.addEventListener('click',()=>this._toggleSquadSection(btn.dataset.view)));
    document.getElementById('squad-players-drawer-close').addEventListener('click',()=>this._toggleSquadSection('players'));
    // Tapping outside the drawer closes it too, same as a typical modal/
    // drawer backdrop — not just the dedicated ✕. "Outside" means outside
    // #squad-columns entirely (both the drawer *and* the pitch/bench
    // beside it), not just outside the drawer element itself: the visible
    // sliver of pitch is there so a bench/pitch spot can be armed and then
    // filled from the still-open drawer in one flow (see the bench-slots
    // test), and closing on that same tap would break exactly that. Only
    // below 900px, where it's actually a drawer overlaying something else;
    // above that it's a normal always-visible column, and clicking the
    // pitch beside it was never meant to hide it.
    document.addEventListener('click',(e)=>{
      if(window.innerWidth>=900) return;
      if(!this.squadSectionOpen?.players) return;
      if(document.getElementById('squad-editor-panel').style.display!=='flex') return;
      // Tapping a pitch/bench pin re-renders that whole section right in
      // its own click handler (_onSquadPinClick -> _renderPitch), which
      // detaches the original target node from the document before this
      // listener runs — a plain .contains() check against the *current*
      // tree would then wrongly say "not inside #squad-columns" for a tap
      // that very much was. composedPath() is fixed at dispatch time, so
      // it still reflects where the click actually happened.
      const path=e.composedPath();
      const columns=document.getElementById('squad-columns');
      const openToggle=document.querySelector('button[data-view="players"]');
      const statPanel=document.getElementById('player-stat-panel');
      // The stat panel is a fixed overlay outside #squad-columns (so it can
      // sit centred over the whole screen, drawer or not) — closing it via
      // its × button is a click outside #squad-columns too, and without this
      // check it fell through to here and closed the drawer as a side effect.
      if(path.includes(columns)||path.includes(openToggle)||path.includes(statPanel)) return;
      this._toggleSquadSection('players');
    });
    document.getElementById('squad-save-btn').addEventListener('click',()=>this._saveSquad());
    document.getElementById('squad-load-btn').addEventListener('click',()=>this._loadSquad());
    document.getElementById('tournament-back-btn').addEventListener('click',()=>this._closeTournamentPanel());
    // The setup form and the running bracket/table are both re-rendered
    // wholesale on every change (see _renderTournamentPanel), so their
    // buttons are delegated here once rather than re-bound after every
    // render.
    document.getElementById('tournament-body').addEventListener('click',e=>{
      const btn=e.target.closest('[data-tournament-action]'); if(!btn) return;
      const action=btn.dataset.tournamentAction;
      if(action==='setup-continue') this._confirmTournamentSetup();
      else if(action==='play'){
        const kind=btn.dataset.kind, idx=parseInt(btn.dataset.idx,10);
        const pending=kind==='knockout'?{kind,matchIdx:idx,a:btn.dataset.a,b:btn.dataset.b}:{kind,fixtureIdx:idx,a:btn.dataset.a,b:btn.dataset.b};
        this._playTournamentFixture(pending);
      }
      else if(action==='end'){ clearTournament(); this.activeTournament=null; this._renderTournamentPanel(); }
    });
    // Give the rival a full, position-aware random XI up front — it plays
    // fine untouched, and is only ever used solo vs AI.
    this.editSide='rival'; this._fillSquadByPosition(this.rosterAll); this.editSide='me';
    // Both open by default in the side-by-side (>=900px) layout, matching
    // how it's always worked there. Below that, "players" becomes an
    // overlay drawer covering most of the screen (see the CSS) — opening
    // it by default would immediately hide the formation controls behind
    // it, so it starts closed there and opens on request instead.
    this.squadSectionOpen={formation:true,players:window.innerWidth>=900};
    this._applySquadSectionVisibility();
    this._renderPitch(); this._renderPickList();
    this._refreshSavedSquadUI();
    // Tournament state lives entirely in localStorage (see tournament.js) —
    // _returnToMenu does a full page reload after every match, which wipes
    // any in-memory state a match's result would otherwise need to survive.
    this.activeTournament=loadTournament();
    this._tournamentPendingFixture=null;
  }

  // ---- saved squad (this browser only) ---------------------------------
  /** Picking eleven out of ~5000 is a lot of work to redo every session, so
   *  the squad you built is kept in localStorage — ids only, resolved against
   *  the roster on load so a player who's since gone from the data is simply
   *  skipped rather than breaking the lot. */
  _savedSquadKey(){ return 'inazuma-clone:squad:v1'; }
  _readSavedSquad(){
    try{ return JSON.parse(localStorage.getItem(this._savedSquadKey())||'null'); }
    catch{ return null; }
  }
  _saveSquad(){
    const payload={
      slots:this.squadSlots.slice(),
      bench:[...this.benchIds],
      formation:this.chosenFormation,
      savedAt:Date.now()
    };
    try{
      localStorage.setItem(this._savedSquadKey(),JSON.stringify(payload));
    }catch(err){
      this._flashSquadStatus(`Couldn't save: ${err.message}`);
      this._refreshSavedSquadUI();
      return;
    }
    const filled=`${payload.slots.filter(Boolean).length}/11 and ${payload.bench.length} on the bench`;
    const user=getUser();
    if(user){
      const teamName=document.getElementById('squad-team-name').value.trim();
      saveFormationToProfile(user.uid,{name:teamName,formation:payload.formation,slots:payload.slots,bench:payload.bench})
        .then(()=>{
          this._flashSquadStatus(`Saved "${teamName||'Untitled squad'}" to your profile — ${filled}`);
          this._refreshProfilePanel();
        })
        .catch(err=>{
          console.warn('[profile] save failed:',err);
          this._flashSquadStatus(`Saved locally, but profile save failed: ${err.message}`);
        });
    }else{
      this._flashSquadStatus(`Saved — ${filled}`);
    }
    this._refreshSavedSquadUI();
  }
  _loadSquad(){
    const saved=this._readSavedSquad();
    if(!saved) return;
    const known=id=>id&&getPlayerById(id)?id:null;
    const slots=(saved.slots||[]).slice(0,TEAM_SIZE).map(known);
    while(slots.length<TEAM_SIZE) slots.push(null);
    const bench=new Set((saved.bench||[]).map(known).filter(Boolean));
    const dropped=(saved.slots||[]).filter(Boolean).length-slots.filter(Boolean).length;
    if(saved.formation&&FORMATIONS[saved.formation]){
      this.chosenFormation=saved.formation;
      document.getElementById('formation-select').value=saved.formation;
    }
    this.squadSlots=slots; this.benchIds=bench;
    this._setEditSide('me'); // a saved squad is always your own side
    this._flashSquadStatus(`Loaded ${slots.filter(Boolean).length}/11${dropped?` — ${dropped} player(s) no longer in the roster`:''}`);
  }
  _refreshSavedSquadUI(){
    const saved=this._readSavedSquad();
    const btn=document.getElementById('squad-load-btn');
    btn.disabled=!saved;
    btn.textContent=saved?`📂 Load saved (${(saved.slots||[]).filter(Boolean).length}/11)`:'📂 Load saved';
  }
  _flashSquadStatus(msg){
    const el=document.getElementById('squad-save-status');
    el.textContent=msg;
    clearTimeout(this._squadStatusTimer);
    this._squadStatusTimer=setTimeout(()=>{ el.textContent=''; },4000);
  }

  /** The pitch/bench ("formation") and the searchable player list ("players")
   *  are independent collapsible sections, both open by default so a player
   *  picked from the list can be tapped straight onto a pitch/bench spot
   *  without switching views first. Collapsing one just frees up screen
   *  space; it doesn't affect which side (me/rival) is being edited. */
  _toggleSquadSection(view){
    this._setSquadSection(view,!this.squadSectionOpen[view]);
  }
  /** Filters within the "Browse Players" list are their own, independent
   *  collapsible — defaults open (see _initSquadEditor), separate from
   *  whether the whole "players" section itself is open. */
  _toggleSquadFilters(){
    const body=document.getElementById('squad-filters-body');
    const hidden=body.classList.toggle('filters-hidden');
    document.getElementById('squad-filters-toggle').textContent=hidden?'▸ Filters':'▾ Filters';
  }
  _setSquadSection(view,open){
    if(this.squadSectionOpen[view]===open) return;
    this.squadSectionOpen[view]=open;
    // An empty spot is only ever armed to be filled from this list (see
    // _armEmptySpot), so closing the list without picking anyone is a
    // change of mind — leave it armed and the *next* tap on another empty
    // spot would spend itself swapping the two, with nothing to show for
    // it. A pool player armed from the list is deliberately kept: placing
    // them onto the pitch is the whole point, and the pitch is what's left
    // once this closes.
    if(view==='players'&&!open&&this._isEmptySpot(this._squadSel)){
      this._squadSel=null; this._pickPosFilter=null;
      this._renderPitch(); this._renderPickList();
    }
    this._applySquadSectionVisibility();
  }
  _applySquadSectionVisibility(){
    const open=this.squadSectionOpen;
    document.getElementById('squad-editor').classList.toggle('hidden-section',!open.formation);
    const playersEl=document.getElementById('squad-players-view');
    playersEl.classList.toggle('hidden-section',!open.players);
    // Below 900px this also turns it into the overlay drawer (see the CSS
    // media query) instead of a stacked block — harmless above that width,
    // since the query it depends on simply doesn't match there.
    playersEl.classList.toggle('drawer-open',open.players);
    document.querySelectorAll('.view-tab').forEach(b=>b.classList.toggle('is-warning',!!open[b.dataset.view]));
  }

  // ---- which side ("me"/"rival") the pitch editor currently shows -------
  _edSlots(){ return this.editSide==='rival'?this.rivalSquadSlots:this.squadSlots; }
  _edSetSlots(v){ if(this.editSide==='rival') this.rivalSquadSlots=v; else this.squadSlots=v; }
  _edBench(){ return this.editSide==='rival'?this.rivalBenchIds:this.benchIds; }
  _edSetBench(v){ if(this.editSide==='rival') this.rivalBenchIds=v; else this.benchIds=v; }
  _edFormation(){ return this.editSide==='rival'?this.rivalFormation:this.chosenFormation; }
  _edSetFormation(v){ if(this.editSide==='rival') this.rivalFormation=v; else this.chosenFormation=v; }

  _setEditSide(side){
    this.editSide=side;
    document.getElementById('formation-select').value=this._edFormation();
    // Scoped to #squad-side-tabs — the view-tab buttons share the
    // .squad-side-tab class but have no data-side, so an unscoped query
    // would spuriously touch their own is-warning state too.
    document.querySelectorAll('#squad-side-tabs .squad-side-tab').forEach(b=>b.classList.toggle('is-primary',b.dataset.side===side));
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }

  /** Fills in any slot the rival XI is still missing at confirm time (e.g.
   *  the user removed someone there and never replaced them) — the rival
   *  never blocks the match from starting the way your own squad does. */
  _rivalSquadPayload(){
    const slots=this.rivalSquadSlots.slice();
    if(slots.some(id=>!id)){
      const exclude=new Set([...slots.filter(Boolean),...this.rivalBenchIds]);
      const roles=SLOT_ROLES[this.rivalFormation]||SLOT_ROLES[DEFAULT_FORMATION];
      const byPos={};
      for(const p of this.rosterAll) if(!exclude.has(p.id)) (byPos[p.position]=byPos[p.position]||[]).push(p);
      Object.values(byPos).forEach(list=>Phaser.Utils.Array.Shuffle(list));
      const take=pos=>{ const l=byPos[pos]; return l&&l.length?l.pop().id:null; };
      const takeAny=()=>{ for(const l of Object.values(byPos)) if(l.length) return l.pop().id; return null; };
      for(let i=0;i<slots.length;i++) if(!slots[i]) slots[i]=take(roles[i])||takeAny();
    }
    return {starterIds:slots.filter(Boolean),benchIds:[...this.rivalBenchIds],formation:this.rivalFormation};
  }

  /** Drops whichever pitch/bench player is currently selected back into the
   *  pool, leaving their slot empty. */
  _removeSelectedFromSquad(){
    const sel=this._squadSel; if(!sel) return;
    if(sel.type==='slot') this._edSlots()[sel.slot]=null;
    else this._edBench().delete(sel.id);
    this._squadSel=null;
    this._renderPitch(); this._renderPickList();
  }

  _allInSquad(){
    const s=new Set(this._edSlots().filter(Boolean));
    this._edBench().forEach(id=>s.add(id)); return s;
  }

  _renderPitch(){
    const pitch=document.getElementById('formation-pitch');
    pitch.innerHTML='<div class="pitch-line-h"></div>';
    const formation=this._edFormation();
    const preset=FORMATIONS[formation]||FORMATIONS[DEFAULT_FORMATION];
    const roles=SLOT_ROLES[formation]||SLOT_ROLES[DEFAULT_FORMATION];
    const slots=this._edSlots();
    const sel=this._squadSel;
    preset.forEach((f,slot)=>{
      const pin=document.createElement('div');
      pin.className='slot-pin'; pin.dataset.slot=slot;
      pin.style.left=(f.x*100)+'%';
      pin.style.top =((1-f.y)*100)+'%';
      const pid=slots[slot]; const p=pid?getPlayerById(pid):null;
      if(p){
        const col=this._css3(this._rosterColor(p));
        // Badge the position right on the pin, flagged when it doesn't match
        // what the slot asks for — otherwise a keeper parked at centre-back
        // only shows up by opening their card one at a time.
        const av=this._avatarFill(p,col);
        pin.innerHTML=`<div class="pin-avatar" style="${av.style}">${av.inner}</div>`
          +this._posBadge(p.position,p.position!==roles[slot])+this._ratingBadge(p)
          +`<div class="pin-name">${p.nickname||p.name}</div>`;
      } else {
        pin.classList.add('empty');
        pin.innerHTML=`<div style="font-size:9px;opacity:.55">${roles[slot]}</div>`;
      }
      if(sel&&sel.type==='slot'&&sel.slot===slot) pin.classList.add('selected');
      if(p) this._armPressGestures(pin,{onTap:()=>this._onSquadPinClick({type:'slot',slot}),onLongPress:()=>this._showPlayerStats(p)});
      else pin.addEventListener('click',()=>this._onSquadPinClick({type:'slot',slot}));
      pitch.appendChild(pin);
    });
    const strip=document.getElementById('bench-strip'); strip.innerHTML='';
    const benchIds=[...this._edBench()];
    // Always show all BENCH_MAX spots, empty ones included — otherwise the
    // bench is just an empty label until you've already put someone on it,
    // giving no hint there's a 5-spot bench to fill at all (unlike the
    // pitch, whose empty slots always show up front).
    for(let i=0;i<BENCH_MAX;i++){
      const pid=benchIds[i];
      const p=pid?getPlayerById(pid):null;
      const pin=document.createElement('div'); pin.className='bench-pin';
      if(p){
        pin.dataset.benchId=pid;
        const col=this._css3(this._rosterColor(p));
        const av=this._avatarFill(p,col);
        pin.innerHTML=`<div class="pin-avatar" style="${av.style}width:40px;height:40px;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;color:rgba(0,0,0,.8)">${av.inner}</div>`
          +this._posBadge(p.position)+this._ratingBadge(p)+`<div class="pin-name">${p.nickname||p.name}</div>`;
        if(sel&&sel.type==='bench'&&sel.id===pid) pin.classList.add('selected');
        this._armPressGestures(pin,{onTap:()=>this._onSquadPinClick({type:'bench',id:pid}),onLongPress:()=>this._showPlayerStats(p)});
      } else {
        pin.classList.add('empty');
        pin.innerHTML=`<div style="font-size:9px;opacity:.55">Bench</div>`;
        // Empty bench spots are interchangeable — there's no per-slot id to
        // distinguish them by, so they all share the same {id:null}
        // selection (a pool player tapped after arming one just adds to the
        // bench; see _swapSquadSelections' bench.delete(null) being a
        // harmless no-op).
        if(sel&&sel.type==='bench'&&sel.id==null) pin.classList.add('selected');
        pin.addEventListener('click',()=>this._onSquadPinClick({type:'bench',id:null}));
      }
      strip.appendChild(pin);
    }
    document.getElementById('bench-count').textContent=this._edBench().size;
    // The counter/button reflect the side on screen, but starting the match
    // only ever needs YOUR OWN squad complete — the rival tops itself off
    // automatically (see _rivalSquadPayload), so it never blocks Confirm.
    const shownFilled=slots.filter(Boolean).length;
    const shownRating=this._teamRating(slots);
    document.getElementById('squad-fill-count').textContent=`${shownFilled}/11 filled${shownRating!=null?` · ⭐ ${shownRating} avg`:''}`;
    const myFilled=this.squadSlots.filter(Boolean).length;
    const btn=document.getElementById('confirm-squad-btn');
    btn.textContent=`Confirm squad (${myFilled}/11)`; btn.disabled=myFilled!==TEAM_SIZE;
    // Offer the remove action only while a selected pin actually holds someone
    // already in the squad — a 'pool' selection (a list pick armed for
    // placement) isn't in the squad yet, so there's nothing to remove, just
    // a hint about where it'll go.
    const selP=(sel&&sel.type!=='pool')?this._squadSelPlayer(sel):null;
    const bar=document.getElementById('squad-remove-bar');
    bar.style.display=selP?'flex':'none';
    if(selP) document.getElementById('squad-remove-btn').textContent=`✕ Remove ${selP.nickname||selP.name}`;
    const poolP=(sel&&sel.type==='pool')?getPlayerById(sel.id):null;
    const hint=document.getElementById('squad-place-hint');
    hint.style.display=poolP?'flex':'none';
    if(poolP) document.getElementById('squad-place-hint-name').textContent=poolP.nickname||poolP.name;
    // The automatic kit colour is derived from the XI, so its preview has to
    // follow every change to it — this runs on all of them.
    this._syncTeamColorUI();
  }

  /** Colour-coded GK/DF/MF/FW chip. `mismatch` marks a player sitting in a
   *  slot that asks for a different role. */
  _posBadge(pos,mismatch=false){
    if(!pos) return '';
    return `<span class="pos-badge pos-${pos}${mismatch?' pos-mismatch':''}">${pos}</span>`;
  }
  /** Element chip (icon + name), or '' for the players the roster has no
   *  element for. */
  _elBadge(el,withName=true){
    if(!el) return '';
    return `<span class="el-badge el-${el}">${ELEMENT_ICON[el]||''}${withName?' '+el:''}</span>`;
  }
  /** Overall rating chip for a pitch/bench pin — banded by strength so a
   *  squad's weak spots stand out without reading each number.
   *  Thresholds track the centred rating's actual spread (see
   *  _ratingBaseline): every position sits on 100, so 103+ is a notably
   *  good player for their job, 98-102 the broad middle, below that a
   *  weak one — and it means the same thing for a keeper as for a
   *  forward, which is the point of centring. */
  _ratingBadge(p){
    const r=this._playerRating(p);
    const band=r>=103?'hi':r>=98?'mid':'low';
    return `<span class="rating-badge rating-${band}">${r}</span>`;
  }

  /** Team/game line for a card — with the game tag added whenever this
   *  name shows up more than once in the roster (the same character
   *  appearing once per game they were in, e.g. Mark Evans in both IE1 and
   *  Ares), since otherwise two such cards read as identical duplicates. */
  _teamLine(p){
    const base=p.team||p.game;
    if(!this.duplicateNames?.has(p.name)) return base;
    return p.team?`${base} (${p.game})`:base;
  }

  /** The roster stores the raw game numbers, so a stat sheet here shows
   *  exactly what the games' own character pages show ("Kick 90") rather
   *  than a rescaled invention of ours. Kept as a function anyway so the
   *  display layer still has one place to change if that ever stops being
   *  true. Display only; nothing gameplay-facing reads this. */
  _displayStat(v){
    return Math.round(v);
  }

  /** The two-stat line on a compact search-list card — see CARD_STAT_PAIR
   *  for which pair each position gets and why. */
  _cardStatLine(p){
    const [a,b]=CARD_STAT_PAIR[p.position]||['control','physical'];
    return `${STAT_ABBR[a]} ${this._displayStat(p.stats[a])} ${STAT_ABBR[b]} ${this._displayStat(p.stats[b])}`;
  }
  /** A single summary number for a player, in the same units as their own
   *  stats so the two sit side by side sensibly. Not a gameplay stat —
   *  nothing reads it but the cards and the "top players" randomizer. */
  _playerRating(p){
    return Math.round(this._ratingRaw(p));
  }
  /** Unrounded version of _playerRating — used for ranking, where the
   *  fractions the display rounding throws away still break ties.
   *  Weighted by position (see RATING_WEIGHTS): a plain average of the
   *  seven is worthless as a rating, because the source data conserves a
   *  near-fixed total per character, so it reads 95 for 71% of the
   *  roster. Weighing what a given job actually needs is what makes the
   *  number discriminate at all. */
  _ratingRaw(p){
    return RATING_CENTRE+this._ratingWeighted(p)-this._ratingBaseline()[p.position||'MF'];
  }
  /** What a position's own weights say about this player, before centring. */
  _ratingWeighted(p){
    const w=RATING_WEIGHTS[p.position]||RATING_WEIGHTS.MF;
    let total=0,sum=0;
    for(const k in w){ total+=(p.stats[k]||0)*w[k]; sum+=w[k]; }
    return sum?total/sum:0;
  }
  /** Median weighted score per position, so ratings can be centred on a
   *  shared 100 and actually compared across positions. Weighing each job
   *  by what it needs otherwise leaves the positions on different scales —
   *  forwards came out 108-116 against keepers' 95-99, so every forward in
   *  the game outranked every keeper and sorting by rating never showed a
   *  keeper at all. Centring keeps each position's internal spread (and so
   *  the order within it) while making 100 mean "typical for this job".
   *  Computed once from the loaded roster rather than hardcoded, so it
   *  can't drift out of date if the data is regenerated. */
  _ratingBaseline(){
    if(this._ratingBaselineCache) return this._ratingBaselineCache;
    const byPos={};
    for(const p of (this.rosterAll||[])) (byPos[p.position]=byPos[p.position]||[]).push(this._ratingWeighted(p));
    const out={};
    for(const pos in byPos){ const v=byPos[pos].sort((a,b)=>a-b); out[pos]=v[Math.floor(v.length/2)]; }
    // Before the roster resolves there's nothing to centre against; falling
    // back to 0 shift leaves the raw weighted number, which is still ordered
    // correctly within a position.
    const base=new Proxy(out,{get:(t,k)=>t[k]??RATING_CENTRE});
    if(this.rosterAll?.length) this._ratingBaselineCache=base;
    return base;
  }
  /** The better half (or whatever `frac` says) of `pool`, kept separate
   *  per position — so "top players" still gives a formation-fillable
   *  spread of keepers/defenders/midfielders/forwards instead of, say,
   *  skewing toward whichever position happens to rate marginally
   *  higher on average. */
  _topPercentileByPosition(pool,frac=0.2){
    const byPos={};
    for(const p of pool) (byPos[p.position]=byPos[p.position]||[]).push(p);
    return Object.values(byPos).flatMap(list=>{
      list.sort((a,b)=>this._ratingRaw(b)-this._ratingRaw(a));
      return list.slice(0,Math.max(1,Math.ceil(list.length*frac)));
    });
  }
  /** Average rating across a set of roster ids (a squad's XI, say) — null
   *  if there's nobody to average yet. */
  _teamRating(ids){
    const players=(ids||[]).filter(Boolean).map(id=>getPlayerById(id)).filter(Boolean);
    if(!players.length) return null;
    return Math.round(players.reduce((sum,p)=>sum+this._playerRating(p),0)/players.length);
  }

  _showPlayerStats(p){
    // Populate and show the stat panel overlay
    const el=document.getElementById('player-stat-panel');
    const col=this._css3(this._rosterColor(p));
    // All of a category's techniques, not just the one active in combat —
    // a player with two of the same kind can use either (see techniquesFor).
    // Tagged with the same icon as its stat above so it's clear at a
    // glance whether a move is a shot, dribble, defense or keeper move.
    const techs=['shot','dribble','defense','keeper'].flatMap(cat=>techniquesFor(p,cat).map(t=>({...t,cat})))
      .map(t=>`<div style="display:flex;justify-content:space-between;gap:8px"><span>${TECH_CAT_ICON[t.cat]} ${t.name}</span><span style="opacity:.7">${t.cost} PT</span></div>`).join('');
    const st=p.stats;
    // Mid-match, whoever's actually on the pitch has live PT/stamina; show
    // current/total for them. Otherwise (pre-match, or still on the bench)
    // there's no "current" yet, just their fresh starting totals.
    const live=this.matchStarted?this._statsFor(this.role,p.id):null;
    const ptLine=live?`${Math.round(live.sp)}/${Math.round(live.maxSP)}`:`${p.maxSP||100} max`;
    const staLine=live?`${Math.round(live.stamina)}/${Math.round(live.maxStamina)}`:`${p.maxStamina||150} max`;
    const avHead=this._avatarFill(p,col);
    el.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
        <span class="pin-avatar" style="${avHead.style}width:56px;height:56px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;color:rgba(0,0,0,.8);flex-shrink:0">${avHead.inner}</span>
        <div>
          <div style="font-weight:bold;font-size:15px">${p.name} <span style="opacity:.75;font-weight:normal;font-size:12px">· ⭐ ${this._playerRating(p)}</span></div>
          <div style="font-size:12px;opacity:.75;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${this._posBadge(p.position)}${this._elBadge(p.element)}<span>${this._teamLine(p)}</span></div>
        </div>
        <button onclick="document.getElementById('player-stat-panel').style.display='none'" style="margin-left:auto;background:none;border:none;color:white;font-size:20px;cursor:pointer">×</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;margin-bottom:10px;">
        <div>⚡ Kick <b>${this._displayStat(st.kick)}</b></div>
        <div>💨 Control <b>${this._displayStat(st.control)}</b></div>
        <div>✨ Technique <b>${this._displayStat(st.technique)}</b></div>
        <div>🛡 Pressure <b>${this._displayStat(st.pressure)}</b></div>
        <div>💪 Physical <b>${this._displayStat(st.physical)}</b></div>
        <div>🏃 Agility <b>${this._displayStat(st.agility)}</b></div>
        <div>🧠 Intelligence <b>${this._displayStat(st.intelligence)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;margin-bottom:10px;">
        <div>🔋 PT <b>${ptLine}</b></div>
        <div>🏋 Stamina <b>${staLine}</b></div>
      </div>
      ${techs?`<div style="font-size:11px;opacity:.7;margin-bottom:4px">Supertechniques:</div><div style="font-size:12px;display:flex;flex-direction:column;gap:3px">${techs}</div>`:'<div style="font-size:11px;opacity:.5">No supertechniques</div>'}
    `;
    el.style.display='block';
  }

  /** Wires a click-and-hold gesture onto `el`: a normal tap fires `onTap`
   *  exactly as a plain click listener would, while pressing and holding
   *  for LONG_PRESS_MS fires `onLongPress` instead and swallows the click
   *  the browser sends on release, so a long press never *also* triggers
   *  the tap action. Used to view a player's stats from a pin or card
   *  without spending the tap that arms/swaps/places it — replaced an
   *  earlier "tap the same selection again" gesture, which only worked
   *  once something was already armed and wasn't discoverable. The hold
   *  cancels itself if the pointer moves more than
   *  LONG_PRESS_MOVE_TOLERANCE (a scroll or the start of a drag), leaves,
   *  or releases before the delay is up — same shape as _setupWasdPad's
   *  press/release handling below. */
  _armPressGestures(el,{onTap,onLongPress}){
    let timer=null,longFired=false,start=null;
    const cancel=()=>{ if(timer){ clearTimeout(timer); timer=null; } };
    el.addEventListener('pointerdown',e=>{
      longFired=false; start={x:e.clientX,y:e.clientY};
      cancel();
      timer=setTimeout(()=>{ longFired=true; timer=null; onLongPress(); },LONG_PRESS_MS);
    });
    el.addEventListener('pointermove',e=>{
      if(!timer||!start) return;
      if(Math.hypot(e.clientX-start.x,e.clientY-start.y)>LONG_PRESS_MOVE_TOLERANCE) cancel();
    });
    el.addEventListener('pointerup',cancel);
    el.addEventListener('pointerleave',cancel);
    el.addEventListener('pointercancel',cancel);
    el.addEventListener('click',()=>{
      if(longFired){ longFired=false; return; }
      onTap();
    });
  }
  // Tap-to-swap: tap a pin (or a not-yet-picked player card) to select it,
  // tap a different one to swap/place them. A second tap on the pin already
  // armed cancels the arm instead (see _onSquadPinClick) — viewing stats is
  // now a press-and-hold on any pin/card, independent of arm state (see
  // _armPressGestures and its call sites in _renderPitch/_renderPickList).
  // Replaces drag-and-drop, which was unreliable on touch (lost pointer
  // capture, accidental scrolling). A 'pool' selection is a player from the
  // search list who isn't in the squad yet — placing them onto a slot/bench
  // spot works whether or not that spot is already occupied.
  _squadSel=null;
  _pickPage=0;
  /** Position the list is currently narrowed to, set by tapping an empty
   *  pitch slot (see _armEmptySpot). Transient and separate from the
   *  search-row filters — it's cleared as soon as the spot that asked for
   *  it is filled, rather than being another thing left set behind you. */
  _pickPosFilter=null;
  _onSquadPinClick(sel){
    if(!this._squadSel){
      this._squadSel=sel;
      if(sel.type!=='pool'&&!this._squadSelPlayer(sel)) this._armEmptySpot(sel);
      this._renderPitch(); this._renderPickList(); return;
    }
    if(this._squadSel.type===sel.type&&(sel.type==='slot'?this._squadSel.slot===sel.slot:this._squadSel.id===sel.id)){
      // Tapping the pin already armed is a change of mind — cancel the arm.
      // Viewing stats no longer lives here; press and hold instead.
      this._squadSel=null; this._pickPosFilter=null;
      this._renderPitch(); this._renderPickList();
      return;
    }
    if(this._isEmptySpot(this._squadSel)&&this._isEmptySpot(sel)){
      // Swapping two empty spots does nothing, so tapping a second one is
      // a change of mind about which to fill — re-arm there (and re-scope
      // the list to it) rather than spending the tap on a no-op swap that
      // also clears the selection.
      this._squadSel=sel; this._armEmptySpot(sel);
      this._renderPitch(); this._renderPickList();
      return;
    }
    if(this._squadSel.type==='pool'&&sel.type==='pool'){
      // Picking a second, still-unassigned player just re-arms the
      // selection to them instead of a meaningless pool-to-pool "swap".
      this._squadSel=sel; this._renderPitch(); this._renderPickList();
      return;
    }
    this._swapSquadSelections(this._squadSel,sel);
    this._squadSel=null;
    this._finishSpotFill();
    this._renderPitch(); this._renderPickList();
  }
  /** Tapping an empty spot is only ever a request to fill it, so it doubles
   *  as "open the list, showing the players that fit here" — which is what
   *  makes filling an XI two taps a player (spot, then player) instead of
   *  opening the list, hunting for someone, and going back for the spot.
   *  Bench spots take anyone (they're generic cover, not a role), so they
   *  open the list unnarrowed. */
  _isEmptySpot(sel){ return !!sel&&sel.type!=='pool'&&!this._squadSelPlayer(sel); }
  _armEmptySpot(sel){
    const roles=SLOT_ROLES[this._edFormation()]||SLOT_ROLES[DEFAULT_FORMATION];
    this._pickPosFilter=sel.type==='slot'?(roles[sel.slot]||null):null;
    this._pickPage=0;
    this._setSquadSection('players',true);
  }
  /** A completed placement retires the narrowing it was made under, and — on
   *  the narrow layout, where the list is a drawer over the pitch — gets the
   *  drawer out of the way again, so the next spot is right there to tap
   *  without a close in between. Above 900px the list is a permanent column
   *  beside the pitch and collapsing it mid-flow would only be startling. */
  _finishSpotFill(){
    this._pickPosFilter=null;
    if(window.innerWidth<900) this._setSquadSection('players',false);
  }
  _squadSelPlayer(sel){
    const id=sel.type==='slot'?this._edSlots()[sel.slot]:sel.id;
    return id?getPlayerById(id):null;
  }
  /** Maps a roster player to whichever selection they currently represent —
   *  their pitch slot, their bench spot, or 'pool' if they're not in the
   *  squad at all — so a card in the search list is, for selection purposes,
   *  the exact same thing as tapping that player's own pin would be. */
  _squadSelForPlayer(p){
    const slotIdx=this._edSlots().indexOf(p.id);
    if(slotIdx!==-1) return {type:'slot',slot:slotIdx};
    if(this._edBench().has(p.id)) return {type:'bench',id:p.id};
    return {type:'pool',id:p.id};
  }
  _selMatchesPlayer(sel,p){
    if(!sel) return false;
    return sel.type==='slot'?this._edSlots()[sel.slot]===p.id:sel.id===p.id;
  }
  _swapSquadSelections(a,b){
    const slots=this._edSlots(), bench=this._edBench();
    if(a.type==='pool'||b.type==='pool'){
      const poolSel=a.type==='pool'?a:b, target=a.type==='pool'?b:a;
      if(target.type==='slot'){
        const cur=slots[target.slot];
        slots[target.slot]=poolSel.id;
        // The displaced starter goes to the bench if there's room, otherwise
        // they're simply dropped from the squad (same as hitting Remove).
        if(cur&&!bench.has(cur)&&bench.size<BENCH_MAX) bench.add(cur);
      } else {
        bench.delete(target.id);
        bench.add(poolSel.id);
      }
      return;
    }
    if(a.type==='slot'&&b.type==='slot'){
      const tmp=slots[a.slot]; slots[a.slot]=slots[b.slot]; slots[b.slot]=tmp;
    } else if(a.type==='bench'&&b.type==='bench'){
      // Nothing changes — both stay on the bench.
    } else {
      const slotSel=a.type==='slot'?a:b, benchSel=a.type==='bench'?a:b;
      const cur=slots[slotSel.slot];
      slots[slotSel.slot]=benchSel.id;
      bench.delete(benchSel.id);
      if(cur) bench.add(cur);
    }
  }

  /** Most real teams recur across several games (Raimon alone spans
   *  IE1/IE2/IE3/GO1/GO2/GO3/Ares, each with a totally different XI) — a
   *  flat "Raimon" filter option used to pool every era together, which
   *  buries a specific squad in a much bigger, mixed-era one. A team with
   *  just one game's worth of players stays a single plain option; one that
   *  spans several gets an <optgroup> with an "All eras" option (the old
   *  behaviour) plus one option per game, so a specific era's roster is
   *  directly selectable instead of always getting the merged pool. */
  _populateTeamFilter(){
    const ts=document.getElementById('squad-team-filter');
    const gameOrder=getGames();
    const byTeam=new Map();
    this.rosterAll.forEach(p=>{
      if(!p.team) return;
      if(!byTeam.has(p.team)) byTeam.set(p.team,new Map());
      const gm=byTeam.get(p.team);
      gm.set(p.game,(gm.get(p.game)||0)+1);
    });
    [...byTeam.keys()].sort((a,b)=>a.localeCompare(b)).forEach(team=>{
      const gameCounts=byTeam.get(team);
      const games=[...gameCounts.keys()].sort((a,b)=>gameOrder.indexOf(a)-gameOrder.indexOf(b));
      if(games.length<=1){
        const o=document.createElement('option'); o.value=team; o.textContent=team; ts.appendChild(o);
        return;
      }
      const total=[...gameCounts.values()].reduce((s,n)=>s+n,0);
      const group=document.createElement('optgroup'); group.label=team;
      const allOpt=document.createElement('option'); allOpt.value=team; allOpt.textContent=`All eras (${total})`; group.appendChild(allOpt);
      games.forEach(g=>{
        const o=document.createElement('option'); o.value=`${team}::${g}`; o.textContent=`${g} (${gameCounts.get(g)})`; group.appendChild(o);
      });
      ts.appendChild(group);
    });
  }
  /** Splits a `squad-team-filter` value back into {team, game} — plain team
   *  filters (single-game teams, or the "All eras" option) have no game. */
  _parseTeamFilter(tf){
    if(!tf) return {team:null,game:null};
    const i=tf.indexOf('::');
    return i===-1?{team:tf,game:null}:{team:tf.slice(0,i),game:tf.slice(i+2)};
  }

  /** Sort comparators for the search list — stats sort strongest-first, name
   *  and position sort alphabetically. */
  _pickListSorters(){
    const byName=(a,b)=>(a.nickname||a.name).localeCompare(b.nickname||b.name);
    return {
      rating:  (a,b)=>this._playerRating(b)-this._playerRating(a)||byName(a,b),
      name:    byName,
      position:(a,b)=>(a.position||'').localeCompare(b.position||'')||byName(a,b),
      ...Object.fromEntries(NATIVE_STATS.map(k=>[k,(a,b)=>b.stats[k]-a.stats[k]||byName(a,b)])),
    };
  }
  /** Search/filter/sort changes invalidate whatever page you were on —
   *  otherwise a narrowed search could leave you stranded on a page past
   *  the end, looking at an empty list with no clue why. */
  _renderPickListReset(){ this._pickPage=0; this._renderPickList(); }
  _renderPickList(){
    const list=document.getElementById('squad-pick-list');
    const q=(document.getElementById('squad-search').value||'').toLowerCase();
    const gf=document.getElementById('squad-game-filter').value;
    const {team:tfTeam,game:tfGame}=this._parseTeamFilter(document.getElementById('squad-team-filter').value);
    const sortKey=document.getElementById('squad-sort-select').value;
    const inSquad=this._allInSquad(); const PAGE_SIZE=30;
    const sel=this._squadSel;
    // _pickPosFilter is the "scope" lock set when tapping an empty pitch
    // spot (narrows to that slot's role, with its own banner/clear button
    // below); squad-position-filter is the independent, user-toggleable
    // filter in the search row. A scope lock wins if both are somehow set,
    // since it reflects an actual spot you're about to fill.
    const scopePos=this._pickPosFilter;
    const userPos=document.getElementById('squad-position-filter').value;
    const pos=scopePos||userPos;
    const matches=this.rosterAll.filter(p=>(!pos||p.position===pos)&&(!gf||p.game===gf)&&(!tfTeam||p.team===tfTeam)&&(!tfGame||p.game===tfGame)&&(!q||p.name.toLowerCase().includes(q)||(p.nickname||'').toLowerCase().includes(q)));
    // Say which spot the list is narrowed for, with the way out of it — the
    // narrowing is invisible otherwise, and a roster of ~5000 suddenly
    // showing a few hundred reads as a bug rather than as help.
    const scope=document.getElementById('pick-scope');
    scope.style.display=scopePos?'flex':'none';
    if(scopePos) document.getElementById('pick-scope-role').textContent=scopePos;
    document.getElementById('squad-position-filter').disabled=!!scopePos;
    const sorters=this._pickListSorters();
    matches.sort(sorters[sortKey]||sorters.rating);
    const pageCount=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
    this._pickPage=Phaser.Math.Clamp(this._pickPage,0,pageCount-1);
    document.getElementById('pick-count').textContent=`${matches.length} players`;
    document.getElementById('pick-page-info').textContent=`Page ${this._pickPage+1}/${pageCount}`;
    document.getElementById('pick-prev-btn').disabled=this._pickPage<=0;
    document.getElementById('pick-next-btn').disabled=this._pickPage>=pageCount-1;
    list.innerHTML='';
    matches.slice(this._pickPage*PAGE_SIZE,(this._pickPage+1)*PAGE_SIZE).forEach(p=>{
      const card=document.createElement('div');
      const isSel=this._selMatchesPlayer(sel,p);
      card.className='pick-card'+(inSquad.has(p.id)?' in-squad':'')+(isSel?' selected':'');
      const col=this._css3(this._rosterColor(p));
      const av=this._avatarFill(p,col);
      card.innerHTML=`<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;"><span class="av" style="width:32px;height:32px;font-size:10px;${av.style}flex-shrink:0">${av.inner}</span>${this._posBadge(p.position)}<span class="pick-name">${p.nickname||p.name}</span><span style="margin-left:auto;font-size:10px;font-weight:bold;color:#ffd966;">${this._playerRating(p)}</span></div><div style="font-size:10px;opacity:.7">${this._elBadge(p.element,false)} ${this._teamLine(p)}</div><div style="font-size:10px;opacity:.6">${this._cardStatLine(p)}</div>`;
      // A list card is, for selection purposes, exactly the pin it maps to
      // (pitch slot / bench / pool) — tap to select/place, press and hold
      // to see its full stats.
      this._armPressGestures(card,{onTap:()=>this._onSquadPinClick(this._squadSelForPlayer(p)),onLongPress:()=>this._showPlayerStats(p)});
      list.appendChild(card);
    });
    document.getElementById('squad-whole-team-btn').disabled=!gf&&!tfTeam;
  }

  /** Fills the XI from `pool` so every slot gets someone who actually plays
   *  that position (keeper slot from keepers, defensive slots from defenders
   *  and so on), then stocks the bench with a spread of cover. */
  _fillSquadByPosition(pool){
    const roles=SLOT_ROLES[this._edFormation()]||SLOT_ROLES[DEFAULT_FORMATION];
    const byPos={};
    for(const p of pool) (byPos[p.position]=byPos[p.position]||[]).push(p);
    Object.values(byPos).forEach(list=>Phaser.Utils.Array.Shuffle(list));
    const take=pos=>{ const l=byPos[pos]; return l&&l.length?l.pop().id:null; };
    const takeAny=()=>{ for(const l of Object.values(byPos)) if(l.length) return l.pop().id; return null; };
    const slots=roles.slice(0,TEAM_SIZE).map(r=>take(r));
    // A narrow pool (one club, say) may not field four defenders — backfill
    // from whoever is left so the XI still comes out complete.
    for(let i=0;i<TEAM_SIZE;i++) if(!slots[i]) slots[i]=takeAny();
    this._edSetSlots(slots);
    this._edSetBench(new Set(BENCH_COVER.map(pos=>take(pos)||takeAny()).filter(Boolean)));
  }

  _useWholeTeam(){
    const gf=document.getElementById('squad-game-filter').value;
    const {team:tfTeam,game:tfGame}=this._parseTeamFilter(document.getElementById('squad-team-filter').value);
    if(!gf&&!tfTeam) return;
    this._fillSquadByPosition(this.rosterAll.filter(p=>(!tfTeam||p.team===tfTeam)&&(!tfGame||p.game===tfGame)&&(!gf||p.game===gf)));
    this._squadSel=null; this._pickPosFilter=null;
    this._renderPitch(); this._renderPickList();
  }

  /** Rolls a random formation, then fills the XI with a blend: 2–3 slots
   *  (chosen at random) get a top-rated player for their position (see
   *  _topPercentileByPosition), the rest get an ordinary random one — a
   *  few standout names in an otherwise unpredictable squad, rather than
   *  either fully random (usually mediocre) or stacking every slot with a
   *  star (no surprise left at all). Falls back to whichever pool actually
   *  has a candidate left, same spirit as _fillSquadByPosition's own
   *  backfill, so a thin position never leaves a slot empty. */
  _randomize(){
    // Shape first, then fill it position by position — the slot roles depend
    // on the formation, so picking it afterwards would mismatch them.
    this._edSetFormation(Phaser.Utils.Array.GetRandom(Object.keys(FORMATIONS)));
    document.getElementById('formation-select').value=this._edFormation();

    const roles=SLOT_ROLES[this._edFormation()]||SLOT_ROLES[DEFAULT_FORMATION];
    const byPos={}, byPosTop={};
    for(const p of this.rosterAll) (byPos[p.position]=byPos[p.position]||[]).push(p);
    for(const p of this._topPercentileByPosition(this.rosterAll)) (byPosTop[p.position]=byPosTop[p.position]||[]).push(p);
    Object.values(byPos).forEach(list=>Phaser.Utils.Array.Shuffle(list));
    Object.values(byPosTop).forEach(list=>Phaser.Utils.Array.Shuffle(list));

    // Both pools draw from the same players, so track who's already placed
    // to avoid picking the same person for two slots.
    const used=new Set();
    const take=(map,pos)=>{ const l=map[pos]; while(l&&l.length){ const p=l.pop(); if(!used.has(p.id)){ used.add(p.id); return p.id; } } return null; };
    const takeAny=map=>{ for(const l of Object.values(map)) while(l&&l.length){ const p=l.pop(); if(!used.has(p.id)){ used.add(p.id); return p.id; } } return null; };

    const starCount=Phaser.Math.Between(2,3);
    const starSlots=new Set(Phaser.Utils.Array.Shuffle([...Array(TEAM_SIZE).keys()]).slice(0,starCount));
    const slots=roles.slice(0,TEAM_SIZE).map((role,i)=>
      starSlots.has(i) ? (take(byPosTop,role)??take(byPos,role)) : (take(byPos,role)??take(byPosTop,role))
    );
    for(let i=0;i<TEAM_SIZE;i++) if(!slots[i]) slots[i]=takeAny(byPos)??takeAny(byPosTop);
    this._edSetSlots(slots);
    this._edSetBench(new Set(BENCH_COVER.map(pos=>take(byPos,pos)??takeAny(byPos)).filter(Boolean)));

    this._squadSel=null; this._pickPosFilter=null;
    this._renderPitch(); this._renderPickList();
  }

  _confirmSquad(){
    const starterIds=this.squadSlots.filter(Boolean); if(starterIds.length!==TEAM_SIZE) return;
    const payload={starterIds,benchIds:[...this.benchIds],formation:this.chosenFormation,color:this.myTeamColor};
    if(this.uiMode==='tournament'){ this._startTournamentWithSquad(payload); return; }
    this.mySquadPayload=payload; this.mySquadConfirmed=true;
    this.net.sendSquad(payload);
    document.getElementById('confirm-squad-btn').disabled=true;
    if(this.uiMode==='solo'){ this._startMatch(payload,this._rivalSquadPayload()); return; }
    this._tryStartMultiplayerMatch();
    // Trystero's WebRTC data channel can drop a message sent right as it's
    // still finishing setup (see onPeerConnect's own resend-on-connect
    // above) — belt and suspenders against any such silently-lost squad,
    // from either side, this keeps re-sending mine and re-checking every
    // couple seconds until the match actually starts, instead of leaving
    // both players stuck on a single send that never landed.
    if(this._squadRetryTimer) clearInterval(this._squadRetryTimer);
    this._squadRetryTimer=setInterval(()=>{
      if(this.matchStarted){ clearInterval(this._squadRetryTimer); this._squadRetryTimer=null; return; }
      this.net.sendSquad(this.mySquadPayload);
      this._tryStartMultiplayerMatch();
    },2000);
  }
  /** Re-checks whether a multiplayer match can start now. Safe (and meant)
   *  to be called redundantly from any of the several events that could be
   *  the "last domino" needed — confirming your own squad, the peer's
   *  squad arriving over the network, or role finally settling from the
   *  provisional pre-handshake guess to the real host/guest comparison —
   *  instead of wiring the start-check to only one of them and hoping it's
   *  always the one that happens last. In particular: a squad confirmed
   *  while role was still the provisional guess, followed by a later flip
   *  from that guess to the real answer, used to leave a stale "Waiting
   *  for opponent…" on a client that had actually become the guest — this
   *  re-derives the right status (or starts the match outright) the moment
   *  role actually settles, not just on the next network message. */
  _tryStartMultiplayerMatch(){
    if(this.uiMode!=='multiplayer'||this.matchStarted||!this.mySquadConfirmed) return;
    if(this.role==='A'){
      if(this.remoteSquadPayload) this._startMatch(this.mySquadPayload,this.remoteSquadPayload);
      else document.getElementById('squad-status').textContent='Waiting for opponent…';
    } else {
      document.getElementById('squad-status').textContent='Waiting for match to start…';
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Tournaments (offline knockouts/leagues against the game's real teams)
  // ════════════════════════════════════════════════════════════════════
  /** Flat list of selectable team(+era) options for the tournament entrant
   *  picker — same grouping _populateTeamFilter uses for the squad editor's
   *  team dropdown (values in the same 'Team' / 'Team::Game' shape
   *  _parseTeamFilter reads), just flattened instead of built into
   *  <optgroup>s. Deliberately no pooled "All eras" option here, unlike the
   *  dropdown: an entrant's roster needs to be one well-defined pool, and a
   *  pooled option would silently overlap with its own per-era options.
   *
   *  Many one-off rival teams in the source data only have a handful of
   *  named players (sometimes just one) — real for a cameo opponent, but
   *  not enough to field an XI (see _fillSquadByPosition's own backfill,
   *  which only papers over a *position* being thin, not the whole pool).
   *  Anything under TEAM_SIZE players is left out of the picker entirely
   *  rather than offered as a tournament entrant it can't actually be. */
  _teamEraOptions(){
    const gameOrder=getGames();
    const byTeam=new Map();
    this.rosterAll.forEach(p=>{
      if(!p.team) return;
      if(!byTeam.has(p.team)) byTeam.set(p.team,new Map());
      const gm=byTeam.get(p.team);
      gm.set(p.game,(gm.get(p.game)||0)+1);
    });
    const options=[];
    [...byTeam.keys()].sort((a,b)=>a.localeCompare(b)).forEach(team=>{
      const gameCounts=byTeam.get(team);
      const allGames=[...gameCounts.keys()];
      const viableGames=allGames.sort((a,b)=>gameOrder.indexOf(a)-gameOrder.indexOf(b)).filter(g=>gameCounts.get(g)>=TEAM_SIZE);
      if(allGames.length<=1){
        if(viableGames.length) options.push({value:team,label:team});
        return;
      }
      viableGames.forEach(g=>options.push({value:`${team}::${g}`,label:`${team} (${g})`}));
    });
    return options;
  }
  _entrantLabel(entrantId){
    if(entrantId==='me') return 'You';
    const {team,game}=this._parseTeamFilter(entrantId);
    return game?`${team} (${game})`:team;
  }
  _entrantPool(entrantId){
    const {team,game}=this._parseTeamFilter(entrantId);
    return this.rosterAll.filter(p=>p.team===team&&(!game||p.game===game));
  }
  /** Average player rating for a side — used only to weight the instant
   *  simulation of matches that don't involve the player (see
   *  advanceAuto/simulateResult in tournament.js); a real fixture is always
   *  actually played, never scored off this number. */
  _entrantStrength(entrantId){
    const ids=entrantId==='me'?this.squadSlots.filter(Boolean):this._entrantPool(entrantId).map(p=>p.id);
    if(!ids.length) return RATING_CENTRE;
    const sum=ids.reduce((s,id)=>{ const p=getPlayerById(id); return s+(p?this._playerRating(p):RATING_CENTRE); },0);
    return sum/ids.length;
  }
  /** Fields the rival side with `entrantId`'s actual roster — reuses the
   *  exact same position-aware fill a random rival already gets (see
   *  _fillSquadByPosition), just narrowed to one team's pool, so playing a
   *  tournament fixture is nothing more than "arm the rival side with the
   *  opponent, then go through the normal Formation/Confirm flow." */
  _setRivalToEntrant(entrantId){
    const pool=this._entrantPool(entrantId);
    const prevSide=this.editSide;
    this.editSide='rival';
    this._fillSquadByPosition(pool);
    this.editSide=prevSide;
  }

  /** The pre-squad setup screen (reached from the mode-select "🏆
   *  Tournament" button) only records which type/size the player wants —
   *  opponents aren't drawn and nothing starts yet. It then hands off to
   *  the normal squad editor to build an XI, exactly like solo/multiplayer
   *  do; the tournament actually starts once that squad is confirmed (see
   *  _startTournamentWithSquad, called from _confirmSquad). */
  _confirmTournamentSetup(){
    this.pendingTournamentType=document.querySelector('input[name="tournament-type"]:checked')?.value||'knockout';
    this.pendingTournamentSize=parseInt(document.querySelector('input[name="tournament-size"]:checked')?.value,10)||4;
    this.uiMode='tournament';
    this._applyUiMode();
    document.getElementById('tournament-panel').style.display='none';
    document.getElementById('squad-editor-panel').style.display='flex';
  }
  /** "← Back" out of the tournament panel — used both from the pre-squad
   *  setup form and from a running tournament's view. Squad editor is no
   *  longer the hub tournaments live behind (see _confirmTournamentSetup),
   *  so this always returns to mode-select rather than the editor. */
  _closeTournamentPanel(){
    document.getElementById('tournament-panel').style.display='none';
    this._showModeSelect();
  }
  /** Called from _confirmSquad once the type/size chosen on the setup
   *  screen are in hand: locks the just-built squad in as `mySquad` for
   *  every fixture of this tournament — there's no way back into Formation
   *  to change it once it's running (see _playTournamentFixture, which
   *  starts each match directly instead of routing through the editor).
   *  Opponents are drawn at random from the viable team/era pool. Knockout
   *  opponents are then seeded by strength (weakest first, so the
   *  player's path gets tougher round by round — see makeSeededKnockout);
   *  a league stays a flat random draw, same difficulty throughout. */
  _startTournamentWithSquad(mySquad){
    const type=this.pendingTournamentType||'knockout';
    const size=this.pendingTournamentSize||4;
    const opponents=Phaser.Utils.Array.Shuffle(this._teamEraOptions().map(o=>o.value)).slice(0,size-1);
    const built=type==='knockout'
      ?makeSeededKnockout(['me',...opponents.slice().sort((a,b)=>this._entrantStrength(b)-this._entrantStrength(a))])
      :makeLeague(['me',...opponents]);
    this.activeTournament={...built,mySquad};
    saveTournament(this.activeTournament);
    document.getElementById('squad-editor-panel').style.display='none';
    document.getElementById('tournament-panel').style.display='flex';
    this._renderTournamentPanel();
  }
  /** Sets the rival side up for the given fixture and starts the match
   *  directly with the squad locked in at _startTournamentWithSquad — no
   *  detour through Formation/Confirm, so there's never a chance to swap
   *  in a different XI partway through a tournament. */
  _playTournamentFixture(pending){
    const opponent=pending.a==='me'?pending.b:pending.a;
    this._setRivalToEntrant(opponent);
    this._tournamentPendingFixture=pending;
    document.getElementById('tournament-panel').style.display='none';
    this._startMatch(this.activeTournament.mySquad,this._rivalSquadPayload());
  }
  /** Called from _showFullTime right after a tournament fixture's score is
   *  known. myGoals/oppGoals are already normalised for which network role
   *  was "me" — see _showFullTime's own mine/theirs. */
  _recordTournamentResult(pending,myGoals,oppGoals){
    const scoreA=pending.a==='me'?myGoals:oppGoals;
    const scoreB=pending.b==='me'?myGoals:oppGoals;
    const updated=pending.kind==='knockout'
      ?recordKnockoutResult(this.activeTournament,pending.matchIdx,scoreA,scoreB)
      :recordLeagueResult(this.activeTournament,pending.fixtureIdx,scoreA,scoreB);
    // recordKnockoutResult/recordLeagueResult/advanceAuto all update the
    // tournament by spreading {...t, ...changes} — mySquad rides along
    // through every one of those untouched, no need to re-attach it here.
    const res=advanceAuto(updated,'me',id=>this._entrantStrength(id));
    this.activeTournament=res.tournament;
    saveTournament(this.activeTournament);
    this._tournamentPendingFixture=null;
  }
  _renderTournamentPanel(){
    const body=document.getElementById('tournament-body');
    if(!this.activeTournament){
      body.innerHTML=`
        <div style="max-width:480px;width:100%;">
          <div style="display:flex;gap:16px;margin-bottom:14px;justify-content:center;">
            <label style="font-size:13px;"><input type="radio" name="tournament-type" value="knockout" checked> Knockout</label>
            <label style="font-size:13px;"><input type="radio" name="tournament-type" value="league"> League</label>
          </div>
          <div style="font-size:12px;opacity:.75;margin-bottom:6px;text-align:center;">Number of teams (you + random opponents):</div>
          <div style="display:flex;gap:16px;margin-bottom:14px;justify-content:center;">
            <label style="font-size:13px;"><input type="radio" name="tournament-size" value="4" checked> 4</label>
            <label style="font-size:13px;"><input type="radio" name="tournament-size" value="8"> 8</label>
            <label style="font-size:13px;"><input type="radio" name="tournament-size" value="16"> 16</label>
          </div>
          <div style="font-size:11px;opacity:.7;margin-bottom:10px;text-align:center;">Next, build your squad — it locks in for the whole tournament once it starts. Opponents are drawn at random from the game's real teams; in a knockout they get tougher each round you win, a league stays one flat difficulty throughout.</div>
          <div style="text-align:center;"><button class="nes-btn is-primary" data-tournament-action="setup-continue">Continue</button></div>
        </div>`;
      return;
    }
    // Converge any matches that don't involve the player before rendering —
    // idempotent and cheap, so simplest to just always do it here.
    const res=advanceAuto(this.activeTournament,'me',id=>this._entrantStrength(id));
    if(res.tournament!==this.activeTournament){ this.activeTournament=res.tournament; saveTournament(this.activeTournament); }
    const t=this.activeTournament, pending=res.pending;
    const label=id=>this._entrantLabel(id);
    const matchRow=(m)=>{
      const played=m.scoreA!=null;
      const aWin=played&&m.scoreA>m.scoreB, bWin=played&&m.scoreB>m.scoreA;
      return `<div style="font-size:12px;padding:4px 6px;margin-bottom:4px;background:var(--panel-2);border:1px solid rgba(255,255,255,.15);">
        <div style="${aWin?'font-weight:bold':''}">${label(m.a)}${played?` <span style="opacity:.7">${m.scoreA}</span>`:''}</div>
        <div style="${bWin?'font-weight:bold':''}">${m.bye?'<span style="opacity:.6">— bye —</span>':`${label(m.b)}${played?` <span style="opacity:.7">${m.scoreB}</span>`:''}`}</div>
      </div>`;
    };
    const headerHtml=`<div style="font-size:12px;opacity:.75;margin-bottom:4px;">${t.type==='knockout'?'Knockout':'League'} — ${t.entrants.length} teams</div>
      <div style="font-size:11px;opacity:.7;margin-bottom:10px;">Your squad: ${t.mySquad?.formation||'?'} (locked for this tournament)</div>`;
    let bodyHtml;
    if(t.type==='knockout'){
      bodyHtml=`${headerHtml}<div style="display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;max-width:100%;">
          ${t.rounds.map((round,ri)=>`<div style="min-width:150px;flex:0 0 auto;">
            <div style="font-size:11px;opacity:.7;margin-bottom:6px;">Round ${ri+1}</div>
            ${round.map(matchRow).join('')}
          </div>`).join('')}
        </div>`;
    } else {
      // Drawn as a real league table (nes.css's own pixel-art table style)
      // rather than plain rows — ranked, with your row picked out in bold.
      const standings=leagueStandings(t);
      bodyHtml=`${headerHtml}<table class="nes-table is-dark is-bordered is-centered" style="font-size:11px;width:100%;max-width:480px;margin:0 auto;">
          <thead><tr><th>#</th><th style="text-align:left;">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${standings.map((r,i)=>`<tr style="${r.id==='me'?'font-weight:bold':''}"><td>${i+1}</td><td style="text-align:left;">${label(r.id)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd}</td><td>${r.points}</td></tr>`).join('')}</tbody>
        </table>`;
    }
    let actionHtml='';
    if(pending){
      const opponent=pending.a==='me'?pending.b:pending.a;
      const idx=pending.kind==='knockout'?pending.matchIdx:pending.fixtureIdx;
      actionHtml=`<button class="nes-btn is-primary" style="margin-top:14px;" data-tournament-action="play" data-kind="${pending.kind}" data-a="${pending.a}" data-b="${pending.b}" data-idx="${idx}">Play next: You vs ${label(opponent)}</button>`;
    } else if(t.completedAt){
      const championId=t.type==='knockout'?t.champion:leagueStandings(t)[0].id;
      actionHtml=`<div style="margin-top:14px;font-size:14px;">🏆 ${t.type==='knockout'?'Champion':'Winner'}: <b>${label(championId)}</b></div>
        <button class="nes-btn is-primary" style="margin-top:8px;" data-tournament-action="end">New tournament</button>`;
    }
    const abandonHtml=t.completedAt?'':`<div style="margin-top:10px;"><button class="nes-btn is-error is-compact" data-tournament-action="end">Abandon tournament</button></div>`;
    body.innerHTML=`<div style="max-width:640px;width:100%;">${bodyHtml}${actionHtml}${abandonHtml}</div>`;
  }

  // ════════════════════════════════════════════════════════════════════
  // Match setup
  // ════════════════════════════════════════════════════════════════════
  _buildTeam(role, starterIds, withPhysics){
    const team=[]; const map=role==='A'?this.statsMapA:this.statsMapB;
    const tColor=role==='A'?this.teamColorA:this.teamColorB;
    starterIds.forEach((id,slot)=>{
      const rp=getPlayerById(id); if(!rp) return;
      const pos=this._formPos(role,slot,{x:this.FIELD_W/2,y:this.FIELD_H/2},true);
      const body=withPhysics?this.matter.add.circle(pos.x,pos.y,12,{frictionAir:.16,label:`${role}${slot}`,
        collisionFilter:{category:CAT_PLAYER,mask:CAT_BALL|CAT_DEFAULT}}):null;
      if(body) this.bodyOwner.set(body,{role,id});
      const gfx=this.add.circle(pos.x,pos.y,12,tColor).setDepth(5);
      // A dark plate behind the name rather than an outline or a shadow on
      // bare glyphs. 9px white text with a soft shadow was legible in
      // isolation but not over a pitch: thin light strokes on mid-green is
      // barely any contrast, and an outline thick enough to fix that at
      // this size eats the letters (a 3px one on 7px text read as a black
      // blob, which is what the shadow replaced). A plate gives every name
      // the same contrast wherever it sits. Pixelify Sans is the UI font
      // and stays crisp small; the roster has long since loaded by the
      // time a match builds its teams, so the webfont is available.
      const label=this.add.text(pos.x,pos.y+15,rp.nickname||rp.name,
        {fontSize:'12px',fontFamily:'"Pixelify Sans", monospace',fontStyle:'bold',
         color:'#fff',backgroundColor:'rgba(0,0,0,0.55)',padding:{x:3,y:1},resolution:3})
        .setOrigin(.5,0).setDepth(6);
      team.push({id,body,gfx,label,slot,wanderPhase:Math.random()*Math.PI*2});
      const st=createPlayerStats(); applyRosterPlayerToStats(st,rp); map.set(id,st);
    });
    return team;
  }

  _findGkId(ids){ return ids.find(id=>getPlayerById(id)?.position==='GK')||ids[0]; }

  /** Every place that reassigns which roster player an on-pitch entry
   *  represents after kickoff (a substitution, a reposition swap, or a
   *  client mirroring the host's own subs/reposition over the network)
   *  changes `e.id` — the stats lookups, PT/stamina and possession logic
   *  all key off that and picked the change up immediately. The on-pitch
   *  name, though, is a Text object created once in _buildTeam and never
   *  touched again, so without this it kept showing whoever used to be
   *  there: the substitute's stats were live but their name on the pitch
   *  never was, which read as the substitution having silently done
   *  nothing at all. */
  _relabelEntry(e){
    const p=getPlayerById(e.id);
    if(p&&e.label) e.label.setText(p.nickname||p.name);
  }

  _startMatch(payloadA,payloadB){
    if(this._squadRetryTimer){ clearInterval(this._squadRetryTimer); this._squadRetryTimer=null; }
    this.formation.A=payloadA.formation||DEFAULT_FORMATION;
    this.formation.B=payloadB.formation||DEFAULT_FORMATION;
    // Ensure distinct team colors
    const rawA=this._payloadColor(payloadA,0x3399ff);
    const rawB=this._payloadColor(payloadB,0xff4444);
    this.teamColorA=rawA;
    this.teamColorB=distinctColor(rawB,rawA);
    this.teamA=this._buildTeam('A',payloadA.starterIds,true);
    this.teamB=this._buildTeam('B',payloadB.starterIds,true);
    this.benchA=(payloadA.benchIds||[]).filter(id=>getPlayerById(id));
    this.benchB=(payloadB.benchIds||[]).filter(id=>getPlayerById(id));
    this.gkIdA=this._findGkId(payloadA.starterIds);
    this.gkIdB=this._findGkId(payloadB.starterIds);
    this.activeIdA=this.teamA[0]?.id; this.activeIdB=this.teamB[0]?.id;
    this.matchStarted=true;
    // Coin toss for the first half; _tickClock hands the second to the other
    // side, so each half is started by a different team.
    this.kickoffRole=Math.random()<0.5?'A':'B';
    this._kickoff(this.kickoffRole,'Kick-off');
    document.getElementById('squad-editor-panel').style.display='none';
    document.getElementById('sub-button').style.display='block';
    document.getElementById('scroll-controls').style.display='flex';
  }

  _buildClientTeams(){
    if(this.clientTeamsBuilt||!this.mySquadPayload||!this.remoteSquadPayload) return;
    this.formation.A=this.remoteSquadPayload.formation||DEFAULT_FORMATION;
    this.formation.B=this.mySquadPayload.formation||DEFAULT_FORMATION;
    const rawA=this._payloadColor(this.remoteSquadPayload,0x3399ff);
    const rawB=this._payloadColor(this.mySquadPayload,0xff4444);
    this.teamColorA=rawA; this.teamColorB=distinctColor(rawB,rawA);
    this.teamA=this._buildTeam('A',this.remoteSquadPayload.starterIds,false);
    this.teamB=this._buildTeam('B',this.mySquadPayload.starterIds,false);
    this.benchA=this.remoteSquadPayload.benchIds||[]; this.benchB=this.mySquadPayload.benchIds||[];
    this.gkIdA=this._findGkId(this.remoteSquadPayload.starterIds);
    this.gkIdB=this._findGkId(this.mySquadPayload.starterIds);
    this.clientTeamsBuilt=true;
    document.getElementById('sub-button').style.display='block';
    document.getElementById('scroll-controls').style.display='flex';
  }

  /** Formation position in world coords. Defensive slot roles (GK/DF) stay deep;
   *  offensive ones (MF/FW) pull toward the ball's Y. */
  _formPos(role,slot,ballPos,clampOwnHalf=false){
    const preset=FORMATIONS[this.formation[role]]||FORMATIONS[DEFAULT_FORMATION];
    const roles=SLOT_ROLES[this.formation[role]]||SLOT_ROLES[DEFAULT_FORMATION];
    const f=preset[slot]||preset[preset.length-1];
    const slotRole=roles[slot]||'MF';

    const pSize=this.FIELD_H, sSize=this.FIELD_W, margin=40;

    // Base Y spread from own goal line up to near the rival box, so the
    // shape covers the full pitch. The team you control (role A) defends
    // the bottom of the map (pSize) and attacks toward 0, so its own
    // formation gets mirrored instead of B's.
    const depth=Phaser.Math.Clamp((f.y-SLOT_Y_MIN)/(SLOT_Y_MAX-SLOT_Y_MIN),0,1);
    let primary=(FORM_DEEPEST+depth*(FORM_HIGHEST-FORM_DEEPEST))*pSize;
    if(role==='A') primary=pSize-primary;

    // Secondary spread (X) tracks ball loosely
    let secondary=f.x*sSize;
    secondary+=Phaser.Math.Clamp((ballPos.x-sSize/2)*0.15,-50,50);

    // Autonomous "find space": pull forward/backward toward ball based on role
    const ballY=ballPos.y;
    const attackDir=role==='A'?-1:1;
    const toBall=(ballY-primary)*attackDir;  // +ve means ball is in front of us

    // Role-based position bias
    let yBias=0;
    if(slotRole==='FW')       yBias= Math.min(toBall*0.28, 120);   // forwards chase ball aggressively
    else if(slotRole==='MF')  yBias= Math.min(toBall*0.14,  60);   // mids follow somewhat
    else if(slotRole==='DF')  yBias= Math.max(toBall*0.06, -20);   // defenders hold back

    // Whole-team push: when this team has the ball, everyone advances as a
    // unit by default (not just whoever's dribbling); when the opponent
    // does, drop back a little instead of holding the exact formation line.
    // (Smaller than it used to be: the full-pitch base spread above now does
    // most of the work, this only shifts the block a line or so.)
    if(slot!==0){
      if(this.possRole===role){
        yBias += slotRole==='FW'?90:slotRole==='MF'?80:45;
      } else if(this.possRole&&this.possRole!==role){
        yBias += slotRole==='FW'?-90:slotRole==='MF'?-50:-15;
      }
    }
    // GK never moves from goal line
    if(slot===0){ yBias=0; secondary=sSize/2; }   // keeper always central

    primary = Phaser.Math.Clamp(primary+yBias*attackDir, margin, pSize-margin);
    // Kickoff/restart: everyone stays on their own side of the halfway line
    // — the ball-chasing bias above is meant for open play, not the moment
    // before a whistle, where drifting a forward across it looks wrong.
    if(clampOwnHalf){
      const half=pSize/2;
      // The side taking the kick-off stays tight to the line; the other one
      // drops off, so whoever restarts has room to play the first pass.
      const gap=(this.possRole&&this.possRole!==role)?KICKOFF_DEFEND_GAP:KICKOFF_HALF_GAP;
      primary = role==='A' ? Math.max(primary,half+gap) : Math.min(primary,half-gap);
    }
    return {x:secondary, y:primary};
  }

  /** Where an off-ball player (not the one being explicitly steered) should
   *  drift to. Keeps the formation shape as a base, but blends in a forward
   *  supporting run (to offer a passing option) when this team has the
   *  ball, or a press toward the ball carrier when the opponent does —
   *  applies to both the human team's teammates and the AI team's players. */
  _offBallTarget(role,e,activeId,iHaveBall,ballCarrier){
    const base=this._formPos(role,e.slot,this.ball.position);
    if(e.slot===0||e.id===activeId) return base; // keeper & the on-ball player keep plain formation logic

    let target=base;
    if(iHaveBall){
      const carrier=this._activeEntry(role);
      if(carrier){
        // Anchored on this player's OWN formation spot (`base`), not the
        // carrier's — a fixed carrier-relative offset put every supporter
        // on the same side at the exact same point (everyone right of the
        // carrier heading to identically carrier.x+130, say), bunching the
        // whole side of the pitch into one spot instead of offering a
        // spread of passing options. Nudging each player's own spot toward
        // the carrier's lane keeps their natural spacing intact.
        const attackDir=role==='A'?-1:1;
        const side=(base.x>=carrier.body.position.x)?1:-1;
        const supportSpot={
          x:base.x+side*70,
          y:Phaser.Math.Linear(base.y,carrier.body.position.y+attackDir*130,0.5)
        };
        target={
          x:Phaser.Math.Linear(base.x,supportSpot.x,SUPPORT_BLEND),
          y:Phaser.Math.Linear(base.y,supportSpot.y,SUPPORT_BLEND)
        };
      }
    } else if(ballCarrier){
      const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,ballCarrier.body.position.x,ballCarrier.body.position.y);
      if(d<PRESS_RANGE){
        const ownGoalY=role==='A'?this.FIELD_H:0;
        // Anchored on this player's own formation spot (base.x), not their
        // live, already-drifted position — pressSpot fed back into itself
        // via the live body position otherwise, so a player who'd nudged
        // toward the ball last frame started this frame's press already
        // closer in, compounding every tick into everyone (wingers
        // included) collapsing onto the ball carrier instead of holding
        // their own lane of the pitch.
        const pressSpot={
          x:Phaser.Math.Linear(ballCarrier.body.position.x,base.x,0.35),
          y:Phaser.Math.Linear(ballCarrier.body.position.y,ownGoalY,0.15)
        };
        target={
          x:Phaser.Math.Linear(base.x,pressSpot.x,PRESS_BLEND),
          y:Phaser.Math.Linear(base.y,pressSpot.y,PRESS_BLEND)
        };
      }
    }
    return this._applyWander(e,target,iHaveBall);
  }

  /** Nudges an off-ball target around with two slow out-of-phase sines so
   *  players keep finding little pockets of space instead of parking on an
   *  exact formation spot. Wider when attacking, tighter when defending. */
  _applyWander(e,target,iHaveBall){
    const t=this.time.now, ph=e.wanderPhase||0;
    const amp=WANDER_AMPLITUDE*(iHaveBall?1:0.6);
    return {
      x:Phaser.Math.Clamp(target.x+Math.sin(t/WANDER_PERIOD_X+ph)*amp,30,this.FIELD_W-30),
      y:Phaser.Math.Clamp(target.y+Math.cos(t/WANDER_PERIOD_Y+ph*1.7)*amp,40,this.FIELD_H-40)
    };
  }

  /** Where to sprint for a ball nobody owns — a pass in flight, a rebound, a
   *  loose touch. The side's closest player always goes, as does anyone it
   *  has been played right next to, so passes get collected instead of the
   *  receiver drifting along at formation pace. Returns null when there's
   *  nothing to chase. */
  _looseBallChase(e,activeId){
    if(this.possRole||this.confrontation) return null;
    const bp=this.ball.position;
    const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,bp.x,bp.y);
    if(e.slot===0) return d<KEEPER_CHASE_RANGE?{x:bp.x,y:bp.y}:null; // keeper only for balls at their feet
    if(e.id===activeId||d<BALL_CHASE_RANGE) return {x:bp.x,y:bp.y};
    return null;
  }

  // ════════════════════════════════════════════════════════════════════
  // Team panel (mid-match): formation preset + substitutions together
  // ════════════════════════════════════════════════════════════════════
  /** Single-tab team panel: formation presets at the top, then the pitch
   *  (current XI) and bench together below — exactly like the pre-match
   *  squad editor. Tap a player on the pitch, then one on the bench (or
   *  vice versa), to sub them. */
  /** Opening the team panel — either player's — pauses the match and forces
   *  the panel open on both screens. The DOM is toggled optimistically here
   *  for whoever clicked (instant feedback), but `teamPanelOpen` itself —
   *  the authoritative, network-synced flag — is only ever set by
   *  _setTeamPanelOpen, once the host actually processes the request (its
   *  own, or the other side's via input). Setting it here too would make
   *  that later call see "no change" and skip pausing entirely. */
  _openSubPanel(){
    this.pendingTeamPanelRequest='open';
    this.subSel=null; this._subPanelSig=null;
    this._setSubPanelSide('me');
    document.getElementById('sub-panel').style.display='flex';
  }
  _closeSubPanel(){
    this.pendingTeamPanelRequest='close';
    this.subSel=null;
    document.getElementById('sub-panel').style.display='none';
  }
  /** Host-authoritative: applies an open/close request from either side
   *  (its own click, or the client's via input), pausing/resuming the
   *  match and mirroring the panel's visibility onto the host's own
   *  screen too, so a request from either player forces both. */
  _setTeamPanelOpen(open){
    if(!!this.teamPanelOpen===!!open) return;
    this.teamPanelOpen=!!open;
    this._setPaused(this.teamPanelOpen);
    document.getElementById('sub-panel').style.display=this.teamPanelOpen?'flex':'none';
    if(this.teamPanelOpen){ this.subSel=null; this._subPanelSig=null; this._setSubPanelSide('me'); }
  }

  /** Holds the simulation still without stopping the scene: Matter stops
   *  stepping, `_hostUpdate` skips play (but still applies squad changes made
   *  from the open panel), and every absolute deadline is pushed back by the
   *  paused time on resume so nothing silently expires meanwhile. */
  _setPaused(on){
    if(!!this.paused===!!on) return;
    this.paused=on;
    if(on){
      this._pausedAt=this.time.now;
      this.matter.world.pause();
    } else {
      this._shiftTimers(this.time.now-(this._pausedAt??this.time.now));
      this._pausedAt=null;
      this.matter.world.resume();
    }
  }
  _shiftTimers(dt){
    if(!(dt>0)) return;
    const c=this.confrontation;
    if(c){
      if(c.deadline) c.deadline+=dt;
      if(c.reveal){ c.reveal.until+=dt; c.reveal.litAt+=dt; }
    }
    if(this.confrontResult){ this.confrontResult.until+=dt; this.confrontResult.outcomeAt+=dt; }
    if(this.duelLockUntil) this.duelLockUntil+=dt;
    this.stunMap.forEach((until,id)=>this.stunMap.set(id,until+dt));
    this.lastStateSent+=dt;
  }
  /** Switches the team panel between your own (editable) squad and a
   *  read-only peek at the rival's — local UI only, never networked (see
   *  the `subPanelSide` field comment). */
  _setSubPanelSide(side){
    this.subPanelSide=side;
    this.subSel=null;
    document.querySelectorAll('#sub-panel-side-tabs .sub-panel-side-tab').forEach(b=>b.classList.toggle('is-primary',b.dataset.side===side));
    this._renderSubPanel();
  }
  _renderFormationPresets(){
    const wrap=document.getElementById('formation-preset-btns'); wrap.innerHTML='';
    const current=this.formation[this.role];
    Object.keys(FORMATIONS).forEach(name=>{
      const btn=document.createElement('button'); btn.textContent=name;
      btn.className='nes-btn is-compact'+(name===current?' is-warning':'');
      btn.addEventListener('click',()=>{
        this.formation[this.role]=name; this.pendingFormChange=name;
        this._renderSubPanel();
      });
      wrap.appendChild(btn);
    });
  }
  _renderSubPanel(){
    const viewingRival=this.subPanelSide==='rival';
    const oppRole=this.role==='A'?'B':'A';
    const sideRole=viewingRival?oppRole:this.role;

    // Presets change *your* formation — meaningless (and not yours to
    // change) while looking at the rival's side, so they're hidden there
    // rather than shown disabled.
    document.getElementById('formation-preset-btns').style.display=viewingRival?'none':'flex';
    if(!viewingRival) this._renderFormationPresets();

    const st=document.getElementById('sub-panel-state');
    if(st){
      if(viewingRival){
        st.textContent="👁 Viewing the rival's formation — read-only";
        st.className='';
      } else {
        // Opening this panel always pauses the match now, for both players
        // (see _setTeamPanelOpen) — so whenever it's showing, this is true.
        st.textContent='⏸ Match paused — make as many changes as you like, then close';
        st.className='paused';
      }
    }
    const listEl=document.getElementById('sub-list-inner'); listEl.innerHTML='';
    const sideTeam=sideRole==='A'?this.teamA:this.teamB;
    const sideBench=sideRole==='A'?(this.benchA||[]):(this.benchB||[]);
    const sel=viewingRival?null:this.subSel;
    const pitchHtml=this._renderMiniPitch(sideTeam,sideRole,sel);
    const benchHtml=`<div class="bench-strip" style="margin-top:12px;">${
      sideBench.map(id=>{
        const p=getPlayerById(id); if(!p) return '';
        const col=this._css3(this._rosterColor(p));
        const av=this._avatarFill(p,col);
        const selCls=(!viewingRival&&this.subSel&&this.subSel.type==='bench'&&this.subSel.id===id)?' selected':'';
        return `<div class="bench-pin${selCls}" data-bench-id="${id}">
          <div class="pin-avatar" style="${av.style}width:40px;height:40px;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;color:rgba(0,0,0,.8)">${av.inner}</div>
          ${this._posBadge(p.position)}${this._ratingBadge(p)}
          <div class="pin-name">${p.nickname||p.name}</div>
        </div>`;
      }).join('')||'<p style="font-size:11px;opacity:.7;">No bench players.</p>'
    }</div>`;
    listEl.innerHTML=pitchHtml+benchHtml;
    if(viewingRival){
      // Read-only: a tap just shows their stats, no sub/swap selection —
      // arming a cross-team subSel would let it pair with your own pins.
      listEl.querySelectorAll('.slot-pin[data-roster-id]').forEach(pin=>{
        pin.addEventListener('click',()=>{ const p=getPlayerById(pin.dataset.rosterId); if(p) this._showPlayerStats(p); });
      });
      listEl.querySelectorAll('.bench-pin[data-bench-id]').forEach(pin=>{
        pin.addEventListener('click',()=>{ const p=getPlayerById(pin.dataset.benchId); if(p) this._showPlayerStats(p); });
      });
    } else {
      // Both selectors only ever match an occupied pin (see the roster-id/
      // bench-id template above), so there's always a player to show.
      listEl.querySelectorAll('.slot-pin[data-roster-id]').forEach(pin=>{
        const p=getPlayerById(pin.dataset.rosterId);
        this._armPressGestures(pin,{onTap:()=>this._onSubPinClick({type:'slot',id:pin.dataset.rosterId}),onLongPress:()=>p&&this._showPlayerStats(p)});
      });
      listEl.querySelectorAll('.bench-pin[data-bench-id]').forEach(pin=>{
        const p=getPlayerById(pin.dataset.benchId);
        this._armPressGestures(pin,{onTap:()=>this._onSubPinClick({type:'bench',id:pin.dataset.benchId}),onLongPress:()=>p&&this._showPlayerStats(p)});
      });
    }
  }
  _onSubPinClick(sel){
    if(!this.subSel){ this.subSel=sel; this._renderSubPanel(); return; }
    if(this.subSel.id===sel.id){
      // Tapping the pin already armed cancels it — press and hold to view
      // stats instead (see _armPressGestures).
      this.subSel=null; this._renderSubPanel();
      return;
    }
    if(this.subSel.type==='slot'&&sel.type==='slot'){
      // Two pitch players: swap which position each of them plays. No PT or
      // stamina resets — unlike a substitution, neither of them is coming
      // fresh off the bench.
      this.pendingReposition={aId:this.subSel.id,bId:sel.id};
      this.subSel=null;
      this._renderSubPanel();
      return;
    }
    if(this.subSel.type===sel.type){ this.subSel=null; this._renderSubPanel(); return; } // both bench: not a valid action
    const outId=this.subSel.type==='slot'?this.subSel.id:sel.id;
    const inId =this.subSel.type==='bench'?this.subSel.id:sel.id;
    this.pendingSub={outId,inId};
    this.subSel=null;
    // The panel stays up: a substitution is rarely the only change you want
    // to make, and it re-renders itself once the swap actually lands (see
    // _subPanelTick), so you close it yourself when you're done.
    this._renderSubPanel();
  }

  /** Render a simplified pitch HTML with current player positions for use in
   *  the sub panel and mid-match formation view (same look as squad editor). */
  _renderMiniPitch(team, role, sel){
    const preset=FORMATIONS[this.formation[role]]||FORMATIONS[DEFAULT_FORMATION];
    const roles=SLOT_ROLES[this.formation[role]]||SLOT_ROLES[DEFAULT_FORMATION];
    const teamColor=role==='A'?this._css3(this.teamColorA):this._css3(this.teamColorB);
    const pins=preset.map((f,slot)=>{
      const entry=team[slot]; const p=entry?getPlayerById(entry.id):null;
      const col=p?this._css3(this._rosterColor(p)):teamColor;
      const left=(f.x*100).toFixed(1)+'%';
      const top =((1-f.y)*100).toFixed(1)+'%';
      const selCls=(p&&sel&&sel.type==='slot'&&sel.id===entry.id)?' selected':'';
      if(p){
        const isOut=this._isOut(role,entry.id);
        const av=this._avatarFill(p,col);
        return `<div class="slot-pin${selCls}" style="left:${left};top:${top};${isOut?'opacity:.4;pointer-events:none;':''}" data-roster-id="${entry.id}">
          <div class="pin-avatar" style="${av.style}">${av.inner}</div>
          ${this._posBadge(p.position,p.position!==roles[slot])}${this._ratingBadge(p)}
          <div class="pin-name">${p.nickname||p.name}${isOut?' (OFF)':''}</div>
        </div>`;
      }
      return `<div class="slot-pin empty" style="left:${left};top:${top}"><div style="font-size:9px;opacity:.5">–</div></div>`;
    }).join('');
    return `<div class="mini-pitch-wrap" style="width:100%;aspect-ratio:2/3;background:#1e7a3c;border:2px solid white;border-radius:8px;position:relative;overflow:hidden;pointer-events:auto;touch-action:manipulation;"><div class="pitch-line-h"></div>${pins}</div>`;
  }

  _trySub(role,req){
    if(!req?.outId||!req?.inId) return;
    if(this._isOut(role,req.outId)) return; // a sent-off player can't be replaced
    const team=role==='A'?this.teamA:this.teamB;
    const bench=role==='A'?this.benchA:this.benchB;
    const map=role==='A'?this.statsMapA:this.statsMapB;
    const bIdx=bench.indexOf(req.inId); const entry=team.find(t=>t.id===req.outId);
    if(bIdx===-1||!entry) return;
    const rp=getPlayerById(req.inId); if(!rp) return;
    entry.id=req.inId;
    this._relabelEntry(entry);
    if(entry.body) this.bodyOwner.set(entry.body,{role,id:req.inId});
    const st=createPlayerStats(); applyRosterPlayerToStats(st,rp); map.set(req.inId,st);
    bench.splice(bIdx,1,req.outId);
    if(role==='A'&&this.activeIdA===req.outId) this.activeIdA=req.inId;
    if(role==='B'&&this.activeIdB===req.outId) this.activeIdB=req.inId;
    if(role==='A'&&this.gkIdA===req.outId) this.gkIdA=req.inId;
    if(role==='B'&&this.gkIdB===req.outId) this.gkIdB=req.inId;
  }

  /** Solo-vs-AI only: every so often the AI checks its own lineup and subs
   *  off its most tired outfield player once they're running low, same as
   *  a human would from the team panel — up to the real substitution
   *  limit. Never touches the keeper (fatigue there doesn't mean much) or
   *  anyone mid-duel, and prefers a bench replacement in the same
   *  position when one's available. */
  _aiConsiderSub(now){
    if(this.aiSubsUsed>=AI_MAX_SUBS||now<this._aiSubCheckAt) return;
    this._aiSubCheckAt=now+AI_SUB_CHECK_MS;
    if(!this.benchB?.length) return;
    let worst=null,worstRatio=AI_SUB_STAMINA;
    this.teamB.forEach(e=>{
      if(e.slot===0||this._isOut('B',e.id)) return;
      const st=this.statsMapB.get(e.id); if(!st) return;
      const ratio=st.stamina/st.maxStamina;
      if(ratio<worstRatio){ worstRatio=ratio; worst=e; }
    });
    if(!worst) return;
    const outRp=getPlayerById(worst.id);
    const bench=this.benchB.map(id=>getPlayerById(id)).filter(Boolean);
    if(!bench.length) return;
    const inRp=bench.find(p=>p.position===outRp?.position)||bench[0];
    this._trySub('B',{outId:worst.id,inId:inRp.id});
    this.aiSubsUsed+=1;
  }

  /** Swaps which of two pitch slots each of these two players occupies —
   *  a straight reposition, not a substitution: their PT/stamina/active-id
   *  references are all tracked by roster id already, so nothing about them
   *  needs to change, only which body (and its slot's formation anchor)
   *  they're now tied to. */
  _tryReposition(role,req){
    if(!req?.aId||!req?.bId||req.aId===req.bId) return;
    const team=role==='A'?this.teamA:this.teamB;
    const eA=team.find(t=>t.id===req.aId), eB=team.find(t=>t.id===req.bId);
    if(!eA||!eB) return;
    if(this._isOut(role,eA.id)||this._isOut(role,eB.id)) return; // a sent-off player can't be repositioned
    const tmp=eA.id; eA.id=eB.id; eB.id=tmp;
    this._relabelEntry(eA); this._relabelEntry(eB);
    if(eA.body) this.bodyOwner.set(eA.body,{role,id:eA.id});
    if(eB.body) this.bodyOwner.set(eB.body,{role,id:eB.id});
  }

  // ════════════════════════════════════════════════════════════════════
  // In-game pointer input (converts screen → world coords)
  // ════════════════════════════════════════════════════════════════════
  _pointerDown(pointer){
    if(!this.matchStarted||this.matchClock.ended) return;
    const w=this._toWorld(pointer.x,pointer.y);
    if(this._iHavePossession()&&this._inGoalRegion(w)&&!this.confrontation){ this.pendingShoot=true; return; }
    // Play is frozen during a confrontation, but drawing runs still works —
    // it's the natural moment to set up where everyone goes next. Only the
    // tap-to-pass in _pointerUp stays disabled until the duel resolves.
    this.gestureStart={x:w.x,y:w.y,sx:pointer.x,sy:pointer.y}; this.gestureMoved=false;
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    let nearest=null, nearestD=PLAYER_SEL_RADIUS;
    myTeam.forEach(e=>{ const d=Phaser.Math.Distance.Between(e.gfx.x,e.gfx.y,w.x,w.y); if(d<nearestD){nearestD=d;nearest=e;} });
    const activeId=this.role==='A'?this.activeIdA:this.activeIdB;
    this.pendingSelectedPlayerId=nearest?nearest.id:activeId;
    this.drawing=true;
  }
  _pointerMove(pointer){
    if(!this.drawing) return;
    if(!this.gestureMoved){
      if(!this.gestureStart||Phaser.Math.Distance.Between(this.gestureStart.sx,this.gestureStart.sy,pointer.x,pointer.y)<DRAG_THRESHOLD) return;
      this.gestureMoved=true;
      this.selectedPlayerId=this.pendingSelectedPlayerId;
      const w=this._toWorld(pointer.x,pointer.y);
      // The line has to start from wherever the player actually is, not
      // from the raw tap-down point — those only coincide if you tapped
      // exactly on top of them. Off by even a little (or defaulting to the
      // active player from a tap that hit nobody), the path's first leg was
      // a detour out to that tap point before doubling back, which is what
      // made drawn lines look like they had a mind of their own.
      const myTeam=this.role==='A'?this.teamA:this.teamB;
      const entry=myTeam.find(e=>e.id===this.selectedPlayerId);
      const startPos=entry?(entry.body?entry.body.position:entry.gfx):this.gestureStart;
      this.myPaths.set(this.selectedPlayerId,[{x:startPos.x,y:startPos.y},{x:w.x,y:w.y}]);
      this.autoPathIds.delete(this.selectedPlayerId);
      return;
    }
    const path=this.myPaths.get(this.selectedPlayerId); if(!path) return;
    const w=this._toWorld(pointer.x,pointer.y); const last=path[path.length-1];
    if(!last||Phaser.Math.Distance.Between(last.x,last.y,w.x,w.y)>MIN_PATH_PT_DIST) path.push({x:w.x,y:w.y});
  }
  _pointerUp(){
    if(this.drawing&&!this.gestureMoved&&this.gestureStart&&this.matchStarted&&!this.confrontation&&this._iHavePossession()){
      this.pendingPass={x:this.gestureStart.x,y:this.gestureStart.y};
      // Purely visual — a brief marker at the spot tapped, so a pass reads
      // as a deliberate action instead of the ball just setting off with no
      // feedback at all for where the tap landed.
      this.passMarker={x:this.gestureStart.x,y:this.gestureStart.y,until:this.time.now+PASS_MARKER_MS};
    }
    this.drawing=false; this.gestureStart=null;
  }
  _inGoalRegion(w){
    const half=this.FIELD_W/2;
    const towardMax=this.role==='B'; // A attacks toward y=0 now, B toward y=FIELD_H
    const withinX=Math.abs(w.x-half)<GOAL_HALF_WIDTH+40;
    // Reaches from just in front of the line all the way back through the goal
    // box, so the whole rectangle is a shooting tap.
    return withinX&&(towardMax
      ? w.y>this.FIELD_H-GOAL_CLICK_MARGIN&&w.y<this.WORLD_Y_MAX
      : w.y<GOAL_CLICK_MARGIN&&w.y>this.WORLD_Y_MIN);
  }
  _iHavePossession(){ return this.currentPossession===this.role; }

  _computeTargets(){
    const myTeam=this.role==='A'?this.teamA:this.teamB; const targets=[];
    for(const e of myTeam){
      const path=this.myPaths.get(e.id); if(!path||!path.length) continue;
      const pos=e.body?e.body.position:e.gfx;
      while(path.length&&Phaser.Math.Distance.Between(pos.x,pos.y,path[0].x,path[0].y)<WAYPOINT_RADIUS) path.shift();
      // Following a drawn line is a deliberate run — sprint for it.
      if(path.length){ targets.push({id:e.id,x:path[0].x,y:path[0].y,sprint:true}); continue; }
      // A short, fast drag can add a point that's already within
      // WAYPOINT_RADIUS of the player and gets consumed the very same tick
      // it landed — if that happens while they're still being actively
      // dragged (a quick flick continuing the same direction they were
      // already running, easy to do since they haven't stopped moving),
      // this used to fall straight into the auto-continue branch below,
      // silently swapping the real drawn line for just a dot mid-gesture.
      // Hold here instead and wait for the next point _pointerMove adds.
      if(this.drawing&&this.selectedPlayerId===e.id) continue;
      // The drawn line ran out: keep making ground while we're attacking
      // rather than turning straight back into the formation — except for
      // the keeper, who has somewhere to be. Carrying on up the pitch with
      // everyone else walked them out of their own half and left the goal
      // open behind them, so their line ending sends them back to their
      // post instead (deleting the path hands them to _offBallTarget,
      // which keeps a keeper on plain formation logic). Drawing a run for
      // them still works — this is only about where they end up after it.
      const runOn=e.slot===0?null:this._runOnWaypoint(pos);
      if(runOn){ path.push(runOn); this.autoPathIds.add(e.id); targets.push({id:e.id,...runOn,sprint:true}); }
      else { this.myPaths.delete(e.id); this.autoPathIds.delete(e.id); }
    }
    return targets;
  }

  /** Next carry-on waypoint up the player's channel, or null once we've lost
   *  the ball or they're already deep enough to stop. */
  _runOnWaypoint(pos){
    if(this.currentPossession!==this.role) return null;
    const attackDir=this.role==='A'?-1:1;
    const goalY=this.role==='A'?0:this.FIELD_H;
    if(Math.abs(pos.y-goalY)<RUN_ON_STOP+WAYPOINT_RADIUS) return null;
    return {x:pos.x,y:Phaser.Math.Clamp(pos.y+attackDir*RUN_ON_STEP,RUN_ON_STOP,this.FIELD_H-RUN_ON_STOP)};
  }

  _drawPaths(){
    this.pathGfx.clear(); if(!this.matchStarted) return;
    const myTeam=this.role==='A'?this.teamA:this.teamB;
    myTeam.forEach(e=>{
      const path=this.myPaths.get(e.id); if(!path||!path.length) return;
      const last=path[path.length-1];
      // The automatic "keep running" carry-on (see _runOnWaypoint) isn't
      // something the player drew — showing it as a line reads as a second,
      // self-drawn path. Just a small marker at where they're headed instead.
      if(this.autoPathIds.has(e.id)){
        this.pathGfx.fillStyle(0xffe066,.6); this.pathGfx.fillCircle(last.x,last.y,4);
        return;
      }
      const pos=e.body?e.body.position:e.gfx;
      this.pathGfx.lineStyle(2,0xffe066,.85);
      this.pathGfx.beginPath(); this.pathGfx.moveTo(pos.x,pos.y);
      path.forEach(pt=>this.pathGfx.lineTo(pt.x,pt.y)); this.pathGfx.strokePath();
      this.pathGfx.fillStyle(0xffe066,1); this.pathGfx.fillCircle(last.x,last.y,5);
    });
    // Tap-to-pass feedback: a blue ring at the spot tapped, fading out over
    // PASS_MARKER_MS rather than just vanishing — the ball's already on its
    // way by the time this shows, so it's confirmation, not a target.
    if(this.passMarker){
      const remain=this.passMarker.until-this.time.now;
      if(remain<=0) this.passMarker=null;
      else {
        const t=remain/PASS_MARKER_MS;
        this.pathGfx.lineStyle(3,0x3399ff,t);
        this.pathGfx.strokeCircle(this.passMarker.x,this.passMarker.y,10+(1-t)*10);
        this.pathGfx.fillStyle(0x3399ff,t*0.5);
        this.pathGfx.fillCircle(this.passMarker.x,this.passMarker.y,5);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Physics helpers
  // ════════════════════════════════════════════════════════════════════
  _isStunned(id,now){ return (this.stunMap.get(id)||0)>now; }

  /** Drains every on-pitch player's stamina at a flat rate — host only,
   *  called once per tick regardless of half or possession. Fresh legs from
   *  a substitution are the only way to reset it (see _trySub/_buildTeam). */
  _tickFatigue(delta){
    const dec=FATIGUE_DRAIN_PER_SEC*(delta/1000);
    for(const st of this.statsMapA.values()) st.stamina=Math.max(0,st.stamina-dec);
    for(const st of this.statsMapB.values()) st.stamina=Math.max(0,st.stamina-dec);
  }
  /** Speed multiplier from fatigue: full pace above the threshold, easing
   *  down to the floor as stamina empties out. */
  _fatigueMul(st){
    if(!st||!st.maxStamina) return 1;
    const ratio=st.stamina/st.maxStamina;
    if(ratio>=FATIGUE_THRESHOLD) return 1;
    return FATIGUE_MIN_MUL+(1-FATIGUE_MIN_MUL)*(ratio/FATIGUE_THRESHOLD);
  }

  _steer(body,target,speed=1,force=STEER_FORCE){
    const dx=target.x-body.position.x, dy=target.y-body.position.y;
    const dist=Math.hypot(dx,dy); if(dist<6) return;
    const f=force*speed;
    this.matter.body.applyForce(body,body.position,{x:(dx/dist)*f,y:(dy/dist)*f});
    const v=body.velocity, s=Math.hypot(v.x,v.y), mx=BASE_MAX_SPEED*speed;
    if(s>mx) this.matter.body.setVelocity(body,{x:(v.x/s)*mx,y:(v.y/s)*mx});
  }

  _glueBall(){
    if(!this.possRole) return;
    const e=this._activeEntry(this.possRole); if(!e?.body) return;
    const b=e.body,vel=b.velocity,sp=Math.hypot(vel.x,vel.y);
    const dy=(sp>0.05?vel.y/sp:(this.possRole==='A'?-1:1)), dx=(sp>0.05?vel.x/sp:0);
    this.matter.body.setPosition(this.ball,{x:b.position.x+dx*POSSESS_OFFSET,y:b.position.y+dy*POSSESS_OFFSET});
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
  }
  _doPass(role,target){
    const e=this._activeEntry(role); if(!e?.body) return;
    playPass();
    const dx=target.x-e.body.position.x, dy=target.y-e.body.position.y, dist=Math.hypot(dx,dy)||1;
    this.possRole=null;
    // Offside is judged the instant the ball is played, not when it's
    // received — snapshot which of the passer's teammates are already
    // beyond the line right now. If the ball is next controlled by one of
    // them before anyone else touches it, _collisions flags the pass.
    this.offsideFlag=this._flagOffsideReceivers(role,e);
    // Weight the pass to the distance: friction eats speed/BALL_FRICTION_AIR
    // worth of travel, so aim for a touch beyond the target rather than
    // kicking every ball the same and leaving long ones short.
    const speed=Phaser.Math.Clamp(dist*BALL_FRICTION_AIR*PASS_REACH_BOOST,PASS_MIN_SPEED,PASS_MAX_SPEED);
    this.matter.body.setVelocity(this.ball,{x:(dx/dist)*speed,y:(dy/dist)*speed});
    this._startPassFlight({x:this.ball.position.x,y:this.ball.position.y},dist);
  }

  // ── Offside ────────────────────────────────────────────────────────────
  /** Y-distance from `y` to the goal `attackingRole` is attacking — smaller
   *  is more advanced. Lets every offside comparison stay role-agnostic. */
  _distToGoal(y,attackingRole){ return attackingRole==='A'?y:(this.FIELD_H-y); }

  /** The offside line for `attackingRole`, in _distToGoal units: nearer to
   *  goal than this (and past halfway) is an offside position. Standard
   *  rule — nearer to goal than both the ball and the second-last
   *  defender — so it's whichever of the two is more advanced. The
   *  keeper counts as one of the defenders here (normally the actual
   *  last one) — leaving them out would make dists[1] the *third*-last
   *  defender instead of the second whenever the keeper is, as usual,
   *  the deepest player, drawing the line a player too far forward and
   *  flagging receivers who are actually onside. Null if there aren't
   *  at least two eligible defenders to judge by (e.g. after red
   *  cards), in which case offside just doesn't apply. */
  _offsideLineDist(attackingRole,ballY){
    const defendingRole=attackingRole==='A'?'B':'A';
    const defTeam=defendingRole==='A'?this.teamA:this.teamB;
    const dists=defTeam
      .filter(e=>e.body&&!this._isOut(defendingRole,e.id))
      .map(e=>this._distToGoal(e.body.position.y,attackingRole))
      .sort((a,b)=>a-b);
    if(dists.length<2) return null;
    return Math.min(dists[1],this._distToGoal(ballY,attackingRole));
  }
  _isOffsidePosition(y,attackingRole,lineDist){
    const d=this._distToGoal(y,attackingRole);
    return d<this.FIELD_H/2&&d<lineDist;
  }
  /** Every one of `passer`'s teammates (other than the passer) who's in an
   *  offside position right as the pass is played. */
  _flagOffsideReceivers(role,passer){
    const lineDist=this._offsideLineDist(role,passer.body.position.y);
    if(lineDist==null) return null;
    const team=role==='A'?this.teamA:this.teamB;
    const ids=new Set();
    team.forEach(e=>{
      if(e.id===passer.id||e.slot===0||!e.body||this._isOut(role,e.id)) return;
      if(this._isOffsidePosition(e.body.position.y,role,lineDist)) ids.add(e.id);
    });
    return ids.size?{role,ids}:null;
  }
  /** Indirect free kick to the defending side from roughly where the
   *  offside player picked the ball up. */
  _commitOffside(offsideRole,now){
    const defendingRole=offsideRole==='A'?'B':'A';
    const spot={x:this.ball.position.x,y:this.ball.position.y};
    this._placeBallAndAward(defendingRole,spot,now);
    this.confrontResult={title:'🚩 Offside!',outcome:'',until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS};
  }

  /** Lifts the ball for the first PASS_LOFT_FRAC of a pass: while it's up
   *  there it stops colliding with players, so the chip clears anyone close to
   *  the passer, and it drops back to the ground short of the target. */
  _startPassFlight(from,dist){
    const range=Math.max(PASS_LOFT_MIN,dist*PASS_LOFT_FRAC);
    this.ballFlight={x0:from.x,y0:from.y,range,peak:Phaser.Math.Clamp(range*0.28,14,52),h:0};
    this.ball.collisionFilter.mask=CAT_GOAL;
  }
  _endPassFlight(){
    if(!this.ballFlight) return;
    this.ballFlight=null;
    this.ball.collisionFilter.mask=CAT_PLAYER|CAT_GOAL;
  }
  _updatePassFlight(){
    const f=this.ballFlight; if(!f) return;
    const b=this.ball.position;
    const d=Math.hypot(b.x-f.x0,b.y-f.y0);
    const sp=Math.hypot(this.ball.velocity.x,this.ball.velocity.y);
    // The tracked "flight" is only the lofted arc (PASS_LOFT_FRAC of the
    // total distance, see _startPassFlight) — a normal pass keeps rolling
    // on the ground well past d>=f.range, so that condition alone must NOT
    // clear offsideFlag, or it'd never survive long enough to catch the
    // receiver it's watching for. Only a genuine stop with nobody having
    // touched it (fizzled out — rolled dead, or reset some other way)
    // means the danger window has actually closed.
    if(!this.possRole&&sp<0.35) this.offsideFlag=null;
    // Down again once it has covered its arc, or early if the pass died or
    // the ball was handed to someone (a dead-ball restart, say).
    if(this.possRole||d>=f.range||sp<0.35){ this._endPassFlight(); return; }
    f.h=Math.sin((d/f.range)*Math.PI)*f.peak;
  }

  /** Ball with its height: lifted off its ground position and drawn bigger,
   *  with the shadow left behind on the grass. */
  _drawBall(x,y,h){
    this.ballGfx.setPosition(x,y-h*0.55).setScale(1+h/70);
    this.ballShadow.setVisible(h>1).setPosition(x,y).setScale(1-Math.min(0.3,h/170));
  }
  /** Closest opponent (any outfield or keeper still on the pitch) to
   *  `entry`, in pixels — used to gauge whether the AI's ball carrier is
   *  actually under pressure right now, rather than passing at a flat
   *  rate regardless of whether anyone's actually closing them down. */
  _nearestOpponentDist(role,entry){
    const oppRole=role==='A'?'B':'A';
    const oppTeam=oppRole==='A'?this.teamA:this.teamB;
    let best=Infinity;
    for(const o of oppTeam){
      if(!o.body||this._isOut(oppRole,o.id)) continue;
      const d=Phaser.Math.Distance.Between(entry.body.position.x,entry.body.position.y,o.body.position.x,o.body.position.y);
      if(d<best) best=d;
    }
    return best;
  }
  /** Picks a reasonable pass target for the AI: the most advanced teammate
   *  (closer to the rival goal than the passer) within a sane passing
   *  range, preferring the furthest-advanced one among nearby options. */
  _aiPickPassTarget(role,entry){
    const team=role==='A'?this.teamA:this.teamB;
    const attackDir=role==='A'?-1:1; // A attacks decreasing y (their goal is at the bottom), B increasing y
    let best=null,bestScore=-Infinity;
    for(const c of team){
      if(c.id===entry.id||c.slot===0) continue; // not myself, not the keeper
      const dx=c.body.position.x-entry.body.position.x, dy=c.body.position.y-entry.body.position.y;
      const dist=Math.hypot(dx,dy);
      if(dist<50||dist>560) continue; // too close to bother, too far to pick out
      const advance=dy*attackDir; // positive = further forward than the passer
      const score=advance-dist*0.15;
      if(score>bestScore){ bestScore=score; best=c; }
    }
    return best;
  }
  _knockback(loser,winner){
    if(!loser?.body||!winner?.body) return;
    const dx=loser.body.position.x-winner.body.position.x, dy=loser.body.position.y-winner.body.position.y, d=Math.hypot(dx,dy)||1;
    this.matter.body.setVelocity(loser.body,{x:(dx/d)*KNOCKBACK_SPEED,y:(dy/d)*KNOCKBACK_SPEED});
  }
  _activeEntry(role){ const team=role==='A'?this.teamA:this.teamB, id=role==='A'?this.activeIdA:this.activeIdB; return team.find(t=>t.id===id)||null; }
  _setActive(role,id){ if(role==='A') this.activeIdA=id; else this.activeIdB=id; }
  _updateActive(role){
    const team=(role==='A'?this.teamA:this.teamB).filter(e=>!this._isOut(role,e.id));
    if(!team.length) return;
    const bp=this.ball.position;
    let best=team[0], bestD=Phaser.Math.Distance.Between(team[0].body.position.x,team[0].body.position.y,bp.x,bp.y);
    for(const e of team){ const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,bp.x,bp.y); if(d<bestD){bestD=d;best=e;} }
    const cur=role==='A'?this.activeIdA:this.activeIdB;
    if(best.id!==cur){ const ce=team.find(t=>t.id===cur); const cd=ce?Phaser.Math.Distance.Between(ce.body.position.x,ce.body.position.y,bp.x,bp.y):Infinity; if(cd-bestD>24){if(role==='A')this.activeIdA=best.id;else this.activeIdB=best.id;} }
  }

  // ════════════════════════════════════════════════════════════════════
  // Collisions (host only)
  // ════════════════════════════════════════════════════════════════════
  /** Players no longer physically collide with each other (see the
   *  collision categories above) — only the ball can touch them, and
   *  duels trigger on proximity (_checkForDuel) rather than a Matter
   *  contact event. This just tracks ball touches (for lastTouch/
   *  possession) and goal-sensor overlaps. */
  _collisions(event){
    if(this.role!=='A'||!this.matchStarted) return;
    for(const pair of event.pairs){
      const bodies=[pair.bodyA,pair.bodyB];
      const lbls=[pair.bodyA.label,pair.bodyB.label];
      if(!lbls.includes('ball')) continue;
      const other=bodies.find(b=>b.label!=='ball');
      const owner=other&&this.bodyOwner.get(other);
      if(owner){
        if(this.offsideFlag&&owner.role===this.offsideFlag.role&&this.offsideFlag.ids.has(owner.id)&&!this.confrontation){
          this._commitOffside(owner.role,this.time.now);
          this.offsideFlag=null;
          continue; // don't also count this as a normal touch or a goal-sensor hit
        }
        this.offsideFlag=null; // any other touch means the danger window has passed
        this.lastTouch=owner;
        if(!this.possRole&&!this.confrontation) this.possRole=owner.role;
      }
      // A ball that rolls or is chipped into the net is NOT a goal: every
      // real goal is decided by the shot confrontation, which resolves
      // abstractly and never sends the ball in physically. So anything that
      // reaches these sensors is a stray pass or a loose ball, and the
      // keeper simply collects it.
      if(lbls.includes('goalMin')) this._strayIntoNet('B');
      if(lbls.includes('goalMax')) this._strayIntoNet('A');
    }
  }

  /** Hands a stray ball that crossed the line back to the keeper defending
   *  that goal, restarting from the six-yard spot like a goal kick. */
  _strayIntoNet(defendingRole){
    if(this.confrontation) return; // the ball is glued to a player mid-duel
    const gkY=defendingRole==='B'?this.PA_H*0.6:this.FIELD_H-this.PA_H*0.6;
    const now=this.time.now;
    this._placeBallAndAward(defendingRole,{x:this.FIELD_W/2,y:gkY},now,{preferGk:true});
    this.confrontResult={title:'Keeper collects it',outcome:'',until:now+1500,outcomeAt:now+1500};
  }

  // ════════════════════════════════════════════════════════════════════
  // Confrontations
  // ════════════════════════════════════════════════════════════════════
  /** `opts.skipBlockCheck` skips the wall-defender check (used when chaining
   *  in from a beaten block, so the same shot can't be walled twice).
   *  `opts.powerMulOverride` forces the shot's power multiplier instead of
   *  recomputing it from distance (used for that same chained shot, which
   *  already lost extra power grazing past the blocker). */
  _startConfront(type,aRole,dRole,now,opts={}){
    const aId=aRole==='A'?this.activeIdA:this.activeIdB;
    if(type==='shot'){
      playKick();
      const eAtk=this._activeEntry(aRole);
      const goalY=aRole==='A'?0:this.FIELD_H; // the goal aRole is shooting at
      const shotDist=eAtk?Math.abs(goalY-eAtk.body.position.y):0;
      const powerMul=opts.powerMulOverride!=null?opts.powerMulOverride:this._shotPowerMul(shotDist);
      if(!opts.skipBlockCheck&&shotDist>=BLOCK_MIN_DIST){
        const blocker=this._findBlocker(aRole,dRole,eAtk,goalY);
        if(blocker){
          this.confrontation={type:'block',attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:blocker.id,deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:null,powerMul,chainShot:{aRole,dRole}};
          return;
        }
      }
      const dId=dRole==='A'?this.gkIdA:this.gkIdB;
      // Chained in from a beaten block: the attacker already committed to —
      // and already paid PT for — how hard they shot to power through the
      // blocker. Carry that same resolved technique (or lack of one)
      // straight into the keeper duel instead of asking them again for
      // what's really the same shot, and don't charge them a second time
      // for it (presetAttackerTech skips _tryTech in _prepareConfrontReveal
      // entirely; attackerLocked hides their panel — see _updateConfrontUI).
      const locked=opts.attackerLocked===true;
      this.confrontation={type:'shot',attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:dId,deadline:now+CONFRONT_MS,attackerChoice:locked?'normal':null,defenderChoice:null,powerMul,attackerLocked:locked,presetAttackerTech:locked?(opts.attackerTechPreset??null):undefined};
      return;
    }
    const dId=dRole==='A'?this.activeIdA:this.activeIdB;
    this.confrontation={type,attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:dId,deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:null};
  }
  /** Full power up close, easing down to a floor at long range. */
  _shotPowerMul(dist){
    if(dist<=SHOT_FALLOFF_NEAR) return 1;
    if(dist>=SHOT_FALLOFF_FAR) return SHOT_FALLOFF_MIN;
    const t=(dist-SHOT_FALLOFF_NEAR)/(SHOT_FALLOFF_FAR-SHOT_FALLOFF_NEAR);
    return 1-t*(1-SHOT_FALLOFF_MIN);
  }
  /** Finds the nearest defending outfield player (not the keeper) standing
   *  close to the straight line between the shooter and the goal, between
   *  the two (not behind either) — the one who'd actually get a foot to it. */
  _findBlocker(aRole,dRole,eAtk,goalY){
    if(!eAtk) return null;
    const team=dRole==='A'?this.teamA:this.teamB;
    const gkId=dRole==='A'?this.gkIdA:this.gkIdB;
    const goalX=this.FIELD_W/2;
    const sx=eAtk.body.position.x, sy=eAtk.body.position.y;
    const dx=goalX-sx, dy=goalY-sy, lineLenSq=dx*dx+dy*dy||1;
    const now=this.time.now;
    let best=null, bestD=BLOCK_CORRIDOR_HALF;
    for(const e of team){
      if(e.id===gkId||!e.body) continue;
      if(this._isOut(dRole,e.id)||this._isStunned(e.id,now)) continue;
      const px=e.body.position.x-sx, py=e.body.position.y-sy;
      const t=(px*dx+py*dy)/lineLenSq;
      if(t<=0.12||t>=0.92) continue; // not meaningfully between shooter and goal
      const projX=sx+dx*t, projY=sy+dy*t;
      const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,projX,projY);
      if(d<bestD){ bestD=d; best=e; }
    }
    return best;
  }
  _aiParams(){ return AI_LEVELS[this.aiLevel]||AI_LEVELS[AI_LEVEL_DEFAULT]; }
  /** Difficulty stat inflation for `role`, applied live rather than baked
   *  into the stored stats: it only ever applies to the AI's own side (B,
   *  and only while nobody is connected to play it), so switching level or
   *  having a real opponent join leaves the roster's numbers untouched. */
  _aiStatMul(role){
    if(role!=='B'||this.net.hasPeer()) return 1;
    return this._aiParams().statMul??1;
  }
  _aiSpeedMul(role){
    return 1+(this._aiStatMul(role)-1)*AI_SPEED_BONUS_SHARE;
  }
  /** Picks the strongest `category` technique this player can actually
   *  afford right now, as a {tech:index} choice into techniquesFor's list —
   *  or 'normal' if none of them fit their remaining PT. */
  _bestTechChoice(stats,cat){
    const list=techniquesFor(stats,cat);
    let bestIdx=-1,bestPower=-1;
    list.forEach((t,i)=>{ if(stats.sp>=t.cost&&t.power>bestPower){ bestPower=t.power; bestIdx=i; } });
    return bestIdx===-1?'normal':{tech:bestIdx};
  }
  _aiChoice(stats,cat){ return canActivate(stats,cat)&&Math.random()<this._aiParams().techChance?this._bestTechChoice(stats,cat):'normal'; }
  /** Resolves a choice ('normal' or {tech:index}) against `stats`' own
   *  techniquesFor(cat) list, spends the PT if it's actually affordable, and
   *  returns the technique used — or null for a normal action / an
   *  unaffordable or now-stale choice (e.g. sent before a PT-costing choice
   *  elsewhere already spent it this tick). */
  _tryTech(stats,cat,choice){
    if(!choice||typeof choice!=='object'||typeof choice.tech!=='number') return null;
    const tech=techniquesFor(stats,cat)[choice.tech];
    if(!tech||stats.sp<tech.cost) return null;
    stats.sp-=tech.cost;
    return tech;
  }
  /** The label for choosing (or having chosen) no supertechnique, specific
   *  to what kind of confrontation and which side of it this is — shared
   *  between the live choice button and the after-the-fact VS reveal, so
   *  the two never disagree on what "normal" meant here. */
  _normalActionLabel(type,isAttacker){
    if(type==='duel') return isAttacker?'Normal dribble':'Normal tackle';
    // A block only stops anything with a supertechnique (see
    // _prepareConfrontReveal) — "normal" there just means the defender
    // deliberately does nothing, e.g. to save the PT for later.
    if(type==='block') return isAttacker?'Shoot anyway':'Let it through';
    return isAttacker?'Normal shot':'Normal save'; // type==='shot'
  }
  _statsFor(role,id){ return (role==='A'?this.statsMapA:this.statsMapB).get(id); }

  _entryById(role,id){ const team=role==='A'?this.teamA:this.teamB; return team.find(t=>t.id===id)||null; }

  /** Rolls the outcome and puts the confrontation into its reveal beat: both
   *  moves are shown facing each other, then the winner lights up, and only
   *  after that does _applyConfrontOutcome actually move anything. Play is
   *  already frozen while a confrontation is live, so this reads as a pause. */
  _prepareConfrontReveal(now){
    const c=this.confrontation;
    const as=this._statsFor(c.attackerRole,c.attackerId), ds=this._statsFor(c.defenderRole,c.defenderId);
    if(!as||!ds){this.confrontation=null;return;}
    const atk=c.type==='duel'?'dribble':'shot';
    const def=c.type==='shot'?'keeper':'defense'; // duel and block both face a 'defense' roll
    // A shot chained in from a beaten block already spent its attacker's PT
    // (and locked in their technique) back when they powered through the
    // blocker — reuse that resolved result instead of charging them again.
    const aTech=c.presetAttackerTech!==undefined?c.presetAttackerTech:this._tryTech(as,atk,c.attackerChoice);
    const dTech=this._tryTech(ds,def,c.defenderChoice);
    // A shot's power fades with distance (see _shotPowerMul) — applies to
    // both the block attempt and the eventual keeper duel, since it's the
    // same weakened strike either way.
    const powerMul=(c.type==='shot'||c.type==='block')?(c.powerMul||1):1;
    // Elemental edge — only one side can hold it, and only when both players
    // have a known element (the roster doesn't have one for everyone).
    const elEdge=this._elementEdge(as.element,ds.element);
    const aP=(aTech?aTech.power:NORMAL_ACTION_POWER)*Math.pow(as[STAT_FIELD_FOR_TECH[atk]],STAT_POWER_EXPONENT)*powerMul*(elEdge>0?ELEMENT_EDGE:1)
      *this._aiStatMul(c.attackerRole);
    const dP=(dTech?dTech.power:NORMAL_ACTION_POWER)*Math.pow(ds[STAT_FIELD_FOR_TECH[def]],STAT_POWER_EXPONENT)*(elEdge<0?ELEMENT_EDGE:1)
      *this._aiStatMul(c.defenderRole);
    // Blocking a shot takes a real supertechnique — a normal challenge can't
    // stop it, only soften what happens after (see BLOCK_PASS_PENALTY).
    const aWins=(c.type==='block'&&!dTech)?true:Math.random()<aP/(aP+dP);
    const aTN=aTech?aTech.name:'Normal', dTN=dTech?dTech.name:'Normal';
    // Visual flourish data for whoever actually used a supertechnique —
    // rendered identically on host and client from the synced result.
    const eAtk=this._entryById(c.attackerRole,c.attackerId), eDef=this._entryById(c.defenderRole,c.defenderId);
    const fx={
      a: aTech&&eAtk ? {x:eAtk.body.position.x,y:eAtk.body.position.y,color:c.attackerRole==='A'?this.teamColorA:this.teamColorB,name:aTN} : null,
      d: dTech&&eDef ? {x:eDef.body.position.x,y:eDef.body.position.y,color:c.defenderRole==='A'?this.teamColorA:this.teamColorB,name:dTN} : null
    };
    c.pending={aWins,aTN,dTN,fx,aName:as.name,dName:ds.name,aTech};
    c.reveal={
      until:now+DUEL_REVEAL_MS, litAt:now+DUEL_REVEAL_LIT_MS, type:c.type,
      // ids ride along so _renderDuelReveal can show each side's portrait —
      // this object goes over the wire as-is (see sendState), so a real
      // opponent sees the same card either way.
      a:{id:c.attackerId,name:as.name,move:aTN,winner:aWins,element:as.element,edge:elEdge>0},
      d:{id:c.defenderId,name:ds.name,move:dTN,winner:!aWins,element:ds.element,edge:elEdge<0}
    };
  }

  /** Formation / substitution / reposition requests from either side. These
   *  are one-shot flags update() clears every frame, so they're applied on
   *  every host tick — including a paused one, and regardless of whether a
   *  confrontation elsewhere on the pitch happens to be running. */
  _applySquadRequests(myInput,inputB,aiActive){
    if(myInput.formationChange) this.formation.A=myInput.formationChange;
    if(!aiActive&&inputB.formationChange) this.formation.B=inputB.formationChange;
    // Either side opening/closing their team panel forces the same on the
    // other — see _setTeamPanelOpen.
    if(myInput.teamPanelRequest) this._setTeamPanelOpen(myInput.teamPanelRequest==='open');
    if(!aiActive&&inputB.teamPanelRequest) this._setTeamPanelOpen(inputB.teamPanelRequest==='open');
    if(this.matchClock.ended) return;
    if(myInput.subRequest) this._trySub('A',myInput.subRequest);
    if(!aiActive&&inputB.subRequest) this._trySub('B',inputB.subRequest);
    if(myInput.repositionRequest) this._tryReposition('A',myInput.repositionRequest);
    if(!aiActive&&inputB.repositionRequest) this._tryReposition('B',inputB.repositionRequest);
  }

  /** +1 when `a`'s element beats `b`'s, -1 when it's the other way round, 0
   *  when neither has the edge (same element, or either one unknown). */
  _elementEdge(a,b){
    if(!a||!b||a===b) return 0;
    if(ELEMENT_BEATS[a]===b) return 1;
    if(ELEMENT_BEATS[b]===a) return -1;
    return 0;
  }

  _applyConfrontOutcome(now){
    const c=this.confrontation, r=c.pending;
    if(!r){ this.confrontation=null; return; }
    const {aWins,aTN,dTN,fx,aName,dName,aTech}=r;
    let title,outcome=`${aName}: ${aTN} · ${dName}: ${dTN}`;
    if(c.type==='duel'){
      const eA=this._activeEntry(c.attackerRole), eD=this._activeEntry(c.defenderRole);
      if(aWins){ this._knockback(eD,eA); this.stunMap.set(c.defenderId,now+STUN_MS); title=`${aName} dribbles past!`; }
      else { this.possRole=c.defenderRole; this._setActive(c.defenderRole,c.defenderId); this._knockback(eA,eD); this.stunMap.set(c.attackerId,now+STUN_MS); title=`${dName} wins the ball!`; }
      this.duelLockUntil=now+STUN_MS+200;
    } else if(c.type==='block'){
      if(aWins){
        // Grazed past the wall — the shot is still on, just weaker for it.
        // Chain straight into the real shot-vs-keeper duel rather than
        // ending the confrontation here (skip the block check so the same
        // shot can't be walled twice).
        this.confrontation=null;
        this.confrontResult={title:`${aName} gets the shot away past ${dName}!`,outcome,until:now+1200,outcomeAt:now+RESULT_DELAY_MS,fx};
        const {aRole,dRole}=c.chainShot;
        this._startConfront('shot',aRole,dRole,now,{skipBlockCheck:true,powerMulOverride:(c.powerMul||1)*BLOCK_PASS_PENALTY,attackerLocked:true,attackerTechPreset:aTech??null});
        return;
      }
      // Blocked clean: the ball pops loose at the blocker's feet, turnover.
      // Look them up by the id the confrontation actually names — they
      // aren't necessarily who was "active" for the team before this.
      const eD=this._entryById(c.defenderRole,c.defenderId);
      this.possRole=c.defenderRole;
      this._setActive(c.defenderRole,c.defenderId);
      if(eD?.body){ this.matter.body.setPosition(this.ball,{x:eD.body.position.x,y:eD.body.position.y}); this.matter.body.setVelocity(this.ball,{x:0,y:0}); }
      title=`${dName} blocks the shot!`;
    } else if(aWins){
      this._onGoal(c.attackerRole==='A'?'a':'b');
      // this.score was just updated by _onGoal, so it already reflects
      // this goal — the banner shows the result, not just who scored.
      title=`⚽ GOAL! ${aName} scores! (${this.score.a} - ${this.score.b})`;
    } else {
      // The keeper (defenderId here, not necessarily whoever was "active"
      // before the shot) made the save — the ball, and possession, are
      // theirs now.
      this.possRole=c.defenderRole;
      this._setActive(c.defenderRole,c.defenderId);
      title=`${dName} saves it!`;
      playGkSave();
    }
    this.confrontation=null;
    this.confrontResult={title,outcome,until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS,fx};
  }

  _onGoal(scorer){
    playGoal();
    this.score[scorer]+=1;
    document.querySelector('#scoreboard .score').textContent=`${this.score.a} - ${this.score.b}`;
    // Standard kickoff rule: whoever conceded restarts with the ball,
    // rather than leaving possession unclaimed for whoever's body happens
    // to reach the centre spot first.
    this._kickoff(scorer==='a'?'B':'A');
    // Freeze the celebration for a beat — the goal banner (set by the
    // caller right after this returns) would otherwise flash by while play
    // has already moved on to the restart. Host-only: the client sees the
    // same effect for free, since a paused host simply stops sending fresh
    // state for its client to interpolate toward (see _hostUpdate).
    this._setPaused(true);
    this.time.delayedCall(GOAL_PAUSE_MS,()=>{
      this._setPaused(false);
      // Clear the banner right as play resumes, same reasoning as the
      // half-time transition: left alone, _setPaused's own _shiftTimers
      // would push its expiry back by the exact length of this pause.
      this.confrontResult=null;
    });
  }

  /** Centre-spot restart for `role`: possession is theirs, both sides line up
   *  in formation on their own half (the side without the ball dropping off
   *  further, see KICKOFF_DEFEND_GAP) and one of their players is stood over
   *  the ball to take it. Used for the start of each half and after a goal. */
  _kickoff(role,title,bannerMs=1800){
    const now=this.time.now;
    this.possRole=role;
    this.confrontation=null;
    this.stunMap.clear();
    this._endPassFlight();
    // Shape first: _placeBallAndAward picks whoever is nearest the centre
    // spot, so the line-up has to be settled before it chooses the taker.
    this._resetFormPos();
    this._placeBallAndAward(role,{x:this.FIELD_W/2,y:this.FIELD_H/2},now);
    if(title) this.confrontResult={title,outcome:'',until:now+bannerMs,outcomeAt:now+bannerMs};
  }
  _resetFormPos(){
    const bp={x:this.FIELD_W/2,y:this.FIELD_H/2};
    this.teamA.forEach(e=>{ const p=this._formPos('A',e.slot,bp,true); this.matter.body.setPosition(e.body,p); this.matter.body.setVelocity(e.body,{x:0,y:0}); });
    this.teamB.forEach(e=>{ const p=this._formPos('B',e.slot,bp,true); this.matter.body.setPosition(e.body,p); this.matter.body.setVelocity(e.body,{x:0,y:0}); });
    this.myPaths.clear();
    this.autoPathIds.clear();
  }

  // ════════════════════════════════════════════════════════════════════
  // Duels-by-proximity, fouls, cards & dead-ball restarts (host only)
  // ════════════════════════════════════════════════════════════════════
  /** Duels no longer fire off a physical collision (players pass through
   *  each other now) — instead, when the two teams' active players get
   *  within DUEL_HITBOX_RADIUS of each other, roll for a foul first; if
   *  it isn't one, start the normal duel confrontation as before. */
  _checkForDuel(now){
    if(!this.possRole||this.confrontation||now<this.duelLockUntil) return;
    const attackerRole=this.possRole, defenderRole=attackerRole==='A'?'B':'A';
    const eA=this._activeEntry(attackerRole), eD=this._activeEntry(defenderRole);
    if(!eA||!eD) return;
    if(this._isStunned(eA.id,now)||this._isStunned(eD.id,now)) return;
    const d=Phaser.Math.Distance.Between(eA.body.position.x,eA.body.position.y,eD.body.position.x,eD.body.position.y);
    if(d>=DUEL_HITBOX_RADIUS) return;
    const ds=this._statsFor(defenderRole,eD.id);
    // statMul because this one needs the absolute ~1.0 scale, not a ratio —
    // dividing a probability by a raw game stat (~95) would floor it.
    const foulChance=Phaser.Math.Clamp(FOUL_CHANCE_BASE/(ds?statMul(ds.pressure):1),FOUL_CHANCE_MIN,FOUL_CHANCE_MAX);
    if(Math.random()<foulChance) this._commitFoul(defenderRole,eD.id,attackerRole,now);
    else this._startConfront('duel',attackerRole,defenderRole,now);
  }

  _cardKey(role,id){ return `${role}:${id}`; }
  _isOut(role,id){ return !!this.cards.get(this._cardKey(role,id))?.red; }
  /** Books `id` and sends them off on a second yellow. Returns 'yellow' or 'red'. */
  _addCard(role,id,now){
    const key=this._cardKey(role,id);
    const rec=this.cards.get(key)||{yellow:0,red:false};
    rec.yellow+=1;
    let type='yellow';
    if(rec.yellow>=2&&!rec.red){ rec.red=true; type='red'; this._sendOff(role,id,now); }
    this.cards.set(key,rec);
    return type;
  }
  _sendOff(role,id,now){
    const team=role==='A'?this.teamA:this.teamB;
    const e=team.find(t=>t.id===id); if(!e) return;
    e.gfx.setVisible(false); e.label.setVisible(false);
    if(e.body){ e.body.collisionFilter.mask=0x0000; this.matter.body.setVelocity(e.body,{x:0,y:0}); }
    this.stunMap.delete(id);
  }

  /** Foul committed by `offenderRole`'s player on `fouledRole`. Books a
   *  card and awards either a penalty (foul inside the offender's own box
   *  — resolved as a normal shot-vs-keeper confrontation) or a free kick
   *  (simple dead-ball restart, no separate aiming step). */
  _commitFoul(offenderRole,offenderId,fouledRole,now){
    const eOff=this._activeEntry(offenderRole);
    const spot={x:eOff?eOff.body.position.x:this.ball.position.x, y:eOff?eOff.body.position.y:this.ball.position.y};
    const cardType=this._addCard(offenderRole,offenderId,now);
    const offenderName=this._statsFor(offenderRole,offenderId)?.name||'Player';
    const cardTxt=cardType==='red'?' — RED CARD, sent off!':' (yellow card)';
    if(this._inPenaltyBox(offenderRole,spot)){
      this._placeBallAndAward(fouledRole,spot,now);
      this._startConfront('shot',fouledRole,offenderRole,now,{skipBlockCheck:true}); // a penalty is never walled
      this.confrontResult={title:`Penalty! Foul by ${offenderName}${cardTxt}`,outcome:'',until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS};
    } else {
      this._placeBallAndAward(fouledRole,spot,now);
      this.confrontResult={title:`Foul by ${offenderName}${cardTxt}`,outcome:'Free kick awarded',until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS};
    }
  }

  /** Generic dead-ball restart: place the ball at `spot`, hand possession
   *  to `awardedRole`, and teleport one of their eligible players there
   *  (their keeper if `preferGk`, otherwise whoever's nearest) to take it. */
  _placeBallAndAward(awardedRole,spot,now,{preferGk=false}={}){
    this._endPassFlight();
    this.offsideFlag=null; // any dead-ball restart clears whatever pass was in flight
    this.matter.body.setPosition(this.ball,spot);
    this.matter.body.setVelocity(this.ball,{x:0,y:0});
    const team=awardedRole==='A'?this.teamA:this.teamB;
    const gkId=awardedRole==='A'?this.gkIdA:this.gkIdB;
    let mover=preferGk?team.find(e=>e.id===gkId&&!this._isOut(awardedRole,e.id)):null;
    if(!mover){
      let bestD=Infinity;
      for(const e of team){
        if(this._isOut(awardedRole,e.id)) continue;
        const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,spot.x,spot.y);
        if(d<bestD){ bestD=d; mover=e; }
      }
    }
    if(mover){
      this.matter.body.setPosition(mover.body,spot);
      this.matter.body.setVelocity(mover.body,{x:0,y:0});
      this._setActive(awardedRole,mover.id);
    }
    this.possRole=awardedRole;
    this.duelLockUntil=now+600;
  }

  /** Checks whether the ball has left the pitch and, if so, restarts play
   *  with a throw-in, corner or goal kick. Returns true if it did (so the
   *  caller can skip the rest of this tick's open-play logic). */
  _checkOutOfBounds(now){
    const b=this.ball.position, m=10;
    if(b.y<-m||b.y>this.FIELD_H+m){
      const overTop=b.y<-m;
      const defendingRole=overTop?'B':'A'; // A now defends the bottom, B the top
      const sideX=b.x<this.FIELD_W/2?18:this.FIELD_W-18;
      const lineY=overTop?18:this.FIELD_H-18;
      if(this.lastTouch&&this.lastTouch.role===defendingRole){
        const attackingRole=defendingRole==='A'?'B':'A';
        this._placeBallAndAward(attackingRole,{x:sideX,y:lineY},now);
        this.confrontResult={title:'Corner kick',outcome:'',until:now+1800,outcomeAt:now+1800};
      } else {
        const gkY=overTop?this.PA_H*0.6:this.FIELD_H-this.PA_H*0.6;
        this._placeBallAndAward(defendingRole,{x:this.FIELD_W/2,y:gkY},now,{preferGk:true});
        this.confrontResult={title:'Goal kick',outcome:'',until:now+1800,outcomeAt:now+1800};
      }
      return true;
    }
    if(b.x<-m||b.x>this.FIELD_W+m){
      const awarded=this.lastTouch&&this.lastTouch.role==='A'?'B':'A';
      const spot={x:Phaser.Math.Clamp(b.x,15,this.FIELD_W-15),y:Phaser.Math.Clamp(b.y,20,this.FIELD_H-20)};
      this._placeBallAndAward(awarded,spot,now);
      this.confrontResult={title:'Throw-in',outcome:'',until:now+1800,outcomeAt:now+1800};
      return true;
    }
    return false;
  }
  // ════════════════════════════════════════════════════════════════════
  // Clock
  // ════════════════════════════════════════════════════════════════════
  _tickClock(delta){
    if(this.matchClock.ended) return;
    this.matchClock.secondsRemaining-=delta/1000;
    if(this.matchClock.secondsRemaining<=0){
      if(this.matchClock.half===1){
        this.matchClock.half=2; this.matchClock.secondsRemaining=this.halfLengthS;
        // Whoever didn't start the match gets the second half, as in a real
        // one. Line everyone up for it and show the break, then actually
        // freeze play for a beat instead of snapping straight into the
        // second half — the instant switch read as jarring.
        this._kickoff(this.kickoffRole==='A'?'B':'A','Half time',HALFTIME_PAUSE_MS);
        this._setPaused(true);
        this.time.delayedCall(HALFTIME_PAUSE_MS,()=>{
          this._setPaused(false);
          // Clear the banner right as play resumes — left alone, _setPaused's
          // own _shiftTimers would push its expiry back by the exact length
          // of the pause it just caused, doubling how long it lingers.
          this.confrontResult=null;
        });
      }
      else { this.matchClock.ended=true; this.matchClock.secondsRemaining=0; }
    }
  }
  static _fmtClock(s){ s=Math.max(0,Math.ceil(s)); const m=Math.floor(s/60),r=s%60; return `${m}:${r<10?'0':''}${r}`; }
  _renderClock(c){
    if(!c) return;
    document.getElementById('match-clock').textContent=c.ended?'Full time':`${c.half===1?'1st':'2nd'} half — ${GameScene._fmtClock(c.secondsRemaining)}`;
    if(c.ended) this._showFullTime();
  }

  /** Full time: show the final score, then drop back to the start menu. The
   *  reset is a reload on purpose — every control in the menu is bound to this
   *  scene instance, so rebuilding a match in place would leave the old
   *  bindings behind. The room code lives in the URL, so it survives. */
  _showFullTime(){
    if(this._fullTimeShown) return;
    this._fullTimeShown=true;
    playWhistle();
    const scoreTxt=document.querySelector('#scoreboard .score').textContent;
    const [a,b]=scoreTxt.split('-').map(n=>parseInt(n,10)||0);
    const mine=this.role==='A'?a:b, theirs=this.role==='A'?b:a;
    // Tournaments are offline-only (the fixture is set up locally, from the
    // rival slot) and the pending fixture is only ever set on the host side
    // (see _playTournamentFixture) — recorded here, before the reload
    // _returnToMenu does in a few seconds, since nothing in memory survives
    // that reload otherwise.
    if(this._tournamentPendingFixture&&this.role==='A') this._recordTournamentResult(this._tournamentPendingFixture,mine,theirs);
    document.getElementById('fulltime-score').textContent=scoreTxt;
    document.getElementById('fulltime-verdict').textContent=mine>theirs?'You win!':mine<theirs?'You lose':'Draw';
    document.getElementById('confrontation-ui').style.display='none';
    document.getElementById('duel-reveal').style.display='none';
    document.getElementById('fulltime-panel').style.display='flex';
    const cd=document.getElementById('fulltime-countdown');
    let left=Math.round(FULLTIME_MENU_MS/1000);
    const tick=()=>{
      if(left<=0){ this._returnToMenu(); return; }
      cd.textContent=`Back to the menu in ${left}s…`;
      left-=1;
    };
    tick();
    this._fullTimeTimer=setInterval(tick,1000);
  }

  _returnToMenu(){
    if(this._fullTimeTimer){ clearInterval(this._fullTimeTimer); this._fullTimeTimer=null; }
    window.location.reload();
  }

  // ════════════════════════════════════════════════════════════════════
  // Main loop
  // ════════════════════════════════════════════════════════════════════
  update(time,delta){
    this._updateModeBadge();
    const amHost=this.role==='A';
    if(!amHost&&this.matchStarted&&!this.clientTeamsBuilt) this._buildClientTeams();
    if(this.matchStarted) this._tickScroll(delta);

    const targets=this.matchStarted?this._computeTargets():[];
    const myInput={targets,shootRequest:this.pendingShoot,passTarget:this.pendingPass,confrontationChoice:this.pendingChoice,subRequest:this.pendingSub,repositionRequest:this.pendingReposition,formationChange:this.pendingFormChange,teamPanelRequest:this.pendingTeamPanelRequest};
    this.pendingShoot=false; this.pendingPass=null; this.pendingChoice=null; this.pendingSub=null; this.pendingReposition=null; this.pendingFormChange=null; this.pendingTeamPanelRequest=null;
    this.net.sendInput(myInput);

    if(amHost){ if(this.matchStarted) this._hostUpdate(time,delta,myInput); else if(time-this.lastStateSent>1000/STATE_HZ){this.lastStateSent=time;this.net.sendState({matchStarted:false});} }
    else this._clientUpdate(time);

    if(this.matchStarted){ this._updateConfrontUI(this.confrontation,time); this._drawPaths(); this._subPanelTick(); }
  }

  /** Keeps the open team panel in step with the squad: a substitution lands a
   *  frame or two after you tap it (host-side, or over the wire as a client),
   *  and the panel now stays open to show the result. Re-renders only when the
   *  line-up actually changed, not every frame. */
  _subPanelTick(){
    if(document.getElementById('sub-panel').style.display!=='flex'){ this._subPanelSig=null; return; }
    const team=this.role==='A'?this.teamA:this.teamB;
    const bench=this.role==='A'?(this.benchA||[]):(this.benchB||[]);
    const sig=`${team.map(e=>e.id).join(',')}|${[...bench].join(',')}|${this.formation[this.role]}`;
    if(sig!==this._subPanelSig){ this._subPanelSig=sig; this._renderSubPanel(); }
  }

  _hostUpdate(now,delta,myInput){
    const aiActive=!this.net.hasPeer();
    let inputB=this.remoteInput;
    if(aiActive){
      const eB=this._activeEntry('B');
      const ai=decideAIMove({selfPos:eB?eB.body.position:{x:this.FIELD_W/2,y:0},ballPos:this.ball.position,axis:'y',ownGoalValue:0,rivalGoalValue:this.FIELD_H,fieldPrimarySize:this.FIELD_H,
        hasBall:this.possRole==='B',goalCentre:this.FIELD_W/2});
      inputB={targets:eB?[{id:eB.id,...ai.target}]:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,repositionRequest:null,formationChange:null};
      if(!this.paused&&!this.confrontation&&!this.matchClock.ended) this._aiConsiderSub(now);
    }
    this.currentPossession=this.possRole;
    // Paused (team panel open, solo vs AI): nothing about the match advances,
    // but changes made from that open panel still have to land — they're
    // one-shot requests that update() clears every frame either way.
    if(this.paused){
      this._applySquadRequests(myInput,inputB,aiActive);
      this._syncGfx(); this._renderClock(this.matchClock);
      return;
    }
    this._applySquadRequests(myInput,inputB,aiActive);
    if(!this.matchClock.ended) this._tickClock(delta);
    if(!this.matchClock.ended) this._tickFatigue(delta);

    if(this.confrontation){
      this._progressConfront(now,myInput,inputB,aiActive);
    } else if(!this.matchClock.ended && !this._checkOutOfBounds(now)){
      this._updateActive('A'); this._updateActive('B');
      this._moveTeam('A',myInput.targets,now); this._moveTeam('B',inputB.targets,now);
      if(myInput.passTarget&&this.possRole==='A') this._doPass('A',myInput.passTarget);
      else if(!aiActive&&inputB.passTarget&&this.possRole==='B') this._doPass('B',inputB.passTarget);
      if(myInput.shootRequest&&this.possRole==='A') this._startConfront('shot','A','B',now);
      else if(!aiActive&&inputB.shootRequest&&this.possRole==='B') this._startConfront('shot','B','A',now);
      else if(aiActive&&this.possRole==='B'){
        const eB=this._activeEntry('B'), p=this._aiParams();
        // Shoot as soon as it's in range rather than dithering around the box
        if(eB&&eB.body.position.y>this.FIELD_H-p.shootRange&&Math.random()<p.shootChance) this._startConfront('shot','B','A',now);
        else if(eB){
          const underPressure=this._nearestOpponentDist('B',eB)<PRESS_RANGE;
          const passChance=underPressure?p.passChance:p.passChance*PASS_CHANCE_FREE_MULT;
          if(Math.random()<passChance){
            const mate=this._aiPickPassTarget('B',eB);
            if(mate) this._doPass('B',{x:mate.body.position.x,y:mate.body.position.y});
          }
        }
      }
      if(!this.confrontation) this._checkForDuel(now);
    }
    this._updatePassFlight();
    this._glueBall(); this._syncGfx();
    this._renderClock(this.matchClock);
    this._renderResultBanner(this.confrontResult,now);
    const as=this._statsFor('A',this.activeIdA); if(as) this._paintHUD(as.sp,as.maxSP,as.stamina,as.maxStamina);

    if(now-this.lastStateSent>1000/STATE_HZ){
      this.lastStateSent=now;
      const as2=this._statsFor('A',this.activeIdA), bs=this._statsFor('B',this.activeIdB);
      const stunAry=[...this.stunMap.entries()].map(([k,v])=>({id:k,until:v}));
      const statsAll={
        a:this.teamA.map(e=>{const s=this._statsFor('A',e.id); return s?s.sp:null;}),
        b:this.teamB.map(e=>{const s=this._statsFor('B',e.id); return s?s.sp:null;})
      };
      const sentOff={
        a:this.teamA.filter(e=>this._isOut('A',e.id)).map(e=>e.id),
        b:this.teamB.filter(e=>this._isOut('B',e.id)).map(e=>e.id)
      };
      this.net.sendState({matchStarted:true,ball:{x:this.ball.position.x,y:this.ball.position.y},ballH:this.ballFlight?Math.round(this.ballFlight.h):0,teamA:this.teamA.map(e=>({x:e.body.position.x,y:e.body.position.y})),teamB:this.teamB.map(e=>({x:e.body.position.x,y:e.body.position.y})),activeIdA:this.activeIdA,activeIdB:this.activeIdB,score:this.score,sp:{a:as2?as2.sp:0,b:bs?bs.sp:0},maxSp:{a:as2?as2.maxSP:100,b:bs?bs.maxSP:100},stamina:{a:as2?as2.stamina:0,b:bs?bs.stamina:0},maxStamina:{a:as2?as2.maxStamina:150,b:bs?bs.maxStamina:150},statsAll,sentOff,possession:this.possRole,confrontation:this.confrontation?{type:this.confrontation.type,attackerRole:this.confrontation.attackerRole,defenderRole:this.confrontation.defenderRole,attackerId:this.confrontation.attackerId,defenderId:this.confrontation.defenderId,deadline:this.confrontation.deadline,reveal:this.confrontation.reveal||null,powerMul:this.confrontation.powerMul||1,attackerLocked:!!this.confrontation.attackerLocked}:null,confrontResult:(this.confrontResult&&now<this.confrontResult.until)?this.confrontResult:null,benchIds:{a:this.benchA,b:this.benchB},starterIds:{a:this.teamA.map(e=>e.id),b:this.teamB.map(e=>e.id)},clock:{half:this.matchClock.half,secondsRemaining:this.matchClock.secondsRemaining,ended:this.matchClock.ended},stuns:stunAry,teamPanelOpen:this.teamPanelOpen});
    }
  }

  _moveTeam(role,targets,now){
    const team=role==='A'?this.teamA:this.teamB;
    const byId=new Map(targets.map(t=>[t.id,t]));
    const activeId=role==='A'?this.activeIdA:this.activeIdB;
    const iHaveBall=this.possRole===role;
    const oppHasBall=!!this.possRole&&this.possRole!==role;
    const ballCarrier=oppHasBall?this._activeEntry(this.possRole):null;
    team.forEach(e=>{
      if(this._isOut(role,e.id)) return; // sent off: frozen, invisible, ignored entirely
      if(this._isStunned(e.id,now)){
        // Stunned: drain velocity, don't steer, and can't touch the ball —
        // otherwise a knocked-back player clipping the ball at speed could
        // fling it (this is what caused the ball to "shoot" after a duel).
        if(e.body) e.body.collisionFilter.mask=CAT_DEFAULT;
        this.matter.body.setVelocity(e.body,{x:e.body.velocity.x*0.85,y:e.body.velocity.y*0.85});
        return;
      }
      if(e.body&&e.body.collisionFilter.mask!==(CAT_BALL|CAT_DEFAULT)) e.body.collisionFilter.mask=CAT_BALL|CAT_DEFAULT;
      // Agility is the games' own name for what used to be our `speed`, and
      // it was already a 1:1 copy of it — statMul puts the raw game number
      // back on the ~1.0 scale the movement code multiplies by, so pace is
      // unchanged by the move to native stats.
      const st=this._statsFor(role,e.id), sp=(st?statMul(st.agility)*this._fatigueMul(st):1)*this._aiSpeedMul(role);
      const t=byId.get(e.id);
      const chase=t?null:this._looseBallChase(e,activeId);
      // The sprint bonus itself shrinks as stamina drains, on top of the
      // general fatigue cutoff already baked into `sp` above.
      const staminaRatio=st?Phaser.Math.Clamp(st.stamina/st.maxStamina,0,1):1;
      const sprintSpeedMul=1+SPRINT_MAX_SPEED_BONUS*staminaRatio;
      const sprintForceMul=1+SPRINT_MAX_FORCE_BONUS*staminaRatio;
      if(t) this._steer(e.body,t,t.sprint?sp*sprintSpeedMul:sp,t.sprint?STEER_FORCE*sprintForceMul:STEER_FORCE);
      else if(chase) this._steer(e.body,chase,sp,STEER_FORCE); // full pace, not the off-ball amble
      else {
        // Autonomous position: hold roughly to formation, but lean into a
        // supporting run when we have the ball, or press the ball carrier
        // when the opponent does.
        const autoPos=this._offBallTarget(role,e,activeId,iHaveBall,ballCarrier);
        this._steer(e.body,autoPos,sp,AUTO_STEER_FORCE);
        // Soft speed cap for autonomous movement — scaled by the player's
        // own speed stat too, so quick players still look quick off the ball.
        const cap=AUTO_MAX_SPEED*sp;
        const v=e.body.velocity, s=Math.hypot(v.x,v.y);
        if(s>cap) this.matter.body.setVelocity(e.body,{x:(v.x/s)*cap,y:(v.y/s)*cap});
      }
    });
  }

  _progressConfront(now,myInput,inputB,aiActive){
    const c=this.confrontation;
    // Already showing the VS cards: no more input matters, just wait out the
    // beat and then apply what was rolled.
    if(c.reveal){
      // The host owns the timing and flips the flag, so the client lights the
      // same card at the same moment instead of racing its own clock.
      if(now>=c.reveal.litAt) c.reveal.lit=true;
      if(now>=c.reveal.until) this._applyConfrontOutcome(now);
      return;
    }
    if(myInput.confrontationChoice){ if(c.attackerRole==='A'&&!c.attackerChoice)c.attackerChoice=myInput.confrontationChoice; if(c.defenderRole==='A'&&!c.defenderChoice)c.defenderChoice=myInput.confrontationChoice; }
    if(!aiActive&&inputB.confrontationChoice){ if(c.attackerRole==='B'&&!c.attackerChoice)c.attackerChoice=inputB.confrontationChoice; if(c.defenderRole==='B'&&!c.defenderChoice)c.defenderChoice=inputB.confrontationChoice; }
    if(aiActive){
      const tf=r=>{
        if(c.type==='duel') return r===c.attackerRole?'dribble':'defense';
        if(c.type==='block') return r===c.attackerRole?'shot':'defense';
        return r===c.attackerRole?'shot':'keeper';
      };
      if(c.attackerRole==='B'&&!c.attackerChoice){const s=this._statsFor('B',c.attackerId);c.attackerChoice=s?this._aiChoice(s,tf('B')):'normal';}
      if(c.defenderRole==='B'&&!c.defenderChoice){
        const s=this._statsFor('B',c.defenderId);
        // A normal block never works — the AI always reaches for its best
        // affordable supertechnique here instead of rolling its usual chance.
        c.defenderChoice=c.type==='block'?(s?this._bestTechChoice(s,'defense'):'normal'):(s?this._aiChoice(s,tf('B')):'normal');
      }
    }
    if((c.attackerChoice&&c.defenderChoice)||now>=c.deadline){ if(!c.attackerChoice)c.attackerChoice='normal'; if(!c.defenderChoice)c.defenderChoice='normal'; this._prepareConfrontReveal(now); }
  }

  _incomingState(data){
    this.remoteState=data;
    if(data.matchStarted&&!this.matchStarted){
      this.matchStarted=true;
      document.getElementById('squad-editor-panel').style.display='none';
      if(this._squadRetryTimer){ clearInterval(this._squadRetryTimer); this._squadRetryTimer=null; }
    }
    // Mirrors the host's authoritative team-panel state: whichever side
    // opened it (this one or the host's own), both screens show it —
    // matches the local optimistic show/hide in _openSubPanel/_closeSubPanel.
    if(!!data.teamPanelOpen!==!!this.teamPanelOpen){
      this.teamPanelOpen=!!data.teamPanelOpen;
      document.getElementById('sub-panel').style.display=this.teamPanelOpen?'flex':'none';
      if(this.teamPanelOpen){ this.subSel=null; this._subPanelSig=null; this._setSubPanelSide('me'); }
    }
  }

  _clientUpdate(time){
    if(!this.remoteState?.matchStarted||!this.clientTeamsBuilt) return;
    const lerp=0.3;
    this._syncClientIds(this.remoteState);
    if(this.remoteState.stuns) this.remoteState.stuns.forEach(({id,until})=>this.stunMap.set(id,until));
    // Track the ball's position on the ground and add the synced height on
    // top, so a chipped pass looks the same on both screens.
    if(!this._clientBall) this._clientBall={x:this.remoteState.ball.x,y:this.remoteState.ball.y};
    this._clientBall.x=Phaser.Math.Linear(this._clientBall.x,this.remoteState.ball.x,lerp);
    this._clientBall.y=Phaser.Math.Linear(this._clientBall.y,this.remoteState.ball.y,lerp);
    this._drawBall(this._clientBall.x,this._clientBall.y,this.remoteState.ballH||0);
    this.teamA.forEach((e,i)=>{ const p=this.remoteState.teamA[i]; if(!p)return; e.gfx.x=Phaser.Math.Linear(e.gfx.x,p.x,lerp); e.gfx.y=Phaser.Math.Linear(e.gfx.y,p.y,lerp); e.label.setPosition(e.gfx.x,e.gfx.y+15); });
    this.teamB.forEach((e,i)=>{ const p=this.remoteState.teamB[i]; if(!p)return; e.gfx.x=Phaser.Math.Linear(e.gfx.x,p.x,lerp); e.gfx.y=Phaser.Math.Linear(e.gfx.y,p.y,lerp); e.label.setPosition(e.gfx.x,e.gfx.y+15); });
    if(this.remoteState.sentOff){
      const outA=new Set(this.remoteState.sentOff.a||[]), outB=new Set(this.remoteState.sentOff.b||[]);
      this.teamA.forEach(e=>{ const out=outA.has(e.id); e.gfx.setVisible(!out); e.label.setVisible(!out); if(out) this.cards.set(this._cardKey('A',e.id),{yellow:2,red:true}); });
      this.teamB.forEach(e=>{ const out=outB.has(e.id); e.gfx.setVisible(!out); e.label.setVisible(!out); if(out) this.cards.set(this._cardKey('B',e.id),{yellow:2,red:true}); });
    }
    this.activeIdA=this.remoteState.activeIdA; this.activeIdB=this.remoteState.activeIdB;
    this._highlightActive();
    // _onGoal (which plays the goal sound) only ever runs host-side — the
    // client has to notice the score actually going up for itself here, or
    // it would sit through goals in silence.
    const {a:scoreA,b:scoreB}=this.remoteState.score;
    if(this._lastClientScore&&(scoreA>this._lastClientScore.a||scoreB>this._lastClientScore.b)) playGoal();
    this._lastClientScore={a:scoreA,b:scoreB};
    document.querySelector('#scoreboard .score').textContent=`${scoreA} - ${scoreB}`;
    this._renderClock(this.remoteState.clock);
    this.currentPossession=this.remoteState.possession;
    // After the sent-off pass above and the possession assignment, so it
    // sees who's actually on the pitch and who's carrying the ball.
    this._declutterLabels();
    this.confrontation=this.remoteState.confrontation;
    this._renderResultBanner(this.remoteState.confrontResult,time);
    this._paintHUD(this.remoteState.sp.b,(this.remoteState.maxSp?.b)||100,this.remoteState.stamina?.b,(this.remoteState.maxStamina?.b)||150);
    this._updatePossRing();
  }

  _syncClientIds(rs){
    if(!rs.starterIds) return;
    ['A','B'].forEach(role=>{ const team=role==='A'?this.teamA:this.teamB,ids=role==='A'?rs.starterIds.a:rs.starterIds.b,map=role==='A'?this.statsMapA:this.statsMapB; team.forEach((e,i)=>{ const nid=ids[i]; if(nid&&nid!==e.id){e.id=nid;this._relabelEntry(e);if(!map.has(nid)){const rp=getPlayerById(nid);if(rp){const s=createPlayerStats();applyRosterPlayerToStats(s,rp);map.set(nid,s);}}}}); });
    if(rs.benchIds){this.benchA=rs.benchIds.a||this.benchA;this.benchB=rs.benchIds.b||this.benchB;}
    // PT only truly regenerates on the host — mirror its authoritative
    // values into our local copy so a client's own PT bar and technique
    // gating stay correct instead of frozen at their initial value.
    if(rs.statsAll){
      ['A','B'].forEach(role=>{
        const team=role==='A'?this.teamA:this.teamB, map=role==='A'?this.statsMapA:this.statsMapB;
        const arr=role==='A'?rs.statsAll.a:rs.statsAll.b; if(!arr) return;
        team.forEach((e,i)=>{ const sp=arr[i]; const st=map.get(e.id); if(sp!=null&&st) st.sp=sp; });
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // HUD
  // ════════════════════════════════════════════════════════════════════
  _paintHUD(sp,max,stamina,maxStamina){
    document.getElementById('sp-value').textContent=`${Math.round(sp)}/${Math.round(max||100)}`;
    if(stamina==null) return;
    const pct=Math.round(100*stamina/(maxStamina||150));
    const el=document.getElementById('stamina-value');
    el.textContent=`${pct}%`;
    el.classList.toggle('low',pct<40);
  }

  _renderResultBanner(result,now){
    const el=document.getElementById('confrontation-result');
    if(result&&now<result.until){
      if(result.until!==this._lastFxUntil){
        this._lastFxUntil=result.until;
        if(result.fx){ this._playTechniqueFx(result.fx.a); this._playTechniqueFx(result.fx.d); }
        // Bring the restart into view — the ball could've gone in near
        // either goal line, off-screen from wherever the camera had
        // scrolled to follow play. Runs identically on host and client
        // since each has its own local camera to recentre.
        if(result.title&&result.title.startsWith('⚽ GOAL!')) this._centerCameraOnField();
      }
      document.getElementById('result-title').textContent=result.title||'';
      const out=document.getElementById('result-outcome');
      out.textContent=(result.outcomeAt&&now>=result.outcomeAt)?result.outcome||'':'';
      el.style.display='block';
    } else el.style.display='none';
  }

  /** Expanding colored ring + the technique's name floating up — a quick,
   *  sprite-free flourish for when a player actually spends PT on a
   *  supertechnique, shown at their position on both host and client. */
  _playTechniqueFx(data){
    if(!data) return;
    const ring=this.add.circle(data.x,data.y,16,data.color,0).setStrokeStyle(5,data.color,1).setDepth(8).setScale(0.4).setAlpha(1);
    this.tweens.add({targets:ring,scale:3.2,alpha:0,duration:650,ease:'Cubic.Out',onComplete:()=>ring.destroy()});
    const txt=this.add.text(data.x,data.y-26,data.name,{fontSize:'11px',fontStyle:'bold',color:'#fff176',stroke:'#000',strokeThickness:4,resolution:3}).setOrigin(0.5,1).setDepth(9);
    this.tweens.add({targets:txt,y:txt.y-24,alpha:0,duration:900,ease:'Cubic.Out',onComplete:()=>txt.destroy()});
  }

  /** The VS beat: two cards face off, then the winner's lights up and the
   *  loser's dims. Shown to both players, whoever is involved. */
  _renderDuelReveal(rv){
    const wrap=document.getElementById('duel-reveal');
    wrap.style.display='flex';
    const side=(pre,d,lit)=>{
      const card=document.getElementById(`duel-card-${pre}`);
      // The element sits next to the name, flagged when it's the one with
      // the edge, so a surprising result reads as "they had the element"
      // rather than as a coin flip.
      const el=d.element?`<span class="duel-el${d.edge?' edge':''}">${ELEMENT_ICON[d.element]||''} ${d.element}${d.edge?' ▲':''}</span>`:'';
      const rp=d.id?getPlayerById(d.id):null;
      const av=this._avatarFill(rp,this._css3(rp?this._rosterColor(rp):0x999999));
      card.querySelector('.duel-portrait').style.cssText=av.style;
      card.querySelector('.duel-portrait').textContent=av.inner;
      card.querySelector('.duel-who').innerHTML=`${d.name}${el}`;
      card.querySelector('.duel-move').textContent=d.move==='Normal'?this._normalActionLabel(rv.type,pre==='a'):d.move;
      card.classList.toggle('winner',lit&&d.winner);
      card.classList.toggle('loser',lit&&!d.winner);
    };
    const lit=!!rv.lit;
    side('a',rv.a,lit); side('d',rv.d,lit);
  }

  _updateConfrontUI(confrontation,now){
    const panel=document.getElementById('confrontation-ui');
    const reveal=document.getElementById('duel-reveal');
    if(!confrontation){panel.style.display='none';reveal.style.display='none';return;}
    if(confrontation.reveal){ panel.style.display='none'; this._renderDuelReveal(confrontation.reveal); return; }
    reveal.style.display='none';
    const amA=confrontation.attackerRole===this.role, amD=confrontation.defenderRole===this.role;
    if(!amA&&!amD){panel.style.display='none';return;}
    panel.style.display='flex';
    // Chained in from a beaten block: the attacker already made this call
    // (see _startConfront) — show them it's out of their hands now instead
    // of asking again for what's really the same shot.
    if(amA&&confrontation.attackerLocked){
      document.getElementById('confrontation-title').textContent="You're through — waiting for the keeper!";
      document.getElementById('conf-normal').style.display='none';
      document.getElementById('conf-tech-list').innerHTML='';
      document.getElementById('confrontation-player-info').innerHTML='';
      const rem=Math.max(0,confrontation.deadline-now);
      document.getElementById('confrontation-timer-fill').style.width=`${(rem/CONFRONT_MS)*100}%`;
      return;
    }
    const isDuel=confrontation.type==='duel', isBlock=confrontation.type==='block';
    const techId=isDuel?(amA?'dribble':'defense'):isBlock?(amA?'shot':'defense'):(amA?'shot':'keeper');
    const relId=amA?confrontation.attackerId:confrontation.defenderId;
    const relRole=amA?confrontation.attackerRole:confrontation.defenderRole;
    const stats=this._statsFor(relRole,relId); const rp=relId?getPlayerById(relId):null;
    document.getElementById('confrontation-title').textContent=isDuel?(amA?"Duel! You're being tackled":'Duel! Go for the tackle')
      :isBlock?(amA?'A defender is in the way!':'Block the shot — needs a supertechnique!')
      :(amA?'Shoot for goal!':'Save the shot!');
    // A block only stops anything with a supertechnique (see
    // _prepareConfrontReveal) — "normal" there just means the defender
    // deliberately does nothing, e.g. to save the PT for later.
    const normalBtn=document.getElementById('conf-normal');
    normalBtn.style.display='block';
    normalBtn.textContent=this._normalActionLabel(confrontation.type,amA);
    const myChoice=amA?confrontation.attackerChoice:confrontation.defenderChoice;
    const myChoiceIsTech=myChoice&&typeof myChoice==='object'&&typeof myChoice.tech==='number';
    normalBtn.classList.toggle('is-primary',myChoice==='normal');
    // Show the elemental matchup before the choice, not just in the reveal —
    // it's the one thing you can actually plan around (e.g. save the PT when
    // you're at a disadvantage anyway).
    const oppRole=amA?confrontation.defenderRole:confrontation.attackerRole;
    const oppId=amA?confrontation.defenderId:confrontation.attackerId;
    const oppStats=this._statsFor(oppRole,oppId);
    const edge=this._elementEdge(stats?.element,oppStats?.element);
    const elLine=(stats?.element&&oppStats?.element)
      ? ` · ${ELEMENT_ICON[stats.element]} ${stats.element} vs ${ELEMENT_ICON[oppStats.element]} ${oppStats.element}`
        +(edge>0?' <span style="color:#7dff9b">▲ advantage</span>':edge<0?' <span style="color:#ff9b9b">▼ disadvantage</span>':'')
      : (stats?.element?` · ${ELEMENT_ICON[stats.element]} ${stats.element}`:'');
    document.getElementById('confrontation-player-info').innerHTML=stats?`<b>${rp?.name||stats.name}</b> — PT ${Math.round(stats.sp)}/${Math.round(stats.maxSP)}${elLine}`:'';
    // One button per technique this player has in the category — a player
    // with more than one of the same kind (see techniquesFor) can pick
    // whichever they want, not just whichever happens to be "the" one.
    const techWrap=document.getElementById('conf-tech-list'); techWrap.innerHTML='';
    const techs=stats?techniquesFor(stats,techId):[];
    techs.forEach((tech,idx)=>{
      const btn=document.createElement('button');
      btn.className='conf-btn nes-btn'; btn.dataset.idx=idx;
      const elBadge=stats?.element?this._elBadge(stats.element):'';
      btn.innerHTML=`${elBadge}${tech.name}<span class="cost">${tech.cost} PT</span>`;
      btn.disabled=!stats||stats.sp<tech.cost;
      if(myChoiceIsTech&&myChoice.tech===idx) btn.classList.add('is-primary');
      techWrap.appendChild(btn);
    });
    const rem=Math.max(0,confrontation.deadline-now);
    document.getElementById('confrontation-timer-fill').style.width=`${(rem/CONFRONT_MS)*100}%`;
  }

  _syncGfx(){
    this._drawBall(this.ball.position.x,this.ball.position.y,this.ballFlight?this.ballFlight.h:0);
    const now=this.time.now;
    this.teamA.forEach(e=>{
      e.gfx.setPosition(e.body.position.x,e.body.position.y);
      e.label.setPosition(e.body.position.x,e.body.position.y+15);
      // Flash stun visual: tint grey while stunned
      e.gfx.setFillStyle(this._isStunned(e.id,now)?0x888888:this.teamColorA);
    });
    this.teamB.forEach(e=>{
      e.gfx.setPosition(e.body.position.x,e.body.position.y);
      e.label.setPosition(e.body.position.x,e.body.position.y+15);
      e.gfx.setFillStyle(this._isStunned(e.id,now)?0x888888:this.teamColorB);
    });
    this._declutterLabels();
    this._highlightActive(); this._updatePossRing();
  }

  /** Draw order for names, most worth keeping first: the ball carrier, then
   *  whoever each side is steering, then the rest by slot. Fixed rather than
   *  arbitrary so _declutterLabels resolves the same pair the same way for
   *  as long as they're close, instead of the two flickering against each
   *  other frame to frame. */
  _labelOrder(){
    const carrier=this.currentPossession?this._activeEntry(this.currentPossession):null;
    const rank=e=>e.id===carrier?.id?0:(e.id===this.activeIdA||e.id===this.activeIdB)?1:2;
    return [...this.teamA,...this.teamB].sort((a,b)=>rank(a)-rank(b)||a.slot-b.slot);
  }
  /** Hides a name that would land on one already shown this frame. Two
   *  overlapping labels are unreadable whatever the font — worse with a
   *  plate behind each, where the pair butts together and reads as a
   *  single word — and players bunch up constantly. Only ever hides the
   *  label: a player already off the pitch (sent off, substituted) keeps
   *  theirs hidden, and nothing here brings it back. */
  _declutterLabels(){
    const shown=[];
    for(const e of this._labelOrder()){
      if(!e.gfx.visible){ e.label.setVisible(false); continue; }
      const b=e.label.getBounds();
      const clash=shown.some(r=>Math.abs(r.centerX-b.centerX)<(r.width+b.width)/2
                              &&Math.abs(r.centerY-b.centerY)<(r.height+b.height)/2);
      e.label.setVisible(!clash);
      if(!clash) shown.push(b);
    }
  }

  _highlightActive(){
    this.teamA.forEach(e=>e.gfx.setStrokeStyle(e.id===this.activeIdA?3:0,0xffffff));
    this.teamB.forEach(e=>e.gfx.setStrokeStyle(e.id===this.activeIdB?3:0,0xffffff));
  }

  _updatePossRing(){
    if(this.currentPossession){ const e=this._activeEntry(this.currentPossession); if(e){this.possRing.setPosition(e.gfx.x,e.gfx.y).setVisible(true);return;} }
    this.possRing.setVisible(false);
  }
}
