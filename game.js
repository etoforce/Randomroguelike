const size = 19;
let visionRange = 2, dodgeChance = 10, blockChance = 0;
let torchHealth = 50, maxTorchHealth = 100, actionCounter = 0;
let discoveredWalls = new Set(), discoveredExits = new Set(), litCells = new Set();
let playerClass = 'warrior', classCritChance = 0, critMultiplier = 2;
let level = 1, hp = 25, maxHp = 25, minDamage = 4, maxDamage = 8, gold = 0, potions = 0, potionCapacity = 3;
let gameOver = false, gameStarted = false, controlLock = true;
let playerUnderTile='.';
let player = {x:1,y:1}, map = [], monsters = {}, shopStock = [], merchantExists = false, merchantPurchases = 0, pendingFatalDamage = null;
let lastFogCells = new Set();
let lastVisibleCells = new Set();
let beaconUsed = false;
let beaconExists = false;
let fountainUsed = false;
let fountainExists = false;
let chestOpeningCells = new Set();
let revealFogActive = false;
let beaconRevealTimer = null;
let facing = {x:0,y:1};
let spriteFacingX = 1;
let lastMoveDir = {x:0,y:0};
let movementBusy = false;
let combatBusy = false;
const MOVE_DELAY_MS = 190;
let bonusStock = [], pendingBonusChoices = 0, inventory = [];
let magePotionCraftedThisLevel = false;
let isLoadingGame = false;
let playerSpriteState = 'idle';
let monsterSpriteStates = {};
let spriteResetTimer = null;
let mapCells = [];
let mapGridReady = false;
const TILE_SIZE = 40;
const MAX_LOG_LINES = 60;

// Баланс сложности этажей. Бюджет определяет сколько врагов может появиться на этаже.
// Важно: враги теперь имеют честный диапазон урона min-max, а не старое 1-X.
const FLOOR_DIFFICULTY_BUDGET = [0, 4, 6, 8, 10, 13, 16, 20, 24, 29, 35];
const UNIT_DIFFICULTY = {
 skeleton: 1,
 skeletonStrong: 3,
 skeletonElite: 5,
 mercenary: 2,
 mercenaryStrong: 4,
 mercenaryElite: 6,
 exitGuardBonus: 2
};
const ENEMY_LEVEL_BALANCE = [
 null,
 {skeleton:{hp:8,dmg:[1,2]}, mercenary:{hp:7,dmg:[3,4]}},
 {skeleton:{hp:11,dmg:[1,3]}, mercenary:{hp:9,dmg:[3,5]}},
 {skeleton:{hp:14,dmg:[2,4]}, mercenary:{hp:12,dmg:[4,6]}},
 {skeleton:{hp:18,dmg:[3,5]}, mercenary:{hp:15,dmg:[5,7]}},
 {skeleton:{hp:22,dmg:[4,6]}, mercenary:{hp:19,dmg:[6,8]}},
 {skeleton:{hp:27,dmg:[5,7]}, mercenary:{hp:23,dmg:[7,9]}},
 {skeleton:{hp:32,dmg:[6,8]}, mercenary:{hp:27,dmg:[8,10]}},
 {skeleton:{hp:37,dmg:[7,9]}, mercenary:{hp:31,dmg:[9,11]}},
 {skeleton:{hp:41,dmg:[8,10]}, mercenary:{hp:35,dmg:[10,12]}},
 {skeleton:{hp:45,dmg:[9,11]}, mercenary:{hp:38,dmg:[11,13]}}
];

