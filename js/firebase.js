import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

/*
  1. Firebase Console → Project settings → Your apps → Web app
  2. Copy your Firebase config into the object below.
*/
const firebaseConfig = {
  apiKey: "AIzaSyB0F7TbMRUM1Dini9QXoxTQNVjPS3L8nS4",
  authDomain: "between-us-97297.firebaseapp.com",
  projectId: "between-us-97297",
  storageBucket: "between-us-97297.firebasestorage.app",
  messagingSenderId: "395504898844",
  appId: "1:395504898844:web:4086cf3ac2a2452fffe0d9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function startAnonymousAuth() {
  if (auth.currentUser) return auth.currentUser;
  await signInAnonymously(auth);
  return auth.currentUser;
}

export { app, auth, db, startAnonymousAuth, onAuthStateChanged };
