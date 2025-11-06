"use strict";

// Configuration
const Config = {
  // If you have a custom API endpoint that returns questions,
  // set it in the Setup UI. Otherwise Open Trivia DB is used.
  defaultEndpoint: "https://opentdb.com/api.php",
  categoriesEndpoint: "https://opentdb.com/api_category.php",
};

// State
const State = {
  settings: {
    amount: 10,
    category: "",
    difficulty: "",
    type: "",
    timerSeconds: 20,
    endpoint: "",
  },
  rawQuestions: [],
  questions: [],
  index: 0,
  score: 0,
  timerId: null,
  remaining: 0,
};

// Elements
const els = {
  welcomeCard: document.getElementById("welcome-card"),
  setupCard: document.getElementById("setup-card"),
  quizCard: document.getElementById("quiz-card"),
  resultCard: document.getElementById("result-card"),
  form: document.getElementById("setup-form"),
  amount: document.getElementById("input-amount"),
  category: document.getElementById("select-category"),
  difficulty: document.getElementById("select-difficulty"),
  type: document.getElementById("select-type"),
  timerInput: document.getElementById("input-timer"),
  progressBar: document.getElementById("progress-bar"),
  timer: document.getElementById("timer"),
  score: document.getElementById("score"),
  questionText: document.getElementById("question-text"),
  answers: document.getElementById("answers"),
  nextBtn: document.getElementById("btn-next"),
  quitBtn: document.getElementById("btn-quit"),
  resultSummary: document.getElementById("result-summary"),
  playAgainBtn: document.getElementById("btn-play-again"),
  homeBtn: document.getElementById("btn-home"),
  saveScoreForm: document.getElementById("save-score"),
  playerName: document.getElementById("player-name"),
  resultNameNote: document.getElementById("result-name-note"),
  dialogHS: document.getElementById("dialog-highscores"),
  btnHS: document.getElementById("btn-highscores"),
  hsList: document.getElementById("hs-list"),
  themeBtn: document.getElementById("btn-theme"),
  themeLabel: document.getElementById("theme-label"),
  nameForm: document.getElementById("name-form"),
  inputName: document.getElementById("input-name"),
};

// Utils
const decode = (html) => {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
};
const shuffle = (arr) => arr.map(v=>({v, r:Math.random()})).sort((a,b)=>a.r-b.r).map(o=>o.v);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// High Scores
const HS_KEY = "quizo.highscores.v1";
const NAME_KEY = "quizo.userName";
function readHighScores(){
  try { return JSON.parse(localStorage.getItem(HS_KEY) || "[]"); } catch { return []; }
}
function writeHighScores(list){
  localStorage.setItem(HS_KEY, JSON.stringify(list.slice(0, 20)));
}
function renderHighScores(){
  const scores = readHighScores();
  els.hsList.innerHTML = scores.length ? "" : "<li>No high scores yet.</li>";
  scores.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i+1}. ${s.name}</span><span>🏆 ${s.score}</span>`;
    els.hsList.appendChild(li);
  });
}

// Theme toggle (persist)
const THEME_KEY = "quizo.theme";
function applyTheme(theme){
  const t = theme || "auto";
  document.documentElement.dataset.theme = (t === "auto") ? "" : t;
  els.themeLabel.textContent = t === "dark" ? "Dark" : t === "light" ? "Light" : "Auto";
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || "auto";
  applyTheme(saved);
}

// Fetch helpers
async function fetchJSON(url, options = {}){
  const opts = { ...options, headers: { ...(options.headers||{}) } };
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`Network error ${res.status}`);
  return await res.json();
}

async function fetchCategories(){
  try{
    const data = await fetchJSON(Config.categoriesEndpoint);
    const cats = (data.trivia_categories || []).sort((a,b)=>a.name.localeCompare(b.name));
    for(const c of cats){
      const opt = document.createElement("option");
      opt.value = String(c.id);
      opt.textContent = c.name;
      els.category.appendChild(opt);
    }
  }catch(err){
    console.warn("Failed to load categories", err);
  }
}

function buildUrl(settings){
  const url = new URL(Config.defaultEndpoint);
  url.searchParams.set("amount", String(settings.amount));
  if (settings.category) url.searchParams.set("category", settings.category);
  if (settings.difficulty) url.searchParams.set("difficulty", settings.difficulty);
  if (settings.type) url.searchParams.set("type", settings.type);
  return url.toString();
}

async function fetchQuestions(settings){
  const url = buildUrl(settings);
  const data = await fetchJSON(url, {});
  // Normalize different shapes: OpenTDB uses results[]
  const items = Array.isArray(data) ? data : (data.results || data.questions || []);
  return items.map(normalizeQuestion);
}

function normalizeQuestion(q){
  // Try to normalize a few common formats
  const question = decode(q.question || q.prompt || q.text || "");
  const correct = decode(q.correct_answer || q.correct || q.answer || "");
  const incorrect = (q.incorrect_answers || q.incorrect || q.options || [])
    .map(x => decode(String(x)));
  const all = q.type === "boolean" || (q.options && q.options.length === 2)
    ? ["True","False"]
    : shuffle([correct, ...incorrect]);
  return {
    question,
    correct,
    answers: all,
    type: q.type || (all.length === 2 ? "boolean" : "multiple"),
    category: q.category || "",
    difficulty: q.difficulty || "",
  };
}

// Quiz Flow
function resetQuiz(){
  State.index = 0; State.score = 0; State.rawQuestions = []; State.questions = [];
  els.score.textContent = "0";
  els.progressBar.style.setProperty("--p", "0%");
  els.timer.textContent = String(State.settings.timerSeconds || 0).padStart(2, "0");
}
// Welcome flow
function getSavedName(){
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}
function saveName(n){
  try { localStorage.setItem(NAME_KEY, n); } catch {}
}
function showSetupWithGreeting(name){
  hide(els.welcomeCard);
  const title = document.getElementById("setup-title");
  if (title && name){
    title.textContent = `Welcome, ${name} — Start a Quiz`;
    title.animate([
      { transform: "translateY(6px)", opacity: .6 },
      { transform: "translateY(0)", opacity: 1 }
    ], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  show(els.setupCard);
}

if (els.nameForm) {
  els.nameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = (els.inputName.value || "").trim().slice(0, 20) || "Player";
    saveName(name);
    // small celebratory confetti
    confetti(18);
    showSetupWithGreeting(name);
  });
}

function show(el){ el.classList.remove("hidden"); el.classList.add("in"); }
function hide(el){ el.classList.add("hidden"); el.classList.remove("in"); }

function updateProgress(){
  const p = ((State.index) / State.questions.length) * 100;
  els.progressBar.style.setProperty("--p", `${p}%`);
}

function renderQuestion(){
  updateProgress();
  els.nextBtn.disabled = true;
  const q = State.questions[State.index];
  els.questionText.textContent = q.question;
  els.answers.innerHTML = "";
  q.answers.forEach((ans, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span>${ans}</span>`;
    btn.setAttribute("data-idx", String(i));
    btn.addEventListener("click", () => onAnswer(ans, btn));
    btn.addEventListener("keydown", (e) => { if(e.key==="Enter"||e.key===" ") onAnswer(ans, btn); });
    li.appendChild(btn);
    els.answers.appendChild(li);
  });
  startTimer();
}

