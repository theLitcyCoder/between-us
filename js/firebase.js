import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


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


// Wait for Firebase to finish restoring the existing anonymous user.
// Only create a new anonymous user if there truly isn't one.
async function startAnonymousAuth() {

  return new Promise(async (resolve, reject) => {

    let unsubscribe;

    unsubscribe = onAuthStateChanged(auth, async (user) => {

      // Firebase finished checking whether a previous user exists
      if (user) {

        unsubscribe();

        resolve(user);

        return;
      }

      // No existing user was found.
      // Create the anonymous user now.
      try {

        const credential = await signInAnonymously(auth);

        unsubscribe();

        resolve(credential.user);

      } catch (error) {

        unsubscribe();

        reject(error);

      }

    });

  });

}


export {
  app,
  auth,
  db,
  startAnonymousAuth,
  onAuthStateChanged
};