function random(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function key(x,y){return x+','+y;}
function formatNum(n){return Number.isInteger(n)?n:n.toFixed(1);}
function clampDamageStats(){
 if(minDamage > maxDamage){
  maxDamage = Math.ceil(minDamage);
 }
}

function clampTorch(){
 torchHealth=Math.max(0,Math.min(maxTorchHealth,Math.floor(torchHealth)));
 maxTorchHealth=Math.max(100,Math.floor(maxTorchHealth));
 updateVisionFromTorch();
}
function updateVisionFromTorch(){
 // 100% = 4 клетки, 75% = 3, 50% = 2, 25% и ниже = 1. Даже при maxTorchHealth >100 максимум обзора остаётся 4.
 visionRange=Math.max(1,Math.min(4,Math.floor(torchHealth/25)));
}
function restoreTorch(amount){
 let before=torchHealth;
 torchHealth=Math.min(maxTorchHealth,torchHealth+amount);
 clampTorch();
 return torchHealth-before;
}
function registerAction(){
 if(!gameStarted||gameOver||pendingBonusChoices>0)return;
 actionCounter++;
 if(actionCounter>0 && actionCounter%50===0){
  torchHealth=Math.max(0,torchHealth-25);
  clampTorch();
  log('Пламя факела слабеет.');
 }
}
function resetFogMemory(){
 discoveredWalls=new Set();
 discoveredExits=new Set();
 litCells=new Set();
}
function rememberCell(x,y){
 if(x<0||x>=size||y<0||y>=size)return;
 let s=map[y][x];
 if(s==='#' && wallTouchesRoad(x,y)) discoveredWalls.add(key(x,y));
 if(s==='>') discoveredExits.add(key(x,y));
}
function rememberVisibleCells(){
 for(let y=0;y<size;y++){
  for(let x=0;x<size;x++){
   if(isVisible(x,y)) rememberCell(x,y);
  }
 }
}
function lightAreaFromBeacon(cx,cy){
 for(let y=cy-2;y<=cy+2;y++){
  for(let x=cx-2;x<=cx+2;x++){
   if(x<0||x>=size||y<0||y>=size)continue;
   if(!hasLineOfSight(cx,cy,x,y))continue;
   let k=key(x,y);
   litCells.add(k);
   rememberCell(x,y);
  }
 }
}
function escapeHtml(value){
 return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;');
}
function colorizeLogText(text){
 let raw=String(text);
 let hasDivider=raw.includes('<hr>');
 raw=raw.replace(/<hr>/g,'').replace(/<\/?b>/g,'');
 let prefix='📝 ';
 if(/крит/i.test(raw))prefix='💥 ';
 else if(/убит|победа|прошел|прошёл/i.test(raw))prefix='🏆 ';
 else if(/золота|Куплено|Сундук/i.test(raw))prefix='💰 ';
 else if(/зель|лечен/i.test(raw))prefix='🧪 ';
 else if(/ударил|урона|смертель/i.test(raw))prefix='⚔️ ';
 else if(/уворот|блок/i.test(raw))prefix='🛡️ ';
 else if(/уровень|Бонус/i.test(raw))prefix='✨ ';
 else if(/Стена|нельзя|не хватает|полон|полное/i.test(raw))prefix='⚠️ ';
 else if(/Игра началась/i.test(raw))prefix='🕯️ ';
 let safe=escapeHtml(raw);
 safe=safe.replace(/(Крит убийцы|крит!?|Крит!?)/gi,'<span class="logCrit">$1</span>');
 safe=safe.replace(/(Воин|Маг|Убийца|Герой|Ты)(?=[\s:.,!]|$)/g,'<span class="logPlayer">$1</span>');
 safe=safe.replace(/([+]?\d+\s*золота|золота|золото)/gi,'<span class="logGold">$1</span>');
 safe=safe.replace(/(\+\d+(?:\.\d+)?\s*(?:HP|Max HP|здоровья|урона)|HP \+\d+(?:\.\d+)?|Max HP \+\d+(?:\.\d+)?)/gi,'<span class="logHpPlus">$1</span>');
 safe=safe.replace(/(-\d+(?:\.\d+)?\s*HP|минус \d+(?:\.\d+)?\s*HP)/gi,'<span class="logHpMinus">$1</span>');
 safe=safe.replace(/(Элитный скелет|Элитный наёмник|Скелет|Наёмник|Враги|Враг|Торговец)/g,'<span class="logEnemy">$1</span>');
 safe=safe.replace(/(Бонус|Уровень \d+|Игра началась)/g,'<span class="logBonus">$1</span>');
 return (hasDivider?'<hr>':'') + '<div class="logLine">' + prefix + safe + '</div>';
}
function log(text){
 const box=document.getElementById('log');
 const wrapper=document.createElement('div');
 wrapper.innerHTML=colorizeLogText(text);
 while(wrapper.firstChild){
  box.appendChild(wrapper.firstChild);
 }
 while(box.children.length>MAX_LOG_LINES){
  box.removeChild(box.firstChild);
 }
 box.scrollTop=box.scrollHeight;
}
function toggleRules(){const b=document.getElementById('rulesBox'); b.style.display=b.style.display==='block'?'none':'block'; document.getElementById('bestiaryBox').style.display='none';}
function toggleBestiary(){const b=document.getElementById('bestiaryBox'); b.style.display=b.style.display==='block'?'none':'block'; document.getElementById('rulesBox').style.display='none'; renderDifficultyTable();}
function showClassSelect(){document.getElementById('classSelect').style.display='block'; document.getElementById('rulesBox').style.display='none'; document.getElementById('bestiaryBox').style.display='none';}
function exitToMenu(){hideDeathScreen();gameStarted=false;gameOver=false;pendingFatalDamage=null;pendingBonusChoices=0;beaconUsed=false;beaconExists=false;fountainUsed=false;fountainExists=false;revealFogActive=false;if(beaconRevealTimer){clearTimeout(beaconRevealTimer);beaconRevealTimer=null;}chestOpeningCells=new Set();resetFogMemory();hideActionPanel();document.getElementById('game').style.display='none';document.getElementById('menu').style.display='block';document.getElementById('classSelect').style.display='none';}
function updateStats(){
 clampDamageStats();
 document.getElementById('level').textContent=level; document.getElementById('hp').textContent=Math.floor(hp); document.getElementById('maxHp').textContent=Math.floor(maxHp);
 document.getElementById('minDamage').textContent=formatNum(minDamage); document.getElementById('maxDamage').textContent=formatNum(maxDamage); document.getElementById('gold').textContent=gold;
 clampTorch();
 document.getElementById('potions').textContent=potions; document.getElementById('potionCap').textContent=potionCapacity; document.getElementById('vision').textContent=visionRange;
 const th=document.getElementById('torchHealthText'); if(th) th.textContent=torchHealth+'/'+maxTorchHealth+'%';
 const ac=document.getElementById('actionsText'); if(ac) ac.textContent=actionCounter;
 document.getElementById('dodge').textContent=dodgeChance; document.getElementById('block').textContent=blockChance; document.getElementById('invCount').textContent=inventory.length;
 let cn='Воин'; if(playerClass==='mage')cn='Маг'; if(playerClass==='assassin')cn='Убийца'; document.getElementById('className').textContent=cn;
 document.querySelector('#characterBox .characterIcon').textContent=classIcon();
 document.getElementById('craftPotionButton').style.display=playerClass==='mage'?'inline-block':'none';
 document.getElementById('inventoryText').innerHTML=renderInventorySlots();
 if(gameStarted && !isLoadingGame){saveGame(true);}
}
function renderInventorySlots(){
 let html='';
 for(let i=0;i<4;i++){
  let item=inventory[i];
  html += '<div class="slot">'+(item?itemIcon(item.type)+' '+item.name:'⬛ пусто')+'</div>';
 }
 return html;
}
function startGame(cls='warrior'){playerClass=cls;document.getElementById('classSelect').style.display='none';document.getElementById('menu').style.display='none';document.getElementById('game').style.display='block';restartGame();}
function setupClassStats(){
 if(playerClass==='warrior'){
  hp=28;
  maxHp=28;
  minDamage=4;
  maxDamage=6;
  dodgeChance=10;
  classCritChance=0;
  critMultiplier=2;
 }
 if(playerClass==='mage'){
  hp=18;
  maxHp=18;
  minDamage=5;
  maxDamage=5;
  dodgeChance=10;
  classCritChance=0;
  critMultiplier=2;
 }
 if(playerClass==='assassin'){
  hp=21;
  maxHp=21;
  minDamage=3;
  maxDamage=9;
  dodgeChance=18;
  classCritChance=18;
  critMultiplier=2;
 }
 blockChance=0;
 potionCapacity=3;
 inventory=[];
 magePotionCraftedThisLevel=false;
}

function toggleControlLock(){controlLock=!controlLock;document.getElementById('lockStatus').textContent=controlLock?'ВКЛ':'ВЫКЛ';}
function toggleCharacter(){const box=document.getElementById('characterBox');box.style.display=box.style.display==='block'?'none':'block';}

function classIcon(){
 if(playerClass==='warrior')return '🛡️';
 if(playerClass==='mage')return '🧙‍♂️';
 if(playerClass==='assassin')return '🥷';
 return '🧍';
}
function itemIcon(type){
 if(type==='rustSword')return '🗡️';
 if(type==='chainmail')return '🥋';
 if(type==='nightVision'||type==='torchFuel')return '🪔';
 if(type==='shield')return '🛡️';
 if(type==='boots')return '👢';
 if(type==='potionBag')return '🎒';
 return '🎒';
}
function enemyIcon(m){
 if(!m)return '❓';
 if(m.elite && m.type==='mercenary')return '⚔️';
 if(m.elite)return '💀';
 if(m.type==='mercenary')return '🗡️';
 return '☠️';
}

function spriteImg(src, extraClass=''){
 return `<span class="spriteWrap ${extraClass}"><img class="spriteImg" src="${src}" alt=""></span>`;
}
function playerVisualHtml(){
 if(playerClass==='warrior'){
  let state=playerSpriteState || 'idle';
  let src = state === 'idle' ? 'assets/soldier_idle_static.png' : `assets/soldier_${state}.gif`;
  return spriteImg(src, 'soldierSprite state-'+state);
 }
 if(playerClass==='mage'){
  return spriteImg('assets/mage_idle.gif', 'mageSprite state-idle');
 }
 return '<span class="heroIcon">'+classIcon()+'</span>';
}
function monsterVisualHtml(m, x, y){
 if(m && m.type==='mercenary'){
  let state=monsterSpriteStates[key(x,y)] || 'idle';
  let src = state === 'idle' ? 'assets/orc_idle_static.png' : `assets/orc_${state}.gif`;
  let faceCls = x > player.x ? ' monsterFacingLeft' : ' monsterFacingRight';
  let cls='orcSprite state-'+state+faceCls+(m.elite?' eliteSprite':'');
  return spriteImg(src, cls);
 }
 if(m && m.type==='skeleton'){
  let state=monsterSpriteStates[key(x,y)] || 'idle';
  let src = state === 'idle' ? 'assets/skeleton_idle_static.png' : `assets/skeleton_${state}.gif`;
  let faceCls = x > player.x ? ' monsterFacingLeft' : ' monsterFacingRight';
  let cls='skeletonSprite state-'+state+faceCls+(m.elite?' eliteSprite':'');
  return spriteImg(src, cls);
 }
 return enemyIcon(m);
}
function setPlayerSpriteState(state, ms=420){
 if(playerClass!=='warrior') return;
 playerSpriteState=state;
 drawMap();
 if(spriteResetTimer) clearTimeout(spriteResetTimer);
 spriteResetTimer=setTimeout(()=>{playerSpriteState='idle'; drawMap();}, ms);
}
function setMonsterSpriteState(x,y,state,ms=420){
 let k=key(x,y);
 let m=monsters[k];
 if(!m || (m.type!=='mercenary' && m.type!=='skeleton')) return;
 monsterSpriteStates[k]=state;
 drawMap();
 setTimeout(()=>{delete monsterSpriteStates[k]; drawMap();}, ms);
}
function applyIncomingDamageModifiers(damage){
 let finalDamage = damage;
 if(playerClass==='warrior'){
  finalDamage = Math.max(1, finalDamage - 1);
 }
 return finalDamage;
}
function attackLabel(type){
 if(playerClass==='mage'){
  if(type==='slash')return 'Магический снаряд';
  if(type==='stab')return 'Сфокусированный луч';
  if(type==='stun')return 'Ослепляющая вспышка';
 }
 if(type==='slash')return 'Резать';
 if(type==='stab')return 'Колоть';
 if(type==='stun')return 'Оглушающий удар';
 return 'Атака';
}

function facingSymbol(){
 if(facing.x===1)return '➡️';
 if(facing.x===-1)return '⬅️';
 if(facing.y===-1)return '⬆️';
 return '⬇️';
}
function movementClass(){
 if(lastMoveDir.x===1)return 'moveFromLeft';
 if(lastMoveDir.x===-1)return 'moveFromRight';
 if(lastMoveDir.y===1)return 'moveFromTop';
 if(lastMoveDir.y===-1)return 'moveFromBottom';
 return '';
}
function setFacing(dx,dy){
 if(dx!==0||dy!==0){
  facing={x:dx,y:dy};
  if(dx<0) spriteFacingX=-1;
  if(dx>0) spriteFacingX=1;
 }
}
function getFacingTile(){return {x:player.x+facing.x,y:player.y+facing.y};}
function getFacingMonster(){
 let t=getFacingTile();
 if(t.x>=0&&t.x<size&&t.y>=0&&t.y<size&&map[t.y][t.x]==='M')return t;
 return null;
}
function getFacingMerchant(){
 let t=getFacingTile();
 if(t.x>=0&&t.x<size&&t.y>=0&&t.y<size&&map[t.y][t.x]==='$')return t;
 return null;
}
function getFacingChest(){
 // Сундук открывается кнопкой, если игрок стоит рядом с ним.
 let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
 for(let d of dirs){
  let x=player.x+d.x,y=player.y+d.y;
  if(x<0||x>=size||y<0||y>=size)continue;
  if(map[y][x]==='C')return {x,y};
 }
 return null;
}
function getFacingBeacon(){
    // Если игрок стоит прямо на Светоче.
    if (playerUnderTile === 'B' || playerUnderTile === 'L') {
        return {x: player.x, y: player.y};
    }

    // Если игрок смотрит на Светоч.
    let t = getFacingTile();
    if (t.x >= 0 && t.x < size && t.y >= 0 && t.y < size && (map[t.y][t.x] === 'B' || map[t.y][t.x] === 'L')) {
        return t;
    }

    // Чтобы не было бага "работает только снизу": можно активировать с любой соседней клетки.
    let dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    for (let d of dirs) {
        let x = player.x + d.x;
        let y = player.y + d.y;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        if (map[y][x] === 'B' || map[y][x] === 'L') {
            return {x, y};
        }
    }

    return null;
}

function getFacingFountain(){
    // Фонтан можно использовать кнопкой, если игрок стоит на нём или рядом с ним.
    if (playerUnderTile === 'F') {
        return {x: player.x, y: player.y};
    }

    let t = getFacingTile();
    if (t.x >= 0 && t.x < size && t.y >= 0 && t.y < size && map[t.y][t.x] === 'F') {
        return t;
    }

    // Не привязываем к направлению взгляда: кнопка появляется с любой соседней клетки.
    let dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    for (let d of dirs) {
        let x = player.x + d.x;
        let y = player.y + d.y;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        if (map[y][x] === 'F') return {x, y};
    }

    return null;
}
function beginMoveCooldown(){
 movementBusy=true;
 setTimeout(()=>{movementBusy=false;},MOVE_DELAY_MS);
}
function scheduleMoveVisualReset(){
 if(playerClass==='warrior'){
  playerSpriteState='walk';
  if(spriteResetTimer) clearTimeout(spriteResetTimer);
  spriteResetTimer=setTimeout(()=>{
   playerSpriteState='idle';
   lastMoveDir={x:0,y:0};
   drawMap();
  }, MOVE_DELAY_MS + 20);
 }else{
  setTimeout(()=>{lastMoveDir={x:0,y:0};drawMap();}, MOVE_DELAY_MS + 20);
 }
}
function isWalkableSymbol(s){
 return s==='.'||s==='@'||s==='M'||s==='C'||s==='+'||s==='>'||s==='$'||s==='L'||s==='B'||s==='F'||s==='R'||s==='T';
}
function getReachableSet(){
 let seen=new Set();
 let q=[{x:player.x,y:player.y}];
 seen.add(key(player.x,player.y));
 let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
 while(q.length){
  let p=q.shift();
  for(let d of dirs){
   let nx=p.x+d.x,ny=p.y+d.y;
   if(nx<0||nx>=size||ny<0||ny>=size)continue;
   let k=key(nx,ny);
   if(seen.has(k))continue;
   if(isWalkableSymbol(map[ny][nx])){seen.add(k);q.push({x:nx,y:ny});}
  }
 }
 return seen;
}
function repairConnectivity(){
 // Гарантия проходимости: если генерация случайно создала изолированный кусок,
 // прокладываем узкий коридор к ближайшей доступной клетке.
 for(let pass=0;pass<20;pass++){
  let seen=getReachableSet();
  let unreachable=[];
  let reachable=[];
  for(let y=1;y<size-1;y++){
   for(let x=1;x<size-1;x++){
    if(isWalkableSymbol(map[y][x])){
     if(seen.has(key(x,y)))reachable.push({x,y});
     else unreachable.push({x,y});
    }
   }
  }
  if(unreachable.length===0)return;
  if(reachable.length===0)return;
  let u=unreachable[0];
  let best=reachable[0];
  let bestD=9999;
  for(let r of reachable){let d=Math.abs(r.x-u.x)+Math.abs(r.y-u.y);if(d<bestD){bestD=d;best=r;}}
  let x=u.x,y=u.y;
  while(x!==best.x){ if(map[y][x]==='#')map[y][x]='.'; x += x<best.x?1:-1; }
  while(y!==best.y){ if(map[y][x]==='#')map[y][x]='.'; y += y<best.y?1:-1; }
  if(map[y][x]==='#')map[y][x]='.';
 }
}
function inside(x,y){return x>0&&x<size-1&&y>0&&y<size-1;}
function generateMapOnce(){
 map=[];monsters={};chestOpeningCells=new Set();shopStock=[];merchantExists=false;resetFogMemory();merchantPurchases=0;pendingFatalDamage=null;beaconUsed=false;beaconExists=false;fountainUsed=false;fountainExists=false;revealFogActive=false;if(beaconRevealTimer){clearTimeout(beaconRevealTimer);beaconRevealTimer=null;}hideActionPanel();
 for(let y=0;y<size;y++){map[y]=[];for(let x=0;x<size;x++)map[y][x]='#';}
 let x=1,y=1,path=[{x,y}];map[y][x]='.';let currentDir={x:1,y:0};
 for(let i=0;i<220;i++){if(random(1,100)<=35){let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];currentDir=dirs[random(0,dirs.length-1)];}
  let nx=x+currentDir.x,ny=y+currentDir.y;if(nx<=0||nx>=size-1||ny<=0||ny>=size-1){currentDir={x:random(-1,1),y:random(-1,1)};if(currentDir.x!==0)currentDir.y=0;if(currentDir.x===0&&currentDir.y===0)currentDir.y=1;continue;}
  x=nx;y=ny;map[y][x]='.';path.push({x,y});}
 player.x=1;player.y=1;playerUnderTile='.';map[1][1]='@';
 placeChestsWithFallingChance();placePotionsWithFallingChance();
 if(random(1,100)<=70)placeMerchantRoom(path); if(random(1,100)<=55)placeTreasureRoom(path);
 spawnMonstersByBudget();
 placeBeacon(path);
 // Сначала чиним связность всей карты, и только потом ставим выход.
 // Иначе автопочинка может прорубить дополнительный проход к выходу.
 repairConnectivity();
 let exitPlaced = placeStrictExitWithGuard(path);
 if(exitPlaced) placeFountain();
 return exitPlaced;
}

