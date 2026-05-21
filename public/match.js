/* CricPlay Client - Squad Build & Match Day */

// ─── Squad Build ───
socket.on('phase-squad-build', ({teamName, squad}) => {
  myTeam=teamName; mySquad=squad.map((name,i)=>({id:'p'+i,name,status:'available'}));
  myXI=[]; myImpact=[];
  showScreen('SquadBuild');
  renderSquadBuild();
});

function renderSquadBuild(){
  const search=($('#sbSearch')?.value||'').toLowerCase();
  // Stats
  const xi=mySquad.filter(p=>p.status==='xi'), imp=mySquad.filter(p=>p.status==='impact'), avail=mySquad.filter(p=>p.status==='available');
  $('#sbTotal').textContent=mySquad.length; $('#sbXI').textContent=xi.length; $('#sbImpact').textContent=imp.length;
  $('#sbXICount').textContent=xi.length; $('#sbImpCount').textContent=imp.length;
  // Pool
  const pool=$('#sbPool'); pool.innerHTML='';
  mySquad.filter(p=>p.name.toLowerCase().includes(search)).forEach(p=>{
    const d=document.createElement('div');
    d.className=`player-chip${p.status==='xi'?' in-xi':''}${p.status==='impact'?' in-impact':''}`;
    let badge='', actions='';
    if(p.status==='xi') badge='<span class="status-badge xi-badge">XI</span>';
    else if(p.status==='impact') badge='<span class="status-badge impact-badge">IMP</span>';
    if(p.status==='available') actions=`<button class="chip-btn xi-btn" title="Add XI">XI</button><button class="chip-btn impact-btn" title="Impact">I</button>`;
    else actions=`<button class="chip-btn remove-btn" title="Remove">↩</button>`;
    d.innerHTML=`<span class="player-name">${p.name}</span>${badge}<div class="chip-actions">${actions}</div>`;
    if(p.status==='available'){
      d.querySelector('.xi-btn').onclick=e=>{e.stopPropagation();if(xi.length>=11)return toast('XI full','error');p.status='xi';renderSquadBuild();};
      d.querySelector('.impact-btn').onclick=e=>{e.stopPropagation();if(imp.length>=3)return toast('Impact full','error');p.status='impact';renderSquadBuild();};
    } else d.querySelector('.remove-btn').onclick=e=>{e.stopPropagation();p.status='available';renderSquadBuild();};
    pool.appendChild(d);
  });
  // XI Slots
  const xiSlots=$('#sbXISlots'); xiSlots.innerHTML='';
  for(let i=0;i<11;i++){const d=document.createElement('div');const pl=xi[i];
    if(pl){d.className='lineup-slot filled';d.innerHTML=`<span class="slot-number">${i+1}</span><span class="slot-player-name">${pl.name}</span><button class="slot-remove" title="Remove">×</button>`;
    d.querySelector('.slot-remove').onclick=()=>{pl.status='available';renderSquadBuild();};}
    else{d.className='lineup-slot empty';d.innerHTML=`<span class="slot-number">${i+1}</span><span class="slot-empty-text">Empty</span>`;}
    xiSlots.appendChild(d);
  }
  // Impact Slots
  const impSlots=$('#sbImpSlots'); impSlots.innerHTML='';
  for(let i=0;i<3;i++){const d=document.createElement('div');const pl=imp[i];
    if(pl){d.className='lineup-slot filled';d.innerHTML=`<span class="slot-number">${i+1}</span><span class="slot-player-name">${pl.name}</span><button class="slot-remove" title="Remove">×</button>`;
    d.querySelector('.slot-remove').onclick=()=>{pl.status='available';renderSquadBuild();};}
    else{d.className='lineup-slot empty';d.innerHTML=`<span class="slot-number">${i+1}</span><span class="slot-empty-text">Empty</span>`;}
    impSlots.appendChild(d);
  }
}

$('#sbSearch').oninput = renderSquadBuild;

$('#btnSubmitSquad').onclick = () => {
  const xi=mySquad.filter(p=>p.status==='xi').map(p=>p.name);
  const impact=mySquad.filter(p=>p.status==='impact').map(p=>({name:p.name,role:'batting'}));
  if(xi.length!==11) return toast('Select exactly 11 players for XI','error');
  myXI=xi; myImpact=impact;
  socket.emit('submit-squad',{xi,impact});
  $('#btnSubmitSquad').style.display='none'; $('#waitingOthers').style.display='block';
};

