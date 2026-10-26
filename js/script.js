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

/* =========================================================
   LIGHT / DARK THEME TOGGLE
   Works with the existing #themeToggle button and persists
   the user's choice between visits.
========================================================= */
function applyBetweenUsTheme(isDark) {
  document.body.classList.toggle("dark-mode", isDark);

  const toggle = document.getElementById("themeToggle") ||
    document.querySelector(".theme-toggle");

  if (toggle) {
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );
    toggle.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
  }
}

function initBetweenUsThemeToggle() {
  let savedTheme = "light";
  try {
    savedTheme = localStorage.getItem("betweenUsTheme") || "light";
  } catch (error) {
    // The theme still works for this page if storage is unavailable.
  }

  applyBetweenUsTheme(savedTheme === "dark");

  const toggle = document.getElementById("themeToggle") ||
    document.querySelector(".theme-toggle");

  if (!toggle || toggle.dataset.themeToggleReady === "true") return;
  toggle.dataset.themeToggleReady = "true";

  toggle.addEventListener("click", () => {
    const isDark = !document.body.classList.contains("dark-mode");
    applyBetweenUsTheme(isDark);
    try {
      localStorage.setItem("betweenUsTheme", isDark ? "dark" : "light");
    } catch (error) {
      // Keep the toggle usable even when browser storage is unavailable.
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBetweenUsThemeToggle, { once: true });
} else {
  initBetweenUsThemeToggle();
}

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
let dashboardFriendQuestions = [];

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
      // await logout();
      // currentUser = await startAnonymousAuth();
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
   START APP
========================================================= */

boot();

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

function formatDateTime(timestamp) {
  if (!timestamp) return "Time unavailable";
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

function friendQuestionChatMarkup(questionId) {
  return `
    <div class="bu-chat" data-chat-question-id="${escapeHtml(questionId)}">
      <h4>Conversation</h4>
      <div class="bu-chat-messages" aria-live="polite"><p class="muted">Loading conversation…</p></div>
      <form class="bu-chat-text-form">
        <label class="bu-chat-label">Message your friend</label>
        <div class="bu-chat-compose">
          <textarea class="text-input bu-chat-text" maxlength="2000" rows="2" placeholder="Write a message…"></textarea>
          <button type="submit" class="soft-button">Send</button>
        </div>
      </form>
      <details class="bu-poll-details">
        <summary>＋ Attach a poll</summary>
        <form class="bu-chat-poll-form">
          <label>Poll question</label>
          <input class="text-input bu-poll-title" maxlength="250" required placeholder="What would you like to ask?">
          <label>Options (separate with commas)</label>
          <input class="text-input bu-poll-options" maxlength="500" required placeholder="Option one, Option two, Option three">
          <button type="submit" class="soft-button">Send poll</button>
        </form>
      </details>
    </div>`;
}

async function loadFriendQuestionChat(chat) {
  if (!chat || !currentUser) return;
  const questionId = chat.dataset.chatQuestionId;
  const messagesEl = chat.querySelector('.bu-chat-messages');
  if (!questionId || !messagesEl) return;
  try {
    const snap = await getDocs(query(
      collection(db, "friendQuestions", questionId, "messages"),
      orderBy("createdAt", "asc")
    ));
    if (snap.empty) {
      messagesEl.innerHTML = '<p class="muted bu-chat-empty">No replies yet. Start the conversation below. ♡</p>';
    } else {
      messagesEl.innerHTML = snap.docs.map(d => {
        const m = d.data();
        const mine = m.senderUid === currentUser.uid;
        const poll = m.type === "poll";
        const votes = m.votes && typeof m.votes === 'object' ? m.votes : {};
        const myVote = votes[currentUser.uid];
        return `<article class="bu-chat-message ${mine ? 'mine' : 'theirs'}">
          <div class="bu-chat-message-meta"><strong>${escapeHtml(m.senderName || (mine ? 'You' : 'Your friend'))}</strong><time>${escapeHtml(formatDateTime(m.createdAt))}</time></div>
          ${poll ? `<div class="bu-chat-poll"><strong>📊 ${escapeHtml(m.pollTitle || 'Poll')}</strong><div class="bu-poll-vote-options">${(Array.isArray(m.pollOptions) ? m.pollOptions : []).map((option, index) => `<button type="button" class="bu-poll-vote ${myVote === index ? 'selected' : ''}" data-poll-message-id="${escapeHtml(d.id)}" data-poll-option-index="${index}">${escapeHtml(option)} <span>${Object.values(votes).filter(v => v === index).length}</span></button>`).join('')}</div><small>${myVote === undefined ? 'Choose an option to vote.' : 'Your vote is saved. You can change it.'}</small></div>` : `<p>${escapeHtml(m.text || '')}</p>`}
        </article>`;
      }).join('');
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch (error) {
    console.error("LOAD FRIEND QUESTION CHAT ERROR:", error);
    messagesEl.innerHTML = '<p class="muted">Conversation could not load. Check the chat-message Firestore rules.</p>';
  }
}

function setupFriendQuestionChats(root) {
  root.querySelectorAll('.bu-chat').forEach(chat => {
    loadFriendQuestionChat(chat);
    chat.querySelector('.bu-chat-messages')?.addEventListener('click', async event => {
      const voteButton = event.target.closest('[data-poll-message-id]');
      if (!voteButton) return;
      const messageId = voteButton.dataset.pollMessageId;
      const optionIndex = Number(voteButton.dataset.pollOptionIndex);
      const questionId = chat.dataset.chatQuestionId;
      try {
        const messageRef = doc(db, 'friendQuestions', questionId, 'messages', messageId);
        const messageSnap = await getDoc(messageRef);
        if (!messageSnap.exists()) return;
        const existingVotes = messageSnap.data().votes || {};
        await updateDoc(messageRef, { votes: { ...existingVotes, [currentUser.uid]: optionIndex } });
        await loadFriendQuestionChat(chat);
      } catch (error) {
        console.error('VOTE ON FRIEND POLL ERROR:', error);
        toast('Could not save your vote. Check the chat-message Firestore rules.');
      }
    });
    const textForm = chat.querySelector('.bu-chat-text-form');
    textForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const input = chat.querySelector('.bu-chat-text');
      const text = input?.value.trim();
      if (!text) return;
      const questionId = chat.dataset.chatQuestionId;
      const parent = root.querySelector(`[data-question-id="${CSS.escape(questionId)}"], [data-sent-question-id="${CSS.escape(questionId)}"]`);
      const isSent = !!parent?.hasAttribute('data-sent-question-id');
      const question = (isSent ? dashboardFriendQuestions : []).find(q => q.id === questionId);
      const cardQuestion = question || null;
      const otherUid = isSent ? cardQuestion?.toUid : parent?.dataset.toUid;
      const button = textForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const qSnap = await getDoc(doc(db, 'friendQuestions', questionId));
        if (!qSnap.exists()) throw new Error('Question not found');
        const q = qSnap.data();
        await addDoc(collection(db, 'friendQuestions', questionId, 'messages'), {
          questionId,
          senderUid: currentUser.uid,
          recipientUid: q.fromUid === currentUser.uid ? q.toUid : q.fromUid,
          senderName: currentUser.displayName || (q.fromUid === currentUser.uid ? (q.fromUsername || 'You') : (q.toUsername || 'Your friend')),
          type: 'text', text, createdAt: serverTimestamp()
        });
        input.value = '';
        await loadFriendQuestionChat(chat);
      } catch (error) {
        console.error('SEND FRIEND CHAT MESSAGE ERROR:', error);
        toast('Could not send the message. Check the chat-message Firestore rules.');
      } finally { button.disabled = false; }
    });
    const pollForm = chat.querySelector('.bu-chat-poll-form');
    pollForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const title = chat.querySelector('.bu-poll-title').value.trim();
      const options = chat.querySelector('.bu-poll-options').value.split(',').map(x => x.trim()).filter(Boolean);
      if (!title || options.length < 2) return toast('Add a poll question and at least two comma-separated options.');
      if (options.length > 10) return toast('A poll can have up to 10 options.');
      const questionId = chat.dataset.chatQuestionId;
      const button = pollForm.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const qSnap = await getDoc(doc(db, 'friendQuestions', questionId));
        if (!qSnap.exists()) throw new Error('Question not found');
        const q = qSnap.data();
        await addDoc(collection(db, 'friendQuestions', questionId, 'messages'), {
          questionId, senderUid: currentUser.uid,
          recipientUid: q.fromUid === currentUser.uid ? q.toUid : q.fromUid,
          senderName: currentUser.displayName || (q.fromUid === currentUser.uid ? (q.fromUsername || 'You') : (q.toUsername || 'Your friend')),
          type: 'poll', pollTitle: title, pollOptions: options, votes: {}, createdAt: serverTimestamp()
        });
        pollForm.reset();
        await loadFriendQuestionChat(chat);
        toast('Poll sent ♡');
      } catch (error) {
        console.error('SEND FRIEND CHAT POLL ERROR:', error);
        toast('Could not send the poll. Check the chat-message Firestore rules.');
      } finally { button.disabled = false; }
    });
  });
}

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
      <details open>
        <summary class="section-heading">
          <div>
            <p class="eyebrow">A little something for you</p>
            <h2>♡ Questions from Friends</h2>
          </div>
          <span class="friend-question-count">
            ${questions.filter(q => q.status === "pending").length} new
          </span>
        </summary>

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
                    <p class="muted">From ${escapeHtml(q.fromUsername || "A friend")}</p>
                    <p class="bu-question-time">Created: ${escapeHtml(formatDateTime(q.createdAt))} · Sent: ${escapeHtml(formatDateTime(q.sentAt || q.createdAt))}</p>
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
                    ${friendQuestionChatMarkup(q.id)}
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
      </details>
    `;

    dashboard.appendChild(section);
    setupFriendQuestionChats(section);

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
   QUESTIONS I SENT TO FRIENDS
========================================================= */

async function loadSentFriendQuestions() {
  const dashboard = $("dashboardContent");
  if (!dashboard || !currentUser) return;

  dashboard.querySelector("#sentFriendQuestions")?.remove();

  const section = document.createElement("section");
  section.id = "sentFriendQuestions";
  section.className = "friend-inbox";
  section.innerHTML = `
    <details open>
      <summary class="section-heading">
        <div>
          <p class="eyebrow">Your questions, your connections</p>
          <h2>💌 Questions I Sent</h2>
        </div>
        <span class="friend-question-count" id="sentFriendQuestionCount">Loading…</span>
      </summary>
      <div class="friend-inbox-list" id="sentFriendQuestionList">
        <p class="muted">Loading your sent questions…</p>
      </div>
    </details>
  `;
  dashboard.appendChild(section);

  const list = section.querySelector("#sentFriendQuestionList");
  const count = section.querySelector("#sentFriendQuestionCount");

  try {
    const snapshot = await getDocs(query(
      collection(db, "friendQuestions"),
      where("fromUid", "==", currentUser.uid)
    ));

    const questions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    dashboardFriendQuestions = questions;
    count.textContent = `${questions.length} sent`;

    if (!questions.length) {
      list.innerHTML = `
        <div class="empty-state">
          <span>💌</span>
          <h3>No questions sent yet</h3>
          <p>Questions you send to friends will appear here.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = questions.map(q => `
      <article class="friend-question-card" data-sent-question-id="${escapeHtml(q.id)}">
        <p class="muted">To ${escapeHtml(q.toUsername || "Your friend")} · ${escapeHtml(q.category || "General")}</p>
        <p class="bu-question-time">Created: ${escapeHtml(formatDateTime(q.createdAt))} · Sent: ${escapeHtml(formatDateTime(q.sentAt || q.createdAt))}</p>
        <h3 class="sent-question-text">${escapeHtml(q.question || "Untitled question")}</h3>
        <p class="${q.status === "answered" ? "friend-answer-status" : "muted"}">
          ${q.status === "answered" ? "✓ Your friend answered" : "Waiting for their answer…"}
        </p>
        ${q.status === "answered" && q.answer ? `<p><strong>Their answer:</strong> ${escapeHtml(q.answer)}</p><p class="bu-question-time">Answered: ${escapeHtml(formatDateTime(q.answeredAt))}</p>` : ""}
        ${friendQuestionChatMarkup(q.id)}
        <div class="friend-actions">
          ${q.status !== "answered" ? `<button type="button" class="soft-button small" data-edit-sent-question="${escapeHtml(q.id)}">Edit</button>` : ""}
          <button type="button" class="soft-button small" data-delete-sent-question="${escapeHtml(q.id)}">Delete</button>
        </div>
        <form class="sent-question-edit-form hidden">
          <label>Question</label>
          <textarea class="text-input sent-question-edit-input" maxlength="500" required>${escapeHtml(q.question || "")}</textarea>
          <div class="friend-actions">
            <button type="submit" class="soft-button small">Save changes</button>
            <button type="button" class="soft-button small" data-cancel-sent-edit>Cancel</button>
          </div>
        </form>
      </article>
    `).join("");

    setupFriendQuestionChats(section);

    list.addEventListener("click", async event => {
      const editButton = event.target.closest("[data-edit-sent-question]");
      const deleteButton = event.target.closest("[data-delete-sent-question]");
      const cancelButton = event.target.closest("[data-cancel-sent-edit]");

      if (cancelButton) {
        cancelButton.closest(".sent-question-edit-form")?.classList.add("hidden");
        return;
      }

      if (editButton) {
        const card = editButton.closest("[data-sent-question-id]");
        card?.querySelector(".sent-question-edit-form")?.classList.remove("hidden");
        card?.querySelector(".sent-question-edit-input")?.focus();
        return;
      }

      if (deleteButton) {
        const id = deleteButton.dataset.deleteSentQuestion;
        const question = questions.find(q => q.id === id);
        if (!question || !confirm("Delete this question you sent?")) return;

        try {
          await deleteDoc(doc(db, "friendQuestions", id));
          toast("Sent question deleted.");
          await loadSentFriendQuestions();
        } catch (error) {
          console.error("DELETE SENT FRIEND QUESTION ERROR:", error);
          toast("Couldn't delete it. Your Firestore rules must allow the sender to delete their own question.");
        }
      }
    });

    list.querySelectorAll(".sent-question-edit-form").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const card = form.closest("[data-sent-question-id]");
        const id = card?.dataset.sentQuestionId;
        const question = questions.find(q => q.id === id);
        const newQuestion = form.querySelector(".sent-question-edit-input")?.value.trim();

        if (!question || question.status === "answered") {
          toast("Answered questions can no longer be edited.");
          return;
        }
        if (!newQuestion) {
          toast("Enter a question first.");
          return;
        }

        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          await updateDoc(doc(db, "friendQuestions", id), {
            question: newQuestion,
            updatedAt: serverTimestamp()
          });
          toast("Question updated ♡");
          await loadSentFriendQuestions();
        } catch (error) {
          console.error("EDIT SENT FRIEND QUESTION ERROR:", error);
          toast("Couldn't edit it. Your Firestore rules must allow the sender to edit their pending question.");
        } finally {
          submit.disabled = false;
        }
      });
    });

  } catch (error) {
    console.error("LOAD SENT FRIEND QUESTIONS ERROR:", error);
    count.textContent = "Unavailable";
    list.innerHTML = `<div class="mini-empty">Couldn't load sent questions. Please refresh and try again.</div>`;
  }
}