function generateMap(){
 resetMapGrid();
 for(let attempt=1; attempt<=70; attempt++){
  let exitPlaced = generateMapOnce();
  if(exitPlaced && validateGeneratedMap()){
   return;
  }
 }
 // Последняя страховка: ещё одна пачка попыток, но без ломания рендера.
 for(let attempt=1; attempt<=70; attempt++){
  let exitPlaced = generateMapOnce();
  if(exitPlaced && validateGeneratedMap()) return;
 }
 log('⚠️ Генерация не смогла найти идеальный выход. Нажми Начать заново, если выход не появился.');
}
function getFloorBudget(){
 return FLOOR_DIFFICULTY_BUDGET[level] || (26 + (level-10)*3);
}
function getMonsterDifficulty(type, strong=false, elite=false, exitGuard=false){
 let points=0;
 if(type==='mercenary'){
  points = elite ? UNIT_DIFFICULTY.mercenaryElite : (strong ? UNIT_DIFFICULTY.mercenaryStrong : UNIT_DIFFICULTY.mercenary);
 }else{
  points = elite ? UNIT_DIFFICULTY.skeletonElite : (strong ? UNIT_DIFFICULTY.skeletonStrong : UNIT_DIFFICULTY.skeleton);
 }
 if(exitGuard) points += UNIT_DIFFICULTY.exitGuardBonus;
 return points;
}
function getEnemyBalance(type, strong=false, elite=false, exitGuard=false){
 let lvl=Math.max(1,Math.min(10,level));
 let base=ENEMY_LEVEL_BALANCE[lvl][type] || ENEMY_LEVEL_BALANCE[lvl].skeleton;
 let mhp=base.hp;
 let dmgMin=base.dmg[0];
 let dmgMax=base.dmg[1];

 if(strong){
  mhp=Math.round(mhp*1.25 + 4);
  dmgMin+=1+Math.floor(lvl/5);
  dmgMax+=1+Math.floor(lvl/5);
 }
 if(elite){
  mhp=Math.round(mhp*1.45 + 6);
  dmgMin+=2+Math.floor(lvl/4);
  dmgMax+=2+Math.floor(lvl/4);
 }
 if(exitGuard){
  mhp+=6+Math.floor(lvl*1.5);
  dmgMin+=1;
  dmgMax+=1;
 }

 if(dmgMax < dmgMin) dmgMax=dmgMin;
 return {hp:mhp, minDamage:dmgMin, maxDamage:dmgMax};
}
function getMonsterDamageRange(monster){
 let min=monster.minDamage ?? 1;
 let max=monster.maxDamage ?? monster.damage ?? min;
 if(max < min) max=min;
 return {min,max};
}
function spawnMonstersByBudget(){
 let budget=getFloorBudget();
 let spent=0;
 let safety=0;
 while(spent < budget && safety < 80){
  safety++;
  let pos=getRandomEmptyFloorNoMonsterNear();
  if(!pos)break;
  let roll=random(1,100);
  let type='skeleton';
  let strong=false;
  let elite=false;
  // Скелеты — дешёвая основа этажа. Наёмники реже: меньше HP, но выше урон.
  if(roll <= Math.min(14 + level, 28)) type='mercenary';
  if(level>=4 && random(1,100) <= Math.min(3 + level, 12)) elite=true;
  if(level>=5 && !elite && random(1,100)<=14) strong=true;
  let cost=getMonsterDifficulty(type,strong,elite,false);
  if(spent + cost > budget + 2 && spent>0) continue;
  if(type==='mercenary') createMercenary(pos.x,pos.y,false,elite);
  else createSkeleton(pos.x,pos.y,strong,elite,false);
  spent += cost;
 }
}
function validateGeneratedMap(){
 if(!map || map.length!==size) return false;
 let exit=findTile('>');
 if(!exit) return false;
 if(!map[player.y] || map[player.y][player.x] !== '@') return false;

 let exitInfo = getExitSealInfo(exit.x, exit.y);
 if(!exitInfo.valid) return false;
 let guard = exitInfo.guard;
 if(!guard) return false;
 if(Math.abs(guard.x-player.x)+Math.abs(guard.y-player.y) < 6) return false;

 let seen=getReachableSet();
 if(!seen.has(key(guard.x,guard.y))) return false;
 if(!seen.has(key(exit.x,exit.y))) return false;
 if(seen.size < 35) return false;

 // Старт не должен быть карманом, где единственная соседняя клетка сразу охранник выхода.
 let startOptions = countWalkableNeighbors(player.x, player.y, false);
 if(startOptions < 1) return false;
 if(Math.abs(guard.x-player.x)+Math.abs(guard.y-player.y) <= 2) return false;

 return true;
}
function findTile(symbol){
 for(let y=0;y<size;y++){
  for(let x=0;x<size;x++){
   if(map[y][x]===symbol) return {x,y};
  }
 }
 return null;
}


function isRoomTileForBeacon(x, y) {
    if (x < 0 || x >= size || y < 0 || y >= size) return true;
    let s = map[y][x];
    return s === 'R' || s === 'T' || s === '$' || s === 'C';
}

function isSafeBeaconSpot(x, y) {
    if (!inside(x, y)) return false;

    // Светоч не должен менять геометрию карты:
    // ставим только на уже существующий обычный пол/коридор.
    if (map[y][x] !== '.') return false;

    // Не ставим рядом со стартом, выходом, монстрами и важными объектами.
    for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
            let nx = x + xx;
            let ny = y + yy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) return false;

            // 3x3 вокруг светоча должен быть свободен от врагов и комнат.
            if (map[ny][nx] === 'M') return false;
            if (map[ny][nx] === 'R' || map[ny][nx] === 'T' || map[ny][nx] === '$' || map[ny][nx] === 'C') return false;
            if (map[ny][nx] === '>' || map[ny][nx] === '+') return false;
        }
    }

    // Не ставим вплотную к торговцу/сокровищнице: иначе визуально ломает комнату.
    for (let yy = -2; yy <= 2; yy++) {
        for (let xx = -2; xx <= 2; xx++) {
            let nx = x + xx;
            let ny = y + yy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            if (isRoomTileForBeacon(nx, ny)) return false;
        }
    }

    return true;
}

function clearEnemiesAroundBeacon(x, y) {
    // На всякий случай: даже если враги появились позже, 8 клеток вокруг очищаются.
    for (let yy = -1; yy <= 1; yy++) {
        for (let xx = -1; xx <= 1; xx++) {
            let nx = x + xx;
            let ny = y + yy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            if (map[ny][nx] === 'M') {
                map[ny][nx] = '.';
                delete monsters[key(nx, ny)];
            }
        }
    }
}



function canPlaceBeaconRoom(cx, cy) {
    if (!inside(cx, cy)) return false;

    // 3x3 комната + 1 клетка стен вокруг. Не пересекаем важные постройки/объекты.
    for (let yy = -2; yy <= 2; yy++) {
        for (let xx = -2; xx <= 2; xx++) {
            let x = cx + xx;
            let y = cy + yy;
            if (!inside(x, y)) return false;

            let s = map[y][x];

            // Нельзя ломать уже существующие специальные объекты и комнаты.
            if (s === 'C' || s === '$' || s === '>' || s === 'M' || s === 'T' || s === 'R' || s === 'B' || s === 'L') {
                return false;
            }
        }
    }

    return true;
}

function findNearestRoadForBeaconRoom(cx, cy) {
    let best = null;
    let bestDist = 9999;

    for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
            if (map[y][x] !== '.') continue;
            let d = Math.abs(x - cx) + Math.abs(y - cy);
            if (d < bestDist) {
                bestDist = d;
                best = {x, y};
            }
        }
    }
    return best;
}

function carveCorridorNoDestroyForBeacon(x1, y1, x2, y2) {
    let x = x1;
    let y = y1;
    let cells = [];

    while (x !== x2) {
        x += x < x2 ? 1 : -1;
        cells.push({x, y});
    }
    while (y !== y2) {
        y += y < y2 ? 1 : -1;
        cells.push({x, y});
    }

    // Коридор нельзя вести через объекты/спецкомнаты, но через стены и обычный пол можно.
    for (let c of cells) {
        if (!inside(c.x, c.y)) return false;
        let s = map[c.y][c.x];
        if (!(s === '#' || s === '.')) return false;
    }

    for (let c of cells) {
        if (map[c.y][c.x] === '#') map[c.y][c.x] = '.';
    }

    return true;
}

function placeBeacon(path) {
    return placeBeaconRoom(path);
}


function placeBeacon(path) {
    if (typeof beaconUsed === 'undefined') window.beaconUsed = false;
    beaconUsed = false;

    // Светоч НЕ вырезает новую комнату и НЕ меняет стены вокруг.
    // Он просто ставится на уже существующий проходимый пол около центра карты.
    let center = Math.floor(size / 2);
    let candidates = [];

    for (let radius = 0; radius <= 7; radius++) {
        for (let y = center - radius; y <= center + radius; y++) {
            for (let x = center - radius; x <= center + radius; x++) {
                if (!inside(x, y)) continue;
                if (Math.abs(x - center) !== radius && Math.abs(y - center) !== radius) continue;
                if (isSafeBeaconSpot(x, y)) {
                    candidates.push({x, y, d: Math.abs(x - center) + Math.abs(y - center)});
                }
            }
        }
        if (candidates.length > 0) break;
    }

    // Если около центра безопасной клетки нет — лучше не ставить светоч,
    // чем ломать торговца/сокровищницу или резать стены.
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.d - b.d);
    let spot = candidates[random(0, Math.min(candidates.length - 1, 4))];

    map[spot.y][spot.x] = 'B';
    clearEnemiesAroundBeacon(spot.x, spot.y);
}