// ─── Match Day ───
let currentSchedule=[], currentPointsTable=[], matchScoreA='', matchScoreB='';

socket.on('schedule-ready', ({schedule, pointsTable}) => {
  currentSchedule=schedule; currentPointsTable=pointsTable;
  showScreen('Match'); renderSidebar();
});

socket.on('match-toss', ({match, toss, battingFirst, bowlingFirst, pointsTable}) => {
  currentPointsTable=pointsTable; renderSidebar(match.num);
  hideAllPhases(); $('#phaseToss').style.display='block';
  matchScoreA=''; matchScoreB='';
  $('#matchHeader').textContent=`Match ${match.num}: ${match.teamA} vs ${match.teamB}`;
  $('#matchVenue').textContent=`🏟️ ${match.ground}`;
  $('#tossResult').textContent=`${toss.winner} won the toss and chose to ${toss.decision}`;
  // Show lineup edit if this is my match
  const isMyMatch = (match.teamA===myTeam||match.teamB===myTeam);
  if(isMyMatch){
    $('#lineupEdit').style.display='block'; $('#waitingToss').style.display='none';
    renderTossLineup();
  } else { $('#lineupEdit').style.display='none'; $('#waitingToss').style.display='none';
    // Auto-confirm for spectators
    socket.emit('confirm-lineup');
  }
});

function renderTossLineup(){
  const c=$('#tossXISlots'); c.innerHTML='';
  myXI.forEach((name,i)=>{const d=document.createElement('div');d.className='lineup-slot filled';
  d.innerHTML=`<span class="slot-number">${i+1}</span><span class="slot-player-name">${name}</span>`;
  c.appendChild(d);});
}

$('#btnConfirmLineup').onclick = () => {
  socket.emit('update-lineup',{xi:myXI});
  socket.emit('confirm-lineup');
  $('#lineupEdit').style.display='none'; $('#waitingToss').style.display='block';
};

socket.on('innings-start', ({inningsNum, battingTeam, bowlingTeam, target}) => {
  hideAllPhases(); $('#phaseLive').style.display='block';
  $('#commentaryFeed').innerHTML='';
  $('#inningsLabel').textContent=`${inningsNum===1?'1st':'2nd'} Innings — ${battingTeam} batting`;
  $('#scoreTeamA').innerHTML=`<div class="st-name">${battingTeam}</div><div class="st-score" id="liveScore">0/0</div><div class="st-overs" id="liveOvers">0.0 ov</div>`;
  $('#scoreTeamB').innerHTML=`<div class="st-name">${bowlingTeam}</div><div class="st-score">${target?'Target: '+(target):'Bowling'}</div><div class="st-overs">&nbsp;</div>`;
});

socket.on('over-update', ({inningsNum, over, overIndex}) => {
  $('#liveScore').textContent=over.totalScore||'0/0';
  $('#liveOvers').textContent=(over.totalOvers||'0.0')+' ov';
  if(inningsNum===1) matchScoreA=over.totalScore; else matchScoreB=over.totalScore;
  const feed=$('#commentaryFeed');
  const block=document.createElement('div'); block.className='over-block';
  const balls=(over.balls||[]).map(b=>{
    let cls='';
    if(b==='4')cls='four'; else if(b==='6')cls='six'; else if(b==='W'||b==='w')cls='wicket'; else if(b==='0')cls='dot';
    return `<div class="ball ${cls}">${b}</div>`;
  }).join('');
  block.innerHTML=`<div class="over-header"><span class="over-num">Over ${over.over}</span><span class="over-score">${over.totalScore} (${over.totalOvers} ov)</span></div>
  <div class="over-balls">${balls}</div>${over.wicketDesc?`<div class="over-wicket">🔴 ${over.wicketDesc}</div>`:''}
  <div class="over-commentary">${over.commentary||''}</div>`;
  feed.prepend(block);
  feed.scrollTop=0;
});

