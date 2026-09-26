import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider,
  signOut,
} from 'firebase/auth';
import { getFirebaseApp } from '../firebase-app.js';

// Every player always has *some* signed-in Firebase user, even one who never
// explicitly makes an account: on first load, if nobody is signed in, we
// sign in anonymously. That gives a stable uid to key saved formations
// against (src/auth/profile.js) from the very first visit, with no "create
// an account just to save a formation" wall — "play anonymously" from the
// feature request is simply never leaving that anonymous session.
//
// Upgrading later (email/password sign-up) *links* the anonymous
// user's credential onto the same uid instead of creating a separate
// account, so formations already saved while anonymous carry over rather
// than becoming orphaned under a uid nobody can reach again.

let auth = null;
function getAuthInstance() {
  if (!auth) auth = getAuth(getFirebaseApp());
  return auth;
}

let readyResolve;
const ready = new Promise((res) => { readyResolve = res; });
let readySettled = false;

/** Call once at startup. Resolves once the initial auth state is known
 *  (existing session restored, or a fresh anonymous one created) — doesn't
 *  block anything else in the app; callers that care await this
 *  themselves (see profile.js). */
export function initAuthSession() {
  const a = getAuthInstance();
  onAuthStateChanged(a, (user) => {
    if (!user) {
      // No session at all (first-ever visit) or just signed out — either
      // way, bootstrap (or re-bootstrap) an anonymous one so the app
      // always has *a* uid to save formations against. The next callback,
      // with that anonymous user, is what actually resolves `ready`.
      signInAnonymously(a).catch((err) => console.warn('[auth] anonymous sign-in failed:', err));
      return;
    }
    if (!readySettled) { readySettled = true; readyResolve(user); }
  });
  return ready;
}

export function getUser() {
  return getAuthInstance().currentUser;
}

export function onAuthChange(cb) {
  return onAuthStateChanged(getAuthInstance(), cb);
}

/** A short label for whatever's currently signed in, for the account UI. */
export function describeUser(user) {
  if (!user) return 'Not signed in';
  if (user.isAnonymous) return 'Guest';
  return user.email || user.displayName || 'Signed in';
}

/** Email/password sign-up. If the current session is anonymous, links the
 *  new credential onto it (keeps the uid, keeps saved formations) instead
 *  of creating an unrelated second account. */
export async function signUpWithEmail(email, password) {
  const a = getAuthInstance();
  if (a.currentUser?.isAnonymous) {
    const cred = EmailAuthProvider.credential(email, password);
    const result = await linkWithCredential(a.currentUser, cred);
    return result.user;
  }
  const result = await createUserWithEmailAndPassword(a, email, password);
  return result.user;
}

/** Email/password sign-in to an *existing* account — always ends up on
 *  that account's own uid, so if the current session was anonymous, its
 *  locally-saved formations don't follow (there's no way to merge two
 *  separate accounts' data automatically here). */
export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(getAuthInstance(), email, password);
  return result.user;
}


/** Signing out always leaves a fresh anonymous session behind (see the
 *  onAuthStateChanged handler above) — there's no "signed out" state in
 *  this app, just anonymous-vs-named. */
export async function signOutUser() {
  await signOut(getAuthInstance());
}
