import {
  db,
  auth,
  startAnonymousAuth,
  signInWithWorkerToken,
  getCurrentIdToken,
  logout,
  onAuthStateChanged
} from "./firebase.js";

import {
collection,
doc,
addDoc,
setDoc,
getDoc,
getDocs,
updateDoc,
deleteDoc,
query,
where,
orderBy,
limit,
serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const AI_WORKER_URL =
  "https://between-us-ai.newoshadow21.workers.dev";

const AUTH_WORKER_URL =
"https://between-us-auth.newoshadow21.workers.dev";


async function recoverAnonymousSession() {
  // Clear the stale Firebase session.
  await logout();

  // Create a new anonymous Firebase session.
  const user = await startAnonymousAuth();

  // Keep the app's user reference synchronized.
  currentUser = user;

  return user;
}


/* =========================================================
   AI HELPER
========================================================= */

async function askAI({
  mode,
  question,
  category,
  answer = ""
}) {
  try {
    const response = await fetch(AI_WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        mode,
        question,
        category,
        answer
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("AI Worker error:", data);
      throw new Error(data.error || "AI request failed.");
    }

    return data.text;

  } catch (error) {
    console.error("AI error:", error);
    throw error;
  }
}

/* =========================================================
   PLAYER: UNDERSTAND QUESTION
========================================================= */

async function explainCurrentQuestion() {

  if (!currentGame || !currentGame.questions) {
    return;
  }

  const question =
    currentGame.questions[currentQuestionIndex];

  if (!question) {
    return;
  }

  const button =
    document.getElementById("questionHelpButton");

  const resultBox =
    document.getElementById("questionHelpResult");

  if (!button || !resultBox) {
    return;
  }

  button.disabled = true;
  button.textContent = "✨ Thinking...";

  resultBox.classList.remove("hidden");

  resultBox.textContent =
    "Let me explain what this question is asking...";

  try {

    const explanation = await askAI({
      mode: "question-help",
      question: question.question,
      category: question.category
    });

    resultBox.textContent = explanation;

  } catch (error) {

    resultBox.textContent =
      "I couldn't explain this question right now. You can still answer it normally.";

  } finally {

    button.disabled = false;

    button.innerHTML =
      '<span class="ai-bulb">💡</span> Help me understand';
  }
}

/* =========================================================
   CREATOR: UNDERSTAND RESPONSE
========================================================= */

async function explainResponse(responseId) {

  const response = currentResponses.find(
    r => r.id === responseId
  );

  if (!response) {
    return;
  }

  const resultBox =
    document.getElementById(
      `ai-response-${responseId}`
    );

  const button =
    document.querySelector(
      `[data-ai-response="${responseId}"]`
    );

  if (!resultBox || !button) {
    return;
  }

  button.disabled = true;
  button.textContent = "✨ Thinking...";

  resultBox.classList.remove("hidden");

  resultBox.textContent =
    "Looking at what this response could mean...";

  try {

    const interpretation = await askAI({
      mode: "response-understanding",
      question: response.question,
      category: response.category,
      answer: response.answer
    });

    resultBox.textContent = interpretation;

  } catch (error) {

    resultBox.textContent =
      "I couldn't interpret this response right now.";

  } finally {

    button.disabled = false;

    button.textContent =
      "✨ Understand this response";
  }
}

/* =========================================================
   GLOBAL STATE
========================================================= */

const $ = (id) =>
  document.getElementById(id);

let currentUser = null;
let username = "";

let creatorQuestions = [];
let editingQuestionId = null;

let currentGameId = null;
let currentGame = null;
let currentQuestionIndex = 0;

let currentResponses = [];

let currentListId = null;
let currentList = null;
let currentListItems = [];

let dashboardSharedLists = [];
let dashboardGames = [];
let dashboardLists = [];
let dashboardGroups = [];


/* =========================================================
   CATEGORIES
========================================================= */

const CATEGORIES = {

  "very-light": {
    label: "🌼 Very Light",
    scene: "very-light",
    character: ["🐰", "🐻", "🐰🌼", "🐻☀️"],
    decoration: "☀️"
  },

  "light": {
    label: "🌸 Light",
    scene: "light",
    character: ["🐰🌸", "🐻🌷", "🐰💕", "🐻🌼"],
    decoration: "🌷"
  },

  "deep": {
    label: "🌙 Deep",
    scene: "deep",
    character: ["🐰🌙", "🐻⭐", "🐰✨", "🐻🌙"],
    decoration: "✦"
  },

  "sensitive": {
    label: "💗 Sensitive",
    scene: "sensitive",
    character: ["🐰🫶", "🐻🧸", "🐰☕", "🐻💗"],
    decoration: "♡"
  },

  "spicy": {
    label: "💗 Spicy",
    scene: "spicy",
    character: ["😘😍", "😋😛", "💦🧡", "🐻💗"],
    decoration: "😛"
  }

};

/* =========================================================
   PERMISSIONS
========================================================= */

const PERMISSIONS = {

  view: "👀 View only",
  check: "☑️ Check items",
  edit: "✏️ Edit list",
  full: "🛠️ Full access"

};

/* =========================================================
   SCREEN NAVIGATION
========================================================= */

function showScreen(id) {

  document
    .querySelectorAll(".screen")
    .forEach(s =>
      s.classList.add("hidden")
    );

  $(id).classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

$("backButton").classList.toggle(
  "hidden",
  id === "landingScreen" ||
  id === "loadingScreen" ||
  id === "usernameScreen"
);
}

/* =========================================================
   TOAST
========================================================= */

function toast(message) {

  const el = $("toast");

  el.textContent = message;

  el.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(
    () => el.classList.remove("show"),
    2600
  );
}

/* =========================================================
   HTML ESCAPE
========================================================= */

function escapeHtml(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
   RANDOM ITEM
========================================================= */

function randomItem(array) {

  return array[
    Math.floor(Math.random() * array.length)
  ];

}

/* =========================================================
   ID
========================================================= */

function makeId() {

  return crypto.randomUUID();

}

/* =========================================================
   URL PARAMETERS
========================================================= */

function getParam(name) {

  return new URLSearchParams(
    window.location.search
  ).get(name);

}

function setParam(name, value) {

  const url =
    new URL(window.location.href);

  if (value) {
    url.searchParams.set(name, value);
  } else {
    url.searchParams.delete(name);
  }

  history.replaceState(
    {},
    "",
    url
  );
}

/* =========================================================
   DATE
========================================================= */

function formatDate(timestamp) {

  if (!timestamp?.toDate) {
    return "Just now";
  }

  return timestamp
    .toDate()
    .toLocaleDateString(
      undefined,
      {
        month: "short",
        day: "numeric",
        year: "numeric"
      }
    );
}

/* =========================================================
   USERNAME
========================================================= */






/* =========================================================
   ACCOUNT / USERNAME
========================================================= */

async function loadUsername() {

  if (!currentUser) {
    return null;
  }

  try {

    const userRef =
      doc(
        db,
        "users",
        currentUser.uid
      );

    const snap =
      await getDoc(userRef);

    if (!snap.exists()) {
      return null;
    }

    return snap.data().username || null;

  } catch (error) {

    console.error(
      "LOAD USERNAME ERROR:",
      error
    );

    return null;
  }
}


/* =========================================================
   USERNAME VALIDATION
========================================================= */

function validateUsername(value) {

  const name =
    value.trim();

  if (!name) {
    return "Please enter a username.";
  }

  if (name.length < 3) {
    return "Your username needs at least 3 characters.";
  }

  if (name.length > 20) {
    return "Your username can be up to 20 characters.";
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return "Use only letters, numbers, _ or -.";
  }

  return null;
}


/* =========================================================
   ACCOUNT ERROR
========================================================= */

function showAccountError(message) {

  const usernameError =
    $("usernameError");

  if (!usernameError) {
    return;
  }

  usernameError.textContent =
    message || "";

  usernameError.classList.toggle(
    "hidden",
    !message
  );
}


/* =========================================================
   UPDATE USERNAME DISPLAY
========================================================= */

function updateUsernameDisplay() {

  const display =
    $("usernameDisplay");

  if (!display) {
    return;
  }

  if (username) {

    display.textContent =
      username;

    display.classList.remove(
      "hidden"
    );

  } else {

    display.textContent =
      "";

    display.classList.add(
      "hidden"
    );
  }
}


/* =========================================================
   SHOW USERNAME / ACCOUNT SCREEN
========================================================= */

function showUsernameScreen(mode = "create", hasExistingSpace = false) {

  showScreen(
    "usernameScreen"
  );

  const title =
    $("accountScreenTitle");

  const description =
    $("accountScreenDescription");

  const loginArea =
    $("loginAccountArea");

  const createArea =
    $("createAccountArea");

  const anonymousArea =
    $("anonymousAccountArea");


  /* =====================================================
     TITLE
  ===================================================== */

  if (title) {

    title.textContent =
      mode === "login"
        ? "Welcome back ♡"
        : hasExistingSpace
          ? "Welcome back to your space ♡"
          : "Make your Between Us yours ♡";
  }


  /* =====================================================
     DESCRIPTION
  ===================================================== */

  if (description) {

    description.textContent =
      mode === "login"

        ? "Log in with your username and password to access your Between Us space."

        : hasExistingSpace

          ? "Your existing Between Us space is ready. Secure it with an account so you can access it from another device."

          : "Create a private account so you can come back from another device.";
  }


  /* =====================================================
     LOGIN AREA
  ===================================================== */

  if (loginArea) {

    loginArea.classList.toggle(
      "hidden",
      mode !== "login"
    );
  }


  /* =====================================================
     CREATE AREA
  ===================================================== */

  if (createArea) {

    createArea.classList.toggle(
      "hidden",
      mode !== "create"
    );
  }


  /* =====================================================
     EXISTING ANONYMOUS SPACE AREA
  ===================================================== */

  if (anonymousArea) {

    anonymousArea.classList.toggle(
      "hidden",
      !hasExistingSpace
    );
  }


  /* =====================================================
     ACCOUNT MODE
  ===================================================== */

  document
    .querySelectorAll(
      'input[name="accountMode"]'
    )
    .forEach(input => {

      input.checked =
        input.value === mode;
    });


  showAccountError("");


  /* =====================================================
     FOCUS
  ===================================================== */

  if (mode === "login") {

    $("loginUsernameInput")?.focus();

  } else {

    $("usernameInput")?.focus();
  }
}


/* =========================================================
   COMPLETE LOGIN
========================================================= */

async function loginAccount() {

  const usernameInput =
    $("loginUsernameInput");

  const passwordInput =
    $("loginPasswordInput");

  const button =
    $("loginAccountButton");

  if (!usernameInput || !passwordInput) {
    return;
  }

  const loginUsername =
    usernameInput.value.trim();

  const password =
    passwordInput.value;

  if (!loginUsername) {

    return showAccountError(
      "Enter your username."
    );
  }

  if (!password) {

    return showAccountError(
      "Enter your password."
    );
  }

  showAccountError("");

  if (button) {

    button.disabled = true;
    button.textContent = "Logging in…";
  }

  try {

    const response =
      await fetch(
        `${AUTH_WORKER_URL}/login`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            username:
              loginUsername,

            password
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data.error ||
        "Login failed."
      );
    }

    if (!data.token) {

      throw new Error(
        "The authentication server did not return a token."
      );
    }

    /*
     * This replaces the anonymous Firebase user
     * with the permanent Firebase account.
     */
    currentUser =
      await signInWithWorkerToken(
        data.token
      );

    username =
      data.username ||
      loginUsername;

    localStorage.setItem(
      "betweenUsUsername",
      username
    );

    updateUsernameDisplay();

    showAccountError("");

    /*
     * Clear password fields.
     */
    passwordInput.value = "";

    $("loginUsernameInput").value =
      "";

    /*
     * Go to the normal Between Us home.
     */
    $("homeContent")
      .classList
      .remove("hidden");

    showScreen(
      "landingScreen"
    );

    await loadDashboard();

    toast(
      `Welcome back, ${username} ♡`
    );

  } catch (error) {

    console.error(
      "LOGIN ERROR:",
      error
    );

    showAccountError(
      error.message ||
      "Couldn't log you in. Please check your username and password."
    );

  } finally {

    if (button) {

      button.disabled = false;
      button.textContent =
        "Log in ♡";
    }
  }
}


/* =========================================================
   CREATE ACCOUNT
========================================================= */

async function createAccount() {

  const usernameInput =
    $("usernameInput");

  const passwordInput =
    $("accountPasswordInput");

  const confirmInput =
    $("accountPasswordConfirmInput");

  const button =
    $("submitUsernameButton");

  if (
    !usernameInput ||
    !passwordInput ||
    !confirmInput
  ) {
    return;
  }

  const newUsername =
    usernameInput.value.trim();

  const password =
    passwordInput.value;

  const confirmPassword =
    confirmInput.value;

  const validationError =
    validateUsername(
      newUsername
    );

  if (validationError) {

    return showAccountError(
      validationError
    );
  }

  if (password.length < 8) {

    return showAccountError(
      "Your password needs at least 8 characters."
    );
  }

  if (password !== confirmPassword) {

    return showAccountError(
      "Your passwords don't match."
    );
  }

  /*
   * Creating an account is specifically meant
   * to upgrade the current anonymous Firebase user.
   */
  if (
    !currentUser ||
    !currentUser.isAnonymous
  ) {

    return showAccountError(
      "This account is already signed in."
    );
  }

  showAccountError("");

  if (button) {

    button.disabled = true;
    button.textContent =
      "Creating account ♡";
  }

  // try {

  //   /*
  //    * Get a fresh Firebase ID token proving
  //    * that this anonymous user owns the UID.
  //    */
  //   const idToken =
  //     await getCurrentIdToken();

  //   const response =
  //     await fetch(
  //       `${AUTH_WORKER_URL}/create-account`,
  //       {
  //         method: "POST",

  //         headers: {
  //           "Content-Type":
  //             "application/json"
  //         },

  //         body: JSON.stringify({
  //           username:
  //             newUsername,

  //           password,

  //           idToken
  //         })
  //       }
  //     );

  //   const data =
  //     await response.json();

  //   if (!response.ok) {

  //     throw new Error(
  //       data.error ||
  //       "Couldn't create the account."
  //     );
  //   }

  //   if (!data.token) {

  //     throw new Error(
  //       "The authentication server did not return a token."
  //     );
  //   }

  //   /*
  //    * IMPORTANT:
  //    *
  //    * The Worker uses the EXISTING anonymous UID.
  //    *
  //    * Signing in with this custom token therefore
  //    * keeps all existing games/lists attached to
  //    * the same Firebase UID.
  //    */
  //   currentUser =
  //     await signInWithWorkerToken(
  //       data.token
  //     );

  //   username =
  //     data.username ||
  //     newUsername;

  //   localStorage.setItem(
  //     "betweenUsUsername",
  //     username
  //   );

  //   /*
  //    * Clear account fields.
  //    */
  //   usernameInput.value = "";
  //   passwordInput.value = "";
  //   confirmInput.value = "";

  //   updateUsernameDisplay();

  //   $("homeContent")
  //     .classList
  //     .remove("hidden");

  //   showScreen(
  //     "landingScreen"
  //   );

  //   await loadDashboard();

  //   toast(
  //     "Your Between Us account is secured ♡"
  //   );

  // } catch (error) {

  try {

    let response;
    let data;

    // Attempt account creation at most twice.
    for (let attempt = 0; attempt < 2; attempt++) {

      if (!currentUser || !currentUser.isAnonymous) {
        throw new Error(
          "Your anonymous session is unavailable. Please continue anonymously and try again."
        );
      }

      const idToken = await getCurrentIdToken();

      response = await fetch(
        `${AUTH_WORKER_URL}/create-account`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username: newUsername,
            password,
            idToken
          })
        }
      );

      data = await response.json();

      const invalidSession =
        response.status === 401 &&
        data.error === "Your current Firebase session is invalid.";

      // Retry only for the specific invalid-session error.
      if (!invalidSession || attempt === 1) {
        break;
      }

      // Sign out the stale user and start a fresh anonymous session.
      await logout();
      currentUser = await startAnonymousAuth();
    }

    if (!response.ok) {
      throw new Error(
        data.error || "Couldn't create the account."
      );
    }

    if (!data.token) {
      throw new Error(
        "The authentication server did not return a token."
      );
    }

    /*
     * Sign in with the Worker token.
     * This uses the UID returned by the Worker.
     */
    currentUser = await signInWithWorkerToken(data.token);

    username = data.username || newUsername;

    localStorage.setItem("betweenUsUsername", username);

    usernameInput.value = "";
    passwordInput.value = "";
    confirmInput.value = "";

    updateUsernameDisplay();

    $("homeContent").classList.remove("hidden");

    showScreen("landingScreen");

    await loadDashboard();

    toast("Your Between Us account is secured ♡");

  } catch (error) {

    console.error("CREATE ACCOUNT ERROR:", error);

    showAccountError(
      error.message || "Couldn't create your account."
    );

  } finally {

    if (button) {

      button.disabled = false;
      button.textContent =
        "Create account ♡";
    }
  }
}
$("submitUsernameButton")?.addEventListener(
  "click",
  createAccount
);
/* =========================================================
   CONTINUE ANONYMOUSLY
========================================================= */

