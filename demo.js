"use strict";
// Demo of the Blokus experiment: the practice game and one puzzle, for showing people
// what the study looks like. It is experiment.js with the study parts taken out:
// no consent page, no fixed order, nothing saved in the browser and
// nothing sent anywhere. The game itself (rules, controls, clock, perfect opponent)
// is the same, and it uses the same blokus_engine.js, blokus_lookup.js and opponent_web/.

// ---------------------------------------------------------------- settings
// The nine experiment openings, the side the participant plays (0 = Blue, 1 = Yellow),
// and how hard each one is by positions searched.
const OPENINGS = {
  311: [0, "one of the two easy puzzles played as Blue"],
  39: [0, "one of the two easy puzzles played as Blue"],
  230: [0, "one of the two medium puzzles played as Blue"],
  419: [0, "one of the two medium puzzles played as Blue"],
  243: [0, "one of the two hard puzzles played as Blue"],
  2: [0, "one of the two hard puzzles played as Blue"],
  41: [1, "the easiest of the three puzzles played as Yellow"],
  15: [1, "the middle one of the three puzzles played as Yellow"],
  6: [1, "the hardest of the three puzzles played as Yellow"],
};
const DEFAULT_OPENING = 311;       // the puzzle shown; add ?opening=41 (etc.) to the address for another
const TARGET_MARGIN = 1;           // best possible result in every opening: a win by 1
const ROUND_MINUTES = 10;          // required time on each puzzle in the full study
const COMPUTER_DELAY_MS = 700;     // pause before each computer move
const COLOUR = ["Blue", "Yellow"];

const params = new URLSearchParams(location.search);
const OPENING = OPENINGS[params.get("opening")] ? Number(params.get("opening")) : DEFAULT_OPENING;
const SIDE = OPENINGS[OPENING][0];
const REQUIRED_MS = ROUND_MINUTES * 60000;

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- log
// Kept in memory only, so the page behaves like the experiment; it is lost when the page closes.
const startEpoch = performance.timeOrigin + performance.now();
const events = [];
function record(type, data = {}) {
  events.push({ t: Math.round((performance.timeOrigin + performance.now() - startEpoch) * 10) / 10, type, ...data });
}

// ---------------------------------------------------------------- screens
function show(name) {
  for (const id of ["menu", "rules", "play"]) $(id).hidden = id !== name;
  record("screen", { name });
  window.scrollTo(0, 0);
}

function showMenu() {
  $("puzzleBtn").disabled = false;
  $("puzzleBtn").textContent = `Puzzle (you are ${COLOUR[SIDE]})`;
  show("menu");
  loadTable().catch(() => {});                       // download ahead
}

function fillRules() {
  const text = $("rulesText").content;
  for (const body of document.querySelectorAll(".rules-body")) body.replaceChildren(text.cloneNode(true));
  for (const s of document.querySelectorAll(".side-line")) s.textContent = `You play ${COLOUR[SIDE]}.`;
  $("puzzleInfo").textContent = `It is ${OPENINGS[OPENING][1]}, and you play ${COLOUR[SIDE]}.`;
}

// ---------------------------------------------------------------- opponent table
let tablePromise = null;
function loadTable() {
  if (!tablePromise) {
    tablePromise = (async () => {
      const manifest = await (await fetch("opponent_web/manifest.json")).json();
      return loadReplyTable("opponent_web/" + manifest.openings[String(OPENING)].file);
    })();
    tablePromise.catch(() => { tablePromise = null; });   // allow a retry after a failed download
  }
  return tablePromise;
}

// ---------------------------------------------------------------- games and timer
let game = null;        // the game on screen
let selected = null;    // piece being placed: {piece, shape}
let hover = null;       // [row, col] under the mouse
let clockTimer = null;
let lastTick = 0;

function startPractice() {
  game = { kind: "practice", opening: null, human: 0, table: null, attempt: 0, best: null };
  record("practice_start");
  enterPlay();
}