/* =========================================================
   PERSONAL QUESTIONS — PRIVATE DRAFTS
========================================================= */

async function loadPersonalQuestionDrafts() {
  const dashboard = $("dashboardContent");
  if (!dashboard || !currentUser) return;

  dashboard.querySelector("#personalQuestionDrafts")?.remove();

  const section = document.createElement("section");
  section.id = "personalQuestionDrafts";
  section.className = "friend-inbox";
  section.innerHTML = `
    <details>
      <summary class="section-heading">
        <div>
          <p class="eyebrow">A quiet space for your own thoughts</p>
          <h2>📝 Personal Questions</h2>
        </div>
        <span class="muted">Private to you</span>
      </summary>
      <div class="personal-drafts-content">
        <form id="personalQuestionForm">
          <label for="personalQuestionInput">Save a question for yourself</label>
          <textarea id="personalQuestionInput" class="text-input" maxlength="500" required placeholder="A question to reflect on…"></textarea>
          <div class="friend-actions">
            <button class="soft-button" type="submit" id="savePersonalQuestionButton">Save question ♡</button>
            <button class="soft-button hidden" type="button" id="cancelPersonalQuestionEdit">Cancel edit</button>
          </div>
        </form>
        <div id="personalQuestionList"><p class="muted">Loading your private questions…</p></div>
      </div>
    </details>
  `;
  dashboard.appendChild(section);

  const form = section.querySelector("#personalQuestionForm");
  const input = section.querySelector("#personalQuestionInput");
  const list = section.querySelector("#personalQuestionList");
  const saveButton = section.querySelector("#savePersonalQuestionButton");
  const cancelButton = section.querySelector("#cancelPersonalQuestionEdit");
  let drafts = [];
  let editingId = null;

  function resetForm() {
    editingId = null;
    input.value = "";
    saveButton.textContent = "Save question ♡";
    cancelButton.classList.add("hidden");
  }

  function renderDrafts() {
    if (!drafts.length) {
      list.innerHTML = `<div class="mini-empty">Your private questions will appear here. 🌷</div>`;
      return;
    }

    list.innerHTML = drafts.map(draft => `
      <article class="dashboard-card compact" data-personal-draft-id="${escapeHtml(draft.id)}">
        <div class="dashboard-icon">📝</div>
        <div class="dashboard-main">
          <p>${escapeHtml(draft.question)}</p>
          <small class="muted">Only you can see this question.</small>
        </div>
        <div class="dashboard-actions">
          <button type="button" class="soft-button small" data-edit-personal-draft="${escapeHtml(draft.id)}">Edit</button>
          <button type="button" class="soft-button small" data-delete-personal-draft="${escapeHtml(draft.id)}">Delete</button>
        </div>
      </article>
    `).join("");
  }

  async function fetchDrafts() {
    const snapshot = await getDocs(query(
      collection(db, "personalQuestionDrafts"),
      where("ownerUid", "==", currentUser.uid)
    ));
    drafts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.seconds || b.createdAt?.seconds || 0) - (a.updatedAt?.seconds || a.createdAt?.seconds || 0));
    renderDrafts();
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return toast("Write a question first.");
    if (question.length > 500) return toast("Questions must be 500 characters or fewer.");

    saveButton.disabled = true;
    try {
      if (editingId) {
        await updateDoc(doc(db, "personalQuestionDrafts", editingId), {
          question,
          updatedAt: serverTimestamp()
        });
        toast("Private question updated ♡");
      } else {
        await addDoc(collection(db, "personalQuestionDrafts"), {
          ownerUid: currentUser.uid,
          question,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast("Private question saved ♡");
      }
      resetForm();
      await fetchDrafts();
    } catch (error) {
      console.error("SAVE PERSONAL QUESTION ERROR:", error);
      toast("Couldn't save it. Check that your personalQuestionDrafts Firestore rules are published.");
    } finally {
      saveButton.disabled = false;
    }
  });

  cancelButton.addEventListener("click", resetForm);

  list.addEventListener("click", async event => {
    const editButton = event.target.closest("[data-edit-personal-draft]");
    const deleteButton = event.target.closest("[data-delete-personal-draft]");

    if (editButton) {
      const draft = drafts.find(item => item.id === editButton.dataset.editPersonalDraft);
      if (!draft) return;
      editingId = draft.id;
      input.value = draft.question;
      saveButton.textContent = "Update question ♡";
      cancelButton.classList.remove("hidden");
      input.focus();
      return;
    }

    if (deleteButton) {
      const id = deleteButton.dataset.deletePersonalDraft;
      if (!confirm("Delete this private question?")) return;
      try {
        await deleteDoc(doc(db, "personalQuestionDrafts", id));
        if (editingId === id) resetForm();
        toast("Private question deleted.");
        await fetchDrafts();
      } catch (error) {
        console.error("DELETE PERSONAL QUESTION ERROR:", error);
        toast("Couldn't delete that private question.");
      }
    }
  });

  try {
    await fetchDrafts();
  } catch (error) {
    console.error("LOAD PERSONAL QUESTIONS ERROR:", error);
    list.innerHTML = `<div class="mini-empty">Couldn't load your private questions. Check your Firestore rules.</div>`;
  }
}

