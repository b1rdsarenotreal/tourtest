(function(){
"use strict";

/* ---------------- Constants ---------------- */
const STORAGE_KEY = "fortnight-wta-state-v1";
const ROUND_ORDER = ["R128","R64","R32","R16","QF","SF","F"];
const ROUND_LABELS = {R128:"R128", R64:"R64", R32:"R32", R16:"R16", QF:"QF", SF:"SF", F:"F"};
const LEVEL_LABELS = {GRAND_SLAM:"Grand Slam", WTA1000:"WTA 1000", WTA500:"WTA 500", WTA250:"WTA 250"};
const POINTS_TABLE = {
  GRAND_SLAM: {R128:10, R64:70,  R32:130, R16:240, QF:430, SF:780, F:1300, W:2000},
  WTA1000:    {R128:0,  R64:10,  R32:65,  R16:120, QF:215, SF:390, F:650,  W:1000},
  WTA500:     {R128:0,  R64:0,   R32:1,   R16:60,  QF:108, SF:195, F:325,  W:500},
  WTA250:     {R128:0,  R64:0,   R32:0,   R16:30,  QF:54,  SF:98,  F:163,  W:250}
};

// Common tennis-broadcast 3-letter codes -> ISO 3166-1 alpha-2 (for flag emoji).
// 2-letter codes are assumed to already be ISO alpha-2 and used directly.
const COUNTRY_CODE_MAP = {
  USA:"US", GBR:"GB", ESP:"ES", FRA:"FR", GER:"DE", ITA:"IT", RUS:"RU", CHN:"CN",
  JPN:"JP", AUS:"AU", CAN:"CA", BRA:"BR", ARG:"AR", MEX:"MX", POL:"PL", CZE:"CZ",
  SVK:"SK", SUI:"CH", SWE:"SE", NOR:"NO", DEN:"DK", FIN:"FI", NED:"NL", BEL:"BE",
  AUT:"AT", GRE:"GR", POR:"PT", ROU:"RO", SRB:"RS", CRO:"HR", UKR:"UA", BLR:"BY",
  KAZ:"KZ", IND:"IN", KOR:"KR", THA:"TH", INA:"ID", PHI:"PH", VIE:"VN", TPE:"TW",
  HKG:"HK", SGP:"SG", MAS:"MY", NZL:"NZ", RSA:"ZA", EGY:"EG", MAR:"MA", TUN:"TN",
  ALG:"DZ", NGR:"NG", KEN:"KE", ETH:"ET", GHA:"GH", ISR:"IL", TUR:"TR", UAE:"AE",
  KSA:"SA", QAT:"QA", IRI:"IR", PAK:"PK", BAN:"BD", SRI:"LK", COL:"CO", CHI:"CL",
  PER:"PE", VEN:"VE", ECU:"EC", URU:"UY", PAR:"PY", BOL:"BO", CUB:"CU", DOM:"DO",
  JAM:"JM", PUR:"PR", CRC:"CR", PAN:"PA", GUA:"GT", HON:"HN", ISL:"IS", IRL:"IE",
  LTU:"LT", LAT:"LV", LVA:"LV", EST:"EE", SLO:"SI", SVN:"SI", BUL:"BG", HUN:"HU",
  MDA:"MD", ARM:"AM", GEO:"GE", AZE:"AZ", UZB:"UZ", MGL:"MN", LUX:"LU", MON:"MC",
  AND:"AD", CYP:"CY", MLT:"MT", ALB:"AL", MKD:"MK", BIH:"BA", MNE:"ME", KOS:"XK"
};

function countryToISO2(code){
  if(!code) return null;
  const c = code.trim().toUpperCase();
  if(c.length === 2) return c;
  if(c.length === 3 && COUNTRY_CODE_MAP[c]) return COUNTRY_CODE_MAP[c];
  return null;
}
function flagEmoji(code){
  const iso2 = countryToISO2(code);
  if(!iso2) return null;
  try{
    const points = [...iso2].map(ch => 127397 + ch.charCodeAt(0));
    return String.fromCodePoint(...points);
  }catch(e){ return null; }
}
// Flag + code, for standalone country display (tables, cards).
function countryDisplayHTML(code){
  if(!code) return "—";
  const flag = flagEmoji(code);
  return (flag ? '<span class="flag">' + flag + '</span>' : "") + escapeHtml(code.toUpperCase());
}
// Flag + name, for use in front of a player's name anywhere it appears.
function playerNameHTML(player){
  if(!player) return "";
  const flag = flagEmoji(player.country);
  return (flag ? '<span class="flag">' + flag + '</span>' : "") + escapeHtml(player.name);
}

/* ---------------- Storage ---------------- */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return {players:[], tournaments:[], matches:[]};
    const parsed = JSON.parse(raw);
    return {
      players: parsed.players || [],
      tournaments: parsed.tournaments || [],
      matches: parsed.matches || []
    };
  }catch(e){
    console.error("Failed to load state, starting fresh.", e);
    return {players:[], tournaments:[], matches:[]};
  }
}
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.error("Failed to save state", e);
    alert("Couldn't save — your browser storage may be full or blocked.");
  }
}

