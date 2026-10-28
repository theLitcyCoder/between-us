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
  runTransaction,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";


import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js";


const VAPID_PUBLIC_KEY = "BD0hun2iz3fm_jpRNSsyErbRZ8F2w2BrCyQPMWJMgMtNnz1z9HUgKa3SmfhW4tdy6Xxg5rz4x9TQcinzZJs0OWE";


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

    if (typeof data.text !== "string" || !data.text.trim()) {
      throw new Error(data.error || "The AI service returned an empty response.");
    }

    return data.text.trim();

  } catch (error) {
    console.error("AI error:", error);
    throw error;
  }
}


/* =========================================================
   BETWEEN US: BROWSER PUSH NOTIFICATIONS
========================================================= */

async function getBrowserMessagingToken() {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "This browser does not support service workers."
    );
  }

  if (!(await isSupported())) {
    throw new Error(
      "Firebase Messaging is not supported in this browser."
    );
  }

  if (Notification.permission === "denied") {
    throw new Error(
      "Notifications are blocked in your browser settings."
    );
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    return null;
  }

  const serviceWorkerRegistration =
    await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

  const messaging = getMessaging();

  const token = await getToken(messaging, {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration
  });

  if (!token) {
    throw new Error(
      "Firebase could not obtain a notification token."
    );
  }

  return token;
}


/* =========================================================
   BETWEEN US: IN-APP NOTIFICATIONS + BROWSER ALERTS
========================================================= */

let appNotifications = [];
let appNotificationsUnsubscribe = null;
let appNotificationsUid = null;
let appNotificationsReady = false;
let appNotificationPanel = null;
let foregroundMessagingBound = false;

async function createAppNotification(recipientUid, details = {}) {
  if (!currentUser?.uid || !recipientUid || recipientUid === currentUser.uid) return false;
  try {
    await addDoc(collection(db, "notifications"), {
      recipientUid,
      senderUid: currentUser.uid,
      senderUsername: username || "A friend",
      type: details.type || "general",
      title: details.title || "New activity in Between Us",
      message: details.message || "You have a new update.",
      read: false,
      ...(details.friendRequestId ? { friendRequestId: details.friendRequestId } : {}),
      ...(details.questionId ? { questionId: details.questionId } : {}),
      ...(details.listId ? { listId: details.listId } : {}),
      ...(details.listTitle ? { listTitle: details.listTitle } : {}),
      ...(details.targetSection ? { targetSection: details.targetSection } : {}),
      createdAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    // The primary action has already succeeded; notification failure must not undo it.
    console.error("CREATE APP NOTIFICATION ERROR:", error);
    return false;
  }
}

async function notifySharedListChange(action, itemText = "") {
  if (!currentUser?.uid || !currentList || !currentListId) return;
  const isCreator = currentList.creatorId === currentUser.uid;
  const recipientUid = isCreator ? currentList.sharedWithUid : currentList.creatorId;
  if (!recipientUid || recipientUid === currentUser.uid) return;
  const listTitle = currentList.title || "Shared list";
  const itemDescription = itemText ? ` “${itemText.slice(0, 90)}”` : "";
  await createAppNotification(recipientUid, {
    type: "shared_list_update",
    title: "A shared list was updated",
    message: `${username || "Your friend"} ${action}${itemDescription} in “${listTitle}”.`,
    listId: currentListId,
    listTitle,
    targetSection: "shared-list"
  });
}

function ensureAppNotificationPanel(userActivity, button) {
  if (!userActivity || !button || appNotificationPanel?.isConnected) return;
  appNotificationPanel = document.createElement("section");
  appNotificationPanel.className = "bu-notification-panel hidden";
  appNotificationPanel.id = "appNotificationPanel";
  appNotificationPanel.setAttribute("aria-label", "Notifications");
  appNotificationPanel.innerHTML = `
    <div class="bu-notification-panel-header">
      <div><strong>Notifications</strong><small id="buNotificationSummary">Your Between Us updates</small></div>
      <button type="button" class="bu-notification-mark-all" data-notification-mark-all>Mark all read</button>
    </div>
    <div class="bu-notification-list" id="buNotificationList"><p class="bu-notification-empty">Your notifications will appear here. ♡</p></div>
    <div class="bu-notification-panel-footer">
      <button type="button" class="soft-button small" id="enableBrowserNotificationsButton">Enable browser notifications</button>
      <p id="buBrowserNotificationStatus" role="status">Browser alerts require your permission.</p>
    </div>`;
  userActivity.appendChild(appNotificationPanel);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", event => {
    event.stopPropagation();
    const open = appNotificationPanel.classList.contains("hidden");
    appNotificationPanel.classList.toggle("hidden", !open);
    button.setAttribute("aria-expanded", String(open));
    if (open) renderAppNotifications();
  });
  appNotificationPanel.addEventListener("click", async event => {
    event.stopPropagation();
    if (event.target.closest("[data-notification-mark-all]")) {
      await Promise.all(appNotifications.filter(n => !n.read).map(n => markAppNotificationRead(n.id)));
      return;
    }
    if (event.target.closest("#enableBrowserNotificationsButton")) {
      await enableBrowserNotifications();
      return;
    }
    const itemButton = event.target.closest("[data-app-notification-id]");
    if (!itemButton) return;
    const item = appNotifications.find(n => n.id === itemButton.dataset.appNotificationId);
    if (!item) return;
    await markAppNotificationRead(item.id);
    appNotificationPanel.classList.add("hidden");
    button.setAttribute("aria-expanded", "false");
    await openNotificationTarget(item);
  });
  if (!document.documentElement.dataset.buNotificationOutsideClickBound) {
    document.documentElement.dataset.buNotificationOutsideClickBound = "true";
    document.addEventListener("click", event => {
      if (!appNotificationPanel || appNotificationPanel.classList.contains("hidden")) return;
      if (appNotificationPanel.contains(event.target) || button.contains(event.target)) return;
      appNotificationPanel.classList.add("hidden");
      button.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && appNotificationPanel && !appNotificationPanel.classList.contains("hidden")) {
        appNotificationPanel.classList.add("hidden");
        button.setAttribute("aria-expanded", "false");
      }
    });
  }
}

function renderAppNotifications() {
  const list = document.getElementById("buNotificationList");
  const summary = document.getElementById("buNotificationSummary");
  if (!list) return;
  const unread = appNotifications.filter(n => !n.read).length;
  if (summary) summary.textContent = unread ? `${unread} unread update${unread === 1 ? "" : "s"}` : "You're all caught up ♡";
  if (!appNotifications.length) {
    list.innerHTML = '<p class="bu-notification-empty">No notifications yet. New activity will show up here. ♡</p>';
    return;
  }
  list.innerHTML = appNotifications.map(item => `
    <button type="button" class="bu-notification-item ${item.read ? "is-read" : "is-unread"}" data-app-notification-id="${escapeHtml(item.id)}">
      <span class="bu-notification-item-dot" aria-hidden="true"></span>
      <span class="bu-notification-item-copy"><strong>${escapeHtml(item.title || "New activity")}</strong><span>${escapeHtml(item.message || "You have a new update.")}</span><small>${escapeHtml(item.createdAt ? formatDateTime(item.createdAt) : "Just now")}</small></span>
    </button>`).join("");
}

function updateAppNotificationBadge() {
  const badge = document.getElementById("headerActivityBadge");
  const button = document.getElementById("headerActivityButton");
  if (!badge || !button) return;
  const unread = appNotifications.filter(n => !n.read).length;
  badge.textContent = unread > 99 ? "99+" : String(unread);
  badge.classList.toggle("hidden", unread === 0);
  button.classList.toggle("has-activity", unread > 0);
  button.setAttribute("aria-label", unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "View notifications");
  button.title = unread ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "View notifications";
}