async function startPuzzle() {
  $("menuNote").hidden = true;
  $("puzzleBtn").disabled = true;
  $("puzzleBtn").textContent = "Loading puzzle";
  let table;
  try {
    table = await loadTable();
  } catch (e) {
    record("error", { problem: "could not download opponent", opening: OPENING, message: String(e) });
    $("menuNote").textContent = "The puzzle could not be downloaded. Please check your internet connection and try again.";
    $("menuNote").hidden = false;
    $("puzzleBtn").disabled = false;
    $("puzzleBtn").textContent = `Puzzle (you are ${COLOUR[SIDE]})`;
    return;
  }
  if (!$("play").hidden || $("menu").hidden) return;   // something else was opened while it loaded
  game = { kind: "round", opening: OPENING, human: SIDE, table, attempt: 0, best: null, elapsedMs: 0, minimumReached: false };
  record("round_start", { opening: OPENING, side: COLOUR[SIDE], requiredMs: REQUIRED_MS });
  enterPlay();
}

function enterPlay() {
  $("play").className = `me-${game.human}`;
  show("play");
  newAttempt();
  clearInterval(clockTimer);
  if (game.kind === "round") {
    lastTick = performance.now();
    clockTimer = setInterval(tick, 250);
  }
  updateClock();
}

// Runs four times a second during the puzzle, as in the experiment.
function tick() {
  if (!game || game.kind !== "round") return;
  const now = performance.now();
  game.elapsedMs += now - lastTick;
  lastTick = now;
  if (!game.minimumReached && game.elapsedMs >= REQUIRED_MS) {
    game.minimumReached = true;
    record("minimum_reached", { opening: game.opening });
  }
  updateClock();
}