function isSafeFountainSpot(x, y) {
    if (!inside(x, y)) return false;
    if (map[y][x] !== '.') return false;

    // Не ставим слишком близко к старту игрока.
    if (Math.abs(x - player.x) + Math.abs(y - player.y) < 4) return false;

    let exit = findTile('>');
    if (exit && Math.abs(x - exit.x) + Math.abs(y - exit.y) < 4) return false;

    // Фонтан не должен прилипать к врагам, комнатам, выходу, сундукам, зельям и светочу.
    for (let yy = -2; yy <= 2; yy++) {
        for (let xx = -2; xx <= 2; xx++) {
            let nx = x + xx;
            let ny = y + yy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            let s = map[ny][nx];
            if (s === 'M' || s === '>' || s === 'C' || s === '+' || s === '$' || s === 'B' || s === 'L') return false;
            if (s === 'R' || s === 'T') return false;
        }
    }

    return true;
}

function placeFountain() {
    fountainUsed = false;
    fountainExists = false;

    // 30% шанс на этаж, максимум один фонтан.
    if (random(1, 100) > 30) return;

    let candidates = [];
    for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
            if (isSafeFountainSpot(x, y)) candidates.push({x, y});
        }
    }

    // Если карта тесная, ослабляем фильтр: всё равно только обычный пол и не рядом со стартом/выходом.
    if (candidates.length === 0) {
        for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
                if (map[y][x] !== '.') continue;
                if (Math.abs(x - player.x) + Math.abs(y - player.y) < 4) continue;
                let exit = findTile('>');
                if (exit && Math.abs(x - exit.x) + Math.abs(y - exit.y) < 4) continue;
                if (!hasMonsterNear(x, y)) candidates.push({x, y});
            }
        }
    }

    if (candidates.length === 0) return;
    let spot = candidates[random(0, candidates.length - 1)];
    map[spot.y][spot.x] = 'F';
    fountainExists = true;
}

function getPathPointForRoom(path){for(let tries=0;tries<100;tries++){let p=path[random(10,Math.max(10,path.length-10))];let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];let dir=dirs[random(0,dirs.length-1)];let door={x:p.x+dir.x,y:p.y+dir.y};let center={x:p.x+dir.x*3,y:p.y+dir.y*3};if(inside(center.x,center.y)&&inside(door.x,door.y)&&canCarveRoom(center.x,center.y))return{anchor:p,door,center,dir};}return null;}
function canCarveRoom(cx,cy){for(let yy=-2;yy<=2;yy++){for(let xx=-2;xx<=2;xx++){let x=cx+xx,y=cy+yy;if(!inside(x,y))return false;if(map[y][x]!=='#')return false;}}return true;}
function carveOneTileEntranceRoom(room,type){let {anchor,door,center,dir}=room;for(let yy=-2;yy<=2;yy++){for(let xx=-2;xx<=2;xx++){let x=center.x+xx,y=center.y+yy;if(inside(x,y))map[y][x]='#';}}
 for(let yy=-1;yy<=1;yy++){for(let xx=-1;xx<=1;xx++){let x=center.x+xx,y=center.y+yy;if(inside(x,y))map[y][x]=type;}}
 map[anchor.y][anchor.x]='.';map[door.y][door.x]='.';let entryX=center.x-dir.x*2,entryY=center.y-dir.y*2;if(inside(entryX,entryY))map[entryY][entryX]='.';}
function placeMerchantRoom(path){let room=getPathPointForRoom(path);if(!room)return;carveOneTileEntranceRoom(room,'R');map[room.center.y][room.center.x]='$';merchantExists=true;generateShopOnce();
 if(random(1,100)<=30){let gx=room.door.x+room.dir.x,gy=room.door.y+room.dir.y;if(inside(gx,gy)&&map[gy][gx]==='R'){if(random(1,100)<=50)createSkeleton(gx,gy,false,false,false);else createMercenary(gx,gy,false,false);}}
}
function placeTreasureRoom(path){let room=getPathPointForRoom(path);if(!room)return;carveOneTileEntranceRoom(room,'T');let cells=[{x:room.center.x,y:room.center.y},{x:room.center.x+1,y:room.center.y},{x:room.center.x-1,y:room.center.y},{x:room.center.x,y:room.center.y+1},{x:room.center.x,y:room.center.y-1}].filter(p=>inside(p.x,p.y));let shuffled=cells.slice().sort(()=>Math.random()-0.5);map[shuffled[0].y][shuffled[0].x]='C';map[shuffled[1].y][shuffled[1].x]='C';if(random(1,100)<=50)createSkeleton(room.door.x,room.door.y,true,true,false);else createMercenary(room.door.x,room.door.y,false,true);}
function countWalkableNeighbors(x,y,includeExit=true){
 let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
 let count=0;
 for(let d of dirs){
  let nx=x+d.x, ny=y+d.y;
  if(nx<0||nx>=size||ny<0||ny>=size) continue;
  let s=map[ny][nx];
  if(s==='#') continue;
  if(!includeExit && s==='>') continue;
  if(isWalkableSymbol(s)) count++;
 }
 return count;
}

function getExitSealInfo(exitX,exitY){
 let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
 let guard=null, wallCount=0, openCount=0;
 for(let d of dirs){
  let nx=exitX+d.x, ny=exitY+d.y;
  if(nx<0||nx>=size||ny<0||ny>=size){wallCount++;continue;}
  let s=map[ny][nx];
  if(s==='#') wallCount++;
  else if(s==='M'){guard={x:nx,y:ny,dx:d.x,dy:d.y};openCount++;}
  else if(isWalkableSymbol(s)) openCount++;
 }
 return {valid: !!guard && wallCount===3 && openCount===1, guard, wallCount, openCount};
}

function clearTileForExit(x,y){
 if(!inside(x,y)) return;
 let k=key(x,y);
 if(monsters[k]) delete monsters[k];
 map[y][x]='#';
}

function placeStrictExitWithGuard(path){
 // Новый выход ставится как отдельная ниша от главного коридора:
 // 3 стены вокруг выхода, 1 вход, на входе охранник.
 // Guard стоит на существующей дороге, exit за ним в стене.
 let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
 let candidates=[];
 for(let i=path.length-1;i>=0;i--){
  let p=path[i];
  if(!inside(p.x,p.y)) continue;
  if(map[p.y][p.x] !== '.') continue;
  if(Math.abs(p.x-player.x)+Math.abs(p.y-player.y) < 8) continue;
  for(let d of dirs){
   let exit={x:p.x+d.x,y:p.y+d.y};
   let side1={x:exit.x+d.y,y:exit.y+d.x};
   let side2={x:exit.x-d.y,y:exit.y-d.x};
   let back={x:exit.x+d.x,y:exit.y+d.y};
   if(!inside(exit.x,exit.y)||!inside(side1.x,side1.y)||!inside(side2.x,side2.y)||!inside(back.x,back.y)) continue;
   if(map[exit.y][exit.x] !== '#') continue;
   // Не ставим выход прямо рядом с комнатными объектами, чтобы не ломать сокровищницу/торговца.
   let bad=false;
   for(let yy=-1; yy<=1; yy++){
    for(let xx=-1; xx<=1; xx++){
     let tx=exit.x+xx, ty=exit.y+yy;
     if(!inside(tx,ty)) continue;
     if(map[ty][tx]==='$'||map[ty][tx]==='C'||map[ty][tx]==='L') bad=true;
    }
   }
   if(bad) continue;
   candidates.push({guard:p,exit,side1,side2,back,dir:d});
  }
 }
 if(!candidates.length) return false;
 candidates.sort((a,b)=>(Math.abs(b.guard.x-player.x)+Math.abs(b.guard.y-player.y))-(Math.abs(a.guard.x-player.x)+Math.abs(a.guard.y-player.y)));
 // Берём дальний вариант, чтобы старт никогда не оказался заперт выходным охранником.
 let pick=candidates[random(0, Math.min(candidates.length-1, Math.max(0, Math.floor(candidates.length*0.25))))];

 // Убираем старые выходы, если они вдруг остались.
 for(let y=1;y<size-1;y++) for(let x=1;x<size-1;x++) if(map[y][x]==='>') map[y][x]='#';

 clearTileForExit(pick.side1.x,pick.side1.y);
 clearTileForExit(pick.side2.x,pick.side2.y);
 clearTileForExit(pick.back.x,pick.back.y);
 clearTileForExit(pick.exit.x,pick.exit.y);

 map[pick.exit.y][pick.exit.x]='>';
 map[pick.guard.y][pick.guard.x]='M';
 delete monsters[key(pick.guard.x,pick.guard.y)];
 if(random(1,100)<=70) createSkeleton(pick.guard.x,pick.guard.y,true,false,true);
 else createMercenary(pick.guard.x,pick.guard.y,true,false);
 return getExitSealInfo(pick.exit.x,pick.exit.y).valid;
}

function forceExitWithGuard(exitPos,path){
 return placeStrictExitWithGuard(path);
}
function placeChestsWithFallingChance(){for(let chance of [85,40,18,8]){if(random(1,100)<=chance){let chest=getRandomEmptyFloor();map[chest.y][chest.x]='C';if(random(1,100)<=50)placeMonsterNear(chest.x,chest.y,false);}}}
function placePotionsWithFallingChance(){for(let chance of [45,20,8]){if(random(1,100)<=chance){let p=getRandomEmptyFloor();map[p.y][p.x]='+';}}}
function getRandomEmptyFloor(){let x,y,tries=0;do{x=random(1,size-2);y=random(1,size-2);tries++;if(tries>300)return{x:1,y:1};}while(map[y][x]!=='.'&&map[y][x]!=='R'&&map[y][x]!=='T');return{x,y};}
function getRandomEmptyFloorNoMonsterNear(){for(let tries=0;tries<100;tries++){let pos=getRandomEmptyFloor();if(!hasMonsterNear(pos.x,pos.y))return pos;}return null;}
function hasMonsterNear(x,y){let dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];for(let d of dirs){let nx=x+d.x,ny=y+d.y;if(nx>=0&&nx<size&&ny>=0&&ny<size&&map[ny][nx]==='M')return true;}return false;}
function placeMonsterNear(x,y,strong){let spots=[{x:x+1,y},{x:x-1,y},{x,y:y+1},{x,y:y-1}].filter(p=>inside(p.x,p.y)&&map[p.y][p.x]==='.'&&!hasMonsterNear(p.x,p.y));if(!spots.length)return;let s=spots[random(0,spots.length-1)];createRandomMonster(s.x,s.y,strong,false,false);}
function createRandomMonster(x,y,strong=false,elite=false,exitGuard=false){if(!strong&&!elite&&!exitGuard&&random(1,100)<=25)createMercenary(x,y,false,false);else createSkeleton(x,y,strong,elite,exitGuard);}
function createSkeleton(x,y,strong=false,elite=false,exitGuard=false){
 map[y][x]='M';
 let b=getEnemyBalance('skeleton',strong,elite,exitGuard);
 monsters[key(x,y)]={name:'Скелет',type:'skeleton',hp:b.hp,maxHp:b.hp,minDamage:b.minDamage,maxDamage:b.maxDamage,damage:b.maxDamage,strong,elite,exitGuard,bribe:null,stabUsed:false,stunUsed:false,stunnedForCrit:false};
}
function createMercenary(x,y,exitGuard=false,elite=false){
 map[y][x]='M';
 let b=getEnemyBalance('mercenary',exitGuard,elite,exitGuard);
 monsters[key(x,y)]={name:'Наёмник',type:'mercenary',hp:b.hp,maxHp:b.hp,minDamage:b.minDamage,maxDamage:b.maxDamage,damage:b.maxDamage,strong:exitGuard,elite,exitGuard,bribe:Math.floor((18+level*6)*(elite?1.6:1)),stabUsed:false,stunUsed:false,stunnedForCrit:false};
}
function isVisible(x,y){
 if(litCells.has(key(x,y)))return true;
 let dx=Math.abs(player.x-x),dy=Math.abs(player.y-y);
 if(Math.max(dx,dy)>visionRange)return false;
 return hasLineOfSight(player.x,player.y,x,y);
}
function hasLineOfSight(x1,y1,x2,y2){let dx=x2-x1,dy=y2-y1,steps=Math.max(Math.abs(dx),Math.abs(dy));for(let i=1;i<steps;i++){let x=Math.round(x1+dx*i/steps),y=Math.round(y1+dy*i/steps);if(map[y][x]==='#')return false;}return true;}