/* =========================================================
   DASHBOARD
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


/* ---------- FRIEND QUESTIONS ---------- */

const sentFriendQuestionsSnap = await getDocs(
  query(
    collection(db, "friendQuestions"),
    where("fromUid", "==", currentUser.uid)
  )
);

dashboardFriendQuestions = sentFriendQuestionsSnap.docs
  .map(d => ({
    id: d.id,
    ...d.data()
  }))
  .sort(
    (a, b) =>
      (b.createdAt?.seconds || 0) -
      (a.createdAt?.seconds || 0)
  );

/* ---------- RENDER DASHBOARD ---------- */

await renderDashboard();

populateGroupSelect();
await populateFriendDropdowns();
await loadIncomingFriendQuestions();
await loadSentFriendQuestions();
await loadPersonalQuestionDrafts();
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
  !dashboardGroups.length &&
  !dashboardFriendQuestions.length
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

$("createListSaveButton")
  .addEventListener(
    "click",
    async () => {

      const title =
        $("listTitle")
          .value
          .trim() ||
        "Our List";

      const permission =
        document
          .querySelector(
            'input[name="permission"]:checked'
          )
          ?.value ||
        "view";

      const groupId =
        $("listGroupSelect")
          .value ||
        null;

      const items =
        $("startWithItems")
          .checked

          ? [
              ...document
                .querySelectorAll(
                  ".starter-item-value"
                )
            ]
              .map(
                x =>
                  x.value.trim()
              )
              .filter(Boolean)

          : [];

      try {

        const ref =
          await addDoc(
            collection(
              db,
              "lists"
            ),
            {
              creatorId:
                currentUser.uid,

              title,

              groupId,

              permission,

              itemCount:
                items.length,

              active: true,

              createdAt:
                serverTimestamp(),

              updatedAt:
                serverTimestamp()
            }
          );

        currentListId =
          ref.id;

        for (
          const text of items
        ) {

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
        }

        $("listLink")
          .value =
            makeListLink(
              currentListId
            );

        $("listCreatedArea")
          .classList
          .remove("hidden");

        toast(
          "List created ✨"
        );

        await loadDashboard();

      } catch (e) {

        console.error(e);

        toast(
          "Couldn't create the list."
        );
      }
    }
  );

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
   START APP
========================================================= */

boot();
