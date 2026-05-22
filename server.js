const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
// GoogleGenAI import removed for offline simulation

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 50e6 });

// ─── IPL Team Data ───
const IPL_TEAMS = {
  'Chennai Super Kings':          { short: 'CSK', ground: 'M.A. Chidambaram Stadium, Chennai', color: '#f9cd05' },
  'Royal Challengers Bengaluru':  { short: 'RCB', ground: 'M. Chinnaswamy Stadium, Bengaluru', color: '#d4213d' },
  'Mumbai Indians':               { short: 'MI',  ground: 'Wankhede Stadium, Mumbai', color: '#004ba0' },
  'Kolkata Knight Riders':        { short: 'KKR', ground: 'Eden Gardens, Kolkata', color: '#3a225d' },
  'Rajasthan Royals':             { short: 'RR',  ground: 'Sawai Mansingh Stadium, Jaipur', color: '#ea1a85' },
  'Sunrisers Hyderabad':          { short: 'SRH', ground: 'Rajiv Gandhi Intl Stadium, Hyderabad', color: '#f26522' },
  'Delhi Capitals':               { short: 'DC',  ground: 'Arun Jaitley Stadium, Delhi', color: '#17479e' },
  'Punjab Kings':                 { short: 'PBKS', ground: 'IS Bindra Stadium, Mohali', color: '#dd1f2d' },
  'Gujarat Titans':               { short: 'GT',  ground: 'Narendra Modi Stadium, Ahmedabad', color: '#1c1c2b' },
  'Lucknow Super Giants':         { short: 'LSG', ground: 'BRSABV Ekana Stadium, Lucknow', color: '#0057e7' },
};

// ─── Rooms Store ───
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return rooms[c] ? genCode() : c;
}

// ─── Schedule Generator ───
function generateSchedule(teamNames) {
  const matches = [];
  let matchNum = 1;
  // Round-robin: each pair plays twice (home & away)
  for (let i = 0; i < teamNames.length; i++) {
    for (let j = i + 1; j < teamNames.length; j++) {
      const tA = teamNames[i], tB = teamNames[j];
      const gA = IPL_TEAMS[tA]?.ground || 'Neutral Venue';
      const gB = IPL_TEAMS[tB]?.ground || 'Neutral Venue';
      matches.push({ num: matchNum++, teamA: tA, teamB: tB, ground: gA, phase: 'league' });
      matches.push({ num: matchNum++, teamA: tB, teamB: tA, ground: gB, phase: 'league' });
    }
  }
  // Shuffle league matches for variety
  for (let i = matches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matches[i], matches[j]] = [matches[j], matches[i]];
    matches[i].num = i + 1;
    matches[j].num = matches.indexOf(matches[j]) + 1;
  }
  matches.forEach((m, i) => m.num = i + 1);
  return matches;
}

function getDecimalOvers(oversCount) {
  const completedOvers = Math.floor(oversCount);
  const remainingBalls = Math.round((oversCount - completedOvers) * 10);
  return completedOvers + (remainingBalls / 6);
}

function initPointsTable(teamNames) {
  const table = {};
  teamNames.forEach(t => {
    table[t] = { played: 0, won: 0, lost: 0, nr: 0, pts: 0, nrr: 0, forRuns: 0, forOversDecimal: 0, againstRuns: 0, againstOversDecimal: 0 };
  });
  return table;
}

function updatePointsTable(table, winner, loser, winScore, loseScore) {
  if (!table[winner] || !table[loser]) return;
  table[winner].played++; table[winner].won++; table[winner].pts += 2;
  table[loser].played++; table[loser].lost++;
  
  // NRR logic: if a team is all out, count full 20 overs.
  const winOversCounted = winScore.allOut ? 20 : winScore.overs;
  const loseOversCounted = loseScore.allOut ? 20 : loseScore.overs;

  table[winner].forRuns += winScore.runs;
  table[winner].forOversDecimal += getDecimalOvers(winOversCounted);
  
  table[winner].againstRuns += loseScore.runs;
  table[winner].againstOversDecimal += getDecimalOvers(loseOversCounted);
  
  table[loser].forRuns += loseScore.runs;
  table[loser].forOversDecimal += getDecimalOvers(loseOversCounted);
  
  table[loser].againstRuns += winScore.runs;
  table[loser].againstOversDecimal += getDecimalOvers(winOversCounted);

  // Recalculate NRR for both
  [winner, loser].forEach(t => {
    if (table[t].forOversDecimal > 0 && table[t].againstOversDecimal > 0) {
      table[t].nrr = (table[t].forRuns / table[t].forOversDecimal) - (table[t].againstRuns / table[t].againstOversDecimal);
    }
  });
}