let state = loadState();

function uid(prefix){
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

/* ---------------- Derived data helpers ---------------- */

function playerById(id){ return state.players.find(p => p.id === id); }
function tournamentById(id){ return state.tournaments.find(t => t.id === id); }
function matchesForTournament(tid){ return state.matches.filter(m => m.tournamentId === tid); }
function matchesForPlayer(pid){ return state.matches.filter(m => m.playerAId === pid || m.playerBId === pid); }

// Furthest-round result per player for a tournament: 'W', or a round code meaning "lost in that round".
// Returns Map<playerId, {code, isChampion}>
function computeTournamentResults(tid){
  const matches = matchesForTournament(tid);
  const furthest = new Map(); // playerId -> {roundIdx, match}
  matches.forEach(m => {
    const idx = ROUND_ORDER.indexOf(m.round);
    [m.playerAId, m.playerBId].forEach(pid => {
      const cur = furthest.get(pid);
      if(!cur || idx > cur.roundIdx){
        furthest.set(pid, {roundIdx: idx, match: m});
      }
    });
  });
  const results = new Map();
  furthest.forEach((info, pid) => {
    const m = info.match;
    const won = m.winnerId === pid;
    if(won && m.round === "F"){
      results.set(pid, {code: "W", label: "Champion"});
    } else if(!won){
      results.set(pid, {code: m.round, label: "Lost " + ROUND_LABELS[m.round]});
    }
    // won but not final -> still active, no result yet
  });
  return results;
}

function pointsForResult(level, code){
  const table = POINTS_TABLE[level];
  if(!table) return 0;
  return table[code] || 0;
}

// Rankings for a given year (or null = all-time)
function computeRankings(year){
  const totals = new Map(); // playerId -> {points, titles}
  state.players.forEach(p => totals.set(p.id, {points:0, titles:0}));
  state.tournaments.forEach(t => {
    if(year && t.year !== year) return;
    const results = computeTournamentResults(t.id);
    results.forEach((res, pid) => {
      const entry = totals.get(pid);
      if(!entry) return;
      entry.points += pointsForResult(t.level, res.code);
      if(res.code === "W") entry.titles += 1;
    });
  });
  return totals;
}

function getSeasons(){
  const years = new Set(state.tournaments.map(t => t.year));
  return Array.from(years).sort((a,b) => b - a);
}

/* ---------------- DOM helpers ---------------- */
function $(sel, root){ return (root||document).querySelector(sel); }
function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
function el(tag, attrs, children){
  const node = document.createElement(tag);
  if(attrs) Object.keys(attrs).forEach(k => {
    if(k === "class") node.className = attrs[k];
    else if(k === "html") node.innerHTML = attrs[k];
    else node.setAttribute(k, attrs[k]);
  });
  (children||[]).forEach(c => { if(c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return node;
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- Scoreboard rendering ---------------- */
function renderScoreboardHTML(match){
  if(match.walkover){
    return '<div class="scoreboard walkover">W/O</div>';
  }
  const winnerIsA = match.winnerId === match.playerAId;
  const sets = match.sets || [];
  if(sets.length === 0) return '<div class="scoreboard walkover">—</div>';
  const cells = sets.map(s => {
    const top = winnerIsA ? s.a : s.b;
    const bottom = winnerIsA ? s.b : s.a;
    const tb = s.tb ? '<span class="sb-tb">' + escapeHtml(s.tb) + '</span>' : '';
    return '<div class="sb-set">' +
      '<span class="sb-num won">' + escapeHtml(top) + '</span>' +
      '<span class="sb-num">' + escapeHtml(bottom) + '</span>' +
      tb +
      '</div>';
  }).join("");
  return '<div class="scoreboard">' + cells + '</div>';
}

/* ---------------- Rankings view ---------------- */
function populateRankingsYearSelect(){
  const sel = $("#rankings-year");
  const current = sel.value;
  const seasons = getSeasons();
  sel.innerHTML = '<option value="all">All-time</option>' +
    seasons.map(y => '<option value="' + y + '">' + y + ' Season</option>').join("");
  if(current && (current === "all" || seasons.includes(Number(current)))){
    sel.value = current;
  }
}

function renderRankings(){
  populateRankingsYearSelect();
  const yearVal = $("#rankings-year").value || "all";
  const year = yearVal === "all" ? null : Number(yearVal);
  const totals = computeRankings(year);

  const rows = state.players
    .map(p => ({p, stats: totals.get(p.id) || {points:0, titles:0}}))
    .filter(r => r.stats.points > 0)
    .sort((a,b) => b.stats.points - a.stats.points || a.p.name.localeCompare(b.p.name));

  const body = $("#rankings-body");
  const table = $("#rankings-table");
  const empty = $("#rankings-empty");

  if(rows.length === 0){
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = rows.map((r, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? "rank-num top3" : "rank-num";
    return '<tr>' +
      '<td class="rank-col"><span class="' + rankClass + '">' + rank + '</span></td>' +
      '<td><button class="player-link" data-open-player="' + r.p.id + '">' + escapeHtml(r.p.name) + '</button></td>' +
      '<td class="country-chip">' + countryDisplayHTML(r.p.country) + '</td>' +
      '<td>' + r.stats.titles + '</td>' +
      '<td class="points-cell">' + r.stats.points.toLocaleString() + '</td>' +
      '</tr>';
  }).join("");
}

/* ---------------- Players view ---------------- */
function renderPlayers(){
  const grid = $("#players-grid");
  const empty = $("#players-empty");
  if(state.players.length === 0){
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  const totals = computeRankings(null);
  const sorted = [...state.players].sort((a,b) => a.name.localeCompare(b.name));
  grid.innerHTML = "";
  sorted.forEach(p => {
    const stats = totals.get(p.id) || {points:0, titles:0};
    const card = el("div", {class:"player-card", "data-open-player": p.id}, [
      el("div", {class:"pc-name", html: playerNameHTML(p)}),
      el("div", {class:"pc-meta"}, [
        el("span", {}, [(p.country ? p.country.toUpperCase() : "—")]),
        el("span", {}, [stats.points.toLocaleString() + " pts"])
      ])
    ]);
    grid.appendChild(card);
  });
}

function renderPlayerProfile(playerId){
  const p = playerById(playerId);
  if(!p) return;
  const matches = matchesForPlayer(playerId).sort((a,b) => {
    const ta = tournamentById(a.tournamentId), tb = tournamentById(b.tournamentId);
    return (tb ? tb.year : 0) - (ta ? ta.year : 0) || ROUND_ORDER.indexOf(b.round) - ROUND_ORDER.indexOf(a.round);
  });
  const wins = matches.filter(m => m.winnerId === playerId).length;
  const losses = matches.length - wins;
  const totals = computeRankings(null);
  const stats = totals.get(playerId) || {points:0, titles:0};

  // tournament results
  const tResults = state.tournaments
    .filter(t => matchesForTournament(t.id).some(m => m.playerAId === playerId || m.playerBId === playerId))
    .sort((a,b) => b.year - a.year)
    .map(t => {
      const res = computeTournamentResults(t.id).get(playerId);
      return {t, res};
    });

  const modal = $("#player-modal");
  modal.innerHTML = "";
  modal.appendChild(el("div", {class:"profile-head"}, [
    el("div", {}, [
      el("div", {class:"profile-name", html: playerNameHTML(p)}),
      el("div", {class:"profile-meta"}, [
        (p.country ? p.country.toUpperCase() : "—") + " · " + (p.hand === "L" ? "Left-handed" : "Right-handed")
      ])
    ])
  ]));

  const statsBox = el("div", {class:"profile-stats"}, [
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [String(stats.points.toLocaleString())]), el("div", {class:"stat-label"}, ["Points"])]),
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [String(stats.titles)]), el("div", {class:"stat-label"}, ["Titles"])]),
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [wins + "-" + losses]), el("div", {class:"stat-label"}, ["Win-Loss"])])
  ]);
  modal.appendChild(statsBox);

  modal.appendChild(el("div", {class:"profile-section-title"}, ["Tournament Results"]));
  if(tResults.length === 0){
    modal.appendChild(el("p", {}, ["No tournaments played yet."]));
  } else {
    tResults.forEach(({t, res}) => {
      const row = el("div", {class:"tourney-row"}, [
        el("span", {class:"level-tag"}, [LEVEL_LABELS[t.level] || t.level]),
        el("span", {class:"surface-tag surface-" + t.surface}, [t.surface]),
        el("span", {class:"tourney-name"}, [t.name + " '" + String(t.year).slice(-2)]),
        el("span", {class:"tourney-champ"}, [res ? res.label : "In progress"])
      ]);
      modal.appendChild(row);
    });
  }

  modal.appendChild(el("div", {class:"profile-section-title"}, ["Recent Matches"]));
  if(matches.length === 0){
    modal.appendChild(el("p", {}, ["No matches recorded yet."]));
  } else {
    matches.slice(0, 15).forEach(m => {
      const t = tournamentById(m.tournamentId);
      const a = playerById(m.playerAId), b = playerById(m.playerBId);
      const row = el("div", {class:"match-row"}, [
        el("span", {class:"match-round"}, [ROUND_LABELS[m.round]]),
        el("span", {class:"match-players", html:
          (m.winnerId === a.id ? '<span class="winner">' + playerNameHTML(a) + '</span>' : playerNameHTML(a)) +
          ' def. ' +
          (m.winnerId === b.id ? '<span class="winner">' + playerNameHTML(b) + '</span>' : playerNameHTML(b))
        }),
        el("span", {html: renderScoreboardHTML(m)}),
        el("span", {class:"match-tourney"}, [t ? (t.name + " '" + String(t.year).slice(-2)) : ""])
      ]);
      modal.appendChild(row);
    });
  }

  modal.appendChild(el("div", {class:"modal-close-row"}, [
    el("button", {class:"btn btn-ghost", id:"profile-close"}, ["Close"])
  ]));

  $("#player-modal-backdrop").classList.remove("hidden");
  $("#profile-close").addEventListener("click", closePlayerModal);
}
function closePlayerModal(){
  $("#player-modal-backdrop").classList.add("hidden");
}

