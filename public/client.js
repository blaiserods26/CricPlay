/* CricPlay Client - Core */
const socket = io();
let myId = null, roomCode = null, isHost = false, teamMeta = {}, myTeam = null, mySquad = [], myXI = [], myImpact = [];

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ─── Screen Nav ───
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`#screen${id.charAt(0).toUpperCase()+id.slice(1)}`);
  if (el) el.classList.add('active');
}

function toast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toastContainer').appendChild(t);
  setTimeout(() => { t.style.animation='toastOut .3s forwards'; setTimeout(()=>t.remove(),300); }, 3000);
}

// ─── Particles ───
(function(){
  const c=['var(--accent)','var(--accent2)','var(--impact)','var(--green)'];
  for(let i=0;i<15;i++){const p=document.createElement('div');p.className='particle';const s=Math.random()*5+2;
  p.style.cssText=`width:${s}px;height:${s}px;background:${c[i%4]};left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*20}s;animation-duration:${15+Math.random()*15}s`;
  $('#bgParticles').appendChild(p);}
})();

// ─── Landing ───
$('#btnShowJoin').onclick = () => { $('#joinPanel').style.display = $('#joinPanel').style.display==='none'?'flex':'none'; };
$('#btnCreateRoom').onclick = () => {
  const name = $('#landingName').value.trim();
  if(!name) return toast('Enter your name','error');
  localStorage.setItem('cp_name', name);
  showScreen('Create');
};
$('#btnJoinRoom').onclick = () => {
  const name = $('#landingName').value.trim();
  const code = $('#joinCode').value.trim().toUpperCase();
  if(!name) return toast('Enter your name','error');
  if(!code||code.length<4) return toast('Enter room code','error');
  localStorage.setItem('cp_name', name);
  socket.emit('join-room', { code, playerName: name });
};

// ─── Create Room: Upload & OCR ───
const IPL_TEAMS = ["Chennai Super Kings","Royal Challengers Bengaluru","Royal Challengers Bangalore","Mumbai Indians","Kolkata Knight Riders","Rajasthan Royals","Sunrisers Hyderabad","Delhi Capitals","Punjab Kings","Gujarat Titans","Lucknow Super Giants"];
let uploadedImages = [], extractedTeams = {};

$('#uploadZone').ondragover = e => { e.preventDefault(); $('#uploadZone').classList.add('dragover'); };
$('#uploadZone').ondragleave = () => $('#uploadZone').classList.remove('dragover');
$('#uploadZone').ondrop = e => { e.preventDefault(); $('#uploadZone').classList.remove('dragover'); handleFiles(e.dataTransfer.files); };
$('#imageInput').onchange = e => handleFiles(e.target.files);

function handleFiles(files) {
  for(const f of files){ if(!f.type.startsWith('image/'))continue;
    const r=new FileReader(); r.onload=e=>{uploadedImages.push(e.target.result);renderPreviews();$('#btnExtract').style.display='flex';}; r.readAsDataURL(f);
  }
}
function renderPreviews() {
  const c=$('#imagePreviews'); c.innerHTML='';
  uploadedImages.forEach((src,i)=>{const d=document.createElement('div');d.className='preview-card';
  d.innerHTML=`<img src="${src}" alt="img${i}"/><button class="remove-preview" onclick="uploadedImages.splice(${i},1);renderPreviews();if(!uploadedImages.length)$('#btnExtract').style.display='none';">×</button>`;
  c.appendChild(d);});
}