function getSortedTable(table) {
  return Object.entries(table)
    .map(([team, s]) => ({ team, ...s }))
    .sort((a, b) => b.pts - a.pts || b.nrr - a.nrr);
}

// ─── Procedural Player Stats Generator ───
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getPlayerStats(name, index) {
  const seed = (hashCode(name) % 1000) / 1000;
  if (index < 5) {
    return {
      name,
      battingRating: Math.floor(80 + seed * 16),
      bowlingRating: Math.floor(10 + seed * 15),
      role: 'Batsman',
      bowlingStyle: 'None'
    };
  } else if (index === 5 || index === 6) {
    return {
      name,
      battingRating: Math.floor(70 + seed * 15),
      bowlingRating: Math.floor(70 + seed * 15),
      role: 'Allrounder',
      bowlingStyle: seed > 0.5 ? 'Spinner' : 'Pacer'
    };
  } else {
    return {
      name,
      battingRating: Math.floor(15 + seed * 25),
      bowlingRating: Math.floor(80 + seed * 18),
      role: 'Bowler',
      bowlingStyle: seed > 0.5 ? 'Spinner' : 'Pacer'
    };
  }
}

// ─── Pitch Type Modifiers ───
function getPitchType(ground) {
  const g = (ground || '').toLowerCase();
  if (g.includes('chinnaswamy') || g.includes('wankhede') || g.includes('rajiv gandhi') || g.includes('hyderabad')) {
    return 'flat';
  } else if (g.includes('chidambaram') || g.includes('chennai') || g.includes('ekana') || g.includes('lucknow')) {
    return 'slow';
  } else if (g.includes('bindra') || g.includes('mohali') || g.includes('eden') || g.includes('kolkata')) {
    return 'fast';
  }
  return 'balanced';
}

// ─── Ball Outcome Probabilities ───
function calculateBallProbabilities(striker, bowler, pitch, overNum, target, currentRuns) {
  let wDot = 26;
  let w1 = 36;
  let w2 = 8;
  let w4 = 14;
  let w6 = 6;
  let wW = 4.2; // Base wicket probability (was 10)
  
  const batBonus = (striker.battingRating - 80) / 10;
  const bowlBonus = (bowler.bowlingRating - 80) / 10;
  
  w6 += (batBonus * 1.5) - (bowlBonus * 0.8);
  w4 += (batBonus * 2.0) - (bowlBonus * 1.0);
  w1 += (batBonus * 0.5);
  wW += (bowlBonus * 0.6) - (batBonus * 0.4);
  wDot += (bowlBonus * 1.0) - (batBonus * 0.8);
  
  if (pitch === 'flat') {
    w6 *= 1.25;
    w4 *= 1.15;
    wW *= 0.85;
  } else if (pitch === 'slow') {
    wDot *= 1.2;
    w1 *= 1.05;
    w6 *= 0.7;
    wW *= 1.15;
  } else if (pitch === 'fast') {
    wW *= 1.1;
    wDot *= 1.05;
    w4 *= 1.05;
  }
  
  if (overNum <= 6) {
    w4 *= 1.2;
    w6 *= 1.1;
    wDot *= 0.95;
    wW *= 0.95;
  } else if (overNum >= 16) {
    w6 *= 1.5;
    w4 *= 1.2;
    wW *= 1.35;
    wDot *= 0.85;
  } else {
    w1 *= 1.1;
    w2 *= 1.1;
    wDot *= 1.05;
    w6 *= 0.8;
    wW *= 0.85;
  }
  
  if (target) {
    const runsNeeded = target - currentRuns;
    const oversLeft = 20 - overNum + 1;
    const ballsRemaining = oversLeft * 6;
    if (ballsRemaining > 0) {
      const rrr = (runsNeeded / ballsRemaining) * 6;
      if (rrr > 12) {
        w6 *= 1.4;
        w4 *= 1.15;
        wW *= 1.3;
        wDot *= 0.85;
      } else if (rrr < 6) {
        w1 *= 1.15;
        w2 *= 1.15;
        wDot *= 1.1;
        w6 *= 0.5;
        w4 *= 0.7;
        wW *= 0.65;
      }
    }
  }
  
  wDot = Math.max(0.5, wDot);
  w1 = Math.max(0.5, w1);
  w2 = Math.max(0.5, w2);
  w4 = Math.max(0.5, w4);
  w6 = Math.max(0.5, w6);
  wW = Math.max(0.3, wW);
  
  return { '0': wDot, '1': w1, '2': w2, '4': w4, '6': w6, 'W': wW };
}