/* ---------------- Tournaments view ---------------- */
function renderTournaments(){
  const list = $("#tournaments-list");
  const empty = $("#tournaments-empty");
  if(state.tournaments.length === 0){
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  const byYear = new Map();
  state.tournaments.forEach(t => {
    if(!byYear.has(t.year)) byYear.set(t.year, []);
    byYear.get(t.year).push(t);
  });
  const years = Array.from(byYear.keys()).sort((a,b) => b - a);
  list.innerHTML = "";
  years.forEach(year => {
    const group = el("div", {class:"tourney-year-group"});
    group.appendChild(el("h3", {}, [String(year) + " Season"]));
    byYear.get(year)
      .sort((a,b) => a.name.localeCompare(b.name))
      .forEach(t => {
        const results = computeTournamentResults(t.id);
        let champId = null;
        results.forEach((res, pid) => { if(res.code === "W") champId = pid; });
        const champ = champId ? playerById(champId) : null;
        const row = el("div", {class:"tourney-row"}, [
          el("span", {class:"level-tag"}, [LEVEL_LABELS[t.level] || t.level]),
          el("span", {class:"surface-tag surface-" + t.surface}, [t.surface]),
          el("span", {class:"tourney-name"}, [t.name]),
          el("span", {class:"tourney-champ"}, champ
            ? ["Champion: ", el("b", {html: playerNameHTML(champ)})]
            : [matchesForTournament(t.id).length ? "In progress" : "No results yet"])
        ]);
        group.appendChild(row);
      });
    list.appendChild(group);
  });
}

/* ---------------- Add Match view ---------------- */
function refreshMatchFormOptions(){
  const hasEnough = state.players.length >= 2 && state.tournaments.length >= 1;
  $("#add-match-blocked").classList.toggle("hidden", hasEnough);
  $("#match-form").classList.toggle("hidden", !hasEnough);
  if(!hasEnough) return;

  const tSel = $("#mf-tournament");
  const prevT = tSel.value;
  tSel.innerHTML = [...state.tournaments]
    .sort((a,b) => b.year - a.year || a.name.localeCompare(b.name))
    .map(t => '<option value="' + t.id + '">' + escapeHtml(t.name) + " '" + String(t.year).slice(-2) + " (" + (LEVEL_LABELS[t.level]||t.level) + ")</option>")
    .join("");
  if(prevT) tSel.value = prevT;

  const rSel = $("#mf-round");
  rSel.innerHTML = ROUND_ORDER.map(r => '<option value="' + r + '">' + ROUND_LABELS[r] + "</option>").join("");
  rSel.value = "F";

  const playersSorted = [...state.players].sort((a,b) => a.name.localeCompare(b.name));
  const optionsHTML = playersSorted.map(p => {
    const flag = flagEmoji(p.country);
    return '<option value="' + p.id + '">' + (flag ? flag + " " : "") + escapeHtml(p.name) + "</option>";
  }).join("");
  const aSel = $("#mf-playerA"), bSel = $("#mf-playerB");
  const prevA = aSel.value, prevB = bSel.value;
  aSel.innerHTML = optionsHTML;
  bSel.innerHTML = optionsHTML;
  if(prevA) aSel.value = prevA;
  if(prevB) bSel.value = prevB;
  if(!aSel.value && playersSorted[0]) aSel.value = playersSorted[0].id;
  if(!bSel.value && playersSorted[1]) bSel.value = playersSorted[1].id;

  buildSetInputs();
  updateWinnerOptions();
}

function buildSetInputs(){
  const container = $("#mf-sets");
  container.innerHTML = "";
  for(let i = 1; i <= 3; i++){
    const box = el("div", {class:"set-box"}, [
      el("span", {}, ["Set " + i]),
      el("div", {style:"display:flex;gap:4px;align-items:center;"})
    ]);
    const row = box.querySelector("div");
    const inputA = el("input", {type:"number", min:"0", max:"30", class:"set-a", placeholder:"A"});
    const dash = el("span", {}, ["–"]);
    const inputB = el("input", {type:"number", min:"0", max:"30", class:"set-b", placeholder:"B"});
    row.appendChild(inputA); row.appendChild(dash); row.appendChild(inputB);
    container.appendChild(box);
  }
}

function updateWinnerOptions(){
  const aId = $("#mf-playerA").value, bId = $("#mf-playerB").value;
  const a = playerById(aId), b = playerById(bId);
  const wSel = $("#mf-winner");
  const prev = wSel.value;
  wSel.innerHTML = "";
  if(a) wSel.appendChild(el("option", {value:a.id, html: playerNameHTML(a)}));
  if(b) wSel.appendChild(el("option", {value:b.id, html: playerNameHTML(b)}));
  if(prev && (prev === aId || prev === bId)) wSel.value = prev;
}

function handleMatchSubmit(ev){
  ev.preventDefault();
  const msg = $("#mf-msg");
  msg.textContent = "";
  msg.className = "form-msg";

  const tournamentId = $("#mf-tournament").value;
  const round = $("#mf-round").value;
  const playerAId = $("#mf-playerA").value;
  const playerBId = $("#mf-playerB").value;
  const winnerId = $("#mf-winner").value;
  const walkover = $("#mf-walkover").checked;

  if(!tournamentId || !round || !playerAId || !playerBId || !winnerId){
    msg.textContent = "Please fill in every field.";
    return;
  }
  if(playerAId === playerBId){
    msg.textContent = "Player A and Player B must be different.";
    return;
  }

  let sets = [];
  if(!walkover){
    const boxes = $all("#mf-sets .set-box");
    for(const box of boxes){
      const aVal = box.querySelector(".set-a").value;
      const bVal = box.querySelector(".set-b").value;
      if(aVal === "" && bVal === "") continue;
      if(aVal === "" || bVal === ""){
        msg.textContent = "Finish entering that set, or leave it fully blank.";
        return;
      }
      sets.push({a: Number(aVal), b: Number(bVal)});
    }
    if(sets.length === 0){
      msg.textContent = "Enter at least one set score, or tick walkover.";
      return;
    }
  }

  const match = {
    id: uid("m"),
    tournamentId, round, playerAId, playerBId, winnerId,
    walkover, sets,
    createdAt: Date.now()
  };
  state.matches.push(match);
  saveState();

  msg.textContent = "Result saved.";
  msg.className = "form-msg ok";
  buildSetInputs();
  $("#mf-walkover").checked = false;

  renderRankings();
}

/* ---------------- History view ---------------- */
function populateHistoryFilters(){
  const pSel = $("#history-player");
  const prevP = pSel.value;
  pSel.innerHTML = '<option value="all">All players</option>' +
    [...state.players].sort((a,b) => a.name.localeCompare(b.name))
      .map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + "</option>").join("");
  if(prevP) pSel.value = prevP;

  const tSel = $("#history-tournament");
  const prevT = tSel.value;
  tSel.innerHTML = '<option value="all">All tournaments</option>' +
    [...state.tournaments].sort((a,b) => b.year - a.year)
      .map(t => '<option value="' + t.id + '">' + escapeHtml(t.name) + " '" + String(t.year).slice(-2) + "</option>").join("");
  if(prevT) tSel.value = prevT;
}

