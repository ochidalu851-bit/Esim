(function(){
"use strict";
const $=id=>document.getElementById(id);
const screen=$("screen"),toast=$("toast");
const S={page:"home",user:null,status:null,summary:null,wallet:null,catalog:{plans:[],bundles:[],countryPlans:[]},usage:null,network:null,authMode:"login",speed:{download:null,upload:null,ping:null,jitter:null},connecting:false,connected:false,preferences:null,device:null,sponsorOffers:[],selectedCountry:null,planType:"data",selectedPlanId:null,countryQuery:"",countryCatalogLoading:false,countryCatalogMessage:"",countryProvider:null,countrySpeed:null};
const GENIEX_ORIGINAL_ASSETS={
 brand:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAMAAAANIilAAAAASFBMVEUAAABqNf9qNf9rNf9qNP9rNf9oOP9oMP9wMP9wQP9qNP9lM/9sNP9pNP9qNf9oNf9pNP9qMv9rNf9qNP9rNP9qNP9qNf9qNf/UM3egAAAAF3RSTlMA33+f788gIBAQvzBAP2Bfb2CPUI+vkCAt/dAAAAGoSURBVEjH7dVZbsMwDARQa43lJYudRve/aYNCLKMZ24j616Lz1YZ5kEyJcfcHk6Yp/VBak58xNjbT6PJ3XBtPQtt5sj5jbGygFHN5w56NgkY+DTUAvh7QsaZm7vubf69z6QHrnLpnTvAY935zx4btljYj22tmC1pyRbvmOkF3x3oCbNhq+gC76o8WdtL+iTUv7dDKp3f5k+qa6oBtObrh9YuL1hd6ZLZlq0N5QKt1iCcbAzYvoJXQIUbz0twoIw4W8QWs6BSkvos92MUVPdU2bmA/luP1skVpE9QN4G0rGuuAdRTOXlunWuurz4jVyglVxwh1wFKzcAnTUNtrZhzAyt1KQazUGYf6Dnq5W7HYqo64rlkZIuPxfgPmwbR7I/jIhNnKIjzejGEEy/+WxlutYVtyV03jjXeAx+hD2gPjrRnIakKUl57n8eYfoilnGGAN2zzDLyBqtvzI/FZgPXp+Ex1rPx5Z0i7XuVTjDWdBucHi9svCstCrfe7WW70db9loTjZzlMKOmbs966RR7XwYu/cyG6LzIcDOMW3jStszu+B9WObuP78/nxHqbvoPxgDqAAAAAElFTkSuQmCC",
 card:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAMAAAAOusbgAAAAZlBMVEUAAAB6Qvp7Qvp6Qvl7Q/p7RPd7Qvl4QP97Q/p7Qvx7Q/p6Qvd7Q/p7Q/t6Q/l6Qvp6Q/Z7Q/r///+LWvve0P7v6P/OuP29of338/+1lf2sifyccvuDTvvFrf2kfvyUZvvm3P7WxP6v5X/rAAAAEXRSTlMA3+9AvyBwEK9fn2DPj1CAMIjz4XYAAAQsSURBVGje1ZvbduogEEADiSTGWDuQC7kZ+/8/eVbbLInrmBlChOPZD32o2t0ZYICA0WbS+HTOE8Y4fMOKJLuIOI38EouMwVNYJuLID6lIOKDw7HjwYAUrkpe644yDPXn8Km0CGymOL9B+MHCAHUNHa9R7En5IYAe5czcTHHbBL4HDNbBD2HANXGwtGGd4Eed0U5oLMARM9ycD+BfmDw4vhX/YeY/wco5+vbSZ9oY3f4AniHb+5OAJ/omOX2Qc+RxVKQOPFOs17AxeOa95BXhGrDQwB8/w583MwDvJM+8FAiCCJZpOdg4IHpMdQyBih56lbBi2hXyipH1dSUvKcSJmC/uAGy03UV6Rmm0f8HSTm6kHq1YuMG+npQOVwluZ7tJXXOBgjq3GsNLSkRuskN2LFiBU0plmrXylFl2rk+5oRVTsxEPAaMgJnele7kGvjamUzHQtd9Gjuc4Q8W2fuEVzzRGx3Ee91q9N9fAjLrEaIrDqsego69OT/qrrutRbxMI0MSHWaqXBddPfZ057cWaamBCXK128GZZvr0mxmRtTRFtXhLia4JFrZSeGFOlbqpISF1cK+RAujpG+NcoVMTrxTdpKfETW8SUl7uYge1jSWonPSKeuCXE9N+tvgWrkl/mHaXGOTE09IVb3qqrVT6mZzOdIcYIttxpUXJqJ8zvYxZSgLcQMXdiqFhF3v2+5zdPQYk4YrcQAjgVkWq5QKvj9Obc6Lebu4sfR89Ms49+fWmWf2FQMPSffv1jP7/gePPMOp2rDRGzauGvmlp7TbyXmrmJlBm03VHLRxr2VmGHiKzacTBt3cF38Bpq94/iqkQJyr5A/YigXBeRmIS6iBMszJtbDvTRfAZQRK7uSmTtPEs3clcrxJz1laz5Hi7Po7D4tKmS3RYkv0WnHQmCg1y1rCGzpowmxLMF96YMt9qaKEMubQrzEYg8dyD0hllUHS1ptv7yNMkB4GDzl013KXT205aYFvcDE2mS1Xduy6nJsu3Ystf2mDQS1aSv9bFMhprapzT7xhG1To8Tbo4gKf+AkvOW6ww/8UvAQMv5s70A/boIvDwEnNudNQ+XqHcmj1RRf/jiaa1jlgDxEpc3u3tz2JGQYN2t1a3cekgCOqrdpmwHWKTYd/qiuvi1HyiMPM/fYD4BxRA5DyFrSYi/hMORqAD2iW/QlOmCkldHDiUphL6EwhyO+vplp//rj08pLSJc2IQchf59j3EhAAC7GFzTZ7L0uJ/hPtni3CyhRWoBH2BteMvJ6rerwnhfJkAM/AnpOCm423vDm43tfCH31qGKfiMqjuTj8D9ecPVzsDpvu5BC5cOGBwzVB54HDNcTMWRtH+zg5qZnR7lAXgaM1xFvamudGu5/DKbEMViAFw9WdcSJWD1bzZToe+Mt0hjQWlywp2G+QjCX5+RRvj/QPmpz/dH834xcAAAAASUVORK5CYII="
};
const icons={
back:'<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
bolt:'<svg viewBox="0 0 24 24"><path d="m13 2-9 12h7l-1 8 10-13h-7l0-7Z"/></svg>',
speed:'<svg viewBox="0 0 24 24"><path d="M4 18a9 9 0 1 1 16 0M12 13l5-5M12 13l-2 4"/></svg>',
wifi:'<svg viewBox="0 0 24 24"><path d="M3 8a14 14 0 0 1 18 0M6.5 11.5a9 9 0 0 1 11 0M10 15a4 4 0 0 1 4 0M12 19h.01"/></svg>',
gift:'<svg viewBox="0 0 24 24"><path d="M3 9h18v12H3zM2 5h20v4H2zM12 5v16M12 5H8.5a2.5 2.5 0 1 1 2.5-2v2Zm0 0h3.5a2.5 2.5 0 1 0-2.5-2v2Z"/></svg>',
person:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M4 20c1-3.5 3.5-5 8-5s7 1.5 8 5"/></svg>',
wallet:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18M16 14h2"/></svg>',
signal:'<svg viewBox="0 0 24 24"><path d="M4 20h2v-4H4zm5 0h2v-8H9zm5 0h2V8h-2zm5 0h2V3h-2z"/></svg>',
help:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.4 1.6c-.9.9-1.9 1.2-1.9 2.8M12 17h.01"/></svg>'
};
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function money(v,c){return (c||"").toUpperCase()+" "+Number(v||0).toLocaleString();}
function notify(message){toast.textContent=message;toast.classList.add("show");clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.classList.remove("show"),3800);}
async function api(route,options){
 options=options||{};const headers=Object.assign({"content-type":"application/json"},options.headers||{});
 const response=await fetch("/api/v1"+route,Object.assign({},options,{headers,credentials:"same-origin",cache:"no-store"}));
 const type=response.headers.get("content-type")||"";
 const data=type.includes("application/json")?await response.json():{};
 if(!response.ok)throw new Error(data.error||data.message||("Request failed ("+response.status+")."));
 return data;
}
function openModal(title,body,actions){
 $("modalRoot").innerHTML='<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true"><h2>'+esc(title)+'</h2><div class="modal-body">'+body+'</div><div class="modal-actions">'+actions+'</div></section></div>';
}
function closeModal(){ $("modalRoot").innerHTML=""; }
function header(title,extra){
 return '<div class="sub-header"><button class="back-button" data-action="go-back" aria-label="Back">'+icons.back+'</button><h1>'+esc(title)+'</h1>'+(extra||'')+'</div>';
}
function empty(title,copy,button){return '<div class="empty-state"><div class="empty-icon">◌</div><b>'+esc(title)+'</b><p>'+esc(copy)+'</p>'+(button||"")+'</div>';}
function row(symbol,title,desc,tail,action){return '<button class="menu-action" '+(action?'data-page="'+esc(action)+'"':'data-action="noop"')+'><span class="menu-symbol">'+symbol+'</span><span>'+esc(title)+'<small class="muted">'+esc(desc||"")+'</small></span><em>'+esc(tail||"›")+'</em></button>';}
function setPage(page){
 if(page==="data")page="countries";
 if(page==="mine")page="more";

 S.page=page;render();
 if(page==="home"){loadStatus();loadUsage();readNetwork();}
 if(page==="country-plans")loadCountryCatalog();
 if(page==="apps")loadCatalog();
 if(page==="balance")loadBalance();
 if(page==="account")refreshAccount();
 if(page==="rewards")loadRewards();
 if(page==="vouchers")loadVouchers();
 if(page==="airtime")loadAirtime();
 if(page==="network")refreshNetwork();
 if(page==="settings")loadSettings();
 if(page==="network-settings")loadPreferredNetwork();
 if(page==="battery"||page==="device")loadDeviceHealth();
 if(page==="messages")loadMessages();
 if(page==="usage")loadUsage();
 if(page==="orders")loadOrders();
 if(page==="sponsors")loadSponsorOffers();
}
function render(){
 updateTopBar();
 let html="";
 if(S.page==="home")html=homePage();
 else if(S.page==="shop")html=shopPage();
 else if(S.page==="countries"||S.page==="data")html=countriesPage();
 else if(S.page==="country-plans")html=countryPlansPage();
 else if(S.page==="more"||S.page==="mine")html=morePage();
 else if(S.page==="device")html=devicePage();
 else if(S.page==="sim")html=simPage();
 else if(S.page==="apps")html=appsPage();
 else if(S.page==="balance")html=balancePage();
 else if(S.page==="sponsors")html=sponsorsPage();
 else if(S.page==="account")html=accountPage();
 else if(S.page==="my-account")html=myAccountPage();
 else if(S.page==="network-settings")html=networkSettingsPage();
 else if(S.page==="diagnostics")html=diagnosticsPage();
 else if(S.page==="battery")html=batteryPage();
 else if(S.page==="rewards")html=rewardsPage();
 else if(S.page==="vouchers")html=vouchersPage();
 else if(S.page==="airtime")html=airtimePage();
 else if(S.page==="speed")html=speedPage();
 else if(S.page==="network")html=networkPage();
 else if(S.page==="usage")html=usagePage();
 else if(S.page==="orders")html=ordersPage();
 else if(S.page==="settings")html=settingsPage();
 else if(S.page==="help")html=helpPage();
 else if(S.page==="messages")html=messagesPage();
 else if(S.page==="history")html=historyPage();
 else html=homePage();
 const navPage=["shop","countries","country-plans","data","apps","airtime","orders"].includes(S.page)?"shop":
   S.page==="balance"?"balance":
   ["device","diagnostics","network","network-settings","battery","speed","sim","boost"].includes(S.page)?"device":
   ["more","mine","account","my-account","settings","help","messages","rewards","vouchers","airtime","orders","history","sponsors"].includes(S.page)?"mine":"home";
 const nav=[
   ["home","Home",'<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/></svg>'],
   ["shop","Shop",'<svg viewBox="0 0 24 24"><path d="M3 9h18l-1.5 12h-15L3 9Z"/><path d="M7 9 9 3h6l2 6M9 13v4m6-4v4"/></svg>'],
   ["balance","Balance",'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 14h2"/></svg>'],
   ["device","Device",'<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4M11 18h2"/></svg>'],
   ["mine","Mine",'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M4 21c.7-4 3.3-6 8-6s7.3 2 8 6"/></svg>']
 ];
 const navHtml='<nav class="bottom-nav" aria-label="Main navigation">'+nav.map(x=>'<button type="button" class="nav-item '+(navPage===x[0]?'active':'')+'" data-page="'+x[0]+'" aria-current="'+(navPage===x[0]?'page':'false')+'">'+x[2]+'<span>'+x[1]+'</span></button>').join('')+'</nav>';
 screen.innerHTML='<section class="page active">'+html+'</section>'+navHtml;
}

const ISO_COUNTRY_CODES=("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK").split(" ");
const COUNTRY_NAME_OVERRIDES={XK:"Kosovo"};
function updateTopBar(){
 const bar=$("appHeader");if(!bar)return;
 const points=S.wallet?Number(S.wallet.pointsBalance||0).toLocaleString():Number(S.summary&&S.summary.pointsBalance||0).toLocaleString();
 if(S.page==="home"){
  bar.classList.remove("app-header-empty");
  bar.innerHTML='<div class="expert-brand"><img src="'+GENIEX_ORIGINAL_ASSETS.brand+'" alt=""><span><b>Expert eSIM</b><small>Mobile services</small></span></div><div class="header-actions"><button class="points-pill" data-page="balance" aria-label="Points balance"><span class="points-gem">◆</span><b>'+points+'</b><span>PTS</span></button><button class="topbar-more" data-page="mine" aria-label="Open Mine"><span></span><span></span><span></span></button></div>';
  return;
 }
 bar.classList.remove("app-header-empty");
 const right='<button class="points-pill" data-page="balance" aria-label="Points balance"><span class="points-gem">◆</span><b>'+points+'</b><span>PTS</span></button>';
 bar.innerHTML='<button class="topbar-back" data-action="go-back" aria-label="Back">'+icons.back+'</button>'+right;
}
function flagForCountry(code){
 if(code==="XK")return "🇽🇰";
 const c=String(code||"").toUpperCase();
 if(!/^[A-Z]{2}$/.test(c))return "🌐";
 return String.fromCodePoint(...[...c].map(ch=>127397+ch.charCodeAt(0)));
}
function getCountryItems(){
 let display;try{display=new Intl.DisplayNames(["en"],{type:"region"});}catch(e){display=null;}
 return ISO_COUNTRY_CODES.map(code=>({code,name:COUNTRY_NAME_OVERRIDES[code]||(display?display.of(code):code),flag:flagForCountry(code)})).sort((a,b)=>a.name.localeCompare(b.name));
}
function countryRows(){
 const q=String(S.countryQuery||"").trim().toLocaleLowerCase();
 const items=getCountryItems().filter(c=>!q||(c.name+" "+c.code).toLocaleLowerCase().includes(q));
 if(!items.length)return '<div class="country-empty">No countries match that search.</div>';
 return items.map(c=>'<button class="country-row" type="button" data-action="select-country" data-code="'+c.code+'"><span class="country-flag">'+c.flag+'</span><span class="country-copy"><b>'+esc(c.name)+'</b></span><span class="country-chevron"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></span></button>').join("");
}
function countriesPage(){
 return '<div class="country-topbar"><button class="country-back" type="button" data-action="go-back" aria-label="Back">'+icons.back+'</button></div><div class="country-heading"><h1>Select country</h1></div><label class="country-search"><span class="search-icon"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg></span><input id="countrySearch" type="search" autocomplete="off" placeholder="Where do you need an eSIM?" value="'+esc(S.countryQuery||"")+'" aria-label="Search countries"><button type="button" class="search-clear" data-action="clear-country-search" aria-label="Clear search">×</button></label><div class="country-list" id="countryList">'+countryRows()+'</div>';
}
function planPrice(plan){
 if(plan.priceLabel)return String(plan.priceLabel);
 if(plan.priceFormatted)return String(plan.priceFormatted);
 if(plan.priceDisplay)return String(plan.priceDisplay);
 if(plan.price!==undefined&&plan.price!==null&&plan.currency)return String(plan.currency)+" "+Number(plan.price).toFixed(2);
 return "";
}
function planGroup(plan){
 if(plan.groupLabel)return String(plan.groupLabel);
 const days=Number(plan.durationDays||plan.validityDays||plan.days||0);
 if(days>0)return days+"-DAY PLAN";
 const name=String(plan.name||plan.validityLabel||"AVAILABLE PLANS");
 const match=name.match(/(\d+)\s*[- ]?\s*day/i);
 return match?match[1]+"-DAY PLAN":"AVAILABLE PLANS";
}
function currentCountryPlans(){
 const plans=Array.isArray(S.catalog.countryPlans)?S.catalog.countryPlans:[];
 return plans.filter(p=>{
  const code=String(p.countryCode||p.country_code||p.isoCode||"").toUpperCase();
  const type=String(p.category||p.planType||p.productType||"").toLowerCase();
  const countryOk=!code||code===S.selectedCountry?.code;
  const typeOk=!type||(S.planType==="data"?(!/call|text|voice|sms/.test(type)):(/call|text|voice|sms|combo/.test(type)));
  return countryOk&&typeOk;
 });
}
function countryPlansPage(){
 const country=S.selectedCountry;if(!country)return countriesPage();
 const plans=currentCountryPlans(),provider=S.countryProvider||"Not connected",speed=S.countrySpeed||"Not verified";
 let list="";
 if(S.countryCatalogLoading)list='<div class="plan-empty"><span class="loader-dot"></span><b>Checking availability</b><p>Requesting the latest country catalogue.</p></div>';
 else if(!plans.length)list='<div class="plan-empty"><div class="empty-plan-symbol">⌁</div><b>No verified plans available</b><p>Expert eSIM has not received a confirmed provider catalogue for '+esc(country.name)+'. Provider, network speed, coverage and plan prices will appear here only after a connectivity partner verifies them.</p><button class="outline-action" data-action="refresh-country-catalog">Refresh availability</button></div>';
 else{
  const groups={};plans.forEach(p=>{const k=planGroup(p);(groups[k]||(groups[k]=[])).push(p);});
  list=Object.entries(groups).map(([heading,items])=>'<section class="plan-group"><h2>'+esc(heading)+'</h2>'+items.map(p=>{
   const id=String(p.id||p.planId||p.plan_id||""),selected=id&&id===S.selectedPlanId;
   const name=p.name||p.dataLabel||p.allowance||p.data||"eSIM plan",price=planPrice(p);
   const points=p.pointsCost!==undefined?" (◆ "+Number(p.pointsCost).toLocaleString()+")":"";
   const details=p.description||p.validityLabel||p.durationLabel||"";
   return '<button class="plan-option '+(selected?"selected":"")+'" data-action="select-plan" data-id="'+esc(id)+'"><span class="plan-radio"></span><span class="plan-copy"><b>'+esc(name)+'</b>'+(details?'<small>'+esc(details)+'</small>':'')+'</span><span class="plan-price">'+esc(price)+(points?'<small>'+esc(points)+'</small>':'')+'</span></button>';
  }).join("")+'</section>').join("");
 }
 return '<div class="plan-title"><div><h1>Available plans</h1><p>'+esc(country.name)+'</p></div><span class="plan-country-flag">'+country.flag+'</span></div><div class="plan-meta"><span><i class="meta-globe">◎</i><b>Provider:</b> '+esc(provider)+'</span><i class="meta-separator"></i><span><i class="meta-bolt">ϟ</i><b>Speed</b> '+esc(speed)+'</span></div><div class="plan-tabs"><button class="'+(S.planType==="data"?"active":"")+'" data-action="plan-type" data-type="data">Data</button><button class="'+(S.planType==="combo"?"active":"")+'" data-action="plan-type" data-type="combo">Data + Calls + Text</button></div><div class="plan-list">'+list+'</div><div class="purchase-dock"><button class="buy-esim-button" '+(S.selectedPlanId?"":"disabled")+' data-action="buy-data" data-id="'+esc(S.selectedPlanId||"")+'">Buy eSIM</button></div>';
}
function morePage(){
 return header("Mine")+
 '<div class="geniex-profile-banner"><img src="'+GENIEX_ORIGINAL_ASSETS.brand+'" alt=""><div><b>Expert eSIM</b><small>Mobile services</small></div></div>'+
 '<section class="geniex-menu-section"><h2>Connectivity</h2><div class="menu-list">'+
 row(icons.wifi,"Data Plan","Browse country coverage","›","countries")+
 row(icons.signal,"App Bundles","Application data bundles","›","apps")+
 row(icons.wallet,"My Balance","Balance and account controls","›","balance")+
 row(icons.speed,"Speed Test","Test the active internet connection","›","speed")+
 row(icons.signal,"Network Detection","Read the active mobile network","›","network")+
 row(icons.person,"SIM Management","Android SIM and network settings","›","network-settings")+
 '</div></section>'+
 '<section class="geniex-menu-section"><h2>Account & rewards</h2><div class="menu-list">'+
 row(icons.person,"My Account","Subscriber profile and device","›","account")+
 row(icons.gift,"Reward Center","Daily rewards and tasks","›","rewards")+
 row(icons.wallet,"Points History","Reward points ledger","›","history")+
 row(icons.gift,"Vouchers & Redeem","Coupons and redemption codes","›","vouchers")+
 row(icons.wallet,"Top Up Phone","Airtime requests","›","airtime")+
 row(icons.help,"Messages","Announcements and service messages","›","messages")+
 row(icons.help,"Orders & History","Service request history","›","orders")+
 '</div></section>'+
 '<section class="geniex-menu-section"><h2>Device tools & settings</h2><div class="menu-list">'+
 row(icons.signal,"Battery","Battery and device status","›","battery")+
 row(icons.bolt,"Device Boost","Device performance information","›","diagnostics")+
 row(icons.speed,"Cooling","Device temperature status","›","battery")+
 row(icons.signal,"Diagnostics","Network diagnostics","›","diagnostics")+
 row(icons.help,"Settings","App preferences and theme","›","settings")+
 row(icons.help,"Help & Support","FAQs and support","›","help")+
 '</div></section><p class="footer-note">Provider-dependent services show live status only when an authorised provider is connected.</p>';
}
function shopPage(){
 return header("Shop")+
 '<section class="shop-intro"><div class="eyebrow">GENIEX SERVICE CATEGORIES</div><h2>Choose what you need</h2><p>Browse the available products and service requests.</p></section>'+
 '<div class="shop-service-grid">'+
  '<button type="button" class="shop-service-card" data-page="countries"><span class="shop-service-icon">'+icons.wifi+'</span><b>Data Plan</b><small>Country availability and data plan catalogue</small><em>Open <span>›</span></em></button>'+
  '<button type="button" class="shop-service-card" data-page="apps"><span class="shop-service-icon">▦</span><b>App Bundle</b><small>Application-specific data bundles</small><em>Open <span>›</span></em></button>'+
  '<button type="button" class="shop-service-card" data-page="airtime"><span class="shop-service-icon">↗</span><b>Airtime Recharge</b><small>Submit and track airtime requests</small><em>Open <span>›</span></em></button>'+
  '<button type="button" class="shop-service-card" data-page="orders"><span class="shop-service-icon">'+icons.wallet+'</span><b>Orders & History</b><small>Review previous requests and transactions</small><em>Open <span>›</span></em></button>'+
 '</div>'+
 '<p class="shop-footnote">Only confirmed supplier inventory and fulfilment is displayed. An airtime request is not marked delivered until a supplier confirms it.</p>';
}
function homePage(){
 const summary=S.summary||{};
 const usage=S.usage||{};
 const device=S.device||{};
 const network=S.network||{};
 const points=Number(S.wallet&&S.wallet.pointsBalance!=null?S.wallet.pointsBalance:summary.pointsBalance||0);
 const dataRemaining=usage.available&&usage.remainingMb!=null?Number(usage.remainingMb).toLocaleString():"—";
 const dataNote=usage.available?(usage.message||"Carrier usage feed reported"):"Usage is not supplied by the active carrier";
 const networkName=network.networkType||network.label||"Not detected yet";
 const networkNote=network.message||"Read from Android when the required permission is available";
 const userName=S.user&&S.user.fullName?S.user.fullName.split(/\s+/)[0]:"there";
 const providerReady=!!(S.status&&S.status.networkProviderConfigured);
 const dailyAvailable=!!(summary.dailyCheckinAvailable||summary.dailySpinAvailable);
 const activeProfiles=Number(summary.activeProfiles||0);
 const deviceName=device.deviceName||device.model||"This device";
 const profileStatus=activeProfiles>0?activeProfiles+" active profile"+(activeProfiles===1?"":"s"):"No active eSIM profile";
 return '<div class="home-dashboard">'+
  '<section class="home-welcome"><div class="home-welcome-copy"><div class="eyebrow">EXPERT eSIM</div><h1>Welcome '+esc(userName)+'</h1><p>Your mobile services and device tools, together in one place.</p></div><div class="home-avatar">'+(S.user?esc((S.user.fullName||S.user.email||"E").slice(0,1).toUpperCase()):'<span>⌁</span>')+'</div></section>'+
  '<section class="home-network-card"><div class="home-network-head"><span class="home-live-dot '+(providerReady?"ready":"")+'"></span><span>'+(providerReady?"Provider ready":"Provider not connected")+'</span><button type="button" data-page="network">Details</button></div><div class="home-network-body"><div><div class="eyebrow">CURRENT NETWORK</div><strong>'+esc(networkName)+'</strong><small>'+esc(networkNote)+'</small></div><div class="home-signal-icon">'+icons.signal+'</div></div><div class="home-device-line"><span>'+esc(deviceName)+'</span><span>'+esc(profileStatus)+'</span></div><div class="home-network-actions"><button type="button" data-page="network">Network Detection</button><button type="button" data-action="open-sim-settings">SIM Settings</button></div></section>'+
  '<div class="home-stat-grid">'+
   '<button class="home-stat-card" type="button" data-page="usage"><span>DATA REMAINING</span><strong>'+esc(dataRemaining)+' <small>MB</small></strong><em>'+esc(dataNote)+'</em></button>'+
   '<button class="home-stat-card" type="button" data-page="balance"><span>REWARD COINS</span><strong>'+points.toLocaleString()+'</strong><em>Expert eSIM points balance</em></button>'+
   '<button class="home-stat-card" type="button" data-page="device"><span>REGISTERED DEVICES</span><strong>'+Number(summary.devices||0)+'</strong><em>Detected on your account</em></button>'+
   '<button class="home-stat-card" type="button" data-page="device"><span>eSIM PROFILES</span><strong>'+activeProfiles+'</strong><em>'+esc(profileStatus)+'</em></button>'+
  '</div>'+
  '<div class="home-section-heading"><h2>Quick access</h2><button type="button" data-page="mine">More</button></div>'+
  '<div class="home-shortcuts">'+
   '<button type="button" data-page="shop"><span class="shortcut-symbol">'+icons.wifi+'</span><b>Data Plan</b></button>'+
   '<button type="button" data-page="apps"><span class="shortcut-symbol">▦</span><b>App Bundle</b></button>'+
   '<button type="button" data-page="speed"><span class="shortcut-symbol">'+icons.speed+'</span><b>NetSpeed</b></button>'+
   '<button type="button" data-page="rewards"><span class="shortcut-symbol">'+icons.gift+'</span><b>Rewards</b></button>'+
   '<button type="button" data-page="airtime"><span class="shortcut-symbol">↗</span><b>Airtime</b></button>'+
   '<button type="button" data-page="device"><span class="shortcut-symbol">'+icons.signal+'</span><b>Device Tools</b></button>'+
  '</div>'+
  '<section class="home-reward-card"><div class="home-reward-icon">'+icons.gift+'</div><div class="home-reward-copy"><b>Daily rewards</b><small>'+(S.user?(dailyAvailable?"Your daily check-in and rewards are available to view.":"Check your completed rewards and tasks."):"Sign in to access check-ins, tasks and rewards.")+'</small></div><button type="button" data-page="rewards">Open</button></section>'+
  '<div class="home-section-heading"><h2>My services</h2><button type="button" data-page="mine">View all</button></div>'+
  '<div class="home-service-list">'+
   '<button type="button" data-page="balance"><span>'+icons.wallet+'</span><b>Balance & transactions</b><i>›</i></button>'+
   '<button type="button" data-page="messages"><span>'+icons.help+'</span><b>Messages & notices</b><i>›</i></button>'+
   '<button type="button" data-page="settings"><span>⚙</span><b>Settings</b><i>›</i></button>'+
  '</div>'+
  '<p class="home-footnote">Network, data usage, eSIM profile and payment information is shown only when the phone or an authorised service provides it.</p>'+
 '</div>';
}
function dataPage(){
 const items=S.catalog.plans||[];
 return header("Data Bundles",'<button class="sub-end" data-page="history">History</button>')+'<div class="data-tabs"><button class="active" data-page="data">Data Plan</button><button data-page="apps">APP Bundles</button></div><div class="usage-total"><div><div class="eyebrow">DATA AVAILABLE</div><strong>'+(S.usage&&S.usage.available?esc(S.usage.remainingMb||0):"—")+' <small>MB</small></strong></div><button class="link-button" data-page="usage">Usage Details</button></div>'+(items.length?'<div class="row-list">'+items.map(x=>'<div class="panel"><b>'+esc(x.name)+'</b><p class="tiny muted">'+esc(x.description||"")+'</p><div class="row-list"><span class="pill">'+esc(x.dataLabel||"Data bundle")+'</span><span class="pill">'+esc(x.validityLabel||"Validity not stated")+'</span></div><button class="primary-button" data-action="buy-data" data-id="'+esc(x.id)+'">Buy Data</button></div>').join("")+'</div>':empty("Data catalogue is not connected","The GENIEX APK lists data plans and plan history. No authorised data supplier has published live plans to this Railway app yet.",'<button class="secondary-button" data-action="catalog-status">Check provider status</button>'))+'<div style="margin-top:14px"><button class="primary-button" data-action="add-data">ADD DATA</button></div><p class="footer-note">Only carrier-confirmed balances and purchases will be shown here. No sample data or invented plan prices are displayed.</p>';
}
function appsPage(){
 const items=S.catalog.bundles||[];
 return header("App Bundles",'<button class="sub-end" data-page="history">History</button>')+'<div class="data-tabs"><button data-page="data">Data Plan</button><button class="active" data-page="apps">APP Bundles</button></div>'+(items.length?'<div class="row-list">'+items.map(x=>'<div class="list-row"><span class="row-symbol">▦</span><span class="row-copy"><b>'+esc(x.name)+'</b><small>'+esc(x.description||"")+'</small></span><button class="small-button" data-action="buy-bundle" data-id="'+esc(x.id)+'">Buy</button></div>').join("")+'</div>':empty("No app bundles available","The APK includes a separate app-bundle store and history. Live app bundles appear here after a supplier publishes the supported apps and terms.",'<button class="secondary-button" data-action="catalog-status">Check provider status</button>'))+'<p class="footer-note">Bundle names, supported apps, prices and access limits must come from the contracted provider.</p>';
}
function balancePage(){
 const points=S.wallet?Number(S.wallet.pointsBalance||0):0;
 return '<div class="eyebrow">WALLET & TRANSACTIONS</div><h1 class="section-title" style="font-size:22px;margin:6px 0 15px">Balance</h1><div class="balance-card"><span class="balance-label">MOBILE SERVICE BALANCE</span><strong>Not activated</strong><small>A regulated wallet/payment provider has not been connected. No cash balance is being simulated.</small></div><div class="stat-grid"><div class="stat-box"><span>Reward Coins</span><strong>'+points.toLocaleString()+'</strong></div><div class="stat-box"><span>Cash wallet status</span><strong style="font-size:15px">Inactive</strong></div></div><div class="menu-list">'+row(icons.wallet,"Recharge Balance","Top up wallet after payment provider setup","","balance-recharge")+row(icons.signal,"Transfer Balance","Wallet transfers are unavailable until provider activation","","balance-transfer")+row(icons.gift,"Balance Vouchers","View rewards vouchers and redemption","","vouchers")+row(icons.wallet,"Transaction History","View reward coin ledger and airtime requests","","history")+row(icons.person,"Top Up Airtime","Request mobile airtime from a supported supplier","","airtime")+row(icons.gift,"Exchange G-Coins","Cash conversion is not active yet","","exchange-coins")+'</div><div class="panel"><h3>Balance Account & Security</h3><p class="tiny muted">These GENIEX-style wallet controls are shown here. They become usable only after a regulated wallet provider is connected to Expert Mobile.</p><div class="menu-list">'+row(icons.wallet,"Create Balance Account","Open a cash balance account","","balance-create-account")+row(icons.help,"Set Transaction PIN","Protect wallet payments","","balance-pin-setup")+row(icons.help,"Reset Transaction PIN","Reset an existing balance PIN","","balance-pin-reset")+row(icons.wallet,"Unfreeze Balance Account","Request wallet recovery","","balance-unfreeze")+'</div></div><div class="status-banner">G-Coins are loyalty points, not cash. Wallet recharge, transfers, PIN security and withdrawals are not active until a regulated payment provider and compliance setup are connected.</div>';
}
function accountPage(){
 if(!S.user){
 return '<div class="eyebrow">WELCOME TO EXPERT</div><h1 class="section-title" style="font-size:22px;margin:6px 0">Account</h1><div class="panel"><div class="auth-switch"><button class="'+(S.authMode==="login"?"active":"")+'" data-action="auth-mode" data-mode="login">Sign in</button><button class="'+(S.authMode==="register"?"active":"")+'" data-action="auth-mode" data-mode="register">Sign up</button></div><form id="authForm" class="form-stack">'+(S.authMode==="register"?'<div class="field"><label>Full name</label><input name="fullName" required minlength="2" autocomplete="name" placeholder="Your full name"></div>':"")+'<div class="field"><label>Email address</label><input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></div>'+(S.authMode==="register"?'<div class="field"><label>Phone number (optional)</label><input name="phone" autocomplete="tel" placeholder="+ country code"></div>':"")+'<div class="field"><label>Password</label><input type="password" name="password" required minlength="10" autocomplete="'+(S.authMode==="register"?"new-password":"current-password")+'" placeholder="At least 10 characters"></div>'+(S.authMode==="register"?'<label class="check-label"><input type="checkbox" name="terms" required> I agree to the Terms of Service and Privacy Notice.</label>':"")+'<button class="primary-button" type="submit">'+(S.authMode==="register"?"Create account":"Sign in")+'</button><p class="tiny muted" id="authMessage">Your account unlocks reward tasks, vouchers, order history and settings.</p></form><div class="separator"></div><p class="tiny muted">Google sign-in will appear when an authorised Google OAuth client is configured.</p></div>';
 }
 const u=S.user, initial=(u.fullName||u.email||"E").trim().slice(0,1).toUpperCase();
 return '<div class="profile-head"><div class="avatar">'+esc(initial)+'</div><div><b>'+esc(u.fullName||"Expert member")+'</b><small>'+esc(u.email||"")+'</small></div><span class="pill green" style="margin-left:auto">SIGNED IN</span></div><div class="panel"><div class="eyebrow">MEMBER ACCOUNT</div><div class="section-row" style="margin:7px 0"><b>'+esc(u.referralCode||"Member")+'</b><button class="small-button" data-action="share-referral">Share</button></div><p class="tiny muted">Your personal account, reward code and service activity.</p></div><div class="panel"><div class="eyebrow">THIS DEVICE · AUTO DETECTED</div><b>'+esc(S.device&&S.device.deviceName||"Device details unavailable")+'</b><p class="tiny muted">'+esc(S.device?[S.device.manufacturer,S.device.model,S.device.osVersion].filter(Boolean).join(" · "):"Device information is read automatically by the Android app; nothing to type in.")+'</p><span class="pill">'+(S.device&&S.device.hasEuiccHardware?"eSIM hardware detected":"eSIM hardware not confirmed")+'</span></div><div class="menu-list">'+row(icons.person,"My Account","Account information and password","","my-account")+row(icons.gift,"My Rewards","Tasks, check-in and G-Coins","","rewards")+row(icons.wallet,"My Balance","Wallet status and transactions","","balance")+row(icons.gift,"My Vouchers","Collected coupons and gift codes","","vouchers")+row(icons.wallet,"My Orders","Data, app bundle and airtime history","","orders")+row(icons.help,"Messages","Service announcements and inbox","","messages")+row(icons.signal,"Network Tools","Speedtest, analyzer and SIM settings","","network")+row(icons.help,"Settings","Appearance, notifications and preferences","","settings")+row(icons.help,"Contact Us","FAQ and support tickets","","help")+'</div><div style="margin-top:16px"><button class="danger-button" data-action="logout">Log out</button></div>';
}
function rewardsPage(){
 const s=S.summary||{}, tasks=s.tasks||[];
 return header("Reward Tasks")+'<div class="balance-card"><span class="balance-label">YOUR G-COINS</span><strong>'+Number(s.pointsBalance||0).toLocaleString()+'</strong><small>Reward coins earned from eligible in-app actions. Not cash.</small></div><div class="reward-actions"><button data-action="check-in"><b>Daily Check In</b><small>'+(s.dailyCheckinAvailable===false?"Collected today":"Collect today's reward")+'</small></button><button data-action="spin"><b>Coins Game</b><small>'+(s.dailySpinAvailable===false?"Used today":"One spin per day")+'</small></button><button data-page="sponsors"><b>Free Data</b><small>Sponsored reward availability</small></button><button data-action="exchange-coins"><b>Exchange G-Coins</b><small>Convert after wallet approval</small></button></div><div class="section-row"><h2 class="section-title">Tasks</h2><span class="pill">G-COINS</span></div>'+(tasks.filter(t=>t.id!=="daily_checkin").length?'<div class="row-list">'+tasks.filter(t=>t.id!=="daily_checkin").map(t=>'<div class="list-row"><span class="row-symbol">✓</span><span class="row-copy"><b>'+esc(t.title||t.name||t.id)+'</b><small>'+esc(t.description||t.status||"Complete this task")+'</small></span>'+(t.claimed?'<span class="pill green">DONE</span>':t.eligible?'<button class="small-button" data-action="claim-task" data-id="'+esc(t.id)+'">Claim</button>':'<span class="pill warn">PENDING</span>')+'</div>').join("")+'</div>':empty("No reward tasks listed","Complete available app activities to earn reward coins."))+'<div class="section-row"><h2 class="section-title">Invite Friends</h2></div><div class="panel"><div class="eyebrow">YOUR REFERRAL CODE</div><div class="section-row" style="margin:8px 0"><b>'+esc(s.referralCode||S.user?.referralCode||"Sign in to get a code")+'</b><button class="small-button" data-action="share-referral">Share Now</button></div><p class="tiny muted">Referral rewards are credited only after the qualifying account activity is confirmed.</p></div><div class="panel"><h3>Redeem Gift Code</h3><form id="redeemForm" class="form-stack"><div class="field"><label>Gift code</label><input name="code" required placeholder="Enter your gift code"></div><button class="primary-button" type="submit">REDEEM</button></form><p id="redeemStatus" class="tiny muted"></p></div>';
}
function vouchersPage(){
 return header("My Vouchers")+'<div class="row-list" id="voucherList"><div class="panel tiny muted">Loading vouchers…</div></div><div class="panel" style="margin-top:13px"><h3>Redeem Gift Code</h3><form id="voucherRedeemForm" class="form-stack"><div class="field"><label>Gift Code</label><input name="code" required placeholder="Enter voucher or gift code"></div><button class="primary-button" type="submit">REDEEM</button></form><p id="voucherStatus" class="tiny muted"></p></div>';
}
function airtimePage(){
 return header("Top Up Airtime")+'<div class="panel"><h3>Mobile Airtime</h3><p class="tiny muted">Submit a top-up request for an eligible supplier. It remains pending until the supplier confirms delivery.</p><form id="airtimeForm" class="form-stack"><div class="field"><label>Country code (ISO)</label><input name="countryCode" required value="NG" maxlength="2" placeholder="NG"></div><div class="field"><label>Phone number</label><input name="phone" required inputmode="tel" placeholder="+234…"></div><div class="field"><label>Amount</label><input name="amount" required type="number" min="1" step="0.01" placeholder="Enter amount"></div><div class="field"><label>Currency</label><input name="currency" required maxlength="3" value="NGN"></div><button class="primary-button" type="submit">Submit Top Up Request</button></form><p id="airtimeStatus" class="tiny muted"></p></div><div class="section-row"><h2 class="section-title">Top Up Airtime History</h2></div><div id="airtimeHistory" class="row-list"><div class="panel tiny muted">Loading history…</div></div>';
}
function speedPage(){
 return header("Speedtest")+'<div class="panel speed-card"><div class="eyebrow">LIVE CONNECTION TEST</div><div class="speed-dial"><div><strong id="speedDownload">'+(S.speed.download==null?"—":S.speed.download.toFixed(1))+'</strong><span>DOWNLOAD Mbps</span></div></div><div class="speed-metrics"><div><span>UPLOAD</span><b id="speedUpload">'+(S.speed.upload==null?"—":S.speed.upload.toFixed(1))+' Mbps</b></div><div><span>PING</span><b id="speedPing">'+(S.speed.ping==null?"—":S.speed.ping.toFixed(0))+' ms</b></div><div><span>JITTER</span><b id="speedJitter">'+(S.speed.jitter==null?"—":S.speed.jitter.toFixed(1))+' ms</b></div></div><p id="speedMessage" class="tiny muted">Measures the connection currently active on this phone using the Expert Railway test endpoints.</p><button class="primary-button" data-action="run-speed">START SPEEDTEST</button></div><div class="status-banner">The speed test measures the current Internet route for this phone. It does not prove that Expert cellular data service is active.</div>';
}
function networkPage(){
 const n=S.network||{};
 return header("Network Analyzer")+'<div class="panel"><div class="eyebrow">CURRENT NETWORK</div><div class="section-row" style="margin:8px 0"><b style="font-size:20px">'+esc(n.networkType||n.label||"Detecting…")+'</b><span class="pill '+(n.available?"green":"warn")+'">'+(n.available?"DETECTED":"NOT READ")+'</span></div><p class="tiny muted">'+esc(n.message||"Reading the current Android data network when permitted.")+'</p><div class="separator"></div><div class="stat-grid"><div class="stat-box"><span>Connection</span><strong style="font-size:14px">'+esc(n.transport||"Unknown")+'</strong></div><div class="stat-box"><span>Signal</span><strong style="font-size:14px">'+esc(n.signal||"Not exposed")+'</strong></div></div><button class="secondary-button" data-action="refresh-network">Refresh Network</button> <button class="secondary-button" data-action="open-network-settings">SIM & Network Settings</button></div><div class="menu-list">'+row(icons.speed,"Network Speedtest","Measure latency, download and upload","","speed")+row(icons.signal,"Network Diagnostic","Test the Railway connection and active route","","diagnostics")+row(icons.signal,"Preferred Network","Select Auto, 4G or 5G for the eSIM line","","network-settings")+row(icons.wallet,"Battery & Device Info","Battery, storage and device diagnostics","","battery")+'</div><div id="diagnosticMessage" class="status-banner">Radio and SIM details depend on Android permissions and device capabilities.</div>';
}
function networkSettingsPage(){
 const mode=S.preferredNetwork||"auto";
 const modes=[["auto","Automatic","Use all supported network technologies"],["4g","4G LTE","Prefer LTE mobile data"],["5g","5G","Prefer 5G NR with LTE fallback"]];
 return header("Preferred Network")+'<div class="panel"><div class="eyebrow">MOBILE NETWORK MODE</div><p class="tiny muted">Select the preferred radio mode for the enabled eSIM line. The phone or carrier may restrict direct switching.</p><div class="menu-list">'+modes.map(x=>'<button class="menu-action" data-action="set-network" data-mode="'+x[0]+'"><span class="menu-symbol">'+(mode===x[0]?"●":"○")+'</span><span>'+x[1]+'<small>'+x[2]+'</small></span><em>'+(mode===x[0]?"SELECTED":"›")+'</em></button>').join("")+'</div><p class="tiny muted" id="networkModeMessage">Current preference: '+esc(mode.toUpperCase())+'</p><button class="secondary-button" data-action="open-network-settings">Open Network Settings</button> <button class="secondary-button" data-action="open-sim-settings">Calls & SMS SIM</button><div class="status-banner">RSIM mode is not enabled. It requires an authorised virtual-network provider. Calls and SMS settings remain under Android SIM controls.</div></div><p class="footer-note">Network mode changes are device-controlled. This app does not guarantee 4G/5G availability where the carrier has no coverage.</p>';
}
function devicePage(){
 const d=S.device||{};
 const detailRows=[
  ["Manufacturer",d.manufacturer||"—"],
  ["Model",d.model||"—"],
  ["Android version",d.osVersion||"—"],
  ["eSIM hardware",d.hasEuiccHardware===true?"Detected":d.hasEuiccHardware===false?"Not detected":"Not reported"]
 ];
 return header("Device")+
 '<div class="panel device-summary"><div class="eyebrow">THIS DEVICE · AUTO DETECTED</div><h2>'+esc(d.deviceName||[d.manufacturer,d.model].filter(Boolean).join(" ")||"Device details unavailable")+'</h2><p class="tiny muted">Device information is read from Android. No manual device identifiers are requested.</p>'+
 detailRows.map(x=>'<div class="device-detail-row"><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>').join("")+
 '<div id="deviceHealth" class="device-health-details"><div class="tiny muted">Reading battery, storage and memory diagnostics…</div></div></div>'+
 '<div class="home-section-heading"><h2>Device tools</h2></div>'+
 '<div class="home-service-list">'+
 '<button type="button" data-page="network"><span>'+icons.signal+'</span><b>Network Detection</b><i>›</i></button>'+
 '<button type="button" data-page="network-settings"><span>'+icons.wifi+'</span><b>Preferred Network</b><i>›</i></button>'+
 '<button type="button" data-page="sim"><span>▣</span><b>SIM Management</b><i>›</i></button>'+
 '<button type="button" data-page="speed"><span>'+icons.speed+'</span><b>NetSpeed</b><i>›</i></button>'+
 '<button type="button" data-page="battery"><span>ϟ</span><b>Battery</b><i>›</i></button>'+
 '<button type="button" data-page="diagnostics"><span>'+icons.help+'</span><b>Diagnostics</b><i>›</i></button>'+
 '</div>';
}
function simPage(){
 const n=S.network||{};
 return header("SIM Management")+
 '<div class="panel"><div class="eyebrow">ANDROID SIM CONTROLS</div><h3>Manage SIM cards</h3><p class="tiny muted">SIM activation, default mobile data, calls and SMS are controlled by Android and the carrier. This app will open the phone’s own SIM settings rather than pretending it can switch a SIM silently.</p><div class="device-detail-row"><span>Detected network</span><b>'+esc(n.networkType||"Not reported")+'</b></div><div class="device-detail-row"><span>eSIM device</span><b>'+esc(S.device&&S.device.hasEuiccHardware===true?"Supported":S.device&&S.device.hasEuiccHardware===false?"Not detected":"Not reported")+'</b></div><button type="button" class="primary-button" data-action="open-sim-settings">OPEN SIM SETTINGS</button></div>'+
 '<div class="home-service-list"><button type="button" data-page="network"><span>'+icons.signal+'</span><b>Network Detection</b><i>›</i></button><button type="button" data-page="network-settings"><span>'+icons.wifi+'</span><b>Preferred Network</b><i>›</i></button></div>';
}
function diagnosticsPage(){return header("Network Diagnostic")+'<div class="panel"><div class="eyebrow">CONNECTION DIAGNOSTIC</div><p class="tiny muted">Run a local connectivity check against the Expert Railway service and inspect the detected mobile radio.</p><div id="diagnosticMessage" class="status-banner">Ready to test the connection.</div><button class="primary-button" data-action="diagnostics">RUN DIAGNOSTIC</button></div>'+(S.network?'<div class="panel"><h3>Mobile network</h3><b>'+esc(S.network.networkType||"Unknown")+'</b><p class="tiny muted">'+esc(S.network.message||"")+"</p></div>":"");}
function batteryPage(){return header("Battery & Device Info")+'<div id="deviceHealth" class="panel"><div class="tiny muted">Reading device diagnostics…</div></div><button class="secondary-button" data-action="open-battery-settings">Open Battery Settings</button>';}
async function loadPreferredNetwork(){
 const n=window.ExpertMobileNative;
 if(n&&typeof n.getPreferredNetwork==="function"){try{const v=JSON.parse(n.getPreferredNetwork());S.preferredNetwork=v.mode||"auto";}catch(e){S.preferredNetwork="auto";}}
 else S.preferredNetwork="auto";
 if(S.page==="network-settings")render();
}
function loadDeviceHealth(){
 const el=$("deviceHealth");if(!el)return;
 const n=window.ExpertMobileNative;
 if(n&&typeof n.getDeviceHealth==="function"){try{const d=JSON.parse(n.getDeviceHealth());el.innerHTML='<h3>Device health</h3>'+[["Battery",d.batteryPercent==null?"Not reported":d.batteryPercent+"%"],["Charging",d.charging?"Yes":"No"],["Memory available",(d.memoryAvailableMb??"—")+" MB"],["Storage available",(d.storageAvailableMb??"—")+" MB"],["Thermal status",d.thermalStatus||"Not reported"]].map(x=>'<div class="list-row"><span class="row-copy"><b>'+esc(x[0])+'</b></span><span class="row-tail">'+esc(x[1])+'</span></div>').join("");}catch(e){el.textContent="Device diagnostics unavailable: "+e.message;}}
 else el.innerHTML='<h3>Device diagnostics</h3><p class="tiny muted">Battery, memory and storage readings are available inside the Android Expert app. Browser access is limited.</p>';
}
function sponsorsPage(){
 return header("Free Data & Offers")+'<div class="panel"><div class="eyebrow">SPONSORED REWARDS</div><h3>Free Data</h3><p class="tiny muted">Discover data rewards and ad-supported offers from approved sponsors. No sponsor inventory or rewarded-ad provider is connected yet.</p><div class="status-banner">Sponsored offers are currently unavailable. No ad will be shown and no data reward will be issued until a sponsor partner is connected.</div><button class="primary-button" data-action="free-data">CHECK FREE DATA REWARDS</button></div><div class="section-row"><h2 class="section-title">Available Offers</h2></div><div id="sponsorOfferList" class="row-list">'+empty("No sponsored offers","An active sponsor or rewarded-ad partner has not published any offers.")+'</div><p class="footer-note">Offers, reward values and eligibility must be received from the sponsor service. None are simulated.</p>';
}
async function loadSponsorOffers(){
 try{const r=await api("/geniex/sponsor/offers");S.sponsorOffers=r.offers||[];const el=$("sponsorOfferList");if(el)el.innerHTML=S.sponsorOffers.length?S.sponsorOffers.map(o=>'<div class="list-row"><span class="row-symbol">'+icons.gift+'</span><span class="row-copy"><b>'+esc(o.title||"Sponsored reward")+'</b><small>'+esc(o.description||"")+'</small></span><button class="small-button" data-action="free-data">Claim</button></div>').join(""):empty("No sponsored offers",r.message||"No active rewards.");}
 catch(e){const el=$("sponsorOfferList");if(el)el.innerHTML=empty("Offers unavailable",e.message);}
}
function usagePage(){
 const u=S.usage||{};
 return header("Usage Details")+'<div class="panel"><div class="eyebrow">MOBILE DATA USAGE</div><div class="usage-total"><strong>'+(u.available?esc(u.usedMb||0):"—")+' <small>MB</small></strong><span class="pill">'+(u.available?"LIVE CARRIER FEED":"NOT CONNECTED")+'</span></div><p class="tiny muted">'+esc(u.message||"No authenticated carrier usage feed is connected.")+'</p></div>'+empty("Usage feed unavailable","Detailed daily and weekly usage can only be shown after the mobile provider supplies an authenticated usage API.")+'<p class="footer-note">Device network measurements are not the same as carrier-reported data consumption.</p>';
}
function ordersPage(){
 return header("My Orders")+'<div class="row-list" id="ordersList">'+empty("No orders to show","Data and app-bundle order history will appear here when a live provider and payment flow are connected.")+'</div>';
}
function historyPage(){return header("History")+'<div class="menu-list">'+row(icons.wallet,"Reward Coin History","Points balance movements","","rewards")+row(icons.gift,"Voucher History","Collected and redeemed vouchers","","vouchers")+row(icons.person,"Airtime History","Top-up requests and supplier results","","airtime")+row(icons.signal,"Speedtest History","Recent connection tests","","speed")+'</div><p class="footer-note">Only transactions recorded by this account are displayed.</p>';}
function settingsPage(){
 const p=S.preferences||{};
 return header("Settings")+'<div class="panel"><h3>Appearance</h3><div class="toggle-row"><span>Dark theme<small>Use the GENIEX-style dark interface</small></span><input id="prefDark" class="toggle" type="checkbox" '+(p.darkMode!==false?"checked":"")+'></div><div class="toggle-row"><span>Reduce animations<small>Limit interface motion</small></span><input id="prefMotion" class="toggle" type="checkbox" '+(p.reduceMotion?"checked":"")+'></div></div><div class="panel"><h3>Notifications</h3><div class="toggle-row"><span>In-app notifications</span><input id="prefInApp" class="toggle" type="checkbox" '+(p.inAppNotifications!==false?"checked":"")+'></div><div class="toggle-row"><span>Email notifications</span><input id="prefEmail" class="toggle" type="checkbox" '+(p.emailNotifications?"checked":"")+'></div><div class="toggle-row"><span>Usage alerts</span><input id="prefUsage" class="toggle" type="checkbox" '+(p.usageAlerts!==false?"checked":"")+'></div><div class="toggle-row"><span>Offer updates</span><input id="prefOffers" class="toggle" type="checkbox" '+(p.sponsorOfferUpdates!==false?"checked":"")+'></div><p class="tiny muted" id="settingsMessage">Settings are saved to your account when signed in.</p><button class="primary-button" data-action="save-settings">SAVE SETTINGS</button></div><div class="panel"><h3>SIM & Network</h3><p class="tiny muted">SIM selection and calls/SMS preferences are managed by Android. This app will not change your physical SIM without an Android confirmation.</p><button class="secondary-button" data-action="open-sim-settings">Open SIM Settings</button></div>';
}
function helpPage(){
 return header("Help & Support")+'<div class="panel"><h3>Frequently Asked Questions</h3><div class="row-list"><div class="list-row"><span class="row-copy"><b>Why is Connect unavailable?</b><small>A carrier network partner and authorised profile must be active first.</small></span></div><div class="list-row"><span class="row-copy"><b>Why are no plans shown?</b><small>Plans and app bundles are published only from a connected supplier catalogue.</small></span></div><div class="list-row"><span class="row-copy"><b>How is usage calculated?</b><small>Usage details come from an authenticated subscriber feed from the provider.</small></span></div></div></div><div class="panel"><h3>Contact Customer Service</h3><form id="supportForm" class="form-stack"><div class="field"><label>Category</label><select name="category"><option value="network">Network connection</option><option value="data">Data plans / usage</option><option value="account">Account</option><option value="airtime">Airtime</option><option value="other">Other</option></select></div><div class="field"><label>Subject</label><input name="subject" required placeholder="What do you need help with?"></div><div class="field"><label>Message</label><textarea name="message" required minlength="10" placeholder="Describe the issue"></textarea></div><button class="primary-button" type="submit">SEND MESSAGE</button></form><p id="supportStatus" class="tiny muted"></p></div>';
}
function messagesPage(){return header("Messages")+'<div id="messageList" class="row-list"><div class="panel tiny muted">Loading messages…</div></div>';}
function myAccountPage(){
 return header("My Account")+'<div class="panel"><div class="profile-head"><div class="avatar">'+esc((S.user.fullName||S.user.email).slice(0,1).toUpperCase())+'</div><div><b>'+esc(S.user.fullName)+'</b><small>'+esc(S.user.email)+'</small></div></div><div class="separator"></div><div class="field"><label>Account email</label><input value="'+esc(S.user.email)+'" readonly></div><div class="field" style="margin-top:10px"><label>Referral Code</label><input value="'+esc(S.user.referralCode||"")+'" readonly></div></div><div class="panel"><h3>Change Password</h3><form id="passwordForm" class="form-stack"><div class="field"><label>Current password</label><input name="currentPassword" type="password" required></div><div class="field"><label>New password</label><input name="newPassword" type="password" minlength="10" required></div><button class="primary-button" type="submit">UPDATE PASSWORD</button></form><p id="passwordStatus" class="tiny muted"></p></div>';
}
async function loadMe(){
 try{const m=await api("/me");S.user=m.user;await refreshAccount();}
 catch(e){S.user=null;}
 render();
}
async function refreshAccount(){
 if(!S.user)return;
 try{const r=await api("/app/summary");S.summary=r.summary;}catch(e){}
}
async function registerDetectedDevice(){
 if(!S.user||!S.device||!S.device.clientDeviceId)return;
 try{await api("/devices",{method:"POST",body:JSON.stringify(S.device)});await refreshAccount();}
 catch(e){notify("Device registration: "+e.message);}
}
async function loadCatalog(){
 try{const r=await api("/geniex/catalog");S.catalog={plans:r.plans||[],bundles:r.bundles||[],countryPlans:S.catalog.countryPlans||[]};S.catalogMessage=r.message||"";if(S.page==="data"||S.page==="apps")render();}
 catch(e){notify(e.message);}
}
async function loadCountryCatalog(){
 if(!S.selectedCountry)return;
 S.countryCatalogLoading=true;S.countryCatalogMessage="";S.countryProvider=null;S.countrySpeed=null;S.selectedPlanId=null;render();
 try{
  const query=new URLSearchParams({countryCode:S.selectedCountry.code,category:S.planType});
  const r=await api("/geniex/catalog?"+query.toString());
  S.catalog.countryPlans=Array.isArray(r.plans)?r.plans:[];
  S.countryProvider=r.providerName||(r.provider&&r.provider.name)||null;
  S.countrySpeed=r.speedLabel||r.speed||null;
  S.countryCatalogMessage=r.message||"";
 }catch(e){S.catalog.countryPlans=[];S.countryCatalogMessage=e.message||"Availability could not be checked.";}
 finally{S.countryCatalogLoading=false;if(S.page==="country-plans")render();}
}
async function loadUsage(){
 try{const r=await api("/geniex/usage");S.usage=r.usage||r; if(S.page==="usage"||S.page==="home")render();}
 catch(e){S.usage={available:false,message:e.message};if(S.page==="usage")render();}
}
async function loadBalance(){
 if(!S.user){S.wallet=null;return;}
 try{const r=await api("/app/wallet");S.wallet=r.wallet;if(S.page==="balance")render();}
 catch(e){notify(e.message);}
}
async function loadRewards(){
 if(!S.user){setPage("account");notify("Sign in to view reward tasks.");return;}
 try{const r=await api("/app/summary");S.summary=r.summary;render();}
 catch(e){notify(e.message);}
}
async function loadVouchers(){
 if(!S.user){setPage("account");notify("Sign in to view vouchers.");return;}
 try{const r=await api("/app/coupons");const list=$("voucherList");if(list)list.innerHTML=(r.coupons.available||[]).map(c=>'<div class="list-row"><span class="row-symbol">'+icons.gift+'</span><span class="row-copy"><b>'+esc(c.title)+'</b><small>'+esc(c.description||c.type||"Voucher")+'</small></span>'+(c.claimed?'<span class="pill green">COLLECTED</span>':'<button class="small-button" data-action="claim-coupon" data-id="'+esc(c.id)+'">Collect</button>')+'</div>').join("")||empty("No vouchers available","New vouchers will be shown here when published.");}
 catch(e){notify(e.message);}
}
async function loadAirtime(){
 if(!S.user){setPage("account");notify("Sign in to view airtime history.");return;}
 try{const r=await api("/app/airtime");const el=$("airtimeHistory");if(el)el.innerHTML=(r.requests||[]).map(x=>'<div class="list-row"><span class="row-symbol">↗</span><span class="row-copy"><b>'+esc(x.reference)+'</b><small>'+esc(x.phone)+' · '+esc(x.amount)+' '+esc(x.currency)+'</small></span><span class="pill">'+esc(x.status)+'</span></div>').join("")||empty("No top up airtime history","Your confirmed and pending airtime requests will appear here.");}
 catch(e){notify(e.message);}
}
async function loadOrders(){
 if(!S.user)return;
 try{const r=await api("/me");const el=$("ordersList");if(el)el.innerHTML=(r.orders||[]).filter(o=>o.status!=="retired").map(o=>'<div class="list-row"><span class="row-symbol">▤</span><span class="row-copy"><b>'+esc(o.planName||o.reference)+'</b><small>'+esc(o.reference)+' · '+esc(o.createdAt)+'</small></span><span class="pill">'+esc(o.status)+'</span></div>').join("")||empty("No orders yet","New data or app-bundle orders will appear after a live provider and payment partner are connected.");}
 catch(e){notify(e.message);}
}
function applyTheme(){
 const p=S.preferences||{};document.body.classList.toggle("light-theme",p.darkMode===false);document.body.classList.toggle("reduce-motion",p.reduceMotion===true);
}
async function loadSettings(){
 if(!S.user){S.preferences={darkMode:true,reduceMotion:false,inAppNotifications:true,usageAlerts:true,sponsorOfferUpdates:true};applyTheme();render();return;}
 try{const r=await api("/app/preferences");S.preferences=r.preferences;applyTheme();if(S.page==="settings")render();}
 catch(e){notify(e.message);}
}
async function loadMessages(){
 if(!S.user){setPage("account");return;}
 try{const r=await api("/app/messages");const el=$("messageList");if(el)el.innerHTML=(r.messages||[]).map(m=>'<div class="panel"><div class="section-row" style="margin:0"><b>'+esc(m.title)+'</b><span class="pill">'+(m.readAt?"READ":"NEW")+'</span></div><p class="tiny muted">'+esc(m.message)+'</p>'+(m.readAt?"":'<button class="small-button" data-action="read-message" data-id="'+esc(m.id)+'">Mark read</button>')+'</div>').join("")||empty("No messages","Service announcements will appear here.");}
 catch(e){notify(e.message);}
}
function readNetwork(){
 const n=window.ExpertMobileNative;
 if(n&&typeof n.getCurrentNetworkInfo==="function"){try{n.getCurrentNetworkInfo();S.network=S.network||{networkType:"Reading…",available:false,message:"Waiting for Android network information."};}catch(e){S.network={networkType:"Unavailable",available:false,message:e.message};}}
 else{const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;S.network={networkType:c&&c.effectiveType?c.effectiveType.toUpperCase():"Browser network",transport:c&&c.type?c.type:"Internet connection",available:true,message:"Browser mode cannot verify SIM slot or carrier radio technology."};render();}
 if(S.page==="home"||S.page==="device")render();
}
function refreshNetwork(){readNetwork();if(S.page==="network"||S.page==="device")render();}
function loadStatus(){
 api("/geniex/status").then(r=>{S.status=r;const h=$("headerStatus");if(h){h.classList.toggle("online",!!r.networkProviderConfigured);h.innerHTML='<i></i>'+(r.networkProviderConfigured?"Provider ready":"Provider pending");}if(S.page==="home")render();}).catch(()=>{});
}
async function runSpeed(){
 const msg=$("speedMessage");const btn=document.querySelector('[data-action="run-speed"]');if(btn)btn.disabled=true;if(msg)msg.textContent="Testing ping, download and upload on the Railway connection…";
 try{
  const p=[];for(let i=0;i<5;i++){const t=performance.now();await fetch("/api/v1/tools/speedtest/ping?ts="+Date.now()+i,{cache:"no-store"});p.push(performance.now()-t);}
  const ping=p.reduce((a,b)=>a+b,0)/p.length,jitter=Math.sqrt(p.reduce((a,b)=>a+(b-ping)**2,0)/p.length);
  const bytes=1500000,start=performance.now(),down=await fetch("/api/v1/tools/speedtest/download?bytes="+bytes+"&ts="+Date.now(),{cache:"no-store"});const buf=await down.arrayBuffer();const dl=buf.byteLength*8/(Math.max(1,performance.now()-start)*1000);
  const upBytes=500000,body=new Uint8Array(upBytes),ustart=performance.now();await fetch("/api/v1/tools/speedtest/upload",{method:"POST",headers:{"content-type":"application/octet-stream"},body:body,cache:"no-store"});const ul=upBytes*8/(Math.max(1,performance.now()-ustart)*1000);
  S.speed={download:dl,upload:ul,ping:ping,jitter:jitter};
  $("speedDownload").textContent=dl.toFixed(1);$("speedUpload").textContent=ul.toFixed(1)+" Mbps";$("speedPing").textContent=ping.toFixed(0)+" ms";$("speedJitter").textContent=jitter.toFixed(1)+" ms";
  if(S.user){await api("/app/speed-test",{method:"POST",body:JSON.stringify({downloadMbps:Number(dl.toFixed(1)),uploadMbps:Number(ul.toFixed(1)),pingMs:Number(ping.toFixed(1)),jitterMs:Number(jitter.toFixed(1))})}).catch(()=>{});}
  if(msg)msg.textContent="Test completed against the Railway service. It measures the active route, not a provider-specific mobile data entitlement.";
 }catch(e){if(msg)msg.textContent="Speedtest failed: "+e.message;}
 finally{if(btn)btn.disabled=false;}
}
async function connectNetwork(){
 if(S.connecting)return;
 if(!S.user){setPage("account");notify("Sign in to check your network service.");return;}
 S.connecting=true;render();
 try{
  const route=S.connected?"/geniex/disconnect":"/geniex/connect";
  const r=await api(route,{method:"POST",body:"{}"});
  S.connected=!!r.connected;
 }catch(e){notify(e.message);}
 finally{S.connecting=false;render();}
}
async function requestUnavailable(route,label){
 try{await api(route,{method:"POST",body:"{}"});}
 catch(e){notify(e.message||label+" is not available yet.");}
}
window.onExpertNetworkInfoResult=function(result){
 S.network={networkType:result&&result.label||result&&result.networkType||result&&result.status||"Not available",available:!!(result&&result.hasRadio&&result.label!=="Network type unavailable"),message:result&&result.message||"",transport:"Mobile data SIM",signal:result&&result.supports5g?"5G capable":"Signal strength not exposed"};
 if(S.page==="network"||S.page==="home")render();
};
window.onExpertNetworkModeResult=function(result){notify(result&&result.message||"Network preference updated.");};
function saveSettings(){
 const p={darkMode:$("prefDark")?.checked!==false,reduceMotion:$("prefMotion")?.checked===true,inAppNotifications:$("prefInApp")?.checked!==false,emailNotifications:$("prefEmail")?.checked===true,usageAlerts:$("prefUsage")?.checked!==false,sponsorOfferUpdates:$("prefOffers")?.checked!==false};
 if(!S.user){notify("Sign in to sync settings to your account.");return;}
 api("/app/preferences",{method:"PATCH",body:JSON.stringify(p)}).then(r=>{S.preferences=r.preferences;applyTheme();notify("Settings saved to your account.");}).catch(e=>notify(e.message));
}
async function authSubmit(form){
 const data=Object.fromEntries(new FormData(form).entries());
 const register=S.authMode==="register";
 const payload={email:data.email,password:data.password};
 if(register){payload.fullName=data.fullName;payload.phone=data.phone||"";payload.acceptedTerms=data.terms==="on";payload.acceptedPrivacy=data.terms==="on";}
 const msg=$("authMessage");if(msg)msg.textContent=register?"Creating account…":"Signing in…";
 try{const r=await api("/auth/"+(register?"register":"login"),{method:"POST",body:JSON.stringify(payload)});S.user=r.user;await registerDetectedDevice();await refreshAccount();if(register&&r.emailVerification&&!r.emailVerification.sent)notify("Account created. Email delivery is not configured yet.");else notify(register?"Account created.":"Signed in.");S.page="home";render();}
 catch(e){if(msg)msg.textContent=e.message;else notify(e.message);}
}
async function shareReferral(){
 const code=S.summary&&S.summary.referralCode||S.user&&S.user.referralCode||"";
 if(!code){notify("Sign in to access your referral code.");return;}
 const link=location.origin+"/?ref="+encodeURIComponent(code);
 if(navigator.share){try{await navigator.share({title:"Join Expert",text:"Use my referral code "+code, url:link});}catch(e){}}
 else{try{await navigator.clipboard.writeText("Referral code: "+code+" · "+link);notify("Referral link copied.");}catch(e){notify("Your referral code is "+code);}}
}
async function handleClick(e){

 const countryAction=e.target.closest("[data-action]");
 if(countryAction&&countryAction.dataset.action==="select-country"){
  const selected=getCountryItems().find(c=>c.code===countryAction.dataset.code);
  if(selected){S.selectedCountry=selected;S.page="country-plans";S.planType="data";S.selectedPlanId=null;S.countryCatalogMessage="";render();loadCountryCatalog();}
  return;
 }
 if(countryAction&&countryAction.dataset.action==="clear-country-search"){
  S.countryQuery="";const input=$("countrySearch");if(input)input.value="";const list=$("countryList");if(list)list.innerHTML=countryRows();return;
 }
 if(countryAction&&countryAction.dataset.action==="go-back"){
  if(S.page==="country-plans"){S.page="countries";S.countryQuery="";render();}
  else{S.page="home";render();}
  return;
 }
 if(countryAction&&countryAction.dataset.action==="plan-type"){
  const nextType=countryAction.dataset.type||"data";
  if(nextType!==S.planType){S.planType=nextType;S.selectedPlanId=null;loadCountryCatalog();}
  return;
 }
 if(countryAction&&countryAction.dataset.action==="select-plan"){S.selectedPlanId=countryAction.dataset.id||null;render();return;}
 if(countryAction&&countryAction.dataset.action==="refresh-country-catalog"){loadCountryCatalog();return;}

 const page=e.target.closest("[data-page]");if(page){setPage(page.dataset.page);return;}
 const b=e.target.closest("[data-action]");if(!b)return;
 const a=b.dataset.action;
 if(a==="close-modal"){if(e.target===b)closeModal();return;}
 if(a==="noop")return;
 if(a==="auth-mode"){S.authMode=b.dataset.mode;render();return;}
 if(a==="connect"){await connectNetwork();return;}
 if(a==="add-data"||a==="catalog-status"){loadStatus();openModal("Data service status","<p>Data plans and app bundles are not being invented. They will populate when the contracted provider exposes its catalogue and the payment/fulfilment integration is active.</p>",'<button class="secondary-button" data-action="close-modal">Close</button>');return;}
 if(a==="buy-data"||a==="buy-bundle"){
  if(!S.user){setPage("account");notify("Sign in before purchasing.");return;}
  try{await api(a==="buy-data"?"/geniex/data/order":"/geniex/app-bundle/order",{method:"POST",body:JSON.stringify({itemId:b.dataset.id,countryCode:S.selectedCountry&&S.selectedCountry.code,planType:S.planType})});}
  catch(err){notify(err.message);}return;
 }
 if(a==="check-in"||a==="spin"){
  if(!S.user){setPage("account");notify("Sign in first.");return;}
  try{const r=await api(a==="check-in"?"/app/check-in":"/app/spin",{method:"POST",body:"{}"});notify(String(r.message||"Reward added.").replace(/Expert Points/g,"G-Coins"));await loadRewards();}
  catch(err){notify(err.message);}return;
 }
 if(a==="claim-task"){
  try{const r=await api("/app/tasks/"+encodeURIComponent(b.dataset.id)+"/claim",{method:"POST",body:"{}"});notify(String(r.message||"Task reward claimed.").replace(/Expert Points/g,"G-Coins"));await loadRewards();}
  catch(err){notify(err.message);}return;
 }
 if(a==="claim-coupon"){
  try{const r=await api("/app/coupons/"+encodeURIComponent(b.dataset.id)+"/claim",{method:"POST",body:"{}"});notify(r.message||"Voucher collected.");loadVouchers();}
  catch(err){notify(err.message);}return;
 }
 if(a==="logout"){
  try{await api("/auth/logout",{method:"POST",body:"{}"});}catch(e){}
  S.user=null;S.summary=null;S.wallet=null;S.page="home";notify("Signed out.");render();return;
 }
 if(a==="share-referral"){await shareReferral();return;}
 if(a==="run-speed"){await runSpeed();return;}
 if(a==="refresh-network"){refreshNetwork();notify("Refreshing network details…");return;}
 if(a==="set-network"){
  const n=window.ExpertMobileNative;const mode=b.dataset.mode||"auto";S.preferredNetwork=mode;
  if(n&&typeof n.setPreferredNetwork==="function"){try{n.setPreferredNetwork(mode);render();}catch(err){notify(err.message);}}
  else{render();notify("This browser cannot change the handset radio mode. Use Android SIM settings.");}
  return;
 }
 if(a==="open-battery-settings"){const n=window.ExpertMobileNative;if(n&&typeof n.openBatterySettings==="function")n.openBatterySettings();else notify("Open Battery from your device settings.");return;}
 if(a==="open-network-settings"||a==="open-sim-settings"){
  const n=window.ExpertMobileNative;
  if(a==="open-sim-settings"&&n&&typeof n.openSimSettings==="function")n.openSimSettings();
  else if(n&&typeof n.openNetworkSettings==="function")n.openNetworkSettings();
  else notify("Open your phone settings to select the SIM and preferred network.");return;
 }
 if(a==="diagnostics"){
  try{const t=performance.now();await fetch("/api/v1/tools/speedtest/ping",{cache:"no-store"});const v=Math.round(performance.now()-t);const el=$("diagnosticMessage");if(el)el.textContent="Railway service reachable. Round-trip latency from this device: "+v+" ms. This does not verify carrier coverage.";notify("Network diagnostic completed.");}
  catch(err){notify(err.message);}return;
 }
 if(a==="read-message"){try{await api("/app/messages/"+b.dataset.id+"/read",{method:"POST",body:"{}"});loadMessages();}catch(err){notify(err.message);}return;}
 if(a==="save-settings"){saveSettings();return;}
 if(a==="speed-boost"){await requestUnavailable("/geniex/boost","Speed Boost");return;}
 if(a==="free-data"){await requestUnavailable("/geniex/ad-reward/claim","Free data reward");return;}
 if(a==="balance-create-account"){await requestUnavailable("/geniex/balance/account","Balance account");return;}
 if(a==="balance-pin-setup"){await requestUnavailable("/geniex/balance/pin/setup","Transaction PIN setup");return;}
 if(a==="balance-pin-reset"){await requestUnavailable("/geniex/balance/pin/reset","Transaction PIN reset");return;}
 if(a==="balance-unfreeze"){await requestUnavailable("/geniex/balance/unfreeze","Balance account unfreeze");return;}
 if(a==="balance-recharge"){await requestUnavailable("/geniex/balance/recharge","Balance recharge");return;}
 if(a==="balance-transfer"){await requestUnavailable("/geniex/balance/transfer","Balance transfer");return;}
 if(a==="exchange-coins"){await requestUnavailable("/geniex/balance/exchange","G-Coin exchange");return;}
}
document.addEventListener("click",handleClick);
document.addEventListener("input",e=>{
 if(e.target&&e.target.id==="countrySearch"){S.countryQuery=e.target.value||"";const list=$("countryList");if(list)list.innerHTML=countryRows();}
});
document.addEventListener("submit",async e=>{
 const f=e.target;if(!f||!f.id)return;e.preventDefault();
 if(f.id==="authForm"){await authSubmit(f);return;}
 if(f.id==="redeemForm"||f.id==="voucherRedeemForm"){
  if(!S.user){setPage("account");return;}
  const code=new FormData(f).get("code");const id=f.id==="redeemForm"?"redeemStatus":"voucherStatus";const el=$(id);if(el)el.textContent="Redeeming…";
  try{const r=await api("/app/redeem-code",{method:"POST",body:JSON.stringify({code})});if(el)el.textContent=String(r.message||"Code redeemed.").replace(/Expert Points/g,"G-Coins");f.reset();loadVouchers();await refreshAccount();}
  catch(err){if(el)el.textContent=err.message;}return;
 }
 if(f.id==="airtimeForm"){
  if(!S.user){setPage("account");return;}
  const d=Object.fromEntries(new FormData(f).entries());d.countryCode=String(d.countryCode||"").toUpperCase();d.amount=Number(d.amount);const el=$("airtimeStatus");el.textContent="Submitting request…";
  try{const r=await api("/app/airtime",{method:"POST",body:JSON.stringify(d)});el.textContent=r.request.message||"Request saved and awaiting supplier.";f.reset();loadAirtime();}
  catch(err){el.textContent=err.message;}return;
 }
 if(f.id==="supportForm"){
  if(!S.user){setPage("account");return;}
  const d=Object.fromEntries(new FormData(f).entries());const el=$("supportStatus");el.textContent="Sending…";
  try{const r=await api("/support/tickets",{method:"POST",body:JSON.stringify(d)});el.textContent=r.message||"Support ticket submitted.";f.reset();}
  catch(err){el.textContent=err.message;}return;
 }
 if(f.id==="passwordForm"){
  const d=Object.fromEntries(new FormData(f).entries());const el=$("passwordStatus");el.textContent="Updating…";
  try{const r=await api("/auth/change-password",{method:"POST",body:JSON.stringify(d)});el.textContent=r.message||"Password updated.";f.reset();}
  catch(err){el.textContent=err.message;}return;
 }
});
async function init(){
 render();loadStatus();loadCatalog();loadUsage();
 const n=window.ExpertMobileNative;
 if(n&&typeof n.getDeviceInfo==="function"){try{S.device=JSON.parse(n.getDeviceInfo());document.documentElement.dataset.device=S.device.deviceName||S.device.model||"android";}catch(e){}}
 readNetwork();
 try{const m=await api("/me");S.user=m.user;await registerDetectedDevice();await refreshAccount();}catch(e){S.user=null;}
 if(S.user){try{const [sum,wal]=await Promise.all([api("/app/summary"),api("/app/wallet")]);S.summary=sum.summary;S.wallet=wal.wallet;}catch(e){}}
 render();
 const ref=new URLSearchParams(location.search).get("ref");if(ref&&!S.user){S.authMode="register";}
 if("serviceWorker" in navigator){navigator.serviceWorker.register("/sw.js").catch(()=>{});}
}
init();
})();