function fmt(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateClock() {
  $("clock").className = "";
  if (!game || game.kind !== "round") {
    $("clock").textContent = "Practice";
    $("timeup").hidden = true;
    return;
  }
  if (!game.minimumReached) {
    $("clock").textContent = `${fmt(REQUIRED_MS - game.elapsedMs + 999)} left`;
    $("timeup").hidden = true;
  } else {
    $("clock").textContent = `Extra time ${fmt(game.elapsedMs - REQUIRED_MS)}`;
    $("clock").className = "extra";
    $("timeupText").textContent = `${ROUND_MINUTES} minutes are up. In the full study, participants can now move on to the next puzzle, or keep playing this one for as long as they like.`;
    $("nextBtn").textContent = "Back to menu";
    $("timeup").hidden = false;
  }
}

// Leaves the practice game or the puzzle. Allowed at any time in the demo.
function backToMenu() {
  if (!game) return showMenu();
  clearInterval(clockTimer);
  if (game.attemptOpen) abandonAttempt("back to menu");
  game.token = null;                                // stops any pending computer move
  if (game.kind === "round") {
    record("round_end", { opening: game.opening, attempts: game.attempt, best: game.best, timeMs: Math.round(game.elapsedMs) });
  } else {
    record("practice_end", { attempts: game.attempt });
  }
  game = null;
  selected = null;
  showMenu();
}

// ---------------------------------------------------------------- one game
function newAttempt() {
  game.attempt++;
  game.token = Symbol();
  game.state = game.kind === "practice" ? new GameState(SMALL, 2) : openingState(SMALL, game.opening);
  game.startMoves = game.state.history.length;
  game.over = false;
  game.busy = false;
  game.lastComputer = null;
  game.attemptOpen = true;
  selected = null;
  record("attempt_start", { kind: game.kind, opening: game.opening, side: COLOUR[game.human], attempt: game.attempt });
  render();
  if (game.state.current !== game.human) computerTurn();
}

function abandonAttempt(reason) {
  record("attempt_abandoned", {
    kind: game.kind, reason, moves: game.state.history.slice(game.startMoves).map(h => h[1]),
  });
  game.attemptOpen = false;
}

const myTurn = () => game && !game.over && !game.busy && game.state.current === game.human;

function computerMove(state) {
  if (game.kind === "practice") {                    // practice opponent: a random legal move
    const legal = state.legalActions();
    return legal[Math.floor(Math.random() * legal.length)];
  }
  return game.table.reply(positionKey(state));
}

function computerTurn() {
  game.busy = true;
  render();
  const token = game.token;
  const step = () => {
    if (!game || game.token !== token) return;          // the attempt has ended
    const state = game.state;
    const reply = computerMove(state);
    if (reply === null || !state.isLegal(reply)) {
      record("error", { problem: "no stored reply", opening: game.opening, moves: state.history.map(h => h[1]) });
      setStatus("Something went wrong: the computer has no stored move here.");
      return;
    }
    const player = state.current;
    state.play(reply);
    game.lastComputer = reply;
    record("move", { by: "computer", player, action: reply });
    if (state.gameOver) return finishAttempt();
    if (state.current !== game.human) {               // you are out: computer moves again
      render();
      setTimeout(step, COMPUTER_DELAY_MS);
      return;
    }
    game.busy = false;
    render();
  };
  setTimeout(step, COMPUTER_DELAY_MS);
}

function finishAttempt() {
  const s = game.state.scores();
  const margin = s[game.human] - s[1 - game.human];
  game.over = true;
  game.busy = false;
  game.attemptOpen = false;
  if (game.best === null || margin > game.best) game.best = margin;
  record("attempt_end", {
    kind: game.kind, opening: game.opening, attempt: game.attempt, scores: s, margin,
    moves: game.state.history.slice(game.startMoves).map(h => h[1]),
  });
  render();
}

// ---------------------------------------------------------------- choosing and placing
function orientationIndex(piece, shape) {
  const id = shapeId(shape);
  return ORIENTATIONS[piece].findIndex(o => shapeId(o) === id);
}

// The cell of the shape that sits under the mouse: the one nearest the shape's centre.
function anchorOf(shape) {
  const cr = shape.reduce((s, [r]) => s + r, 0) / shape.length;
  const cc = shape.reduce((s, [, c]) => s + c, 0) / shape.length;
  let best = shape[0], bestD = Infinity;
  for (const [r, c] of shape) {
    const d = (r - cr) ** 2 + (c - cc) ** 2;
    if (d < bestD - 1e-9) { best = [r, c]; bestD = d; }
  }
  return best;
}

function placementAt(r, c) {
  const [ar, ac] = anchorOf(selected.shape);
  const row = r - ar, col = c - ac;
  const action = SMALL.findAction(selected.piece, selected.shape, row, col);
  const cells = selected.shape.map(([dr, dc]) => [row + dr, col + dc]);
  const legal = action !== null && myTurn() && game.state.isLegal(action);
  return { row, col, action, cells, legal };
}

function selectPiece(piece) {
  if (!game || game.over || !game.state.remaining[game.human].has(piece)) return;
  if (selected && selected.piece === piece) return deselect();
  selected = { piece, shape: ORIENTATIONS[piece][0].map(c => [...c]) };
  record("select", { piece });
  render();
}

function deselect() {
  if (!selected) return;
  record("deselect", { piece: selected.piece });
  selected = null;
  render();
}

function turn(kind) {
  if (!selected) return;
  if (kind === "rotate") selected.shape = rotate(selected.shape);
  else if (kind === "rotate_back") selected.shape = rotate(rotate(rotate(selected.shape)));
  else selected.shape = mirror(selected.shape);
  record(kind, { piece: selected.piece, orientation: orientationIndex(selected.piece, selected.shape) });
  render();
}

function clickCell(r, c) {
  if (!selected || !myTurn()) return;
  const p = placementAt(r, c);
  const orientation = orientationIndex(selected.piece, selected.shape);
  if (!p.legal) {
    record("place_rejected", { piece: selected.piece, orientation, row: p.row, col: p.col, action: p.action });
    showMessage(p.action === null ? "That doesn't fit on the board." : "That piece can't go there.");
    return;
  }
  const state = game.state;
  record("move", { by: "participant", player: state.current, action: p.action, piece: selected.piece, orientation });
  state.play(p.action);
  selected = null;
  if (state.gameOver) return finishAttempt();
  if (state.current !== game.human) return computerTurn();
  render();                                            // computer is out: you move again
}

let messageTimer = null;
function showMessage(text) {
  $("message").textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("message").textContent = ""), 1800);
}