async function continueAnonymous() {

  try {

    if (!currentUser) {

      currentUser =
        await startAnonymousAuth();
    }

    $("homeContent")
      .classList
      .remove("hidden");

    showScreen(
      "landingScreen"
    );

    await loadDashboard();

  } catch (error) {

    console.error(
      "CONTINUE ANONYMOUS ERROR:",
      error
    );

    toast(
      "Couldn't start your Between Us space."
    );
  }
}


/* =========================================================
   ACCOUNT MODE SWITCH
========================================================= */

document
  .querySelectorAll(
    'input[name="accountMode"]'
  )
  .forEach(input => {

    input.addEventListener(
      "change",
      () => {

        showUsernameScreen(
          input.value
        );

      }
    );

  });


/* =========================================================
   ACCOUNT BUTTONS
========================================================= */

$("loginAccountButton")
  ?.addEventListener(
    "click",
    loginAccount
  );

$("submitUsernameButton")
  ?.addEventListener(
    "click",
    createAccount
  );

$("continueAnonymousButton")
  ?.addEventListener(
    "click",
    continueAnonymous
  );


$("loginPasswordInput")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        loginAccount();
      }
    }
  );


$("accountPasswordConfirmInput")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        createAccount();
      }
    }
  );


/* =========================================================
   OLD USERNAME BUTTON
   Kept for compatibility with the existing HTML.
========================================================= */

// $("submitUsernameButton")
//   ?.addEventListener(
//     "click",
//     async () => {

//       /*
//        * Old anonymous username-only flow.
//        *
//        * This remains available for users who choose
//        * to continue without creating a password.
//        */

//       const input =
//         $("usernameInput");

//       if (!input) {
//         return;
//       }

//       const name =
//         input.value.trim();

//       const validationError =
//         validateUsername(name);

//       if (validationError) {

//         return showAccountError(
//           validationError
//         );
//       }

//       if (!currentUser) {

//         return showAccountError(
//           "Your Between Us space hasn't started yet."
//         );
//       }

//       const button =
//         $("submitUsernameButton");

//       if (button) {

//         button.disabled = true;
//         button.textContent =
//           "Saving…";
//       }

//       try {

//         const usernameLower =
//           name.toLowerCase();

//         // await setDoc(
//         //   doc(
//         //     db,
//         //     "users",
//         //     currentUser.uid
//         //   ),
//         //   {
//         //     username:
//         //       name,

//         //     usernameLower,

//         //     updatedAt:
//         //       serverTimestamp()
//         //   },
//         //   {
//         //     merge: true
//         //   }
//         // );

//         /*
//          * Only create the public username directory
//          * when this is still an anonymous user.
//          *
//          * Account creation itself is handled by the
//          * auth Worker and creates this directory safely.
//          */
//         await setDoc(
//           doc(
//             db,
//             "usernames",
//             usernameLower
//           ),
//           {
//             uid:
//               currentUser.uid,

//             username:
//               name,

//             createdAt:
//               serverTimestamp()
//           }
//         );

//         username =
//           name;

//         localStorage.setItem(
//           "betweenUsUsername",
//           name
//         );

//         updateUsernameDisplay();

//         $("homeContent")
//           .classList
//           .remove("hidden");

//         showScreen(
//           "landingScreen"
//         );

//         await loadDashboard();

//       } catch (error) {

//         console.error(
//           "USERNAME ERROR:",
//           error
//         );

//           console.error(
//     "CURRENT UID:",
//     currentUser?.uid
//   );

//   console.error(
//     "IS ANONYMOUS:",
//     currentUser?.isAnonymous
//   );

//   console.error(
//     "USERNAME:",
//     name
//   );

//         showAccountError(
//           "Couldn't save your username. Please try again."
//         );

//       } finally {

//         if (button) {

//           button.disabled = false;
//           button.textContent =
//             "Continue ♡";
//         }
//       }
//     }
//   );


$("usernameInput")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        createAccount();
      }
    }
  );


// =====================================================
// FRIENDS
// =====================================================

function makeFriendshipId(uid1, uid2) {
  return [uid1, uid2]
    .sort()
    .join("_");
}

function makeFriendRequestId(fromUid, toUid) {
  return `${fromUid}_${toUid}`;
}


// -----------------------------------------------------
// Search for a user by username
// -----------------------------------------------------

async function searchFriendByUsername() {

  const input = $("friendSearchInput");
  const result = $("friendSearchResult");

  if (!currentUser) {
    return;
  }

  const searchedUsername = input.value.trim();

  result.innerHTML = "";

  if (!searchedUsername) {

    result.innerHTML = `
      <div class="mini-empty">
        Enter a username to search. ♡
      </div>
    `;

    return;
  }

  const usernameLower =
    searchedUsername.toLowerCase();

  try {

    // -----------------------------------------------
    // Find username
    // -----------------------------------------------

console.log("FRIEND SEARCH 1: checking username");

const usernameSnap = await getDoc(
  doc(
    db,
    "usernames",
    usernameLower
  )
);

console.log("FRIEND SEARCH 1 SUCCESS");

    if (!usernameSnap.exists()) {

      result.innerHTML = `
        <div class="mini-empty">
          No one with that username was found. 🌷
        </div>
      `;

      return;
    }

    const foundUser =
      usernameSnap.data();


    // -----------------------------------------------
    // Don't allow self
    // -----------------------------------------------

    if (
      foundUser.uid === currentUser.uid
    ) {

      result.innerHTML = `
        <div class="mini-empty">
          That's you! ♡
        </div>
      `;

      return;
    }


    // -----------------------------------------------
    // Check existing friendship
    // -----------------------------------------------

    const friendshipId =
      makeFriendshipId(
        currentUser.uid,
        foundUser.uid
      );

   console.log("FRIEND SEARCH 2: checking friendship");

const friendshipSnap =
  await getDoc(
    doc(
      db,
      "friendships",
      friendshipId
    )
  );

console.log(
  "FRIEND SEARCH 2 SUCCESS",
  friendshipSnap.exists()
);

    if (friendshipSnap.exists()) {

      result.innerHTML = `
        <div class="friend-result">

          <div class="friend-avatar">
            ♡
          </div>

          <div class="friend-info">
            <strong>
              ${escapeHtml(foundUser.username)}
            </strong>

            <small>
              Already your friend ♡
            </small>
          </div>

        </div>
      `;

      return;
    }


    // -----------------------------------------------
    // Check outgoing request
    // -----------------------------------------------

    const outgoingRequestId =
      makeFriendRequestId(
        currentUser.uid,
        foundUser.uid
      );

console.log("FRIEND SEARCH 3: checking outgoing request");

const outgoingSnap =
  await getDoc(
    doc(
      db,
      "friendRequests",
      outgoingRequestId
    )
  );

console.log("FRIEND SEARCH 3 SUCCESS");
    if (
      outgoingSnap.exists() &&
      outgoingSnap.data().status === "pending"
    ) {

      result.innerHTML = `
        <div class="friend-result">

          <div class="friend-avatar">
            ♡
          </div>

          <div class="friend-info">

            <strong>
              ${escapeHtml(foundUser.username)}
            </strong>

            <small>
              Friend request already sent ♡
            </small>

          </div>

        </div>
      `;

      return;
    }


    // -----------------------------------------------
    // Check incoming request
    // -----------------------------------------------

    const incomingRequestId =
      makeFriendRequestId(
        foundUser.uid,
        currentUser.uid
      );

console.log("FRIEND SEARCH 4: checking incoming request");

const incomingSnap =
  await getDoc(
    doc(
      db,
      "friendRequests",
      incomingRequestId
    )
  );

console.log("FRIEND SEARCH 4 SUCCESS");

    if (
      incomingSnap.exists() &&
      incomingSnap.data().status === "pending"
    ) {

      result.innerHTML = `
        <div class="friend-result">

          <div class="friend-avatar">
            ♡
          </div>

          <div class="friend-info">

            <strong>
              ${escapeHtml(foundUser.username)}
            </strong>

            <small>
              This person already sent you a request.
            </small>

          </div>

          <button
            class="soft-button"
            type="button"
            id="viewIncomingRequestButton"
          >
            View Request
          </button>

        </div>
      `;

      $("viewIncomingRequestButton")
        ?.addEventListener(
          "click",
          showFriendRequests
        );

      return;
    }


    // -----------------------------------------------
    // Normal result
    // -----------------------------------------------

    result.innerHTML = `
      <div class="friend-result">

        <div class="friend-avatar">
          ♡
        </div>

        <div class="friend-info">

          <strong>
            ${escapeHtml(foundUser.username)}
          </strong>

          <small>
            Between Us friend
          </small>

        </div>

        <button
          class="primary-button"
          type="button"
          id="sendFriendRequestButton"
        >
          Add Friend ♡
        </button>

      </div>
    `;

    $("sendFriendRequestButton")
      ?.addEventListener(
        "click",
        () => sendFriendRequest(foundUser)
      );

  } catch (error) {

    console.error(
      "FRIEND SEARCH ERROR:",
      error
    );

    result.innerHTML = `
      <div class="mini-empty">
        Something went wrong while searching.
        Please try again.
      </div>
    `;
  }
}


// -----------------------------------------------------
// Send friend request
// -----------------------------------------------------

