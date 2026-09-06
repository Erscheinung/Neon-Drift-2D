// Static build: the leaderboard is disabled until a server-side API is configured.
// Never put Airtable credentials or other private keys in browser code.
const LEADERBOARD_API = '';


// ── Player name ──────────────────────────────────────────────────────────────
const NAME_KEY = 'neondrift_player';

// Most recent leaderboard rows, kept so the board can render instantly on death
// while a fresh fetch happens in the background.
let lastRows = [];

export function getPlayerName() {
  return localStorage.getItem(NAME_KEY) || '';
}

export function setPlayerName(name) {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 20));
}

export function hasPlayerName() {
  return getPlayerName().length > 0;
}

// ── Leaderboard helpers ───────────────────────────────────────────────────────
async function fetchTop10() {
  if (!LEADERBOARD_API) return [];
  try {
    const params = new URLSearchParams({
      'sort[0][field]': 'Score',
      'sort[0][direction]': 'desc',
      maxRecords: 10,
    });
    params.append('fields[]', 'Name');
    params.append('fields[]', 'Score');
    const res = await fetch(`${LEADERBOARD_API}?${params}`);
    if (!res.ok) {
      console.error('Leaderboard fetch error', res.status);
      return [];
    }
    const data = await res.json();
    lastRows = Array.isArray(data.records)
      ? data.records.map(r => ({ name: r.name, score: r.score }))
      : [];
    return lastRows;
  } catch (e) {
    console.error('Leaderboard fetch exception', e);
    return [];
  }
}

async function submitScore(name, score) {
  if (!LEADERBOARD_API) return false;
  try {
    const res = await fetch(LEADERBOARD_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, score }),
    });
    return res.ok;
  } catch {
    // silent — leaderboard is optional
    return false;
  }
}

// Build a leaderboard shown immediately, with the player's own row spliced into
// the correct rank. Used to render the board without waiting on the network.
function optimisticRows(rows, name, score) {
  const merged = rows.filter(r => !(r.name === name && r.score === score));
  merged.push({ name, score });
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, 10);
}

// ── UI ────────────────────────────────────────────────────────────────────────
const MODAL_ID    = 'hs-modal';
const LIST_ID     = 'hs-list';
const NAME_INPUT  = 'hs-name-input';
const SUBMIT_BTN  = 'hs-submit';
const SKIP_BTN    = 'hs-skip';
const PLAY_AGAIN_BTN = 'hs-play-again';

let playAgainHandler = null;

// Bumped each time the leaderboard opens. Background refreshes carry the id they
// were started under and only apply if it's still current, so a stale refetch
// from a previous death can't overwrite a newer board.
let openToken = 0;

export function setLeaderboardPlayAgainHandler(handler) {
  playAgainHandler = handler;
}

