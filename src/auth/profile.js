import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseApp } from '../firebase-app.js';

let db = null;
function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function formationsCollection(uid) {
  return collection(getDb(), 'users', uid, 'formations');
}

/** Saves a named formation to `uid`'s profile. `slots`/`bench` are the same
 *  id arrays GameScene already builds for the localStorage save (see
 *  _saveSquad) — this doesn't change that shape, just where it's kept. */
export async function saveFormationToProfile(uid, { name, formation, slots, bench }) {
  const docRef = await addDoc(formationsCollection(uid), {
    name: name || 'Untitled squad',
    formation,
    slots,
    bench,
    savedAt: serverTimestamp(),
  });
  return docRef.id;
}

/** Lists `uid`'s saved formations, newest first. */
export async function listSavedFormations(uid) {
  const q = query(formationsCollection(uid), orderBy('savedAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteSavedFormation(uid, formationId) {
  await deleteDoc(doc(getDb(), 'users', uid, 'formations', formationId));
}