function selectOutcome(weights) {
  const entries = Object.entries(weights);
  const sum = entries.reduce((acc, [_, w]) => acc + w, 0);
  let r = Math.random() * sum;
  for (const [outcome, weight] of entries) {
    r -= weight;
    if (r <= 0) return outcome;
  }
  return '0';
}

function selectDismissalType(style) {
  const r = Math.random();
  if (style === 'Spinner') {
    if (r < 0.55) return 'caught';
    if (r < 0.75) return 'bowled';
    if (r < 0.90) return 'lbw';
    if (r < 0.96) return 'caught behind';
    return 'run out';
  } else {
    if (r < 0.50) return 'caught';
    if (r < 0.72) return 'bowled';
    if (r < 0.85) return 'caught behind';
    if (r < 0.95) return 'lbw';
    return 'run out';
  }
}

function selectFielder(bowlingPlayers, bowlerName) {
  const candidates = bowlingPlayers.filter(p => p.name !== bowlerName);
  if (candidates.length === 0) return 'fielder';
  return candidates[Math.floor(Math.random() * candidates.length)].name;
}

function calculateWinProbability(inningsNum, target, runs, wickets, overNum, runsThisOver) {
  if (inningsNum === 1) {
    const parScore = 170;
    const crr = overNum > 0 ? (runs / overNum) : 8.5;
    const wicketsLeft = 10 - wickets;
    const projected = runs + (20 - overNum) * 8.5 * (wicketsLeft / 10);
    
    let battingProb = 50 + (projected - parScore) * 0.35 - (wickets * 2.5);
    battingProb = Math.max(5, Math.min(95, battingProb));
    return { batting: battingProb, bowling: 100 - battingProb };
  } else {
    const runsNeeded = target - runs;
    if (runsNeeded <= 0) return { batting: 100, bowling: 0 };
    
    const oversLeft = 20 - overNum;
    if (oversLeft === 0) {
      return runs >= target ? { batting: 100, bowling: 0 } : { batting: 0, bowling: 100 };
    }
    
    const rrr = runsNeeded / oversLeft;
    const wicketsLeft = 10 - wickets;
    if (wicketsLeft === 0) return { batting: 0, bowling: 100 };
    
    let battingProb = 50 - (rrr - 8.5) * 12.5 + (wicketsLeft - 5) * 7.5;
    if (overNum >= 17) {
      battingProb = 50 - (rrr - 8.5) * 18 + (wicketsLeft - 3) * 15;
    }
    
    battingProb = Math.max(1, Math.min(99, battingProb));
    return { batting: battingProb, bowling: 100 - battingProb };
  }
}

