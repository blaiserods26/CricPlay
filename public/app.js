/* ============ CricPlay – App Logic ============ */

// ---------- STATE ----------
const state = {
  images: [],
  players: [],        // { id, name, status: 'available'|'xi'|'impact', order: null, role: null }
  userName: '',
  teamName: '',
  maxImpact: 3,
};

// ---------- DOM REFS ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  uploadZone: $('#uploadZone'),
  imageInput: $('#imageInput'),
  imagePreviews: $('#imagePreviews'),
  extractBtn: $('#extractBtn'),
  ocrProgress: $('#ocrProgress'),
  progressFill: $('#progressFill'),
  progressText: $('#progressText'),
  manualPlayerInput: $('#manualPlayerInput'),
  addManualBtn: $('#addManualBtn'),
  userName: $('#userName'),
  teamName: $('#teamName'),
  impactCount: $('#impactCount'),
  squadSection: $('#squadSection'),
  buildSection: $('#buildSection'),
  exportSection: $('#exportSection'),
  playerPool: $('#playerPool'),
  searchPool: $('#searchPool'),
  playingXISlots: $('#playingXISlots'),
  impactSlots: $('#impactSlots'),
  xiCount: $('#xiCount'),
  impactCount2: $('#impactCount2'),
  maxImpact: $('#maxImpact'),
  totalPlayers: $('#totalPlayers'),
  selectedCount: $('#selectedCount'),
  impactSelectedCount: $('#impactSelectedCount'),
  availableCount: $('#availableCount'),
  exportPreview: $('#exportPreview'),
  copyBtn: $('#copyBtn'),
  downloadBtn: $('#downloadBtn'),
  resetBtn: $('#resetBtn'),
  bgParticles: $('#bgParticles'),
  toastContainer: $('#toastContainer'),
};

// ---------- INIT ----------
function init() {
  createParticles();
  bindEvents();
  loadFromStorage();
  render();
}

function createParticles() {
  const colors = ['var(--accent)', 'var(--accent2)', 'var(--impact-color)', 'var(--green)'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 6 + 2;
    p.style.cssText = `
      width: ${size}px; height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      animation-delay: ${Math.random() * 20}s;
      animation-duration: ${15 + Math.random() * 15}s;
    `;
    dom.bgParticles.appendChild(p);
  }
}

// ---------- EVENT BINDINGS ----------
function bindEvents() {
  // Drag & drop
  dom.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); dom.uploadZone.classList.add('dragover'); });
  dom.uploadZone.addEventListener('dragleave', () => dom.uploadZone.classList.remove('dragover'));
  dom.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault(); dom.uploadZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
  dom.imageInput.addEventListener('change', (e) => handleFiles(e.target.files));

  // Extract
  dom.extractBtn.addEventListener('click', extractPlayers);

  // Manual add
  dom.addManualBtn.addEventListener('click', addManualPlayer);
  dom.manualPlayerInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addManualPlayer(); });

  // Config
  dom.userName.addEventListener('input', () => { state.userName = dom.userName.value; saveToStorage(); renderExport(); });
  dom.teamName.addEventListener('input', () => { state.teamName = dom.teamName.value; saveToStorage(); renderExport(); });
  dom.impactCount.addEventListener('change', () => {
    state.maxImpact = parseInt(dom.impactCount.value);
    dom.maxImpact.textContent = state.maxImpact;
    saveToStorage(); render();
  });

  // Search
  dom.searchPool.addEventListener('input', renderPool);

  // Export
  dom.copyBtn.addEventListener('click', copyExport);
  dom.downloadBtn.addEventListener('click', downloadExport);

  // Reset
  dom.resetBtn.addEventListener('click', () => {
    if (confirm('Reset everything? This will clear all players and selections.')) {
      state.images = [];
      state.players = [];
      state.userName = '';
      state.teamName = '';
      state.maxImpact = 3;
      dom.userName.value = '';
      dom.teamName.value = '';
      dom.impactCount.value = '3';
      dom.imagePreviews.innerHTML = '';
      dom.extractBtn.style.display = 'none';
      localStorage.removeItem('cricplay_state');
      render();
      toast('All data cleared', 'info');
    }
  });
}

// ---------- FILE HANDLING ----------
function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = (e) => {
      state.images.push(e.target.result);
      renderPreviews();
      dom.extractBtn.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }
}

