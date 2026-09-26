import { initializeApp, getApps, getApp } from 'firebase/app';

// One shared Firebase App instance for everything that needs it — Trystero's
// signaling (src/network/network.js), Auth, and Firestore (src/auth/*) all
// read/write the same project, so they share one initializeApp() call rather
// than each bootstrapping their own.
//
// databaseURL is real (the Realtime Database used for multiplayer
// signaling, set up earlier). apiKey/appId/messagingSenderId below are
// PLACEHOLDERS — Firebase Auth and Firestore calls will fail until these are
// replaced with the real values from Firebase console → Project settings →
// General → "Your apps" → Web app config (create a Web app there first if
// one doesn't exist yet). This isn't a secret to protect: like the database
// URL, it's fine committed here — Firebase's security comes from
// Database/Firestore Rules and from which sign-in providers are enabled,
// not from hiding this config.
const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_ME_FIREBASE_API_KEY',
  authDomain: 'inazuma-showdown.firebaseapp.com',
  databaseURL: 'https://inazuma-showdown-default-rtdb.europe-west1.firebasedatabase.app/',
  projectId: 'inazuma-showdown',
  storageBucket: 'inazuma-showdown.appspot.com',
  messagingSenderId: 'REPLACE_ME_SENDER_ID',
  appId: 'REPLACE_ME_FIREBASE_APP_ID',
};

let app = null;
export function getFirebaseApp() {
  if (!app) app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  return app;
}
