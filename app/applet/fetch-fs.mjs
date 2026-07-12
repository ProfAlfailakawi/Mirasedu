import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function run() {
  const ref = doc(db, 'system', 'database');
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = snap.data();
    console.log('lastUpdated:', data.lastUpdated);
    console.log('sections count:', data.sections?.length);
    console.log('teachers:', data.teachers);
  } else {
    console.log('no database doc found in firestore');
  }
}
run();