async function sendFriendRequest(targetUser) {

  if (!currentUser) {
    return;
  }

  if (
    targetUser.uid === currentUser.uid
  ) {
    return;
  }

  try {

    // -----------------------------------------------
    // Get sender profile
    // -----------------------------------------------

    const senderSnap =
      await getDoc(
        doc(
          db,
          "users",
          currentUser.uid
        )
      );

    if (!senderSnap.exists()) {

      showToast(
        "Please set your username first."
      );

      return;
    }

    const sender =
      senderSnap.data();


    // -----------------------------------------------
    // Check friendship
    // -----------------------------------------------

    const friendshipId =
      makeFriendshipId(
        currentUser.uid,
        targetUser.uid
      );

    const friendshipSnap =
      await getDoc(
        doc(
          db,
          "friendships",
          friendshipId
        )
      );

    if (friendshipSnap.exists()) {

      showToast(
        "You're already friends. ♡"
      );

      return;
    }


    // -----------------------------------------------
    // Deterministic request ID
    // -----------------------------------------------

    const requestId =
      makeFriendRequestId(
        currentUser.uid,
        targetUser.uid
      );


    // -----------------------------------------------
    // Check outgoing request
    // -----------------------------------------------

    const existingRequestSnap =
      await getDoc(
        doc(
          db,
          "friendRequests",
          requestId
        )
      );

    if (
      existingRequestSnap.exists() &&
      existingRequestSnap.data().status === "pending"
    ) {

      showToast(
        "Friend request already sent."
      );

      return;
    }


    // -----------------------------------------------
    // Check if they already requested us
    // -----------------------------------------------

    const incomingRequestId =
      makeFriendRequestId(
        targetUser.uid,
        currentUser.uid
      );

    const incomingRequestSnap =
      await getDoc(
        doc(
          db,
          "friendRequests",
          incomingRequestId
        )
      );

    if (
      incomingRequestSnap.exists() &&
      incomingRequestSnap.data().status === "pending"
    ) {

      showToast(
        "They already sent you a friend request. ♡"
      );

      await showFriendRequests();

      return;
    }


    // -----------------------------------------------
    // Create request
    // -----------------------------------------------

    await setDoc(
      doc(
        db,
        "friendRequests",
        requestId
      ),
      {
        fromUid:
          currentUser.uid,

        fromUsername:
          sender.username,

        toUid:
          targetUser.uid,

        toUsername:
          targetUser.username,

        status:
          "pending",

        createdAt:
          serverTimestamp()
      }
    );


    // -----------------------------------------------
    // Update search result
    // -----------------------------------------------

    $("friendSearchResult").innerHTML = `
      <div class="friend-result">

        <div class="friend-avatar">
          ♡
        </div>

        <div class="friend-info">

          <strong>
            ${escapeHtml(targetUser.username)}
          </strong>

          <small>
            Friend request sent ♡
          </small>

        </div>

      </div>
    `;

    showToast(
      "Friend request sent ♡"
    );

  } catch (error) {

    console.error(
      "SEND FRIEND REQUEST ERROR:",
      error
    );

    showToast(
      "Couldn't send the friend request."
    );
  }
}


// -----------------------------------------------------
// Show incoming friend requests
// -----------------------------------------------------

async function showFriendRequests() {

  showFriendsPanel("requests");

  const list =
    $("friendRequestsList");

  const empty =
    $("friendRequestsEmpty");

  if (!currentUser) {
    return;
  }

  list.innerHTML = `
    <div class="mini-empty">
      Loading requests…
    </div>
  `;

  try {

    // Only retrieve requests addressed to this user.
    // This is allowed by the Firestore rules.

    const requestsQuery =
      query(
        collection(
          db,
          "friendRequests"
        ),
        where(
          "toUid",
          "==",
          currentUser.uid
        ),
        where(
          "status",
          "==",
          "pending"
        ),
        orderBy(
          "createdAt",
          "desc"
        )
      );

    const snapshot =
      await getDocs(
        requestsQuery
      );

    list.innerHTML = "";

    if (snapshot.empty) {

      empty.classList.remove(
        "hidden"
      );

      return;
    }

    empty.classList.add(
      "hidden"
    );


    snapshot.forEach(
      requestDoc => {

        const request =
          requestDoc.data();

        const requestId =
          requestDoc.id;

        const item =
          document.createElement(
            "div"
          );

        item.className =
          "friend-result";

        item.innerHTML = `
          <div class="friend-avatar">
            ♡
          </div>

          <div class="friend-info">

            <strong>
              ${escapeHtml(
                request.fromUsername
              )}
            </strong>

            <small>
              Wants to be your Between Us friend ♡
            </small>

          </div>

          <div class="friend-actions">

            <button
              class="primary-button"
              type="button"
              data-accept-request="${requestId}"
            >
              Accept
            </button>

            <button
              class="soft-button"
              type="button"
              data-decline-request="${requestId}"
            >
              Decline
            </button>

          </div>
        `;

        list.appendChild(
          item
        );
      }
    );


    // ---------------------------------------------
    // Accept buttons
    // ---------------------------------------------

    document
      .querySelectorAll(
        "[data-accept-request]"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            async () => {

              const requestId =
                button.dataset
                  .acceptRequest;

              const requestSnap =
                await getDoc(
                  doc(
                    db,
                    "friendRequests",
                    requestId
                  )
                );

              if (
                !requestSnap.exists()
              ) {
                showToast(
                  "That request no longer exists."
                );

                await showFriendRequests();

                return;
              }

              await acceptFriendRequest(
                requestId,
                requestSnap.data()
              );
            }
          );
        }
      );


    // ---------------------------------------------
    // Decline buttons
    // ---------------------------------------------

    document
      .querySelectorAll(
        "[data-decline-request]"
      )
      .forEach(
        button => {

          button.addEventListener(
            "click",
            () => {

              const requestId =
                button.dataset
                  .declineRequest;

              declineFriendRequest(
                requestId
              );
            }
          );
        }
      );

  } catch (error) {

    console.error(
      "LOAD FRIEND REQUESTS ERROR:",
      error
    );

    list.innerHTML = `
      <div class="mini-empty">
        Couldn't load your friend requests.
      </div>
    `;
  }
}


// -----------------------------------------------------
// Accept request
// -----------------------------------------------------

async function acceptFriendRequest(
  requestId,
  request
) {

  if (!currentUser) {
    return;
  }

  try {

    const friendshipId =
      makeFriendshipId(
        currentUser.uid,
        request.fromUid
      );


    // ---------------------------------------------
    // Create friendship
    // ---------------------------------------------

    await setDoc(
      doc(
        db,
        "friendships",
        friendshipId
      ),
      {
        users: [
          currentUser.uid,
          request.fromUid
        ],

        user1Uid:
          currentUser.uid,

        user1Username:
          username,

        user2Uid:
          request.fromUid,

        user2Username:
          request.fromUsername,

        createdAt:
          serverTimestamp()
      }
    );


    // ---------------------------------------------
    // Mark request accepted
    // ---------------------------------------------

    await updateDoc(
      doc(
        db,
        "friendRequests",
        requestId
      ),
      {
        status:
          "accepted",

        respondedAt:
          serverTimestamp()
      }
    );


    toast(
      `${request.fromUsername} is now your friend! ♡`
    );

    await showFriendRequests();

  } catch (error) {

    console.error(
      "ACCEPT FRIEND REQUEST ERROR:",
      error
    );

    showToast(
      "Couldn't accept the friend request."
    );
  }
}


// -----------------------------------------------------
// Decline request
// -----------------------------------------------------

async function declineFriendRequest(
  requestId
) {

  if (!currentUser) {
    return;
  }

  try {

    await updateDoc(
      doc(
        db,
        "friendRequests",
        requestId
      ),
      {
        status:
          "declined",

        respondedAt:
          serverTimestamp()
      }
    );

    showToast(
      "Friend request declined."
    );

    await showFriendRequests();

  } catch (error) {

    console.error(
      "DECLINE FRIEND REQUEST ERROR:",
      error
    );

    showToast(
      "Couldn't decline the request."
    );
  }
}


// -----------------------------------------------------
// Friends list
// -----------------------------------------------------

async function showFriendsList() {

  showFriendsPanel(
    "friends"
  );

  const list =
    $("friendsList");

  const empty =
    $("friendsEmpty");

  if (!currentUser) {
    return;
  }

  list.innerHTML = `
    <div class="mini-empty">
      Loading friends…
    </div>
  `;

  try {

    const friendsQuery =
      query(
        collection(
          db,
          "friendships"
        ),
        where(
          "users",
          "array-contains",
          currentUser.uid
        ),
        orderBy(
          "createdAt",
          "desc"
        )
      );

    const snapshot =
      await getDocs(
        friendsQuery
      );

    list.innerHTML = "";

    if (snapshot.empty) {

      empty.classList.remove(
        "hidden"
      );

      return;
    }

    empty.classList.add(
      "hidden"
    );


    snapshot.forEach(
      friendDoc => {

        const friend =
          friendDoc.data();

        const isUser1 =
          friend.user1Uid ===
          currentUser.uid;

        const friendUsername =
          isUser1
            ? friend.user2Username
            : friend.user1Username;


        const item =
          document.createElement(
            "div"
          );

        item.className =
          "friend-result";

        item.innerHTML = `
          <div class="friend-avatar">
            ♡
          </div>

          <div class="friend-info">

            <strong>
              ${escapeHtml(
                friendUsername
              )}
            </strong>

            <small>
              Your Between Us friend ♡
            </small>

          </div>
        `;

        list.appendChild(
          item
        );
      }
    );

  } catch (error) {

    console.error(
      "LOAD FRIENDS ERROR:",
      error
    );

    list.innerHTML = `
      <div class="mini-empty">
        Couldn't load your friends.
      </div>
    `;
  }
}


// -----------------------------------------------------
// Friends panel switching
// -----------------------------------------------------

function showFriendsPanel(
  panel
) {

  $("findFriendsPanel")
    .classList
    .toggle(
      "hidden",
      panel !== "find"
    );

  $("friendRequestsPanel")
    .classList
    .toggle(
      "hidden",
      panel !== "requests"
    );

  $("friendsListPanel")
    .classList
    .toggle(
      "hidden",
      panel !== "friends"
    );


  $("findFriendsTab")
    .classList
    .toggle(
      "active",
      panel === "find"
    );

  $("friendRequestsTab")
    .classList
    .toggle(
      "active",
      panel === "requests"
    );

  $("friendsListTab")
    .classList
    .toggle(
      "active",
      panel === "friends"
    );
}


// -----------------------------------------------------
// Friends event listeners
// -----------------------------------------------------

$("friendSearchButton")
  ?.addEventListener(
    "click",
    searchFriendByUsername
  );


$("friendSearchInput")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key === "Enter"
      ) {

        event.preventDefault();

        searchFriendByUsername();
      }
    }
  );


$("findFriendsTab")
  ?.addEventListener(
    "click",
    () =>
      showFriendsPanel(
        "find"
      )
  );


$("friendRequestsTab")
  ?.addEventListener(
    "click",
    showFriendRequests
  );


$("friendsListTab")
  ?.addEventListener(
    "click",
    showFriendsList
  );


/* =========================================================
   AUTH / START
========================================================= */

async function boot() {

  username ="";
  
const firestoreUsername =
  await loadUsername();

if (firestoreUsername) {

  username =
    firestoreUsername;

  localStorage.setItem(
    "betweenUsUsername",
    username
  );

} else {

  /*
   * Firestore has no username for this UID.
   * Remove any stale browser copy.
   */
  localStorage.removeItem(
    "betweenUsUsername"
  );

  username = "";
}

  try {

    /*
     * If Firebase already has a registered user,
     * Firebase will restore that session.
     *
     * Otherwise this creates/restores an anonymous
     * Firebase user so a new person can create an
     * account while keeping the same UID/data.
     */
    currentUser =
      await startAnonymousAuth();

    console.log(
      "CURRENT USER:",
      currentUser
    );

    console.log(
      "CURRENT UID:",
      currentUser.uid
    );

    console.log(
      "IS ANONYMOUS:",
      currentUser.isAnonymous
    );


    /* =====================================================
       CHECK URL FIRST
    ===================================================== */

    const gameId =
      getParam("game");

    const listId =
      getParam("list");


    /*
     * A shared game/list can still be opened directly.
     *
     * We don't force the visitor through the account
     * screen before opening an existing shared link.
     */

    if (gameId) {

      await loadPlayerGame(
        gameId
      );

      return;
    }

    if (listId) {

      await loadPlayerList(
        listId
      );

      return;
    }


    /* =====================================================
       LOAD USERNAME FROM FIRESTORE
    ===================================================== */

    const firestoreUsername =
      await loadUsername();

    if (firestoreUsername) {

      username =
        firestoreUsername;

      localStorage.setItem(
        "betweenUsUsername",
        username
      );
    }


    updateUsernameDisplay();


    /* =====================================================
       REGISTERED ACCOUNT
    ===================================================== */

    if (
      currentUser &&
      !currentUser.isAnonymous
    ) {

      if (!username) {

        /*
         * This shouldn't normally happen, but if it does,
         * let the user create their profile username.
         */
        showUsernameScreen(
          "create",
          true
        );

        return;
      }

      $("homeContent")
        .classList
        .remove("hidden");

      showScreen(
        "landingScreen"
      );

      await loadDashboard();

      return;
    }


    /* =====================================================
       ANONYMOUS ACCOUNT WITH EXISTING USERNAME
    ===================================================== */

    if (
      currentUser &&
      currentUser.isAnonymous &&
      username
    ) {

      /*
       * This is an older anonymous Between Us space.
       *
       * Give the user the choice to secure it with a
       * password or continue anonymously.
       */
      showUsernameScreen(
        "create",
        true
      );

      return;
    }


    /* =====================================================
       BRAND NEW USER
    ===================================================== */

    showUsernameScreen(
      "create",
      false
    );

  } catch (error) {

    console.error(
      "BOOT ERROR:",
      error
    );

    showScreen(
      "landingScreen"
    );

    toast(
      "Something went wrong connecting to Firebase."
    );
  }
}

/* =========================================================
   NAVIGATION BUTTONS
========================================================= */