function onAnswer(selected, btn){
  stopTimer();
  const q = State.questions[State.index];
  const buttons = Array.from(els.answers.querySelectorAll("button"));
  buttons.forEach(b => b.disabled = true);
  const isCorrect = selected === q.correct;
  if (isCorrect) {
    State.score += 10;
    els.score.textContent = String(State.score);
    btn.classList.add("btn-correct");
    confetti(12);
  } else {
    btn.classList.add("btn-wrong");
    // highlight correct
    const correctBtn = buttons.find(b => b.textContent === q.correct);
    if (correctBtn) correctBtn.classList.add("btn-correct");
    shake(els.questionText);
  }
  els.nextBtn.disabled = false;
}

function nextQuestion(){
  State.index++;
  if (State.index >= State.questions.length){
    return showResults();
  }
  renderQuestion();
}

function showResults(){
  hide(els.quizCard);
  const total = State.questions.length * 10;
  const pct = Math.round((State.score / total) * 100);
  els.resultSummary.textContent = `You scored ${State.score}/${total} (${pct}%). Great job!`;
  const nm = getSavedName() || "Player";
  if (els.resultNameNote) els.resultNameNote.textContent = `Saving as ${nm}.`;
  show(els.resultCard);
}

function startTimer(){
  stopTimer();
  const s = clamp(Number(State.settings.timerSeconds)||0, 0, 600);
  if (!s) return; // timer disabled
  State.remaining = s;
  els.timer.textContent = String(State.remaining).padStart(2, "0");
  State.timerId = setInterval(() => {
    State.remaining -= 1;
    els.timer.textContent = String(Math.max(0, State.remaining)).padStart(2, "0");
    if (State.remaining <= 0){
      stopTimer();
      // auto advance as incorrect
      const buttons = Array.from(els.answers.querySelectorAll("button"));
      buttons.forEach(b => b.disabled = true);
      const q = State.questions[State.index];
      const correctBtn = buttons.find(b => b.textContent === q.correct);
      if (correctBtn) correctBtn.classList.add("btn-correct");
      els.nextBtn.disabled = false;
      pulse(els.timer);
    }
  }, 1000);
}

function stopTimer(){ if (State.timerId) { clearInterval(State.timerId); State.timerId = null; } }