function generateOverCommentary(battingTeam, bowlingTeam, bowler, batter, balls, runsThisOver, wickets, wicketDesc, overNum) {
  const wicketFall = balls.includes('W');
  
  const wicketTemplates = [
    `Drama here! ${bowler} breaks the partnership, sending the batter back. ${wicketDesc}`,
    `A crucial breakthrough for ${bowlingTeam}! ${bowler} strikes and sets the stadium alight! ${wicketDesc}`,
    `Huge wicket! ${wicketDesc} ${bowlingTeam} players swarm ${bowler} in celebration.`,
    `Outstanding bowling! ${wicketDesc} The batting side is under real pressure now.`
  ];
  
  const bigOverTemplates = [
    `What an expensive over for ${bowlingTeam}! ${batter} targets ${bowler} and hits multiple boundaries. ${runsThisOver} runs off it.`,
    `Massive over! The batsmen are in full flow here, dealing in boundaries off ${bowler}. ${runsThisOver} runs added.`,
    `Clean hitting! ${battingTeam} asserts dominance, taking ${runsThisOver} runs off ${bowler}'s over.`,
    `Expensive from ${bowler}. Short balls punished and boundaries flowing easily. ${runsThisOver} runs.`
  ];
  
  const tidyTemplates = [
    `Superb over from ${bowler}. Giving away just ${runsThisOver} runs, building massive pressure on ${battingTeam}.`,
    `Extremely tight bowling by ${bowler}. The batsmen struggle to find gaps. A very tidy over.`,
    `Excellent variations by ${bowler}. ${battingTeam} could only manage ${runsThisOver} runs from this over.`,
    `A maiden or near-maiden over. ${bowler} completely dominated the batters.`
  ];
  
  const standardTemplates = [
    `A steady over for both sides. Strike rotated well. ${runsThisOver} runs off it.`,
    `${bowler} bowls a decent line, keeping the scoring rate stable. ${runsThisOver} runs added to the total.`,
    `Overs are ticking away. ${battingTeam} scores ${runsThisOver} runs here as they build towards the end.`,
    `A balanced over. A few singles and a double. ${runsThisOver} runs off ${bowler}.`
  ];
  
  let pool = standardTemplates;
  if (wicketFall) {
    pool = wicketTemplates;
  } else if (runsThisOver >= 12) {
    pool = bigOverTemplates;
  } else if (runsThisOver <= 4) {
    pool = tidyTemplates;
  }
  
  return pool[Math.floor(Math.random() * pool.length)];
}

function runCricketSimulation(room, battingTeam, bowlingTeam, ground, target) {
  const battingInfo = room.players[room.teamOwners[battingTeam]];
  const bowlingInfo = room.players[room.teamOwners[bowlingTeam]];
  if (!battingInfo || !bowlingInfo) return [];
  
  const battingXI = battingInfo.xi;
  const bowlingXI = bowlingInfo.xi;
  
  const battingPlayers = battingXI.map((name, i) => getPlayerStats(name, i));
  const bowlingPlayers = bowlingXI.map((name, i) => getPlayerStats(name, i));
  
  const pitch = getPitchType(ground);
  
  let runs = 0;
  let wickets = 0;
  let strikerIdx = 0;
  let nonStrikerIdx = 1;
  let nextBatterIdx = 2;
  
  const oversData = [];
  
  const bowlersList = bowlingPlayers.slice(5); // indices 5 to 10
  const oversBowledByPlayer = {};
  bowlersList.forEach(b => { oversBowledByPlayer[b.name] = 0; });
  let lastBowlerName = '';
  
  function selectBowler(overNum) {
    const available = bowlersList.filter(b => oversBowledByPlayer[b.name] < 4 && b.name !== lastBowlerName);
    if (available.length === 0) {
      return bowlersList.filter(b => b.name !== lastBowlerName)[0] || bowlersList[0];
    }
    
    if (overNum <= 6) {
      const strike = available.filter(b => b.name === bowlersList[5]?.name || b.name === bowlersList[4]?.name);
      if (strike.length > 0) return strike[Math.floor(Math.random() * strike.length)];
    } else if (overNum >= 16) {
      const strike = available.filter(b => b.name === bowlersList[5]?.name || b.name === bowlersList[4]?.name);
      if (strike.length > 0) return strike[Math.floor(Math.random() * strike.length)];
    } else {
      const spinners = available.filter(b => b.name === bowlersList[0]?.name || b.name === bowlersList[1]?.name || b.name === bowlersList[2]?.name || b.name === bowlersList[3]?.name);
      if (spinners.length > 0) return spinners[Math.floor(Math.random() * spinners.length)];
    }
    
    available.sort((a, b) => oversBowledByPlayer[a.name] - oversBowledByPlayer[b.name]);
    return available[0];
  }
  
  for (let overNum = 1; overNum <= 20; overNum++) {
    if (wickets >= 10) break;
    if (target && runs >= target) break;
    
    const currentBowler = selectBowler(overNum);
    oversBowledByPlayer[currentBowler.name]++;
    lastBowlerName = currentBowler.name;
    
    const overBalls = [];
    let runsThisOver = 0;
    let wicketDescThisOver = '';
    
    for (let ballNum = 1; ballNum <= 6; ballNum++) {
      if (wickets >= 10) break;
      if (target && runs >= target) break;
      
      const striker = battingPlayers[strikerIdx];
      const outcome = selectOutcome(calculateBallProbabilities(striker, currentBowler, pitch, overNum, target, runs));
      
      overBalls.push(outcome);
      
      if (outcome === 'W') {
        wickets++;
        const style = currentBowler.bowlingStyle;
        const dismissal = selectDismissalType(style);
        const fielder = selectFielder(bowlingPlayers, currentBowler.name);
        
        if (dismissal === 'bowled') wicketDescThisOver = `${striker.name} clean bowled by ${currentBowler.name}!`;
        else if (dismissal === 'lbw') wicketDescThisOver = `${striker.name} lbw b ${currentBowler.name}!`;
        else if (dismissal === 'caught') wicketDescThisOver = `${striker.name} caught by ${fielder} off ${currentBowler.name}!`;
        else if (dismissal === 'caught behind') wicketDescThisOver = `${striker.name} caught behind off ${currentBowler.name}!`;
        else wicketDescThisOver = `${striker.name} run out (${fielder})!`;
        
        if (wickets < 10) {
          strikerIdx = nextBatterIdx;
          nextBatterIdx++;
        }
      } else {
        const ballRuns = parseInt(outcome);
        runs += ballRuns;
        runsThisOver += ballRuns;
        if (ballRuns === 1 || ballRuns === 3) {
          const temp = strikerIdx;
          strikerIdx = nonStrikerIdx;
          nonStrikerIdx = temp;
        }
      }
    }
    
    if (wickets < 10 && !(target && runs >= target)) {
      const temp = strikerIdx;
      strikerIdx = nonStrikerIdx;
      nonStrikerIdx = temp;
    }
    
    const winProbability = calculateWinProbability(target ? 2 : 1, target, runs, wickets, overNum, runsThisOver);
    const commentary = generateOverCommentary(
      battingTeam, bowlingTeam, currentBowler.name, 
      battingPlayers[strikerIdx]?.name || 'Batter', 
      overBalls, runsThisOver, wickets, wicketDescThisOver, overNum
    );
    
    oversData.push({
      over: overNum,
      bowler: currentBowler.name,
      batter: battingPlayers[strikerIdx]?.name || 'Batter',
      nonStriker: battingPlayers[nonStrikerIdx]?.name || 'Non-Striker',
      balls: overBalls,
      wicketDesc: wicketDescThisOver,
      runsScoredThisOver: runsThisOver,
      totalScore: `${runs}/${wickets}`,
      totalOvers: `${overNum}.0`,
      commentary: commentary,
      winProbability: winProbability
    });
  }
  
  return oversData;
}

