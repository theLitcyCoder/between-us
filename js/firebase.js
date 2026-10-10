import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  signOut,
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


// =====================================================
// ANONYMOUS AUTH
// =====================================================

// Wait for Firebase to finish restoring the existing user.
// Only create a new anonymous user if there truly isn't one.
async function startAnonymousAuth() {

  return new Promise(async (resolve, reject) => {

    let unsubscribe;

    unsubscribe = onAuthStateChanged(auth, async (user) => {

      // Firebase finished checking whether a previous
      // user exists.
      if (user) {

        unsubscribe();

        resolve(user);

        return;
      }

      // No existing user was found.
      // Create an anonymous user now.
      try {

        const credential =
          await signInAnonymously(auth);

        unsubscribe();

        resolve(credential.user);

      } catch (error) {

        unsubscribe();

        reject(error);

      }

    });

  });

}


// =====================================================
// CUSTOM TOKEN AUTH
// =====================================================

// Sign into Firebase using the custom token returned
// by the Cloudflare authentication Worker.
async function signInWithWorkerToken(token) {

  if (!token) {
    throw new Error(
      "No Firebase authentication token was returned."
    );
  }

  const credential =
    await signInWithCustomToken(
      auth,
      token
    );

  return credential.user;
}


// =====================================================
// CURRENT USER ID TOKEN
// =====================================================

// Get a fresh Firebase ID token for the currently
// signed-in user.
//
// This is needed when upgrading an existing anonymous
// account into a username/password account.
async function getCurrentIdToken() {

  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "No Firebase user is currently signed in."
    );
  }

  return await user.getIdToken(true);
}


// =====================================================
// SIGN OUT
// =====================================================

async function logout() {

  await signOut(auth);

}


// =====================================================
// EXPORTS
// =====================================================

export {
  app,
  auth,
  db,

  startAnonymousAuth,

  signInWithWorkerToken,

  getCurrentIdToken,

  logout,

  onAuthStateChanged
};