function buildModal() {
  if (document.getElementById(MODAL_ID)) return;
  const el = document.createElement('div');
  el.id = MODAL_ID;
  el.innerHTML = `
    <div id="hs-inner">
      <div id="hs-title">LEADERBOARD</div>
      <div id="hs-new-score"></div>
      <ol id="${LIST_ID}"></ol>
      <div id="hs-enter">
        <div id="hs-prompt">SAVE YOUR SCORE?</div>
        <input id="${NAME_INPUT}" type="text" maxlength="20" placeholder="ENTER NAME" autocomplete="off" spellcheck="false" />
        <div id="hs-buttons">
          <button id="${SUBMIT_BTN}">SUBMIT</button>
          <button id="${SKIP_BTN}">SKIP</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById(SUBMIT_BTN).addEventListener('click', () => handleSubmit());
  document.getElementById(SKIP_BTN).addEventListener('click', () => closeModal());
  document.getElementById(NAME_INPUT).addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSubmit();
    e.stopPropagation(); // prevent game input
  });
}

function populateList(rows, highlightScore) {
  const list = document.getElementById(LIST_ID);
  populateListInto(list, rows, highlightScore);
}

function populateListInto(list, rows, highlightScore) {
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<li class="hs-empty">No scores yet — be first!</li>';
    return;
  }
  list.innerHTML = rows.map((r, i) => {
    const cls = r.score === highlightScore ? ' class="hs-highlight"' : '';
    return `<li${cls}><span class="hs-rank">${i + 1}</span><span class="hs-name">${escHtml(r.name)}</span><span class="hs-pts">${r.score.toLocaleString()}</span></li>`;
  }).join('');
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function closeModal() {
  const m = document.getElementById(MODAL_ID);
  if (m) m.style.display = 'none';
}

async function handleSubmit() {
  const input = document.getElementById(NAME_INPUT);
  const name = input ? input.value.trim() : '';
  if (!name) { if (input) input.focus(); return; }

  setPlayerName(name);
  const scoreVal = parseInt(document.getElementById('hs-new-score')?.dataset.score || '0');
  const myToken = openToken;

  // Show the saved state + board immediately; persist + reconcile in background.
  const list = document.getElementById(LIST_ID);
  populateListInto(list, optimisticRows(lastRows, name, scoreVal), scoreVal);

  const enterEl = document.getElementById('hs-enter');
  if (enterEl) {
    enterEl.innerHTML = `
      <div id="hs-saved">${LEADERBOARD_API ? 'SCORE SAVED' : 'LEADERBOARD OFFLINE'}</div>
      <button id="${PLAY_AGAIN_BTN}" type="button">PLAY AGAIN</button>
    `;
    document.getElementById(PLAY_AGAIN_BTN).addEventListener('click', () => {
      if (playAgainHandler) playAgainHandler();
      else closeModal();
    });
  }

  submitScore(name, scoreVal)
    .then(() => new Promise(r => setTimeout(r, 800)))
    .then(fetchTop10)
    .then(rows => {
      const modal = document.getElementById(MODAL_ID);
      if (myToken === openToken && rows.length && modal && modal.style.display !== 'none') {
        populateListInto(list, rows, scoreVal);
      }
    });
}

// ── Public API ────────────────────────────────────────────────────────────────
export function closeLeaderboard() {
  closeModal();
}

export async function fetchGlobalBest() {
  const rows = await fetchTop10();
  return rows.length ? rows[0] : null;
}

export async function showLeaderboard(currentScore) {
  buildModal();
  const myToken = ++openToken;

  const modal = document.getElementById(MODAL_ID);
  modal.style.display = 'flex';

  const scoreEl = document.getElementById('hs-new-score');
  if (scoreEl) {
    scoreEl.textContent = currentScore.toLocaleString();
    scoreEl.dataset.score = currentScore;
  }

  const enterEl = document.getElementById('hs-enter');
  const listNode = document.getElementById(LIST_ID);

  // Name already known: render the board instantly (player's row spliced in
  // optimistically), fire the save in the background, then reconcile quietly.
  // No blocking wait — avoids the visible "saving score" hang.
  if (hasPlayerName()) {
    const name = getPlayerName();
    if (enterEl) {
      enterEl.style.display = 'block';
      enterEl.innerHTML = `
        <div id="hs-saved">${LEADERBOARD_API ? 'SCORE SAVED' : 'LEADERBOARD OFFLINE'} · ${escHtml(name)}</div>
        <button id="${PLAY_AGAIN_BTN}" type="button">PLAY AGAIN</button>
      `;
      document.getElementById(PLAY_AGAIN_BTN).addEventListener('click', () => {
        if (playAgainHandler) playAgainHandler();
        else closeModal();
      });
    }
    populateListInto(listNode, optimisticRows(lastRows, name, currentScore), currentScore);

    // Background: persist, wait for indexing, then refresh with authoritative rows.
    submitScore(name, currentScore)
      .then(() => new Promise(r => setTimeout(r, 800)))
      .then(fetchTop10)
      .then(rows => {
        if (myToken === openToken && rows.length && modal.style.display !== 'none') {
          populateListInto(listNode, rows, currentScore);
        }
      });
    return;
  }

  // No saved name: fall back to the manual enter form.
  if (enterEl) {
    enterEl.style.display = 'block';
    enterEl.innerHTML = `
      <div id="hs-prompt">SAVE YOUR SCORE?</div>
      <input id="${NAME_INPUT}" type="text" maxlength="20" placeholder="ENTER NAME" autocomplete="off" spellcheck="false" />
      <div id="hs-buttons">
        <button id="${SUBMIT_BTN}">SUBMIT</button>
        <button id="${SKIP_BTN}">SKIP</button>
      </div>
    `;
    document.getElementById(SUBMIT_BTN).addEventListener('click', () => handleSubmit());
    document.getElementById(SKIP_BTN).addEventListener('click', () => closeModal());
    document.getElementById(NAME_INPUT).addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSubmit();
      e.stopPropagation();
    });
  }

  const nameInput = document.getElementById(NAME_INPUT);
  if (nameInput) {
    nameInput.value = getPlayerName();
    setTimeout(() => nameInput.focus(), 100);
  }

  const rows = await fetchTop10();
  populateList(rows, currentScore);
}
