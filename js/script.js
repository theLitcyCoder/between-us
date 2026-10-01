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

const AI_WORKER_URL =
  "https://between-us-ai.newoshadow21.workers.dev";

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
    id === "loadingScreen"
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
   AUTH / START
========================================================= */

async function boot() {

  try {

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

    const gameId =
      getParam("game");

    const listId =
      getParam("list");

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

    const listsSnap =
      await getDocs(
        collection(db, "lists")
      );

    dashboardLists =
      listsSnap.docs
        .map(d => ({
          id: d.id,
          ...d.data()
        }))
        .filter(
          list =>
            list.creatorId ===
            currentUser.uid
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

    dashboardGroups.sort(
      (a, b) =>
        (a.title || "")
          .localeCompare(
            b.title || ""
          )
    );

    renderDashboard();

    populateGroupSelect();

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
        : false
  };
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

  renderOptionsEditor();
}

/* =========================================================
   SAVE QUESTION
   IMPORTANT:
   FIRST QUESTION CREATES GAME + LINK
========================================================= */

$("saveQuestionButton").addEventListener("click", async () => {

  const draft = getQuestionDraft();

  if (!draft.question) {
    return toast("Write the question first.");
  }

  if (
    draft.answerType === "options" &&
    draft.options.length < 2
  ) {
    return toast("Add at least two answer choices.");
  }

  try {

    // Add or update the question
    const index = creatorQuestions.findIndex(
      q => q.id === draft.id
    );

    if (index >= 0) {
      creatorQuestions[index] = draft;
    } else {
      creatorQuestions.push(draft);
    }

    renderQuestionList();

    const title =
      $("gameTitle").value.trim() ||
      "Between Us Questions";


    // ==========================================
    // CREATE GAME AFTER FIRST QUESTION
    // ==========================================

    if (!currentGameId) {

      const ref = await addDoc(
        collection(db, "games"),
        {
          creatorId: currentUser.uid,
          title,
          questions: creatorQuestions,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      );

      currentGameId = ref.id;

      toast("Your game is ready ✨");

    } else {

      // ==========================================
      // UPDATE EXISTING GAME
      // ==========================================

      await updateDoc(
        doc(db, "games", currentGameId),
        {
          title,
          questions: creatorQuestions,
          active: true,
          updatedAt: serverTimestamp()
        }
      );

      toast("Question saved ✨");
    }


    // ==========================================
    // SHOW LINK IMMEDIATELY
    // ==========================================

    $("gameLink").value =
      makeGameLink(currentGameId);

    $("gameCreatedArea")
      .classList
      .remove("hidden");


    // ==========================================
    // REFRESH DASHBOARD
    // ==========================================

    await loadDashboard();


    // ==========================================
    // CLEAR QUESTION FORM
    // ==========================================

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
});
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
   START APP
========================================================= */

boot();
