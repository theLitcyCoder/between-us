import {
  db,
  startAnonymousAuth
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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let creatorQuestions = [];
let editingQuestionId = null;
let currentGameId = null;
let currentGame = null;
let currentQuestionIndex = 0;
let currentResponses = [];
let currentListId = null;
let currentList = null;
let currentListItems = [];
let dashboardGames = [];
let dashboardLists = [];
let dashboardGroups = [];

const CATEGORIES = {
  "very-light": { label: "🌼 Very Light", scene: "very-light", character: ["🐰","🐻","🐰🌼","🐻☀️"], decoration: "☀️" },
  "light": { label: "🌸 Light", scene: "light", character: ["🐰🌸","🐻🌷","🐰💕","🐻🌼"], decoration: "🌷" },
  "deep": { label: "🌙 Deep", scene: "deep", character: ["🐰🌙","🐻⭐","🐰✨","🐻🌙"], decoration: "✦" },
  "sensitive": { label: "💗 Sensitive", scene: "sensitive", character: ["🐰🫶","🐻🧸","🐰☕","🐻💗"], decoration: "♡" },
  "spicy": { label: "💗 Spicy", scene: "spicy", character: ["😘😍","😋😛","💦🧡","🐻💗"], decoration: "😛" }
};

const PERMISSIONS = {
  view: "👀 View only",
  check: "☑️ Check items",
  edit: "✏️ Edit list",
  full: "🛠️ Full access"
};

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("backButton").classList.toggle("hidden", id === "landingScreen" || id === "loadingScreen");
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function makeId() {
  return crypto.randomUUID();
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setParam(name, value) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  history.replaceState({}, "", url);
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) return "Just now";
  return timestamp.toDate().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* ---------- AUTH / START ---------- */

async function boot() {
  try {
    currentUser = await startAnonymousAuth();

      console.log("CURRENT USER:", currentUser);
console.log("CURRENT UID:", currentUser.uid);


    const gameId = getParam("game");
    const listId = getParam("list");

    if (gameId) {
      await loadPlayerGame(gameId);
      return;
    }

    if (listId) {
      await loadPlayerList(listId);
      return;
    }

    showScreen("landingScreen");
    await loadDashboard();
  } catch (error) {
    console.error(error);
    showScreen("landingScreen");
    toast("Something went wrong connecting to Firebase.");
  }
}

/* ---------- NAV ---------- */

$("homeButton").addEventListener("click", () => {
  setParam("game", null);
  setParam("list", null);
  showScreen("landingScreen");
  loadDashboard();
});

$("backButton").addEventListener("click", () => {
  setParam("game", null);
  setParam("list", null);
  showScreen("landingScreen");
  loadDashboard();
});

$("finishHomeButton").addEventListener("click", () => {
  setParam("game", null);
  setParam("list", null);
  showScreen("landingScreen");
  loadDashboard();
});

$("createQuestionsButton").addEventListener("click", startQuestionCreator);
$("createListButton").addEventListener("click", startListCreator);
$("createGroupButton").addEventListener("click", () => {
  $("groupTitle").value = "";
  showScreen("groupCreatorScreen");
});

/* ---------- DASHBOARD ---------- */

async function loadDashboard() {
  $("dashboardContent").innerHTML =
    `<div class="loading-inline">Loading your things… ✨</div>`;

  try {
    console.log("Loading dashboard for UID:", currentUser.uid);

    // Get all games first
    const gamesSnap = await getDocs(collection(db, "games"));

    console.log("ALL GAMES IN FIRESTORE:", gamesSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    })));

    dashboardGames = gamesSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(game => game.creatorId === currentUser.uid);

    console.log("MY GAMES:", dashboardGames);

    // Lists
    const listsSnap = await getDocs(collection(db, "lists"));

    dashboardLists = listsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(list => list.creatorId === currentUser.uid);

    // Groups
    const groupsSnap = await getDocs(collection(db, "listGroups"));

    dashboardGroups = groupsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(group => group.creatorId === currentUser.uid);

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

    dashboardGroups.sort(
      (a, b) =>
        (a.title || "").localeCompare(b.title || "")
    );

    renderDashboard();
    populateGroupSelect();

  } catch (error) {
    console.error("DASHBOARD ERROR:", error);

    $("dashboardContent").innerHTML = `
      <div class="empty-state">
        <span>🌧️</span>
        <h3>Couldn't load your dashboard</h3>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  }
}
async function getResponseCount(gameId) {
  try {
    const snap = await getDocs(collection(db, "games", gameId, "responses"));
    return snap.size;
  } catch {
    return 0;
  }
}

async function renderDashboard() {
  const content = $("dashboardContent");

  if (!dashboardGames.length && !dashboardLists.length && !dashboardGroups.length) {
    content.innerHTML = `<div class="empty-state"><span>🌷</span><h3>Nothing here yet</h3><p>Create a question game or a list and it'll show up here.</p></div>`;
    return;
  }

  let html = "";

  if (dashboardGames.length) {
    html += `<div class="dashboard-section"><div class="section-label">💭 QUESTION GAMES</div>`;
    for (const game of dashboardGames) {
      const count = await getResponseCount(game.id);
      html += `
        <article class="dashboard-card">
          <div class="dashboard-icon">💭</div>
          <div class="dashboard-main">
            <h3>${escapeHtml(game.title || "Untitled questions")}</h3>
            <p>${game.questions?.length || 0} questions · ${count} saved response${count === 1 ? "" : "s"}</p>
          </div>
          <div class="dashboard-actions">
            <button class="soft-button small" data-action="results" data-id="${game.id}">View results</button>
            <button class="soft-button small" data-action="edit-game" data-id="${game.id}">Edit</button>
            <button class="icon-button danger" data-action="delete-game" data-id="${game.id}" aria-label="Delete game">×</button>
          </div>
        </article>`;
    }
    html += `</div>`;
  }

  if (dashboardGroups.length) {
    html += `<div class="dashboard-section"><div class="section-label">☑️ LIST GROUPS</div>`;
    for (const group of dashboardGroups) {
      const lists = dashboardLists.filter(l => l.groupId === group.id);
      html += `
        <div class="group-card">
          <div class="group-heading">
            <div><span class="group-icon">📚</span><h3>${escapeHtml(group.title)}</h3></div>
            <button class="icon-button danger" data-action="delete-group" data-id="${group.id}" aria-label="Delete group">×</button>
          </div>
          ${lists.length ? lists.map(renderDashboardList).join("") : `<p class="mini-empty">No lists in this group yet.</p>`}
        </div>`;
    }
    html += `</div>`;
  }

  const ungrouped = dashboardLists.filter(l => !l.groupId);
  if (ungrouped.length) {
    html += `<div class="dashboard-section"><div class="section-label">☑️ LISTS</div>${ungrouped.map(renderDashboardList).join("")}</div>`;
  }

  content.innerHTML = html;
  attachDashboardActions();
}