function animateEntityAt(x,y,cls){
 let ent=document.querySelector('.entityOverlay[data-x="'+x+'"][data-y="'+y+'"]');
 if(!ent)return;
 ent.classList.remove(cls);
 void ent.offsetWidth;
 ent.classList.add(cls);
 setTimeout(()=>ent.classList.remove(cls),180);
}
function animateEnemyHit(x,y){animateEntityAt(x,y,'hitEnemy');}
function animatePlayerHit(){
 const overlay=document.getElementById('playerOverlay');
 if(!overlay)return;
 overlay.classList.remove('hitPlayer');
 void overlay.offsetWidth;
 overlay.classList.add('hitPlayer');
 setTimeout(()=>overlay.classList.remove('hitPlayer'),180);
}


function updatePlayerOverlay(instant=false){
 const overlay=document.getElementById('playerOverlay');
 if(!overlay)return;
 const tileSize=TILE_SIZE;
 overlay.classList.toggle('instantMove', !!instant);
 overlay.classList.toggle('facingLeft', spriteFacingX<0);
 overlay.classList.toggle('facingRight', spriteFacingX>=0);
 overlay.classList.toggle('playerWalking', playerSpriteState==='walk');
 overlay.style.left=(player.x*tileSize + tileSize/2)+'px';
 overlay.style.top=(player.y*tileSize + tileSize/2)+'px';
 overlay.innerHTML=playerVisualHtml()+'<span class="facingArrow">'+facingSymbol()+'</span>';
 if(instant){
  void overlay.offsetWidth;
  overlay.classList.remove('instantMove');
 }
}


function isRoadLikeSymbol(s){
 return s==='.'||s==='@'||s==='M'||s==='C'||s==='+'||s==='>'||s==='$'||s==='L'||s==='B'||s==='F'||s==='R'||s==='T';
}
function wallTouchesRoad(x,y){
 let dirs=[{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:1,y:1},{x:-1,y:-1},{x:1,y:-1},{x:-1,y:1}];
 for(let d of dirs){
  let nx=x+d.x,ny=y+d.y;
  if(nx>=0&&nx<size&&ny>=0&&ny<size&&isRoadLikeSymbol(map[ny][nx])) return true;
 }
 return false;
}

function tileHash(x,y,salt=0){
 let h=(x*73856093)^(y*19349663)^(level*83492791)^(salt*2654435761);
 h=(h>>>0);
 return h%100;
}
function floorVariantClass(x,y){
 // Визуальное разнообразие пола: тот же материал, но трещины/потёртости редкими пятнами.
 // Паттерн детерминированный, поэтому не мигает при перерисовке.
 let patchX=Math.floor(x/2), patchY=Math.floor(y/2);
 let h=tileHash(patchX,patchY,11);
 if(h<12) return 'floorCrackA';
 if(h<22) return 'floorCrackB';
 if(h<32) return 'floorWorn';
 return 'floorPlain';
}
function roomVariantClass(x,y){
 let h=tileHash(Math.floor(x/2),Math.floor(y/2),17);
 if(h<18) return 'floorCrackA';
 if(h<30) return 'floorWorn';
 return 'floorPlain';
}
function wallVariantClass(x,y){
 let h=tileHash(x,y,23);
 if(h<12) return 'wallLightCrack';
 if(h<22) return 'wallLightWorn';
 return 'wallLightPlain';
}


function isVisibleWallTile(x,y){
 if(x<0||x>=size||y<0||y>=size)return false;
 return map[y][x]==='#' && wallTouchesRoad(x,y);
}
function isFloorLikeTileSymbolAt(x,y){
 if(x<0||x>=size||y<0||y>=size)return false;
 return isRoadLikeSymbol(map[y][x]);
}
function applyDepthClasses(cell,x,y,s){
 if(s==='#'){
  if(isFloorLikeTileSymbolAt(x,y+1)) cell.classList.add('wallHasFloorBelow');
  if(isFloorLikeTileSymbolAt(x,y-1)) cell.classList.add('wallHasFloorAbove');
  if(isFloorLikeTileSymbolAt(x-1,y)) cell.classList.add('wallHasFloorLeft');
  if(isFloorLikeTileSymbolAt(x+1,y)) cell.classList.add('wallHasFloorRight');
  return;
 }
 if(!isRoadLikeSymbol(s) && s!=='R' && s!=='T') return;
 if(isVisibleWallTile(x,y-1)) cell.classList.add('aoTop');
 if(isVisibleWallTile(x,y+1)) cell.classList.add('aoBottom');
 if(isVisibleWallTile(x-1,y)) cell.classList.add('aoLeft');
 if(isVisibleWallTile(x+1,y)) cell.classList.add('aoRight');
 if(isVisibleWallTile(x-1,y-1)) cell.classList.add('aoCornerTL');
 if(isVisibleWallTile(x+1,y-1)) cell.classList.add('aoCornerTR');
 if(isVisibleWallTile(x-1,y+1)) cell.classList.add('aoCornerBL');
 if(isVisibleWallTile(x+1,y+1)) cell.classList.add('aoCornerBR');
 if(litCells.has(key(x,y))) cell.classList.add('beaconLitTile');
}

function applyBaseTileClass(cell,s){
 if(s==='R') cell.classList.add('room');
 else if(s==='T') cell.classList.add('treasure');
 else cell.classList.add('floor');
}
function drawVisibleCell(cell,s,x,y){
 if(s==='@'){
  cell.classList.add('floor');
  cell.classList.add('playerCellFloor');
  cell.classList.add(floorVariantClass(x,y));
 }else if(s==='M'||s==='C'||s==='+'||s==='>'||s==='$'||s==='L'||s==='B'||s==='F'){
  // Entities are rendered on #entityLayer, never inside the tile itself.
  // This keeps floor tiles stable and prevents hurt/attack animations from shaking the map.
  cell.classList.add('floor');
  cell.classList.add(floorVariantClass(x,y));
 }else if(s==='R'){
  cell.classList.add('room');
  cell.classList.add(roomVariantClass(x,y));
 }else if(s==='T'){
  cell.classList.add('treasure');
 }else if(s==='#'){
  if(wallTouchesRoad(x,y)){
   cell.classList.add('wall');
   cell.classList.add(wallVariantClass(x,y));
  }else cell.classList.add('voidWall');
 }else{
  cell.classList.add('floor');
  cell.classList.add(floorVariantClass(x,y));
 }
 applyDepthClasses(cell,x,y,s);
}

function entityVisualHtml(s,x,y){
 if(s==='M'){
  let m=monsters[key(x,y)];
  return monsterVisualHtml(m,x,y);
 }
 if(s==='C') {
  let k=key(x,y);
  if(chestOpeningCells.has(k)) return '<img class="tileIcon bitcrawlChestIcon chestOpening" src="assets/bitcrawl_chest_open.gif?open='+Date.now()+'" alt="Сундук открывается">';
  return '<img class="tileIcon bitcrawlChestIcon" src="assets/bitcrawl_chest_closed.png" alt="Сундук">';
 }
 if(s==='+') return '<span class="entityEmoji">🧪</span>';
 if(s==='>') return '<span class="entityEmoji">🕳️</span>';
 if(s==='$') return '<span class="entityEmoji merchantEmoji">🧙‍♂️</span>';
 // L и B — светоч. Визуально это пользовательский анимированный светоч.
 if(s==='L'||s==='B') return '<img class="tileIcon bitcrawlTorchIcon" src="assets/bitcrawl_torch_pole.gif" alt="Светоч">';
 if(s==='F') return '<span class="fountainSprite">⛲</span>'; return '';
}
function isVisibleByPlayerLight(x,y){
 let dx=Math.abs(player.x-x),dy=Math.abs(player.y-y);
 if(Math.max(dx,dy)>visionRange)return false;
 return hasLineOfSight(player.x,player.y,x,y);
}
function renderEntityLayer(){
 const layer=document.getElementById('entityLayer');
 if(!layer)return;
 layer.innerHTML='';
 const tileSize=TILE_SIZE;
 for(let y=0;y<size;y++){
  for(let x=0;x<size;x++){
   let s=map[y][x];
   if(!(s==='M'||s==='C'||s==='+'||s==='>'||s==='$'||s==='L'||s==='B'||s==='F')) continue;
   if(!isVisibleByPlayerLight(x,y)) continue;
   let html=entityVisualHtml(s,x,y);
   if(!html) continue;
   const ent=document.createElement('div');
   ent.className='entityOverlay entity-'+s;
   ent.dataset.x=x;
   ent.dataset.y=y;
   ent.style.left=(x*tileSize + tileSize/2)+'px';
   ent.style.top=(y*tileSize + tileSize/2)+'px';
   ent.innerHTML=html;
   layer.appendChild(ent);
  }
 }
}

function ensureMapGrid(){
 const div=document.getElementById('map');
 if(!div)return;
 if(mapGridReady && mapCells.length===size && mapCells[0] && mapCells[0].length===size)return;
 div.innerHTML='';
 mapCells=[];
 for(let y=0;y<size;y++){
  mapCells[y]=[];
  for(let x=0;x<size;x++){
   const cell=document.createElement('div');
   cell.className='cell';
   cell.dataset.x=x;
   cell.dataset.y=y;
   mapCells[y][x]=cell;
   div.appendChild(cell);
  }
 }
 mapGridReady=true;
}

function resetMapGrid(){
 mapGridReady=false;
 mapCells=[];
 lastFogCells=new Set();
 lastVisibleCells=new Set();
}


