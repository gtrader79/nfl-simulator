import APP_CONFIG from '../config/app-config.js';
import METRIC_CATALOG from '../config/metric-catalog.js';

export function wrapLabel(text, width = 20) {
  const lines = [''];
  for (const word of text.split(' ')) {
    const index = lines.length - 1;
    if (lines[index] && lines[index].length + word.length + 1 > width) lines.push(word);
    else lines[index] += `${lines[index] ? ' ' : ''}${word}`;
  }
  return lines;
}
// Dark, distinguishable chart colors; team identity is also encoded in labels and dashes.
export function chartColors(a, b) {
  function readable(hex, fallback) {
    if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return fallback;
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
    const max = Math.max(...rgb);
    return '#' + rgb.map(v => Math.round(max > 150 ? v * 150 / max : v).toString(16).padStart(2,'0')).join('');
  }
  const first = readable(a,'#12604b'); let second = readable(b,'#745399');
  if (first === second) second = first === '#745399' ? '#12604b' : '#745399';
  return [first,second];
}
export function probabilityChartConfig(result) {
  const {teamA,teamB}=result.inputSnapshot;
  const colors=chartColors(teamA.colors.primary,teamB.colors.primary);
  const datasets=[];
  for (const [index,key,team] of [[0,'teamA',teamA],[1,'teamB',teamB]]) {
    const lower=datasets.length;
    datasets.push({label:`${team.abbreviation} lower range`,data:result.scenarios.map(s=>s.probabilitySummary[key].p5*100),borderWidth:0,pointRadius:0,fill:false});
    datasets.push({label:`${team.abbreviation} 5th–95th range`,data:result.scenarios.map(s=>s.probabilitySummary[key].p95*100),borderWidth:0,pointRadius:0,backgroundColor:colors[index]+'25',fill:{target:lower},rangeBand:true});
    datasets.push({label:`${team.abbreviation} average`,data:result.scenarios.map(s=>s.probabilitySummary[key].mean*100),borderColor:colors[index],backgroundColor:colors[index],borderDash:index?[7,4]:[],pointStyle:index?'rectRot':'circle',pointRadius:4,borderWidth:3,fill:false,meanLine:true,teamKey:key});
  }
  datasets.push({label:'50% reference',data:result.scenarios.map(()=>50),borderColor:'#707a76',borderDash:[3,4],borderWidth:1,pointRadius:0,fill:false});
  return {type:'line',data:{labels:result.scenarios.map(s=>wrapLabel(APP_CONFIG.scenarios.find(x=>x.id===s.id).label,16)),datasets},
    options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
      scales:{y:{min:0,max:100,title:{display:true,text:'Win probability'},ticks:{callback:v=>`${v}%`}},x:{ticks:{autoSkip:false,maxRotation:0,font:{size:12}}}},
      plugins:{legend:{labels:{filter:item=>Boolean(datasets[item.datasetIndex].meanLine),usePointStyle:true}},tooltip:{filter:item=>Boolean(item.dataset.meanLine),callbacks:{
        label:ctx=>{const summary=result.scenarios[ctx.dataIndex].probabilitySummary[ctx.dataset.teamKey];return `${ctx.dataset.label}: ${(summary.mean*100).toFixed(1)}% (${(summary.p5*100).toFixed(1)}–${(summary.p95*100).toFixed(1)}%)`;},
      }}}}};
}
export function contributionChartConfig(direction,offense,defense) {
  const rows=direction.contributions.filter(c=>c.available && Number.isFinite(c.contribution));
  const colors=chartColors(offense.colors.primary,defense.colors.primary);
  const limit=Math.max(.1,...rows.map(c=>Math.abs(c.contribution)))*1.15;
  return {type:'bar',data:{labels:rows.map(c=>wrapLabel(METRIC_CATALOG[c.offenseMetric]?.label??c.pairId,22)),datasets:[{
    label:'Base contribution',data:rows.map(c=>c.contribution),backgroundColor:rows.map(c=>c.contribution>=0?colors[0]:colors[1]),borderWidth:0,
  }]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,animation:false,
    scales:{x:{min:-limit,max:limit,title:{display:true,text:`← ${defense.abbreviation} defense · ${offense.abbreviation} offense →`},grid:{color:ctx=>ctx.tick.value===0?'#263d35':'#e4e9e5'}},y:{ticks:{autoSkip:false,font:{size:12}}}},
    plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.raw>=0?'+':''}${ctx.raw.toFixed(3)} · ${ctx.raw>=0?offense.abbreviation+' offense':defense.abbreviation+' defense'}`}}}}};
}

/** One owner for three charts, including deferred construction in hidden containers. */
export function createCharts({root,Chart,ResizeObserverImpl=globalThis.ResizeObserver,onError=console.error}) {
  const entries=new Map(); let destroyed=false;
  const status=(host,text)=>{const message=host.parentElement.querySelector('[data-chart-status]');if(message)message.textContent=text;};
  function dispose(entry) {
    entry.observer?.disconnect(); entry.observer=null;
    entry.chart?.destroy(); entry.chart=null; entry.canvas?.remove(); entry.canvas=null;
  }
  function draw(entry) {
    if(destroyed || entry.chart || !entry.host.isConnected)return;
    const rect=entry.host.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return;
    try {
      const canvas=root.ownerDocument.createElement('canvas');entry.canvas=canvas;
      canvas.setAttribute('role','img');canvas.setAttribute('aria-label',entry.label+'; equivalent values follow in the table.');
      entry.host.replaceChildren(canvas);
      entry.chart=new Chart(canvas,entry.config());status(entry.host,'');
    } catch(error) {
      Chart?.getChart?.(entry.canvas)?.destroy();dispose(entry);
      status(entry.host,'Chart unavailable. The table below contains the same analytical values.');onError({code:'CHART_RENDER_FAILED',cause:error});
    }
  }
  function sync(id,source,config,label) {
    const host=root.querySelector(`[data-chart="${id}"]`); const old=entries.get(id);
    if(old && old.source===source && old.host===host)return;
    if(old){dispose(old);entries.delete(id);}
    if(!host||!source)return;
    const entry={source,host,config,label,chart:null,canvas:null,observer:null};entries.set(id,entry);
    if(typeof ResizeObserverImpl==='function') {entry.observer=new ResizeObserverImpl(()=>draw(entry));entry.observer.observe(host);}
    draw(entry);
  }
  return Object.freeze({
    render(view) {
      if(destroyed)return;
      sync('win-probability',view.simulationResult,()=>probabilityChartConfig(view.simulationResult),'Cumulative win probability and 5th–95th uncertainty');
      sync('team-a-offense',view.baseAnalytics,()=>contributionChartConfig(view.baseAnalytics.teamAOffenseVsTeamBDefense,view.teamA,view.teamB),'Team A offense versus Team B defense');
      sync('team-b-offense',view.baseAnalytics,()=>contributionChartConfig(view.baseAnalytics.teamBOffenseVsTeamADefense,view.teamB,view.teamA),'Team B offense versus Team A defense');
    },
    destroy(){destroyed=true;entries.forEach(dispose);entries.clear();},
  });
}
