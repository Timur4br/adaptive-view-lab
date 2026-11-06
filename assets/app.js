(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const D = window.NBV_DATA, M = window.NBVModel, R = window.NBVRender;
  const names = { object_only:'Вокруг объекта',periodic_3:'Эталон каждый третий',alternating:'Чередование 1 к 1',random:'Случайный выбор',frozen_plan:'План по первым кадрам',adaptive:'Адаптивный выбор',wide_only:'Только общие планы' };
  const scenarios = { reference_weak:'Слабая геометрия эталона',object_weak:'Слабая геометрия объекта',balanced:'Устойчивая начальная геометрия',reference_floor:'Неточная опорная длина эталона',noise_underestimated:'Шум выше прогноза вдвое' };
  const descriptions = {
    reference_weak:'В первых кадрах масштабный образец снят с близких направлений. Новый ракурс может лучше определить его пространственную длину.',
    object_weak:'Близкие начальные направления съёмки затрудняют восстановление объекта. Геометрия образца изначально устойчивее.',
    balanced:'Начальные направления для обоих отрезков уже разнесены. Проверьте, насколько адаптация отличается от первоначального плана.',
    reference_floor:'Неопределённость внешней физической длины образца повышена с 0,05 до 1 мм. Дополнительные фотографии не уточняют это внешнее измерение.',
    noise_underestimated:'Фактический шум координат равен 1,4 пикселя, а алгоритм рассчитывает на 0,7. Узкий расчётный интервал может оказаться недостоверным.'
  };
  const familyNames = ['Ракурс объекта','Съёмка масштабного образца','Общий план'];
  const shortFamily = ['Объект','Масштаб','Общий'];
  const params = new URLSearchParams(location.search);
  const validScenario = Object.hasOwn(scenarios,params.get('scenario'))?params.get('scenario'):'reference_weak';
  const validStrategy = (M?.STRATEGIES||[]).includes(params.get('strategy'))?params.get('strategy'):'adaptive';
  const state = { scenario:validScenario,strategy:validStrategy,step:0,mode:'published',seed:42,preview:null,metric:'u',archiveMetric:'rmse',timer:null,bank:null,histories:null };
  let scene;
  const fmt = (n,d=3) => R.format(n,d);
  const set = (id,t) => { $(id).textContent=t; };
  function fail(error) { $('app-error').hidden=false;set('app-error',`Не удалось выполнить расчёт: ${error.message}`);console.error(error);stop(); }
  function stop() { if(state.timer)clearInterval(state.timer);state.timer=null;set('play','▶');$('play').setAttribute('aria-label','Автоматически показать следующие шаги'); }
  function bankLabel(){return state.mode==='published'?'Сессия №1 из исследования':`Браузерная сессия · число ${state.seed}`;}
  function rebuild() {
    stop();$('app-error').hidden=true;
    try {
      const template=D.cases[state.scenario];
      state.bank=state.mode==='published'?template:M.generate(template,D.truthPoints,D.referenceLength,state.seed);
      state.histories=M.runAll(state.bank,D.truthLength);state.preview=null;
      render();renderArchive();
    }catch(e){fail(e);}
  }
  function selectedSnapshot(){return state.histories[state.strategy][state.step];}
  function cameraLabel(index) {
    if(!Number.isInteger(index))return '';
    const view=state.bank.views[index],p=view.label.split('_');
    return `К${String(index+1).padStart(2,'0')} · ${shortFamily[view.family]}${index>=6?` · ${p[1]}° / ${p[2]}°`:''}`;
  }
  function updateScene() {
    const snapshot=selectedSnapshot();
    scene.update({bank:state.bank,snapshot,preview:state.preview,truth:D.truthPoints,showTruth:$('show-truth').checked});
    set('camera-caption',cameraLabel(state.preview));
    set('scene-caption',scene.mode==='world'?'Перетаскивайте для вращения · нажмите на камеру':'Виртуальный предпросмотр · данные добавляются после шага');
  }
  function renderCandidates(snapshot) {
    const body=$('candidate-body');body.replaceChildren();
    if(snapshot.next===null){const tr=body.insertRow();const td=tr.insertCell();td.colSpan=3;td.textContent='Бюджет дополнительных кадров исчерпан.';return;}
    let candidates=snapshot.candidates.slice(0,5);
    if(!candidates.some(c=>c.index===snapshot.next))candidates=[snapshot.candidates.find(c=>c.index===snapshot.next),...candidates.slice(0,4)].filter(Boolean);
    for(const c of candidates){
      const tr=body.insertRow();tr.classList.toggle('is-preview',c.index===state.preview);tr.classList.toggle('is-recommend',c.index===snapshot.next);
      const button=document.createElement('button');button.type='button';button.textContent=`К${String(c.index+1).padStart(2,'0')}${c.index===snapshot.next?' *':''}`;
      button.setAttribute('aria-label',`Просмотр ${cameraLabel(c.index)}${c.index===snapshot.next?', следующий кадр стратегии':''}`);
      button.addEventListener('click',()=>{state.preview=c.index;updateScene();renderCandidates(snapshot);});tr.insertCell().appendChild(button);
      const p=state.bank.views[c.index].label.split('_');tr.insertCell().textContent=`${shortFamily[c.family]} · ${p[1]}°`;
      tr.insertCell().textContent=fmt(Math.max(0,c.gain),c.gain<.01?5:3);
    }
    set('candidate-caption','* Следующий кадр выбранной стратегии');
  }
  function renderChart(){if(state.histories)R.lineChart($('session-chart'),state.histories,state.strategy,state.step,state.metric,names);}
  function render() {
    if(!state.histories)return;
    const s=selectedSnapshot();
    if(state.preview===null)state.preview=s.next??Math.max(0,s.action);
    set('length-value',fmt(s.q,3));set('u-value',`${fmt(s.u,3)} мм`);
    set('interval-value',`${fmt(s.q-1.95996398454*s.u,3)} … ${fmt(s.q+1.95996398454*s.u,3)} мм`);
    ['object-variance','reference-variance','floor-variance'].forEach((id,i)=>set(id,fmt(s.components[i],s.components[i]<.001?6:4)));
    [...$('variance-bar').children].forEach((el,i)=>{el.style.width=`${Math.max(0,s.components[i]/s.variance*100)}%`;});
    $('variance-bar').setAttribute('aria-label',`Дисперсия ${fmt(s.variance,4)} мм². Объект ${fmt(s.components[0],4)}, геометрия масштаба ${fmt(s.components[1],4)}, внешняя длина ${fmt(s.components[2],4)}.`);
    if(s.next!==null){
      const candidate=s.candidates.find(c=>c.index===s.next),view=state.bank.views[s.next];
      set('recommendation',familyNames[view.family]);
      set('gain-label',`К${String(s.next+1).padStart(2,'0')}. Ожидаемое уменьшение дисперсии: ${fmt(Math.max(0,candidate.gain),candidate.gain<.01?5:3)} мм².`);
    }else{set('recommendation','Получено 14 кадров');set('gain-label','Остановка по бюджету. Достижение заданной точности этим условием не проверяется.');}
    $('truth-readout').hidden=!$('show-truth').checked;
    set('truth-readout',`Истинная длина ${fmt(D.truthLength,3)} мм. Отклонение ${s.error>=0?'+':''}${fmt(s.error,3)} мм. Истина используется только для проверки.`);
    set('source-label',bankLabel());set('scenario-note',descriptions[state.scenario]);
    set('frame-count',`${6+state.step} / 14`);set('timeline-caption',state.step===0?'Начальные наблюдения':`Добавлено ${state.step} из 8 кадров`);
    $('step').value=state.step;$('next').disabled=state.step===8;
    renderCandidates(s);updateScene();renderChart();
    for(const button of $('session-legend').children)button.setAttribute('aria-pressed',String(button.dataset.strategy===state.strategy));
  }
  function renderArchive(){
    const data=D.summary.filter(x=>x.scenario===state.scenario),adaptive=data.find(x=>x.strategy==='adaptive'),plan=data.find(x=>x.strategy==='frozen_plan'),object=data.find(x=>x.strategy==='object_only');
    R.barChart($('archive-chart'),data,state.archiveMetric,names);set('archive-title',scenarios[state.scenario]);
    set('archive-chart-note',state.archiveMetric==='rmse'?'Меньшее значение означает меньшую фактическую ошибку. У каждой стратегии одинаковый бюджет кадров.':'Пунктир: номинальные 95%. Отрезки: 95-процентные интервалы Уилсона для доли попаданий.');
    set('published-adaptive',`${fmt(adaptive.rmse_mm)} мм`);set('published-plan',`${fmt(plan.rmse_mm)} мм`);
    if(state.scenario==='reference_weak'){
      set('finding-title','Хороший первоначальный план сопоставим с адаптацией');
      set('finding-description',`По сравнению с ракурсами вокруг объекта RMSE ниже на ${fmt(100*(1-adaptive.rmse_mm/object.rmse_mm),1)}%. Но преимущество перед планом по первым кадрам не установлено: парный интервал отношения ошибок включает единицу.`);
    }else if(state.scenario==='object_weak'){
      set('finding-title','Чередование даёт тот же результат');set('finding-description','В этой сцене адаптивный выбор совпал с чередованием объектных и масштабных наблюдений. Уточнение двух отрезков полезно, отдельного выигрыша адаптации не обнаружено.');
    }else if(state.scenario==='balanced'){
      set('finding-title','Первоначального плана оказалось достаточно');set('finding-description','При устойчивой начальной геометрии адаптивная стратегия и план по первым кадрам дали одинаковую RMSE. Обновление плана не обеспечило дополнительного улучшения.');
    }else if(state.scenario==='reference_floor'){
      set('finding-title','Фотографии не уточняют внешнюю длину образца');set('finding-description','При неопределённости опорной длины 1 мм только её вклад в неопределённость результата составляет около 1,321 мм. Увеличение числа снимков не устраняет этот предел.');
    }else{
      set('finding-title',`Вместо 95% интервал покрывает ${fmt(100*adaptive.coverage95,1)}%`);set('finding-description','Алгоритм недооценивает фактический шум вдвое. Даже при уменьшающейся расчётной дисперсии интервалы остаются слишком узкими. Это проверка ошибки модели шума.');
    }
    const tbody=$('archive-body');tbody.replaceChildren();
    for(const row of data){const tr=tbody.insertRow();[names[row.strategy],fmt(row.rmse_mm),fmt(row.median_u_mm),fmt(row.coverage95*100,2),fmt(row.mean_width_mm)].forEach(x=>{tr.insertCell().textContent=x;});}
  }
  function go(step){stop();state.step=Math.max(0,Math.min(8,step));state.preview=null;render();}
  function newSession(){
    const input=$('seed'),value=Number(input.value);
    if(input.value.trim()===''||!Number.isInteger(value)||value<0||value>4294967295){input.setCustomValidity('Введите целое число от 0 до 4294967295.');input.reportValidity();return;}
    input.setCustomValidity('');state.seed=value;state.mode='browser';state.step=0;rebuild();
  }
  function downloadSession(){
    const record={version:'0.1.0',mode:state.mode,scenario:state.scenario,strategy:state.strategy,seed:state.mode==='browser'?state.seed:null,
      currentStep:state.step,source:D.metadata,bank:state.bank,
      trajectories:Object.fromEntries(Object.entries(state.histories).map(([key,h])=>[key,h.map(s=>({step:s.step,action:s.action,q:s.q,u:s.u,error:s.error}))]))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`rakurs-${state.scenario}-${state.mode==='browser'?state.seed:'published-1'}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  try{
    if(!D||!M||!R)throw new Error('Не загружены файлы модели. Откройте index.html вместе с папкой assets.');
    set('session-count',D.metadata.independentSessions.toLocaleString('ru-RU'));set('trials-label',`${D.metadata.trialsPerScenario} повторений на сценарий`);
    $('scenario').value=state.scenario;$('strategy').value=state.strategy;
    scene=new R.Scene($('scene'),index=>{state.preview=index;updateScene();renderCandidates(selectedSnapshot());});
    $('scenario').addEventListener('change',e=>{state.scenario=e.target.value;state.step=0;rebuild();});
    $('strategy').addEventListener('change',e=>{stop();state.strategy=e.target.value;state.preview=null;render();});
    $('next').addEventListener('click',()=>go(state.step+1));$('reset').addEventListener('click',()=>go(0));
    $('step').addEventListener('input',e=>go(Number(e.target.value)));
    $('show-truth').addEventListener('change',render);
    $('world-view').addEventListener('click',()=>{scene.mode='world';$('world-view').setAttribute('aria-pressed','true');$('image-view').setAttribute('aria-pressed','false');updateScene();});
    $('image-view').addEventListener('click',()=>{scene.mode='image';$('world-view').setAttribute('aria-pressed','false');$('image-view').setAttribute('aria-pressed','true');updateScene();});
    $('home-view').addEventListener('click',()=>scene.reset());
    $('play').addEventListener('click',()=>{
      if(state.timer){stop();return;}if(state.step===8){state.step=0;state.preview=null;render();}
      set('play','Ⅱ');$('play').setAttribute('aria-label','Остановить автоматический показ');
      state.timer=setInterval(()=>{state.step++;state.preview=null;render();if(state.step===8)stop();},1100);
    });
    $('seed').addEventListener('input',()=>$('seed').setCustomValidity(''));
    $('new-session').addEventListener('click',newSession);$('original-session').addEventListener('click',()=>{state.mode='published';state.step=0;rebuild();});
    $('export-session').addEventListener('click',downloadSession);
    $('curve-metric').addEventListener('change',e=>{state.metric=e.target.value;if(state.metric==='error')$('show-truth').checked=true;render();});
    for(const key of M.STRATEGIES){const b=document.createElement('button');b.type='button';b.dataset.strategy=key;b.setAttribute('aria-pressed',String(key===state.strategy));const stroke=document.createElement('span');stroke.className='legend-stroke';stroke.style.background=R.palette[key];b.appendChild(stroke);b.appendChild(document.createTextNode(names[key]));b.addEventListener('click',()=>{stop();state.strategy=key;$('strategy').value=key;state.preview=null;render();});$('session-legend').appendChild(b);}
    for(const [id,metric] of [['rmse-view','rmse'],['coverage-view','coverage']])$(id).addEventListener('click',()=>{state.archiveMetric=metric;$('rmse-view').setAttribute('aria-pressed',String(metric==='rmse'));$('coverage-view').setAttribute('aria-pressed',String(metric==='coverage'));renderArchive();});
    const observer=new ResizeObserver(()=>{if(state.histories){renderChart();renderArchive();}});observer.observe($('session-chart').parentElement);observer.observe($('archive-chart').parentElement);
    window.addEventListener('pagehide',stop);rebuild();
  }catch(error){fail(error);}
})();
