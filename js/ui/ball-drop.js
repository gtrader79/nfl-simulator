/** Entertainment only: sample a final-scenario probability, then a team outcome. */
export const VISUAL_SETTINGS=Object.freeze({ballCount:200,burstSize:4,burstIntervalMs:120,radii:Object.freeze([5,7,9]),settleMs:3500});
export function sampleVisualTeam(samples,randomSource=Math.random) {
  if(!Array.isArray(samples)||!samples.length)throw new TypeError('Final probability samples are required.');
  const indexDraw=randomSource(),outcomeDraw=randomSource();
  if(![indexDraw,outcomeDraw].every(v=>Number.isFinite(v)&&v>=0&&v<1))throw new RangeError('Random source must return [0,1).');
  const probability=samples[Math.floor(indexDraw*samples.length)];
  if(!Number.isFinite(probability)||probability<0||probability>1)throw new RangeError('Invalid final probability.');
  return outcomeDraw<probability?'teamA':'teamB';
}
export function createBallDrop({root,Matter,randomSource=Math.random,ResizeObserverImpl=globalThis.ResizeObserver,
  motionQuery=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),onError=console.error}) {
  const host=root.querySelector('#ball-drop');const message=root.querySelector('#visual-message');
  const summary=root.querySelector('#visual-summary');const play=root.querySelector('#visual-play');const stop=root.querySelector('#visual-stop');
  const score=root.ownerDocument.createElement('p');score.className='visual-score';score.hidden=true;
  host.before(score);
  let result=null,engine=null,render=null,runner=null,observer=null,timer=null,active=false,blocked=true,destroyed=false;
  let width=0,count=0,counts={teamA:0,teamB:0};
  const available=Boolean(Matter?.Engine&&Matter?.Render&&Matter?.Runner&&Matter?.Bodies&&Matter?.Composite);
  function halt(clear=false) {
    clearTimeout(timer);timer=null;active=false;
    if(runner)Matter.Runner.stop(runner);if(render)Matter.Render.stop(render);
    stop.hidden=true;play.disabled=blocked||!result||!available;
    if(clear) {
      observer?.disconnect();observer=null;
      if(engine){Matter.Composite.clear(engine.world,false);Matter.Engine.clear(engine);}
      if(render){render.canvas.remove();render.textures={};}
      engine=null;runner=null;render=null;host.replaceChildren();score.hidden=true;score.textContent='';
    }
  }
  function unavailable(error) {
    halt(true);play.disabled=true;
    message.textContent='Visual simulation is unavailable. Analytical results are still valid.';
    if(error)onError({code:'BALL_DROP_UNAVAILABLE',cause:error});
  }
  function finish() {
    halt();play.textContent='Play Again';
    message.textContent=`Visual complete: ${result.inputSnapshot.teamA.abbreviation} ${counts.teamA} balls · ${result.inputSnapshot.teamB.abbreviation} ${counts.teamB} balls. Counts are illustrative, not a new prediction.`;
  }
  function drop() {
    if(!active)return;
    try {
      const final=result.scenarios.find(s=>s.id===result.finalScenarioId);
      for(let burst=0;burst<VISUAL_SETTINGS.burstSize&&count<VISUAL_SETTINGS.ballCount;burst++) {
        const side=sampleVisualTeam(final.teamAProbabilitySamples,randomSource);
        const lane=side==='teamA'?0:1;const team=result.inputSnapshot[side];
        // Ball size cycles independently of team sampling: every ball counts as one.
        const radius=VISUAL_SETTINGS.radii[count%VISUAL_SETTINGS.radii.length];
        const x=lane*width/2+width/4+(randomSource()-.5)*width*.30;
        const body=Matter.Bodies.circle(x,18+burst*22,radius,{restitution:.65,friction:.12,
          render:{fillStyle:team.colors.primary,strokeStyle:team.colors.secondary??'#ffffff',lineWidth:1.5}});
        Matter.Composite.add(engine.world,body);counts[side]++;count++;
      }
      score.hidden=false;
      score.textContent=`${result.inputSnapshot.teamA.abbreviation} ${counts.teamA} · ${result.inputSnapshot.teamB.abbreviation} ${counts.teamB} · ${count} / ${VISUAL_SETTINGS.ballCount} balls`;
      timer=setTimeout(count<VISUAL_SETTINGS.ballCount?drop:finish,count<VISUAL_SETTINGS.ballCount?VISUAL_SETTINGS.burstIntervalMs:VISUAL_SETTINGS.settleMs);
    } catch(error){unavailable(error);}
  }
  function playVisual() {
    if(destroyed||blocked||!result||!available)return;
    halt(true);width=Math.floor(host.getBoundingClientRect().width);
    if(width<100){message.textContent='Visual area is not visible. Expand it and try Play again.';return;}
    try {
      const height=360;engine=Matter.Engine.create();
      render=Matter.Render.create({element:host,engine,options:{width,height,wireframes:false,background:'#f3f5f0',pixelRatio:Math.min(globalThis.devicePixelRatio||1,2)}});
      render.canvas.setAttribute('role','img');render.canvas.setAttribute('aria-label','Probability-weighted balls; Team A left, Team B right. Final probabilities are stated above.');
      const solid={isStatic:true,render:{fillStyle:'#9bad9f'}};
      const bodies=[Matter.Bodies.rectangle(width/2,height-5,width,10,solid),Matter.Bodies.rectangle(2,height/2,4,height,solid),
        Matter.Bodies.rectangle(width-2,height/2,4,height,solid),Matter.Bodies.rectangle(width/2,height/2,4,height,solid)];
      for(let lane=0;lane<2;lane++)for(let row=0;row<5;row++)for(let col=0;col<4;col++) {
        const x=lane*width/2+(col+1)*width/10+(row%2?width/40:0);
        bodies.push(Matter.Bodies.circle(x,90+row*42,4,solid));
      }
      Matter.Composite.add(engine.world,bodies);runner=Matter.Runner.create();
      active=true;count=0;counts={teamA:0,teamB:0};play.disabled=true;stop.hidden=false;
      message.textContent='Here come the teams! Every ball counts as one, whatever its size. Ball counts do not change the prediction.';
      Matter.Render.run(render);Matter.Runner.run(runner,engine);
      if(typeof ResizeObserverImpl==='function') {
        observer=new ResizeObserverImpl(()=>{if(Math.abs(host.getBoundingClientRect().width-width)>2){halt(true);message.textContent='Visual resized. Select Play Again to replay.';play.textContent='Play Again';}});
        observer.observe(host);
      }
      drop();
    } catch(error){unavailable(error);}
  }
  function stopVisual(){halt();message.textContent='Visual stopped. The analytical prediction is unchanged.';play.textContent='Play Again';}
  function motionChanged(){if(active)stopVisual();}
  function visibilityChanged(){if(root.ownerDocument.hidden&&active)stopVisual();}
  play.addEventListener('click',playVisual);stop.addEventListener('click',stopVisual);
  motionQuery?.addEventListener?.('change',motionChanged);root.ownerDocument.addEventListener('visibilitychange',visibilityChanged);
  return Object.freeze({
    render(view) {
      if(destroyed)return;
      const next=view.simulationResult;blocked=view.simulationStatus==='running'||view.areResultsStale||Boolean(view.fatalError);
      if(next!==result){halt(true);result=next;play.textContent='Play Visual Simulation';}
      if(blocked&&active)halt(true);
      if(!result){summary.textContent='';message.textContent='Run the simulation to enable the probability-weighted ball drop.';play.disabled=true;return;}
      const snapshot=result.inputSnapshot,final=result.scenarios.find(s=>s.id===result.finalScenarioId);
      summary.textContent=`${snapshot.season} · ${snapshot.teamA.abbreviation} (left): ${(final.probabilitySummary.teamA.mean*100).toFixed(1)}% · ${snapshot.teamB.abbreviation} (right): ${(final.probabilitySummary.teamB.mean*100).toFixed(1)}%. A probability-weighted visual based on the final active scenario.`;
      if(!available){unavailable();return;}
      play.disabled=blocked||active;
      if(!active)message.textContent=blocked?'Run Simulation to update the visual for your changed inputs.':motionQuery?.matches?'Reduced motion is enabled. The static probabilities are shown above; Play is optional.':'Select Play to animate the final scenario. Replay does not rerun the model.';
    },
    destroy(){if(destroyed)return;destroyed=true;halt(true);score.remove();play.removeEventListener('click',playVisual);stop.removeEventListener('click',stopVisual);motionQuery?.removeEventListener?.('change',motionChanged);root.ownerDocument.removeEventListener('visibilitychange',visibilityChanged);},
  });
}