// ---------------------------------------------------------------- drawing the game
function setStatus(text, cls = "") {
  $("status").textContent = text;
  $("status").className = cls;
}

function describeMargin(m) {
  if (m > 0) return `won by ${m}`;
  if (m < 0) return `lost by ${-m}`;
  return "drew";
}

// Squares where you could start a piece: corner-touching, and used by at least one legal move.
function anchorCells(state, p) {
  const v = state.variant;
  let occupied = 0n;
  for (const m of state.masks) occupied |= m;
  let anchors;
  if (!state.hasPlayed[p]) {
    const [r, c] = state.startCells[p];
    anchors = 1n << BigInt(r * v.boardSize + c);
  } else {
    const sides = v.sideNeighbours(state.masks[p]);
    anchors = v.cornerNeighbours(state.masks[p]) & ~sides & ~occupied;
  }
  const used = new Set();
  for (const a of state.legalActions()) for (const [r, c] of v.actions[a].cells) used.add(r * v.boardSize + c);
  return new Set(v.cellsIn(anchors).filter(i => used.has(i)));
}

function miniShape(shape, colour, used = false) {
  const h = Math.max(...shape.map(([r]) => r)) + 1, w = Math.max(...shape.map(([, c]) => c)) + 1;
  const on = new Set(shape.map(([r, c]) => r * w + c));
  const grid = document.createElement("div");
  grid.className = "mini";
  grid.style.gridTemplateColumns = `repeat(${w}, auto)`;
  for (let i = 0; i < h * w; i++) {
    const s = document.createElement("span");
    if (on.has(i)) s.className = used ? "off" : `on c${colour}`;
    grid.appendChild(s);
  }
  return grid;
}

const boardCells = [];
function buildBoard() {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const d = document.createElement("div");
      d.className = "cell";
      d.dataset.r = r;
      d.dataset.c = c;
      $("board").appendChild(d);
      boardCells.push(d);
    }
  }
}

function render() {
  if (!game || !game.state) return;
  const state = game.state, me = game.human;
  const grid = state.grid();
  const ghost = new Map();
  if (selected && hover && !game.over) {
    const p = placementAt(hover[0], hover[1]);
    for (const [r, c] of p.cells) if (r >= 0 && r < 8 && c >= 0 && c < 8) ghost.set(r * 8 + c, p.legal);
  }
  const anchors = myTurn() ? anchorCells(state, me) : new Set();
  const last = new Set(game.lastComputer === null ? [] : SMALL.actions[game.lastComputer].cells.map(([r, c]) => r * 8 + c));
  boardCells.forEach((d, i) => {
    const owner = grid[Math.floor(i / 8)][i % 8];
    let cls = "cell";
    if (owner !== null) cls += ` p${owner}`;
    if (ghost.has(i)) cls += ghost.get(i) ? " gl" : " gi";
    else if (owner === null && anchors.has(i)) cls += " anchor";
    if (last.has(i)) cls += " last";
    if (d.className !== cls) d.className = cls;
  });

  const tray = $("tray");
  tray.replaceChildren();
  for (const piece of SMALL.pieces) {
    const used = !state.remaining[me].has(piece);
    const b = document.createElement("button");
    b.className = "piece" + (selected && selected.piece === piece ? " selected" : "");
    b.disabled = used || game.over;
    b.setAttribute("aria-label", `Piece ${PIECES[piece][0]}`);
    b.appendChild(miniShape(selected && selected.piece === piece ? selected.shape : ORIENTATIONS[piece][0], me, used));
    b.addEventListener("click", () => selectPiece(piece));
    tray.appendChild(b);
  }
  $("their").replaceChildren(...SMALL.pieces.map(piece =>
    miniShape(ORIENTATIONS[piece][0], 1 - me, !state.remaining[1 - me].has(piece))));

  $("roundInfo").textContent = game.kind === "practice"
    ? `Practice game: you are ${COLOUR[me]}. The computer here plays randomly.`
    : `Puzzle: you are ${COLOUR[me]}. The computer plays perfectly.`;
  $("attemptInfo").textContent = `Attempt ${game.attempt}`;
  $("bestInfo").textContent = game.best === null ? "" : `Best result: ${describeMargin(game.best)}`;
  if (game.over) setStatus("Game over");
  else if (game.busy) setStatus(state.out[me] ? "You have no moves left. The computer plays on." : "Computer is moving", "them");
  else setStatus("Your move", "me");

  $("result").hidden = !game.over;
  $("practiceDoneBtn").hidden = game.kind !== "practice";
  if (game.over) {
    const s = state.scores();
    const margin = s[me] - s[1 - me];
    $("resultMain").textContent = `You ${describeMargin(margin)}.`;
    $("resultSub").textContent = game.kind === "practice"
      ? "Play again, or go back to the menu when you are ready to try the puzzle."
      : margin >= TARGET_MARGIN
        ? "That's the best possible result: every move you made was perfect."
        : `The best possible result here is a win by ${TARGET_MARGIN}.`;
  }
}