function renderPreviews() {
  dom.imagePreviews.innerHTML = '';
  state.images.forEach((src, i) => {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.innerHTML = `
      <img src="${src}" alt="Squad image ${i + 1}" />
      <button class="remove-preview" data-index="${i}">×</button>
    `;
    card.querySelector('.remove-preview').addEventListener('click', () => {
      state.images.splice(i, 1);
      renderPreviews();
      if (state.images.length === 0) dom.extractBtn.style.display = 'none';
    });
    dom.imagePreviews.appendChild(card);
  });
}

// ---------- OCR EXTRACTION ----------
async function extractPlayers() {
  if (state.images.length === 0) return toast('Please upload at least one image', 'error');

  dom.extractBtn.disabled = true;
  dom.extractBtn.textContent = 'Extracting...';
  dom.ocrProgress.style.display = 'block';
  dom.progressFill.style.width = '0%';

  const allNames = [];

  try {
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          dom.progressFill.style.width = pct + '%';
          dom.progressText.textContent = `Recognizing text... ${pct}%`;
        }
      }
    });

    for (let i = 0; i < state.images.length; i++) {
      dom.progressText.textContent = `Processing image ${i + 1} of ${state.images.length}...`;
      const result = await worker.recognize(state.images[i]);
      const text = result.data.text;
      const parsed = parsePlayerNames(text);
      allNames.push(...parsed.names);
      
      // Update team name if found and not manually set
      if (parsed.teamName && !state.teamName) {
        state.teamName = parsed.teamName;
        dom.teamName.value = parsed.teamName;
      }
    }

    await worker.terminate();

    // Dedupe and add
    const existing = new Set(state.players.map(p => p.name.toLowerCase()));
    let addedCount = 0;
    allNames.forEach(name => {
      if (!existing.has(name.toLowerCase())) {
        existing.add(name.toLowerCase());
        state.players.push({ id: genId(), name, status: 'available', order: null, role: null });
        addedCount++;
      }
    });

    saveToStorage();
    render();
    toast(`Extracted ${addedCount} player(s) from ${state.images.length} image(s)`, 'success');

  } catch (err) {
    console.error('OCR Error:', err);
    toast('OCR failed. Try adding players manually.', 'error');
  } finally {
    dom.extractBtn.disabled = false;
    dom.extractBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      Extract Players from Image
    `;
    dom.ocrProgress.style.display = 'none';
  }
}

function parsePlayerNames(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const names = [];
  let foundTeamName = null;
  
  const iplTeams = [
    "Chennai Super Kings",
    "Royal Challengers Bengaluru",
    "Royal Challengers Bangalore",
    "Mumbai Indians",
    "Kolkata Knight Riders",
    "Rajasthan Royals",
    "Sunrisers Hyderabad",
    "Delhi Capitals",
    "Punjab Kings",
    "Gujarat Titans",
    "Lucknow Super Giants"
  ];

  // Patterns to skip completely
  const skipPatterns = [
    /^(bought|players?|overseas|spent|remaining|ipl|auction|squad|play\s*now|cr$|l$)/i,
    /playauctiongame/i,
    /^\d+(\.\d+)?\s*(cr|l|ccr)$/i,
    /^(os|0s|[0-9]+)$/i,
    /^\d+$/,
    /^[^a-zA-Z]*$/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try to extract team name by matching with known IPL teams
    if (!foundTeamName) {
      const matchedTeam = iplTeams.find(team => 
        line.toLowerCase().replace(/[^a-z]/g, '').includes(team.toLowerCase().replace(/[^a-z]/g, ''))
      );
      if (matchedTeam) {
        foundTeamName = matchedTeam === "Royal Challengers Bangalore" ? "Royal Challengers Bengaluru" : matchedTeam;
      }
    }

    // Skip if original line matches skip patterns or contains an IPL team name
    if (skipPatterns.some(p => p.test(line))) continue;
    if (iplTeams.some(team => line.toLowerCase().replace(/[^a-z]/g, '').includes(team.toLowerCase().replace(/[^a-z]/g, '')))) continue;

    // Clean the line: remove price info, OS tags, and numbers
    let cleaned = line
      .replace(/\d+(\.\d+)?\s*(cr|Cr| CR|ccr|l|L)\s*$/i, '')  // remove prices with variations
      .replace(/(?:\.\s*)?(?:cr|ccr|l|o|ol)$/i, '')          // remove stray .cr, o, ol at the end
      .replace(/\b(os|OS|0s|Os|O|Ol)\b/g, '')                // remove OS tags and stray chars
      .replace(/\d+/g, '')                                   // remove all numbers to clear noise
      .replace(/\|/g, '')                                    // OCR artifacts
      .replace(/[^\w\s.'-]/g, '')                           // keep only name chars
      .trim();

    if (cleaned.length < 3) continue;
    if (cleaned.split(/\s+/).length > 5) continue;

    // Capitalize properly
    cleaned = cleaned.split(/\s+/)
      .filter(w => w.length > 0)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

    if (cleaned.length >= 3) names.push(cleaned);
  }

  return { names, teamName: foundTeamName };
}

// ---------- MANUAL ADD ----------
function addManualPlayer() {
  const name = dom.manualPlayerInput.value.trim();
  if (!name) return;
  if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    return toast('Player already exists', 'error');
  }
  state.players.push({ id: genId(), name, status: 'available', order: null, role: null });
  dom.manualPlayerInput.value = '';
  saveToStorage();
  render();
  toast(`Added ${name}`, 'success');
}

// ---------- PLAYER ACTIONS ----------
function addToXI(id) {
  const xiCount = state.players.filter(p => p.status === 'xi').length;
  if (xiCount >= 11) return toast('Playing XI is full (11/11)', 'error');
  const player = state.players.find(p => p.id === id);
  if (!player) return;
  player.status = 'xi';
  player.order = xiCount + 1;
  saveToStorage(); render();
}

function addToImpact(id) {
  const impCount = state.players.filter(p => p.status === 'impact').length;
  if (impCount >= state.maxImpact) return toast(`Impact subs full (${state.maxImpact}/${state.maxImpact})`, 'error');
  const player = state.players.find(p => p.id === id);
  if (!player) return;
  player.status = 'impact';
  player.order = impCount + 1;
  player.role = 'batting';
  saveToStorage(); render();
}

function removeFromSelection(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return;
  player.status = 'available';
  player.order = null;
  player.role = null;
  // Reorder remaining
  reorderGroup('xi');
  reorderGroup('impact');
  saveToStorage(); render();
}

function removePlayer(id) {
  state.players = state.players.filter(p => p.id !== id);
  reorderGroup('xi');
  reorderGroup('impact');
  saveToStorage(); render();
}

function cycleRole(id) {
  const player = state.players.find(p => p.id === id);
  if (!player) return;
  const roles = ['batting', 'bowling', 'allrounder', 'finisher', 'pacer'];
  const idx = roles.indexOf(player.role || 'batting');
  player.role = roles[(idx + 1) % roles.length];
  saveToStorage(); render();
}

function reorderGroup(status) {
  const group = state.players.filter(p => p.status === status).sort((a, b) => (a.order || 0) - (b.order || 0));
  group.forEach((p, i) => p.order = i + 1);
}

// ---------- DRAG & DROP (Playing XI / Impact reorder) ----------
let draggedSlot = null;
let dragGroup = null;

function handleDragStart(e, id, group) {
  draggedSlot = id;
  dragGroup = group;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  $$('.lineup-slot').forEach(s => s.classList.remove('drag-over'));
  draggedSlot = null;
  dragGroup = null;
}

function handleSlotDragOver(e) {
  e.preventDefault();
  e.target.closest('.lineup-slot')?.classList.add('drag-over');
}

function handleSlotDragLeave(e) {
  e.target.closest('.lineup-slot')?.classList.remove('drag-over');
}

function handleSlotDrop(e, targetId, group) {
  e.preventDefault();
  $$('.lineup-slot').forEach(s => s.classList.remove('drag-over'));
  if (!draggedSlot || dragGroup !== group || draggedSlot === targetId) return;

  const players = state.players.filter(p => p.status === group).sort((a, b) => a.order - b.order);
  const dragIdx = players.findIndex(p => p.id === draggedSlot);
  const dropIdx = players.findIndex(p => p.id === targetId);
  if (dragIdx < 0 || dropIdx < 0) return;

  const [moved] = players.splice(dragIdx, 1);
  players.splice(dropIdx, 0, moved);
  players.forEach((p, i) => p.order = i + 1);

  saveToStorage(); render();
}

// ---------- RENDERING ----------
function render() {
  const hasPlayers = state.players.length > 0;
  dom.squadSection.style.display = hasPlayers ? 'block' : 'none';
  dom.buildSection.style.display = hasPlayers ? 'block' : 'none';
  dom.exportSection.style.display = hasPlayers ? 'block' : 'none';

  renderStats();
  renderPool();
  renderPlayingXI();
  renderImpact();
  renderExport();
}

function renderStats() {
  const xi = state.players.filter(p => p.status === 'xi').length;
  const impact = state.players.filter(p => p.status === 'impact').length;
  const avail = state.players.filter(p => p.status === 'available').length;
  dom.totalPlayers.textContent = state.players.length;
  dom.selectedCount.textContent = xi;
  dom.impactSelectedCount.textContent = impact;
  dom.availableCount.textContent = avail;
  dom.xiCount.textContent = xi;
  dom.impactCount2.textContent = impact;
  dom.maxImpact.textContent = state.maxImpact;
}

function renderPool() {
  const search = (dom.searchPool?.value || '').toLowerCase();
  dom.playerPool.innerHTML = '';

  const filtered = state.players.filter(p => p.name.toLowerCase().includes(search));

  if (filtered.length === 0) {
    dom.playerPool.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);grid-column:1/-1;">No players found</div>';
    return;
  }

  filtered.forEach(player => {
    const chip = document.createElement('div');
    chip.className = `player-chip ${player.status === 'xi' ? 'selected-xi' : ''} ${player.status === 'impact' ? 'selected-impact' : ''}`;

    let statusHTML = '';
    if (player.status === 'xi') statusHTML = '<span class="status-badge xi-badge">XI</span>';
    else if (player.status === 'impact') statusHTML = '<span class="status-badge impact-badge">IMP</span>';

    let actionsHTML = '';
    if (player.status === 'available') {
      actionsHTML = `
        <button class="chip-btn xi-btn" title="Add to Playing XI">XI</button>
        <button class="chip-btn impact-btn" title="Add to Impact Subs">I</button>
        <button class="chip-btn remove-btn" title="Delete player">×</button>
      `;
    } else {
      actionsHTML = `
        <button class="chip-btn remove-btn" title="Remove from selection">↩</button>
      `;
    }

    chip.innerHTML = `
      <span class="player-name">${player.name}</span>
      ${statusHTML}
      <div class="chip-actions">${actionsHTML}</div>
    `;

    // Bind actions
    if (player.status === 'available') {
      chip.querySelector('.xi-btn').addEventListener('click', (e) => { e.stopPropagation(); addToXI(player.id); });
      chip.querySelector('.impact-btn').addEventListener('click', (e) => { e.stopPropagation(); addToImpact(player.id); });
      chip.querySelector('.remove-btn').addEventListener('click', (e) => { e.stopPropagation(); removePlayer(player.id); });
    } else {
      chip.querySelector('.remove-btn').addEventListener('click', (e) => { e.stopPropagation(); removeFromSelection(player.id); });
    }

    dom.playerPool.appendChild(chip);
  });
}

function renderPlayingXI() {
  dom.playingXISlots.innerHTML = '';
  const xiPlayers = state.players.filter(p => p.status === 'xi').sort((a, b) => a.order - b.order);

  for (let i = 0; i < 11; i++) {
    const slot = document.createElement('div');
    const player = xiPlayers[i];

    if (player) {
      slot.className = 'lineup-slot filled';
      slot.draggable = true;
      slot.innerHTML = `
        <span class="slot-number">${i + 1}</span>
        <span class="slot-player-name">${player.name}</span>
        <button class="slot-remove" title="Remove">×</button>
      `;
      slot.addEventListener('dragstart', (e) => handleDragStart(e, player.id, 'xi'));
      slot.addEventListener('dragend', handleDragEnd);
      slot.addEventListener('dragover', handleSlotDragOver);
      slot.addEventListener('dragleave', handleSlotDragLeave);
      slot.addEventListener('drop', (e) => handleSlotDrop(e, player.id, 'xi'));
      slot.querySelector('.slot-remove').addEventListener('click', () => removeFromSelection(player.id));
    } else {
      slot.className = 'lineup-slot empty';
      slot.innerHTML = `
        <span class="slot-number">${i + 1}</span>
        <span class="slot-empty-text">Select from pool above</span>
      `;
    }
    dom.playingXISlots.appendChild(slot);
  }
}

function renderImpact() {
  dom.impactSlots.innerHTML = '';
  const impPlayers = state.players.filter(p => p.status === 'impact').sort((a, b) => a.order - b.order);

  for (let i = 0; i < state.maxImpact; i++) {
    const slot = document.createElement('div');
    const player = impPlayers[i];

    if (player) {
      const roleClass = player.role || 'batting';
      const roleLabel = (player.role || 'batting').charAt(0).toUpperCase() + (player.role || 'batting').slice(1);
      slot.className = 'lineup-slot filled';
      slot.draggable = true;
      slot.innerHTML = `
        <span class="slot-number">${i + 1}</span>
        <span class="slot-player-name">${player.name}</span>
        <button class="slot-role ${roleClass}" title="Click to change role">${roleLabel}</button>
        <button class="slot-remove" title="Remove">×</button>
      `;
      slot.addEventListener('dragstart', (e) => handleDragStart(e, player.id, 'impact'));
      slot.addEventListener('dragend', handleDragEnd);
      slot.addEventListener('dragover', handleSlotDragOver);
      slot.addEventListener('dragleave', handleSlotDragLeave);
      slot.addEventListener('drop', (e) => handleSlotDrop(e, player.id, 'impact'));
      slot.querySelector('.slot-role').addEventListener('click', () => cycleRole(player.id));
      slot.querySelector('.slot-remove').addEventListener('click', () => removeFromSelection(player.id));
    } else {
      slot.className = 'lineup-slot empty';
      slot.innerHTML = `
        <span class="slot-number">${i + 1}</span>
        <span class="slot-empty-text">Select impact sub</span>
      `;
    }
    dom.impactSlots.appendChild(slot);
  }
}

function renderExport() {
  const xi = state.players.filter(p => p.status === 'xi').sort((a, b) => a.order - b.order);
  const impact = state.players.filter(p => p.status === 'impact').sort((a, b) => a.order - b.order);

  const name = state.userName || 'Player';
  const team = state.teamName || 'Team';

  let text = '';
  text += `## ${name}'s Playing XI (${team}):\n\n`;

  if (xi.length > 0) {
    xi.forEach((p, i) => {
      text += ` ${(i + 1).toString().padStart(2, ' ')}. ${p.name}\n`;
    });
  } else {
    text += ' (No players selected yet)\n';
  }

  if (impact.length > 0) {
    text += `\n*Impact Subs:* `;
    const parts = impact.map(p => {
      const role = (p.role || 'batting').charAt(0).toUpperCase() + (p.role || 'batting').slice(1);
      return `${p.name} (${role})`;
    });
    text += parts.join(', ');
    text += '\n';
  }

  dom.exportPreview.textContent = text;
}