$("homeButton")
  .addEventListener("click", () => {

    setParam("game", null);
    setParam("list", null);

    showScreen("landingScreen");

    loadDashboard();
  });

$("backButton")
  .addEventListener("click", () => {

    setParam("game", null);
    setParam("list", null);

    showScreen("landingScreen");

    loadDashboard();
  });

$("finishHomeButton")
  .addEventListener("click", () => {

    setParam("game", null);
    setParam("list", null);

    showScreen("landingScreen");

    loadDashboard();
  });

$("createQuestionsButton")
  .addEventListener(
    "click",
    startQuestionCreator
  );

$("createListButton")
  .addEventListener(
    "click",
    startListCreator
  );

$("createGroupButton")
  .addEventListener(
    "click",
    () => {

      $("groupTitle").value = "";

      showScreen(
        "groupCreatorScreen"
      );
    }
  );

  
/* =========================================================
   QUESTIONS FROM FRIENDS
========================================================= */

async function loadIncomingFriendQuestions() {
  const dashboard = $("dashboardContent");

  if (!dashboard || !currentUser) return;

  // Remove the old section before refreshing it.
  dashboard.querySelector("#incomingFriendQuestions")?.remove();

  try {
    const questionsQuery = query(
      collection(db, "friendQuestions"),
      where("toUid", "==", currentUser.uid)
    );

    const snapshot = await getDocs(questionsQuery);

    const questions = snapshot.docs
      .map(d => ({
        id: d.id,
        ...d.data()
      }))
      .sort(
        (a, b) =>
          (b.createdAt?.seconds || 0) -
          (a.createdAt?.seconds || 0)
      );

    const section = document.createElement("section");
    section.id = "incomingFriendQuestions";
    section.className = "friend-inbox";

    section.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">A little something for you</p>
          <h2>♡ Questions from Friends</h2>
        </div>
        <span class="friend-question-count">
          ${questions.filter(q => q.status === "pending").length} new
        </span>
      </div>

      <div class="friend-inbox-list">
        ${
          questions.length
            ? questions.map(q => {
                const answered = q.status === "answered";

                const options = Array.isArray(q.options)
                  ? q.options
                  : [];

                return `
                  <article
                    class="friend-question-card"
                    data-question-id="${escapeHtml(q.id)}"
                  >
                    <p class="muted">
                      From ${escapeHtml(q.fromUsername || "A friend")}
                    </p>

                    <h3>${escapeHtml(q.question || "")}</h3>

                    ${
                      answered
                        ? `
                          <p class="friend-answer-status">
                            ✓ You answered this question
                          </p>
                          <p>
                            Your answer: ${escapeHtml(q.answer || "")}
                          </p>
                        `
                        : q.answerType === "options"
                          ? `
                            <div class="friend-answer-options">
                              ${options.map((option, index) => `
                                <label class="friend-answer-option">
                                  <input
                                    type="radio"
                                    name="friend-answer-${escapeHtml(q.id)}"
                                    value="${escapeHtml(option)}"
                                  >
                                  <span>${escapeHtml(option)}</span>
                                </label>
                              `).join("")}

                              ${
                                q.allowCustomAnswer
                                  ? `
                                    <label for="custom-${escapeHtml(q.id)}">
                                      Or write your own answer
                                    </label>
                                    <textarea
                                      id="custom-${escapeHtml(q.id)}"
                                      class="text-input friend-custom-answer"
                                      maxlength="2000"
                                      placeholder="Your own answer..."
                                    ></textarea>
                                  `
                                  : ""
                              }
                            </div>

                            <button
                              type="button"
                              class="soft-button answer-friend-question"
                            >
                              Send answer ♡
                            </button>
                          `
                          : `
                            <textarea
                              class="text-input friend-written-answer"
                              maxlength="2000"
                              placeholder="Write your answer..."
                            ></textarea>

                            <button
                              type="button"
                              class="soft-button answer-friend-question"
                            >
                              Send answer ♡
                            </button>
                          `
                    }
                  </article>
                `;
              }).join("")
            : `
              <div class="empty-state">
                <span>💌</span>
                <h3>No questions just yet</h3>
                <p>Questions your friends send you will appear here.</p>
              </div>
            `
        }
      </div>
    `;

    dashboard.appendChild(section);

    section
      .querySelectorAll(".answer-friend-question")
      .forEach(button => {
        button.addEventListener("click", async () => {
          const card = button.closest("[data-question-id]");
          const questionId = card.dataset.questionId;

          const question = questions.find(
            q => q.id === questionId
          );

          if (!question || question.status !== "pending") {
            return;
          }

          const customAnswer = card
            .querySelector(".friend-custom-answer")
            ?.value.trim() || "";

          const selectedOption = card
            .querySelector('input[type="radio"]:checked')
            ?.value || "";

          const writtenAnswer = card
            .querySelector(".friend-written-answer")
            ?.value.trim() || "";

          const answer =
            writtenAnswer ||
            customAnswer ||
            selectedOption;

          if (!answer) {
            toast("Write or choose an answer first.");
            return;
          }

          button.disabled = true;
          button.textContent = "Sending...";

          try {
            await updateDoc(
              doc(db, "friendQuestions", questionId),
              {
                answer,
                status: "answered",
                answeredAt: serverTimestamp()
              }
            );

            toast("Your answer was sent ♡");
            await loadIncomingFriendQuestions();
          } catch (error) {
            console.error("ANSWER FRIEND QUESTION ERROR:", error);
            toast("Couldn't send your answer.");
            button.disabled = false;
            button.textContent = "Send answer ♡";
          }
        });
      });

  } catch (error) {
    console.error("LOAD INCOMING FRIEND QUESTIONS ERROR:", error);

    const section = document.createElement("section");
    section.id = "incomingFriendQuestions";
    section.innerHTML = `
      <div class="empty-state">
        <span>🌧️</span>
        <h3>Couldn't load friend questions</h3>
        <p>Please refresh and try again.</p>
      </div>
    `;

    dashboard.appendChild(section);
  }
}

/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard() {

  $("dashboardContent").innerHTML =
    `<div class="loading-inline">
      Loading your things… ✨
    </div>`;

  try {

    console.log(
      "Loading dashboard for UID:",
      currentUser.uid
    );

    /* ---------- GAMES ---------- */

    const gamesSnap =
      await getDocs(
        collection(db, "games")
      );

    console.log(
      "ALL GAMES IN FIRESTORE:",
      gamesSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }))
    );

    dashboardGames =
      gamesSnap.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .filter(
          game =>
            game.creatorId ===
            currentUser.uid
        );

    console.log(
      "MY GAMES:",
      dashboardGames
    );


/* ---------- LISTS ---------- */

const listsSnap = await getDocs(
  collection(db, "lists")
);

const allLists = listsSnap.docs.map(d => ({
  id: d.id,
  ...d.data()
}));

// Lists I created
dashboardLists = allLists.filter(
  list => list.creatorId === currentUser.uid
);

// Lists other people shared with me
dashboardSharedLists = allLists.filter(
  list =>
    list.sharedWithUid === currentUser.uid &&
    list.creatorId !== currentUser.uid
);

    /* ---------- GROUPS ---------- */

    const groupsSnap =
      await getDocs(
        collection(db, "listGroups")
      );

    dashboardGroups =
      groupsSnap.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .filter(
          group =>
            group.creatorId ===
            currentUser.uid
        );

    /* ---------- SORT ---------- */

    dashboardGames.sort(
      (a, b) =>
        (b.createdAt?.seconds || 0) -
        (a.createdAt?.seconds || 0)
    );

    dashboardLists.sort(
      (a, b) =>
        (b.createdAt?.seconds || 0) -
        (a.createdAt?.seconds || 0)
    );

    dashboardSharedLists.sort(
  (a, b) =>
    (b.createdAt?.seconds || 0) -
    (a.createdAt?.seconds || 0)
);

    dashboardGroups.sort(
      (a, b) =>
        (a.title || "")
          .localeCompare(
            b.title || ""
          )
    );

renderDashboard();

populateGroupSelect();
await populateFriendDropdowns();
await loadIncomingFriendQuestions();
await loadSentFriendQuestions();

  } catch (error) {

    console.error(
      "DASHBOARD ERROR:",
      error
    );

    $("dashboardContent").innerHTML = `
      <div class="empty-state">
        <span>🌧️</span>
        <h3>Couldn't load your dashboard</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}

/* =========================================================
   RESPONSE COUNT
========================================================= */

async function getResponseCount(gameId) {

  try {

    const snap =
      await getDocs(
        collection(
          db,
          "games",
          gameId,
          "responses"
        )
      );

    return snap.size;

  } catch {

    return 0;
  }
}

/* =========================================================
   RENDER DASHBOARD
========================================================= */

async function renderDashboard() {

  const content =
    $("dashboardContent");

  if (
    !dashboardGames.length &&
    !dashboardLists.length &&
    !dashboardSharedLists.length &&
    !dashboardGroups.length
  ) {

    content.innerHTML = `
      <div class="empty-state">
        <span>🌷</span>
        <h3>Nothing here yet</h3>
        <p>
          Create a question game or a list
          and it'll show up here.
        </p>
      </div>
    `;

    return;
  }

  let html = "";

  /* ---------- GAMES ---------- */

  if (dashboardGames.length) {

    html += `
      <div class="dashboard-section">
        <div class="section-label">
          💭 QUESTION GAMES
        </div>
    `;

    for (const game of dashboardGames) {

      const count =
        await getResponseCount(
          game.id
        );

      html += `
        <article class="dashboard-card">

          <div class="dashboard-icon">
            💭
          </div>

          <div class="dashboard-main">

            <h3>
              ${escapeHtml(
                game.title ||
                "Untitled questions"
              )}
            </h3>

            <p>
              ${game.questions?.length || 0}
              questions ·
              ${count}
              saved response${count === 1 ? "" : "s"}
            </p>

          </div>

          <div class="dashboard-actions">

            <button
              class="soft-button small"
              data-action="results"
              data-id="${game.id}"
            >
              View results
            </button>

            <button
              class="soft-button small"
              data-action="edit-game"
              data-id="${game.id}"
            >
              Edit
            </button>

            <button
              class="icon-button danger"
              data-action="delete-game"
              data-id="${game.id}"
              aria-label="Delete game"
            >
              ×
            </button>

          </div>

        </article>
      `;
    }

    html += `</div>`;
  }

  /* ---------- GROUPS ---------- */

  if (dashboardGroups.length) {

    html += `
      <div class="dashboard-section">

        <div class="section-label">
          ☑️ LIST GROUPS
        </div>
    `;

    for (const group of dashboardGroups) {

      const lists =
        dashboardLists.filter(
          l =>
            l.groupId === group.id
        );

      html += `
        <div class="group-card">

          <div class="group-heading">

            <div>
              <span class="group-icon">
                📚
              </span>

              <h3>
                ${escapeHtml(
                  group.title
                )}
              </h3>
            </div>

            <button
              class="icon-button danger"
              data-action="delete-group"
              data-id="${group.id}"
              aria-label="Delete group"
            >
              ×
            </button>

          </div>

          ${
            lists.length
              ? lists
                  .map(renderDashboardList)
                  .join("")
              : `
                <p class="mini-empty">
                  No lists in this group yet.
                </p>
              `
          }

        </div>
      `;
    }

    html += `</div>`;
  }

  /* ---------- UNGROUPED LISTS ---------- */

  const ungrouped =
    dashboardLists.filter(
      l => !l.groupId
    );

  if (ungrouped.length) {

    html += `
      <div class="dashboard-section">

        <div class="section-label">
          ☑️ LISTS
        </div>

        ${ungrouped
          .map(renderDashboardList)
          .join("")}

      </div>
    `;
  }

  
/* ---------- SHARED WITH ME ---------- */

if (dashboardSharedLists.length) {
  html += `
    <div class="dashboard-section">
      <div class="section-label">
        ♡ SHARED WITH ME
      </div>
  `;

  for (const list of dashboardSharedLists) {
    html += `
      <article class="dashboard-card compact">
        <div class="dashboard-icon">☑️</div>

        <div class="dashboard-main">
          <h3>
            ${escapeHtml(list.title || "Untitled list")}
          </h3>

          <p>
            Shared by ${escapeHtml(list.creatorUsername || "a friend")}
            · ${list.itemCount ?? 0} items
            · ${escapeHtml(PERMISSIONS[list.permission] || PERMISSIONS.view)}
          </p>
        </div>

        <div class="dashboard-actions">
          <button
            class="soft-button small"
            data-action="open-list"
            data-id="${list.id}"
          >
            Open
          </button>
        </div>
      </article>
    `;
  }

  html += `</div>`;
}

  content.innerHTML = html;

  attachDashboardActions();
}

/* =========================================================
   DASHBOARD LIST
========================================================= */

function renderDashboardList(list) {

  const itemsCount =
    list.itemCount ?? 0;

  return `
    <article class="dashboard-card compact">

      <div class="dashboard-icon">
        ☑️
      </div>

      <div class="dashboard-main">

        <h3>
          ${escapeHtml(
            list.title ||
            "Untitled list"
          )}
        </h3>

        <p>
          ${itemsCount}
          item${itemsCount === 1 ? "" : "s"} ·
          ${
            PERMISSIONS[list.permission] ||
            PERMISSIONS.view
          }
        </p>

      </div>

      <div class="dashboard-actions">

        <button
          class="soft-button small"
          data-action="manage-list"
          data-id="${list.id}"
        >
          Manage
        </button>

        <button
          class="soft-button small"
          data-action="open-list"
          data-id="${list.id}"
        >
          Open
        </button>

        <button
          class="icon-button danger"
          data-action="delete-list"
          data-id="${list.id}"
          aria-label="Delete list"
        >
          ×
        </button>

      </div>

    </article>
  `;
}

/* =========================================================
   DASHBOARD ACTIONS
========================================================= */

function attachDashboardActions() {

  document
    .querySelectorAll("[data-action]")
    .forEach(button => {

      button.addEventListener(
        "click",
        async () => {

          const action =
            button.dataset.action;

          const id =
            button.dataset.id;

          if (action === "results")
            await openResponses(id);

          if (action === "edit-game")
            await editGame(id);

          if (action === "delete-game")
            await deleteGame(id);

          if (action === "manage-list")
            await openListManager(id);

          if (action === "open-list")
            await openCreatorList(id);

          if (action === "delete-list")
            await deleteList(id);

          if (action === "delete-group")
            await deleteGroup(id);

        }
      );

    });
}

/* =========================================================
   DELETE GAME
========================================================= */

async function deleteGame(id) {

  if (
    !confirm(
      "Delete this question game? Its saved responses will no longer be accessible."
    )
  ) {
    return;
  }

  try {

    await deleteDoc(
      doc(db, "games", id)
    );

    toast(
      "Question game deleted."
    );

    await loadDashboard();

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't delete the game."
    );
  }
}

/* =========================================================
   DELETE GROUP
========================================================= */

async function deleteGroup(id) {

  const lists =
    dashboardLists.filter(
      l => l.groupId === id
    );

  if (
    lists.length &&
    !confirm(
      "This group contains lists. Delete the group and leave those lists ungrouped?"
    )
  ) {
    return;
  }

  try {

    for (const list of lists) {

      await updateDoc(
        doc(
          db,
          "lists",
          list.id
        ),
        {
          groupId: null,
          updatedAt:
            serverTimestamp()
        }
      );
    }

    await deleteDoc(
      doc(
        db,
        "listGroups",
        id
      )
    );

    toast(
      "Group deleted."
    );

    await loadDashboard();

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't delete the group."
    );
  }
}