function visibleForFogBlend(x,y){
 if(x<0||x>=size||y<0||y>=size) return false;
 return isVisible(x,y);
}

function addFogBleedOverlay(cell,x,y){
 const dirs=[];
 if(!visibleForFogBlend(x,y-1)) dirs.push('N');
 if(!visibleForFogBlend(x,y+1)) dirs.push('S');
 if(!visibleForFogBlend(x-1,y)) dirs.push('W');
 if(!visibleForFogBlend(x+1,y)) dirs.push('E');
 if(!visibleForFogBlend(x-1,y-1)) dirs.push('NW');
 if(!visibleForFogBlend(x+1,y-1)) dirs.push('NE');
 if(!visibleForFogBlend(x-1,y+1)) dirs.push('SW');
 if(!visibleForFogBlend(x+1,y+1)) dirs.push('SE');
 if(!dirs.length) return;
 cell.classList.add('hasFogBleed');
 const wrap=document.createElement('div');
 wrap.className='fogBleedLayer';
 for(const d of dirs){
  const e=document.createElement('span');
  e.className='fogBleed fogBleed'+d;
  wrap.appendChild(e);
 }
 cell.appendChild(wrap);
}

function drawMap(){
 ensureMapGrid();
 rememberVisibleCells();
 const newFogCells=new Set();
 const newVisibleCells=new Set();
 for(let y=0;y<size;y++){
  for(let x=0;x<size;x++){
   const cell=mapCells[y][x];
   cell.className='cell';
   cell.innerHTML='';
   let s=map[y][x],visible=isVisible(x,y),k=key(x,y);
   let wasVisible=lastVisibleCells.has(k);
   if(s==='#'&&!wallTouchesRoad(x,y)){
    cell.classList.add('voidWall');
    continue;
   }
   if(!visible){
    // В тумане после обнаружения показываем только силуэт стен и метку выхода. Пол не запоминается визуально.
    if(discoveredExits.has(k)){
     cell.classList.add('rememberedExit');
     cell.innerHTML='<span class="rememberedExitMark">⇩</span>';
    }else if(discoveredWalls.has(k)){
     cell.classList.add('rememberedWall');
    }else{
     cell.classList.add('fogSmoke');
     newFogCells.add(k);
    }
    if(wasVisible) cell.classList.add('fogReturning');
    continue;
   }
   newVisibleCells.add(k);
   drawVisibleCell(cell,s,x,y);
   // Туман немного заходит только на пол/проходимые клетки.
   // На видимые стены не накладываем bleed, иначе текстура стены мылится и выглядит сломанной.
   if(s!=='#') addFogBleedOverlay(cell,x,y);
   if(!wasVisible) cell.classList.add('fogClearing');
  }
 }
 lastFogCells=newFogCells;
 lastVisibleCells=newVisibleCells;
 renderEntityLayer();
 updatePlayerOverlay();
 updateActionPanel();
}

function move(dx,dy){
 if(gameOver||!gameStarted||pendingFatalDamage||pendingBonusChoices>0)return;
 if(movementBusy||combatBusy)return;
 setFacing(dx,dy);
 beginMoveCooldown();
 let nx=player.x+dx,ny=player.y+dy;
 if(nx<0||nx>=size||ny<0||ny>=size){updateActionPanel();return;}
 let target=map[ny][nx];
 if(target==='#'){
  log('Ты смотришь в стену.');
  lastMoveDir={x:0,y:0};
  drawMap();
  return;
 }
 if(target==='M'){
  let m=monsters[key(nx,ny)];
  log('Перед тобой '+m.name+'. HP: '+m.hp+'/'+m.maxHp);
  lastMoveDir={x:0,y:0};
  drawMap();
  return;
 }
 if(target==='$'){
  log('Перед тобой торговец.');
  lastMoveDir={x:0,y:0};
  drawMap();
  return;
 }
 if(target==='C'){
  log('Перед тобой старый сундук.');
  lastMoveDir={x:0,y:0};
  drawMap();
  return;
 }
 if(target==='+'){pickPotion();target='.';}
 if(target==='>'){
  nextLevel();
  return;
 }
 map[player.y][player.x]=playerUnderTile||'.';
 lastMoveDir={x:dx,y:dy};
 playerUnderTile=target;
 player.x=nx;
 player.y=ny;
 map[player.y][player.x]='@';
 scheduleMoveVisualReset();
 registerAction();
 updateStats();
 drawMap();
}
function openChestAt(chest){
 if(!chest||map[chest.y][chest.x]!=='C')return;
 let k=key(chest.x,chest.y);
 if(chestOpeningCells.has(k))return;
 chestOpeningCells.add(k);
 registerAction();
 hideActionPanel();
 drawMap();
 setTimeout(()=>{
  let coins=random(8,22);
  gold+=coins;
  log('Сундук распахнулся. Найдено '+coins+' золота.');
  if(map[chest.y]&&map[chest.y][chest.x]==='C')map[chest.y][chest.x]='.';
  chestOpeningCells.delete(k);
  updateStats();
  drawMap();
 },620);
}
function openFacingChest(){
 let chest=getFacingChest();
 if(!chest){log('Рядом нет сундука.');return;}
 openChestAt(chest);
}
function pickPotion(){if(potions>=potionCapacity){log('Инвентарь зелий полный.');return;}potions++;log('Подобрал зелье.');}
function updateActionPanel(forceShop=false){if(pendingBonusChoices>0){showBonusPanel();return;}if(pendingFatalDamage){showFatalPanel();return;}let enemy=getFacingMonster(),merchant=getFacingMerchant(),beacon=getFacingBeacon(),fountain=getFacingFountain(),chest=getFacingChest();if(enemy){showAttackPanel(enemy);return;}if(merchant||forceShop){showShopPanel();return;}if(beacon){showBeaconPanel();return;}if(fountain){showFountainPanel();return;}if(chest){showChestPanel(chest);return;}hideActionPanel();}
function hideActionPanel(){document.getElementById('actionPanel').style.display='none';}
function showChestPanel(chest){
 document.getElementById('actionPanel').style.display='block';
 document.getElementById('panelTitle').innerHTML='<span class="panelTitleWithIcon"><img class="panelTitleIcon" src="assets/bitcrawl_chest_closed.png" alt="">Сундук</span>';
 document.getElementById('panelInfo').textContent='Старый сундук ждёт, когда его откроют.';
 let k=key(chest.x,chest.y);
 document.getElementById('panelButtons').innerHTML=chestOpeningCells.has(k)?'<button disabled><img class="actionBtnIcon" src="assets/bitcrawl_chest_open.gif" alt="">Открывается...</button>':'<button onclick="openFacingChest()"><img class="actionBtnIcon" src="assets/bitcrawl_chest_open.gif" alt="">Открыть сундук</button>';
}
function showAttackPanel(enemy){let m=monsters[key(enemy.x,enemy.y)];document.getElementById('actionPanel').style.display='block';document.getElementById('panelTitle').textContent=(m.elite?'Элитный ':'')+m.name+' рядом';let extra='';if(m.type==='mercenary')extra+=' | Подкуп: '+m.bribe+' золота';if(m.stabUsed)extra+=' | '+attackLabel('stab')+' нельзя';if(m.stunUsed)extra+=' | '+attackLabel('stun')+' уже пробовал';let dr=getMonsterDamageRange(m);document.getElementById('panelInfo').textContent='HP: '+m.hp+'/'+m.maxHp+' | Урон: '+dr.min+'-'+dr.max+extra;let html=`<button onclick="attack('slash')">${attackLabel('slash')}</button><button onclick="attack('stab')">${attackLabel('stab')}</button><button onclick="attack('stun')">${attackLabel('stun')}</button><button onclick="usePotion()">Выпить зелье</button>`;if(m.type==='mercenary')html+=`<br><button onclick="bribeMercenary()">Подкупить наёмника</button>`;document.getElementById('panelButtons').innerHTML=html;}
function showFatalPanel(){document.getElementById('actionPanel').style.display='block';document.getElementById('panelTitle').textContent='Смертельный удар!';document.getElementById('panelInfo').textContent='Враг нанесет '+pendingFatalDamage+' урона. HP: '+hp+'. Уворот: '+dodgeChance+'%.';document.getElementById('panelButtons').innerHTML=`<button onclick="usePotionBeforeDeath()">Выпить зелье</button><button onclick="tryDodgeFatalDamage()">Попробовать увернуться</button><button onclick="acceptFatalDamage()">Принять удар</button>`;}

function showBeaconPanel(){
 document.getElementById('actionPanel').style.display='block';
 document.getElementById('panelTitle').innerHTML='<span class="panelTitleWithIcon"><img class="panelTitleIcon torchMini" src="assets/bitcrawl_torch_pole.gif" alt="">Светоч</span>';
 document.getElementById('panelInfo').textContent=beaconUsed ? 'Светоч уже погас.' : 'Древнее пламя дрожит во тьме.';
 if(beaconUsed){
  document.getElementById('panelButtons').innerHTML='<button disabled><img class="actionBtnIcon torchMini" src="assets/bitcrawl_torch_pole.gif" alt="">Погас</button>';
 }else{
  document.getElementById('panelButtons').innerHTML='<button onclick="igniteBeaconArea()"><img class="actionBtnIcon torchMini" src="assets/bitcrawl_torch_pole.gif" alt="">Разжечь светоч</button><button onclick="refuelFromBeacon()"><span class="actionGlyphIcon">🪔</span>Поднести факел</button>';
 }
}
function consumeBeacon(beacon){
 beaconUsed=true;
 if(player.x===beacon.x && player.y===beacon.y){
  playerUnderTile='.';
 }else if(map[beacon.y] && (map[beacon.y][beacon.x]==='B'||map[beacon.y][beacon.x]==='L')){
  map[beacon.y][beacon.x]='.';
 }
 beaconExists=false;
}
function triggerBeaconFlash(x,y){
 const layer=document.getElementById('entityLayer');
 if(!layer)return;
 const tileSize=TILE_SIZE;
 const fx=document.createElement('div');
 fx.className='beaconFlashBurst';
 fx.style.left=(x*tileSize + tileSize/2)+'px';
 fx.style.top=(y*tileSize + tileSize/2)+'px';
 layer.appendChild(fx);
 setTimeout(()=>{ if(fx && fx.parentNode) fx.parentNode.removeChild(fx); }, 620);
}

function igniteBeaconArea(){
 let beacon=getFacingBeacon();
 if(!beacon){log('Рядом нет Светоча.');return;}
 if(beaconUsed){log('Светоч уже погас.');return;}
 registerAction();
 lightAreaFromBeacon(beacon.x,beacon.y);
 consumeBeacon(beacon);
 log('Светоч вспыхнул, вырывая из тьмы очертания стен.');
 updateStats();
 drawMap();
 triggerBeaconFlash(beacon.x,beacon.y);
}
function refuelFromBeacon(){
 let beacon=getFacingBeacon();
 if(!beacon){log('Рядом нет Светоча.');return;}
 if(beaconUsed){log('Светоч уже погас.');return;}
 registerAction();
 let restored=restoreTorch(80);
 consumeBeacon(beacon);
 log('Ты подпитал факел древним пламенем. +'+restored+'% света.');
 updateStats();
 drawMap();
 triggerBeaconFlash(beacon.x,beacon.y);
}
// Старое имя оставлено для совместимости сохранений/кнопок старых версий.
function useBeacon(){igniteBeaconArea();}