function renderDashboardList(list) {
  const itemsCount = list.itemCount ?? 0;
  return `
    <article class="dashboard-card compact">
      <div class="dashboard-icon">☑️</div>
      <div class="dashboard-main">
        <h3>${escapeHtml(list.title || "Untitled list")}</h3>
        <p>${itemsCount} item${itemsCount === 1 ? "" : "s"} · ${PERMISSIONS[list.permission] || PERMISSIONS.view}</p>
      </div>
      <div class="dashboard-actions">
        <button class="soft-button small" data-action="manage-list" data-id="${list.id}">Manage</button>
        <button class="soft-button small" data-action="open-list" data-id="${list.id}">Open</button>
        <button class="icon-button danger" data-action="delete-list" data-id="${list.id}" aria-label="Delete list">×</button>
      </div>
    </article>`;
}

function attachDashboardActions() {
  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const id = button.dataset.id;

      if (action === "results") await openResponses(id);
      if (action === "edit-game") await editGame(id);
      if (action === "delete-game") await deleteGame(id);
      if (action === "manage-list") await openListManager(id);
      if (action === "open-list") await openCreatorList(id);
      if (action === "delete-list") await deleteList(id);
      if (action === "delete-group") await deleteGroup(id);
    });
  });
}

async function deleteGame(id) {
  if (!confirm("Delete this question game? Its saved responses will no longer be accessible.")) return;
  try {
    await deleteDoc(doc(db, "games", id));
    toast("Question game deleted.");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    toast("Couldn't delete the game.");
  }
}

