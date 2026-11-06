const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let currentUser = null, dashboard = null, authMode = "login", cashChart = null, categoryChart = null;
const categoryColors = ["#20bd8b","#8175ee","#f1ae4b","#e76b79","#47a8df","#c77de4","#8a9ab3","#4ac3c0"];
const currencySymbols = {INR:"₹",USD:"$",EUR:"€",GBP:"£",AED:"AED ",CAD:"CA$",AUD:"A$"};
const icons = {Food:"◉",Transport:"↗",Shopping:"◇",Bills:"▤",Health:"✚",Entertainment:"♫",Salary:"↙",Freelance:"✧",Education:"▣",Home:"⌂",Travel:"✈",Other:"•"};
function fmt(n) { const cur = dashboard?.settings?.currency || "INR"; try { return new Intl.NumberFormat(cur==="INR"?"en-IN":"en-US",{style:"currency",currency:cur,maximumFractionDigits:0}).format(Number(n)||0); } catch { return (currencySymbols[cur]||"") + Math.round(Number(n)||0).toLocaleString(); } }
function dateFmt(d) { if(!d)return ""; return new Date(d+"T12:00:00").toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}); }
function toast(msg) { const el=$("#toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); }
async function api(url, options={}) {
 const res = await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
 if (res.status===401) { showAuth(); throw new Error("Please sign in again."); }
 const type=res.headers.get("content-type")||"";
 if (!type.includes("application/json")) { if(!res.ok)throw new Error("Request failed."); return res; }
 const data=await res.json(); if(!res.ok)throw new Error(data.error||"Something went wrong."); return data;
}
function showAuth() { $("#appShell").classList.add("hidden"); $("#authScreen").classList.remove("hidden"); }
function showApp() { $("#authScreen").classList.add("hidden"); $("#appShell").classList.remove("hidden"); }
function setAuthMode(mode) {
 authMode=mode; const register=mode==="register";
 $("#authTitle").textContent=register?"Create your account":"Welcome back";
 $("#authSub").textContent=register?"Start building a clearer picture of your money.":"Sign in to continue to your dashboard.";
 $("#nameField").classList.toggle("hidden",!register);
 $("#authName").required=register; $("#authPassword").autocomplete=register?"new-password":"current-password";
 $("#authSubmit").innerHTML=register?'Create account <span>→</span>':'Sign in <span>→</span>';
 $("#switchText").textContent=register?"Already have an account?":"New to Finora?";
 $("#switchAuth").textContent=register?"Sign in":"Create an account"; $("#authError").textContent="";
}
$("#switchAuth").addEventListener("click",()=>setAuthMode(authMode==="login"?"register":"login"));
$("#authForm").addEventListener("submit",async e=>{
 e.preventDefault(); $("#authError").textContent="";
 const body={email:$("#authEmail").value,password:$("#authPassword").value};
 if(authMode==="register")body.name=$("#authName").value;
 try { const d=await api("/api/auth/"+authMode,{method:"POST",body:JSON.stringify(body)}); currentUser=d.user; await loadDashboard(); showApp(); toast(authMode==="register"?"Account created. Welcome to Finora!":"Welcome back!"); }
 catch(err){$("#authError").textContent=err.message;}
});
$("#logoutBtn").addEventListener("click",async()=>{try{await api("/api/auth/logout",{method:"POST",body:"{}"});}catch{} currentUser=null;showAuth();setAuthMode("login");$("#authPassword").value="";});
async function boot(){try{const d=await api("/api/auth/me");if(d.user){currentUser=d.user;await loadDashboard();showApp();}else showAuth();}catch{showAuth();}}
async function loadDashboard(){dashboard=await api("/api/dashboard");currentUser={...currentUser,name:currentUser?.name||dashboard.user?.name};renderAll();}
function renderAll(){
 if(!dashboard)return;
 const s=dashboard.settings,st=dashboard.stats;
 document.body.classList.toggle("theme-light",s.theme==="light");
 $("#sideName").textContent=currentUser?.name||"Your account";$("#sideEmail").textContent=currentUser?.email||"";$("#sideAvatar").textContent=(currentUser?.name||"F").trim().charAt(0).toUpperCase();
 $("#todayLabel").textContent=new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
 $("#incomeStat").textContent=fmt(st.income);$("#expenseStat").textContent=fmt(st.expenses);$("#balanceStat").textContent=fmt(st.balance);$("#salaryStat").textContent=fmt(s.salary);$("#savingsRate").textContent=st.savingsRate+"%";
 $("#donutTotal").textContent=fmt(st.expenses);$("#reportIncome").textContent=fmt(st.income);$("#reportExpense").textContent=fmt(st.expenses);$("#reportNet").textContent=fmt(st.balance);$("#reportRate").textContent=st.savingsRate+"%";
 const hr=new Date().getHours();$("#pageTitle").innerHTML=(hr<12?"Good morning":hr<18?"Good afternoon":"Good evening")+'<span class="title-period">.</span>';
 renderCharts();renderTransactions();renderBudgetPreview();renderBudgets();renderGoals();renderReports();populateSettings();populateCategoryFilter();
}
function renderCharts(){
 const cats=Object.keys(dashboard.categorySpending),vals=Object.values(dashboard.categorySpending);
 const ctx=$("#cashChart").getContext("2d");
 if(cashChart)cashChart.destroy();
 cashChart=new Chart(ctx,{type:"bar",data:{labels:["Income","Expenses","Net"],datasets:[{data:[dashboard.stats.income,dashboard.stats.expenses,dashboard.stats.balance],backgroundColor:["#20bd8b","#8175ee",dashboard.stats.balance>=0?"#91dec1":"#e76b79"],borderRadius:7,barThickness:33}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw)}}},scales:{x:{grid:{display:false},ticks:{color:"#929aab",font:{size:10}}},y:{beginAtZero:true,grid:{color:"#edf0f5"},border:{display:false},ticks:{color:"#929aab",font:{size:9},callback:v=>fmt(v)}}}}});
 if(categoryChart)categoryChart.destroy();
 categoryChart=new Chart($("#categoryChart").getContext("2d"),{type:"doughnut",data:{labels:cats.length?cats:["No spending yet"],datasets:[{data:vals.length?vals:[1],backgroundColor:cats.length?cats.map((_,i)=>categoryColors[i%categoryColors.length]):["#edf0f5"],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:"76%",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+": "+fmt(c.raw)}}}}});
 $("#categoryLegend").innerHTML=cats.length?cats.map((c,i)=>`<div class="legend-row"><i style="background:${categoryColors[i%categoryColors.length]}"></i><span>${esc(c)}</span><b>${fmt(vals[i])}</b></div>`).join(""):'<div class="muted">No expenses recorded this month.</div>';
}
function renderTransactions(){
 const tx=dashboard.transactions;
 $("#recentTransactions").innerHTML=tx.slice(0,5).map(transactionRow).join("")||'<div class="empty-state">No transactions yet. Add one to get started.</div>';
 const search=($("#transactionSearch")?.value||"").toLowerCase(),type=$("#typeFilter")?.value||"all",cat=$("#categoryFilter")?.value||"all";
 const filtered=tx.filter(t=>(t.title+" "+t.category+" "+t.note).toLowerCase().includes(search)&&(type==="all"||t.type===type)&&(cat==="all"||t.category===cat));
 $("#transactionsBody").innerHTML=filtered.map(t=>`<tr><td><div class="table-title"><div class="tx-icon ${t.type}">${icons[t.category]||"•"}</div><div><b>${esc(t.title)}</b><small>${esc(t.note||"—")}</small></div></div></td><td><span class="category-chip">${esc(t.category)}</span></td><td>${dateFmt(t.date)}</td><td><span class="type-chip ${t.type}">${t.type==="income"?"Income":"Expense"}</span></td><td class="amount-cell">${t.type==="income"?"+":"−"}${fmt(t.amount)}</td><td><div class="row-actions"><button data-edit="${t.id}" title="Edit">✎</button><button data-delete="${t.id}" title="Delete">×</button></div></td></tr>`).join("");
 $("#emptyTransactions").classList.toggle("hidden",filtered.length>0);
}
function transactionRow(t){return `<div class="transaction-row"><div class="tx-icon ${t.type}">${icons[t.category]||"•"}</div><div class="tx-main"><b>${esc(t.title)}</b><small>${esc(t.category)} · ${dateFmt(t.date)}</small></div><div class="tx-amount ${t.type}">${t.type==="income"?"+":"−"}${fmt(t.amount)}</div></div>`;}
function renderBudgetPreview(){
 const bs=dashboard.budgets.slice(0,4);
 $("#budgetPreview").innerHTML=bs.map(b=>`<div class="budget-line"><div class="budget-line-head"><span>${esc(b.category)}</span><b>${fmt(b.spent)} <span>/ ${fmt(b.limit_amount)}</span></b></div><div class="progress-track"><i class="${b.percent>=100?"over":b.percent>=80?"warning":""}" style="width:${b.percent}%"></i></div></div>`).join("")||'<div class="empty-state">Add a budget to start tracking.</div>';
 $("#goalMiniText").textContent=fmt(dashboard.goals.current)+" / "+fmt(dashboard.goals.target);$("#goalMiniBar").style.width=dashboard.goals.percent+"%";
}
function renderBudgets(){
 const bs=dashboard.budgets;$("#overallBudget").textContent=fmt(bs.reduce((s,b)=>s+b.limit_amount,0));$("#overallSpent").textContent=fmt(bs.reduce((s,b)=>s+b.spent,0));
 $("#budgetsGrid").innerHTML=bs.map(b=>`<article class="budget-card"><div class="budget-card-head"><div class="budget-card-icon">${icons[b.category]||"◷"}</div><button data-budget-delete="${b.id}" title="Delete budget">•••</button></div><h3>${esc(b.category)}</h3><div class="budget-big">${fmt(b.spent)} <small>of ${fmt(b.limit_amount)}</small></div><div class="budget-remain">${b.spent>b.limit_amount?fmt(b.spent-b.limit_amount)+" over budget":fmt(b.limit_amount-b.spent)+" remaining"} · ${b.percent}% used</div><div class="progress-track"><i class="${b.percent>=100?"over":b.percent>=80?"warning":""}" style="width:${b.percent}%"></i></div></article>`).join("")||'<div class="panel empty-state">No budgets yet. Create your first category budget.</div>';
}
function renderGoals(){const g=dashboard.goals;$("#goalCurrent").textContent=fmt(g.current);$("#goalTarget").textContent=fmt(g.target);$("#goalPercent").textContent=g.percent+"%";$("#goalBar").style.width=g.percent+"%";$("#goalTitle").textContent=g.percent>=100?"You reached your target!":g.percent>=75?"You're getting so close.":"Your next big thing.";}
function renderReports(){
 const cats=Object.entries(dashboard.categorySpending).sort((a,b)=>b[1]-a[1]),total=dashboard.stats.expenses;
 $("#reportCategories").innerHTML=cats.map(([c,v],i)=>`<div class="report-cat"><div class="report-cat-head"><b>${esc(c)}</b><span>${fmt(v)} · ${total?Math.round(v/total*100):0}%</span></div><div class="progress-track"><i style="width:${total?v/total*100:0}%;background:${categoryColors[i%categoryColors.length]}"></i></div></div>`).join("")||'<div class="empty-state">Add expenses to unlock spending insights.</div>';
 const bs=dashboard.budgets,over=bs.filter(b=>b.percent>=100),near=bs.filter(b=>b.percent>=80&&b.percent<100);
 const insights=[];
 if(dashboard.stats.balance<0)insights.push(["!","Expenses are higher than income","Review non-essential spending and your category budgets."]);
 else insights.push(["✦","You are cash-flow positive","Your current income is higher than your expenses this month."]);
 if(over.length)insights.push(["↗","Budget needs attention",over.map(b=>b.category).join(", ")+" "+(over.length===1?"is":"are")+" over the planned limit."]);
 else if(near.length)insights.push(["◷","A budget is getting close",near.map(b=>b.category).join(", ")+" is at least 80% used."]);
 else insights.push(["✓","Budgets look on track","Keep recording expenses to keep these insights current."]);
 if(dashboard.goals.percent<100)insights.push(["◎","Keep building your savings",fmt(Math.max(0,dashboard.goals.target-dashboard.goals.current))+" left to reach your savings goal."]);
 else insights.push(["★","Savings goal reached","Congratulations! You can update your target in Settings."]);
 $("#insightsList").innerHTML=insights.map(i=>`<div class="insight"><div class="insight-icon">${i[0]}</div><div><b>${i[1]}</b><p>${i[2]}</p></div></div>`).join("");
}
function populateSettings(){const s=dashboard.settings;$("#settingName").value=currentUser?.name||"";$("#settingEmail").value=currentUser?.email||"";$("#settingCurrency").value=s.currency;$("#settingTheme").value=s.theme;$("#settingSalary").value=s.salary;$("#settingBudget").value=s.monthly_budget;$("#settingSaved").value=s.savings_current;$("#settingTarget").value=s.savings_target;}
function populateCategoryFilter(){const old=$("#categoryFilter").value;const cats=[...new Set(dashboard.transactions.map(t=>t.category))].sort();$("#categoryFilter").innerHTML='<option value="all">All categories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");$("#categoryFilter").value=cats.includes(old)?old:"all";}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function switchView(view){
 $$(".view").forEach(v=>v.classList.add("hidden"));$("#view-"+view).classList.remove("hidden");
 $$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.view===view));
 const names={overview:"Overview",transactions:"Transactions",budgets:"Budgets",goals:"Savings goals",reports:"Reports",settings:"Settings"};
 $("#pageCrumb").textContent=names[view];$("#pageSubtitle").textContent=({overview:"Here’s your financial snapshot for this month.",transactions:"Review, search, edit, and manage your money moves.",budgets:"Set category limits that fit your lifestyle.",goals:"Turn your plans into milestones.",reports:"A clearer picture of your financial habits.",settings:"Make your dashboard work the way you do."})[view];
 if(view==="overview"&&cashChart){cashChart.resize();categoryChart?.resize();}
}
$$(".nav-item").forEach(n=>n.addEventListener("click",()=>switchView(n.dataset.view)));
$$("[data-goto]").forEach(n=>n.addEventListener("click",()=>switchView(n.dataset.goto)));
$("#quickAdd").addEventListener("click",()=>openTransaction());$("#addTransaction2").addEventListener("click",()=>openTransaction());
function openModal(id){$("#"+id).classList.remove("hidden");}
function closeModal(id){$("#"+id).classList.add("hidden");}
$$("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
function openTransaction(t=null){$("#transactionForm").reset();$("#editId").value=t?.id||"";$("#transactionModalTitle").textContent=t?"Edit transaction":"Add transaction";$("#txTitle").value=t?.title||"";$("#txType").value=t?.type||"expense";$("#txAmount").value=t?.amount||"";$("#txCategory").value=t?.category||"Food";$("#txDate").value=t?.date||new Date().toISOString().slice(0,10);$("#txNote").value=t?.note||"";$("#transactionError").textContent="";openModal("transactionModal");}
$("#transactionForm").addEventListener("submit",async e=>{e.preventDefault();const id=$("#editId").value;const body={title:$("#txTitle").value,category:$("#txCategory").value,type:$("#txType").value,amount:Number($("#txAmount").value),date:$("#txDate").value,note:$("#txNote").value};try{dashboard=await api(id?"/api/transactions/"+id:"/api/transactions",{method:id?"PUT":"POST",body:JSON.stringify(body)});currentUser.name=$("#settingName").value||currentUser.name;closeModal("transactionModal");renderAll();toast(id?"Transaction updated":"Transaction added");}catch(err){$("#transactionError").textContent=err.message;}});
document.addEventListener("click",async e=>{
 const edit=e.target.closest("[data-edit]");if(edit){const t=dashboard.transactions.find(x=>x.id===Number(edit.dataset.edit));if(t)openTransaction(t);}
 const del=e.target.closest("[data-delete]");if(del&&confirm("Delete this transaction? This cannot be undone.")){try{dashboard=await api("/api/transactions/"+del.dataset.delete,{method:"DELETE"});renderAll();toast("Transaction deleted");}catch(err){toast(err.message);}}
 const bd=e.target.closest("[data-budget-delete]");if(bd&&confirm("Delete this budget?")){try{dashboard=await api("/api/budgets/"+bd.dataset.budgetDelete,{method:"DELETE"});renderAll();toast("Budget deleted");}catch(err){toast(err.message);}}
});
$("#transactionSearch").addEventListener("input",renderTransactions);$("#typeFilter").addEventListener("change",renderTransactions);$("#categoryFilter").addEventListener("change",renderTransactions);
$("#addBudgetBtn").addEventListener("click",()=>{$("#budgetForm").reset();$("#budgetError").textContent="";openModal("budgetModal");});
$("#budgetForm").addEventListener("submit",async e=>{e.preventDefault();try{dashboard=await api("/api/budgets",{method:"POST",body:JSON.stringify({category:$("#budgetCategory").value,limit_amount:Number($("#budgetAmount").value)})});closeModal("budgetModal");renderAll();toast("Budget saved");}catch(err){$("#budgetError").textContent=err.message;}});
$("#settingsForm").addEventListener("submit",async e=>{e.preventDefault();$("#settingsMessage").textContent="Saving…";try{const d=await api("/api/settings",{method:"PUT",body:JSON.stringify({name:$("#settingName").value,salary:Number($("#settingSalary").value),currency:$("#settingCurrency").value,theme:$("#settingTheme").value,monthly_budget:Number($("#settingBudget").value),savings_current:Number($("#settingSaved").value),savings_target:Number($("#settingTarget").value)})});dashboard=d;currentUser=d.user;renderAll();$("#settingsMessage").textContent="✓ Saved";toast("Your preferences are saved");}catch(err){$("#settingsMessage").textContent=err.message;}});
$("#themeToggle").addEventListener("click",()=>{$("#settingTheme").value=document.body.classList.contains("theme-light")?"dark":"light";$("#settingsForm").requestSubmit();});
window.addEventListener("keydown",e=>{if(e.key==="Escape")$$(".modal-backdrop").forEach(m=>m.classList.add("hidden"));if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();switchView("transactions");$("#transactionSearch").focus();}});
boot();