/* =========================================================
   DELETE LIST
========================================================= */

async function deleteList(id) {

  if (!confirm("Delete this list?")) {
    return;
  }

  try {

    const itemsSnap =
      await getDocs(
        collection(
          db,
          "lists",
          id,
          "items"
        )
      );

    await Promise.all(
      itemsSnap.docs.map(
        d => deleteDoc(d.ref)
      )
    );

    await deleteDoc(
      doc(
        db,
        "lists",
        id
      )
    );

    toast(
      "List deleted."
    );

    await loadDashboard();

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't delete the list."
    );
  }
}

/* =========================================================
   GROUPS
========================================================= */

$("saveGroupButton")
  .addEventListener(
    "click",
    async () => {

      const title =
        $("groupTitle")
          .value
          .trim();

      if (!title) {
        return toast(
          "Give the group a title first."
        );
      }

      try {

        await addDoc(
          collection(
            db,
            "listGroups"
          ),
          {
            creatorId:
              currentUser.uid,

            title,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );

        toast(
          "Group created ✨"
        );

        showScreen(
          "landingScreen"
        );

        await loadDashboard();

      } catch (e) {

        console.error(e);

        toast(
          "Couldn't create the group."
        );
      }
    }
  );

/* =========================================================
   QUESTION CREATOR
========================================================= */

function resetQuestionCreator() {

  creatorQuestions = [];

  editingQuestionId = null;

  currentGameId = null;
  currentGame = null;

  $("gameTitle").value = "";

  $("questionInput").value = "";

  document
    .querySelector(
      'input[name="category"][value="very-light"]'
    )
    .checked = true;

  document
    .querySelector(
      'input[name="answerType"][value="written"]'
    )
    .checked = true;

  $("allowCustomAnswer")
    .checked = false;

  $("gameCreatedArea")
    .classList
    .add("hidden");

  $("gameLink").value = "";

  $("questionList")
    .innerHTML = "";

  $("questionEmpty")
    .classList
    .remove("hidden");

  $("cancelEditQuestionButton")
    .classList
    .add("hidden");

  $("optionsList")
    .innerHTML = "";

  renderOptionsEditor();
}

/* =========================================================
   START QUESTION CREATOR
========================================================= */

async function startQuestionCreator(
  existingGame = null
) {

  resetQuestionCreator();

  if (existingGame) {

    $("gameTitle").value =
      existingGame.title || "";

    creatorQuestions =
      structuredClone(
        existingGame.questions || []
      );

    currentGameId =
      existingGame.id;

    renderQuestionList();

    /*
     * Existing game already has questions,
     * so the game-ready section can be shown.
     *
     * This does NOT create a new game.
     */
    if (creatorQuestions.length > 0) {

      $("gameLink").value =
        makeGameLink(
          currentGameId
        );

      $("gameCreatedArea")
        .classList
        .remove("hidden");
    }
  }

  showScreen(
    "questionCreatorScreen"
  );
}
/* =========================================================
   ANSWER TYPE
========================================================= */

document
  .querySelectorAll(
    'input[name="answerType"]'
  )
  .forEach(input => {

    input.addEventListener(
      "change",
      renderOptionsEditor
    );

  });

/* =========================================================
   CATEGORY
========================================================= */

document
  .querySelectorAll(
    'input[name="category"]'
  )
  .forEach(input => {

    input.addEventListener(
      "change",
      () => {

        document
          .querySelectorAll(
            ".category-choice"
          )
          .forEach(x =>
            x.classList.remove(
              "active"
            )
          );

        input
          .closest(
            ".category-choice"
          )
          ?.classList
          .add("active");
      }
    );

  });

/* =========================================================
   OPTIONS EDITOR
========================================================= */

function renderOptionsEditor() {

  const isOptions =
    document
      .querySelector(
        'input[name="answerType"]:checked'
      )
      ?.value === "options";

  $("optionsEditor")
    .classList
    .toggle(
      "hidden",
      !isOptions
    );

  if (
    isOptions &&
    !$("optionsList").children.length
  ) {

    addOptionRow();
    addOptionRow();

  }
}

function addOptionRow(
  value = ""
) {

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "option-editor-row";

  row.innerHTML = `
    <input
      class="text-input option-value"
      maxlength="160"
      placeholder="Answer choice"
      value="${escapeHtml(value)}"
    >

    <button
      class="icon-button danger remove-option"
      type="button"
    >
      ×
    </button>
  `;

  row
    .querySelector(
      ".remove-option"
    )
    .addEventListener(
      "click",
      () => row.remove()
    );

  $("optionsList")
    .appendChild(row);
}

$("addOptionButton")
  .addEventListener(
    "click",
    () => addOptionRow()
  );

/* =========================================================
   SELECTED CATEGORY
========================================================= */

function getSelectedCategory() {

  return (
    document
      .querySelector(
        'input[name="category"]:checked'
      )
      ?.value ||
    "very-light"
  );
}

/* =========================================================
   QUESTION DRAFT
========================================================= */

function getQuestionDraft() {

  const question =
    $("questionInput")
      .value
      .trim();

  const answerType =
    document
      .querySelector(
        'input[name="answerType"]:checked'
      )
      ?.value ||
    "written";

  const category =
    getSelectedCategory();

  const options =
    [
      ...document.querySelectorAll(
        ".option-value"
      )
    ]
      .map(x =>
        x.value.trim()
      )
      .filter(Boolean);

  const friendMode =
    document
      .querySelector(
        'input[name="friendQuestionMode"]:checked'
      )
      ?.value ||
    "game";

  const friendUid =
    $("questionFriendSelect")
      ?.value ||
    "";

  return {

    id:
      editingQuestionId ||
      makeId(),

    question,

    category,

    answerType,

    options:
      answerType === "options"
        ? options
        : [],

    allowCustomAnswer:
      answerType === "options"
        ? $("allowCustomAnswer")
            .checked
        : false,

    friendMode,

    friendUid
  };
}


/* =========================================================
   SAVE QUESTION
   IMPORTANT:
   FIRST QUESTION CREATES GAME + LINK
   - Normal question → save to game
   - Friend question → save privately to friend
========================================================= */

/* =========================================================
   SAVE QUESTION
   - Normal question → save to game
   - Friend question → save privately to friend
========================================================= */

$("saveQuestionButton").addEventListener(
  "click",
  async () => {

    const draft =
      getQuestionDraft();

    if (!draft.question) {
      return toast(
        "Write the question first."
      );
    }

    if (
      draft.answerType === "options" &&
      draft.options.length < 2
    ) {
      return toast(
        "Add at least two answer choices."
      );
    }


    /* =====================================================
       FRIEND QUESTION
    ===================================================== */


if (draft.friendMode === "friend") {
  if (!draft.friendUid) {
    return toast("Choose a friend first.");
  }

  const selectedFriendOption =
    $("questionFriendSelect").selectedOptions[0];

  const friendUsername =
    selectedFriendOption?.textContent.trim() || "";

  console.log("FRIEND QUESTION DEBUG:", {
    uid: currentUser.uid,
    toUid: draft.friendUid,
    question: draft.question,
    category: draft.category,
    answerType: draft.answerType
  });

  try {
    console.log("STEP 1: Creating friend question...");

    const questionRef = await addDoc(
      collection(db, "friendQuestions"),
      {
        questionId: draft.id,
        question: draft.question,
        category: draft.category,
        answerType: draft.answerType,
        options: draft.options,
        allowCustomAnswer: draft.allowCustomAnswer,
        fromUid: currentUser.uid,
        fromUsername: username || "",
        toUid: draft.friendUid,
        toUsername: friendUsername,
        status: "pending",
        createdAt: serverTimestamp()
      }
    );

    console.log(
      "STEP 2: Friend question created:",
      questionRef.id
    );

    toast("Question sent to your friend ♡");
    clearQuestionForm();
    await loadDashboard();

  } catch (error) {
    console.error(
      "FRIEND QUESTION ERROR:",
      error.code,
      error.message
    );

    toast("Couldn't send the question.");
  }

  return;
}
    
    



    /* =====================================================
       NORMAL GAME QUESTION
    ===================================================== */

    try {

      // Add or update the question
      const index =
        creatorQuestions.findIndex(
          q =>
            q.id === draft.id
        );


      if (index >= 0) {

        creatorQuestions[index] =
          draft;

      } else {

        creatorQuestions.push(
          draft
        );

      }


      // Remove friend-only fields
      // before saving to the game
      const gameQuestions =
        creatorQuestions.map(q => {

          const {
            friendMode,
            friendUid,
            ...gameQuestion
          } = q;

          return gameQuestion;

        });


      renderQuestionList();


      const title =
        $("gameTitle")
          .value
          .trim() ||
        "Between Us Questions";


      /* ===================================================
         CREATE GAME AFTER FIRST QUESTION
      =================================================== */

      if (!currentGameId) {

        const ref =
          await addDoc(
            collection(
              db,
              "games"
            ),
            {

              creatorId:
                currentUser.uid,

              title,

              questions:
                gameQuestions,

              active:
                true,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp()

            }
          );


        currentGameId =
          ref.id;


        toast(
          "Your game is ready ✨"
        );

      } else {

        /* ================================================
           UPDATE EXISTING GAME
        ================================================ */

        await updateDoc(
          doc(
            db,
            "games",
            currentGameId
          ),
          {

            title,

            questions:
              gameQuestions,

            active:
              true,

            updatedAt:
              serverTimestamp()

          }
        );


        toast(
          "Question saved ✨"
        );
      }


      /* ===================================================
         SHOW LINK IMMEDIATELY
      =================================================== */

      $("gameLink").value =
        makeGameLink(
          currentGameId
        );


      $("gameCreatedArea")
        .classList
        .remove("hidden");


      /* ===================================================
         REFRESH DASHBOARD
      =================================================== */

      await loadDashboard();


      /* ===================================================
         CLEAR QUESTION FORM
      =================================================== */

      clearQuestionForm();

    } catch (e) {

      console.error(
        "SAVE QUESTION ERROR:",
        e
      );

      toast(
        "Couldn't save the question."
      );
    }

  }
);
/* =========================================================
   CANCEL EDIT
========================================================= */

$("cancelEditQuestionButton")
  .addEventListener(
    "click",
    clearQuestionForm
  );

/* =========================================================
   RENDER QUESTION LIST
========================================================= */

function renderQuestionList() {

  $("questionCount")
    .textContent =
      `${creatorQuestions.length} question${
        creatorQuestions.length === 1
          ? ""
          : "s"
      }`;

  $("questionEmpty")
    .classList
    .toggle(
      "hidden",
      creatorQuestions.length > 0
    );

  $("questionList")
    .innerHTML =
      creatorQuestions
        .map(
          (q, index) => {

            const cat =
              CATEGORIES[q.category] ||
              CATEGORIES["very-light"];

            return `
              <div class="builder-question">

                <div class="builder-number">
                  ${index + 1}
                </div>

                <div class="builder-question-main">

                  <span
                    class="mini-badge ${cat.scene}"
                  >
                    ${cat.label}
                  </span>

                  <strong>
                    ${escapeHtml(
                      q.question
                    )}
                  </strong>

                  <small>
                    ${
                      q.answerType ===
                      "options"
                        ? `☑️ ${
                            q.options.length
                          } choices${
                            q.allowCustomAnswer
                              ? " + something else"
                              : ""
                          }`
                        : "📝 Written answer"
                    }
                  </small>

                </div>

                <div class="builder-actions">

                  <button
                    class="soft-button small"
                    data-edit-question="${q.id}"
                    type="button"
                  >
                    Edit
                  </button>

                  <button
                    class="icon-button danger"
                    data-delete-question="${q.id}"
                    type="button"
                  >
                    ×
                  </button>

                </div>

              </div>
            `;
          }
        )
        .join("");

  /* ---------- EDIT ---------- */

  document
    .querySelectorAll(
      "[data-edit-question]"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () =>
          loadQuestionForEdit(
            btn.dataset.editQuestion
          )
      );

    });

  /* ---------- DELETE ---------- */

  document
    .querySelectorAll(
      "[data-delete-question]"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        async () => {

          creatorQuestions =
            creatorQuestions.filter(
              q =>
                q.id !==
                btn.dataset
                  .deleteQuestion
            );

          renderQuestionList();

          /*
           * If a game already exists,
           * immediately sync the deletion
           * to Firestore.
           */

          if (currentGameId) {

            try {

              await updateDoc(
                doc(
                  db,
                  "games",
                  currentGameId
                ),
                {
                  questions:
                    creatorQuestions,

                  updatedAt:
                    serverTimestamp()
                }
              );

              toast(
                "Question removed ✨"
              );

            } catch (e) {

              console.error(e);

              toast(
                "Question removed locally, but couldn't sync."
              );
            }
          }
        }
      );

    });
}

