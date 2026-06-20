from pathlib import Path
p=Path('/mnt/data/final_edit/game.js')
s=p.read_text()
# MOVE_DELAY
s=s.replace('const MOVE_DELAY_MS = 190;', 'const MOVE_DELAY_MS = 320;')
# add clamp after formatNum function
needle="function formatNum(n){return Number.isInteger(n)?n:n.toFixed(1);}\n"
insert="function formatNum(n){return Number.isInteger(n)?n:n.toFixed(1);}\nfunction clampDamageStats(){\n if(minDamage > maxDamage){\n  maxDamage = Math.ceil(minDamage);\n }\n}\n"
s=s.replace(needle, insert)
# updateStats call clamp
s=s.replace("function updateStats(){\n document.getElementById('level').textContent=level;", "function updateStats(){\n clampDamageStats();\n document.getElementById('level').textContent=level;")
# insert clamp in applyItem
s=s.replace("function applyItem(item){if(item.type==='rustSword'){minDamage++;maxDamage++;}if(item.type==='chainmail')", "function applyItem(item){if(item.type==='rustSword'){minDamage++;maxDamage++;}if(item.type==='chainmail')")
s=s.replace("if(item.type==='potionBag'){potionCapacity++;}}", "if(item.type==='potionBag'){potionCapacity++;}clampDamageStats();}")
# applyBonus replacement at end
s=s.replace("if(item.type==='potionCap'){potionCapacity++;log('Бонус: место для зелий +1.');}}", "if(item.type==='potionCap'){potionCapacity++;log('Бонус: место для зелий +1.');}clampDamageStats();}")
# nextLevel add clamp before generateMap or after warrior
s=s.replace("if(playerClass==='warrior'){maxHp+=2;hp+=2;minDamage+=0.5;log('Воин: +2 Max HP, +0.5 min damage.');}log('<hr>Уровень '", "if(playerClass==='warrior'){maxHp+=2;hp+=2;minDamage+=0.5;clampDamageStats();log('Воин: +2 Max HP, +0.5 min damage.');}log('<hr>Уровень '")
# after load values
s=s.replace("maxDamage=s.maxDamage ?? 8;", "maxDamage=s.maxDamage ?? 8;\n  clampDamageStats();")
p.write_text(s)

css=Path('/mnt/data/final_edit/style.css')
c=css.read_text()
# append clean overrides
c += r'''

/* MENU FIX: vertical menu panels/buttons */
#menu{
  display:flex;
  flex-direction:column;
  align-items:center;
}
#menu > button,
#classSelect button{
  display:block;
  width:220px;
  margin:6px auto;
}
#classSelect,
#rulesBox,
#bestiaryBox{
  box-sizing:border-box;
}
#classSelect p,
#rulesBox p,
#bestiaryBox p{
  text-align:left;
}

/* SMOOTHER TILE-TO-TILE MOVEMENT */
.player.moveFromLeft .spriteWrap{animation:spriteWrapStepFromLeftSmooth .32s cubic-bezier(.22,.75,.25,1)!important;}
.player.moveFromRight .spriteWrap{animation:spriteWrapStepFromRightSmooth .32s cubic-bezier(.22,.75,.25,1)!important;}
.player.moveFromTop .spriteWrap{animation:spriteWrapStepFromTopSmooth .32s cubic-bezier(.22,.75,.25,1)!important;}
.player.moveFromBottom .spriteWrap{animation:spriteWrapStepFromBottomSmooth .32s cubic-bezier(.22,.75,.25,1)!important;}
@keyframes spriteWrapStepFromLeftSmooth{
  0%{transform:translate(calc(-50% - 40px),-72%) scaleX(var(--sprite-flip,1));}
  100%{transform:translate(-50%,-72%) scaleX(var(--sprite-flip,1));}
}
@keyframes spriteWrapStepFromRightSmooth{
  0%{transform:translate(calc(-50% + 40px),-72%) scaleX(var(--sprite-flip,1));}
  100%{transform:translate(-50%,-72%) scaleX(var(--sprite-flip,1));}
}
@keyframes spriteWrapStepFromTopSmooth{
  0%{transform:translate(-50%,calc(-72% - 40px)) scaleX(var(--sprite-flip,1));}
  100%{transform:translate(-50%,-72%) scaleX(var(--sprite-flip,1));}
}
@keyframes spriteWrapStepFromBottomSmooth{
  0%{transform:translate(-50%,calc(-72% + 40px)) scaleX(var(--sprite-flip,1));}
  100%{transform:translate(-50%,-72%) scaleX(var(--sprite-flip,1));}
}
'''
css.write_text(c)