function showFountainPanel(){
 document.getElementById('actionPanel').style.display='block';
 document.getElementById('panelTitle').innerHTML='<span class="panelTitleWithIcon"><span class="panelGlyphIcon fountainMini">⛲</span>Фонтан жизни</span>';
 if(hp >= maxHp){
  document.getElementById('panelInfo').textContent='HP уже полное: '+hp+'/'+maxHp+'. Фонтан можно оставить на потом.';
  document.getElementById('panelButtons').innerHTML='<button disabled>HP полное</button>';
  return;
 }
 document.getElementById('panelInfo').textContent='Прохладная вода мерцает слабым светом.';
 document.getElementById('panelButtons').innerHTML='<button onclick="useFountain()"><span class="actionGlyphIcon fountainMini">⛲</span>Испить из фонтана</button>';
}

function useFountain(){
 let fountain=getFacingFountain();
 if(!fountain){log('Рядом нет Фонтана жизни.');return;}
 if(hp >= maxHp){log('HP уже полное. Фонтан не потрачен.');showFountainPanel();return;}

 registerAction();
 let percent=random(30,40);
 let heal=Math.max(1, Math.floor(maxHp * percent / 100));
 let oldHp=hp;
 hp=Math.min(maxHp, hp+heal);
 let restored=hp-oldHp;

 if(player.x===fountain.x && player.y===fountain.y){
  playerUnderTile='.';
 }else if(map[fountain.y] && map[fountain.y][fountain.x]==='F'){
  map[fountain.y][fountain.x]='.';
 }
 fountainUsed=true;
 fountainExists=false;

 log('Прохладная вода наполняет вас силами. Восстановлено '+restored+' HP. Фонтан иссяк.');
 updateStats();
 drawMap();
}

function showShopPanel(){document.getElementById('actionPanel').style.display='block';document.getElementById('panelTitle').textContent='Торговец';let mult=merchantPurchases===0?1:1.5;document.getElementById('panelInfo').textContent='Можно купить до 2 предметов. Второй дороже в 1.5 раза. Слоты: '+inventory.length+'/4.';let html='';if(shopStock.length===0||merchantPurchases>=2){html='Торговец больше ничего не продаёт.';}else{for(let i=0;i<shopStock.length;i++){let price=Math.ceil(shopStock[i].price*mult);html+=`<button onclick="buy(${i})">${shopStock[i].name} — ${price} золота</button><br>`;}}document.getElementById('panelButtons').innerHTML=html;}
function attack(type){
 if(gameOver||!gameStarted||pendingFatalDamage||pendingBonusChoices>0||combatBusy)return;
 let enemy=getFacingMonster();
 if(!enemy){log('Перед тобой нет врага. Повернись к цели стрелками.');hideActionPanel();return;}
 registerAction();
 combatBusy=true;
 setPlayerSpriteState('attack',260);
 let monster=monsters[key(enemy.x,enemy.y)],hit=0,enemyCanCounter=true;
 if(type==='slash'){
  hit=rollPlayerDamage();
  log(attackLabel('slash')+': '+hit+' урона.');
 }
 if(type==='stab'){
  if(monster.stabUsed){log(attackLabel('stab')+' уже нельзя использовать на этом враге.');combatBusy=false;return;}
  monster.stabUsed=true;
  hit=rollPlayerDamage();
  let stabCritChance = monster.stunnedForCrit ? 90 : 10;
  if(random(1,100)<=stabCritChance){
   hit=getCriticalDamage();
   log(attackLabel('stab')+': КРИТ! '+hit+' урона.');
  }else{
   log(attackLabel('stab')+': '+hit+' урона.');
  }
  monster.stunnedForCrit=false;
 }
 if(type==='stun'){
  if(monster.stunUsed){log(attackLabel('stun')+' уже пробовал на этом враге.');combatBusy=false;return;}
  monster.stunUsed=true;
  let base=rollPlayerDamage();
  if(random(1,100)<=40){
   hit=Math.max(1,Math.floor(base*0.5));
   enemyCanCounter=false;
   monster.stunnedForCrit=true;
   log(attackLabel('stun')+': '+hit+' урона. Оглушение сработало. Следующий колющий удар имеет 90% шанс крита.');
  }else{
   hit=1;
   enemyCanCounter=true;
   log(attackLabel('stun')+' не сработала. Нанесён минимальный урон.');
  }
 }
 monster.hp-=hit;
 setTimeout(()=>{
  if(monsters[key(enemy.x,enemy.y)]){
   setMonsterSpriteState(enemy.x,enemy.y,'hurt',220);
   animateEnemyHit(enemy.x,enemy.y);
  }
 },120);
 if(monster.hp<=0){
  setTimeout(()=>{
   map[enemy.y][enemy.x]='.';
   delete monsters[key(enemy.x,enemy.y)];
   let reward=monster.elite?random(35,60):monster.strong?random(18,35):random(6,16);
   gold+=reward;
   log(monster.name+' убит. +'+reward+' золота.');
   updateStats();
   drawMap();
   combatBusy=false;
  },330);
  return;
 }
 if(!enemyCanCounter){
  updateStats();
  drawMap();
  setTimeout(()=>{combatBusy=false;updateActionPanel();},280);
  return;
 }
 updateStats();
 drawMap();
 let dr=getMonsterDamageRange(monster);
 let enemyDamage=applyIncomingDamageModifiers(random(dr.min,dr.max));
 let blocked=false;
 if(blockChance>0&&random(1,100)<=blockChance){enemyDamage=0;blocked=true;}
 setTimeout(()=>{
  if(!monsters[key(enemy.x,enemy.y)]||gameOver){combatBusy=false;return;}
  setMonsterSpriteState(enemy.x,enemy.y,'attack',260);
  animateEnemyHit(enemy.x,enemy.y);
  if(blocked){
   log('Щит заблокировал ответный удар!');
  }
  if(hp-enemyDamage<=0&&enemyDamage>0){
   pendingFatalDamage=enemyDamage;
   log('⚠️ Враг готовит смертельный удар!');
   updateStats();
   drawMap();
   combatBusy=false;
   return;
  }
  hp-=enemyDamage;
  log(monster.name+' ударил: -'+enemyDamage+' HP.');
  if(enemyDamage>0){setPlayerSpriteState('hurt',220);animatePlayerHit();}
  updateStats();
  drawMap();
  setTimeout(()=>{combatBusy=false;updateActionPanel();},140);
 },420);
}
function getCriticalDamage(){
 // Крит считается от верхней границы разброса, а не от случайного броска.
 return Math.floor(Math.floor(maxDamage) * critMultiplier);
}

function rollPlayerDamage(){
 let hit=random(Math.floor(minDamage),Math.floor(maxDamage));

 if(playerClass==='assassin'&&random(1,100)<=classCritChance){
  hit=getCriticalDamage();
  // Не вставляем HTML в log(): colorizeLogText сам подсветит слово КРИТ.
  log('🗡️ КРИТ! Убийца бьёт в слабое место: '+hit+' урона.');
  return hit;
 }

 return hit;
}

function bribeMercenary(){let enemy=getFacingMonster();if(!enemy){log('Перед тобой нет наёмника.');return;}let m=monsters[key(enemy.x,enemy.y)];if(m.type!=='mercenary'){log('Скелета нельзя подкупить.');return;}if(gold<m.bribe){log('Не хватает золота. Нужно: '+m.bribe);return;}registerAction();gold-=m.bribe;map[enemy.y][enemy.x]='.';delete monsters[key(enemy.x,enemy.y)];log('Наёмник взял золото и ушёл.');updateStats();drawMap();}
function findNearbyMonster(){let dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];for(let d of dirs){let x=player.x+d.x,y=player.y+d.y;if(x>=0&&x<size&&y>=0&&y<size&&map[y][x]==='M')return{x,y};}return null;}
function findNearbyMerchant(){let dirs=[{x:0,y:-1},{x:0,y:1},{x:-1,y:0},{x:1,y:0}];for(let d of dirs){let x=player.x+d.x,y=player.y+d.y;if(x>=0&&x<size&&y>=0&&y<size&&map[y][x]==='$')return{x,y};}return null;}
function acceptFatalDamage(){if(!pendingFatalDamage)return;hp-=pendingFatalDamage;pendingFatalDamage=null;if(hp<=0){hp=0;gameOver=true;log('<b>Ты умер.</b>');showDeathScreen();}updateStats();drawMap();animatePlayerHit();}
function tryDodgeFatalDamage(){if(!pendingFatalDamage)return;if(random(1,100)<=dodgeChance){log('Уворот сработал!');pendingFatalDamage=null;}else{log('Уворот не сработал.');acceptFatalDamage();return;}updateStats();drawMap();}
function usePotionBeforeDeath(){if(potions<=0){log('Зелий нет.');return;}potions--;hp=Math.min(maxHp,hp+15);let dmg=pendingFatalDamage;pendingFatalDamage=null;if(hp-dmg<=0){hp=0;gameOver=true;log('Зелье не спасло.');showDeathScreen();}else{hp-=dmg;log('Ты пережил удар. -'+dmg+' HP.');}updateStats();drawMap();animatePlayerHit();}
function usePotion(){if(gameOver||!gameStarted)return;if(potions<=0){log('У тебя нет зелий.');return;}if(hp>=maxHp){log('HP уже полное.');return;}registerAction();potions--;hp=Math.min(maxHp,hp+15);log('Зелье: +15 HP.');updateStats();drawMap();}
function generateShopOnce(){const pool=[{name:'Ржавый меч',type:'rustSword',price:45},{name:'Старая кольчуга',type:'chainmail',price:50},{name:'Фляга масла',type:'torchFuel',price:45},{name:'Щит',type:'shield',price:55},{name:'Удобные ботинки',type:'boots',price:45},{name:'Сумка для зелий',type:'potionBag',price:40}];shopStock=[];merchantPurchases=0;while(shopStock.length<2){let item=pool[random(0,pool.length-1)];shopStock.push({...item});}}
function buy(index){let item=shopStock[index];if(!item)return;if(merchantPurchases>=2){log('Торговец уже продал максимум предметов.');return;}let isFuel=item.type==='torchFuel'||item.type==='nightVision';if(!isFuel && inventory.length>=4){log('Инвентарь полон. Нужно 4 слота максимум.');return;}let price=Math.ceil(item.price*(merchantPurchases===0?1:1.5));if(gold<price){log('Не хватает золота. Нужно: '+price);return;}gold-=price;if(!isFuel)inventory.push({name:item.name,type:item.type});applyItem(item);shopStock.splice(index,1);merchantPurchases++;log('Куплено: '+item.name+'.');showShopPanel();updateStats();drawMap();}
function applyItem(item){if(item.type==='rustSword'){minDamage++;maxDamage++;}if(item.type==='chainmail'){maxHp+=5;hp+=5;}if(item.type==='nightVision'||item.type==='torchFuel'){let restored=restoreTorch(50);log('Факел напитался маслом. +'+restored+'% света.');}if(item.type==='shield'){blockChance+=10;}if(item.type==='boots'){dodgeChance+=3;}if(item.type==='potionBag'){potionCapacity++;}clampDamageStats();}
function craftPotion(){
 if(playerClass!=='mage')return;

 if(magePotionCraftedThisLevel){
  log('🧙 Маг уже создал зелье на этом этаже.');
  return;
 }

 if(gold<20){
  log('Не хватает золота для создания зелья. Нужно 20.');
  return;
 }

 if(potions>=potionCapacity){
  log('Инвентарь зелий полный.');
  return;
 }

 gold-=20;
 potions++;
 magePotionCraftedThisLevel=true;
 log('🧙 Маг создал зелье лечения за 20 золота.');
 updateStats();
 saveGameSafe();
}