/* =========================================================
   LOAD QUESTION FOR EDIT
========================================================= */

function loadQuestionForEdit(id) {

  const q =
    creatorQuestions.find(
      x => x.id === id
    );

  if (!q) {
    return;
  }

  editingQuestionId =
    q.id;

  $("questionInput")
    .value =
      q.question;

  document
    .querySelector(
      `input[name="category"][value="${q.category}"]`
    )
    .checked = true;

  document
    .querySelector(
      `input[name="answerType"][value="${q.answerType}"]`
    )
    .checked = true;

  $("allowCustomAnswer")
    .checked =
      !!q.allowCustomAnswer;

  $("optionsList")
    .innerHTML = "";

  q.options.forEach(
    addOptionRow
  );

  $("cancelEditQuestionButton")
    .classList
    .remove("hidden");

  renderOptionsEditor();

  $("questionInput")
    .focus();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================================================
   GAME LINK
========================================================= */

function makeGameLink(id) {

  const url =
    new URL(
      window.location.href
    );

  url.search = "";

  url.searchParams.set(
    "game",
    id
  );

  return url.toString();
}

/* =========================================================
   GENERATE GAME BUTTON
   Now simply saves/syncs the current game.
========================================================= */



/* =========================================================
   GAME LINK BUTTONS
========================================================= */
const copyLinkButton = $("copyLinkButton");

if (copyLinkButton) {
  copyLinkButton.addEventListener(
    "click",
    async () => {
      const link = $("gameLink").value;

      if (!link) {
        return toast("No game link available.");
      }

      try {
        await navigator.clipboard.writeText(link);
        toast("Link copied 💕");
      } catch (e) {
        console.error("COPY LINK ERROR:", e);
        toast("Couldn't copy the link.");
      }
    }
  );
}


const openCreatedGameButton =
  $("openCreatedGameButton");

if (openCreatedGameButton) {
  openCreatedGameButton.addEventListener(
    "click",
    () => {

      if (!currentGameId) {
        return toast("No game available yet.");
      }

      window.open(
        makeGameLink(currentGameId),
        "_blank"
      );
    }
  );
}


const viewCreatedResponsesButton =
  $("viewCreatedResponsesButton");

if (viewCreatedResponsesButton) {
  viewCreatedResponsesButton.addEventListener(
    "click",
    () => {

      if (!currentGameId) {
        return toast("No game available yet.");
      }

      openResponses(currentGameId);
    }
  );
}


/* =========================================================
   EDIT GAME
========================================================= */

async function editGame(id) {

  const snap =
    await getDoc(
      doc(
        db,
        "games",
        id
      )
    );

  if (!snap.exists()) {

    return toast(
      "That game no longer exists."
    );
  }

  await startQuestionCreator({
    id: snap.id,
    ...snap.data()
  });
}

/* =========================================================
   QUESTION PLAYER
========================================================= */

async function loadPlayerGame(id) {

  try {

    const snap =
      await getDoc(
        doc(
          db,
          "games",
          id
        )
      );

    if (!snap.exists()) {

      showScreen(
        "landingScreen"
      );

      return toast(
        "That question game could not be found."
      );
    }

    currentGameId =
      id;

    currentGame = {
      id,
      ...snap.data()
    };

    currentQuestionIndex =
      0;

    currentResponses = [];

    showScreen(
      "playerScreen"
    );

    renderPlayerQuestion();

  } catch (e) {

    console.error(e);

    showScreen(
      "landingScreen"
    );

    toast(
      "Couldn't open that game."
    );
  }
}

/* =========================================================
   RENDER PLAYER QUESTION
========================================================= */

function renderPlayerQuestion() {

  const q =
    currentGame.questions?.[
      currentQuestionIndex
    ];

  if (!q) {

    return finishQuestions();
  }

  const cat =
    CATEGORIES[q.category] ||
    CATEGORIES["very-light"];

  $("questionProgress")
    .textContent =
      `Question ${
        currentQuestionIndex + 1
      } of ${
        currentGame.questions.length
      }`;

  $("progressBar")
    .style.width =
      `${
        (
          (currentQuestionIndex + 1) /
          currentGame.questions.length
        ) * 100
      }%`;

  $("playerQuestion")
    .textContent =
      q.question;

  const questionHelpButton =
    document.getElementById(
      "questionHelpButton"
    );

  const questionHelpResult =
    document.getElementById(
      "questionHelpResult"
    );

  if (questionHelpButton) {

    questionHelpButton.disabled =
      false;

    questionHelpButton.innerHTML =
      '<span class="ai-bulb">💡</span> Help me understand';
  }

  if (questionHelpResult) {

    questionHelpResult
      .classList
      .add("hidden");

    questionHelpResult
      .textContent = "";
  }

  $("categoryBadge")
    .textContent =
      cat.label;

  $("scene").className =
    `scene ${cat.scene}`;

  $("playerCharacter")
    .textContent =
      randomItem(
        cat.character
      );

  $("sceneDecoration")
    .textContent =
      cat.decoration;

  $("sensitiveBuffer")
    .classList
    .toggle(
      "hidden",
      q.category !==
        "sensitive"
    );

  $("writtenAnswerArea")
    .classList
    .toggle(
      "hidden",
      q.answerType !==
        "written"
    );

  $("choiceAnswerArea")
    .classList
    .toggle(
      "hidden",
      q.answerType !==
        "options"
    );

  $("writtenAnswer")
    .value = "";

  $("customAnswer")
    .value = "";

  if (
    q.answerType ===
    "options"
  ) {

    $("choiceList")
      .innerHTML =
        q.options
          .map(
            (option) => `
              <label class="player-choice">

                <input
                  type="checkbox"
                  value="${escapeHtml(option)}"
                >

                <span>
                  ${escapeHtml(option)}
                </span>

              </label>
            `
          )
          .join("");

    $("customAnswerArea")
      .classList
      .toggle(
        "hidden",
        !q.allowCustomAnswer
      );
  }

  $("nextQuestionButton")
    .textContent =
      currentQuestionIndex ===
      currentGame.questions.length - 1
        ? "Finish ♡"
        : "Save answer →";
}



async function loadQuestionFriends() {
  const select = $("questionFriendSelect");

  if (!select || !currentUser) return;

  select.innerHTML = `
    <option value="">Loading friends...</option>
  `;

  try {
    const friendsQuery = query(
      collection(db, "friendships"),
      where("users", "array-contains", currentUser.uid)
    );

    const snapshot = await getDocs(friendsQuery);

    console.log(
      "QUESTION FRIENDS: documents found:",
      snapshot.size
    );

    select.innerHTML = `
      <option value="">Choose a friend...</option>
    `;

    snapshot.forEach(friendshipDoc => {
      const data = friendshipDoc.data();

      let friendUid = "";
      let friendUsername = "";

      if (data.user1Uid === currentUser.uid) {
        friendUid = data.user2Uid || "";
        friendUsername = data.user2Username || "";
      } else if (data.user2Uid === currentUser.uid) {
        friendUid = data.user1Uid || "";
        friendUsername = data.user1Username || "";
      } else {
        friendUid = (data.users || []).find(
          uid => uid !== currentUser.uid
        ) || "";
      }

      if (!friendUid) return;

      const option = document.createElement("option");
      option.value = friendUid;
      option.textContent = friendUsername || "Friend";

      select.appendChild(option);
    });

    if (snapshot.empty) {
      select.innerHTML = `
        <option value="">No accepted friends found</option>
      `;
    }

  } catch (error) {
    console.error("LOAD QUESTION FRIENDS ERROR:", error);

    select.innerHTML = `
      <option value="">Couldn't load friends</option>
    `;

    toast("Couldn't load your friends.");
  }
}



/* =========================================================
   POPULATE ALL FRIEND DROPDOWNS
========================================================= */

async function populateFriendDropdowns() {
  if (!currentUser) return;

  const selectIds = [
    "questionFriendSelect",
    "listFriendSelect",
    "manageListFriendSelect"
  ];

  const selects = selectIds
    .map(id => $(id))
    .filter(Boolean);

  if (!selects.length) return;

  selects.forEach(select => {
    select.innerHTML = `<option value="">Loading friends...</option>`;
  });

  try {
    const friendsQuery = query(
      collection(db, "friendships"),
      where("users", "array-contains", currentUser.uid)
    );

    const snapshot = await getDocs(friendsQuery);
    const friends = [];

    snapshot.forEach(friendshipDoc => {
      const data = friendshipDoc.data();

      let friendUid = "";
      let friendUsername = "";

      if (data.user1Uid === currentUser.uid) {
        friendUid = data.user2Uid || "";
        friendUsername = data.user2Username || "";
      } else if (data.user2Uid === currentUser.uid) {
        friendUid = data.user1Uid || "";
        friendUsername = data.user1Username || "";
      } else {
        friendUid =
          (data.users || []).find(
            uid => uid !== currentUser.uid
          ) || "";
      }

      if (friendUid) {
        friends.push({
          uid: friendUid,
          username: friendUsername || "Friend"
        });
      }
    });

    friends.sort((a, b) =>
      a.username.localeCompare(b.username)
    );

    selects.forEach(select => {
      // Preserve the dropdown's original first option.
      const firstOption = select.options[0];
      const placeholderText =
        firstOption?.textContent || "Choose a friend...";

      select.innerHTML = "";

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = placeholderText;
      select.appendChild(placeholder);

      friends.forEach(friend => {
        const option = document.createElement("option");
        option.value = friend.uid;
        option.textContent = friend.username;
        select.appendChild(option);
      });

      if (friends.length === 0) {
        placeholder.textContent = "No accepted friends found";
      }
    });

    console.log(
      "FRIEND DROPDOWNS POPULATED:",
      friends.length,
      friends
    );

  } catch (error) {
    console.error("POPULATE FRIEND DROPDOWNS ERROR:", error);

    selects.forEach(select => {
      select.innerHTML =
        `<option value="">Couldn't load friends</option>`;
    });

    toast("Couldn't load your friends.");
  }
}


/* =========================================================
   FRIEND QUESTION TOGGLE
========================================================= */

document
  .querySelectorAll('input[name="friendQuestionMode"]')
  .forEach(radio => {

    radio.addEventListener("change", async () => {

      const selected = document.querySelector(
        'input[name="friendQuestionMode"]:checked'
      )?.value;

      const area = $("friendQuestionSelectArea");

      if (!area) return;

      if (selected === "friend") {

        area.classList.remove("hidden");

        await populateFriendDropdowns();

      } else {

        area.classList.add("hidden");

        $("questionFriendSelect").value = "";

      }

    });

  });

/* =========================================================
   SAVE PLAYER RESPONSE
========================================================= */

async function savePlayerResponse(
  status = "answered"
) {

  const q =
    currentGame.questions[
      currentQuestionIndex
    ];

  let answer = "";

  if (
    status === "answered"
  ) {

    if (
      q.answerType ===
      "written"
    ) {

      answer =
        $("writtenAnswer")
          .value
          .trim();

      if (!answer) {

        return toast(
          "You can write something. ♡"
        );
      }

    } else {

      answer =
        [
          ...document.querySelectorAll(
            "#choiceList input:checked"
          )
        ]
          .map(
            x => x.value
          );

      const custom =
        $("customAnswer")
          .value
          .trim();

      if (custom) {

        answer.push(
          `Something else: ${custom}`
        );
      }

      if (!answer.length) {

        return toast(
          "Choose at least one option, or skip for now. ♡"
        );
      }
    }
  }

  try {

    await addDoc(
      collection(
        db,
        "games",
        currentGameId,
        "responses"
      ),
      {
        questionId:
          q.id,

        question:
          q.question,

        category:
          q.category,

        answer,

        status,

        playerId:
          currentUser.uid,

        createdAt:
          serverTimestamp()
      }
    );

    currentResponses.push({
      questionId:
        q.id,

      status
    });

    currentQuestionIndex++;

    renderPlayerQuestion();

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't save that response. Please try again."
    );
  }
}

/* =========================================================
   NEXT QUESTION
========================================================= */

$("nextQuestionButton")
  .addEventListener(
    "click",
    () =>
      savePlayerResponse(
        "answered"
      )
  );

/* =========================================================
   QUESTION HELP BUTTON
========================================================= */

const questionHelpButton =
  document.getElementById(
    "questionHelpButton"
  );