// ---------- EXPORT ACTIONS ----------
function copyExport() {
  const text = dom.exportPreview.textContent;
  navigator.clipboard.writeText(text).then(() => {
    toast('Copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied to clipboard!', 'success');
  });
}

function downloadExport() {
  const text = dom.exportPreview.textContent;
  const team = state.teamName || 'lineup';
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${team.replace(/\s+/g, '_')}_Playing_XI.txt`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Downloaded!', 'success');
}

// ---------- PERSISTENCE ----------
function saveToStorage() {
  const data = {
    players: state.players,
    userName: state.userName,
    teamName: state.teamName,
    maxImpact: state.maxImpact,
  };
  localStorage.setItem('cricplay_state', JSON.stringify(data));
}

function loadFromStorage() {
  try {
    const data = JSON.parse(localStorage.getItem('cricplay_state'));
    if (data) {
      state.players = data.players || [];
      state.userName = data.userName || '';
      state.teamName = data.teamName || '';
      state.maxImpact = data.maxImpact || 3;
      dom.userName.value = state.userName;
      dom.teamName.value = state.teamName;
      dom.impactCount.value = state.maxImpact;
      dom.maxImpact.textContent = state.maxImpact;
    }
  } catch (e) { /* ignore */ }
}

// ---------- UTILITIES ----------
function genId() { return '_' + Math.random().toString(36).slice(2, 10); }

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  t.innerHTML = `<span>${icons[type] || ''}</span> ${msg}`;
  dom.toastContainer.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut 0.3s ease-out forwards';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ---------- BOOT ----------
document.addEventListener('DOMContentLoaded', init);