// ─── Offline Match Simulation ───
async function simulateInnings(room, battingTeam, bowlingTeam, ground, target, inningsNum, matchContext, startOver, endOver) {
  const match = room.currentMatch;
  if (!match) return null;
  
  let allOversData;
  if (inningsNum === 1) {
    if (!match.innings1Data) {
      match.innings1Data = runCricketSimulation(room, battingTeam, bowlingTeam, ground, null);
    }
    allOversData = match.innings1Data;
  } else {
    if (!match.innings2Data) {
      match.innings2Data = runCricketSimulation(room, battingTeam, bowlingTeam, ground, target);
    }
    allOversData = match.innings2Data;
  }
  
  const sliced = allOversData.filter(o => o.over >= startOver && o.over <= endOver);
  return JSON.stringify(sliced);
}

function parseInningsResult(rawText) {
  try {
    const overs = JSON.parse(rawText);
    const last = overs[overs.length - 1];
    const score = last ? last.totalScore : '0/0';
    const [runs, wickets] = (score || '0/0').split('/').map(Number);
    const oversCount = last ? parseFloat(last.totalOvers) : 0;
    return { overs, runs, wickets, oversCount, score };
  } catch (e) {
    console.error('JSON parsing failed. Raw text:', rawText);
    return { overs: [], runs: 0, wickets: 0, oversCount: 0, score: '0/0' };
  }
}