if (questionHelpButton) {

  questionHelpButton.addEventListener(
    "click",
    explainCurrentQuestion
  );
}

/* =========================================================
   FINISH QUESTIONS
========================================================= */

function finishQuestions() {

  showScreen(
    "finishScreen"
  );

  setParam(
    "game",
    null
  );
}

/* =========================================================
   RESPONSES
========================================================= */

async function openResponses(
  gameId
) {

  try {

    const gameSnap =
      await getDoc(
        doc(
          db,
          "games",
          gameId
        )
      );

    if (!gameSnap.exists()) {

      return toast(
        "Game not found."
      );
    }

    const game = {
      id: gameId,
      ...gameSnap.data()
    };

    if (
      game.creatorId !==
      currentUser.uid
    ) {

      return toast(
        "Only the creator can view results."
      );
    }

    const snap =
      await getDocs(
        collection(
          db,
          "games",
          gameId,
          "responses"
        )
      );

    const responses =
      snap.docs.map(
        d => ({
          id: d.id,
          ...d.data()
        })
      );

    currentResponses =
      responses;

    responses.sort(
      (a, b) =>
        (a.createdAt?.seconds || 0) -
        (b.createdAt?.seconds || 0)
    );

    $("responsesTitle")
      .textContent =
        game.title ||
        "Responses";

    const grouped =
      game.questions.map(
        q => ({
          question: q,

          answers:
            responses.filter(
              r =>
                r.questionId ===
                q.id
            )
        })
      );

    $("responsesList")
      .innerHTML =
        grouped
          .map(
            ({
              question,
              answers
            }) => {

              const cat =
                CATEGORIES[
                  question.category
                ] ||
                CATEGORIES[
                  "very-light"
                ];

              return `
                <article class="response-card">

                  <div class="response-question">

                    <span
                      class="mini-badge ${cat.scene}"
                    >
                      ${cat.label}
                    </span>

                    <h3>
                      ${escapeHtml(
                        question.question
                      )}
                    </h3>

                  </div>

                  ${
                    answers.length
                      ? answers
                          .map(
                            renderResponse
                          )
                          .join("")
                      : `
                        <p class="muted">
                          No response yet.
                        </p>
                      `
                  }

                </article>
              `;
            }
          )
          .join("");

    document
      .querySelectorAll(
        "[data-ai-response]"
      )
      .forEach(button => {

        button.addEventListener(
          "click",
          () => {

            explainResponse(
              button.dataset
                .aiResponse
            );

          }
        );

      });

    showScreen(
      "responsesScreen"
    );

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't load responses."
    );
  }
}

/* =========================================================
   RENDER RESPONSE
========================================================= */

function renderResponse(r) {

  const statusLabel = {

    answered:
      "💗 Answered",

    skipped:
      "🌸 Skipped for now",

    "would-rather-talk":
      "🫶 Would rather talk about this"

  }[r.status] ||
    r.status;

  let answer = "";

  if (
    Array.isArray(r.answer)
  ) {

    answer =
      r.answer.length
        ? `
          <ul>
            ${r.answer
              .map(
                x =>
                  `<li>${escapeHtml(x)}</li>`
              )
              .join("")}
          </ul>
        `
        : "";

  } else {

    answer =
      r.answer
        ? `
          <p>
            ${escapeHtml(
              r.answer
            )}
          </p>
        `
        : "";
  }

  return `
    <div class="response-item">

      <span class="status-pill">
        ${statusLabel}
      </span>

      ${answer}

      <button
        type="button"
        class="ai-help-button"
        data-ai-response="${r.id}"
      >
        ✨ Understand this response
      </button>

      <div
        id="ai-response-${r.id}"
        class="ai-result hidden"
      ></div>

      <small>
        ${formatDate(
          r.createdAt
        )}
      </small>

    </div>
  `;
}

/* =========================================================
   LIGHT / DARK MODE
========================================================= */

function applySavedTheme() {

  const savedTheme =
    localStorage.getItem("betweenUsTheme");

  if (savedTheme === "dark") {
    document.body.classList.add("dark-mode");
  } else {
    document.body.classList.remove("dark-mode");
  }

  updateThemeToggle();
}


function updateThemeToggle() {

  const toggle =
    $("themeToggle");

  if (!toggle) return;

  const isDark =
    document.body.classList.contains("dark-mode");

  toggle.setAttribute(
    "aria-pressed",
    String(isDark)
  );
}


const themeToggle =
  $("themeToggle");

if (themeToggle) {

  themeToggle.addEventListener(
    "click",
    () => {

      const isDark =
        document.body.classList.toggle(
          "dark-mode"
        );

      localStorage.setItem(
        "betweenUsTheme",
        isDark ? "dark" : "light"
      );

      updateThemeToggle();
    }
  );
}


/* Apply theme as soon as the script loads */
applySavedTheme();

/* =========================================================
   LIST CREATOR
========================================================= */

function resetListCreator() {

  currentListId = null;

  $("listTitle")
    .value = "";

  $("listGroupSelect")
    .value = "";

  document
    .querySelector(
      'input[name="permission"][value="view"]'
    )
    .checked = true;

  document
    .querySelectorAll(
      ".permission-choice"
    )
    .forEach(
      x =>
        x.classList.remove(
          "active"
        )
    );

  document
    .querySelector(
      '.permission-choice input[value="view"]'
    )
    .closest(
      ".permission-choice"
    )
    .classList
    .add("active");

  $("startWithItems")
    .checked = true;

  $("starterItemsList")
    .innerHTML = "";

  addStarterItemRow();
  addStarterItemRow();

  $("listCreatedArea")
    .classList
    .add("hidden");
}

/* =========================================================
   QUESTIONS I SENT TO FRIENDS
========================================================= */

async function loadSentFriendQuestions() {
  const dashboard = $("dashboardContent");

  if (!dashboard || !currentUser) return;

  dashboard.querySelector("#sentFriendQuestions")?.remove();

  try {
    const sentQuery = query(
      collection(db, "friendQuestions"),
      where("fromUid", "==", currentUser.uid)
    );

    const snapshot = await getDocs(sentQuery);

    const questions = snapshot.docs
      .map(d => ({
        id: d.id,
        ...d.data()
      }))
      .sort(
        (a, b) =>
          (b.createdAt?.seconds || 0) -
          (a.createdAt?.seconds || 0)
      );

    const section = document.createElement("section");
    section.id = "sentFriendQuestions";
    section.className = "friend-inbox";

    section.innerHTML = `
      <div class="section-heading">
        <div>
          <p class="eyebrow">Your little messages</p>
          <h2>♡ Questions I've Sent</h2>
        </div>
      </div>

      <div class="friend-inbox-list">
        ${
          questions.length
            ? questions.map(q => `
                <article class="friend-question-card">
                  <p class="muted">
                    To ${escapeHtml(q.toUsername || "Your friend")}
                  </p>

                  <h3>${escapeHtml(q.question || "")}</h3>

                  ${
                    q.status === "answered"
                      ? `
                        <p class="friend-answer-status">
                          ✓ Your friend answered
                        </p>
                        <p>
                          <strong>Their response:</strong>
                          ${escapeHtml(q.answer || "")}
                        </p>
                      `
                      : `
                        <p class="muted">
                          💌 Waiting for their answer...
                        </p>
                      `
                  }
                </article>
              `).join("")
            : `
              <div class="empty-state">
                <span>💌</span>
                <h3>No questions sent yet</h3>
                <p>Questions you send to friends will appear here.</p>
              </div>
            `
        }
      </div>
    `;

    dashboard.appendChild(section);

  } catch (error) {
    console.error("LOAD SENT FRIEND QUESTIONS ERROR:", error);

    toast("Couldn't load your sent questions.");
  }
}

/* =========================================================
   GROUP SELECT
========================================================= */

function populateGroupSelect() {

  $("listGroupSelect")
    .innerHTML =
      `<option value="">
        No group
      </option>` +

      dashboardGroups
        .map(
          g =>
            `<option value="${g.id}">
              ${escapeHtml(
                g.title
              )}
            </option>`
        )
        .join("");
}

/* =========================================================
   START LIST CREATOR
========================================================= */

function startListCreator() {

  resetListCreator();

  showScreen(
    "listCreatorScreen"
  );
}

/* =========================================================
   LIST PERMISSIONS
========================================================= */

document
  .querySelectorAll(
    'input[name="permission"]'
  )
  .forEach(input => {

    input.addEventListener(
      "change",
      () => {

        document
          .querySelectorAll(
            ".permission-choice"
          )
          .forEach(
            x =>
              x.classList.remove(
                "active"
              )
          );

        input
          .closest(
            ".permission-choice"
          )
          ?.classList
          .add("active");
      }
    );

  });

/* =========================================================
   START WITH ITEMS
========================================================= */

$("startWithItems")
  .addEventListener(
    "change",
    () => {

      $("starterItemsArea")
        .classList
        .toggle(
          "hidden",
          !$("startWithItems")
            .checked
        );
    }
  );

/* =========================================================
   STARTER ITEMS
========================================================= */

function addStarterItemRow(
  value = ""
) {

  const row =
    document.createElement(
      "div"
    );

  row.className =
    "option-editor-row";

  row.innerHTML = `
    <input
      class="text-input starter-item-value"
      maxlength="200"
      placeholder="List item"
      value="${escapeHtml(value)}"
    >

    <button
      class="icon-button danger remove-starter"
      type="button"
    >
      ×
    </button>
  `;

  row
    .querySelector(
      ".remove-starter"
    )
    .addEventListener(
      "click",
      () => row.remove()
    );

  $("starterItemsList")
    .appendChild(row);
}

$("addStarterItemButton")
  .addEventListener(
    "click",
    () =>
      addStarterItemRow()
  );

/* =========================================================
   LIST LINK
========================================================= */

function makeListLink(id) {

  const url =
    new URL(
      window.location.href
    );

  url.search = "";

  url.searchParams.set(
    "list",
    id
  );

  return url.toString();
}


/* =========================================================
   CREATE LIST
========================================================= */