$('#btnExtract').onclick = async () => {
  if(!uploadedImages.length) return toast('Upload images first','error');
  const name=localStorage.getItem('cp_name')||'Player';
  $('#btnExtract').disabled=true; $('#btnExtract').textContent='Extracting...';
  $('#ocrProgress').style.display='block'; $('#progressFill').style.width='0%';
  extractedTeams={};
  try {
    const worker = await Tesseract.createWorker('eng',1,{logger:m=>{
      if(m.status==='recognizing text'){$('#progressFill').style.width=Math.round(m.progress*100)+'%';$('#progressText').textContent=`Recognizing... ${Math.round(m.progress*100)}%`;}
    }});
    for(let i=0;i<uploadedImages.length;i++){
      $('#progressText').textContent=`Image ${i+1}/${uploadedImages.length}...`;
      const res=await worker.recognize(uploadedImages[i]);
      const parsed=parseOCR(res.data.text);
      if(parsed.team&&!extractedTeams[parsed.team]) extractedTeams[parsed.team]=parsed.names;
      else if(parsed.names.length){const k=parsed.team||`Team ${Object.keys(extractedTeams).length+1}`;extractedTeams[k]=parsed.names;}
    }
    await worker.terminate();
    renderExtractedTeams();
    if(Object.keys(extractedTeams).length>=2){
      socket.emit('create-room',{playerName:name,geminiKey:'',teams:extractedTeams});
    } else toast('Need at least 2 teams. Upload more images.','error');
  } catch(e){console.error(e);toast('OCR failed','error');}
  finally{$('#btnExtract').disabled=false;$('#btnExtract').textContent='Extract Teams & Create Room';$('#ocrProgress').style.display='none';}
};