function renderHistory(){
  populateHistoryFilters();
  const playerFilter = $("#history-player").value || "all";
  const tourneyFilter = $("#history-tournament").value || "all";

  let matches = [...state.matches];
  if(playerFilter !== "all") matches = matches.filter(m => m.playerAId === playerFilter || m.playerBId === playerFilter);
  if(tourneyFilter !== "all") matches = matches.filter(m => m.tournamentId === tourneyFilter);
  matches.sort((a,b) => b.createdAt - a.createdAt);

  const list = $("#history-list");
  const empty = $("#history-empty");
  if(matches.length === 0){
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.innerHTML = "";
  matches.forEach(m => {
    const t = tournamentById(m.tournamentId);
    const a = playerById(m.playerAId), b = playerById(m.playerBId);
    if(!a || !b) return;
    const row = el("div", {class:"match-row"}, [
      el("span", {class:"match-round"}, [ROUND_LABELS[m.round]]),
      el("span", {class:"match-players", html:
        (m.winnerId === a.id ? '<span class="winner">' + playerNameHTML(a) + '</span>' : playerNameHTML(a)) +
        ' def. ' +
        (m.winnerId === b.id ? '<span class="winner">' + playerNameHTML(b) + '</span>' : playerNameHTML(b))
      }),
      el("span", {html: renderScoreboardHTML(m)}),
      el("span", {class:"match-tourney"}, [t ? (t.name + " '" + String(t.year).slice(-2)) : "—"]),
      el("button", {class:"btn btn-small btn-danger match-del", "data-delete-match": m.id}, ["Delete"])
    ]);
    list.appendChild(row);
  });
}

/* ---------------- Modals: add player / bulk add / add tournament ---------------- */
function openAddPlayer(){ $("#add-player-backdrop").classList.remove("hidden"); $("#ap-name").focus(); updateFlagPreview(); }
function closeAddPlayer(){ $("#add-player-backdrop").classList.add("hidden"); $("#add-player-form").reset(); updateFlagPreview(); }
function updateFlagPreview(){
  const code = $("#ap-country").value;
  const flag = flagEmoji(code);
  $("#ap-flag-preview").textContent = flag ? flag + " " + code.toUpperCase() : (code ? "No flag found for that code" : "");
}

function openBulkAdd(){ $("#bulk-add-backdrop").classList.remove("hidden"); $("#ba-textarea").focus(); }
function closeBulkAdd(){ $("#bulk-add-backdrop").classList.add("hidden"); $("#ba-textarea").value = ""; $("#ba-msg").textContent = ""; }

function handleBulkAdd(ev){
  ev.preventDefault();
  const raw = $("#ba-textarea").value;
  const msg = $("#ba-msg");
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  if(lines.length === 0){
    msg.textContent = "Paste at least one player first.";
    msg.className = "form-msg";
    return;
  }

  const existingNames = new Set(state.players.map(p => p.name.trim().toLowerCase()));
  let added = 0, skippedDup = 0;

  lines.forEach(line => {
    const parts = line.split(",");
    const name = parts[0].trim();
    const country = parts.length > 1 ? parts[1].trim().toUpperCase().slice(0,3) : "";
    if(!name) return;
    const key = name.toLowerCase();
    if(existingNames.has(key)){ skippedDup++; return; }
    existingNames.add(key);
    state.players.push({id: uid("p"), name, country, hand: "R", createdAt: Date.now()});
    added++;
  });

  if(added > 0) saveState();

  let text = added === 1 ? "Added 1 player." : "Added " + added + " players.";
  if(skippedDup > 0) text += " Skipped " + skippedDup + " already on the roster.";
  msg.textContent = text;
  msg.className = "form-msg ok";
  $("#ba-textarea").value = "";

  renderPlayers();
  renderRankings();
  refreshMatchFormOptions();
}

function openAddTournament(){ $("#add-tournament-backdrop").classList.remove("hidden"); $("#at-name").focus(); }
function closeAddTournament(){ $("#add-tournament-backdrop").classList.add("hidden"); $("#add-tournament-form").reset(); }

function handleAddPlayer(ev){
  ev.preventDefault();
  const name = $("#ap-name").value.trim();
  if(!name) return;
  const country = $("#ap-country").value.trim().toUpperCase();
  const hand = $("#ap-hand").value;
  state.players.push({id: uid("p"), name, country, hand, createdAt: Date.now()});
  saveState();
  closeAddPlayer();
  renderPlayers();
  renderRankings();
  refreshMatchFormOptions();
}

function handleAddTournament(ev){
  ev.preventDefault();
  const name = $("#at-name").value.trim();
  const year = Number($("#at-year").value);
  if(!name || !year) return;
  const level = $("#at-level").value;
  const surface = $("#at-surface").value;
  state.tournaments.push({id: uid("t"), name, level, surface, year, createdAt: Date.now()});
  saveState();
  closeAddTournament();
  renderTournaments();
  refreshMatchFormOptions();
}

/* ---------------- Tab / view switching ---------------- */
function switchView(view){
  $all(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  $all(".view").forEach(v => v.classList.toggle("hidden", v.id !== "view-" + view));
  if(view === "rankings") renderRankings();
  if(view === "players") renderPlayers();
  if(view === "tournaments") renderTournaments();
  if(view === "add-match") refreshMatchFormOptions();
  if(view === "history") renderHistory();
}

/* ---------------- Wire up events ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  $all(".tab").forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));

  $("#rankings-year").addEventListener("change", renderRankings);

  $("#open-add-player").addEventListener("click", openAddPlayer);
  $("#ap-cancel").addEventListener("click", closeAddPlayer);
  $("#add-player-form").addEventListener("submit", handleAddPlayer);
  $("#add-player-backdrop").addEventListener("click", (e) => { if(e.target.id === "add-player-backdrop") closeAddPlayer(); });
  $("#ap-country").addEventListener("input", updateFlagPreview);

  $("#open-bulk-add").addEventListener("click", openBulkAdd);
  $("#ba-cancel").addEventListener("click", closeBulkAdd);
  $("#bulk-add-form").addEventListener("submit", handleBulkAdd);
  $("#bulk-add-backdrop").addEventListener("click", (e) => { if(e.target.id === "bulk-add-backdrop") closeBulkAdd(); });

  $("#open-add-tournament").addEventListener("click", openAddTournament);
  $("#at-cancel").addEventListener("click", closeAddTournament);
  $("#add-tournament-form").addEventListener("submit", handleAddTournament);
  $("#add-tournament-backdrop").addEventListener("click", (e) => { if(e.target.id === "add-tournament-backdrop") closeAddTournament(); });

  $("#match-form").addEventListener("submit", handleMatchSubmit);
  $("#mf-playerA").addEventListener("change", updateWinnerOptions);
  $("#mf-playerB").addEventListener("change", updateWinnerOptions);
  $("#mf-walkover").addEventListener("change", (e) => {
    $("#mf-sets").classList.toggle("hidden", e.target.checked);
  });

  $("#history-player").addEventListener("change", renderHistory);
  $("#history-tournament").addEventListener("change", renderHistory);

  $("#player-modal-backdrop").addEventListener("click", (e) => { if(e.target.id === "player-modal-backdrop") closePlayerModal(); });

  document.addEventListener("click", (e) => {
    const openBtn = e.target.closest("[data-open-player]");
    if(openBtn){ renderPlayerProfile(openBtn.dataset.openPlayer); return; }
    const delBtn = e.target.closest("[data-delete-match]");
    if(delBtn){
      if(confirm("Delete this match result? This can't be undone.")){
        state.matches = state.matches.filter(m => m.id !== delBtn.dataset.deleteMatch);
        saveState();
        renderHistory();
        renderRankings();
      }
    }
  });

  renderRankings();
});

})();