async function deleteGroup(id) {
  const lists = dashboardLists.filter(l => l.groupId === id);
  if (lists.length && !confirm("This group contains lists. Delete the group and leave those lists ungrouped?")) return;
  try {
    for (const list of lists) await updateDoc(doc(db, "lists", list.id), { groupId: null, updatedAt: serverTimestamp() });
    await deleteDoc(doc(db, "listGroups", id));
    toast("Group deleted.");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    toast("Couldn't delete the group.");
  }
}

async function deleteList(id) {
  if (!confirm("Delete this list?")) return;
  try {
    const itemsSnap = await getDocs(collection(db, "lists", id, "items"));
    await Promise.all(itemsSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "lists", id));
    toast("List deleted.");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    toast("Couldn't delete the list.");
  }
}

/* ---------- GROUPS ---------- */

$("saveGroupButton").addEventListener("click", async () => {
  const title = $("groupTitle").value.trim();
  if (!title) return toast("Give the group a title first.");

  try {
    await addDoc(collection(db, "listGroups"), {
      creatorId: currentUser.uid,
      title,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    toast("Group created ✨");
    showScreen("landingScreen");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    toast("Couldn't create the group.");
  }
});

/* ---------- QUESTION CREATOR ---------- */

function resetQuestionCreator() {
  creatorQuestions = [];
  editingQuestionId = null;

  // Important: starting a fresh creator session should not
  // accidentally point at a previously created game.
  currentGameId = null;
  currentGame = null;

  $("gameTitle").value = "";
  $("questionInput").value = "";

  document.querySelector('input[name="category"][value="very-light"]').checked = true;
  document.querySelector('input[name="answerType"][value="written"]').checked = true;

  $("allowCustomAnswer").checked = false;

  // Keep the share link completely hidden until
  // the creator actually generates/saves the game.
  $("gameCreatedArea").classList.add("hidden");
  $("gameLink").value = "";

  $("questionList").innerHTML = "";
  $("questionEmpty").classList.remove("hidden");
  $("cancelEditQuestionButton").classList.add("hidden");

  $("optionsList").innerHTML = "";

  renderOptionsEditor();
}

async function startQuestionCreator(existingGame = null) {
  resetQuestionCreator();

  if (existingGame) {
    $("gameTitle").value = existingGame.title || "";

    creatorQuestions = structuredClone(existingGame.questions || []);

    // Remember which existing game we're editing,
    // but DO NOT show the share link yet.
    currentGameId = existingGame.id;

    // Link stays hidden until Generate is clicked.
    $("gameCreatedArea").classList.add("hidden");
    $("gameLink").value = "";

    renderQuestionList();
  }

  showScreen("questionCreatorScreen");
}

document.querySelectorAll('input[name="answerType"]').forEach(input => {
  input.addEventListener("change", renderOptionsEditor);
});

document.querySelectorAll('input[name="category"]').forEach(input => {
  input.addEventListener("change", () => {
    document.querySelectorAll(".category-choice").forEach(x => x.classList.remove("active"));
    input.closest(".category-choice")?.classList.add("active");
  });
});

function renderOptionsEditor() {
  const isOptions = document.querySelector('input[name="answerType"]:checked')?.value === "options";
  $("optionsEditor").classList.toggle("hidden", !isOptions);

  if (isOptions && !$("optionsList").children.length) {
    addOptionRow();
    addOptionRow();
  }
}

function addOptionRow(value = "") {
  const row = document.createElement("div");
  row.className = "option-editor-row";
  row.innerHTML = `
    <input class="text-input option-value" maxlength="160" placeholder="Answer choice" value="${escapeHtml(value)}">
    <button class="icon-button danger remove-option" type="button">×</button>`;
  row.querySelector(".remove-option").addEventListener("click", () => {
    row.remove();
  });
  $("optionsList").appendChild(row);
}

$("addOptionButton").addEventListener("click", () => addOptionRow());

function getSelectedCategory() {
  return document.querySelector('input[name="category"]:checked')?.value || "very-light";
}

function getQuestionDraft() {
  const question = $("questionInput").value.trim();
  const answerType = document.querySelector('input[name="answerType"]:checked')?.value || "written";
  const category = getSelectedCategory();
  const options = [...document.querySelectorAll(".option-value")].map(x => x.value.trim()).filter(Boolean);
  return {
    id: editingQuestionId || makeId(),
    question,
    category,
    answerType,
    options: answerType === "options" ? options : [],
    allowCustomAnswer: answerType === "options" ? $("allowCustomAnswer").checked : false
  };
}

function clearQuestionForm() {
  editingQuestionId = null;
  $("questionInput").value = "";
  document.querySelector('input[name="category"][value="very-light"]').checked = true;
  document.querySelector('input[name="answerType"][value="written"]').checked = true;
  $("allowCustomAnswer").checked = false;
  $("optionsList").innerHTML = "";
  $("cancelEditQuestionButton").classList.add("hidden");
  renderOptionsEditor();
}

$("saveQuestionButton").addEventListener("click", () => {
  const draft = getQuestionDraft();
  if (!draft.question) return toast("Write the question first.");
  if (draft.answerType === "options" && draft.options.length < 2) return toast("Add at least two answer choices.");

  const index = creatorQuestions.findIndex(q => q.id === draft.id);
  if (index >= 0) creatorQuestions[index] = draft;
  else creatorQuestions.push(draft);

  renderQuestionList();
  clearQuestionForm();
});

$("cancelEditQuestionButton").addEventListener("click", clearQuestionForm);

function renderQuestionList() {
  $("questionCount").textContent = `${creatorQuestions.length} question${creatorQuestions.length === 1 ? "" : "s"}`;
  $("questionEmpty").classList.toggle("hidden", creatorQuestions.length > 0);

  $("questionList").innerHTML = creatorQuestions.map((q, index) => {
    const cat = CATEGORIES[q.category] || CATEGORIES["very-light"];
    return `
      <div class="builder-question">
        <div class="builder-number">${index + 1}</div>
        <div class="builder-question-main">
          <span class="mini-badge ${cat.scene}">${cat.label}</span>
          <strong>${escapeHtml(q.question)}</strong>
          <small>${q.answerType === "options" ? `☑️ ${q.options.length} choices${q.allowCustomAnswer ? " + something else" : ""}` : "📝 Written answer"}</small>
        </div>
        <div class="builder-actions">
          <button class="soft-button small" data-edit-question="${q.id}" type="button">Edit</button>
          <button class="icon-button danger" data-delete-question="${q.id}" type="button">×</button>
        </div>
      </div>`;
  }).join("");

  document.querySelectorAll("[data-edit-question]").forEach(btn => {
    btn.addEventListener("click", () => loadQuestionForEdit(btn.dataset.editQuestion));
  });
  document.querySelectorAll("[data-delete-question]").forEach(btn => {
    btn.addEventListener("click", () => {
      creatorQuestions = creatorQuestions.filter(q => q.id !== btn.dataset.deleteQuestion);
      renderQuestionList();
    });
  });
}

function loadQuestionForEdit(id) {
  const q = creatorQuestions.find(x => x.id === id);
  if (!q) return;
  editingQuestionId = q.id;
  $("questionInput").value = q.question;
  document.querySelector(`input[name="category"][value="${q.category}"]`).checked = true;
  document.querySelector(`input[name="answerType"][value="${q.answerType}"]`).checked = true;
  $("allowCustomAnswer").checked = !!q.allowCustomAnswer;
  $("optionsList").innerHTML = "";
  q.options.forEach(addOptionRow);
  $("cancelEditQuestionButton").classList.remove("hidden");
  renderOptionsEditor();
  $("questionInput").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function makeGameLink(id) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("game", id);
  return url.toString();
}

$("generateGameButton").addEventListener("click", async () => {
  const title = $("gameTitle").value.trim() || "Between Us Questions";

  if (!creatorQuestions.length) {
    return toast("Add at least one question first.");
  }

  try {

    if (currentGameId) {
      // Existing game: update it.
      await updateDoc(doc(db, "games", currentGameId), {
        title,
        questions: creatorQuestions,
        active: true,
        updatedAt: serverTimestamp()
      });

      toast("Game updated ✨");
    } else {
      // New game: create it.
      const ref = await addDoc(collection(db, "games"), {
        creatorId: currentUser.uid,
        title,
        questions: creatorQuestions,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      currentGameId = ref.id;

      toast("Private game created ✨");
    }

    // ONLY NOW do we create/show the share link.
    $("gameLink").value = makeGameLink(currentGameId);
    $("gameCreatedArea").classList.remove("hidden");

    // Refresh the creator dashboard so the game is immediately
    // visible in "My Stuff".
    await loadDashboard();

  } catch (e) {
    console.error(e);
    toast("Couldn't save the game.");
  }
});

$("copyLinkButton").addEventListener("click", () => copyText($("gameLink").value));
$("openCreatedGameButton").addEventListener("click", () => {
  window.open(makeGameLink(currentGameId), "_blank");
});
$("viewCreatedResponsesButton").addEventListener("click", () => openResponses(currentGameId));

async function editGame(id) {
  const snap = await getDoc(doc(db, "games", id));
  if (!snap.exists()) return toast("That game no longer exists.");
  await startQuestionCreator({ id: snap.id, ...snap.data() });
}

/* ---------- QUESTION PLAYER ---------- */

async function loadPlayerGame(id) {
  try {
    const snap = await getDoc(doc(db, "games", id));
    if (!snap.exists()) {
      showScreen("landingScreen");
      return toast("That question game could not be found.");
    }

    currentGameId = id;
    currentGame = { id, ...snap.data() };
    currentQuestionIndex = 0;
    currentResponses = [];

    showScreen("playerScreen");
    renderPlayerQuestion();
  } catch (e) {
    console.error(e);
    showScreen("landingScreen");
    toast("Couldn't open that game.");
  }
}

function renderPlayerQuestion() {
  const q = currentGame.questions?.[currentQuestionIndex];
  if (!q) return finishQuestions();

  const cat = CATEGORIES[q.category] || CATEGORIES["very-light"];
  $("questionProgress").textContent = `Question ${currentQuestionIndex + 1} of ${currentGame.questions.length}`;
  $("progressBar").style.width = `${((currentQuestionIndex + 1) / currentGame.questions.length) * 100}%`;
  $("playerQuestion").textContent = q.question;
  $("categoryBadge").textContent = cat.label;
  $("scene").className = `scene ${cat.scene}`;
  $("playerCharacter").textContent = randomItem(cat.character);
  $("sceneDecoration").textContent = cat.decoration;
  $("sensitiveBuffer").classList.toggle("hidden", q.category !== "sensitive");

  $("writtenAnswerArea").classList.toggle("hidden", q.answerType !== "written");
  $("choiceAnswerArea").classList.toggle("hidden", q.answerType !== "options");
  $("writtenAnswer").value = "";
  $("customAnswer").value = "";

  if (q.answerType === "options") {
    $("choiceList").innerHTML = q.options.map((option, i) => `
      <label class="player-choice">
        <input type="checkbox" value="${escapeHtml(option)}">
        <span>${escapeHtml(option)}</span>
      </label>`).join("");
    $("customAnswerArea").classList.toggle("hidden", !q.allowCustomAnswer);
  }

  $("nextQuestionButton").textContent = currentQuestionIndex === currentGame.questions.length - 1 ? "Finish ♡" : "Save answer →";
}

async function savePlayerResponse(status = "answered") {
  const q = currentGame.questions[currentQuestionIndex];
  let answer = "";

  if (status === "answered") {
    if (q.answerType === "written") {
      answer = $("writtenAnswer").value.trim();
      if (!answer) return toast("You can write something, skip, or choose to talk instead. ♡");
    } else {
      answer = [...document.querySelectorAll("#choiceList input:checked")].map(x => x.value);
      const custom = $("customAnswer").value.trim();
      if (custom) answer.push(`Something else: ${custom}`);
      if (!answer.length) return toast("Choose at least one option, or skip for now. ♡");
    }
  }

  try {
    await addDoc(collection(db, "games", currentGameId, "responses"), {
      questionId: q.id,
      question: q.question,
      category: q.category,
      answer,
      status,
      playerId: currentUser.uid,
      createdAt: serverTimestamp()
    });

    currentResponses.push({ questionId: q.id, status });
    currentQuestionIndex++;
    renderPlayerQuestion();
  } catch (e) {
    console.error(e);
    toast("Couldn't save that response. Please try again.");
  }
}

$("nextQuestionButton").addEventListener("click", () => savePlayerResponse("answered"));
$("skipButton").addEventListener("click", () => savePlayerResponse("skipped"));
$("talkButton").addEventListener("click", () => savePlayerResponse("would-rather-talk"));

function finishQuestions() {
  showScreen("finishScreen");
  setParam("game", null);
}

/* ---------- RESPONSES ---------- */

async function openResponses(gameId) {
  try {
    const gameSnap = await getDoc(doc(db, "games", gameId));
    if (!gameSnap.exists()) return toast("Game not found.");

    const game = { id: gameId, ...gameSnap.data() };
    if (game.creatorId !== currentUser.uid) return toast("Only the creator can view results.");

    const snap = await getDocs(collection(db, "games", gameId, "responses"));
    const responses = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    responses.sort((a,b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    $("responsesTitle").textContent = game.title || "Responses";

    const grouped = game.questions.map(q => ({
      question: q,
      answers: responses.filter(r => r.questionId === q.id)
    }));

    $("responsesList").innerHTML = grouped.map(({question, answers}) => {
      const cat = CATEGORIES[question.category] || CATEGORIES["very-light"];
      return `
        <article class="response-card">
          <div class="response-question">
            <span class="mini-badge ${cat.scene}">${cat.label}</span>
            <h3>${escapeHtml(question.question)}</h3>
          </div>
          ${answers.length ? answers.map(renderResponse).join("") : `<p class="muted">No response yet.</p>`}
        </article>`;
    }).join("");

    showScreen("responsesScreen");
  } catch (e) {
    console.error(e);
    toast("Couldn't load responses.");
  }
}

function renderResponse(r) {
  const statusLabel = {
    answered: "💗 Answered",
    skipped: "🌸 Skipped for now",
    "would-rather-talk": "🫶 Would rather talk about this"
  }[r.status] || r.status;

  let answer = "";
  if (Array.isArray(r.answer)) {
    answer = r.answer.length ? `<ul>${r.answer.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "";
  } else {
    answer = r.answer ? `<p>${escapeHtml(r.answer)}</p>` : "";
  }

  return `
    <div class="response-item">
      <span class="status-pill">${statusLabel}</span>
      ${answer}
      <small>${formatDate(r.createdAt)}</small>
    </div>`;
}

/* ---------- LIST CREATOR ---------- */

function resetListCreator() {
  currentListId = null;
  $("listTitle").value = "";
  $("listGroupSelect").value = "";
  document.querySelector('input[name="permission"][value="view"]').checked = true;
  document.querySelectorAll(".permission-choice").forEach(x => x.classList.remove("active"));
  document.querySelector('.permission-choice input[value="view"]').closest(".permission-choice").classList.add("active");
  $("startWithItems").checked = true;
  $("starterItemsList").innerHTML = "";
  addStarterItemRow();
  addStarterItemRow();
  $("listCreatedArea").classList.add("hidden");
}

function populateGroupSelect() {
  $("listGroupSelect").innerHTML = `<option value="">No group</option>` +
    dashboardGroups.map(g => `<option value="${g.id}">${escapeHtml(g.title)}</option>`).join("");
}

function startListCreator() {
  resetListCreator();
  showScreen("listCreatorScreen");
}

document.querySelectorAll('input[name="permission"]').forEach(input => {
  input.addEventListener("change", () => {
    document.querySelectorAll(".permission-choice").forEach(x => x.classList.remove("active"));
    input.closest(".permission-choice")?.classList.add("active");
  });
});

$("startWithItems").addEventListener("change", () => {
  $("starterItemsArea").classList.toggle("hidden", !$("startWithItems").checked);
});

function addStarterItemRow(value = "") {
  const row = document.createElement("div");
  row.className = "option-editor-row";
  row.innerHTML = `
    <input class="text-input starter-item-value" maxlength="200" placeholder="List item" value="${escapeHtml(value)}">
    <button class="icon-button danger remove-starter" type="button">×</button>`;
  row.querySelector(".remove-starter").addEventListener("click", () => row.remove());
  $("starterItemsList").appendChild(row);
}

$("addStarterItemButton").addEventListener("click", () => addStarterItemRow());

function makeListLink(id) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("list", id);
  return url.toString();
}

$("createListSaveButton").addEventListener("click", async () => {
  const title = $("listTitle").value.trim() || "Our List";
  const permission = document.querySelector('input[name="permission"]:checked')?.value || "view";
  const groupId = $("listGroupSelect").value || null;
  const items = $("startWithItems").checked
    ? [...document.querySelectorAll(".starter-item-value")].map(x => x.value.trim()).filter(Boolean)
    : [];

  try {
    const ref = await addDoc(collection(db, "lists"), {
      creatorId: currentUser.uid,
      title,
      groupId,
      permission,
      itemCount: items.length,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    currentListId = ref.id;

    for (const text of items) {
      await addDoc(collection(db, "lists", currentListId, "items"), {
        text,
        checked: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    $("listLink").value = makeListLink(currentListId);
    $("listCreatedArea").classList.remove("hidden");
    toast("List created ✨");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    toast("Couldn't create the list.");
  }
});

$("copyListLinkButton").addEventListener("click", () => copyText($("listLink").value));
$("openCreatedListButton").addEventListener("click", () => window.open(makeListLink(currentListId), "_blank"));
$("manageCreatedListButton").addEventListener("click", () => openListManager(currentListId));

/* ---------- LIST PLAYER ---------- */

async function loadPlayerList(id) {
  try {
    const snap = await getDoc(doc(db, "lists", id));
    if (!snap.exists()) {
      showScreen("landingScreen");
      return toast("That list could not be found.");
    }

    currentListId = id;
    currentList = { id, ...snap.data() };
    await refreshPlayerListItems();
    showScreen("listPlayerScreen");
    renderPlayerList();
  } catch (e) {
    console.error(e);
    showScreen("landingScreen");
    toast("Couldn't open that list.");
  }
}

async function refreshPlayerListItems() {
  const snap = await getDocs(collection(db, "lists", currentListId, "items"));
  currentListItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  currentListItems.sort((a,b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}

function canCheck(permission) {
  return ["check", "edit", "full"].includes(permission);
}
function canEdit(permission) {
  return ["edit", "full"].includes(permission);
}
function canDelete(permission) {
  return permission === "full";
}

function renderPlayerList() {
  const permission = currentList.permission || "view";
  $("playerListTitle").textContent = currentList.title || "Shared List";
  $("playerListPermission").textContent = PERMISSIONS[permission] || PERMISSIONS.view;

  $("playerListItems").innerHTML = currentListItems.length
    ? currentListItems.map(item => `
      <div class="shared-item ${item.checked ? "checked" : ""}">
        <label>
          <input type="checkbox" data-player-check="${item.id}" ${item.checked ? "checked" : ""} ${canCheck(permission) ? "" : "disabled"}>
          <span>${escapeHtml(item.text)}</span>
        </label>
        ${canEdit(permission) ? `<button class="icon-button danger" data-player-delete="${item.id}" type="button">×</button>` : ""}
      </div>`).join("")
    : `<div class="mini-empty">Nothing here yet 🌷</div>`;

  $("playerAddArea").classList.toggle("hidden", !canEdit(permission));

  document.querySelectorAll("[data-player-check]").forEach(input => {
    input.addEventListener("change", () => toggleListItem(input.dataset.playerCheck, input.checked, renderPlayerList));
  });
  document.querySelectorAll("[data-player-delete]").forEach(btn => {
    btn.addEventListener("click", () => deleteListItem(btn.dataset.playerDelete, permission, renderPlayerList));
  });
}

async function toggleListItem(itemId, checked, after) {
  try {
    await updateDoc(doc(db, "lists", currentListId, "items", itemId), {
      checked,
      updatedAt: serverTimestamp()
    });
    await refreshPlayerListItems();
    after();
  } catch (e) {
    console.error(e);
    toast("Couldn't update that item.");
  }
}

async function deleteListItem(itemId, permission, after) {
  if (!canDelete(permission)) return;
  if (!confirm("Delete this item?")) return;
  try {
    await deleteDoc(doc(db, "lists", currentListId, "items", itemId));
    await updateDoc(doc(db, "lists", currentListId), {
      itemCount: Math.max(0, currentListItems.length - 1),
      updatedAt: serverTimestamp()
    });
    await refreshPlayerListItems();
    after();
  } catch (e) {
    console.error(e);
    toast("Couldn't delete that item.");
  }
}

$("playerAddItemButton").addEventListener("click", async () => {
  const text = $("playerNewItem").value.trim();
  if (!text || !currentList || !canEdit(currentList.permission)) return;
  try {
    await addDoc(collection(db, "lists", currentListId, "items"), {
      text,
      checked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(db, "lists", currentListId), {
      itemCount: currentListItems.length + 1,
      updatedAt: serverTimestamp()
    });
    $("playerNewItem").value = "";
    await refreshPlayerListItems();
    renderPlayerList();
  } catch (e) {
    console.error(e);
    toast("Couldn't add that item.");
  }
});

/* ---------- LIST MANAGER ---------- */

async function openListManager(id) {
  try {
    const snap = await getDoc(doc(db, "lists", id));
    if (!snap.exists()) return toast("List not found.");

    currentListId = id;
    currentList = { id, ...snap.data() };

    if (currentList.creatorId !== currentUser.uid) return toast("Only the creator can manage this list.");

    await refreshPlayerListItems();
    $("manageListTitle").textContent = currentList.title || "List";
    $("managePermission").value = currentList.permission || "view";
    $("manageListLink").value = makeListLink(id);
    renderManageItems();
    showScreen("listManageScreen");
  } catch (e) {
    console.error(e);
    toast("Couldn't open list manager.");
  }
}

function renderManageItems() {
  $("manageItems").innerHTML = currentListItems.length
    ? currentListItems.map(item => `
      <div class="manage-item ${item.checked ? "checked" : ""}">
        <label>
          <input type="checkbox" data-manage-check="${item.id}" ${item.checked ? "checked" : ""}>
          <input class="manage-item-text" data-manage-text="${item.id}" value="${escapeHtml(item.text)}" maxlength="200">
        </label>
        <button class="icon-button danger" data-manage-delete="${item.id}" type="button">×</button>
      </div>`).join("")
    : `<div class="mini-empty">No items yet. Add one above 🌷</div>`;

  document.querySelectorAll("[data-manage-check]").forEach(input => {
    input.addEventListener("change", async () => {
      await updateDoc(doc(db, "lists", currentListId, "items", input.dataset.manageCheck), {
        checked: input.checked,
        updatedAt: serverTimestamp()
      });
      await refreshPlayerListItems();
      renderManageItems();
    });
  });

  document.querySelectorAll("[data-manage-text]").forEach(input => {
    input.addEventListener("change", async () => {
      const text = input.value.trim();
      if (!text) return;
      await updateDoc(doc(db, "lists", currentListId, "items", input.dataset.manageText), {
        text,
        updatedAt: serverTimestamp()
      });
      await refreshPlayerListItems();
    });
  });

  document.querySelectorAll("[data-manage-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await deleteDoc(doc(db, "lists", currentListId, "items", btn.dataset.manageDelete));
      await updateDoc(doc(db, "lists", currentListId), {
        itemCount: Math.max(0, currentListItems.length - 1),
        updatedAt: serverTimestamp()
      });
      await refreshPlayerListItems();
      renderManageItems();
    });
  });
}

$("saveListPermissionButton").addEventListener("click", async () => {
  try {
    await updateDoc(doc(db, "lists", currentListId), {
      permission: $("managePermission").value,
      updatedAt: serverTimestamp()
    });
    currentList.permission = $("managePermission").value;
    toast("Permission updated ✨");
    await loadDashboard();
  } catch (e) {
    console.error(e);
    toast("Couldn't update permission.");
  }
});

$("manageAddItemButton").addEventListener("click", async () => {
  const text = $("manageNewItem").value.trim();
  if (!text) return;
  try {
    await addDoc(collection(db, "lists", currentListId, "items"), {
      text,
      checked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await updateDoc(doc(db, "lists", currentListId), {
      itemCount: currentListItems.length + 1,
      updatedAt: serverTimestamp()
    });
    $("manageNewItem").value = "";
    await refreshPlayerListItems();
    renderManageItems();
  } catch (e) {
    console.error(e);
    toast("Couldn't add that item.");
  }
});

$("copyManageListLinkButton").addEventListener("click", () => copyText($("manageListLink").value));

async function openCreatorList(id) {
  await loadPlayerList(id);
}

/* ---------- HELPERS ---------- */

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("Copied to clipboard ♡");
  } catch {
    toast("Copy failed — select the link and copy it.");
  }
}

boot();