function generateBonusStock(){const pool=[{name:'Мин. урон +1',type:'minDmg'},{name:'Макс. урон +1',type:'maxDmg'},{name:'Max HP +5',type:'maxHp'},{name:'Зелье лечения',type:'potion'},{name:'Макс. запас факела +25%',type:'torchMax'},{name:'Уворот +5%',type:'dodge'},{name:'Место для зелий +1',type:'potionCap'}];bonusStock=[];while(bonusStock.length<3){let item=pool[random(0,pool.length-1)];if(!bonusStock.some(i=>i.type===item.type))bonusStock.push({...item});}}
function showBonusPanel(){document.getElementById('actionPanel').style.display='block';document.getElementById('panelTitle').textContent='Бонус нового уровня';document.getElementById('panelInfo').textContent='Выбери бонус. Осталось выборов: '+pendingBonusChoices;let html='';for(let i=0;i<bonusStock.length;i++)html+=`<button onclick="takeLevelBonus(${i})">${bonusStock[i].name}</button><br>`;document.getElementById('panelButtons').innerHTML=html;}
function takeLevelBonus(index){let item=bonusStock[index];if(!item||pendingBonusChoices<=0)return;applyBonus(item);bonusStock.splice(index,1);pendingBonusChoices--;updateStats();if(pendingBonusChoices<=0){hideActionPanel();drawMap();}else showBonusPanel();}
function applyBonus(item){if(item.type==='minDmg'){minDamage++;log('Бонус: мин. урон +1.');}if(item.type==='maxDmg'){maxDamage++;log('Бонус: макс. урон +1.');}if(item.type==='maxHp'){maxHp+=5;hp+=5;log('Бонус: Max HP +5.');}if(item.type==='potion'){if(potions<potionCapacity){potions++;log('Бонус: зелье лечения.');}else log('Зелья полные, бонус сгорел.');}if(item.type==='vision'||item.type==='torchMax'){maxTorchHealth+=25;torchHealth+=25;clampTorch();log('Бонус: максимальный запас факела +25%.');}if(item.type==='dodge'){dodgeChance+=5;log('Бонус: уворот +5%.');}if(item.type==='potionCap'){potionCapacity++;log('Бонус: место для зелий +1.');}clampDamageStats();}
function nextLevel(){if(level>=10){gameOver=true;log('<b>Ты прошел 10 уровней. Победа.</b>');return;}level++;magePotionCraftedThisLevel=false;if(playerClass==='warrior'){maxHp+=2;hp+=2;minDamage+=0.5;clampDamageStats();log('Воин: +2 Max HP, +0.5 min damage.');}log('<hr>Уровень '+level+'. Враги сильнее.');generateMap();pendingBonusChoices=playerClass==='mage'?2:1;generateBonusStock();updateStats();drawMap();showBonusPanel();}

function saveGame(silent=false){
 if(!gameStarted)return;
 const saveData={
  version:1,
  visionRange,torchHealth,maxTorchHealth,actionCounter,discoveredWalls:[...discoveredWalls],discoveredExits:[...discoveredExits],litCells:[...litCells],dodgeChance,blockChance,playerClass,classCritChance,critMultiplier,
  level,hp,maxHp,minDamage,maxDamage,gold,potions,potionCapacity,
  gameOver,gameStarted,controlLock,player,
        playerUnderTile,map,monsters,shopStock,merchantExists,merchantPurchases,pendingFatalDamage,beaconUsed,beaconExists,fountainUsed,fountainExists,revealFogActive,
  bonusStock,pendingBonusChoices,inventory,facing,spriteFacingX
 };
 try{
  localStorage.setItem('caveRoguelikeSave',JSON.stringify(saveData));
  if(!silent)log('Игра сохранена.');
 }catch(e){
  if(!silent)log('Не получилось сохранить игру.');
 }
}
function hasSave(){
 return !!localStorage.getItem('caveRoguelikeSave');
}
function loadGame(){
 const raw=localStorage.getItem('caveRoguelikeSave');
 if(!raw){alert('Сохранения нет.');return;}
 try{
  isLoadingGame=true;
  const s=JSON.parse(raw);
  visionRange=s.visionRange ?? 2;
  torchHealth=s.torchHealth ?? 50;
  maxTorchHealth=s.maxTorchHealth ?? 100;
  actionCounter=s.actionCounter ?? 0;
  discoveredWalls=new Set(s.discoveredWalls ?? []);
  discoveredExits=new Set(s.discoveredExits ?? []);
  litCells=new Set(s.litCells ?? []);
  clampTorch();
  dodgeChance=s.dodgeChance ?? 10;
  blockChance=s.blockChance ?? 0;
  playerClass=s.playerClass ?? 'warrior';
  classCritChance=s.classCritChance ?? 0;
  critMultiplier=s.critMultiplier ?? 2;
  level=s.level ?? 1;
  hp=s.hp ?? 25;
  maxHp=s.maxHp ?? 25;
  minDamage=s.minDamage ?? 4;
  maxDamage=s.maxDamage ?? 8;
  clampDamageStats();
  gold=s.gold ?? 0;
  potions=s.potions ?? 0;
  potionCapacity=s.potionCapacity ?? 3;
  gameOver=s.gameOver ?? false;
  gameStarted=true;
  controlLock=s.controlLock ?? true;
  player=s.player ?? {x:1,y:1};
  map=s.map ?? [];
  monsters=s.monsters ?? {};
  shopStock=s.shopStock ?? [];
  merchantExists=s.merchantExists ?? false;
  merchantPurchases=s.merchantPurchases ?? 0;
  pendingFatalDamage=s.pendingFatalDamage ?? null;
  beaconUsed=s.beaconUsed ?? false;
  beaconExists=s.beaconExists ?? false;
  fountainUsed=s.fountainUsed ?? false;
  fountainExists=s.fountainExists ?? false;
  revealFogActive=false;
  bonusStock=s.bonusStock ?? [];
  pendingBonusChoices=s.pendingBonusChoices ?? 0;
  inventory=s.inventory ?? [];
  facing=s.facing ?? {x:0,y:1};
  spriteFacingX=s.spriteFacingX ?? (facing.x<0 ? -1 : 1);
  lastMoveDir={x:0,y:0};
  movementBusy=false;
  document.getElementById('menu').style.display='none';
  document.getElementById('game').style.display='block';
  document.getElementById('classSelect').style.display='none';
  hideDeathScreen();
  updateStats();
  drawMap();
  isLoadingGame=false;
  log('Игра загружена.');
 }catch(e){
  isLoadingGame=false;
  alert('Сохранение повреждено.');
 }
}
function deleteSave(){
 localStorage.removeItem('caveRoguelikeSave');
 log('Сохранение удалено.');
}

function showDeathScreen(){const screen=document.getElementById('deathScreen');screen.style.display='flex';screen.classList.remove('show');void screen.offsetWidth;screen.classList.add('show');}
function hideDeathScreen(){const screen=document.getElementById('deathScreen');screen.style.display='none';screen.classList.remove('show');}
function restartFromDeath(){hideDeathScreen();restartGame();}

function renderDifficultyTable(){
 const el=document.getElementById('difficultyTable');
 if(!el) return;
 let rows='';
 for(let i=1;i<=10;i++){
  let sk=ENEMY_LEVEL_BALANCE[i].skeleton;
  let merc=ENEMY_LEVEL_BALANCE[i].mercenary;
  rows += `<tr><td>${i}</td><td>${FLOOR_DIFFICULTY_BUDGET[i]}</td><td>${sk.hp}</td><td>${sk.dmg[0]}-${sk.dmg[1]}</td><td>${merc.hp}</td><td>${merc.dmg[0]}-${merc.dmg[1]}</td></tr>`;
 }
 el.innerHTML = `
  <table class="diffTable">
   <tr><th>Этаж</th><th>Бюджет</th><th>HP скелета</th><th>Урон скелета</th><th>HP наёмника</th><th>Урон наёмника</th></tr>${rows}
  </table>
  <p><b>Очки юнитов:</b> Скелет ${UNIT_DIFFICULTY.skeleton}, сильный скелет ${UNIT_DIFFICULTY.skeletonStrong}, элитный скелет ${UNIT_DIFFICULTY.skeletonElite}, наёмник ${UNIT_DIFFICULTY.mercenary}, сильный наёмник ${UNIT_DIFFICULTY.mercenaryStrong}, элитный наёмник ${UNIT_DIFFICULTY.mercenaryElite}, охрана выхода +${UNIT_DIFFICULTY.exitGuardBonus}.</p>
  <p><b>Баланс:</b> скелеты теперь слабые и дешёвые по очкам сложности. Наёмники имеют меньше HP, но заметно выше урон. Strong/Elite дают умеренный прирост, без старых разбросов типа 1-X.</p>
 `;
}

function restartGame(){
hideDeathScreen();level=1;gold=0;potions=0;torchHealth=50;maxTorchHealth=100;actionCounter=0;clampTorch();potionCapacity=3;blockChance=0;inventory=[];gameOver=false;gameStarted=true;pendingFatalDamage=null;pendingBonusChoices=0;beaconUsed=false;beaconExists=false;fountainUsed=false;fountainExists=false;revealFogActive=false;if(beaconRevealTimer){clearTimeout(beaconRevealTimer);beaconRevealTimer=null;}shopStock=[];chestOpeningCells=new Set();merchantPurchases=0;facing={x:0,y:1};spriteFacingX=1;lastMoveDir={x:0,y:0};movementBusy=false;combatBusy=false;playerSpriteState='idle';monsterSpriteStates={};setupClassStats();document.getElementById('log').innerHTML='';generateMap();updateStats();drawMap();log('Игра началась.');}
document.addEventListener('keydown',function(event){if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){if(controlLock)event.preventDefault();if(event.key==='ArrowUp')move(0,-1);if(event.key==='ArrowDown')move(0,1);if(event.key==='ArrowLeft')move(-1,0);if(event.key==='ArrowRight')move(1,0);}});