$("createListSaveButton").addEventListener("click", async () => {
  if (!currentUser) {
    toast("Please sign in first.");
    return;
  }

  const title =
    $("listTitle").value.trim() || "Our List";

  const permission =
    document.querySelector('input[name="permission"]:checked')
      ?.value || "view";

  const groupId =
    $("listGroupSelect").value || null;

  // Get the selected friend, if one was chosen.
  const friendSelect = $("listFriendSelect");
  const friendUid = friendSelect?.value || null;

  const friendUsername = friendUid
    ? friendSelect.selectedOptions[0]?.textContent.trim() || ""
    : "";

  const items = $("startWithItems").checked
    ? [...document.querySelectorAll(".starter-item-value")]
        .map(input => input.value.trim())
        .filter(Boolean)
    : [];

  try {
    const ref = await addDoc(collection(db, "lists"), {
      creatorId: currentUser.uid,
      creatorUsername: username || "",
      title,
      groupId,
      permission,

      // Sharing information
      sharedWithUid: friendUid,
      sharedWithUsername: friendUsername,
      sharedAt: friendUid ? serverTimestamp() : null,

      itemCount: items.length,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentListId = ref.id;

    for (const text of items) {
      await addDoc(
        collection(db, "lists", currentListId, "items"),
        {
          text,
          checked: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      );
    }

    $("listLink").value = makeListLink(currentListId);

    $("listCreatedArea").classList.remove("hidden");

    toast(
      friendUid
        ? `List created and shared with ${friendUsername} ✨`
        : "List created ✨"
    );

    await loadDashboard();

  } catch (e) {
    console.error("CREATE LIST ERROR:", e);
    toast("Couldn't create the list.");
  }
});

/* =========================================================
   LIST BUTTONS
========================================================= */

$("copyListLinkButton")
  .addEventListener(
    "click",
    () =>
      copyText(
        $("listLink").value
      )
  );

$("openCreatedListButton")
  .addEventListener(
    "click",
    () =>
      window.open(
        makeListLink(
          currentListId
        ),
        "_blank"
      )
  );

$("manageCreatedListButton")
  .addEventListener(
    "click",
    () =>
      openListManager(
        currentListId
      )
  );

/* =========================================================
   LIST PLAYER
========================================================= */

async function loadPlayerList(id) {

  try {

    const snap =
      await getDoc(
        doc(
          db,
          "lists",
          id
        )
      );

    if (!snap.exists()) {

      showScreen(
        "landingScreen"
      );

      return toast(
        "That list could not be found."
      );
    }

    currentListId =
      id;

    currentList = {
      id,
      ...snap.data()
    };

    await refreshPlayerListItems();

    showScreen(
      "listPlayerScreen"
    );

    renderPlayerList();

  } catch (e) {

    console.error(e);

    showScreen(
      "landingScreen"
    );

    toast(
      "Couldn't open that list."
    );
  }
}

/* =========================================================
   REFRESH LIST ITEMS
========================================================= */

async function refreshPlayerListItems() {

  const snap =
    await getDocs(
      collection(
        db,
        "lists",
        currentListId,
        "items"
      )
    );

  currentListItems =
    snap.docs.map(
      d => ({
        id: d.id,
        ...d.data()
      })
    );

  currentListItems.sort(
    (a, b) =>
      (a.createdAt?.seconds || 0) -
      (b.createdAt?.seconds || 0)
  );
}

/* =========================================================
   CLEAR QUESTION FORM
========================================================= */

function clearQuestionForm() {

  editingQuestionId = null;


  $("questionInput")
    .value = "";


  document
    .querySelector(
      'input[name="category"][value="very-light"]'
    )
    .checked = true;


  document
    .querySelector(
      'input[name="answerType"][value="written"]'
    )
    .checked = true;


  $("allowCustomAnswer")
    .checked = false;


  $("optionsList")
    .innerHTML = "";


  $("cancelEditQuestionButton")
    .classList
    .add("hidden");



/* =========================================================
   LOAD ACCEPTED FRIENDS INTO QUESTION SELECT
========================================================= */

async function loadQuestionFriends() {

  const select = $("questionFriendSelect");

  if (!select || !currentUser) {
    return;
  }

  select.innerHTML = `
    <option value="">Loading friends...</option>
  `;

  try {

    const friendsQuery = query(
      collection(db, "friendships"),
      where("users", "array-contains", currentUser.uid)
    );

    const snapshot = await getDocs(friendsQuery);

    console.log(
      "QUESTION FRIENDS: friendship documents found:",
      snapshot.size
    );

    select.innerHTML = `
      <option value="">Choose a friend...</option>
    `;

    snapshot.forEach(friendshipDoc => {

      const data = friendshipDoc.data();

      let friendUid = "";
      let friendUsername = "";

      if (data.user1Uid === currentUser.uid) {

        friendUid = data.user2Uid || "";
        friendUsername = data.user2Username || "";

      } else if (data.user2Uid === currentUser.uid) {

        friendUid = data.user1Uid || "";
        friendUsername = data.user1Username || "";

      } else {

        // Fallback if the document only has a users array.
        const otherUid = (data.users || []).find(
          uid => uid !== currentUser.uid
        );

        friendUid = otherUid || "";

      }

      if (!friendUid) {
        console.warn(
          "Friendship has no identifiable friend:",
          friendshipDoc.id,
          data
        );
        return;
      }

      const option = document.createElement("option");

      option.value = friendUid;
      option.textContent = friendUsername || "Friend";

      select.appendChild(option);

      console.log(
        "QUESTION FRIEND ADDED:",
        friendUsername || "(username missing)",
        friendUid
      );

    });

    if (snapshot.empty) {
      select.innerHTML = `
        <option value="">No accepted friends found</option>
      `;
    }

  } catch (error) {

    console.error(
      "LOAD QUESTION FRIENDS ERROR:",
      error
    );

    select.innerHTML = `
      <option value="">Couldn't load friends</option>
    `;

    toast("Couldn't load your friends.");

  }
}

  /* =====================================================
     RESET FRIEND QUESTION
  ===================================================== */

  const gameMode =
    document.querySelector(
      'input[name="friendQuestionMode"][value="game"]'
    );

  if (gameMode) {
    gameMode.checked = true;
  }


  const friendSelect =
    $("questionFriendSelect");

  if (friendSelect) {
    friendSelect.value = "";
  }


  const friendSelectArea =
    $("friendQuestionSelectArea");

  if (friendSelectArea) {
    friendSelectArea
      .classList
      .add("hidden");
  }


  renderOptionsEditor();

}

/* =========================================================
   LIST PERMISSION HELPERS
========================================================= */

function canCheck(permission) {

  return [
    "check",
    "edit",
    "full"
  ].includes(permission);
}

function canEdit(permission) {

  return [
    "edit",
    "full"
  ].includes(permission);
}

function canDelete(permission) {

  return permission ===
    "full";
}

/* =========================================================
   RENDER PLAYER LIST
========================================================= */

function renderPlayerList() {

  const permission =
    currentList.permission ||
    "view";

  $("playerListTitle")
    .textContent =
      currentList.title ||
      "Shared List";

  $("playerListPermission")
    .textContent =
      PERMISSIONS[
        permission
      ] ||
      PERMISSIONS.view;

  $("playerListItems")
    .innerHTML =
      currentListItems.length

        ? currentListItems
            .map(
              item => `
                <div
                  class="shared-item ${
                    item.checked
                      ? "checked"
                      : ""
                  }"
                >

                  <label>

                    <input
                      type="checkbox"
                      data-player-check="${item.id}"
                      ${
                        item.checked
                          ? "checked"
                          : ""
                      }
                      ${
                        canCheck(
                          permission
                        )
                          ? ""
                          : "disabled"
                      }
                    >

                    <span>
                      ${escapeHtml(
                        item.text
                      )}
                    </span>

                  </label>

                  ${
                    canEdit(
                      permission
                    )
                      ? `
                        <button
                          class="icon-button danger"
                          data-player-delete="${item.id}"
                          type="button"
                        >
                          ×
                        </button>
                      `
                      : ""
                  }

                </div>
              `
            )
            .join("")

        : `
          <div class="mini-empty">
            Nothing here yet 🌷
          </div>
        `;

  $("playerAddArea")
    .classList
    .toggle(
      "hidden",
      !canEdit(
        permission
      )
    );

  document
    .querySelectorAll(
      "[data-player-check]"
    )
    .forEach(input => {

      input.addEventListener(
        "change",
        () =>
          toggleListItem(
            input.dataset
              .playerCheck,
            input.checked,
            renderPlayerList
          )
      );

    });

  document
    .querySelectorAll(
      "[data-player-delete]"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () =>
          deleteListItem(
            btn.dataset
              .playerDelete,
            permission,
            renderPlayerList
          )
      );

    });
}

/* =========================================================
   TOGGLE LIST ITEM
========================================================= */

async function toggleListItem(
  itemId,
  checked,
  after
) {

  try {

    await updateDoc(
      doc(
        db,
        "lists",
        currentListId,
        "items",
        itemId
      ),
      {
        checked,

        updatedAt:
          serverTimestamp()
      }
    );

    await refreshPlayerListItems();

    after();

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't update that item."
    );
  }
}

/* =========================================================
   DELETE LIST ITEM
========================================================= */

async function deleteListItem(
  itemId,
  permission,
  after
) {

  if (
    !canDelete(permission)
  ) {
    return;
  }

  if (
    !confirm(
      "Delete this item?"
    )
  ) {
    return;
  }

  try {

    await deleteDoc(
      doc(
        db,
        "lists",
        currentListId,
        "items",
        itemId
      )
    );

    await updateDoc(
      doc(
        db,
        "lists",
        currentListId
      ),
      {
        itemCount:
          Math.max(
            0,
            currentListItems.length - 1
          ),

        updatedAt:
          serverTimestamp()
      }
    );

    await refreshPlayerListItems();

    after();

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't delete that item."
    );
  }
}

/* =========================================================
   PLAYER ADD ITEM
========================================================= */

$("playerAddItemButton")
  .addEventListener(
    "click",
    async () => {

      const text =
        $("playerNewItem")
          .value
          .trim();

      if (
        !text ||
        !currentList ||
        !canEdit(
          currentList.permission
        )
      ) {
        return;
      }

      try {

        await addDoc(
          collection(
            db,
            "lists",
            currentListId,
            "items"
          ),
          {
            text,

            checked:
              false,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );

        await updateDoc(
          doc(
            db,
            "lists",
            currentListId
          ),
          {
            itemCount:
              currentListItems.length + 1,

            updatedAt:
              serverTimestamp()
          }
        );

        $("playerNewItem")
          .value = "";

        await refreshPlayerListItems();

        renderPlayerList();

      } catch (e) {

        console.error(e);

        toast(
          "Couldn't add that item."
        );
      }
    }
  );

/* =========================================================
   LIST MANAGER
========================================================= */

async function openListManager(
  id
) {

  try {

    const snap =
      await getDoc(
        doc(
          db,
          "lists",
          id
        )
      );

    if (!snap.exists()) {

      return toast(
        "List not found."
      );
    }

    currentListId =
      id;

    currentList = {
      id,
      ...snap.data()
    };

    if (
      currentList.creatorId !==
      currentUser.uid
    ) {

      return toast(
        "Only the creator can manage this list."
      );
    }

    await refreshPlayerListItems();

    $("manageListTitle")
      .textContent =
        currentList.title ||
        "List";

    $("managePermission")
      .value =
        currentList.permission ||
        "view";

    $("manageListLink")
      .value =
        makeListLink(id);

    renderManageItems();

    showScreen(
      "listManageScreen"
    );

  } catch (e) {

    console.error(e);

    toast(
      "Couldn't open list manager."
    );
  }
}

/* =========================================================
   RENDER MANAGE ITEMS
========================================================= */

function renderManageItems() {

  $("manageItems")
    .innerHTML =
      currentListItems.length

        ? currentListItems
            .map(
              item => `
                <div
                  class="manage-item ${
                    item.checked
                      ? "checked"
                      : ""
                  }"
                >

                  <label>

                    <input
                      type="checkbox"
                      data-manage-check="${item.id}"
                      ${
                        item.checked
                          ? "checked"
                          : ""
                      }
                    >

                    <input
                      class="manage-item-text"
                      data-manage-text="${item.id}"
                      value="${escapeHtml(item.text)}"
                      maxlength="200"
                    >

                  </label>

                  <button
                    class="icon-button danger"
                    data-manage-delete="${item.id}"
                    type="button"
                  >
                    ×
                  </button>

                </div>
              `
            )
            .join("")

        : `
          <div class="mini-empty">
            No items yet. Add one above 🌷
          </div>
        `;

  /* ---------- CHECK ---------- */

  document
    .querySelectorAll(
      "[data-manage-check]"
    )
    .forEach(input => {

      input.addEventListener(
        "change",
        async () => {

          await updateDoc(
            doc(
              db,
              "lists",
              currentListId,
              "items",
              input.dataset
                .manageCheck
            ),
            {
              checked:
                input.checked,

              updatedAt:
                serverTimestamp()
            }
          );

          await refreshPlayerListItems();

          renderManageItems();
        }
      );

    });

  /* ---------- TEXT ---------- */

  document
    .querySelectorAll(
      "[data-manage-text]"
    )
    .forEach(input => {

      input.addEventListener(
        "change",
        async () => {

          const text =
            input.value.trim();

          if (!text) {
            return;
          }

          await updateDoc(
            doc(
              db,
              "lists",
              currentListId,
              "items",
              input.dataset
                .manageText
            ),
            {
              text,

              updatedAt:
                serverTimestamp()
            }
          );

          await refreshPlayerListItems();
        }
      );

    });

  /* ---------- DELETE ---------- */

  document
    .querySelectorAll(
      "[data-manage-delete]"
    )
    .forEach(btn => {

      btn.addEventListener(
        "click",
        async () => {

          await deleteDoc(
            doc(
              db,
              "lists",
              currentListId,
              "items",
              btn.dataset
                .manageDelete
            )
          );

          await updateDoc(
            doc(
              db,
              "lists",
              currentListId
            ),
            {
              itemCount:
                Math.max(
                  0,
                  currentListItems.length - 1
                ),

              updatedAt:
                serverTimestamp()
            }
          );

          await refreshPlayerListItems();

          renderManageItems();
        }
      );

    });
}

/* =========================================================
   SAVE LIST PERMISSION
========================================================= */

$("saveListPermissionButton")
  .addEventListener(
    "click",
    async () => {

      try {

        await updateDoc(
          doc(
            db,
            "lists",
            currentListId
          ),
          {
            permission:
              $("managePermission")
                .value,

            updatedAt:
              serverTimestamp()
          }
        );

        currentList.permission =
          $("managePermission")
            .value;

        toast(
          "Permission updated ✨"
        );

        await loadDashboard();

      } catch (e) {

        console.error(e);

        toast(
          "Couldn't update permission."
        );
      }
    }
  );

/* =========================================================
   MANAGE ADD ITEM
========================================================= */

$("manageAddItemButton")
  .addEventListener(
    "click",
    async () => {

      const text =
        $("manageNewItem")
          .value
          .trim();

      if (!text) {
        return;
      }

      try {

        await addDoc(
          collection(
            db,
            "lists",
            currentListId,
            "items"
          ),
          {
            text,

            checked:
              false,

            createdAt:
              serverTimestamp(),

            updatedAt:
              serverTimestamp()
          }
        );

        await updateDoc(
          doc(
            db,
            "lists",
            currentListId
          ),
          {
            itemCount:
              currentListItems.length + 1,

            updatedAt:
              serverTimestamp()
          }
        );

        $("manageNewItem")
          .value = "";

        await refreshPlayerListItems();

        renderManageItems();

      } catch (e) {

        console.error(e);

        toast(
          "Couldn't add that item."
        );
      }
    }
  );

/* =========================================================
   COPY MANAGE LINK
========================================================= */

$("copyManageListLinkButton")
  .addEventListener(
    "click",
    () =>
      copyText(
        $("manageListLink").value
      )
  );

/* =========================================================
   OPEN CREATOR LIST
========================================================= */

async function openCreatorList(id) {

  await loadPlayerList(id);

}

/* =========================================================
   COPY HELPER
========================================================= */

async function copyText(value) {

  try {

    await navigator.clipboard
      .writeText(value);

    toast(
      "Copied to clipboard ♡"
    );

  } catch {

    toast(
      "Copy failed — select the link and copy it."
    );
  }
}


const footerYear = document.getElementById("footerYear");

if (footerYear) {
  footerYear.textContent = new Date().getFullYear();
}



/* =========================================================
   LOG OUT
========================================================= */
$("logoutButton")?.addEventListener("click", async () => {
  try {
    await logout();

    currentUser = null;
    username = "";

    showScreen("landingScreen");

    // Hide the logout button
    $("logoutButton")?.classList.add("hidden");

    toast("You have been logged out. ♡");
  } catch (error) {
    console.error("LOGOUT ERROR:", error);
    toast("Couldn't log out. Please try again.");
  }
});

export {
  
  
}
/* =========================================================
   START APP
========================================================= */

boot();
