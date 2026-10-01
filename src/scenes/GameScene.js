import Phaser from 'phaser';
import { connectToRoom, getOrCreateRoomCode } from '../network/network.js';
import { NORMAL_ACTION_POWER, STAT_FIELD_FOR_TECH } from '../data/techniques.js';
import { createPlayerStats, applyRosterPlayerToStats, canActivate, techniquesFor, NATIVE_STATS, statMul } from '../data/players.js';
import { loadRoster, getPlayerById, getGames } from '../data/roster.js';
import { decideAIMove } from '../ai/AIController.js';
import { makeSeededKnockout, makeLeague, recordKnockoutResult, recordLeagueResult, leagueStandings, advanceAuto, saveTournament, loadTournament, clearTournament } from '../data/tournament.js';
import { playKick, playPass, playGoal, playWhistle, playGkSave, isSfxEnabled, setSfxEnabled } from '../audio/sfx.js';
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
// Where full time leaves a note for the page it reloads into (see _returnToMenu).
const RESUME_KEY = 'inazuma-clone:resume:v1';
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
const BLOCK_CORRIDOR_HALF= 70;   // how far off the direct shot line still counts as "in the way"
const BLOCK_PASS_PENALTY = 0.8;  // extra power lost grazing past a beaten blocker
// A teammate this close to the shot's line (same 12%-92% stretch of it as a
// blocker) can chain onto it with a shot supertechnique of their own, adding
// its power to the shot. Only the first one along the line gets the chance.
const CHAIN_CORRIDOR_HALF = 60;
const SHOT_PATH_T_MIN     = 0.12;
const SHOT_PATH_T_MAX     = 0.92;
// Aimed shots: the aim sits on the goal line, no closer than this to a post.
const GOAL_AIM_INSET      = 8;
const SHOT_CONE_HALF      = 16;   // how wide the drawn cone is at the goal (visual only)
// The keeper's save power scales with how close they are to the shot's line:
// full within KEEPER_REACH_FULL, fading to nothing at KEEPER_REACH_MAX. A
// keeper behind the kicker (dribbled past) can't get there at all.
const KEEPER_REACH_FULL   = 20;
const KEEPER_REACH_MAX    = 150;
// Keepers slide along their line after the ball to cover the near post.
const KEEPER_TRACK        = 0.35;
const KEEPER_TRACK_MAX    = 42;   // px either side of the goal centre
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

// Off-ball behaviour: how strongly teammates shift sideways to support the
// ball carrier. PRESS_RANGE is how close an opponent has to be for a ball
// carrier to count as under pressure.
const SUPPORT_BLEND  = 0.65;
const PRESS_RANGE    = 190;

// How much the AI ball carrier's per-tick pass chance (AI_LEVELS.passChance)
// gets scaled when nobody's actually marking them closely — same PRESS_RANGE
// used to decide whether a defender is pressing doubles as "am I under
// pressure" here. Passing at a flat rate regardless of pressure meant the
// AI kept lumping the ball off even in wide open space, reading as far too
// pass-happy; cut way down with nobody near, back to the tuned rate once
// someone's actually closing in.
const PASS_CHANCE_FREE_MULT = 0.25;

// Defending off the ball. Besides the active player (who chases the ball),
// the one teammate nearest the carrier commits to a goal-side press if
// they're within PRESS_ENGAGE_RANGE; DF/MF teammates then pick up the other
// attackers near their own formation spot, most dangerous (nearer our goal
// than the ball) first, one marker each.
const PRESS_ENGAGE_RANGE = 230;
const PRESS_GOAL_SIDE    = 35;   // presser stands this far goal-side of the carrier
const MARK_RANGE         = 220;  // runner must be this close to the marker's formation spot
const MARK_DANGER_BONUS  = 80;   // runners behind the ball are picked up first
const MARK_GOAL_SIDE     = 40;   // mark from this far goal-side of the runner...
const MARK_BALL_SHIFT    = 0.2;  // ...and this share of the way across toward the ball, in the lane
const MARK_BLEND         = 0.6;  // share of the mark spot vs. the formation spot

// Attacking off the ball: wide slots hold near their touchline, and nobody
// settles within SPACING_MIN of a teammate.
const WING_SLOT_X        = 0.3;  // formation x below this (or above 1-this) is a wide slot
const WING_TOUCHLINE_GAP = 0.09; // fraction of width a wide attacker keeps from the line
const WING_BLEND         = 0.6;
const SUPPORT_Y_BLEND    = 0.35; // how far supporters step up toward the carrier's line
const SPACING_MIN        = 120;
const SPACING_PUSH       = 0.6;  // share of the overlap a target is pushed away by