// ─── Socket.IO Events ───
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // CREATE ROOM
  socket.on('create-room', ({ playerName, geminiKey, teams }) => {
    const code = genCode();
    const teamNames = Object.keys(teams);
    rooms[code] = {
      id: code,
      host: socket.id,
      geminiKey,
      phase: 'lobby',
      teams, // { "Chennai Super Kings": ["Player1", "Player2", ...], ... }
      teamOwners: {}, // { "CSK": socketId }
      players: {
        [socket.id]: { name: playerName, team: null, xi: [], impact: [], ready: false }
      },
      schedule: [],
      currentMatchIdx: 0,
      currentMatch: null,
      pointsTable: initPointsTable(teamNames),
      matchResults: [],
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room-created', { code, teams: teamNames, teamMeta: buildTeamMeta(teamNames) });
    console.log(`Room ${code} created by ${playerName} with ${teamNames.length} teams`);
  });

  // JOIN ROOM
  socket.on('join-room', ({ code, playerName }) => {
    const room = rooms[code?.toUpperCase()];
    if (!room) return socket.emit('error-msg', 'Room not found');
    if (room.phase !== 'lobby') return socket.emit('error-msg', 'Game already in progress');
    const teamNames = Object.keys(room.teams);
    if (Object.keys(room.players).length >= teamNames.length) return socket.emit('error-msg', 'Room is full');

    room.players[socket.id] = { name: playerName, team: null, xi: [], impact: [], ready: false };
    socket.join(code.toUpperCase());
    socket.roomCode = code.toUpperCase();

    socket.emit('room-joined', { code: code.toUpperCase(), teams: teamNames, teamMeta: buildTeamMeta(teamNames) });
    io.to(code.toUpperCase()).emit('players-updated', getPlayersInfo(room));
    console.log(`${playerName} joined room ${code.toUpperCase()}`);
  });

  // START GAME (host only)
  socket.on('start-game', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    if (Object.keys(room.players).length < 2) return socket.emit('error-msg', 'Need at least 2 players');
    room.phase = 'team-select';
    io.to(socket.roomCode).emit('phase-changed', { phase: 'team-select', teams: Object.keys(room.teams), takenTeams: getTakenTeams(room) });
  });

  // SELECT TEAM
  socket.on('select-team', ({ teamName }) => {
    const room = rooms[socket.roomCode];
    if (!room || room.phase !== 'team-select') return;
    // Check if team is already taken
    if (room.teamOwners[teamName]) return socket.emit('error-msg', 'Team already taken');
    // Remove previous selection
    const prev = room.players[socket.id]?.team;
    if (prev) delete room.teamOwners[prev];
    room.players[socket.id].team = teamName;
    room.teamOwners[teamName] = socket.id;
    io.to(socket.roomCode).emit('team-selected', { playerId: socket.id, teamName, takenTeams: getTakenTeams(room) });
  });

  // CONFIRM TEAM → SQUAD BUILD
  socket.on('confirm-teams', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    // Check all players have a team
    const allPicked = Object.values(room.players).every(p => p.team);
    if (!allPicked) return socket.emit('error-msg', 'Not all players have selected a team');
    room.phase = 'squad-build';
    // Send each player their team's player list
    for (const [sid, pdata] of Object.entries(room.players)) {
      const squad = room.teams[pdata.team] || [];
      io.to(sid).emit('phase-squad-build', { teamName: pdata.team, squad });
    }
  });

  // SUBMIT SQUAD
  socket.on('submit-squad', ({ xi, impact }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.players[socket.id].xi = xi;
    room.players[socket.id].impact = impact;
    room.players[socket.id].ready = true;
    io.to(socket.roomCode).emit('players-updated', getPlayersInfo(room));
    // Check if all ready
    const allReady = Object.values(room.players).every(p => p.ready);
    if (allReady) {
      room.phase = 'match-day';
      const activeTeams = Object.values(room.players).map(p => p.team);
      room.schedule = generateSchedule(activeTeams);
      room.pointsTable = initPointsTable(activeTeams);
      room.currentMatchIdx = 0;
      io.to(socket.roomCode).emit('schedule-ready', {
        schedule: room.schedule,
        pointsTable: getSortedTable(room.pointsTable)
      });
      startNextMatch(socket.roomCode);
    }
  });

  // POST-TOSS LINEUP UPDATE
  socket.on('update-lineup', ({ xi, impact }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.players[socket.id].xi = xi;
    if (impact) room.players[socket.id].impact = impact;
    socket.emit('lineup-updated', { xi });
  });

  // CONFIRM POST-TOSS LINEUP
  socket.on('confirm-lineup', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.currentMatch) return;
    const match = room.currentMatch;
    const team = room.players[socket.id]?.team;
    if (team === match.teamA) match.teamAConfirmed = true;
    if (team === match.teamB) match.teamBConfirmed = true;
    if (match.teamAConfirmed && match.teamBConfirmed) {
      startInnings(socket.roomCode, 1);
    }
  });

  // IMPACT SUB ACTIVATION
  socket.on('activate-impact', ({ subIn, subOut }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const pdata = room.players[socket.id];
    if (!pdata) return;
    // Replace subOut with subIn in the XI
    const idx = pdata.xi.indexOf(subOut);
    if (idx >= 0) {
      pdata.xi[idx] = subIn;
      // Remove from impact list
      pdata.impact = pdata.impact.filter(p => p.name !== subIn);
    }
    socket.emit('impact-applied', { xi: pdata.xi });
  });

  // CONFIRM IMPACT (ready for 2nd innings)
  socket.on('confirm-impact', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.currentMatch) return;
    const match = room.currentMatch;
    const team = room.players[socket.id]?.team;
    if (team === match.teamA) match.impactAConfirmed = true;
    if (team === match.teamB) match.impactBConfirmed = true;
    if (match.impactAConfirmed && match.impactBConfirmed) {
      startInnings(socket.roomCode, 2);
    }
  });

  // NEXT MATCH
  socket.on('next-match', () => {
    const room = rooms[socket.roomCode];
    if (!room || room.host !== socket.id) return;
    startNextMatch(socket.roomCode);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) {
      const room = rooms[code];
      const name = room.players[socket.id]?.name || 'Unknown';
      const team = room.players[socket.id]?.team;
      if (team) delete room.teamOwners[team];
      delete room.players[socket.id];
      io.to(code).emit('player-left', { name });
      io.to(code).emit('players-updated', getPlayersInfo(room));
      if (Object.keys(room.players).length === 0) {
        delete rooms[code];
        console.log(`Room ${code} deleted (empty)`);
      }
    }
  });
});