// ---------------------------------------------------------------- input
function wireInput() {
  buildBoard();
  const board = $("board");
  board.addEventListener("mousemove", e => {
    const d = e.target.closest(".cell");
    const h = d ? [+d.dataset.r, +d.dataset.c] : null;
    if (String(h) !== String(hover)) { hover = h; if (selected) render(); }
  });
  board.addEventListener("mouseleave", () => { hover = null; if (selected) render(); });
  board.addEventListener("click", e => {
    const d = e.target.closest(".cell");
    if (d) clickCell(+d.dataset.r, +d.dataset.c);
  });
  let lastWheel = 0;
  board.addEventListener("wheel", e => {
    if (!selected) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 150) return;               // trackpads send many small scroll events
    lastWheel = now;
    turn(e.deltaY > 0 ? "rotate" : "rotate_back");
  }, { passive: false });
  document.addEventListener("keydown", e => {
    if ($("play").hidden || !$("rulesOverlay").hidden) return;
    if (e.key === "r" || e.key === "R") turn("rotate");
    else if (e.key === "f" || e.key === "F") turn("flip");
    else if (e.key === "Escape") deselect();
  });
  $("rotateBtn").addEventListener("click", () => turn("rotate"));
  $("flipBtn").addEventListener("click", () => turn("flip"));
  $("againBtn").addEventListener("click", () => newAttempt());
  $("practiceDoneBtn").addEventListener("click", backToMenu);
  $("nextBtn").addEventListener("click", backToMenu);
  $("menuBtn").addEventListener("click", backToMenu);

  $("practiceBtn").addEventListener("click", startPractice);
  $("puzzleBtn").addEventListener("click", startPuzzle);
  $("rulesBtn").addEventListener("click", () => { record("rules_open", { from: "menu" }); show("rules"); });
  $("rulesBack").addEventListener("click", () => { record("rules_close", { from: "menu" }); showMenu(); });
  $("playRulesBtn").addEventListener("click", () => { record("rules_open", { from: "game" }); $("rulesOverlay").hidden = false; });
  $("rulesClose").addEventListener("click", () => { record("rules_close", { from: "game" }); $("rulesOverlay").hidden = true; });
}

// ---------------------------------------------------------------- start
function main() {
  fillRules();
  wireInput();
  record("page_load");
  showMenu();
  // read-only view for automated tests
  window.blokusTest = { get game() { return game; }, get selected() { return selected; }, get events() { return events; }, anchorOf, orientationIndex };
}

main();