// AI ball carrier (solo rival only).
const AI_PASS_COOLDOWN_MS = 900; // hold a newly won/received ball at least this long
const AI_LANES            = [0.12,0.30,0.50,0.70,0.88]; // dribble lanes, fraction of width
const AI_LANE_AHEAD       = 160; // how far ahead a lane's openness is measured
const AI_LANE_OPEN_CAP    = 260; // openness beyond this counts the same
const AI_LANE_SHIFT_COST  = 0.35; // score lost per px of sideways travel
const AI_LANE_STICKY      = 25;  // bonus for the lane already chosen, so it doesn't flicker
const AI_CUT_IN_EXTRA     = 120; // head for the middle once within shootRange + this
// Pass reading: the ball is chipped over the first PASS_LOFT_FRAC of a pass,
// then rolls ~5x faster than a player runs, so a defender cuts it out only by
// reaching a point on the rolling part before the ball (and the receiver) do.
const INTERCEPT_REACH       = 26;
const INTERCEPT_SPEED_RATIO = 0.22;
const RECEIVER_MARKED_DIST  = 55;  // someone this close to a receiver rules them out
const PASS_MAX_DIST         = 560;
const PASS_BYPASS_BONUS     = 60;  // per defender the pass takes out of the game
const BYPASS_CORRIDOR       = 200; // an opponent is "in the way" if ahead and within this sideways
const PASS_SWITCH_BONUS     = 80;  // max bonus for switching to the far wing
const THROUGH_BALL_LEAD     = 80;  // through balls are played this far ahead of the runner
const THROUGH_BALL_SPACE    = 90;  // and need this much open grass around that point
const THROUGH_BALL_NEAR_LINE= 140; // runner must be onside, within this of the offside line
const THROUGH_BALL_BONUS    = 80;

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
const ELEMENT_ICON  = { Fire:'🔥', Wood:'🌿', Air:'💨', Earth:'⛰️' };
// How each element's supertechnique bursts (see _playTechniqueFx): embers
// rising for Fire, leaves drifting for Wood, fast streaks for Air, chunks
// thrown up and falling for Earth. Plain Phaser emitter config.
const ELEMENT_FX = {
  Fire:  { tint:[0xff5a1f,0xffa62b,0xffe066], speed:{min:40,max:150},  angle:{min:235,max:305}, gravityY:-170, lifespan:750, scale:{start:1.7,end:0},   count:28 },
  Wood:  { tint:[0x3fbf5f,0x8be36b,0x2e8b57], speed:{min:50,max:120},  angle:{min:0,max:360},   gravityY:40,   lifespan:950, scale:{start:1.5,end:0.5}, rotate:{min:0,max:360}, count:22 },
  Air:   { tint:[0xffffff,0x9be7ff,0x29b6f6], speed:{min:230,max:380}, angle:{min:0,max:360},   gravityY:0,    lifespan:460, scale:{start:2.6,end:0.4}, count:36 },
  Earth: { tint:[0x8b5a2b,0xb9875a,0x6b4423], speed:{min:110,max:220}, angle:{min:200,max:340}, gravityY:560,  lifespan:850, scale:{start:1.9,end:1},   count:20 },
};
const FX_NEUTRAL   = { tint:[0xfff176,0xffffff], speed:{min:80,max:180}, angle:{min:0,max:360}, gravityY:0, lifespan:550, scale:{start:1.6,end:0}, count:20 };
const FX_BIG_POWER = 95; // a supertechnique this strong also shakes the camera
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
// `vision` extends the longest pass it will look for (px) and `through` is
// the chance it considers a through ball behind your line on any one pass.
// `aimSkill` is the chance it picks the best spot in the goal to shoot at
// (see _aiPickShotAim) rather than a random one. `press`, `markRange` and
// `markBlend` tune how hard its defence closes you down and tracks your
// runners (see _defensivePlan); your own teammates always use the
// PRESS_ENGAGE_RANGE / MARK_RANGE / MARK_BLEND defaults (= hard).
const AI_LEVELS = {
  easy:   { techChance:0.70, shootRange:420, shootChance:0.70, passChance:0.022, statMul:1.00, vision:0,   through:0.15, aimSkill:0.30, press:150, markRange:150, markBlend:0.35 },
  normal: { techChance:0.75, shootRange:445, shootChance:0.75, passChance:0.024, statMul:1.04, vision:0,   through:0.30, aimSkill:0.50, press:180, markRange:180, markBlend:0.45 },
  hard:   { techChance:0.90, shootRange:530, shootChance:0.90, passChance:0.034, statMul:1.18, vision:100, through:0.80, aimSkill:0.85, press:230, markRange:220, markBlend:0.60 },
  expert: { techChance:0.97, shootRange:620, shootChance:0.97, passChance:0.042, statMul:1.30, vision:160, through:1.00, aimSkill:1.00, press:260, markRange:240, markBlend:0.70 }
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
    this._fullTimeShown=false; this._reportShown=false;
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
    document.getElementById('fulltime-rematch-btn').addEventListener('click',()=>this._rematch());
    document.getElementById('fulltime-continue-btn').addEventListener('click',()=>this._returnToMenu({kind:'tournament'}));
    document.getElementById('sub-button').addEventListener('click',()=>this._openSubPanel());
    document.getElementById('sub-cancel-btn').addEventListener('click',()=>this._closeSubPanel());
    document.querySelectorAll('#sub-panel-side-tabs .sub-panel-side-tab').forEach(btn=>btn.addEventListener('click',()=>this._setSubPanelSide(btn.dataset.side)));

    // Roster load → squad editor
    this.rosterAll=[];
    document.getElementById('squad-pick-list').innerHTML='<p style="opacity:.8;font-size:12px;">Loading roster…</p>';
    loadRoster().then(data=>{
      this.rosterAll=data;
      this._refreshFilterOptions();
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
    this.net.onSquad(d=>this._onRemoteSquad(d));
  }
  /** `{retracted:true}` is the opponent backing out of the squad editor after
   *  confirming (see _backToModeSelect) — forget their squad so a match can't
   *  start against someone who has left. */
  _onRemoteSquad(d){
    this.remoteSquadPayload=d?.retracted?null:d;
    this._tryStartMultiplayerMatch();
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

  /** "← Menu" in the squad editor. The squad you've built stays in memory, so
   *  switching mode doesn't cost you the work. A multiplayer squad you'd
   *  already confirmed is withdrawn first, locally and from the opponent. */
  _backToModeSelect(){
    if(this.mySquadConfirmed){
      this.mySquadConfirmed=false; this.mySquadPayload=null;
      if(this._squadRetryTimer){ clearInterval(this._squadRetryTimer); this._squadRetryTimer=null; }
      try{ this.net.sendSquad({retracted:true}); }catch{ /* no peer to tell */ }
      this._renderPitch(); // Confirm was disabled while waiting
    }
    this._squadSel=null; this._pickPosFilter=null;
    document.getElementById('squad-status').textContent='';
    document.getElementById('player-stat-panel').style.display='none';
    document.getElementById('squad-editor-panel').style.display='none';
    this._showModeSelect();
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
  // Squad editor (topological pitch)
  // ════════════════════════════════════════════════════════════════════
  _initSquadEditor(){
    document.getElementById('formation-select').addEventListener('change',e=>{
      this._edSetFormation(e.target.value); this._renderPitch();
    });
    document.getElementById('pitch-randomize-btn').addEventListener('click',()=>this._randomize());
    document.getElementById('squad-whole-team-btn').addEventListener('click',()=>this._useWholeTeam());
    document.getElementById('squad-search').addEventListener('input',()=>this._renderPickListReset());
    this._combos=[
      this._makeCombobox(document.getElementById('squad-game-filter'),'Game…'),
      this._makeCombobox(document.getElementById('squad-team-filter'),'Team…'),
    ];
    ['squad-game-filter','squad-team-filter','squad-position-filter'].forEach(id=>
      document.getElementById(id).addEventListener('change',()=>{ this._refreshFilterOptions(); this._renderPickListReset(); }));
    document.getElementById('squad-sort-select').addEventListener('change',()=>this._renderPickListReset());
    // Each filter's own "x" clears just that field (back to its default
    // value) and re-renders — data-reset names the element it resets, so
    // one listener covers all of them instead of one per button.
    document.querySelectorAll('.filter-reset-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const el=document.getElementById(btn.dataset.reset);
        el.value='';
        this._refreshFilterOptions();
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
    document.getElementById('profile-name').addEventListener('change',e=>this._profileSetPlayerName(e.target.value));
    document.getElementById('profile-save-current-btn').addEventListener('click',()=>this._profileSaveCurrent());
    document.getElementById('profile-download-btn').addEventListener('click',()=>this._profileDownload());
    document.getElementById('profile-import-btn').addEventListener('click',()=>document.getElementById('profile-import-file').click());
    document.getElementById('profile-import-file').addEventListener('change',async e=>{
      await this._profileImport(e.target.files[0]);
      e.target.value=''; // so re-importing the same file fires change again
    });
    document.getElementById('tournament-back-btn').addEventListener('click',()=>this._closeTournamentPanel());
    document.getElementById('squad-back-btn').addEventListener('click',()=>this._backToModeSelect());
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
    this._migrateLegacySquad();
    this._refreshProfile();
    // Tournament state lives entirely in localStorage (see tournament.js) —
    // _returnToMenu does a full page reload after every match, which wipes
    // any in-memory state a match's result would otherwise need to survive.
    this.activeTournament=loadTournament();
    this._tournamentPendingFixture=null;
    this._consumeResume();
  }

  // ---- saved squads ------------------------------------------------------
  /** Puts a `{name,slots,bench,formation}` profile squad into the editor.
   *  Squads store ids only, resolved against the roster here, so a player
   *  who's since gone from the data is skipped rather than breaking the lot;
   *  returns how many starters were placed and how many had to be dropped. */
  _applySavedSquad(saved){
    // Resolve to each player's current id (a merged duplicate's old id maps
    // to the survivor), and don't let the same player fill two spots.
    const used=new Set();
    const known=id=>{ const p=id?getPlayerById(id):null; if(!p||used.has(p.id)) return null; used.add(p.id); return p.id; };
    const slots=(saved.slots||[]).slice(0,TEAM_SIZE).map(known);
    while(slots.length<TEAM_SIZE) slots.push(null);
    const bench=new Set((saved.bench||[]).map(known).filter(Boolean));
    const dropped=(saved.slots||[]).filter(Boolean).length-slots.filter(Boolean).length;
    if(saved.formation&&FORMATIONS[saved.formation]){
      this.chosenFormation=saved.formation;
      document.getElementById('formation-select').value=saved.formation;
    }
    this.squadSlots=slots; this.benchIds=bench;
    document.getElementById('squad-team-name').value=saved.name||'';
    this._setEditSide('me'); // a saved squad is always your own side
    return {filled:slots.filter(Boolean).length,dropped};
  }

  // ---- profile (kept in this browser, exportable as a file) ---------------
  _profileKey(){ return 'inazuma-clone:profile:v1'; }
  /** Always returns a well-formed profile. The input may be a hand-edited or
   *  foreign file the user imported, so every field is type-checked and
   *  clamped rather than trusted. */
  _cleanProfile(raw){
    const str=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
    const ids=(v,n)=>Array.isArray(v)?v.slice(0,n).map(x=>(typeof x==='string'||typeof x==='number')?x:null):[];
    const newId=()=>`sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
    const squads=(Array.isArray(raw?.squads)?raw.squads:[]).slice(0,50).map(s=>({
      id:str(s?.id,40)||newId(),
      name:str(s?.name,24)||'Untitled squad',
      formation:(typeof s?.formation==='string'&&Object.hasOwn(FORMATIONS,s.formation))?s.formation:DEFAULT_FORMATION,
      slots:ids(s?.slots,TEAM_SIZE),
      bench:ids(s?.bench,20).filter(x=>x!=null),
      savedAt:Number.isFinite(s?.savedAt)?s.savedAt:Date.now()
    }));
    return {format:'inazuma-profile',version:1,playerName:str(raw?.playerName,24),squads};
  }
  _readProfile(){
    try{ return this._cleanProfile(JSON.parse(localStorage.getItem(this._profileKey())||'null')); }
    catch{ return this._cleanProfile(null); }
  }
  _writeProfile(profile){
    try{ localStorage.setItem(this._profileKey(),JSON.stringify(profile)); return true; }
    catch(err){ this._profileStatus(`Couldn't save: ${err.message}`,true); return false; }
  }
  _profileStatus(msg,isError=false){
    const el=document.getElementById('profile-status');
    el.textContent=msg; el.classList.toggle('is-error',isError);
  }
  /** Folds the single-slot save the old 💾/📂 buttons wrote into the profile,
   *  once, then drops it — so nobody loses a squad when those went away. */
  _migrateLegacySquad(){
    const key='inazuma-clone:squad:v1';
    let legacy=null;
    try{ legacy=JSON.parse(localStorage.getItem(key)||'null'); }catch{ /* unreadable: leave it */ }
    if(!legacy||typeof legacy!=='object') return;
    const [squad]=this._cleanProfile({squads:[{...legacy,name:legacy.name||'Saved squad',id:undefined}]}).squads;
    const profile=this._readProfile();
    if(!profile.squads.some(s=>s.name.toLowerCase()===squad.name.toLowerCase())) profile.squads.push(squad);
    if(!this._writeProfile(this._cleanProfile(profile))) return;
    try{ localStorage.removeItem(key); }catch{ /* harmless: the name check above stops a duplicate */ }
  }
  _refreshProfile(){
    document.getElementById('profile-name').value=this._readProfile().playerName;
    this._profileStatus('');
    this._renderProfile();
  }
  /** Built with DOM calls and textContent, never innerHTML — squad names come
   *  from a file that may have been edited by anyone. */
  _renderProfile(){
    const list=document.getElementById('profile-squads');
    list.replaceChildren();
    const {squads}=this._readProfile();
    if(!squads.length){
      const empty=document.createElement('div');
      empty.className='profile-empty';
      empty.textContent='No saved squads yet — build one in the editor, then save it here.';
      list.appendChild(empty);
      return;
    }
    const btn=(label,title,cls,onClick)=>{
      const b=document.createElement('button');
      b.type='button'; b.className=`nes-btn ${cls}`.trim(); b.textContent=label; b.title=title;
      b.addEventListener('click',onClick); return b;
    };
    squads.forEach(s=>{
      const row=document.createElement('div');
      row.className='profile-squad'; row.dataset.squadId=s.id;
      const name=document.createElement('input');
      name.type='text'; name.className='pixel-select'; name.maxLength=24; name.value=s.name;
      name.setAttribute('aria-label','Squad name');
      name.addEventListener('change',()=>this._profileRename(s.id,name.value));
      const meta=document.createElement('div');
      meta.className='meta';
      meta.textContent=`${s.formation} · ${s.slots.filter(x=>x!=null).length}/11 + ${s.bench.length} bench · ${new Date(s.savedAt).toLocaleDateString()}`;
      row.append(
        name,
        btn('Load','Load into the editor','is-primary',()=>this._profileLoad(s.id)),
        btn('Update','Overwrite with the squad currently in the editor','',()=>this._profileUpdate(s.id)),
        btn('✕','Delete','is-error',()=>this._profileDelete(s.id)),
        meta
      );
      list.appendChild(row);
    });
  }
  _profileSnapshot(name){
    return {
      name,
      formation:this.chosenFormation,
      slots:this.squadSlots.slice(),
      bench:[...this.benchIds],
      savedAt:Date.now()
    };
  }
  _profileSaveCurrent(){
    const profile=this._readProfile();
    const name=(document.getElementById('squad-team-name').value.trim()||`Squad ${profile.squads.length+1}`).slice(0,24);
    const snap=this._profileSnapshot(name);
    // Same name = same squad: saving again updates it instead of stacking duplicates.
    const existing=profile.squads.find(s=>s.name.toLowerCase()===name.toLowerCase());
    if(existing) Object.assign(existing,snap);
    else profile.squads.push({...snap,id:`sq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`});
    if(!this._writeProfile(this._cleanProfile(profile))) return;
    this._renderProfile();
    this._profileStatus(existing?`Updated "${name}"`:`Saved "${name}"`);
  }
  _profileLoad(id){
    const s=this._readProfile().squads.find(x=>x.id===id); if(!s) return;
    const {filled,dropped}=this._applySavedSquad(s);
    this._profileStatus(`Loaded "${s.name}" (${filled}/11)${dropped?` — ${dropped} player(s) no longer in the roster`:''}`);
  }
  _profileUpdate(id){
    const profile=this._readProfile();
    const s=profile.squads.find(x=>x.id===id); if(!s) return;
    Object.assign(s,this._profileSnapshot(s.name));
    if(!this._writeProfile(this._cleanProfile(profile))) return;
    this._renderProfile();
    this._profileStatus(`Updated "${s.name}" with your current squad`);
  }
  _profileRename(id,newName){
    const profile=this._readProfile();
    const s=profile.squads.find(x=>x.id===id); if(!s) return;
    s.name=newName.trim().slice(0,24)||s.name;
    if(this._writeProfile(profile)) this._profileStatus(`Renamed to "${s.name}"`);
    this._renderProfile();
  }
  _profileDelete(id){
    const profile=this._readProfile();
    profile.squads=profile.squads.filter(x=>x.id!==id);
    if(this._writeProfile(profile)){ this._renderProfile(); this._profileStatus('Squad deleted'); }
  }
  _profileSetPlayerName(name){
    const profile=this._readProfile();
    profile.playerName=name.trim().slice(0,24);
    this._writeProfile(profile);
  }
  _profileDownload(){
    const blob=new Blob([JSON.stringify(this._readProfile(),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='inazuma-profile.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    this._profileStatus('Profile downloaded');
  }
  /** Merges rather than replaces: the file's name wins if it has one, and its
   *  squads overwrite same-named local ones, but nothing else is lost. */
  async _profileImport(file){
    if(!file) return;
    let incoming;
    try{
      const parsed=JSON.parse(await file.text());
      if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.squads)) throw new Error('not a profile file');
      incoming=this._cleanProfile(parsed);
    }catch(err){
      this._profileStatus(`Couldn't import: ${err.message}`,true);
      return;
    }
    const profile=this._readProfile();
    if(incoming.playerName) profile.playerName=incoming.playerName;
    incoming.squads.forEach(s=>{
      const i=profile.squads.findIndex(x=>x.name.toLowerCase()===s.name.toLowerCase());
      if(i>=0) profile.squads[i]={...s,id:profile.squads[i].id};
      else profile.squads.push(s);
    });
    if(!this._writeProfile(this._cleanProfile(profile))) return;
    document.getElementById('profile-name').value=profile.playerName;
    this._renderProfile();
    this._profileStatus(`Imported ${incoming.squads.length} squad(s)`);
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
    return {starterIds:slots.filter(Boolean),benchIds:[...this.rivalBenchIds],formation:this.rivalFormation,name:this._rivalName||'Rival'};
  }
  /** The name shown beside your goals on the scoreboard: the squad editor's
   *  team-name field, falling back to the profile's player name. */
  _myTeamName(){
    const typed=document.getElementById('squad-team-name').value.trim();
    return (typed||this._readProfile().playerName||'').slice(0,24);
  }
  _setScoreboardNames(nameA,nameB){
    document.getElementById('score-name-a').textContent=nameA||'';
    document.getElementById('score-name-b').textContent=nameB||'';
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
  /** The `n` best-rated players of each position in `pool`, as
   *  `{GK:[...], DF:[...], ...}` — ranked within their own position so
   *  "top 10" means the top 10 keepers, the top 10 defenders, and so on. */
  _topNByPosition(pool,n){
    const byPos={};
    for(const p of pool) (byPos[p.position]=byPos[p.position]||[]).push(p);
    for(const pos in byPos){
      byPos[pos].sort((a,b)=>this._ratingRaw(b)-this._ratingRaw(a));
      byPos[pos]=byPos[pos].slice(0,n);
    }
    return byPos;
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

  /** The Game, Team and Position filters are linked: each dropdown only
   *  offers what the other two leave (faceted), with player counts, so you
   *  can't pick a combination that shows nobody. A selection that's still
   *  on offer is kept; one that isn't falls back to "All …".
   *  Most real teams recur across several games (Raimon alone spans
   *  IE1/IE2/IE3/GO1/GO2/GO3/Ares, each with a totally different XI), so
   *  with no game picked a multi-era team gets an <optgroup> with "All
   *  eras" plus one option per game; a single-era team, or any team once a
   *  game is picked, is one plain option. */
  _refreshFilterOptions(){
    const gs=document.getElementById('squad-game-filter');
    const ts=document.getElementById('squad-team-filter');
    const ps=document.getElementById('squad-position-filter');
    const gameOrder=getGames();
    const gf=gs.value, pf=ps.value;
    const {team:tfTeam,game:tfGame}=this._parseTeamFilter(ts.value);
    const opt=(parent,value,text,disabled=false)=>{ const o=document.createElement('option'); o.value=value; o.textContent=text; o.disabled=disabled; parent.appendChild(o); return o; };
    const byGameOrder=(a,b)=>gameOrder.indexOf(a)-gameOrder.indexOf(b);
    const roster=this.rosterAll;

    // Games: narrowed by team (and its era) and position.
    const gameCounts=new Map();
    for(const p of roster) if((!tfTeam||p.team===tfTeam)&&(!tfGame||p.game===tfGame)&&(!pf||p.position===pf)) gameCounts.set(p.game,(gameCounts.get(p.game)||0)+1);
    gs.innerHTML=''; opt(gs,'','All games');
    [...gameCounts.keys()].sort(byGameOrder).forEach(g=>opt(gs,g,`${g} (${gameCounts.get(g)})`));
    gs.value=gameCounts.has(gf)?gf:'';
    const game=gs.value;

    // Teams: narrowed by game and position. With a game picked, eras are
    // implied, so each team is one plain option.
    const byTeam=new Map();
    for(const p of roster){
      if(!p.team||(game&&p.game!==game)||(pf&&p.position!==pf)) continue;
      if(!byTeam.has(p.team)) byTeam.set(p.team,new Map());
      const gm=byTeam.get(p.team); gm.set(p.game,(gm.get(p.game)||0)+1);
    }
    ts.innerHTML=''; opt(ts,'','All teams');
    const values=new Set();
    [...byTeam.keys()].sort((a,b)=>a.localeCompare(b)).forEach(team=>{
      const counts=byTeam.get(team);
      const total=[...counts.values()].reduce((s,n)=>s+n,0);
      const games=[...counts.keys()].sort(byGameOrder);
      values.add(team);
      if(game||games.length<=1){ opt(ts,team,`${team} (${total})`); return; }
      const group=document.createElement('optgroup'); group.label=team;
      opt(group,team,`All eras (${total})`);
      games.forEach(g=>{ opt(group,`${team}::${g}`,`${g} (${counts.get(g)})`); values.add(`${team}::${g}`); });
      ts.appendChild(group);
    });
    const wanted=tfGame&&!game?`${tfTeam}::${tfGame}`:tfTeam;
    ts.value=wanted&&values.has(wanted)?wanted:'';

    // Positions: narrowed by game and team.
    const {team:t2,game:g2}=this._parseTeamFilter(ts.value);
    const posCounts={};
    for(const p of roster) if((!game||p.game===game)&&(!t2||p.team===t2)&&(!g2||p.game===g2)) posCounts[p.position]=(posCounts[p.position]||0)+1;
    [...ps.options].forEach(o=>{
      if(!o.value) return;
      const n=posCounts[o.value]||0;
      o.textContent=`${o.value} (${n})`;
      o.disabled=n===0&&o.value!==pf;
    });
    (this._combos||[]).forEach(c=>c.sync());
  }

  /** Turns a filter <select> into a type-to-search box: typing narrows a
   *  list of suggestions taken from the select's own (already linked and
   *  counted) options, and picking one sets the select and fires its
   *  `change`, so everything wired to the select works as before. The
   *  select stays in the DOM, hidden, as the source of truth. */
  _makeCombobox(select,placeholder){
    const wrap=document.createElement('div'); wrap.className='combo';
    const input=document.createElement('input');
    const list=document.createElement('ul');
    const listId=`${select.id}-list`;
    Object.assign(input,{type:'text',id:`${select.id}-input`,className:'combo-input',placeholder,autocomplete:'off',spellcheck:false});
    input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list');
    input.setAttribute('aria-expanded','false'); input.setAttribute('aria-controls',listId);
    Object.assign(list,{id:listId,className:'combo-list',hidden:true}); list.setAttribute('role','listbox');
    wrap.append(input,list);
    select.parentElement.insertBefore(wrap,select);
    select.classList.add('combo-native');

    const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
    // An era option only makes sense next to its team's name.
    const labelOf=o=>o.parentElement.tagName==='OPTGROUP'?`${o.parentElement.label} · ${o.textContent}`:o.textContent;
    // `typed` is false when the list was opened by focusing or arrowing, so
    // the box's text (the current pick) browses the whole list instead of
    // filtering it down to itself; typing turns it into a search.
    let shown=[], active=-1, typed=false;
    const setActive=i=>{
      active=i;
      [...list.children].forEach((li,j)=>li.classList.toggle('active',j===i));
      const li=list.children[i];
      if(li){ input.setAttribute('aria-activedescendant',li.id); li.scrollIntoView({block:'nearest'}); }
      else input.removeAttribute('aria-activedescendant');
    };
    const render=()=>{
      const q=typed?norm(input.value.trim()):'';
      const opts=[...select.options].map(o=>({value:o.value,label:o.value?labelOf(o):o.textContent,disabled:o.disabled}));
      // "All …" leads the untouched list; once you type, only matches show —
      // names starting with what you typed first, then a word starting with
      // it, then anywhere ("rai" → Raimon before Brainwashing).
      const rank=e=>{ const l=norm(e.label); return l.startsWith(q)?0:new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`).test(l)?1:2; };
      shown=q?opts.filter(e=>e.value&&norm(e.label).includes(q)).map(e=>({e,r:rank(e)})).sort((a,b)=>a.r-b.r).map(x=>x.e).slice(0,50):opts;
      list.replaceChildren(...shown.map((e,i)=>{
        const li=document.createElement('li');
        li.id=`${listId}-${i}`; li.textContent=e.label; li.setAttribute('role','option');
        if(e.disabled){ li.classList.add('disabled'); li.setAttribute('aria-disabled','true'); }
        // Picks on click, not pointerdown: a finger that starts a scroll is
        // never a click, so the list can be dragged without choosing a row.
        li.addEventListener('click',()=>{ if(!e.disabled) pick(e); });
        return li;
      }));
      if(!shown.length){ const li=document.createElement('li'); li.className='combo-empty'; li.textContent='No matches'; list.appendChild(li); }
      setActive(-1);
    };
    const open=()=>{
      render(); list.hidden=false; input.setAttribute('aria-expanded','true');
      // Browsing: land on the current pick, centred, so you see where you
      // are in a long list.
      if(!typed&&select.value){
        const i=shown.findIndex(e=>e.value===select.value);
        if(i>=0){ setActive(i); const li=list.children[i]; list.scrollTop=li.offsetTop-(list.clientHeight-li.offsetHeight)/2; }
      }
    };
    const close=()=>{ list.hidden=true; input.setAttribute('aria-expanded','false'); setActive(-1); };
    const sync=()=>{ const o=select.selectedOptions[0]; input.value=o&&o.value?labelOf(o):''; };
    const pick=e=>{
      close();
      if(select.value!==e.value){ select.value=e.value; select.dispatchEvent(new Event('change')); }
      sync();
    };
    // Pressing in the list (a row, or its scrollbar) must not pull focus off
    // the input, or the blur below would close the list mid-scroll.
    list.addEventListener('mousedown',ev=>ev.preventDefault());
    input.addEventListener('focus',()=>{ typed=false; open(); input.select(); });
    input.addEventListener('input',()=>{ typed=true; open(); });
    input.addEventListener('keydown',ev=>{
      if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){
        ev.preventDefault();
        if(list.hidden){ typed=false; open(); }
        const step=ev.key==='ArrowDown'?1:-1;
        for(let i=active+step;i>=0&&i<shown.length;i+=step) if(!shown[i].disabled){ setActive(i); break; }
      } else if(ev.key==='Enter'){
        ev.preventDefault();
        const e=active>=0?shown[active]:(!input.value.trim()?{value:''}:null);
        if(e) pick(e);
      } else if(ev.key==='Escape'){ sync(); close(); input.blur(); }
    });
    // Leaving the box never turns half-typed text into a filter: it either
    // clears (empty box = "All …") or goes back to what's selected.
    input.addEventListener('blur',()=>{
      if(!input.value.trim()&&select.value) pick({value:''});
      else { sync(); close(); }
    });
    sync();
    return {sync};
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

  /** Rolls a random formation, then fills the XI with five guaranteed
   *  standouts in random slots — one from the top 10 of that slot's
   *  position, two from the top 30, two from the top 40 (see _topNByPosition) —
   *  and ordinary random picks everywhere else, so every roll has real stars
   *  in an otherwise unpredictable squad. A star pool with nobody left for a
   *  role falls back to an ordinary pick, and _fillSquadByPosition-style
   *  backfill means a thin position never leaves a slot empty. */
  _randomize(){
    // Shape first, then fill it position by position — the slot roles depend
    // on the formation, so picking it afterwards would mismatch them.
    this._edSetFormation(Phaser.Utils.Array.GetRandom(Object.keys(FORMATIONS)));
    document.getElementById('formation-select').value=this._edFormation();

    const roles=SLOT_ROLES[this._edFormation()]||SLOT_ROLES[DEFAULT_FORMATION];
    const byPos={};
    for(const p of this.rosterAll) (byPos[p.position]=byPos[p.position]||[]).push(p);
    const top10=this._topNByPosition(this.rosterAll,10), top30=this._topNByPosition(this.rosterAll,30), top40=this._topNByPosition(this.rosterAll,40);
    [byPos,top10,top30,top40].forEach(map=>Object.values(map).forEach(list=>Phaser.Utils.Array.Shuffle(list)));

    // The pools overlap (top 10 ⊂ top 30 ⊂ top 40 ⊂ everyone), so track who's
    // already placed to avoid picking the same person for two slots.
    const used=new Set();
    const take=(map,pos)=>{ const l=map[pos]; while(l&&l.length){ const p=l.pop(); if(!used.has(p.id)){ used.add(p.id); return p.id; } } return null; };
    const takeAny=map=>{ for(const l of Object.values(map)) while(l&&l.length){ const p=l.pop(); if(!used.has(p.id)){ used.add(p.id); return p.id; } } return null; };

    const slots=Array(TEAM_SIZE).fill(null);
    const [top10Slot,...starSlots]=Phaser.Utils.Array.Shuffle([...Array(TEAM_SIZE).keys()]).slice(0,5);
    slots[top10Slot]=take(top10,roles[top10Slot])??take(byPos,roles[top10Slot]);
    for(const i of starSlots.slice(0,2)) slots[i]=take(top30,roles[i])??take(byPos,roles[i]);
    for(const i of starSlots.slice(2,4)) slots[i]=take(top40,roles[i])??take(byPos,roles[i]);
    for(let i=0;i<TEAM_SIZE;i++) if(!slots[i]) slots[i]=take(byPos,roles[i]);
    for(let i=0;i<TEAM_SIZE;i++) if(!slots[i]) slots[i]=takeAny(byPos);
    this._edSetSlots(slots);
    this._edSetBench(new Set(BENCH_COVER.map(pos=>take(byPos,pos)??takeAny(byPos)).filter(Boolean)));

    this._squadSel=null; this._pickPosFilter=null;
    this._renderPitch(); this._renderPickList();
  }

  _confirmSquad(){
    const starterIds=this.squadSlots.filter(Boolean); if(starterIds.length!==TEAM_SIZE) return;
    const payload={starterIds,benchIds:[...this.benchIds],formation:this.chosenFormation,color:this.myTeamColor,name:this._myTeamName()};
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
   *  picker — same grouping _refreshFilterOptions uses for the squad editor's
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
    this._rivalName=this._entrantLabel(entrantId);
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
    // Half length is picked once, in the editor this squad was just built
    // in, and rides along with the tournament: every fixture ends in a page
    // reload (see _returnToMenu) that would otherwise reset it to the default.
    this.activeTournament={...built,mySquad,halfLengthS:this.halfLengthS};
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
    if(this.activeTournament.halfLengthS){
      this.halfLengthS=this.activeTournament.halfLengthS;
      this.matchClock.secondsRemaining=this.halfLengthS;
      this._renderClock(this.matchClock);
    }
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
          <div style="font-size:11px;opacity:.7;margin-bottom:10px;text-align:center;">Next, build your squad and pick the half length — both lock in for the whole tournament once it starts. Opponents are drawn at random from the game's real teams; in a knockout they get tougher each round you win, a league stays one flat difficulty throughout.</div>
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
      <div style="font-size:11px;opacity:.7;margin-bottom:10px;">Your squad: ${t.mySquad?.formation||'?'}${t.halfLengthS?` · ${Math.round(t.halfLengthS/60)} min halves`:''} (locked for this tournament)</div>`;
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
    this._setScoreboardNames(payloadA.name||'You',payloadB.name||(this.uiMode==='multiplayer'?'Opponent':'Rival'));
    this.matchStats=this._newMatchStats();
    // Kept for "Rematch" (see _rematch), which rebuilds this exact match
    // after the reload full time ends in.
    this._lastMatchPayloads={a:payloadA,b:payloadB};
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
    this._setScoreboardNames(this.remoteSquadPayload.name||'Opponent',this.mySquadPayload.name||'You');
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
    // GK never leaves their line, but slides along it after the ball to
    // cover the near post (which is what makes aiming a shot matter).
    if(slot===0){ yBias=0; secondary=sSize/2+Phaser.Math.Clamp((ballPos.x-sSize/2)*KEEPER_TRACK,-KEEPER_TRACK_MAX,KEEPER_TRACK_MAX); }

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
   *  drift to. Keeps the formation shape as a base; with the ball it blends
   *  in a supporting run and holds the wings wide, without it it follows the
   *  side's defensive plan (one presser, markers on runners — see
   *  _defensivePlan). Either way it then keeps clear of teammates. Applies
   *  to both the human team's teammates and the AI team's players.
   *  `defPlan` is normally computed once per side per frame by _moveTeam. */
  _offBallTarget(role,e,activeId,iHaveBall,ballCarrier,defPlan=null){
    const base=this._formPos(role,e.slot,this.ball.position);
    if(e.slot===0||e.id===activeId) return base; // keeper & the on-ball player keep plain formation logic

    let target=base, pressing=false;
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
        // Stepping only part of the way up to the carrier's line keeps each
        // supporter's own depth, instead of the whole side converging on one
        // row just ahead of the ball.
        target={
          x:Phaser.Math.Linear(base.x,base.x+side*70,SUPPORT_BLEND),
          y:Phaser.Math.Linear(base.y,carrier.body.position.y+attackDir*130,SUPPORT_Y_BLEND)
        };
      }
      target=this._holdWidth(role,e,target);
    } else if(ballCarrier){
      const job=(defPlan||this._defensivePlan(role,activeId,ballCarrier)).get(e.id);
      if(job){
        pressing=job.blend===1;
        target={x:Phaser.Math.Linear(base.x,job.x,job.blend),y:Phaser.Math.Linear(base.y,job.y,job.blend)};
      }
    }
    target=this._applyWander(e,target,iHaveBall);
    // The presser is meant to end up right next to the ball, alongside the
    // active teammate chasing it, so spacing would only pull them off it.
    return pressing?target:this._applySpacing(role,e,target);
  }

  /** In possession, wide slots stretch the play toward their touchline;
   *  central ones are left alone. */
  _holdWidth(role,e,target){
    const f=(FORMATIONS[this.formation[role]]||FORMATIONS[DEFAULT_FORMATION])[e.slot];
    if(!f||(f.x>=WING_SLOT_X&&f.x<=1-WING_SLOT_X)) return target;
    const lineX=f.x<0.5?this.FIELD_W*WING_TOUCHLINE_GAP:this.FIELD_W*(1-WING_TOUCHLINE_GAP);
    return {x:Phaser.Math.Linear(target.x,lineX,WING_BLEND),y:target.y};
  }

  /** Who does what off the ball while `role` defends against `carrier`:
   *  a Map of player id -> {x,y,blend} for the one presser and the markers
   *  (everyone else just holds formation). Anchored on formation spots and
   *  live opponent positions only, never on the defenders' own drifted
   *  positions, so it can't feed back into itself frame to frame. */
  _defensivePlan(role,activeId,carrier){
    const jobs=new Map();
    if(!carrier?.body) return jobs;
    const oppRole=role==='A'?'B':'A';
    const team=role==='A'?this.teamA:this.teamB, oppTeam=oppRole==='A'?this.teamA:this.teamB;
    const ownGoalY=role==='A'?this.FIELD_H:0;
    const now=this.time.now, cp=carrier.body.position, bp=this.ball.position;
    const goalSide=y=>Math.sign(ownGoalY-y)||1;
    const eligible=team.filter(e=>e.slot!==0&&e.id!==activeId&&e.body&&!this._isOut(role,e.id)&&!this._isStunned(e.id,now));

    // The AI rival's defence is tuned by difficulty; everyone else (your
    // teammates, either side in multiplayer) gets the defaults.
    const lvl=(role==='B'&&!this.net.hasPeer())?this._aiParams():{};
    const pressRange=lvl.press??PRESS_ENGAGE_RANGE, markRange=lvl.markRange??MARK_RANGE, markBlend=lvl.markBlend??MARK_BLEND;
    let presser=null, pressD=pressRange;
    for(const e of eligible){
      const d=Phaser.Math.Distance.Between(e.body.position.x,e.body.position.y,cp.x,cp.y);
      if(d<pressD){ pressD=d; presser=e; }
    }
    if(presser) jobs.set(presser.id,{x:cp.x,y:cp.y+goalSide(cp.y)*PRESS_GOAL_SIDE,blend:1});

    const roles=SLOT_ROLES[this.formation[role]]||SLOT_ROLES[DEFAULT_FORMATION];
    const markers=eligible.filter(e=>e!==presser&&roles[e.slot]!=='FW');
    const runners=oppTeam.filter(o=>o.slot!==0&&o.id!==carrier.id&&o.body&&!this._isOut(oppRole,o.id));
    const ballGoalDist=Math.abs(ownGoalY-bp.y);
    const pairs=[];
    for(const m of markers){
      const home=this._formPos(role,m.slot,bp);
      for(const r of runners){
        const rp=r.body.position;
        const d=Phaser.Math.Distance.Between(home.x,home.y,rp.x,rp.y);
        if(d>markRange) continue;
        const dangerous=Math.abs(ownGoalY-rp.y)<ballGoalDist;
        pairs.push({m,r,cost:d-(dangerous?MARK_DANGER_BONUS:0)});
      }
    }
    pairs.sort((a,b)=>a.cost-b.cost);
    const takenM=new Set(), takenR=new Set();
    for(const {m,r} of pairs){
      if(takenM.has(m.id)||takenR.has(r.id)) continue;
      takenM.add(m.id); takenR.add(r.id);
      const rp=r.body.position;
      // Leaning toward the ball only sideways: shifting along the pitch too
      // would drag the marker behind a runner who is deeper than the ball.
      jobs.set(m.id,{
        x:rp.x+(bp.x-rp.x)*MARK_BALL_SHIFT,
        y:rp.y+goalSide(rp.y)*MARK_GOAL_SIDE,
        blend:markBlend,
        runnerId:r.id
      });
    }
    return jobs;
  }

  /** Pushes an off-ball target out of any teammate's personal space, so the
   *  side spreads across the pitch instead of knotting up. */
  _applySpacing(role,e,target){
    const team=role==='A'?this.teamA:this.teamB;
    let x=target.x, y=target.y;
    for(const t of team){
      if(t===e||!t.body||this._isOut(role,t.id)) continue;
      const dx=x-t.body.position.x, dy=y-t.body.position.y, d=Math.hypot(dx,dy);
      if(d>=SPACING_MIN) continue;
      // Exactly on top of each other: split by slot so the two don't both
      // pick the same direction.
      const ux=d>0.5?dx/d:(e.slot<t.slot?-1:1), uy=d>0.5?dy/d:0;
      const push=(SPACING_MIN-d)*SPACING_PUSH;
      x+=ux*push; y+=uy*push;
    }
    return {x:Phaser.Math.Clamp(x,30,this.FIELD_W-30),y:Phaser.Math.Clamp(y,40,this.FIELD_H-40)};
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
    // A tap in the goal area shoots: play freezes in the strike stage (see
    // _startShot), where further goal taps move the aim before the shot is
    // picked.
    if(this._inGoalRegion(w)){
      const c=this.confrontation;
      if(this._iHavePossession()&&!c){ this.pendingShoot=this._clampAim(this.role,w.x); return; }
      if(c?.type==='strike'&&c.attackerRole===this.role&&!c.reveal){ this.pendingShotAim=this._clampAim(this.role,w.x); return; }
    }
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
    this._drawShotPreview();
  }

  /** The shooting area while you have the ball and, while a shot is being
   *  lined up or played out (the synced shotLine), a cone from the kicker to
   *  the aimed spot — drawn as a cone, judged along its centre line — with
   *  the would-be blocker ringed red, a teammate who can chain ringed gold
   *  (dimmed without the PT) and the keeper ringed green → red by reach. */
  _drawShotPreview(){
    const g=this.pathGfx, c=this.confrontation;
    if(!c?.shotLine){
      if(this._iHavePossession()&&!c){
        const goalY=this.role==='A'?0:this.FIELD_H;
        g.fillStyle(0xffe066,0.12);
        g.fillRect(this.FIELD_W/2-GOAL_HALF_WIDTH,this.role==='A'?goalY:goalY-GOAL_CLICK_MARGIN,GOAL_HALF_WIDTH*2,GOAL_CLICK_MARGIN);
      }
      return;
    }
    const {from,to}=c.shotLine;
    const path=this._shotPath(c.attackerRole,from,to);
    const reach=path.keeper?.reach??0;
    const reachColor=reach>0.66?0xff4d4d:reach>0.33?0xffb84d:0x5dff7a;
    g.fillStyle(0xffffff,0.16);
    g.fillTriangle(from.x,from.y,to.x-SHOT_CONE_HALF,to.y,to.x+SHOT_CONE_HALF,to.y);
    g.lineStyle(1.5,0xffffff,0.7);
    g.strokeTriangle(from.x,from.y,to.x-SHOT_CONE_HALF,to.y,to.x+SHOT_CONE_HALF,to.y);
    g.lineStyle(3,reachColor,1); g.strokeCircle(to.x,to.y,8);
    if(path.blocker){ const p=this._posOf(path.blocker.entry); g.lineStyle(3,0xff4d4d,1); g.strokeCircle(p.x,p.y,19); }
    if(path.chainer){ const p=this._posOf(path.chainer.entry); g.lineStyle(3,0xffd23f,path.chainer.canChain?1:0.35); g.strokeCircle(p.x,p.y,19); }
    if(path.keeper){ const p=this._posOf(path.keeper.entry); g.lineStyle(3,reachColor,0.9); g.strokeCircle(p.x,p.y,19); }
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
    return this._nearestOpponentDistTo(role,entry.body.position.x,entry.body.position.y);
  }
  /** Closest opponent of `role` to an arbitrary point on the pitch. */
  _nearestOpponentDistTo(role,x,y){
    let best=Infinity;
    for(const o of this._liveOpponents(role)){
      const d=Phaser.Math.Distance.Between(x,y,o.body.position.x,o.body.position.y);
      if(d<best) best=d;
    }
    return best;
  }
  _liveOpponents(role){
    const oppRole=role==='A'?'B':'A';
    return (oppRole==='A'?this.teamA:this.teamB).filter(o=>o.body&&!this._isOut(oppRole,o.id));
  }

  /** The AI keeps a ball it has just won or received for a beat before
   *  passing it on, instead of moving it on the instant it arrives. */
  _aiMayPass(e,now){
    if(this._aiHoldId!==e.id){ this._aiHoldId=e.id; this._aiHoldSince=now; }
    return now-this._aiHoldSince>=AI_PASS_COOLDOWN_MS;
  }

  /** Where the AI ball carrier dribbles: toward goal down whichever lane
   *  across the width has the most open grass just ahead (so it goes round
   *  your players, and uses the wings when the middle is shut), then cuts
   *  inside once it's close enough to set up the shot. */
  _aiCarrierTarget(e){
    const pos=e.body.position, goalY=this.FIELD_H;
    if(goalY-pos.y<this._aiParams().shootRange+AI_CUT_IN_EXTRA) return {x:this.FIELD_W/2,y:goalY};
    const aheadY=Math.min(pos.y+AI_LANE_AHEAD,goalY-40);
    let bestX=pos.x, bestScore=-Infinity;
    for(const f of AI_LANES){
      const x=f*this.FIELD_W;
      let score=Math.min(this._nearestOpponentDistTo('B',x,aheadY),AI_LANE_OPEN_CAP)-Math.abs(x-pos.x)*AI_LANE_SHIFT_COST;
      if(this._aiLaneX===x) score+=AI_LANE_STICKY;
      if(score>bestScore){ bestScore=score; bestX=x; }
    }
    this._aiLaneX=bestX;
    return {x:bestX,y:aheadY+AI_LANE_AHEAD};
  }

  /** True if any of `role`'s opponents gets to the rolling part of a pass
   *  from `from` to `to` before the ball does (and before `receiver` does).
   *  The chipped first stretch (PASS_LOFT_FRAC) sails over everyone. */
  _passIntercepted(role,from,to,receiver){
    const dx=to.x-from.x, dy=to.y-from.y, len=Math.hypot(dx,dy)||1;
    const rp=receiver.body.position;
    for(const o of this._liveOpponents(role)){
      const op=o.body.position;
      for(let t=PASS_LOFT_FRAC*0.9;t<=1.0001;t+=0.1){
        const px=from.x+dx*t, py=from.y+dy*t;
        const dO=Math.hypot(op.x-px,op.y-py);
        if(dO-INTERCEPT_REACH<t*len*INTERCEPT_SPEED_RATIO&&dO<Math.hypot(rp.x-px,rp.y-py)) return true;
      }
    }
    return false;
  }

  /** The AI's pass choice, read off where the opponent's players are:
   *  - a pass one of them can cut out, or to a receiver they're standing on,
   *    is never played;
   *  - further forward is better, more so for each opponent the pass takes
   *    out of the game, and switching to a far wing away from where they're
   *    bunched earns a bonus;
   *  - an onside runner near the opponent's back line can be found with a
   *    through ball into the space behind it.
   *  Returns {x,y,entry,bypassed,through} (x/y is where to aim) or null. */
  _aiPickPassTarget(role,entry){
    const team=role==='A'?this.teamA:this.teamB;
    const attackDir=role==='A'?-1:1; // A attacks decreasing y (their goal is at the bottom), B increasing y
    const p=this._aiParams();
    const from=entry.body.position;
    const opps=this._liveOpponents(role);
    const goalDist=y=>this._distToGoal(y,role);
    // Opponents between a spot and the goal it attacks: in front of it and
    // not too far off to the side.
    const ahead=pt=>opps.filter(o=>goalDist(o.body.position.y)<goalDist(pt.y)&&Math.abs(o.body.position.x-pt.x)<BYPASS_CORRIDOR).length;
    const oppCentreX=opps.reduce((s,o)=>s+o.body.position.x,0)/(opps.length||1);
    const passerAhead=ahead(from);
    const lineDist=this._offsideLineDist(role,from.y);
    const tryThrough=lineDist!=null&&Math.random()<(p.through??0);
    const maxDist=PASS_MAX_DIST+(p.vision??0);

    const score=(c,to,through)=>{
      const dist=Math.hypot(to.x-from.x,to.y-from.y);
      if(dist<50||dist>maxDist) return null; // too close to bother, too far to pick out
      if(this._passIntercepted(role,from,to,c)) return null;
      const bypassed=Math.max(0,passerAhead-ahead(to));
      const openness=Math.min(this._nearestOpponentDistTo(role,to.x,to.y),200);
      const wide=to.x<this.FIELD_W*WING_SLOT_X||to.x>this.FIELD_W*(1-WING_SLOT_X);
      const switchBonus=wide?PASS_SWITCH_BONUS*Math.min(1,Math.abs(to.x-oppCentreX)/(this.FIELD_W/2)):0;
      const s=(to.y-from.y)*attackDir-dist*0.15+openness*0.4+bypassed*PASS_BYPASS_BONUS+switchBonus+(through?THROUGH_BALL_BONUS:0);
      return {x:to.x,y:to.y,entry:c,bypassed,through,score:s};
    };

    let best=null;
    for(const c of team){
      if(c.id===entry.id||c.slot===0||!c.body||this._isOut(role,c.id)) continue; // not myself, not the keeper
      const cp=c.body.position;
      if(this._nearestOpponentDistTo(role,cp.x,cp.y)<RECEIVER_MARKED_DIST) continue;
      const options=[score(c,{x:cp.x,y:cp.y},false)];
      if(tryThrough){
        const gap=goalDist(cp.y)-lineDist;
        if(gap>=0&&gap<=THROUGH_BALL_NEAR_LINE){
          const lead={x:cp.x,y:Phaser.Math.Clamp(cp.y+attackDir*THROUGH_BALL_LEAD,40,this.FIELD_H-40)};
          if(goalDist(lead.y)<lineDist&&this._nearestOpponentDistTo(role,lead.x,lead.y)>THROUGH_BALL_SPACE) options.push(score(c,lead,true));
        }
      }
      for(const o of options) if(o&&(!best||o.score>best.score)) best=o;
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
  /** Shots run as a sequence (see _startShot); `opts.target` is where in the
   *  goal it's aimed, `opts.noPath` skips blockers and chainers (penalties). */
  _startConfront(type,aRole,dRole,now,opts={}){
    if(type==='shot'){ this._startShot(aRole,dRole,now,opts); return; }
    const aId=aRole==='A'?this.activeIdA:this.activeIdB;
    const dId=dRole==='A'?this.activeIdA:this.activeIdB;
    this.confrontation={type,attackerRole:aRole,defenderRole:dRole,attackerId:aId,defenderId:dId,deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:null};
  }

  _posOf(e){ return e.body?e.body.position:e.gfx; }
  /** A point on the goal line `role` attacks, with x kept inside the mouth. */
  _clampAim(role,x){
    const lim=GOAL_HALF_WIDTH-GOAL_AIM_INSET, c=this.FIELD_W/2;
    return {x:Phaser.Math.Clamp(x,c-lim,c+lim),y:role==='A'?0:this.FIELD_H};
  }
  /** What's on a shot's line from `from` to `target`, for the attacking side
   *  `aRole`: the defender who'd block it (nearest the line), the first
   *  teammate who could chain onto it, and how well the keeper reaches it.
   *  Positions come from the body on the host and the drawn sprite on a
   *  client, so the preview works on both. The kicker themselves sits at
   *  the start of the line, outside the 12%-92% stretch, so never counts. */
  _shotPath(aRole,from,target){
    const dRole=aRole==='A'?'B':'A';
    const dx=target.x-from.x, dy=target.y-from.y, lenSq=dx*dx+dy*dy||1;
    const now=this.time.now;
    const along=p=>{
      const t=((p.x-from.x)*dx+(p.y-from.y)*dy)/lenSq;
      return {t,d:Math.hypot(p.x-(from.x+dx*t),p.y-(from.y+dy*t))};
    };
    const onLine=(role,team,gkId,corridor)=>team
      .filter(e=>e.id!==gkId&&(e.body||e.gfx)&&!this._isOut(role,e.id)&&!this._isStunned(e.id,now))
      .map(e=>({entry:e,...along(this._posOf(e))}))
      .filter(o=>o.t>SHOT_PATH_T_MIN&&o.t<SHOT_PATH_T_MAX&&o.d<corridor);
    const blockers=onLine(dRole,dRole==='A'?this.teamA:this.teamB,dRole==='A'?this.gkIdA:this.gkIdB,BLOCK_CORRIDOR_HALF);
    const chainers=onLine(aRole,aRole==='A'?this.teamA:this.teamB,aRole==='A'?this.gkIdA:this.gkIdB,CHAIN_CORRIDOR_HALF);
    const blocker=blockers.sort((a,b)=>a.d-b.d)[0]||null;
    const chainer=chainers.sort((a,b)=>a.t-b.t)[0]||null;
    if(chainer){ const st=this._statsFor(aRole,chainer.entry.id); chainer.canChain=!!st&&canActivate(st,'shot'); }
    const gk=this._entryById(dRole,dRole==='A'?this.gkIdA:this.gkIdB);
    return {blocker,chainer,keeper:gk?{entry:gk,reach:this._keeperReach(dRole,from,target)}:null};
  }
  /** 0..1: how well `dRole`'s keeper covers a shot from `from` to `target`.
   *  0 if they're behind the kicker (dribbled past), stunned or sent off. */
  _keeperReach(dRole,from,target){
    const gk=this._entryById(dRole,dRole==='A'?this.gkIdA:this.gkIdB);
    if(!gk||this._isOut(dRole,gk.id)||this._isStunned(gk.id,this.time.now)) return 0;
    const p=this._posOf(gk);
    const dx=target.x-from.x, dy=target.y-from.y, lenSq=dx*dx+dy*dy||1;
    const t=((p.x-from.x)*dx+(p.y-from.y)*dy)/lenSq;
    if(t<=0) return 0;
    const tc=Math.min(t,1);
    const d=Math.hypot(p.x-(from.x+dx*tc),p.y-(from.y+dy*tc));
    return Phaser.Math.Clamp(1-(d-KEEPER_REACH_FULL)/(KEEPER_REACH_MAX-KEEPER_REACH_FULL),0,1);
  }

  /** A shot starts with a solo 'strike' stage: play is frozen while the
   *  shooter moves their aim along the goal (see _setShotAim) and picks a
   *  technique or a normal shot. Only once that's fired is the line worked
   *  out and the rest of the sequence built, in the order the ball meets
   *  things: a blocker and/or one chaining teammate, then the keeper. The
   *  shot's power (shotSeq.power) is set by the shooter's pick and grows
   *  with each chain; a beaten blocker trims it. `opts.noPath` (penalties)
   *  goes straight from the strike to the keeper. */
  _startShot(aRole,dRole,now,opts={}){
    const eAtk=this._activeEntry(aRole); if(!eAtk?.body) return;
    const target=this._clampAim(aRole,opts.target?opts.target.x:this.FIELD_W/2);
    const from={x:eAtk.body.position.x,y:eAtk.body.position.y};
    this.shotSeq={aRole,dRole,target,from,noPath:!!opts.noPath,stages:[],idx:0,power:null,names:[],kickerId:eAtk.id,shooterId:eAtk.id};
    this._stat(aRole,'shots');
    this.confrontation={type:'strike',solo:true,attackerRole:aRole,defenderRole:dRole,attackerId:eAtk.id,defenderId:null,
      deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:'none',shotLine:{from:{...from},to:{...target}}};
  }
  /** Moves the aim of `role`'s shot while they're still lining it up. */
  _setShotAim(role,point){
    const c=this.confrontation, seq=this.shotSeq;
    if(c?.type!=='strike'||c.attackerRole!==role||!seq||!point) return;
    seq.target=this._clampAim(role,point.x);
    c.shotLine={from:{...seq.from},to:{...seq.target}};
  }
  _buildShotStages(seq){
    const stages=[];
    if(!seq.noPath){
      const path=this._shotPath(seq.aRole,seq.from,seq.target);
      if(path.blocker) stages.push({kind:'block',id:path.blocker.entry.id,t:path.blocker.t});
      if(path.chainer?.canChain) stages.push({kind:'chain',id:path.chainer.entry.id,t:path.chainer.t});
      stages.sort((a,b)=>a.t-b.t);
    }
    stages.push({kind:'keeper'});
    return stages;
  }
  _nextShotStage(now){
    const seq=this.shotSeq, st=seq?.stages[seq.idx];
    if(!st){ this.confrontation=null; this.shotSeq=null; return; }
    const base={attackerRole:seq.aRole,defenderRole:seq.dRole,deadline:now+CONFRONT_MS,attackerChoice:null,defenderChoice:null,
      shotLine:{from:{...seq.from},to:{...seq.target}}};
    // The shooter already committed in the strike, so they're locked from here.
    if(st.kind==='chain'){
      this.confrontation={...base,type:'chain',solo:true,attackerId:st.id,defenderId:null,defenderChoice:'none'};
    } else if(st.kind==='block'){
      this.confrontation={...base,type:'block',attackerId:seq.kickerId,defenderId:st.id,attackerChoice:'normal',attackerLocked:true};
    } else {
      this._stat(seq.aRole,'onTarget');
      const reach=this._keeperReach(seq.dRole,seq.from,seq.target);
      if(reach<=0){ this._shotGoesIn(now,'into the empty net'); return; }
      const gkId=seq.dRole==='A'?this.gkIdA:this.gkIdB;
      this.confrontation={...base,type:'shot',attackerId:seq.kickerId,defenderId:gkId,attackerChoice:'normal',attackerLocked:true,keeperReach:reach};
    }
  }
  /** One kick's contribution to a shot's power: technique (or a plain shot,
   *  for the shooter only), the kicker's shooting stat, how far out they are,
   *  and the AI's difficulty bonus. */
  _kickPower(role,id,tech){
    const st=this._statsFor(role,id), e=this._entryById(role,id);
    if(!st||!e) return 0;
    const dist=Math.abs((role==='A'?0:this.FIELD_H)-this._posOf(e).y);
    return (tech?tech.power:NORMAL_ACTION_POWER)*Math.pow(st[STAT_FIELD_FOR_TECH.shot],STAT_POWER_EXPONENT)*this._shotPowerMul(dist)*this._aiStatMul(role);
  }
  _shotMoveName(){
    const used=(this.shotSeq?.names||[]).filter(n=>n!=='Normal');
    return used.length?used.join(' + '):'Normal';
  }
  /** Resolves a solo strike/chain pick and moves the shot on. */
  _resolveSoloStage(now){
    const c=this.confrontation, seq=this.shotSeq;
    if(!seq){ this.confrontation=null; return; }
    const st=this._statsFor(c.attackerRole,c.attackerId), e=this._entryById(c.attackerRole,c.attackerId);
    const tech=st?this._tryTech(st,'shot',c.attackerChoice):null;
    if(tech){ this._stat(c.attackerRole,'techs'); seq.techMax=Math.max(seq.techMax||0,tech.power); }
    const name=st?.name||'';
    let title, fxTech=tech;
    if(c.type==='strike'){
      playKick();
      seq.power=this._kickPower(c.attackerRole,c.attackerId,tech);
      seq.names.push(tech?tech.name:'Normal');
      // The keeper still has to pick blind, so the technique isn't named
      // (or flashed) until the VS card.
      title=`${name} shoots!`; fxTech=null;
      seq.stages=this._buildShotStages(seq); seq.idx=-1;
    } else if(tech){
      seq.power+=this._kickPower(c.attackerRole,c.attackerId,tech);
      seq.names.push(tech.name);
      seq.kickerId=c.attackerId;
      if(e){ const p=this._posOf(e); seq.from={x:p.x,y:p.y}; }
      title=`${name} chains it with ${tech.name}!`;
    } else title=`${name} lets it run`;
    const fx=fxTech&&e?{a:{x:this._posOf(e).x,y:this._posOf(e).y,color:c.attackerRole==='A'?this.teamColorA:this.teamColorB,name:fxTech.name,el:st?.element||null,power:fxTech.power},d:null}:null;
    this.confrontResult={title,outcome:'',until:now+1200,outcomeAt:now+RESULT_DELAY_MS,fx};
    this.confrontation=null;
    seq.idx++;
    this._nextShotStage(now);
  }
  _shotGoesIn(now,how){
    const seq=this.shotSeq;
    const name=this._statsFor(seq.aRole,seq.kickerId)?.name||'';
    this.confrontation=null; this.shotSeq=null;
    this._recordGoal(seq.aRole,seq.kickerId);
    this._onGoal(seq.aRole==='A'?'a':'b');
    this.confrontResult={title:`⚽ GOAL! ${name} puts it ${how}! (${this.score.a} - ${this.score.b})`,outcome:'',until:now+RESULT_MS,outcomeAt:now+RESULT_DELAY_MS,
      fx:{a:null,d:null,goal:{color:seq.aRole==='A'?this.teamColorA:this.teamColorB}}};
  }
  /** Where the AI aims: the spot in the goal mouth its keeper covers worst,
   *  steering clear of a blocker and toward a teammate who can chain —
   *  or, missing its aimSkill roll, anywhere in the goal. */
  _aiPickShotAim(){
    const e=this._activeEntry('B'); if(!e?.body) return null;
    const from=e.body.position, lim=GOAL_HALF_WIDTH-GOAL_AIM_INSET, c=this.FIELD_W/2;
    const xs=[...Array(7).keys()].map(i=>c-lim+(2*lim)*i/6);
    if(Math.random()>=(this._aiParams().aimSkill??1)) return this._clampAim('B',Phaser.Utils.Array.GetRandom(xs));
    let best=null, bestScore=-Infinity;
    for(const x of xs){
      const target=this._clampAim('B',x), path=this._shotPath('B',from,target);
      const score=(1-(path.keeper?.reach??0))*100-(path.blocker?40:0)+(path.chainer?.canChain?25:0);
      if(score>bestScore){ bestScore=score; best=target; }
    }
    return best;
  }
  /** Full power up close, easing down to a floor at long range. */
  _shotPowerMul(dist){
    if(dist<=SHOT_FALLOFF_NEAR) return 1;
    if(dist>=SHOT_FALLOFF_FAR) return SHOT_FALLOFF_MIN;
    const t=(dist-SHOT_FALLOFF_NEAR)/(SHOT_FALLOFF_FAR-SHOT_FALLOFF_NEAR);
    return 1-t*(1-SHOT_FALLOFF_MIN);
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
    if(type==='chain') return 'Let it run';
    return isAttacker?'Normal shot':'Normal save'; // 'shot' and the solo 'strike'
  }
  _statsFor(role,id){ return (role==='A'?this.statsMapA:this.statsMapB).get(id); }

  _entryById(role,id){ const team=role==='A'?this.teamA:this.teamB; return team.find(t=>t.id===id)||null; }

  /** Rolls the outcome and puts the confrontation into its reveal beat: both
   *  moves are shown facing each other, then the winner lights up, and only
   *  after that does _applyConfrontOutcome actually move anything. Play is
   *  already frozen while a confrontation is live, so this reads as a pause. */
  _prepareConfrontReveal(now){
    const c=this.confrontation;
    if(c.solo){ this._resolveSoloStage(now); return; }
    const as=this._statsFor(c.attackerRole,c.attackerId), ds=this._statsFor(c.defenderRole,c.defenderId);
    if(!as||!ds){this.confrontation=null;this.shotSeq=null;return;}
    const atk=c.type==='duel'?'dribble':'shot';
    const def=c.type==='shot'?'keeper':'defense'; // duel and block both face a 'defense' roll
    const seq=(c.type==='shot'||c.type==='block')?this.shotSeq:null;
    // In a shot the shooter already picked (and paid) in the strike stage;
    // block and keeper stages face the accumulated seq.power.
    const aTech=seq?null:this._tryTech(as,atk,c.attackerChoice);
    const dTech=this._tryTech(ds,def,c.defenderChoice);
    if(aTech) this._stat(c.attackerRole,'techs');
    if(dTech) this._stat(c.defenderRole,'techs');
    // Elemental edge — only one side can hold it, and only when both players
    // have a known element (the roster doesn't have one for everyone).
    const elEdge=this._elementEdge(as.element,ds.element);
    const aP=(seq
      ? seq.power
      : (aTech?aTech.power:NORMAL_ACTION_POWER)*Math.pow(as[STAT_FIELD_FOR_TECH[atk]],STAT_POWER_EXPONENT)*this._aiStatMul(c.attackerRole)
    )*(elEdge>0?ELEMENT_EDGE:1);
    // A keeper only saves what they can reach (see _keeperReach).
    const dP=(dTech?dTech.power:NORMAL_ACTION_POWER)*Math.pow(ds[STAT_FIELD_FOR_TECH[def]],STAT_POWER_EXPONENT)*(elEdge<0?ELEMENT_EDGE:1)
      *this._aiStatMul(c.defenderRole)*(c.type==='shot'?(c.keeperReach??1):1);
    // Blocking a shot takes a real supertechnique — a normal challenge can't
    // stop it, only soften what happens after (see BLOCK_PASS_PENALTY).
    const aWins=(c.type==='block'&&!dTech)?true:Math.random()<aP/(aP+dP);
    const aTN=seq?this._shotMoveName():(aTech?aTech.name:'Normal'), dTN=dTech?dTech.name:'Normal';
    // Visual flourish data for whoever actually used a supertechnique —
    // rendered identically on host and client from the synced result.
    const eAtk=this._entryById(c.attackerRole,c.attackerId), eDef=this._entryById(c.defenderRole,c.defenderId);
    // A shot's own technique was kept hidden at the strike, so it bursts at
    // the first face-off of the sequence (a block or the keeper), once.
    const shotFx=seq&&!seq.fxShown&&aTN!=='Normal'&&eAtk;
    if(shotFx) seq.fxShown=true;
    const fx={
      a: (aTech||shotFx)&&eAtk ? {x:eAtk.body.position.x,y:eAtk.body.position.y,color:c.attackerRole==='A'?this.teamColorA:this.teamColorB,name:aTN,el:as.element||null,power:aTech?aTech.power:(seq?.techMax||0)} : null,
      d: dTech&&eDef ? {x:eDef.body.position.x,y:eDef.body.position.y,color:c.defenderRole==='A'?this.teamColorA:this.teamColorB,name:dTN,el:ds.element||null,power:dTech.power} : null
    };
    c.pending={aWins,aTN,dTN,fx,aName:as.name,dName:ds.name};
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
    const {aWins,aTN,dTN,aName,dName}=r;
    let fx=r.fx;
    let title,outcome=`${aName}: ${aTN} · ${dName}: ${dTN}`;
    if(c.type==='duel'){
      const eA=this._activeEntry(c.attackerRole), eD=this._activeEntry(c.defenderRole);
      this._stat(aWins?c.attackerRole:c.defenderRole,'duelsWon',1,aWins?c.attackerId:c.defenderId);
      if(aWins){ this._knockback(eD,eA); this.stunMap.set(c.defenderId,now+STUN_MS); title=`${aName} dribbles past!`; }
      else { this.possRole=c.defenderRole; this._setActive(c.defenderRole,c.defenderId); this._knockback(eA,eD); this.stunMap.set(c.attackerId,now+STUN_MS); title=`${dName} wins the ball!`; }
      this.duelLockUntil=now+STUN_MS+200;
    } else if(c.type==='block'){
      if(aWins&&this.shotSeq){
        // Grazed past the wall — the shot is still on, just weaker for it,
        // and carries on to whatever's next along its line.
        this.confrontation=null;
        this.confrontResult={title:`${aName} gets the shot away past ${dName}!`,outcome,until:now+1200,outcomeAt:now+RESULT_DELAY_MS,fx};
        this.shotSeq.power*=BLOCK_PASS_PENALTY;
        this.shotSeq.idx++;
        this._nextShotStage(now);
        return;
      }
      this.shotSeq=null;
      this._stat(c.defenderRole,'blocks',1,c.defenderId);
      // Blocked clean: the ball pops loose at the blocker's feet, turnover.
      // Look them up by the id the confrontation actually names — they
      // aren't necessarily who was "active" for the team before this.
      const eD=this._entryById(c.defenderRole,c.defenderId);
      this.possRole=c.defenderRole;
      this._setActive(c.defenderRole,c.defenderId);
      if(eD?.body){ this.matter.body.setPosition(this.ball,{x:eD.body.position.x,y:eD.body.position.y}); this.matter.body.setVelocity(this.ball,{x:0,y:0}); }
      title=`${dName} blocks the shot!`;
    } else if(aWins){
      this._recordGoal(c.attackerRole,c.attackerId);
      this._onGoal(c.attackerRole==='A'?'a':'b');
      // this.score was just updated by _onGoal, so it already reflects
      // this goal — the banner shows the result, not just who scored.
      title=`⚽ GOAL! ${aName} scores! (${this.score.a} - ${this.score.b})`;
      fx={...(fx||{}),goal:{color:c.attackerRole==='A'?this.teamColorA:this.teamColorB}};
    } else {
      // The keeper (defenderId here, not necessarily whoever was "active"
      // before the shot) made the save — the ball, and possession, are
      // theirs now.
      this.possRole=c.defenderRole;
      this._setActive(c.defenderRole,c.defenderId);
      title=`${dName} saves it!`;
      const eK=this._entryById(c.defenderRole,c.defenderId);
      if(eK?.body) fx={...(fx||{}),save:{x:eK.body.position.x,y:eK.body.position.y}};
      this._stat(c.defenderRole,'saves',1,c.defenderId);
      playGkSave();
    }
    if(c.type==='shot') this.shotSeq=null;
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
      // A golden goal: the celebration is the end of the match.
      if(this.matchClock.overtime){ this.matchClock.ended=true; return; }
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
      this._startConfront('shot',fouledRole,offenderRole,now,{noPath:true}); // a penalty is never walled or chained
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
    // Golden-goal overtime has no clock to run out — it counts up instead,
    // and only a goal ends it (see _onGoal).
    if(this.matchClock.overtime){ this.matchClock.otElapsed+=delta/1000; return; }
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
      else if(this.score.a===this.score.b&&this._tournamentPendingFixture?.kind!=='league') this._startOvertime();
      else { this.matchClock.ended=true; this.matchClock.secondsRemaining=0; }
    }
  }
  /** Level at full time: golden-goal overtime, as long as it takes — the next
   *  goal wins. Not in a league fixture, where a draw is a result that
   *  earns each side a point. Set up like the half-time break: line up,
   *  freeze for a beat, then play on. */
  _startOvertime(){
    Object.assign(this.matchClock,{overtime:true,otElapsed:0,secondsRemaining:0});
    this._kickoff(this.kickoffRole,'Overtime — next goal wins!',HALFTIME_PAUSE_MS);
    this._setPaused(true);
    this.time.delayedCall(HALFTIME_PAUSE_MS,()=>{ this._setPaused(false); this.confrontResult=null; });
  }
  static _fmtClock(s){ s=Math.max(0,Math.ceil(s)); const m=Math.floor(s/60),r=s%60; return `${m}:${r<10?'0':''}${r}`; }
  _renderClock(c){
    if(!c) return;
    document.getElementById('match-clock').textContent=c.ended?'Full time'
      :c.overtime?`Overtime — ${GameScene._fmtClock(c.otElapsed||0)} · golden goal`
      :`${c.half===1?'1st':'2nd'} half — ${GameScene._fmtClock(c.secondsRemaining)}`;
    if(c.ended) this._showFullTime();
  }

  // ---- match report --------------------------------------------------------
  /** Host-side tally behind the full-time report (see _matchReport). Each
   *  count is bumped where that event is actually decided, so the report
   *  can't disagree with the banners shown during the match. */
  _newMatchStats(){
    const side=()=>({shots:0,onTarget:0,duelsWon:0,saves:0,blocks:0,techs:0,possMs:0});
    return {elapsedS:0,goals:[],A:side(),B:side(),players:{}};
  }
  _playerLine(role,id){ return (this.matchStats.players[id]??={role,goals:0,duelsWon:0,saves:0,blocks:0}); }
  /** +n to `role`'s `key`, and to that player's own line when `id` is given. */
  _stat(role,key,n=1,id=null){
    const ms=this.matchStats; if(!ms?.[role]) return;
    ms[role][key]+=n;
    if(id!=null){ const p=this._playerLine(role,id); if(key in p) p[key]+=n; }
  }
  _recordGoal(role,id){
    const ms=this.matchStats; if(!ms||id==null) return;
    ms.goals.push({role,id,name:this._statsFor(role,id)?.name||'',min:this._matchMinute()});
    this._playerLine(role,id).goals++;
  }
  /** Play so far, scaled onto a 90-minute match whatever the half length;
   *  overtime carries on past 90 ("90+3'"). */
  _matchMinute(){
    const m=Math.max(1,Math.ceil((this.matchStats?.elapsedS||0)/(2*this.halfLengthS)*90));
    return m>90?`90+${m-90}'`:`${m}'`;
  }
  /** What the full-time panel shows — plain data, so the host can send the
   *  very same thing to its client (see sendState's `report`). The MVP is
   *  whoever did the most: 3 a goal, 2 a save, 1 a duel won or a block, with
   *  a tie going to the winning side. */
  _matchReport(){
    const ms=this.matchStats; if(!ms) return null;
    const totalPoss=(ms.A.possMs+ms.B.possMs)||1;
    const sideOut=r=>({...ms[r],poss:Math.round(ms[r].possMs/totalPoss*100)});
    const winner=this.score.a>this.score.b?'A':this.score.b>this.score.a?'B':null;
    let mvp=null, best=0;
    for(const [id,p] of Object.entries(ms.players)){
      const score=3*p.goals+2*p.saves+p.duelsWon+p.blocks;
      if(score>best||(score===best&&score>0&&p.role===winner&&mvp?.role!==winner)){
        best=score;
        const parts=[p.goals&&`${p.goals} goal${p.goals>1?'s':''}`,p.saves&&`${p.saves} save${p.saves>1?'s':''}`,p.duelsWon&&`${p.duelsWon} duel${p.duelsWon>1?'s':''} won`,p.blocks&&`${p.blocks} block${p.blocks>1?'s':''}`].filter(Boolean);
        mvp={id,role:p.role,name:this._statsFor(p.role,id)?.name||'',line:parts.join(' · ')};
      }
    }
    return {goals:ms.goals.slice(0,40),A:sideOut('A'),B:sideOut('B'),mvp};
  }
  _renderMatchReport(rep){
    const box=document.getElementById('fulltime-report');
    if(!rep){ box.innerHTML=''; return; }
    this._reportShown=true;
    const nameA=document.getElementById('score-name-a').textContent||'Home';
    const nameB=document.getElementById('score-name-b').textContent||'Away';
    const goals=r=>rep.goals.filter(g=>g.role===r).map(g=>`<div>⚽ ${escHtml(g.min)} ${escHtml(g.name)}</div>`).join('')||'<div class="ft-none">—</div>';
    const row=(label,a,b)=>`<tr><td>${a}</td><th>${label}</th><td>${b}</td></tr>`;
    const A=rep.A, B=rep.B;
    let mvp='';
    if(rep.mvp){
      const rp=getPlayerById(rep.mvp.id);
      const av=this._avatarFill(rp,this._css3(rp?this._rosterColor(rp):0x999999));
      mvp=`<div class="ft-mvp"><div class="ft-mvp-portrait" style="${av.style}">${escHtml(av.inner)}</div>
        <div><div class="ft-mvp-tag">⭐ MVP</div><div class="ft-mvp-name">${escHtml(rep.mvp.name)}</div><div class="ft-mvp-line">${escHtml(rep.mvp.line)}</div></div></div>`;
    }
    box.innerHTML=`
      <div class="ft-goals"><div><div class="ft-team">${escHtml(nameA)}</div>${goals('A')}</div><div><div class="ft-team">${escHtml(nameB)}</div>${goals('B')}</div></div>
      <table class="ft-table">
        ${row('Shots (on target)',`${A.shots} (${A.onTarget})`,`${B.shots} (${B.onTarget})`)}
        ${row('Possession',`${A.poss}%`,`${B.poss}%`)}
        ${row('Duels won',A.duelsWon,B.duelsWon)}
        ${row('Saves',A.saves,B.saves)}
        ${row('Blocks',A.blocks,B.blocks)}
        ${row('Supertechniques',A.techs,B.techs)}
      </table>${mvp}`;
  }

  /** Full time: the final score and the match report. It stays up until you
   *  pick what's next — Rematch (vs AI), back to the tournament, or the
   *  menu — every one of which goes through a page reload on purpose: every
   *  control in the menu is bound to this scene instance, so rebuilding a
   *  match in place would leave the old bindings behind. The room code lives
   *  in the URL, so it survives. */
  _showFullTime(){
    if(this._fullTimeShown){
      // A client can see the clock end a frame before the state carrying
      // the report lands.
      if(!this._reportShown&&this.role!=='A'&&this.remoteState?.report) this._renderMatchReport(this.remoteState.report);
      return;
    }
    this._fullTimeShown=true;
    playWhistle();
    const scoreTxt=document.querySelector('#scoreboard .score').textContent;
    const [a,b]=scoreTxt.split('-').map(n=>parseInt(n,10)||0);
    const mine=this.role==='A'?a:b, theirs=this.role==='A'?b:a;
    const inTournament=!!this._tournamentPendingFixture;
    // Tournaments are offline-only (the fixture is set up locally, from the
    // rival slot) and the pending fixture is only ever set on the host side
    // (see _playTournamentFixture) — recorded here, before any reload, since
    // nothing in memory survives it.
    if(this._tournamentPendingFixture&&this.role==='A') this._recordTournamentResult(this._tournamentPendingFixture,mine,theirs);
    document.getElementById('fulltime-score').textContent=scoreTxt;
    const ot=(this.role==='A'?this.matchClock:this.remoteState?.clock)?.overtime?' in overtime':'';
    document.getElementById('fulltime-verdict').textContent=mine>theirs?`You win${ot}!`:mine<theirs?`You lose${ot}`:'Draw';
    this._renderMatchReport(this.role==='A'?this._matchReport():this.remoteState?.report);
    const multi=this.uiMode==='multiplayer'||this.net.hasPeer();
    const rematch=document.getElementById('fulltime-rematch-btn');
    const cont=document.getElementById('fulltime-continue-btn');
    rematch.style.display=(!multi&&!inTournament&&this._lastMatchPayloads)?'':'none';
    cont.style.display=inTournament?'':'none';
    cont.textContent='🏆 Back to the tournament';
    document.getElementById('confrontation-ui').style.display='none';
    document.getElementById('duel-reveal').style.display='none';
    document.getElementById('fulltime-panel').style.display='flex';
  }

  _returnToMenu(resume=null){
    try{
      if(resume) sessionStorage.setItem(RESUME_KEY,JSON.stringify(resume));
      else sessionStorage.removeItem(RESUME_KEY);
    }catch{ /* storage blocked: falls back to the plain menu */ }
    window.location.reload();
  }
  /** Same two squads, same settings, straight into a new match after the reload. */
  _rematch(){
    if(!this._lastMatchPayloads) return this._returnToMenu();
    this._returnToMenu({kind:'rematch',a:this._lastMatchPayloads.a,b:this._lastMatchPayloads.b,halfLengthS:this.halfLengthS,aiLevel:this.aiLevel});
  }
  /** Picks up whatever full time asked for (see _returnToMenu) once the
   *  roster is loaded: a rematch starts at once, a tournament reopens its
   *  bracket. Read once, then cleared, so a manual reload is a fresh start. */
  _consumeResume(){
    let resume=null;
    try{ resume=JSON.parse(sessionStorage.getItem(RESUME_KEY)||'null'); sessionStorage.removeItem(RESUME_KEY); }catch{ return; }
    if(!resume) return;
    if(resume.kind==='rematch'&&resume.a?.starterIds?.length&&resume.b?.starterIds?.length){
      document.getElementById('landing-panel').style.display='none';
      this.uiMode='solo'; this._applyUiMode();
      if(AI_LEVELS[resume.aiLevel]){ this.aiLevel=resume.aiLevel; document.getElementById('ai-level-select').value=resume.aiLevel; }
      if(resume.halfLengthS>0){ this.halfLengthS=resume.halfLengthS; this.matchClock.secondsRemaining=this.halfLengthS; this._renderClock(this.matchClock); }
      this._rivalName=resume.b.name;
      this._startMatch(resume.a,resume.b);
    } else if(resume.kind==='tournament'&&this.activeTournament){
      document.getElementById('landing-panel').style.display='none';
      document.getElementById('tournament-panel').style.display='flex';
      this._renderTournamentPanel();
    }
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
    const myInput={targets,shootRequest:this.pendingShoot,shotAim:this.pendingShotAim,passTarget:this.pendingPass,confrontationChoice:this.pendingChoice,subRequest:this.pendingSub,repositionRequest:this.pendingReposition,formationChange:this.pendingFormChange,teamPanelRequest:this.pendingTeamPanelRequest};
    this.pendingShoot=false; this.pendingShotAim=null; this.pendingPass=null; this.pendingChoice=null; this.pendingSub=null; this.pendingReposition=null; this.pendingFormChange=null; this.pendingTeamPanelRequest=null;
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
      if(this.possRole!=='B') this._aiHoldId=null; // next time it has the ball, the hold starts over
      const target=!eB?null
        :this.possRole==='B'?this._aiCarrierTarget(eB)
        :decideAIMove({selfPos:eB.body.position,ballPos:this.ball.position,axis:'y',ownGoalValue:0,rivalGoalValue:this.FIELD_H,fieldPrimarySize:this.FIELD_H}).target;
      inputB={targets:target?[{id:eB.id,...target}]:[],shootRequest:false,passTarget:null,confrontationChoice:null,subRequest:null,repositionRequest:null,formationChange:null};
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
    if(!this.matchClock.ended&&this.matchStats){
      this.matchStats.elapsedS+=delta/1000;
      if(this.possRole) this.matchStats[this.possRole].possMs+=delta;
    }

    if(this.confrontation){
      this._progressConfront(now,myInput,inputB,aiActive);
    } else if(!this.matchClock.ended && !this._checkOutOfBounds(now)){
      this._updateActive('A'); this._updateActive('B');
      this._moveTeam('A',myInput.targets,now); this._moveTeam('B',inputB.targets,now);
      if(myInput.passTarget&&this.possRole==='A') this._doPass('A',myInput.passTarget);
      else if(!aiActive&&inputB.passTarget&&this.possRole==='B') this._doPass('B',inputB.passTarget);
      // shootRequest is the aimed spot ({x,y}); an older client sends `true`.
      const aim=r=>(r&&typeof r==='object')?r:null;
      if(myInput.shootRequest&&this.possRole==='A') this._startConfront('shot','A','B',now,{target:aim(myInput.shootRequest)});
      else if(!aiActive&&inputB.shootRequest&&this.possRole==='B') this._startConfront('shot','B','A',now,{target:aim(inputB.shootRequest)});
      else if(aiActive&&this.possRole==='B'){
        const eB=this._activeEntry('B'), p=this._aiParams();
        // Shoot as soon as it's in range rather than dithering around the box
        if(eB&&eB.body.position.y>this.FIELD_H-p.shootRange&&Math.random()<p.shootChance) this._startConfront('shot','B','A',now,{target:this._aiPickShotAim()});
        else if(eB&&this._aiMayPass(eB,now)){
          const underPressure=this._nearestOpponentDist('B',eB)<PRESS_RANGE;
          const passChance=underPressure?p.passChance:p.passChance*PASS_CHANCE_FREE_MULT;
          if(Math.random()<passChance){
            const pass=this._aiPickPassTarget('B',eB);
            // Unpressured, only a pass that actually gets past someone (or
            // finds a runner in behind) is worth giving the ball up for.
            if(pass&&(underPressure||pass.bypassed>0||pass.through)) this._doPass('B',{x:pass.x,y:pass.y});
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
      this.net.sendState({matchStarted:true,ball:{x:this.ball.position.x,y:this.ball.position.y},ballH:this.ballFlight?Math.round(this.ballFlight.h):0,teamA:this.teamA.map(e=>({x:e.body.position.x,y:e.body.position.y})),teamB:this.teamB.map(e=>({x:e.body.position.x,y:e.body.position.y})),activeIdA:this.activeIdA,activeIdB:this.activeIdB,score:this.score,sp:{a:as2?as2.sp:0,b:bs?bs.sp:0},maxSp:{a:as2?as2.maxSP:100,b:bs?bs.maxSP:100},stamina:{a:as2?as2.stamina:0,b:bs?bs.stamina:0},maxStamina:{a:as2?as2.maxStamina:150,b:bs?bs.maxStamina:150},statsAll,sentOff,possession:this.possRole,confrontation:this.confrontation?{type:this.confrontation.type,attackerRole:this.confrontation.attackerRole,defenderRole:this.confrontation.defenderRole,attackerId:this.confrontation.attackerId,defenderId:this.confrontation.defenderId,deadline:this.confrontation.deadline,reveal:this.confrontation.reveal||null,attackerLocked:!!this.confrontation.attackerLocked,solo:!!this.confrontation.solo,keeperReach:this.confrontation.keeperReach??null,shotLine:this.confrontation.shotLine||null}:null,confrontResult:(this.confrontResult&&now<this.confrontResult.until)?this.confrontResult:null,benchIds:{a:this.benchA,b:this.benchB},starterIds:{a:this.teamA.map(e=>e.id),b:this.teamB.map(e=>e.id)},clock:{half:this.matchClock.half,secondsRemaining:this.matchClock.secondsRemaining,ended:this.matchClock.ended,overtime:!!this.matchClock.overtime,otElapsed:this.matchClock.otElapsed||0},stuns:stunAry,teamPanelOpen:this.teamPanelOpen,report:this.matchClock.ended?this._matchReport():null});
    }
  }

  _moveTeam(role,targets,now){
    const team=role==='A'?this.teamA:this.teamB;
    const byId=new Map(targets.map(t=>[t.id,t]));
    const activeId=role==='A'?this.activeIdA:this.activeIdB;
    const iHaveBall=this.possRole===role;
    const oppHasBall=!!this.possRole&&this.possRole!==role;
    const ballCarrier=oppHasBall?this._activeEntry(this.possRole):null;
    const defPlan=ballCarrier?this._defensivePlan(role,activeId,ballCarrier):null;
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
        const autoPos=this._offBallTarget(role,e,activeId,iHaveBall,ballCarrier,defPlan);
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
    if(myInput.shotAim) this._setShotAim('A',myInput.shotAim);
    if(!aiActive&&inputB.shotAim) this._setShotAim('B',inputB.shotAim);
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
        if(result.fx){
          this._playTechniqueFx(result.fx.a); this._playTechniqueFx(result.fx.d);
          if(result.fx.save) this._playSaveFx(result.fx.save);
          if(result.fx.goal) this._playGoalFx(result.fx.goal);
        }
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

  /** A 4px white square, tinted per particle — the only texture the
   *  effects need, drawn once on first use. */
  _fxTexture(){
    if(!this.textures.exists('fx-px')){
      const g=this.make.graphics({x:0,y:0},false);
      g.fillStyle(0xffffff,1); g.fillRect(0,0,4,4); g.generateTexture('fx-px',4,4); g.destroy();
    }
    return 'fx-px';
  }
  _reducedMotion(){ return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
  /** One-off particle burst; the emitter cleans itself up once the last
   *  particle has faded. */
  _burst(x,y,cfg,kind,{depth=8,fixed=false}={}){
    const {count,...conf}=cfg;
    const em=this.add.particles(x,y,this._fxTexture(),{...conf,alpha:{start:1,end:0},emitting:false}).setDepth(depth);
    if(fixed) em.setScrollFactor(0);
    em.explode(count);
    this.time.delayedCall((conf.lifespan||800)+200,()=>em.destroy());
    // Last few effects played, for tests (the visuals themselves can't be asserted on).
    (this.fxLog??=[]).push(kind);
    if(this.fxLog.length>30) this.fxLog.shift();
    return em;
  }
  /** A supertechnique going off: a ring in the team's colour, a burst in the
   *  player's element (see ELEMENT_FX), and the technique's name floating
   *  up. The strongest moves also shake the camera. Shown on host and
   *  client alike, from the synced result. */
  _playTechniqueFx(data){
    if(!data) return;
    const ring=this.add.circle(data.x,data.y,16,data.color,0).setStrokeStyle(5,data.color,1).setDepth(8).setScale(0.4).setAlpha(1);
    this.tweens.add({targets:ring,scale:3.2,alpha:0,duration:650,ease:'Cubic.Out',onComplete:()=>ring.destroy()});
    this._burst(data.x,data.y,ELEMENT_FX[data.el]||FX_NEUTRAL,ELEMENT_FX[data.el]?data.el:'neutral');
    if((data.power||0)>=FX_BIG_POWER&&!this._reducedMotion()) this.cameras.main.shake(220,0.006);
    const txt=this.add.text(data.x,data.y-26,data.name,{fontSize:'11px',fontStyle:'bold',color:'#fff176',stroke:'#000',strokeThickness:4,resolution:3}).setOrigin(0.5,1).setDepth(9);
    this.tweens.add({targets:txt,y:txt.y-24,alpha:0,duration:900,ease:'Cubic.Out',onComplete:()=>txt.destroy()});
  }
  /** The keeper holds it: a white-gold flash at their gloves and "SAVE!". */
  _playSaveFx({x,y}){
    const ring=this.add.circle(x,y,14,0xffffff,0).setStrokeStyle(6,0xffe066,1).setDepth(8).setScale(0.5);
    this.tweens.add({targets:ring,scale:2.6,alpha:0,duration:520,ease:'Cubic.Out',onComplete:()=>ring.destroy()});
    this._burst(x,y,{tint:[0xffffff,0xffe066],speed:{min:120,max:240},angle:{min:0,max:360},gravityY:0,lifespan:450,scale:{start:1.8,end:0},count:24},'save');
    const txt=this.add.text(x,y-24,'SAVE!',{fontSize:'16px',fontStyle:'bold',color:'#ffffff',stroke:'#000',strokeThickness:5,resolution:3}).setOrigin(0.5,1).setDepth(9).setScale(0.6);
    this.tweens.add({targets:txt,scale:1.1,y:txt.y-18,duration:260,ease:'Back.Out',onComplete:()=>this.tweens.add({targets:txt,alpha:0,delay:350,duration:300,onComplete:()=>txt.destroy()})});
  }
  /** A goal: confetti in the scorer's colour raining over the whole screen.
   *  Screen-fixed rather than at the net, because the camera recentres on
   *  the kickoff at this very moment (see _renderResultBanner). */
  _playGoalFx({color}){
    const w=this.VP_W;
    const cfg={tint:[color,0xffffff,0xffe066],speed:{min:60,max:200},angle:{min:60,max:120},gravityY:260,lifespan:1600,scale:{start:2,end:1.2},rotate:{min:0,max:360},count:30};
    for(const fx of [0.2,0.5,0.8]) this._burst(w*fx,-8,cfg,'goal',{depth:20,fixed:true});
    if(!this._reducedMotion()){
      const c=Phaser.Display.Color.IntegerToColor(color);
      this.cameras.main.flash(180,c.red,c.green,c.blue);
      this.cameras.main.shake(260,0.008);
    }
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
    const reachTxt=confrontation.type==='shot'&&confrontation.keeperReach!=null?` · keeper reach ${Math.round(confrontation.keeperReach*100)}%`:'';
    // Later stages of a shot the shooter already picked for (see _startShot),
    // or the defending side while the shooting side lines up a strike or a
    // chain: nothing to choose, just show what's happening.
    const waiting=(amA&&confrontation.attackerLocked)?(confrontation.type==='block'?'A defender is in the way — waiting on them!':`You're through — waiting for the keeper!${reachTxt}`)
      :(amD&&confrontation.solo)?(confrontation.type==='chain'?'A teammate is chaining the shot…':'Opponent is lining up the shot…')
      :null;
    if(waiting){
      document.getElementById('confrontation-title').textContent=waiting;
      document.getElementById('conf-normal').style.display='none';
      document.getElementById('conf-tech-list').innerHTML='';
      document.getElementById('confrontation-player-info').innerHTML='';
      const rem=Math.max(0,confrontation.deadline-now);
      document.getElementById('confrontation-timer-fill').style.width=`${(rem/CONFRONT_MS)*100}%`;
      return;
    }
    const type=confrontation.type;
    const isDuel=type==='duel', isBlock=type==='block';
    const techId=isDuel?(amA?'dribble':'defense'):isBlock?(amA?'shot':'defense'):(amA?'shot':'keeper');
    const relId=amA?confrontation.attackerId:confrontation.defenderId;
    const relRole=amA?confrontation.attackerRole:confrontation.defenderRole;
    const stats=this._statsFor(relRole,relId); const rp=relId?getPlayerById(relId):null;
    document.getElementById('confrontation-title').textContent=isDuel?(amA?"Duel! You're being tackled":'Duel! Go for the tackle')
      :isBlock?(amA?'A defender is in the way!':'Block the shot — needs a supertechnique!')
      :type==='strike'?'Pick your spot on the goal, then your shot'
      :type==='chain'?'Chain the shot! Add a supertechnique to its power'
      :(amA?`Shoot for goal!${reachTxt}`:`Save the shot!${reachTxt}`);
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
