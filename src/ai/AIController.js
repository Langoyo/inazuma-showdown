// Very simple rule-based AI for whichever of the AI team's 11 players is
// currently "active" (closest to the ball — see GameScene) while the AI
// does NOT have the ball; carrying it is GameScene._aiCarrierTarget's job.
// Written to be orientation-agnostic: the caller says which axis is the
// attacking axis ('x' for a horizontal field, 'y' for a vertical one) and
// where each goal sits along it.
export function decideAIMove({ selfPos, ballPos, axis, ownGoalValue, rivalGoalValue, fieldPrimarySize }) {
  const attacking = Math.sign(rivalGoalValue - ownGoalValue);
  const ballPrimary = ballPos[axis];
  const ballIsOnMySide = attacking > 0
    ? ballPrimary < fieldPrimarySize * 0.6
    : ballPrimary > fieldPrimarySize * 0.4;

  const distToBall = Math.hypot(ballPos.x - selfPos.x, ballPos.y - selfPos.y);

  if (distToBall < 200 || ballIsOnMySide) {
    return { target: { x: ballPos.x, y: ballPos.y } };
  }

  const target = { x: ballPos.x, y: ballPos.y };
  target[axis] = (ballPrimary + ownGoalValue) / 2;
  return { target };
}
