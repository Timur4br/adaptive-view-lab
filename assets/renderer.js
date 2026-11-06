(function (root) {
  'use strict';
  const palette = { adaptive: '#146c57', frozen_plan: '#5378a0', alternating: '#ad853d', periodic_3: '#b36d52', object_only: '#87928a', random: '#9f82aa', wide_only: '#638d92' };
  const NS = 'http://www.w3.org/2000/svg';
  const format = (n, d = 2) => n.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  function svgEl(tag, attrs = {}, content = null) {
    const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (content !== null) el.textContent = content; return el;
  }
  function add(svg, tag, attrs, content) { const el = svgEl(tag, attrs, content); svg.appendChild(el); return el; }
  function chartBase(svg, h, label) {
    const w = Math.max(280, svg.parentElement.clientWidth - 2);
    svg.replaceChildren(); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('aria-label', label);
    add(svg, 'title', {}, label); return w;
  }
  function lineChart(svg, histories, selected, step, metric, names) {
    const h = 250, w = chartBase(svg, h, metric === 'u' ? 'Стандартная неопределённость в миллиметрах по мере получения кадров' : 'Абсолютная ошибка длины в миллиметрах по мере получения кадров');
    const l = 43, r = 14, t = 20, b = 35;
    const val = s => metric === 'u' ? s.u : Math.abs(s.error);
    let max = Math.max(...Object.values(histories).flatMap(a => a.map(val))) * 1.09;
    max = Math.max(max, 0.1);
    const x = k => l + (w - l - r) * k / 8, y = v => h - b - (h - t - b) * v / max;
    for (let k = 0; k <= 4; k++) {
      const yy = y(max * k / 4);
      add(svg, 'line', { x1: l, x2: w - r, y1: yy, y2: yy, stroke: '#e5eae2', 'stroke-width': 1 });
      add(svg, 'text', { x: l - 9, y: yy + 4, 'text-anchor': 'end', fill: '#77857b', 'font-size': 10 }, format(max * k / 4, max > 3 ? 1 : 2));
    }
    for (let k = 0; k <= 8; k += w < 440 ? 2 : 1) add(svg, 'text', { x: x(k), y: h - 13, 'text-anchor': 'middle', fill: '#77857b', 'font-size': 10 }, String(k + 6));
    add(svg, 'text', { x: l, y: 10, fill: '#77857b', 'font-size': 10 }, metric === 'u' ? 'u, мм' : '|ошибка|, мм');
    add(svg, 'line', { x1: x(step), x2: x(step), y1: t, y2: h - b, stroke: '#a1b9a9', 'stroke-width': 1, 'stroke-dasharray': '3 4' });
    const order = Object.keys(histories).filter(k => k !== selected).concat(selected);
    for (const key of order) {
      const values = histories[key], active = key === selected;
      add(svg, 'polyline', { points: values.map((v, k) => `${x(k)},${y(val(v))}`).join(' '), fill: 'none', stroke: palette[key], 'stroke-width': active ? 2.7 : 1.3, opacity: active ? 1 : .4, 'stroke-dasharray': key === 'frozen_plan' ? '6 3' : '' });
      if (active) values.forEach((v, k) => {
        const mark = add(svg, 'circle', { cx: x(k), cy: y(val(v)), r: k === step ? 5 : 3, fill: palette[key], stroke: 'white', 'stroke-width': 1.5, tabindex: 0 });
        mark.appendChild(svgEl('title', {}, `${names[key]}, ${k + 6} кадров: ${format(val(v), 4)} мм`));
      });
    }
  }
  function barChart(svg, data, metric, names) {
    const h = 350, w = chartBase(svg, h, metric === 'rmse' ? 'Среднеквадратическая ошибка семи стратегий в сохранённом эксперименте' : 'Покрытие номинальных 95-процентных интервалов семи стратегий');
    const l = w < 500 ? 132 : 175, r = 50, t = 15, b = 34, row = (h - t - b) / 7;
    const max = metric === 'rmse' ? Math.max(...data.map(x => x.rmse_mm)) * 1.2 : 105;
    const x = v => l + (w - l - r) * v / max;
    for (let k = 0; k <= 4; k++) {
      const v = max * k / 4;
      add(svg, 'line', { x1: x(v), x2: x(v), y1: t, y2: h - b, stroke: '#d9e2d2', 'stroke-width': 1 });
      add(svg, 'text', { x: x(v), y: h - 12, 'text-anchor': 'middle', fill: '#6d7d70', 'font-size': 10 }, format(v, metric === 'rmse' ? 2 : 0));
    }
    if (metric === 'coverage') add(svg, 'line', { x1: x(95), x2: x(95), y1: t - 4, y2: h - b, stroke: '#aa7a29', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' });
    const short = { object_only: 'Вокруг объекта', periodic_3: 'Каждый третий', alternating: 'Чередование 1:1', random: 'Случайный', frozen_plan: 'Начальный план', adaptive: 'Адаптивный', wide_only: 'Общие планы' };
    data.forEach((d, i) => {
      const cy = t + row * (i + .5), value = metric === 'rmse' ? d.rmse_mm : d.coverage95 * 100;
      add(svg, 'text', { x: l - 12, y: cy + 4, 'text-anchor': 'end', fill: d.strategy === 'adaptive' ? '#146c57' : '#4d6557', 'font-size': w < 500 ? 10 : 11, 'font-weight': d.strategy === 'adaptive' ? 650 : 400 }, w < 500 ? short[d.strategy] : names[d.strategy]);
      const rect = add(svg, 'rect', { x: l, y: cy - row * .27, width: Math.max(1, x(value) - l), height: row * .54, rx: 2, fill: d.strategy === 'adaptive' ? '#146c57' : d.strategy === 'frozen_plan' ? '#6f9380' : '#b7c6ad', tabindex: 0 });
      rect.appendChild(svgEl('title', {}, `${names[d.strategy]}: ${format(value, metric === 'rmse' ? 4 : 2)} ${metric === 'rmse' ? 'мм' : '%'}`));
      add(svg, 'text', { x: x(value) + 8, y: cy + 4, fill: '#294736', 'font-size': 11, 'font-weight': d.strategy === 'adaptive' ? 650 : 400 }, format(value, metric === 'rmse' ? 3 : 1));
      if (metric === 'coverage') {
        const [a,b] = d.coverage_wilson.map(v => x(v * 100));
        add(svg, 'line', { x1:a,x2:b,y1:cy,y2:cy,stroke:'#56715c','stroke-width':1.2 });
        for(const xx of [a,b])add(svg,'line',{x1:xx,x2:xx,y1:cy-4,y2:cy+4,stroke:'#56715c','stroke-width':1.2});
      }
    });
  }
  class Scene {
    constructor(canvas, onCamera) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.onCamera = onCamera;
      this.yaw = -.28; this.pitch = .66; this.zoom = 1.06; this.mode = 'world'; this.hits = [];
      let down = null;
      canvas.addEventListener('pointerdown', e => { down = { x:e.clientX, y:e.clientY, moved:0 }; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', e => {
        if (!down || this.mode !== 'world') return;
        const dx=e.clientX-down.x,dy=e.clientY-down.y;down.moved+=Math.abs(dx)+Math.abs(dy);
        this.yaw+=dx*.006;this.pitch=Math.max(.1,Math.min(1.4,this.pitch-dy*.005));down.x=e.clientX;down.y=e.clientY;this.draw();
      });
      canvas.addEventListener('pointerup',e=>{
        if(down&&down.moved<5&&this.mode==='world'){
          const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
          const hit=this.hits.map(v=>({...v,d:Math.hypot(v.x-x,v.y-y)})).sort((a,b)=>a.d-b.d)[0];
          if(hit&&hit.d<17)this.onCamera(hit.index);
        }
        down=null;
      });
      canvas.addEventListener('pointercancel',()=>{down=null;});
      canvas.addEventListener('wheel',e=>{if(this.mode==='world'){e.preventDefault();this.zoom=Math.max(.55,Math.min(3,this.zoom*Math.exp(-e.deltaY*.001)));this.draw();}},{passive:false});
      canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')this.yaw-=.1;if(e.key==='ArrowRight')this.yaw+=.1;if(e.key==='ArrowUp')this.pitch=Math.min(1.4,this.pitch+.1);if(e.key==='ArrowDown')this.pitch=Math.max(.1,this.pitch-.1);if(e.key==='+')this.zoom=Math.min(3,this.zoom*1.1);if(e.key==='-')this.zoom=Math.max(.55,this.zoom/1.1);this.draw();});
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(canvas);
    }
    update(data){this.data=data;this.draw();}
    reset(){this.yaw=-.28;this.pitch=.66;this.zoom=1.06;this.draw();}
    project(p){
      const x=p[0]-150,y=p[1]-20,z=p[2]-200;
      const xx=x*Math.cos(this.yaw)-z*Math.sin(this.yaw),zz=x*Math.sin(this.yaw)+z*Math.cos(this.yaw);
      const yy=y*Math.cos(this.pitch)-zz*Math.sin(this.pitch),depth=y*Math.sin(this.pitch)+zz*Math.cos(this.pitch);
      const scale=Math.min(this.w/2500,this.h/1800)*this.zoom;
      return [this.w*.48+xx*scale,this.h*.46-yy*scale,depth];
    }
    line(a,b,color,width=1,dash=[]){const c=this.ctx;c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.stroke();c.setLineDash([]);}
    label(text,x,y,color='#c3d6c7',size=11,align='left'){const c=this.ctx;c.font=`${size}px "Segoe UI",Arial,sans-serif`;c.textAlign=align;c.fillStyle=color;c.fillText(text,Math.max(10,Math.min(this.w-10,x)),Math.max(15,Math.min(this.h-10,y)));}
    draw(){
      if(!this.data)return;const c=this.ctx,r=this.canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
      if(!r.width||!r.height)return;this.w=r.width;this.h=r.height;
      this.canvas.width=Math.round(r.width*dpr);this.canvas.height=Math.round(r.height*dpr);c.setTransform(dpr,0,0,dpr,0,0);
      c.fillStyle='#152a25';c.fillRect(0,0,this.w,this.h);this.hits=[];
      if(this.mode==='image'){this.drawImage();return;}
      for(let x=-900;x<=1500;x+=150)this.line(this.project([x,-90,-900]),this.project([x,-90,1700]),'#233f32');
      for(let z=-900;z<=1700;z+=150)this.line(this.project([-900,-90,z]),this.project([1500,-90,z]),'#233f32');
      const {bank,snapshot,preview,truth,showTruth}=this.data;
      const cameras=bank.views.map((v,index)=>({v,index,screen:this.project(v.center)})).sort((a,b)=>b.screen[2]-a.screen[2]);
      for(const {v,index,screen} of cameras){
        const active=index===preview,selected=snapshot.selected[index],color=active?'#f2c56e':selected?'#6bbca2':'#496455';
        const forward=v.rotation[2],right=v.rotation[0],up=v.rotation[1];
        const corner=(xx,yy)=>v.center.map((x,j)=>x+forward[j]*52+right[j]*xx+up[j]*yy);
        const corners=[corner(-24,-17),corner(24,-17),corner(24,17),corner(-24,17)].map(p=>this.project(p));
        for(let k=0;k<4;k++){this.line(corners[k],corners[(k+1)%4],color,active?1.5:1);if(active||selected)this.line(screen,corners[k],color,active?1.3:.8);}
        c.fillStyle=color;c.beginPath();c.arc(screen[0],screen[1],active?4:2,0,Math.PI*2);c.fill();
        this.hits.push({index,x:screen[0],y:screen[1]});
        if(active){c.beginPath();c.arc(screen[0],screen[1],10,0,Math.PI*2);c.strokeStyle='#f2c56e66';c.lineWidth=1;c.stroke();this.label(`К${String(index+1).padStart(2,'0')}`,screen[0]+14,screen[1]-9,'#f3cd84',12);}
      }
      if(showTruth)for(const k of [0,2])this.line(this.project(truth[k]),this.project(truth[k+1]),'#ffffff88',1.3,[4,4]);
      for(const k of [0,2]){
        const col=k===0?'#66dec0':'#f3bd63',a=this.project(snapshot.state.points[k]),b=this.project(snapshot.state.points[k+1]);
        this.line(a,b,col,4);
        for(const [i,pt] of [[k,a],[k+1,b]]){c.fillStyle='#152a25';c.strokeStyle=col;c.lineWidth=2;c.beginPath();c.arc(pt[0],pt[1],5,0,Math.PI*2);c.fill();c.stroke();}
        const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];this.label(k===0?'Объект':'Масштаб',mid[0]+9,mid[1]+(k===0?26:-17),col,12);
      }
      this.label('ИЗВЕСТНЫЕ ПОЗЫ КАМЕР',20,24,'#7c9b87',9);
      this.label(`${snapshot.selected.filter(Boolean).length} получено / ${bank.views.length} положений`,20,43,'#a0bba9',10);
      const origin=[30,this.h-28];
      for(const [v,name,color] of [[[120,0,0],'x','#68aa89'],[[0,120,0],'y','#d5af65'],[[0,0,120],'z','#84a8c1']]){
        const a=this.project([150,20,200]),b=this.project([150+v[0],20+v[1],200+v[2]]),p=[origin[0]+(b[0]-a[0])*1.2,origin[1]+(b[1]-a[1])*1.2];this.line(origin,p,color,1.3);this.label(name,p[0]+4,p[1],color,10);
      }
    }
    drawImage(){
      const {bank}=this.data,index=safeIndex(this.data);
      const c=this.ctx,pad=35,scale=Math.min((this.w-2*pad)/1280,(this.h-2*pad)/960),ww=1280*scale,hh=960*scale,left=(this.w-ww)/2,top=(this.h-hh)/2;
      c.fillStyle='#223b31';c.fillRect(left,top,ww,hh);c.strokeStyle='#4a6654';c.lineWidth=1;c.strokeRect(left,top,ww,hh);
      for(const k of [0,2]){
        const color=k===0?'#66dec0':'#f3bd63';if(!bank.visible[index][k])continue;
        const pts=bank.pixels[index].slice(k,k+2).map(p=>[left+p[0]*scale,top+p[1]*scale]);this.line(pts[0],pts[1],color,2);
        pts.forEach((p,i)=>{c.fillStyle=color;c.beginPath();c.arc(p[0],p[1],4,0,Math.PI*2);c.fill();this.label(`${k===0?'O':'R'}${i+1}`,p[0]+9,p[1]-9,color,12);});
      }
      this.label(`К${String(index+1).padStart(2,'0')} · 1280 × 960 px`,20,20,'#c2d8c6',10);
      this.label('Смоделированные координаты, не фотография',20,this.h-10,'#92b39d',10);
    }
  }
  function safeIndex(data){return Number.isInteger(data.preview)?data.preview:Math.max(0,data.snapshot.action);}
  root.NBVRender={Scene,lineChart,barChart,palette,format};
})(window);