// Micro animations (CSS-free)
function shake(el){
  el.animate([
    { transform: "translateX(0)" },
    { transform: "translateX(-4px)" },
    { transform: "translateX(4px)" },
    { transform: "translateX(0)" },
  ], { duration: 250, easing: "ease-in-out" });
}
function pulse(el){
  el.animate([
    { transform: "scale(1)" },
    { transform: "scale(1.08)" },
    { transform: "scale(1)" },
  ], { duration: 400, easing: "ease-out" });
}
function confetti(n=10){
  const colors = ["#7c5cff", "#5bd6ff", "#2bd67b", "#ff4d67", "#ffd166"];
  for (let i=0;i<n;i++){
    const s = document.createElement("span");
    s.textContent = "✦";
    s.style.position = "fixed";
    s.style.left = Math.random()*100 + "vw";
    s.style.top = (10 + Math.random()*20) + "vh";
    s.style.color = colors[i % colors.length];
    s.style.fontSize = (12 + Math.random()*18) + "px";
    s.style.pointerEvents = "none";
    s.style.zIndex = 1000;
    document.body.appendChild(s);
    const dx = (Math.random() - .5) * 200;
    const dy = 400 + Math.random()*300;
    const rot = (Math.random() - .5) * 360;
    s.animate([
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 }
    ], { duration: 1200 + Math.random()*600, easing: "cubic-bezier(.2,.8,.2,1)" })
     .finished.then(()=> s.remove());
  }
}

// Event wiring
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  // Read settings
  State.settings.amount = clamp(Number(els.amount.value)||10, 5, 25);
  State.settings.category = els.category.value;
  State.settings.difficulty = els.difficulty.value;
  State.settings.type = els.type.value;
  State.settings.timerSeconds = clamp(Number(els.timerInput.value)||0, 0, 600);
  // API key and custom endpoint removed

  resetQuiz();
  hide(els.setupCard);
  show(els.quizCard);
  els.questionText.textContent = "Loading questions…";
  els.answers.innerHTML = "";
  els.nextBtn.disabled = true;

  try{
    State.rawQuestions = await fetchQuestions(State.settings);
    if (!State.rawQuestions.length) throw new Error("No questions returned.");
    State.questions = State.rawQuestions;
    renderQuestion();
  }catch(err){
    console.error(err);
    els.questionText.textContent = "Failed to load questions. Try again or adjust settings.";
    const li = document.createElement("li");
    const retry = document.createElement("button");
    retry.textContent = "Back";
    retry.addEventListener("click", () => { hide(els.quizCard); show(els.setupCard); });
    li.appendChild(retry); els.answers.appendChild(li);
  }
});

els.nextBtn.addEventListener("click", nextQuestion);
els.quitBtn.addEventListener("click", () => { stopTimer(); hide(els.quizCard); show(els.setupCard); });
els.playAgainBtn.addEventListener("click", () => { hide(els.resultCard); show(els.setupCard); });
els.homeBtn.addEventListener("click", () => { hide(els.resultCard); show(els.setupCard); });

els.saveScoreForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = getSavedName() || "Player";
  const scores = readHighScores();
  scores.push({ name, score: State.score, at: Date.now() });
  scores.sort((a,b)=> b.score - a.score || a.at - b.at);
  writeHighScores(scores);
  renderHighScores();
  // show highscores dialog
  els.dialogHS.showModal();
});

els.btnHS.addEventListener("click", () => { renderHighScores(); els.dialogHS.showModal(); });

els.themeBtn.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "auto";
  const next = current === "auto" ? "dark" : current === "dark" ? "light" : "auto";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  const pressed = next !== "auto"; // if auto, not pressed
  els.themeBtn.setAttribute("aria-pressed", String(pressed));
});

// Init
fetchCategories();
initTheme();
// Decide which screen to show on load
const existingName = getSavedName();
if (existingName) {
  if (els.welcomeCard) hide(els.welcomeCard);
  if (els.setupCard) showSetupWithGreeting(existingName);
} else {
  if (els.welcomeCard) show(els.welcomeCard);
  if (els.setupCard) hide(els.setupCard);
}

// Interactive theme: cursor-driven parallax and glow
(function enableInteractiveTheme(){
  const root = document.documentElement;
  let rafId = null;
  let targetX = 50, targetY = 50; // percent

  function onMove(clientX, clientY){
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    targetX = Math.max(0, Math.min(100, (clientX / w) * 100));
    targetY = Math.max(0, Math.min(100, (clientY / h) * 100));
    if (!rafId) rafId = requestAnimationFrame(apply);
  }
  function apply(){
    rafId = null;
    root.style.setProperty('--mx', targetX.toFixed(2) + '%');
    root.style.setProperty('--my', targetY.toFixed(2) + '%');
    const nx = (targetX - 50) / 50; // -1..1
    const ny = (targetY - 50) / 50;
    const px = nx * 12;
    const py = ny * 12;
    root.style.setProperty('--px', px.toFixed(1) + 'px');
    root.style.setProperty('--py', py.toFixed(1) + 'px');
  }

  window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
  window.addEventListener('touchmove', (e) => {
    const t = e.touches && e.touches[0]; if (!t) return;
    onMove(t.clientX, t.clientY);
  }, { passive: true });
})();

// Ensure native select opens downward with room
if (els.category){
  const openClass = () => {
    document.body.classList.add('select-open');
    try { els.category.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
  };
  const closeClass = () => document.body.classList.remove('select-open');
  els.category.addEventListener('pointerdown', openClass);
  els.category.addEventListener('focus', openClass);
  els.category.addEventListener('change', closeClass);
  els.category.addEventListener('blur', closeClass);
}