function parseOCR(text){
  const lines=text.split('\n').map(l=>l.trim()).filter(Boolean);
  const names=[];let teamName=null;
  const skip=[/^(bought|players?|overseas|spent|remaining|ipl|auction|squad|play\s*now)/i,/playauctiongame/i,/^\d+(\.\d+)?\s*(cr|l|ccr)$/i,/^(os|0s|\d+)$/i,/^\d+$/,/^[^a-zA-Z]*$/];
  for(let i=0;i<lines.length;i++){const line=lines[i];
    if(!teamName){const m=IPL_TEAMS.find(t=>line.toLowerCase().replace(/[^a-z]/g,'').includes(t.toLowerCase().replace(/[^a-z]/g,'')));
    if(m){teamName=m==="Royal Challengers Bangalore"?"Royal Challengers Bengaluru":m;continue;}}
    if(skip.some(p=>p.test(line)))continue;
    if(IPL_TEAMS.some(t=>line.toLowerCase().replace(/[^a-z]/g,'').includes(t.toLowerCase().replace(/[^a-z]/g,''))))continue;
    let c=line.replace(/\d+(\.\d+)?\s*(cr|CR|ccr|l|L)\s*$/i,'').replace(/(?:\.\s*)?(?:cr|ccr|l|o|ol)$/i,'').replace(/\b(os|OS|0s|Os|O|Ol)\b/g,'').replace(/\d+/g,'').replace(/\|/g,'').replace(/[^\w\s.'-]/g,'').trim();
    if(c.length<3||c.split(/\s+/).length>5)continue;
    c=c.split(/\s+/).filter(w=>w.length>0).map(w=>w[0].toUpperCase()+w.slice(1).toLowerCase()).join(' ');
    if(c.length>=3)names.push(c);
  }
  return{names,team:teamName};
}

function renderExtractedTeams(){
  const g=$('#teamsGrid');g.innerHTML='';$('#extractedTeams').style.display='block';
  for(const[team,players]of Object.entries(extractedTeams)){
    const d=document.createElement('div');d.className='team-preview-card';
    d.innerHTML=`<h4>${team} (${players.length})</h4><div class="player-list">${players.join(', ')}</div>`;
    g.appendChild(d);
  }
}

// ─── Socket Events ───
socket.on('connect', () => { myId = socket.id; });
socket.on('error-msg', msg => toast(msg, 'error'));

socket.on('room-created', data => {
  roomCode=data.code; isHost=true; teamMeta=data.teamMeta||{};
  $('#roomBadge').style.display='inline-block'; $('#roomCodeDisplay').textContent=roomCode;
  $('#playerBadge').style.display='inline-block'; $('#playerBadge').textContent=localStorage.getItem('cp_name');
  showScreen('Lobby'); $('#lobbyCode').textContent=roomCode;
  $('#btnStartGame').style.display='inline-flex';
  toast(`Room ${roomCode} created!`,'success');
});

socket.on('room-joined', data => {
  roomCode=data.code; teamMeta=data.teamMeta||{};
  $('#roomBadge').style.display='inline-block'; $('#roomCodeDisplay').textContent=roomCode;
  $('#playerBadge').style.display='inline-block'; $('#playerBadge').textContent=localStorage.getItem('cp_name');
  showScreen('Lobby'); $('#lobbyCode').textContent=roomCode;
  toast('Joined room!','success');
});

socket.on('players-updated', players => {
  const c=$('#lobbyPlayersList'); c.innerHTML='';
  for(const[sid,p]of Object.entries(players)){
    const d=document.createElement('div');d.className='player-card';
    d.innerHTML=`<div class="p-name">${p.name}${sid===myId?' (You)':''}</div><div class="p-team">${p.team||'No team'}</div><div class="p-ready ${p.ready?'yes':'no'}">${p.ready?'Ready':'Waiting'}</div>`;
    c.appendChild(d);
  }
});

socket.on('player-left', ({name}) => toast(`${name} left the room`,'info'));

$('#btnStartGame').onclick = () => socket.emit('start-game');
$('#btnCopyCode').onclick = () => { navigator.clipboard.writeText(roomCode); toast('Code copied!','success'); };

// ─── Team Selection ───
socket.on('phase-changed', ({phase, teams, takenTeams}) => {
  if(phase==='team-select'){
    showScreen('TeamSelect');
    renderTeamCards(teams, takenTeams);
    if(isHost) $('#btnConfirmTeams').style.display='inline-flex';
  }
});

socket.on('team-selected', ({playerId, teamName, takenTeams}) => {
  if(playerId===myId) myTeam=teamName;
  renderTeamCards(Object.keys(teamMeta).length?Object.keys(teamMeta):Object.keys(takenTeams), takenTeams);
});

function renderTeamCards(teams, taken={}) {
  const c=$('#teamCards'); c.innerHTML='';
  teams.forEach(t=>{const d=document.createElement('div');
    const meta=teamMeta[t]||{short:t.substring(0,3).toUpperCase(),ground:'',color:'#ffb74d'};
    const isTaken=taken[t]; const isMine=myTeam===t;
    d.className=`team-card${isMine?' selected':''}${isTaken&&!isMine?' taken':''}`;
    d.style.borderColor=isMine?meta.color:'';
    d.innerHTML=`<div class="tc-short" style="color:${meta.color}">${meta.short}</div><div class="tc-name">${t}</div><div class="tc-ground">${meta.ground}</div>${isTaken?`<div class="tc-owner">${isTaken}</div>`:''}`;
    if(!isTaken||isMine) d.onclick=()=>socket.emit('select-team',{teamName:t});
    c.appendChild(d);
  });
}

$('#btnConfirmTeams').onclick = () => socket.emit('confirm-teams');

$('#btnDefaultTeams').onclick = () => {
  const name = localStorage.getItem('cp_name') || 'Player';
  const defaultSquads = {
    'Chennai Super Kings': [
      'Ruturaj Gaikwad', 'Rachin Ravindra', 'Ajinkya Rahane', 'Daryl Mitchell', 'Shivam Dube',
      'Ravindra Jadeja', 'MS Dhoni', 'Mitchell Santner', 'Shardul Thakur', 'Deepak Chahar',
      'Mustafizur Rahman', 'Tushar Deshpande', 'Matheesha Pathirana', 'Sameer Rizvi', 'Devon Conway'
    ],
    'Royal Challengers Bengaluru': [
      'Virat Kohli', 'Faf du Plessis', 'Rajat Patidar', 'Glenn Maxwell', 'Cameron Green',
      'Dinesh Karthik', 'Mahipal Lomror', 'Will Jacks', 'Anuj Rawat', 'Karn Sharma',
      'Mohammed Siraj', 'Yash Dayal', 'Lockie Ferguson', 'Mayank Dagar', 'Alzarri Joseph'
    ],
    'Mumbai Indians': [
      'Rohit Sharma', 'Ishan Kishan', 'Suryakumar Yadav', 'Tilak Varma', 'Hardik Pandya',
      'Tim David', 'Romario Shepherd', 'Gerald Coetzee', 'Jasprit Bumrah', 'Akash Madhwal',
      'Piyush Chawla', 'Naman Dhir', 'Nehal Wadhera', 'Nuwan Thushara', 'Mohammad Nabi'
    ],
    'Kolkata Knight Riders': [
      'Phil Salt', 'Sunil Narine', 'Angkrish Raghuvanshi', 'Shreyas Iyer', 'Venkatesh Iyer',
      'Rinku Singh', 'Andre Russell', 'Ramandeep Singh', 'Mitchell Starc', 'Harshit Rana',
      'Varun Chakaravarthy', 'Suyash Sharma', 'Vaibhav Arora', 'Manish Pandey', 'Rahmanullah Gurbaz'
    ],
    'Rajasthan Royals': [
      'Yashasvi Jaiswal', 'Jos Butter', 'Sanju Samson', 'Riyan Parag', 'Dhruv Jurel',
      'Shimron Hetmyer', 'Ravichandran Ashwin', 'Trent Boult', 'Avesh Khan', 'Sandeep Sharma',
      'Yuzvendra Chahal', 'Rovman Powell', 'Nandre Burger', 'Tanush Kotian', 'Keshav Maharaj'
    ],
    'Sunrisers Hyderabad': [
      'Travis Head', 'Abhishek Sharma', 'Aiden Markram', 'Heinrich Klaasen', 'Nitish Kumar Reddy',
      'Abdul Samad', 'Shahbaz Ahmed', 'Pat Cummins', 'Bhuvneshwar Kumar', 'Jaydev Unadkat',
      'T Natarajan', 'Mayank Markande', 'Umran Malik', 'Glenn Phillips', 'Washington Sundar'
    ],
    'Delhi Capitals': [
      'Prithvi Shaw', 'Jake Fraser-McGurk', 'Abishek Porel', 'Shai Hope', 'Rishabh Pant',
      'Tristan Stubbs', 'Axar Patel', 'Kuldeep Yadav', 'Khaleel Ahmed', 'Mukesh Kumar',
      'Ishant Sharma', 'Anrich Nortje', 'Jhye Richardson', 'Lalit Yadav', 'Kumar Kushagra'
    ],
    'Punjab Kings': [
      'Shikhar Dhawan', 'Jonny Bairstow', 'Prabhsimran Singh', 'Sam Curran', 'Jitesh Sharma',
      'Liam Livingstone', 'Shashank Singh', 'Ashutosh Sharma', 'Harpreet Brar', 'Harshal Patel',
      'Kagiso Rabada', 'Arshdeep Singh', 'Rahul Chahar', 'Nathan Ellis', 'Vidwath Kaverappa'
    ],
    'Gujarat Titans': [
      'Shubman Gill', 'Sai Sudharsan', 'Kane Williamson', 'Sharath BR', 'Vijay Shankar',
      'Rahul Tewatia', 'Rashid Khan', 'Umesh Yadav', 'Spencer Johnson', 'Mohit Sharma',
      'Noor Ahmad', 'Darshan Nalkande', 'David Miller', 'Shahrukh Khan', 'Sai Kishore'
    ],
    'Lucknow Super Giants': [
      'KL Rahul', 'Quinton de Kock', 'Devdutt Padikkal', 'Marcus Stoinis', 'Nicholas Pooran',
      'Ayush Badoni', 'Krunal Pandya', 'Ravi Bishnoi', 'Yash Thakur', 'Naveen-ul-Haq',
      'Mayank Yadav', 'Amit Mishra', 'Mohsin Khan', 'Shamar Joseph', 'Arshad Khan'
    ]
  };
  socket.emit('create-room', { playerName: name, geminiKey: '', teams: defaultSquads });
};