socket.on('innings-break', ({score, battingTeam, bowlingTeam}) => {
  hideAllPhases(); $('#phaseBreak').style.display='block';
  $('#breakScore').textContent=`${battingTeam}: ${score}`;
  const isMyMatch=(battingTeam===myTeam||bowlingTeam===myTeam);
  if(isMyMatch){
    renderImpactSwap();
    $('#btnConfirmImpact').style.display='inline-flex'; $('#waitingImpact').style.display='none';
  } else { $('#impactActivation').style.display='none';
    socket.emit('confirm-impact');
  }
});

function renderImpactSwap(){
  const c=$('#impactSwap'); c.innerHTML='';
  if(myImpact.length===0){c.innerHTML='<p style="color:var(--text3)">No impact subs available</p>';return;}
  myImpact.forEach((imp,i)=>{
    const row=document.createElement('div'); row.className='swap-row';
    const outOpts=myXI.map(n=>`<option value="${n}">${n}</option>`).join('');
    row.innerHTML=`<span class="swap-label">Sub In:</span><strong style="color:var(--impact);min-width:140px">${imp.name}</strong>
    <span class="swap-label">for</span><select id="swapOut${i}"><option value="">-- Don't use --</option>${outOpts}</select>`;
    c.appendChild(row);
  });
}

$('#btnConfirmImpact').onclick = () => {
  myImpact.forEach((imp,i)=>{
    const sel=$(`#swapOut${i}`);
    if(sel&&sel.value){ socket.emit('activate-impact',{subIn:imp.name,subOut:sel.value});
      const idx=myXI.indexOf(sel.value); if(idx>=0)myXI[idx]=imp.name;
    }
  });
  socket.emit('confirm-impact');
  $('#btnConfirmImpact').style.display='none'; $('#waitingImpact').style.display='block';
};

socket.on('match-result', ({result, winner, innings1, innings2, pointsTable, matchResults, hasNextMatch}) => {
  currentPointsTable=pointsTable;
  matchResults.forEach(r=>{const m=currentSchedule.find(s=>s.num===r.num);if(m)m.result=r.result;});
  renderSidebar();
  hideAllPhases(); $('#phaseResult').style.display='block';
  $('#resultText').textContent=result;
  $('#resultScores').innerHTML=`${innings1.team}: <strong>${innings1.score}</strong> &nbsp;|&nbsp; ${innings2.team}: <strong>${innings2.score}</strong>`;
  if(hasNextMatch&&isHost) $('#btnNextMatch').style.display='inline-flex'; else $('#btnNextMatch').style.display='none';
});

$('#btnNextMatch').onclick = () => { socket.emit('next-match'); $('#btnNextMatch').style.display='none'; };

socket.on('tournament-complete', ({pointsTable, winner}) => {
  currentPointsTable=pointsTable; renderSidebar();
  hideAllPhases(); $('#phaseTournament').style.display='block';
  $('#winnerName').textContent=winner;
});

// ─── Sidebar ───
function renderSidebar(currentMatchNum){
  // Points table
  const ptc=$('#pointsTableContainer');
  if(currentPointsTable.length){
    let html='<table class="pts-table"><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>NRR</th></tr>';
    currentPointsTable.forEach(r=>{html+=`<tr><td>${r.team}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td><strong>${r.pts}</strong></td><td>${r.nrr>=0?'+':''}${r.nrr.toFixed(2)}</td></tr>`;});
    html+='</table>'; ptc.innerHTML=html;
  }
  // Schedule
  const sc=$('#scheduleContainer'); sc.innerHTML='';
  const list=document.createElement('div'); list.className='schedule-list';
  currentSchedule.forEach(m=>{
    const d=document.createElement('div');d.className=`sched-item${m.num===currentMatchNum?' current':''}`;
    const meta1=teamMeta[m.teamA]||{short:m.teamA.substring(0,3)};
    const meta2=teamMeta[m.teamB]||{short:m.teamB.substring(0,3)};
    d.innerHTML=`<span>${m.num}. ${meta1.short} vs ${meta2.short}</span>${m.result?`<span class="sched-result">${m.result}</span>`:''}`;
    list.appendChild(d);
  });
  sc.appendChild(list);
}

function hideAllPhases(){['phaseToss','phaseLive','phaseBreak','phaseResult','phaseTournament'].forEach(id=>{$('#'+id).style.display='none';});}