async function markAppNotificationRead(notificationId) {
  if (!currentUser?.uid || !notificationId) return;
  const item = appNotifications.find(n => n.id === notificationId);
  if (!item || item.read) return;
  try {
    await updateDoc(doc(db, "notifications", notificationId), { read: true, readAt: serverTimestamp() });
  } catch (error) {
    console.error("MARK NOTIFICATION READ ERROR:", error);
    toast("Couldn't mark that notification as read.");
  }
}

async function openNotificationTarget(item) {
  if (item.listId && ["shared_list", "shared_list_update"].includes(item.type)) {
    await loadPlayerList(item.listId);
    return;
  }
  setParam("game", null);
  setParam("list", null);
  showScreen("landingScreen");
  await loadDashboard();
  if (item.type === "friend_request") {
    showFriendsPanel("requests");
    document.getElementById("friendRequestsPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (item.type === "friend_request_accepted") {
    await showFriendsList();
    document.getElementById("friendsListPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const sectionId = item.targetSection === "sentFriendQuestions" || item.type === "friend_question_answered"
    ? "sentFriendQuestions" : "incomingFriendQuestions";
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById(sectionId)?.classList.add("bu-notification-target");
  window.setTimeout(() => document.getElementById(sectionId)?.classList.remove("bu-notification-target"), 1600);
}

function stopAppNotificationListener() {
  if (appNotificationsUnsubscribe) appNotificationsUnsubscribe();
  appNotificationsUnsubscribe = null;
  appNotificationsUid = null;
  appNotificationsReady = false;
  appNotifications = [];
  updateAppNotificationBadge();
  renderAppNotifications();
}

function startAppNotificationListener() {
  if (!currentUser?.uid || currentUser.isAnonymous) {
    stopAppNotificationListener();
    return;
  }
  if (appNotificationsUid === currentUser.uid && appNotificationsUnsubscribe) return;
  stopAppNotificationListener();
  appNotificationsUid = currentUser.uid;
  // Query by recipient only to avoid requiring a composite Firestore index.
  const notificationsQuery = query(collection(db, "notifications"), where("recipientUid", "==", currentUser.uid));
  appNotificationsUnsubscribe = onSnapshot(notificationsQuery, snapshot => {
    appNotifications = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
      .slice(0, 30);
    appNotificationsReady = true;
    updateAppNotificationBadge();
    renderAppNotifications();
  }, error => {
    appNotificationsReady = false;
    console.error("APP NOTIFICATION LISTENER ERROR:", error);
    updateHeaderActivityCount();
    const status = document.getElementById("buBrowserNotificationStatus");
    if (status) status.textContent = "In-app notifications need the Firestore notifications rule.";
  });
}

async function enableBrowserNotifications() {
  const status = document.getElementById("buBrowserNotificationStatus");
  const button = document.getElementById("enableBrowserNotificationsButton");
  if (!currentUser?.uid || currentUser.isAnonymous) {
    if (status) status.textContent = "Create or sign in to a Between Us account first.";
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = "Requesting browser permission…";
  try {
    const token = await getBrowserMessagingToken();
    if (!token) {
      if (status) status.textContent = "Permission was not granted. You can enable it in browser settings.";
      return;
    }
    await updateDoc(doc(db, "users", currentUser.uid), { fcmTokens: arrayUnion(token), fcmTokenUpdatedAt: serverTimestamp() });
    if (!foregroundMessagingBound) {
      onMessage(getMessaging(), payload => {
        const title = payload.notification?.title || "Between Us";
        const body = payload.notification?.body || "You have a new update.";
        toast(`${title}: ${body}`);
        if (Notification.permission === "granted" && document.visibilityState === "visible") {
          try { new Notification(title, { body }); } catch (error) { console.warn("Could not show foreground browser notification:", error); }
        }
      });
      foregroundMessagingBound = true;
    }
    if (status) status.textContent = "This device is registered. Background push still needs a server-side FCM sender.";
    toast("Browser notification permission enabled on this device ♡");
  } catch (error) {
    console.error("ENABLE BROWSER NOTIFICATIONS ERROR:", error);
    if (status) status.textContent = error.message || "Couldn't enable browser notifications.";
    toast("Couldn't enable browser notifications.");
  } finally {
    if (button) button.disabled = false;
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
      `[data-ai-response="${CSS.escape(responseId)}"]`
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
      answer: Array.isArray(response.answer)
        ? response.answer.join("; ")
        : (response.answer || "")
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
   QUESTION HELP BUTTON WIRING
========================================================= */

const questionHelpButton = document.getElementById("questionHelpButton");
if (questionHelpButton) {
  questionHelpButton.addEventListener("click", explainCurrentQuestion);
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
   HEADER ACTIVITY
========================================================= */

let headerActivityButton = null;
let headerActivityBadge = null;

let headerActivityUnsubscribers = [];
let headerActivityUid = null;

let headerActivityUnread = new Map();

let incomingQuestionStates = new Map();
let sentQuestionStates = new Map();

let incomingQuestionBaselineReady = false;
let sentQuestionBaselineReady = false;

let lastHeaderActivityType = "incoming";


function createHeaderActivityButton() {
  if (headerActivityButton) {
    return;
  }

  const topbar = document.querySelector(".topbar");

  if (!topbar) {
    console.warn("Between Us header was not found.");
    return;
  }

  headerActivityButton = document.createElement("button");

  headerActivityButton.type = "button";
  headerActivityButton.className = "bu-header-activity";
  headerActivityButton.setAttribute(
    "aria-label",
    "View new activity"
  );
  headerActivityButton.title = "New activity";

  headerActivityButton.innerHTML = `
    <span class="bu-header-activity-heart" aria-hidden="true">
      ♥
    </span>
    <span class="bu-header-activity-badge hidden"
          aria-live="polite"></span>
  `;

  headerActivityBadge = headerActivityButton.querySelector(
    ".bu-header-activity-badge"
  );

  headerActivityButton.addEventListener("click", async () => {
    const targetId =
      lastHeaderActivityType === "sent"
        ? "sentFriendQuestions"
        : "incomingFriendQuestions";

    // Clear the current in-app unread indicator.
    headerActivityUnread.clear();
    updateHeaderActivityButton();

    // Return to the main screen and load its activity sections.
    setParam("game", null);
    setParam("list", null);

    showScreen("landingScreen");

    await loadDashboard();

    // The sections are loaded after the dashboard data.
    document.getElementById(targetId)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });

  // Prefer the existing action area if the HTML has one.
  const actions = topbar.querySelector(".top-actions");

  if (actions) {
    actions.prepend(headerActivityButton);
  } else {
    topbar.appendChild(headerActivityButton);
  }
}


function updateHeaderActivityButton() {
  if (!headerActivityButton) {
    return;
  }

  const count = headerActivityUnread.size;

  if (headerActivityBadge) {
    headerActivityBadge.textContent =
      count > 99 ? "99+" : String(count);

    headerActivityBadge.classList.toggle(
      "hidden",
      count === 0
    );
  }

  headerActivityButton.classList.toggle(
    "has-activity",
    count > 0
  );

  headerActivityButton.setAttribute(
    "aria-label",
    count > 0
      ? `${count} new activity item${count === 1 ? "" : "s"}`
      : "View activity"
  );

  headerActivityButton.title =
    count > 0
      ? `${count} new activity item${count === 1 ? "" : "s"}`
      : "View activity";
}


function registerHeaderActivity(type, id) {
  const key = `${type}:${id}`;

  // Do not count the same activity twice.
  if (headerActivityUnread.has(key)) {
    return;
  }

  headerActivityUnread.set(key, {
    type,
    id
  });

  lastHeaderActivityType = type;

  updateHeaderActivityButton();

  if (headerActivityButton) {
    // Restart the gentle animation for each new item.
    headerActivityButton.classList.remove("is-shaking");

    void headerActivityButton.offsetWidth;

    headerActivityButton.classList.add("is-shaking");
  }
}


function stopHeaderActivityListener() {
  headerActivityUnsubscribers.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      console.warn("Could not stop activity listener:", error);
    }
  });

  headerActivityUnsubscribers = [];
}


function startHeaderActivityListener() {
  if (!currentUser) {
    return;
  }

  createHeaderActivityButton();

  // Don't attach duplicate listeners for the same account.
  if (headerActivityUid === currentUser.uid &&
      headerActivityUnsubscribers.length) {
    return;
  }

  stopHeaderActivityListener();

  headerActivityUid = currentUser.uid;

  headerActivityUnread.clear();
  incomingQuestionStates = new Map();
  sentQuestionStates = new Map();

  incomingQuestionBaselineReady = false;
  sentQuestionBaselineReady = false;

  updateHeaderActivityButton();

  /* ---------- QUESTIONS RECEIVED ---------- */

  const incomingQuery = query(
    collection(db, "friendQuestions"),
    where("toUid", "==", currentUser.uid)
  );

  const stopIncoming = onSnapshot(
    incomingQuery,
    snapshot => {
      // Wait for the server's first snapshot so cached data
      // is not mistaken for newly received activity.
      if (
        !incomingQuestionBaselineReady &&
        snapshot.metadata.fromCache
      ) {
        return;
      }

      const nextStates = new Map();

      snapshot.docs.forEach(questionDoc => {
        const question = questionDoc.data();
        const id = questionDoc.id;
        const status = question.status || "pending";

        nextStates.set(id, status);

        if (
          incomingQuestionBaselineReady &&
          !incomingQuestionStates.has(id) &&
          status === "pending"
        ) {
          registerHeaderActivity("incoming", id);
        }
      });

      incomingQuestionStates = nextStates;
      incomingQuestionBaselineReady = true;
    },
    error => {
      console.error(
        "INCOMING ACTIVITY LISTENER ERROR:",
        error
      );
    }
  );

  headerActivityUnsubscribers.push(stopIncoming);

  /* ---------- ANSWERS TO QUESTIONS I SENT ---------- */

  const sentQuery = query(
    collection(db, "friendQuestions"),
    where("fromUid", "==", currentUser.uid)
  );

  const stopSent = onSnapshot(
    sentQuery,
    snapshot => {
      if (
        !sentQuestionBaselineReady &&
        snapshot.metadata.fromCache
      ) {
        return;
      }

      const nextStates = new Map();

      snapshot.docs.forEach(questionDoc => {
        const question = questionDoc.data();
        const id = questionDoc.id;
        const status = question.status || "pending";

        nextStates.set(id, status);

        const previousStatus = sentQuestionStates.get(id);

        if (
          sentQuestionBaselineReady &&
          sentQuestionStates.has(id) &&
          previousStatus !== "answered" &&
          status === "answered"
        ) {
          registerHeaderActivity("sent", id);
        }
      });

      sentQuestionStates = nextStates;
      sentQuestionBaselineReady = true;
    },
    error => {
      console.error(
        "SENT QUESTION ACTIVITY LISTENER ERROR:",
        error
      );
    }
  );

  headerActivityUnsubscribers.push(stopSent);
}

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
   HEADER ACTIVITY / NOTIFICATIONS
   Badge counts new incoming friend questions, unread chat
   replies, and newly shared lists. Clicking jumps to the
   Questions from Friends section as requested.
========================================================= */
function initHeaderActivityButton() {
  const logoutButton = $("logoutButton");
  if (!logoutButton || document.getElementById("headerActivityButton")) return;

  const topbar = logoutButton.closest(".topbar") || logoutButton.parentElement;
  if (!topbar) return;

  // Align the theme toggle, username, message activity icon, and logout
  // as one tidy header layout. Keep Logout visually separated on the right.
  let actions = topbar.querySelector(".bu-header-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "bu-header-actions";
    topbar.appendChild(actions);
  }

  const themeWrap = document.querySelector(".theme-toggle-wrap");
  if (themeWrap && themeWrap.parentElement !== actions) {
    themeWrap.classList.add("bu-header-theme-wrap");
    actions.insertBefore(themeWrap, actions.firstChild);
  }

  let userActivity = actions.querySelector(".bu-header-user-activity");
  if (!userActivity) {
    userActivity = document.createElement("div");
    userActivity.className = "bu-header-user-activity";
    actions.appendChild(userActivity);
  }

  const usernameDisplay = $("usernameDisplay");
  if (usernameDisplay) {
    usernameDisplay.classList.add("bu-header-username");
    // Keep the username inside the same right-aligned group as the message
    // button, rather than leaving it in its original left-side header slot.
    if (usernameDisplay.parentElement !== userActivity) {
      usernameDisplay.remove();
    }
  }

  const button = document.createElement("button");
  button.type = "button";
  button.id = "headerActivityButton";
  button.className = "bu-header-activity";
  button.setAttribute("aria-label", "New questions, replies, or shared lists");
  button.title = "New questions, replies, or shared lists";
  button.innerHTML = `
    <span class="bu-header-activity-icon" aria-hidden="true">✉</span>
    <span class="bu-header-activity-badge hidden" id="headerActivityBadge">0</span>
  `;
  // Keep the username and message icon in the same right-aligned group,
  // with the username immediately to the LEFT of the message icon.
  if (usernameDisplay) userActivity.appendChild(usernameDisplay);
  userActivity.appendChild(button);
  ensureAppNotificationPanel(userActivity, button);

  if (logoutButton.parentElement !== actions) {
    logoutButton.remove();
    actions.appendChild(logoutButton);
  }
  logoutButton.classList.add("bu-header-logout");



  // If the header is flex-based, the action group stays on the right and
  // the logout button is separated from the message icon by generous space.
  topbar.classList.add("bu-has-header-activity");
}

function markSharedListsSeen() {
  try {
    const ids = (dashboardSharedLists || []).map(list => list.id);
    localStorage.setItem("betweenUsSeenSharedListIds", JSON.stringify(ids));
  } catch (_) {}
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

async function updateHeaderActivityCount() {
  if (appNotificationsReady) {
    updateAppNotificationBadge();
    return;
  }
  const badge = $("headerActivityBadge");
  const button = $("headerActivityButton");
  if (!badge || !button || !currentUser || currentUser.isAnonymous) {
    if (badge) badge.classList.add("hidden");
    if (button) button.classList.add("hidden");
    return;
  }
  button.classList.remove("hidden");

  try {
    const now = Date.now();
    const incomingSnap = await getDocs(query(
      collection(db, "friendQuestions"),
      where("toUid", "==", currentUser.uid)
    ));
    const sentSnap = await getDocs(query(
      collection(db, "friendQuestions"),
      where("fromUid", "==", currentUser.uid)
    ));
    const incomingQuestions = incomingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allQuestions = [
      ...incomingQuestions,
      ...sentSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    ];

    let lastQuestionSeen = Number(localStorage.getItem("betweenUsLastSeenIncomingQuestions"));
    if (!Number.isFinite(lastQuestionSeen) || lastQuestionSeen <= 0) {
      lastQuestionSeen = now;
      localStorage.setItem("betweenUsLastSeenIncomingQuestions", String(now));
    }
    const newIncomingQuestions = incomingQuestions.filter(q => timestampMillis(q.createdAt) > lastQuestionSeen).length;

    let unreadReplies = 0;
    for (const question of allQuestions) {
      const seenKey = `betweenUsLastSeenChat:${currentUser.uid}:${question.id}`;
      let lastSeen = Number(localStorage.getItem(seenKey));
      if (!Number.isFinite(lastSeen) || lastSeen <= 0) {
        // Establish a baseline on first run so old conversations don't
        // incorrectly appear newly unread after installing this update.
        localStorage.setItem(seenKey, String(now));
        lastSeen = now;
      }
      const messagesSnap = await getDocs(collection(db, "friendQuestions", question.id, "messages"));
      unreadReplies += messagesSnap.docs.filter(messageDoc => {
        const message = messageDoc.data();
        return message.senderUid !== currentUser.uid && timestampMillis(message.createdAt) > lastSeen;
      }).length;
    }

    const sharedListIds = (dashboardSharedLists || []).map(list => list.id);
    let seenSharedListIds;
    try {
      seenSharedListIds = JSON.parse(localStorage.getItem("betweenUsSeenSharedListIds") || "null");
    } catch (_) { seenSharedListIds = null; }
    if (!Array.isArray(seenSharedListIds)) {
      seenSharedListIds = sharedListIds;
      localStorage.setItem("betweenUsSeenSharedListIds", JSON.stringify(seenSharedListIds));
    }
    const newSharedLists = sharedListIds.filter(id => !seenSharedListIds.includes(id)).length;

    const total = newIncomingQuestions + unreadReplies + newSharedLists;
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.classList.toggle("hidden", total < 1);
    button.setAttribute("aria-label", `${total} new ${total === 1 ? "item" : "items"}: questions, replies, or shared lists. Go to Questions from Friends.`);
    button.title = `${newIncomingQuestions} new question${newIncomingQuestions === 1 ? "" : "s"}, ${unreadReplies} unread repl${unreadReplies === 1 ? "y" : "ies"}, ${newSharedLists} new shared list${newSharedLists === 1 ? "" : "s"}`;
  } catch (error) {
    console.error("HEADER ACTIVITY COUNT ERROR:", error);
  }
}

/* =========================================================
   UPDATE USERNAME DISPLAY
========================================================= */

function updateUsernameDisplay() {

  const display =
    $("usernameDisplay");

  if (display) {
    if (username) {
      display.textContent = username;
      display.classList.remove("hidden");
    } else {
      display.textContent = "";
      display.classList.add("hidden");
    }
  }

  // The logout action is only relevant for a signed-in,
  // registered Between Us account (not anonymous visitors).
  const logoutButton = $("logoutButton");
  if (logoutButton) {
    logoutButton.classList.toggle(
      "hidden",
      !currentUser || currentUser.isAnonymous
    );
  }
}

/* =========================================================
   LOG OUT
   Sign out without immediately creating a new anonymous
   Firebase session. Keep the landing/account options usable.
========================================================= */
function initLogoutButton() {
  const logoutButton = $("logoutButton");
  if (!logoutButton || logoutButton.dataset.logoutReady === "true") {
    return;
  }

  logoutButton.dataset.logoutReady = "true";

  logoutButton.addEventListener("click", async (event) => {
    event.preventDefault();
    if (logoutButton.disabled) return;

    logoutButton.disabled = true;
    const originalText = logoutButton.textContent;
    logoutButton.textContent = "Logging out…";

    try {
      // Remember only the username, never the password.
      const usernameToRemember =
        username || localStorage.getItem("betweenUsUsername") ||
        localStorage.getItem("betweenUsRememberedUsername") || "";

      if (usernameToRemember) {
        localStorage.setItem("betweenUsRememberedUsername", usernameToRemember);
      }

      await logout();

      currentUser = null;
      username = "";

      try {
        localStorage.removeItem("betweenUsUsername");
        localStorage.setItem("betweenUsLoggedOut", "true");
      } catch (storageError) {
        // Signing out should still work if storage is unavailable.
      }

      updateUsernameDisplay();

      // Clear account-only dashboard content from view.
      const dashboardContent = $("dashboardContent");
      if (dashboardContent) dashboardContent.innerHTML = "";

      const homeContent = $("homeContent");
      if (homeContent) homeContent.classList.remove("hidden");

      // Return to the account gate: the user must log in or switch to create account.
      showUsernameScreen("login", false);
      toast("You have been logged out. Log in or create an account to continue.");
    } catch (error) {
      console.error("LOGOUT ERROR:", error);
      toast(error?.message || "Couldn't log out. Please try again.");
    } finally {
      logoutButton.disabled = false;
      logoutButton.textContent = originalText || "Log out";
      updateUsernameDisplay();
    }
  });
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

    const loginUsernameInput = $("loginUsernameInput");
    if (loginUsernameInput) {
      const rememberedUsername =
        localStorage.getItem("betweenUsRememberedUsername") ||
        localStorage.getItem("betweenUsUsername") || "";
      if (!loginUsernameInput.value.trim() && rememberedUsername) {
        loginUsernameInput.value = rememberedUsername;
      }
    }

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

    localStorage.setItem("betweenUsUsername", username);
    localStorage.setItem("betweenUsRememberedUsername", username);
    localStorage.removeItem("betweenUsLoggedOut");

    updateUsernameDisplay();

    showAccountError("");

    /*
     * Clear password fields.
     */
    passwordInput.value = "";
    // Keep the username visible for the next login on this device.

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
  if (!currentUser) {
    try {
      currentUser = await startAnonymousAuth();
    } catch (authError) {
      console.error("CREATE ACCOUNT SESSION ERROR:", authError);
      return showAccountError(
        "Couldn't start account creation. Please try again."
      );
    }
  }

  if (!currentUser.isAnonymous) {
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
    localStorage.setItem("betweenUsRememberedUsername", username);
    localStorage.removeItem("betweenUsLoggedOut");

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

    localStorage.removeItem("betweenUsLoggedOut");

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

    await createAppNotification(targetUser.uid, {
      type: "friend_request",
      title: "New friend request",
      message: `${sender.username || "Someone"} sent you a friend request.`,
      friendRequestId: requestId
    });

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

    await createAppNotification(request.fromUid, {
      type: "friend_request_accepted",
      title: "Friend request accepted",
      message: `${username || "Your friend"} accepted your friend request.`,
      friendRequestId: requestId
    });

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

  username = "";

  // An explicit logout must remain logged out after refresh.
  // Do not silently start an anonymous Firebase session in this state.
  if (localStorage.getItem("betweenUsLoggedOut") === "true") {
    currentUser = null;
    const rememberedUsername =
      localStorage.getItem("betweenUsRememberedUsername") || "";
    if (rememberedUsername && $("loginUsernameInput")) {
      $("loginUsernameInput").value = rememberedUsername;
    }
    showUsernameScreen("login", false);
    return;
  }
  
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

initLogoutButton();
initHeaderActivityButton();
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
    <details class="bu-chat-accordion">
      <summary class="bu-chat-accordion-summary">
        <span class="bu-chat-accordion-title">💬 Conversation <span class="bu-chat-message-count" data-chat-message-count="${escapeHtml(questionId)}">Checking messages…</span></span>
        <span class="bu-chat-accordion-hint">Expand chat <span aria-hidden="true">＋</span></span>
      </summary>
      <div class="bu-chat" data-chat-question-id="${escapeHtml(questionId)}">
        <div class="bu-chat-messages" aria-live="polite"><p class="muted">Open the conversation to load messages…</p></div>
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
      </div>
    </details>`;
}

function setFriendChatMessageCount(chat, count) {
  const questionId = chat?.dataset.chatQuestionId;
  const countEl = questionId
    ? chat.closest('.bu-chat-accordion')?.querySelector('.bu-chat-message-count')
    : null;
  if (!countEl) return;
  countEl.textContent = `${count} ${count === 1 ? 'message' : 'messages'}`;
  countEl.classList.toggle('is-empty', count === 0);
}

async function refreshFriendChatMessageCount(chat) {
  if (!chat || !currentUser) return;
  const questionId = chat.dataset.chatQuestionId;
  if (!questionId) return;
  try {
    const snap = await getDocs(collection(db, 'friendQuestions', questionId, 'messages'));
    setFriendChatMessageCount(chat, snap.size);
  } catch (error) {
    console.error('LOAD FRIEND CHAT MESSAGE COUNT ERROR:', error);
    const countEl = chat.closest('.bu-chat-accordion')?.querySelector('.bu-chat-message-count');
    if (countEl) countEl.textContent = 'Messages unavailable';
  }
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
    setFriendChatMessageCount(chat, snap.size);
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
    // Keep each conversation connected to Firestore in real time. This updates
    // message totals and open conversations without requiring a page refresh.
    if (!chat.dataset.realtimeMessagesBound) {
      chat.dataset.realtimeMessagesBound = 'true';
      const questionId = chat.dataset.chatQuestionId;
      if (questionId) {
        const messagesQuery = query(
          collection(db, 'friendQuestions', questionId, 'messages'),
          orderBy('createdAt', 'asc')
        );
        chat._betweenUsMessagesUnsubscribe = onSnapshot(messagesQuery, () => {
          if (!chat.isConnected) {
            chat._betweenUsMessagesUnsubscribe?.();
            return;
          }
          refreshFriendChatMessageCount(chat);
          const accordion = chat.closest('.bu-chat-accordion');
          if (!accordion || accordion.open) {
            loadFriendQuestionChat(chat).then(() => updateHeaderActivityCount());
          } else {
            updateHeaderActivityCount();
          }
        }, error => {
          console.error('REALTIME FRIEND CHAT LISTENER ERROR:', error);
        });
      }
    }

    // Show each conversation's message total even while its chat is collapsed.
    refreshFriendChatMessageCount(chat);
    const accordion = chat.closest('.bu-chat-accordion');
    if (accordion && !accordion.dataset.chatToggleBound) {
      accordion.dataset.chatToggleBound = 'true';
      accordion.addEventListener('toggle', () => {
        const hint = accordion.querySelector('.bu-chat-accordion-hint');
        if (hint) hint.innerHTML = accordion.open
          ? 'Collapse chat <span aria-hidden="true">−</span>'
          : 'Expand chat <span aria-hidden="true">＋</span>';
        if (accordion.open) {
          try {
            localStorage.setItem(`betweenUsLastSeenChat:${currentUser?.uid}:${chat.dataset.chatQuestionId}`, String(Date.now()));
          } catch (_) {}
          loadFriendQuestionChat(chat).then(() => updateHeaderActivityCount());
        }
      });
      const hint = accordion.querySelector('.bu-chat-accordion-hint');
      if (hint) hint.innerHTML = accordion.open
        ? 'Collapse chat <span aria-hidden="true">−</span>'
        : 'Expand chat <span aria-hidden="true">＋</span>';
    } else if (!accordion) {
      // Preserve loading behavior for any legacy chat markup outside an accordion.
      loadFriendQuestionChat(chat);
    }
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
        const messageRecipientUid = q.fromUid === currentUser.uid ? q.toUid : q.fromUid;
        await addDoc(collection(db, 'friendQuestions', questionId, 'messages'), {
          questionId,
          senderUid: currentUser.uid,
          recipientUid: messageRecipientUid,
          senderName: username || currentUser.displayName || (q.fromUid === currentUser.uid ? (q.fromUsername || 'You') : (q.toUsername || 'Your friend')),
          type: 'text', text, createdAt: serverTimestamp()
        });
        await createAppNotification(messageRecipientUid, {
          type: "friend_message",
          title: "New message from a friend",
          message: `${username || "Your friend"} sent a message in your question chat.`,
          questionId,
          targetSection: q.fromUid === messageRecipientUid ? "sentFriendQuestions" : "incomingFriendQuestions"
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
        const messageRecipientUid = q.fromUid === currentUser.uid ? q.toUid : q.fromUid;
        await addDoc(collection(db, 'friendQuestions', questionId, 'messages'), {
          questionId, senderUid: currentUser.uid,
          recipientUid: messageRecipientUid,
          senderName: username || currentUser.displayName || (q.fromUid === currentUser.uid ? (q.fromUsername || 'You') : (q.toUsername || 'Your friend')),
          type: 'poll', pollTitle: title, pollOptions: options, votes: {}, createdAt: serverTimestamp()
        });
        await createAppNotification(messageRecipientUid, {
          type: "friend_message",
          title: "New poll from a friend",
          message: `${username || "Your friend"} sent a poll in your question chat.`,
          questionId,
          targetSection: q.fromUid === messageRecipientUid ? "sentFriendQuestions" : "incomingFriendQuestions"
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

  // Keep the current section visible while fetching. Remove it only immediately
  // before replacing it, so overlapping refreshes cannot append duplicates.

  try {
    const questionsQuery = query(
      collection(db, "friendQuestions"),
      where("toUid", "==", currentUser.uid)
    );

    const snapshot = await getDocs(questionsQuery);

    // Firestore document IDs are unique; dedupe defensively before rendering.
    const questions = Array.from(
      new Map(snapshot.docs.map(d => [d.id, { id: d.id, ...d.data() }])).values()
    ).sort(
        (a, b) =>
          (b.createdAt?.seconds || 0) -
          (a.createdAt?.seconds || 0)
      );

    const section = document.createElement("section");
    section.id = "incomingFriendQuestions";
    section.className = "friend-inbox dashboard-section";

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

    dashboard.querySelector("#incomingFriendQuestions")?.remove();
    dashboard.appendChild(section);
    setupFriendQuestionChats(section);
    updateHeaderActivityCount();

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

            await createAppNotification(question.fromUid, {
              type: "friend_question_answered",
              title: "Your friend answered your question",
              message: `${username || "Your friend"} answered “${(question.question || "your question").slice(0, 100)}”.`,
              questionId,
              targetSection: "sentFriendQuestions"
            });

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
    section.className = "friend-inbox dashboard-section";
    section.innerHTML = `
      <div class="empty-state">
        <span>🌧️</span>
        <h3>Couldn't load friend questions</h3>
        <p>Please refresh and try again.</p>
      </div>
    `;

    dashboard.querySelector("#incomingFriendQuestions")?.remove();
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
  section.className = "friend-inbox dashboard-section";
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
    updateHeaderActivityCount();

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
          // Remove chat messages first so the question does not leave orphaned subcollection data.
          const messagesSnapshot = await getDocs(collection(db, "friendQuestions", id, "messages"));
          for (const messageDoc of messagesSnapshot.docs) {
            await deleteDoc(messageDoc.ref);
          }
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

// async function loadPersonalQuestionDrafts() {
//   const dashboard = $("dashboardContent");
//   if (!dashboard || !currentUser) return;

//   dashboard.querySelector("#personalQuestionDrafts")?.remove();

//   const section = document.createElement("section");
//   section.id = "personalQuestionDrafts";
//   section.className = "friend-inbox";
//   section.innerHTML = `
//     <details>
//       <summary class="section-heading">
//         <div>
//           <p class="eyebrow">A quiet space for your own thoughts</p>
//           <h2>📝 Personal Questions</h2>
//         </div>
//         <span class="muted">Private to you</span>
//       </summary>
//       <div class="personal-drafts-content">
//         <form id="personalQuestionForm">
//           <label for="personalQuestionInput">Save a question for yourself</label>
//           <textarea id="personalQuestionInput" class="text-input" maxlength="500" required placeholder="A question to reflect on…"></textarea>
//           <div class="friend-actions">
//             <button class="soft-button" type="submit" id="savePersonalQuestionButton">Save question ♡</button>
//             <button class="soft-button hidden" type="button" id="cancelPersonalQuestionEdit">Cancel edit</button>
//           </div>
//         </form>
//         <div id="personalQuestionList"><p class="muted">Loading your private questions…</p></div>
//       </div>
//     </details>
//   `;
//   dashboard.appendChild(section);

//   const form = section.querySelector("#personalQuestionForm");
//   const input = section.querySelector("#personalQuestionInput");
//   const list = section.querySelector("#personalQuestionList");
//   const saveButton = section.querySelector("#savePersonalQuestionButton");
//   const cancelButton = section.querySelector("#cancelPersonalQuestionEdit");
//   let drafts = [];
//   let editingId = null;

//   function resetForm() {
//     editingId = null;
//     input.value = "";
//     saveButton.textContent = "Save question ♡";
//     cancelButton.classList.add("hidden");
//   }

//   function renderDrafts() {
//     if (!drafts.length) {
//       list.innerHTML = `<div class="mini-empty">Your private questions will appear here. 🌷</div>`;
//       return;
//     }

//     list.innerHTML = drafts.map(draft => `
//       <article class="dashboard-card compact" data-personal-draft-id="${escapeHtml(draft.id)}">
//         <div class="dashboard-icon">📝</div>
//         <div class="dashboard-main">
//           <p>${escapeHtml(draft.question)}</p>
//           <small class="muted">Only you can see this question.</small>
//         </div>
//         <div class="dashboard-actions">
//           <button type="button" class="soft-button small" data-edit-personal-draft="${escapeHtml(draft.id)}">Edit</button>
//           <button type="button" class="soft-button small" data-delete-personal-draft="${escapeHtml(draft.id)}">Delete</button>
//         </div>
//       </article>
//     `).join("");
//   }

//   async function fetchDrafts() {
//     const snapshot = await getDocs(query(
//       collection(db, "personalQuestionDrafts"),
//       where("ownerUid", "==", currentUser.uid)
//     ));
//     drafts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
//       .sort((a, b) => (b.updatedAt?.seconds || b.createdAt?.seconds || 0) - (a.updatedAt?.seconds || a.createdAt?.seconds || 0));
//     renderDrafts();
//   }

//   form.addEventListener("submit", async event => {
//     event.preventDefault();
//     const question = input.value.trim();
//     if (!question) return toast("Write a question first.");
//     if (question.length > 500) return toast("Questions must be 500 characters or fewer.");

//     saveButton.disabled = true;
//     try {
//       if (editingId) {
//         await updateDoc(doc(db, "personalQuestionDrafts", editingId), {
//           question,
//           updatedAt: serverTimestamp()
//         });
//         toast("Private question updated ♡");
//       } else {
//         await addDoc(collection(db, "personalQuestionDrafts"), {
//           ownerUid: currentUser.uid,
//           question,
//           createdAt: serverTimestamp(),
//           updatedAt: serverTimestamp()
//         });
//         toast("Private question saved ♡");
//       }
//       resetForm();
//       await fetchDrafts();
//     } catch (error) {
//       console.error("SAVE PERSONAL QUESTION ERROR:", error);
//       toast("Couldn't save it. Check that your personalQuestionDrafts Firestore rules are published.");
//     } finally {
//       saveButton.disabled = false;
//     }
//   });

//   cancelButton.addEventListener("click", resetForm);

//   list.addEventListener("click", async event => {
//     const editButton = event.target.closest("[data-edit-personal-draft]");
//     const deleteButton = event.target.closest("[data-delete-personal-draft]");

//     if (editButton) {
//       const draft = drafts.find(item => item.id === editButton.dataset.editPersonalDraft);
//       if (!draft) return;
//       editingId = draft.id;
//       input.value = draft.question;
//       saveButton.textContent = "Update question ♡";
//       cancelButton.classList.remove("hidden");
//       input.focus();
//       return;
//     }

//     if (deleteButton) {
//       const id = deleteButton.dataset.deletePersonalDraft;
//       if (!confirm("Delete this private question?")) return;
//       try {
//         await deleteDoc(doc(db, "personalQuestionDrafts", id));
//         if (editingId === id) resetForm();
//         toast("Private question deleted.");
//         await fetchDrafts();
//       } catch (error) {
//         console.error("DELETE PERSONAL QUESTION ERROR:", error);
//         toast("Couldn't delete that private question.");
//       }
//     }
//   });

//   try {
//     await fetchDrafts();
//   } catch (error) {
//     console.error("LOAD PERSONAL QUESTIONS ERROR:", error);
//     list.innerHTML = `<div class="mini-empty">Couldn't load your private questions. Check your Firestore rules.</div>`;
//   }
// }

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

// Reveal the friend picker when the creator chooses "Send to friend".
document.querySelectorAll('input[name="friendQuestionMode"]').forEach(radio => {
  radio.addEventListener("change", async () => {
    const selected = document.querySelector('input[name="friendQuestionMode"]:checked')?.value;
    const area = $("friendQuestionSelectArea");
    if (selected === "friend") {
      area?.classList.remove("hidden");
      await populateFriendDropdowns();
    } else {
      area?.classList.add("hidden");
      if ($("questionFriendSelect")) $("questionFriendSelect").value = "";
    }
  });
});

async function loadDashboard() {

  if (!currentUser) {
    return;
  }

  startAppNotificationListener();

  $("dashboardContent").innerHTML =
    `<div class="loading-inline">
      Loading your things… ✨
    </div>`;

  // Keep the rest of your existing loadDashboard()
  // function exactly as it is.

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
updateHeaderActivityCount();
// await loadPersonalQuestionDrafts();
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

    const responses = snap.docs.map(d => {
      const saved = { id: d.id, ...d.data() };
      const linkedQuestion = (game.questions || []).find(q => q.id === saved.questionId);
      return {
        ...saved,
        question: saved.question || linkedQuestion?.question || "",
        category: saved.category || linkedQuestion?.category || "very-light"
      };
    });

    currentResponses = responses;

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
   EDIT QUESTION GAME
========================================================= */

async function editGame(id) {
  try {
    const snap = await getDoc(doc(db, "games", id));
    if (!snap.exists()) {
      return toast("That game no longer exists.");
    }

    const game = { id: snap.id, ...snap.data() };
    if (game.creatorId !== currentUser?.uid) {
      return toast("Only the creator can edit this game.");
    }

    await startQuestionCreator(game);
  } catch (error) {
    console.error("EDIT GAME ERROR:", error);
    toast("Couldn't open this game for editing.");
  }
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

/* Each person checks off their own copy of a shared item. */
function getItemCheckers(item) {
  const uids = Array.isArray(item?.checkedByUids)
    ? [...item.checkedByUids]
    : (item?.checkedByUid ? [item.checkedByUid] : []);
  const names = Array.isArray(item?.checkedByUsernames)
    ? [...item.checkedByUsernames]
    : (item?.checkedByUid && item?.checkedByUsername
        ? [{ uid: item.checkedByUid, username: item.checkedByUsername }]
        : []);

  // Support records written by the older single-checker version.
  const normalizedNames = names.map(entry =>
    typeof entry === "string"
      ? { uid: null, username: entry }
      : entry
  );

  return { uids, names: normalizedNames };
}

function isItemCheckedByCurrentUser(item) {
  if (!currentUser?.uid) return false;
  return getItemCheckers(item).uids.includes(currentUser.uid);
}

function renderItemCheckers(item) {
  const { uids, names } = getItemCheckers(item);
  const visibleNames = names.filter(entry => entry?.username);

  // Legacy records can have the UID and name in separate fields.
  if (!visibleNames.length && item?.checkedByUid && item?.checkedByUsername) {
    visibleNames.push({ uid: item.checkedByUid, username: item.checkedByUsername });
  }

  return visibleNames.map(entry => `
    <span class="shared-item-checker" title="Checked by ${escapeHtml(entry.username)}">
      ${escapeHtml(entry.username)}
    </span>
  `).join("");
}

async function setCurrentUserItemCheck(itemId, checked) {
  const uid = currentUser?.uid;
  if (!uid) throw new Error("Sign in before checking a list item.");

  const itemRef = doc(db, "lists", currentListId, "items", itemId);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(itemRef);
    if (!snapshot.exists()) throw new Error("That list item no longer exists.");

    const data = snapshot.data();
    const checkers = getItemCheckers(data);
    const nextUids = checkers.uids.filter(existingUid => existingUid !== uid);
    const nextNames = checkers.names.filter(entry => entry?.uid !== uid);

    if (checked) {
      nextUids.push(uid);
      nextNames.push({ uid, username: username || "Friend" });
    }

    transaction.update(itemRef, {
      checkedByUids: nextUids,
      checkedByUsernames: nextNames,
      // Legacy fields remain for compatibility with older app versions.
      checked: nextUids.length > 0,
      checkedByUid: nextUids.length ? nextUids[0] : null,
      checkedByUsername: nextNames.length ? nextNames[0].username : null,
      updatedAt: serverTimestamp()
    });
  });
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
                    isItemCheckedByCurrentUser(item)
                      ? "checked"
                      : ""
                  }"
                >

                  <label>

                    <input
                      type="checkbox"
                      data-player-check="${item.id}"
                      ${
                        isItemCheckedByCurrentUser(item)
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

                    <span class="shared-item-text">
                      ${escapeHtml(
                        item.text
                      )}
                    </span>

                  </label>

                  <div class="shared-item-checkers">
                    ${renderItemCheckers(item)}
                  </div>

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

    await setCurrentUserItemCheck(itemId, checked);

    await refreshPlayerListItems();
    const changedItem = currentListItems.find(item => item.id === itemId);
    await notifySharedListChange(checked ? "checked an item" : "unchecked an item", changedItem?.text || "");
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
    await notifySharedListChange("deleted an item from the list");
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
        await notifySharedListChange("added an item to the list", text);
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


async function shareManagedList() {
  if (!currentUser || !currentListId || !currentList) {
    return toast("Open a list first.");
  }

  if (currentList.creatorId !== currentUser.uid) {
    return toast("Only the creator can share this list.");
  }

  const friendSelect = $("manageListFriendSelect");
  const status = $("manageListShareStatus");
  const shareButton = $("shareManagedListButton");

  const friendUid = friendSelect?.value;

  if (!friendUid) {
    return toast("Choose a friend to share this list with.");
  }

  const friendUsername =
    friendSelect.options[friendSelect.selectedIndex]?.textContent?.trim() ||
    "Friend";

  try {
    if (shareButton) shareButton.disabled = true;
    if (status) status.textContent = "Sharing list...";
    const alreadySharedWithThisFriend = currentList.sharedWithUid === friendUid;

    await updateDoc(
      doc(db, "lists", currentListId),
      {
        sharedWithUid: friendUid,
        sharedWithUsername: friendUsername,
        sharedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }
    );

    if (!alreadySharedWithThisFriend) {
      await createAppNotification(friendUid, {
        type: "shared_list",
        title: "A friend shared a list with you",
        message: `${username || "A friend"} shared “${currentList.title || "a list"}” with you.`,
        listId: currentListId,
        listTitle: currentList.title || "Untitled list",
        targetSection: "shared-list"
      });
    }


    currentList.sharedWithUid = friendUid;
    currentList.sharedWithUsername = friendUsername;

    if (status) {
      status.textContent = `List shared with ${friendUsername}.`;
    }

    toast(`List shared with ${friendUsername}.`);

  } catch (error) {
    console.error("SHARE LIST ERROR:", error);

    if (status) {
      status.textContent = "Couldn't share this list.";
    }

    toast("Couldn't share this list. Check your permissions.");
  } finally {
    if (shareButton) shareButton.disabled = false;
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
                    isItemCheckedByCurrentUser(item)
                      ? "checked"
                      : ""
                  }"
                >

                  <label>

                    <input
                      type="checkbox"
                      data-manage-check="${item.id}"
                      ${
                        isItemCheckedByCurrentUser(item)
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

                  <div class="shared-item-checkers">
                    ${renderItemCheckers(item)}
                  </div>

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

          try {
            await setCurrentUserItemCheck(
              input.dataset.manageCheck,
              input.checked
            );
          } catch (error) {
            console.error("Couldn't update checklist check:", error);
            toast("Couldn't update that item. Please try again.");
          }

          await refreshPlayerListItems();
          const changedItem = currentListItems.find(item => item.id === input.dataset.manageCheck);
          await notifySharedListChange(input.checked ? "checked an item" : "unchecked an item", changedItem?.text || "");
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
          await notifySharedListChange("edited an item in the list", text);
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
          await notifySharedListChange("deleted an item from the list");
          renderManageItems();
        }
      );

    });
}

/* =========================================================
   SAVE LIST PERMISSION
========================================================= */

$("shareManagedListButton")?.addEventListener(
  "click",
  shareManagedList
);


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

        await notifySharedListChange(`changed the list permission to ${currentList.permission}`);

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
        await notifySharedListChange("added an item to the list", text);
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
   OPTIONS EDITOR
   Restored: required by resetQuestionCreator() and answer-type changes.
========================================================= */

function renderOptionsEditor() {

  const isOptions =
    document.querySelector(
      'input[name="answerType"]:checked'
    )?.value === "options";

  const editor = $("optionsEditor");
  const list = $("optionsList");

  if (!editor || !list) {
    console.warn(
      "Options editor elements were not found in the page."
    );
    return;
  }

  editor.classList.toggle("hidden", !isOptions);

  if (isOptions && !list.children.length) {
    addOptionRow();
    addOptionRow();
  }
}

function addOptionRow(value = "") {

  const list = $("optionsList");
  if (!list) return;

  const row = document.createElement("div");
  row.className = "option-editor-row";

  const input = document.createElement("input");
  input.className = "text-input option-value";
  input.maxLength = 160;
  input.placeholder = "Answer choice";
  input.value = value;
  input.type = "text";

  const removeButton = document.createElement("button");
  removeButton.className = "icon-button danger remove-option";
  removeButton.type = "button";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove answer choice");
  removeButton.addEventListener("click", () => row.remove());

  row.append(input, removeButton);
  list.appendChild(row);
}

$("addOptionButton")?.addEventListener("click", () => addOptionRow());

document
  .querySelectorAll('input[name="answerType"]')
  .forEach(input => {
    input.addEventListener("change", renderOptionsEditor);
  });

/* =========================================================
   QUESTION CREATOR HELPERS
   Restored so editing and saving games work again.
========================================================= */

function getSelectedCategory() {
  return document.querySelector('input[name="category"]:checked')?.value || "very-light";
}

function getQuestionDraft() {
  const question = $("questionInput").value.trim();
  const answerType = document.querySelector('input[name="answerType"]:checked')?.value || "written";
  const options = [...document.querySelectorAll(".option-value")]
    .map(input => input.value.trim())
    .filter(Boolean);
  const friendMode = document.querySelector('input[name="friendQuestionMode"]:checked')?.value || "game";
  const friendUid = $("questionFriendSelect")?.value || "";

  return {
    id: editingQuestionId || makeId(),
    question,
    category: getSelectedCategory(),
    answerType,
    options: answerType === "options" ? options : [],
    allowCustomAnswer: answerType === "options" ? $("allowCustomAnswer").checked : false,
    friendMode,
    friendUid
  };
}

function makeGameLink(gameId) {
  const url = new URL(window.location.href);
  url.searchParams.delete("list");
  url.searchParams.set("game", gameId);
  url.hash = "";
  return url.toString();
}

function clearQuestionForm() {
  editingQuestionId = null;
  $("questionInput").value = "";

  const defaultCategory = document.querySelector('input[name="category"][value="very-light"]');
  if (defaultCategory) defaultCategory.checked = true;

  const writtenType = document.querySelector('input[name="answerType"][value="written"]');
  if (writtenType) writtenType.checked = true;

  $("allowCustomAnswer").checked = false;
  $("optionsList").innerHTML = "";
  $("cancelEditQuestionButton")?.classList.add("hidden");
  const gameMode = document.querySelector('input[name="friendQuestionMode"][value="game"]');
  if (gameMode) gameMode.checked = true;
  if ($("questionFriendSelect")) $("questionFriendSelect").value = "";
  $("friendQuestionSelectArea")?.classList.add("hidden");
  renderOptionsEditor();
}

function loadQuestionForEdit(id) {
  const question = creatorQuestions.find(item => item.id === id);
  if (!question) return toast("Couldn't find that question.");

  editingQuestionId = question.id;
  $("questionInput").value = question.question || "";

  const category = document.querySelector(`input[name="category"][value="${CSS.escape(question.category || "very-light")}"]`);
  if (category) category.checked = true;

  const answerType = question.answerType === "options" ? "options" : "written";
  const typeInput = document.querySelector(`input[name="answerType"][value="${answerType}"]`);
  if (typeInput) typeInput.checked = true;

  $("allowCustomAnswer").checked = Boolean(question.allowCustomAnswer);
  $("optionsList").innerHTML = "";
  (question.options || []).forEach(option => addOptionRow(option));
  renderOptionsEditor();
  $("cancelEditQuestionButton")?.classList.remove("hidden");
  $("questionInput").focus();
}

function renderQuestionList() {
  const count = $("questionCount");
  const empty = $("questionEmpty");
  const list = $("questionList");

  if (!count || !empty || !list) {
    console.warn("Question list elements were not found in the page.");
    return;
  }

  count.textContent = `${creatorQuestions.length} question${creatorQuestions.length === 1 ? "" : "s"}`;
  empty.classList.toggle("hidden", creatorQuestions.length > 0);

  list.innerHTML = creatorQuestions.map((question, index) => {
    const category = CATEGORIES[question.category] || CATEGORIES["very-light"];
    const summary = question.answerType === "options"
      ? `☑️ ${(question.options || []).length} choices${question.allowCustomAnswer ? " + something else" : ""}`
      : "📝 Written answer";

    return `
      <div class="builder-question">
        <div class="builder-number">${index + 1}</div>
        <div class="builder-question-main">
          <span class="mini-badge ${escapeHtml(category.scene)}">${escapeHtml(category.label)}</span>
          <strong>${escapeHtml(question.question || "Untitled question")}</strong>
          <small>${summary}</small>
        </div>
        <div class="builder-actions">
          <button class="soft-button small" data-edit-question="${escapeHtml(question.id)}" type="button">Edit</button>
          <button class="icon-button danger" data-delete-question="${escapeHtml(question.id)}" type="button" aria-label="Delete question">×</button>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-edit-question]").forEach(button => {
    button.addEventListener("click", () => loadQuestionForEdit(button.dataset.editQuestion));
  });

  list.querySelectorAll("[data-delete-question]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deleteQuestion;
      creatorQuestions = creatorQuestions.filter(question => question.id !== id);
      if (editingQuestionId === id) clearQuestionForm();
      renderQuestionList();

      if (currentGameId) {
        try {
          await updateDoc(doc(db, "games", currentGameId), {
            questions: creatorQuestions.map(({ friendMode, friendUid, ...question }) => question),
            updatedAt: serverTimestamp()
          });
          await loadDashboard();
          toast("Question deleted.");
        } catch (error) {
          console.error("DELETE GAME QUESTION ERROR:", error);
          toast("Question removed here, but couldn't save the change.");
        }
      }
    });
  });
}

$("saveQuestionButton")?.addEventListener("click", async () => {
  const draft = getQuestionDraft();
  if (!draft.question) return toast("Write the question first.");
  if (draft.answerType === "options" && draft.options.length < 2) {
    return toast("Add at least two answer choices.");
  }

  // Sending to a friend is a separate action from saving a question to a game.
  if (draft.friendMode === "friend") {
    if (!currentUser?.uid) return toast("Please sign in again before sending a question.");
    if (!draft.friendUid) return toast("Choose a friend first.");

    const selectedFriendOption = $("questionFriendSelect")?.selectedOptions?.[0];
    const friendUsername = selectedFriendOption?.textContent?.trim() || "Friend";
    const sendButton = $("saveQuestionButton");
    if (sendButton) sendButton.disabled = true;

    try {
      const friendQuestionRef = await addDoc(collection(db, "friendQuestions"), {
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
        createdAt: serverTimestamp(),
        sentAt: serverTimestamp()
      });

      await createAppNotification(draft.friendUid, {
        type: "friend_question_received",
        title: "A friend sent you a question",
        message: `${username || "Your friend"} sent you a question to answer.`,
        questionId: friendQuestionRef.id,
        targetSection: "incomingFriendQuestions"
      });

      toast("Question sent to your friend ♡");
      clearQuestionForm();
      document.querySelector('input[name="friendQuestionMode"][value="game"]')?.click();
      await loadDashboard();
    } catch (error) {
      console.error("SEND QUESTION TO FRIEND ERROR:", error);
      toast(error?.code === "permission-denied"
        ? "Firebase blocked this send. Check the friendQuestions create rule."
        : "Couldn't send the question. Please try again.");
    } finally {
      if (sendButton) sendButton.disabled = false;
    }
    return;
  }

  const existingIndex = creatorQuestions.findIndex(question => question.id === draft.id);
  if (existingIndex >= 0) creatorQuestions[existingIndex] = draft;
  else creatorQuestions.push(draft);

  const gameQuestions = creatorQuestions.map(({ friendMode, friendUid, ...question }) => question);
  const title = $("gameTitle").value.trim() || "Between Us Questions";

  try {
    if (!currentUser?.uid) throw new Error("No signed-in user is available.");

    if (!currentGameId) {
      const gameRef = await addDoc(collection(db, "games"), {
        creatorId: currentUser.uid,
        title,
        questions: gameQuestions,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      currentGameId = gameRef.id;
      toast("Your game is ready ✨");
    } else {
      await updateDoc(doc(db, "games", currentGameId), {
        title,
        questions: gameQuestions,
        active: true,
        updatedAt: serverTimestamp()
      });
      toast("Question saved ✨");
    }

    $("gameLink").value = makeGameLink(currentGameId);
    $("gameCreatedArea").classList.remove("hidden");
    renderQuestionList();
    clearQuestionForm();
    await loadDashboard();
  } catch (error) {
    console.error("SAVE QUESTION ERROR:", error);
    toast("Couldn't save the question.");
  }
});

$("cancelEditQuestionButton")?.addEventListener("click", clearQuestionForm);

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