// ─── Match Flow Helpers ───
function startNextMatch(code) {
  const room = rooms[code];
  if (!room) return;
  const match = room.schedule[room.currentMatchIdx];
  if (!match) {
    // Check if we need playoffs
    const sorted = getSortedTable(room.pointsTable);
    if (match === undefined && room.schedule.every(m => m.result)) {
      io.to(code).emit('tournament-complete', { pointsTable: sorted, winner: sorted[0]?.team });
    }
    return;
  }
  // Toss
  const tossWinner = Math.random() > 0.5 ? match.teamA : match.teamB;
  const tossDecision = Math.random() > 0.5 ? 'bat' : 'bowl';
  match.toss = { winner: tossWinner, decision: tossDecision };
  match.battingFirst = tossDecision === 'bat' ? tossWinner : (tossWinner === match.teamA ? match.teamB : match.teamA);
  match.bowlingFirst = match.battingFirst === match.teamA ? match.teamB : match.teamA;
  match.teamAConfirmed = false;
  match.teamBConfirmed = false;
  match.impactAConfirmed = false;
  match.impactBConfirmed = false;
  room.currentMatch = match;

  io.to(code).emit('match-toss', {
    match: { num: match.num, teamA: match.teamA, teamB: match.teamB, ground: match.ground, phase: match.phase },
    toss: match.toss,
    battingFirst: match.battingFirst,
    bowlingFirst: match.bowlingFirst,
    pointsTable: getSortedTable(room.pointsTable),
  });
}

