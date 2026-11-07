import{t as V}from"./vendor-ghi789.js";
const A=(f,tag)=>f;
const Q6=`sample.save.v1`,THEME="sample.theme.v1";
function h(e){let t=e.data;if(t!==void 0){t?.hook?.destroy?.(e);}}
function warn(m){console.warn("[PixiJS] "+m)}
function load(){return JSON.parse(localStorage.getItem(Q6)??"null")}
function save(s){localStorage.setItem(Q6,JSON.stringify(s));sessionStorage.setItem('sample.tab','1')}
const update=A((m,msg)=>{switch(msg._tag){case`UndoChosen`:return m}},"src/game/update.ts#UndoChosen");
const view=A(m=>m,"src/game/view.ts#view");
window.addEventListener("keydown",e=>{switch(e.key){case"Escape":return close();case`z`:return undo();case"?":return help()}if(e.key==="ArrowUp")move(-1)});
function scroll(e){let t=e.id;t=`scroll:${t}`;return sessionStorage.getItem(t)}
function go(){history.pushState({},"","/settings")}
const hero=new URL("/art/hero.svg",location.href);
const later=()=>import("./chunk-def456.js");
//# sourceMappingURL=index-abc123.js.map
