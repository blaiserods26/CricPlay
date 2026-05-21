const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');

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

function initPointsTable(teamNames) {
  const table = {};
  teamNames.forEach(t => {
    table[t] = { played: 0, won: 0, lost: 0, nr: 0, pts: 0, nrr: 0, forRuns: 0, forOvers: 0, againstRuns: 0, againstOvers: 0 };
  });
  return table;
}

function updatePointsTable(table, winner, loser, winScore, loseScore) {
  if (!table[winner] || !table[loser]) return;
  table[winner].played++; table[winner].won++; table[winner].pts += 2;
  table[loser].played++; table[loser].lost++;
  // NRR calculation
  table[winner].forRuns += winScore.runs; table[winner].forOvers += winScore.overs;
  table[winner].againstRuns += loseScore.runs; table[winner].againstOvers += loseScore.overs;
  table[loser].forRuns += loseScore.runs; table[loser].forOvers += loseScore.overs;
  table[loser].againstRuns += winScore.runs; table[loser].againstOvers += winScore.overs;
  // Recalculate NRR for both
  [winner, loser].forEach(t => {
    if (table[t].forOvers > 0 && table[t].againstOvers > 0) {
      table[t].nrr = (table[t].forRuns / table[t].forOvers) - (table[t].againstRuns / table[t].againstOvers);
    }
  });
}

function getSortedTable(table) {
  return Object.entries(table)
    .map(([team, s]) => ({ team, ...s }))
    .sort((a, b) => b.pts - a.pts || b.nrr - a.nrr);
}

// ─── Gemini Match Simulation ───
async function simulateInnings(room, battingTeam, bowlingTeam, ground, target, inningsNum, matchContext, startOver, endOver) {
  const ai = new GoogleGenAI({ apiKey: room.geminiKey });

  const battingInfo = room.players[room.teamOwners[battingTeam]];
  const bowlingInfo = room.players[room.teamOwners[bowlingTeam]];
  if (!battingInfo || !bowlingInfo) return null;

  const battingXI = battingInfo.xi.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const bowlingXI = bowlingInfo.xi.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const targetLine = target ? `\nTarget: ${target} runs. Required Run Rate: ${(target / 20).toFixed(2)}` : '';
  const contextLine = matchContext ? `\nMatch Context: ${matchContext}` : '';

  const prompt = `You are simulating a realistic T20 IPL cricket match, innings ${inningsNum}.
Ground: ${ground}
${battingTeam} (Batting):
${battingXI}

${bowlingTeam} (Bowling):
${bowlingXI}
${targetLine}${contextLine}

Simulate overs ${startOver} to ${endOver} OVER BY OVER (or until all out / target reached).
Return ONLY a valid JSON array of objects. Each object represents one over and MUST have EXACTLY these keys:
{
  "over": ${startOver},
  "bowler": "Name",
  "batter": "Name",
  "nonStriker": "Name",
  "balls": ["0","1","4","W","2","6"],
  "wicketDesc": "",
  "runsScoredThisOver": 13,
  "totalScore": "13/1",
  "totalOvers": "${startOver}.0",
  "commentary": "One paragraph of exciting commentary for this over."
}

Rules:
- Realistic simulation. Top-order batsmen score more, tailenders struggle.
- Wickets fall naturally (bowled, caught, LBW, run out etc).
- When a wicket falls, wicketDesc should describe how (e.g. "Kohli caught at slip by Jadeja off Bumrah").
- Track batting order properly. When a wicket falls, next batter comes in.
- If all 10 wickets fall, the innings ends early.
- If chasing and target is reached, end the innings immediately.
- Keep running total accurate across overs.
- Output MUST be a valid JSON array, nothing else.`;

  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });
    return result.text;
  } catch (err) {
    console.error('Gemini API error:', err.message);
    return null;
  }
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
  socket.on('update-lineup', ({ xi }) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.players[socket.id].xi = xi;
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
      { runs: winner === match.battingFirst ? match.innings1Runs : result.runs, overs: winner === match.battingFirst ? match.innings1Overs : result.oversCount },
      { runs: loser === match.battingFirst ? match.innings1Runs : result.runs, overs: loser === match.battingFirst ? match.innings1Overs : result.oversCount }
    );
    room.currentMatchIdx++;
    room.matchResults.push({ num: match.num, teamA: match.teamA, teamB: match.teamB, result: resultText, winner });

    io.to(code).emit('match-result', {
      result: resultText,
      winner,
      innings1: { team: match.battingFirst, score: match.innings1Score },
      innings2: { team: battingTeam, score: result.score },
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