async function startInnings(code, inningsNum) {
  const room = rooms[code];
  if (!room || !room.currentMatch) return;
  const match = room.currentMatch;

  const battingTeam = inningsNum === 1 ? match.battingFirst : match.bowlingFirst;
  const bowlingTeam = inningsNum === 1 ? match.bowlingFirst : match.battingFirst;
  const target = inningsNum === 2 ? (match.innings1Runs + 1) : null;
  
  io.to(code).emit('innings-start', { inningsNum, battingTeam, bowlingTeam, target });

  let allOvers = [];
  let currentScoreStr = '0/0';
  let currentRuns = 0;
  let currentWickets = 0;
  let currentOversCount = 0;

  for (let chunk = 0; chunk < 2; chunk++) {
    const startOver = chunk * 10 + 1;
    const endOver = startOver + 9;
    
    let context = inningsNum === 2 ? `${match.bowlingFirst} scored ${match.innings1Score} in the 1st innings.` : '';
    if (chunk > 0) {
      context += `\nCurrently at the end of over ${startOver-1}, score is ${currentScoreStr}. Continue simulating from over ${startOver}.`;
    }

    const raw = await simulateInnings(room, battingTeam, bowlingTeam, match.ground, target, inningsNum, context, startOver, endOver);

    if (!raw) {
      io.to(code).emit('error-msg', 'Gemini API failed. Check your API key.');
      return;
    }

    const result = parseInningsResult(raw);
    if (!result || result.overs.length === 0) break;

    // Stream overs to clients one by one with delay
    for (let i = 0; i < result.overs.length; i++) {
      io.to(code).emit('over-update', { inningsNum, over: result.overs[i], overIndex: allOvers.length, totalOvers: '20' });
      await sleep(1500); // 1.5s between overs for dramatic effect
      allOvers.push(result.overs[i]);
    }

    currentScoreStr = result.score;
    currentRuns = result.runs;
    currentWickets = result.wickets;
    currentOversCount = result.oversCount;

    if (currentWickets >= 10 || (target && currentRuns >= target)) {
      break;
    }
  }

  if (inningsNum === 1) {
    match.innings1Runs = currentRuns;
    match.innings1Wickets = currentWickets;
    match.innings1Overs = currentOversCount;
    match.innings1Score = currentScoreStr;
    // Innings break - impact sub activation
    io.to(code).emit('innings-break', {
      inningsNum: 1,
      score: currentScoreStr,
      battingTeam,
      bowlingTeam,
    });
  } else {
    match.innings2Runs = currentRuns;
    match.innings2Wickets = currentWickets;
    match.innings2Overs = currentOversCount;
    match.innings2Score = currentScoreStr;
    // Determine winner
    let winner, loser, resultText;
    if (currentRuns >= match.innings1Runs + 1) {
      winner = battingTeam;
      loser = bowlingTeam;
      resultText = `${winner} won by ${10 - currentWickets} wickets`;
    } else if (currentRuns < match.innings1Runs) {
      winner = bowlingTeam;
      loser = battingTeam;
      resultText = `${winner} won by ${match.innings1Runs - currentRuns} runs`;
    } else {
      // Tie - for simplicity, random super over winner
      winner = Math.random() > 0.5 ? battingTeam : bowlingTeam;
      loser = winner === battingTeam ? bowlingTeam : battingTeam;
      resultText = `Match tied! ${winner} won in Super Over`;
    }
    match.result = resultText;
    match.winner = winner;
    updatePointsTable(room.pointsTable, winner, loser,
      { 
        runs: winner === match.battingFirst ? match.innings1Runs : currentRuns, 
        overs: winner === match.battingFirst ? match.innings1Overs : currentOversCount,
        allOut: winner === match.battingFirst ? (match.innings1Wickets >= 10) : (currentWickets >= 10)
      },
      { 
        runs: loser === match.battingFirst ? match.innings1Runs : currentRuns, 
        overs: loser === match.battingFirst ? match.innings1Overs : currentOversCount,
        allOut: loser === match.battingFirst ? (match.innings1Wickets >= 10) : (currentWickets >= 10)
      }
    );
    room.currentMatchIdx++;
    room.matchResults.push({ num: match.num, teamA: match.teamA, teamB: match.teamB, result: resultText, winner });

    io.to(code).emit('match-result', {
      result: resultText,
      winner,
      innings1: { team: match.battingFirst, score: match.innings1Score },
      innings2: { team: battingTeam, score: currentScoreStr },
      pointsTable: getSortedTable(room.pointsTable),
      matchResults: room.matchResults,
      hasNextMatch: room.currentMatchIdx < room.schedule.length,
    });
  }
}

// ─── Utility Helpers ───
function buildTeamMeta(teamNames) {
  const meta = {};
  teamNames.forEach(t => { if (IPL_TEAMS[t]) meta[t] = IPL_TEAMS[t]; });
  return meta;
}

function getPlayersInfo(room) {
  const info = {};
  for (const [sid, p] of Object.entries(room.players)) {
    info[sid] = { name: p.name, team: p.team, ready: p.ready };
  }
  return info;
}

function getTakenTeams(room) {
  const taken = {};
  for (const [team, sid] of Object.entries(room.teamOwners)) {
    taken[team] = room.players[sid]?.name || 'Unknown';
  }
  return taken;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Start Server ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🏏 CricPlay server running on http://localhost:${PORT}`);
});
