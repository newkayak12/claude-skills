#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function usage() {
  return `Usage: render-graph-view.mjs [options]

Options:
  --root <path>    Vault root (default: current directory)
  --nodes <path>   Explicit nodes.jsonl path
  --edges <path>   Explicit edges.jsonl path
  --output <path>  Output HTML path (default: <graph-dir>/graph-view.html)
  --title <text>   Viewer title (default: Knowledge Graph)
  --help           Show this help`;
}

function parseArgs(argv) {
  const options = { root: process.cwd(), title: 'Knowledge Graph' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (['--root', '--nodes', '--edges', '--output', '--title'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  options.root = resolve(options.root);
  return options;
}

function findGraphFiles(options) {
  if (Boolean(options.nodes) !== Boolean(options.edges)) {
    throw new Error('--nodes and --edges must be provided together');
  }
  if (options.nodes) {
    return { nodes: resolve(options.nodes), edges: resolve(options.edges) };
  }
  const candidates = [
    resolve(options.root, '_graph'),
    resolve(options.root, 'knowledge-artifacts/graph'),
    resolve(options.root, 'graph'),
  ];
  for (const graphDir of candidates) {
    const nodes = resolve(graphDir, 'nodes.jsonl');
    const edges = resolve(graphDir, 'edges.jsonl');
    if (existsSync(nodes) && existsSync(edges)) return { nodes, edges };
  }
  throw new Error(`Could not find nodes.jsonl and edges.jsonl under ${options.root}`);
}

function readJsonl(path) {
  const records = [];
  for (const [index, line] of readFileSync(path, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`);
    }
  }
  return records;
}

function strings(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
}

function normalizeGraph(nodeRecords, edgeRecords) {
  const seen = new Set();
  const nodes = nodeRecords.map((record, index) => {
    const name = record.canonical_name ?? record.name ?? record.title;
    const id = String(record.id || record.node_id || name || '').trim();
    if (!id) throw new Error(`nodes.jsonl:${index + 1}: missing id or canonical_name`);
    if (seen.has(id)) throw new Error(`nodes.jsonl:${index + 1}: duplicate node id ${id}`);
    seen.add(id);
    return {
      id,
      name: String(name || id),
      label: String(record.label ?? record.type ?? record.class ?? 'Entity'),
      aliases: strings(record.aliases),
      description: String(record.description ?? record.summary ?? ''),
      sourceRefs: strings(record.source_refs ?? record.sources),
      metadata: record,
    };
  });

  const omitted = [];
  const edges = [];
  edgeRecords.forEach((record, index) => {
    const source = String(record.source_node_id ?? record.source_id ?? record.from ?? record.source ?? '').trim();
    const target = String(record.target_node_id ?? record.target_id ?? record.to ?? record.target ?? '').trim();
    const relationship = String(record.relationship_type ?? record.type ?? record.relation ?? record.label ?? '').trim();
    if (!source || !target || !relationship) {
      throw new Error(`edges.jsonl:${index + 1}: missing source, target, or relationship type`);
    }
    if (!seen.has(source) || !seen.has(target)) {
      omitted.push({ line: index + 1, source, target, reason: 'unknown endpoint' });
      return;
    }
    edges.push({
      id: String(record.id || record.edge_id || `edge-${index + 1}`),
      source,
      target,
      relationship,
      evidence: String(record.evidence ?? ''),
      sourceRefs: strings(record.source_refs ?? record.sources),
      metadata: record,
    });
  });
  return { nodes, edges, omitted };
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function page(graph, title) {
  const payload = Buffer.from(JSON.stringify(graph), 'utf8').toString('base64');
  const safeTitle = htmlEscape(title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${safeTitle} · Graph View</title>
<style>
  :root{--bg:#17171b;--panel:rgba(29,29,34,.94);--line:#36363f;--text:#dedee7;--muted:#8d8d9a;--accent:#a88bfa;--shadow:0 18px 60px #0008}
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--bg);color:var(--text);font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  button,input,select{font:inherit;color:inherit}button,select,input{border:1px solid var(--line);background:#24242b;border-radius:7px}button{padding:7px 10px;cursor:pointer}button:hover{border-color:#5b556e;background:#2d2b36}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  #app{height:100%;display:grid;grid-template-rows:52px 1fr}.topbar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #303038;background:#1c1c21;z-index:4}.brand{font-weight:650;letter-spacing:.01em;margin-right:auto}.brand span{color:var(--muted);font-weight:450;margin-left:8px}.topbar button{min-width:36px}
  #stage{position:relative;min-height:0}canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab}canvas.dragging{cursor:grabbing}
  .controls{position:absolute;left:14px;top:14px;width:min(290px,calc(100% - 28px));padding:12px;background:var(--panel);border:1px solid #3a3a43;border-radius:11px;box-shadow:var(--shadow);backdrop-filter:blur(12px)}
  .search{width:100%;padding:9px 10px;margin-bottom:9px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.row select{width:100%;padding:7px 8px}.stats{display:flex;gap:12px;color:var(--muted);font-size:12px;margin-top:9px}.hint{position:absolute;left:14px;bottom:12px;color:#777783;font-size:11px;pointer-events:none}
  #details{position:absolute;right:14px;top:14px;bottom:14px;width:min(340px,calc(100% - 28px));padding:17px;background:var(--panel);border:1px solid #3a3a43;border-radius:11px;box-shadow:var(--shadow);backdrop-filter:blur(12px);overflow:auto;transform:translateX(calc(100% + 28px));transition:transform .18s ease}#details.open{transform:none}
  #details button.close{position:absolute;right:10px;top:10px;background:transparent;border:0;font-size:18px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);margin-bottom:4px}.node-title{font-size:21px;line-height:1.2;margin:0 28px 4px 0}.node-id{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.section{margin-top:18px}.section h3{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:0 0 7px}.section p{margin:0;white-space:pre-wrap}.chips{display:flex;flex-wrap:wrap;gap:5px}.chip{border:1px solid #41414b;background:#282830;padding:3px 7px;border-radius:999px;font-size:11px}.list{display:grid;gap:7px}.list-item{padding:7px 8px;border-left:2px solid #504d5c;background:#24242a;border-radius:0 6px 6px 0;word-break:break-word}.metadata{font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#adadb9;white-space:pre-wrap;word-break:break-word}
  #tooltip{position:fixed;display:none;z-index:8;pointer-events:none;max-width:260px;padding:7px 9px;border:1px solid #44444e;border-radius:7px;background:#25252cee;box-shadow:0 8px 26px #0008}.tooltip-type{color:#aaa0c9;font-size:11px}
  .empty{color:var(--muted)}
  @media(max-width:700px){.brand span,.hint{display:none}.controls{width:245px}.row{grid-template-columns:1fr}#details{top:auto;height:48%;width:calc(100% - 28px)}}
  @media(prefers-reduced-motion:reduce){#details{transition:none}}
</style>
</head>
<body>
<main id="app">
  <header class="topbar"><div class="brand">${safeTitle}<span>Graph View</span></div><button id="fit" title="Fit graph">Fit</button><button id="motion" title="Pause or resume layout">Pause</button></header>
  <section id="stage">
    <canvas id="graph" role="img" aria-label="Interactive knowledge graph"></canvas>
    <div class="controls">
      <input id="search" class="search" type="search" placeholder="Search nodes…" autocomplete="off" aria-label="Search nodes">
      <div class="row"><select id="type" aria-label="Filter node type"></select><select id="relation" aria-label="Filter relationship"></select></div>
      <div class="stats"><span id="node-count"></span><span id="edge-count"></span></div>
    </div>
    <aside id="details" aria-label="Node details"><button class="close" title="Close details" aria-label="Close details">×</button><div id="detail-body"></div></aside>
    <div id="tooltip"></div><div class="hint">Scroll to zoom · drag canvas to pan · drag nodes to arrange</div>
  </section>
</main>
<script>
'use strict';
const DATA_B64='${payload}';
const bytes=Uint8Array.from(atob(DATA_B64),function(c){return c.charCodeAt(0)});
const data=JSON.parse(new TextDecoder().decode(bytes));
const canvas=document.getElementById('graph'),ctx=canvas.getContext('2d');
const stage=document.getElementById('stage'),search=document.getElementById('search');
const typeFilter=document.getElementById('type'),relationFilter=document.getElementById('relation');
const details=document.getElementById('details'),detailBody=document.getElementById('detail-body'),tooltip=document.getElementById('tooltip');
const palette=['#a88bfa','#6fb8ff','#65d6a6','#f0a96b','#f27f9d','#d9cb72','#7ed5d1','#bda0ff','#ef8f72','#8fbc71'];
const nodeMap=new Map(),degree=new Map();
function hash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
const labels=[...new Set(data.nodes.map(function(n){return n.label}))].sort();
const colors=new Map(labels.map(function(label,index){return [label,palette[index%palette.length]]}));
const nodes=data.nodes.map(function(n,index){const seed=hash(n.id),angle=(seed%6283)/1000,radius=120+((seed>>>8)%520);const item=Object.assign({},n,{x:Math.cos(angle)*radius,y:Math.sin(angle)*radius,vx:0,vy:0,index:index,visible:true});nodeMap.set(item.id,item);degree.set(item.id,0);return item});
const edges=data.edges.map(function(e){const item=Object.assign({},e,{a:nodeMap.get(e.source),b:nodeMap.get(e.target)});degree.set(e.source,(degree.get(e.source)||0)+1);degree.set(e.target,(degree.get(e.target)||0)+1);return item});
nodes.forEach(function(n){n.radius=Math.min(11,4.2+Math.log2(1+(degree.get(n.id)||0))*1.35)});
let width=0,height=0,dpr=1,panX=0,panY=0,zoom=1,alpha=1,running=!matchMedia('(prefers-reduced-motion: reduce)').matches;
let selected=null,hovered=null,dragNode=null,panning=false,startX=0,startY=0,startPanX=0,startPanY=0,moved=0;
function option(select,value,text){const el=document.createElement('option');el.value=value;el.textContent=text;select.append(el)}
option(typeFilter,'*','All node types');labels.forEach(function(label){option(typeFilter,label,label)});
const relations=[...new Set(edges.map(function(e){return e.relationship}))].sort();option(relationFilter,'*','All relationships');relations.forEach(function(r){option(relationFilter,r,r)});
function resize(){const rect=stage.getBoundingClientRect();width=rect.width;height=rect.height;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
new ResizeObserver(resize).observe(stage);
const SPREAD=.42;
function scaleFor(z){return z<1?Math.pow(z,1-SPREAD):z}
function zoomForScale(s){return s<1?Math.pow(s,1/(1-SPREAD)):s}
function scale(){return scaleFor(zoom)}
function graphPoint(sx,sy){const s=scale();return{x:(sx-panX)/s,y:(sy-panY)/s}}
function screenPoint(n){const s=scale();return{x:n.x*s+panX,y:n.y*s+panY}}
function matches(n){const q=search.value.trim().toLocaleLowerCase();if(!q)return true;return [n.id,n.name,n.label,n.description].concat(n.aliases||[]).some(function(v){return String(v).toLocaleLowerCase().includes(q)})}
function applyFilters(){const wanted=typeFilter.value;nodes.forEach(function(n){n.visible=wanted==='*'||n.label===wanted});alpha=Math.max(alpha,.25);updateStats();draw()}
function visibleEdge(e){return e.a.visible&&e.b.visible&&(relationFilter.value==='*'||e.relationship===relationFilter.value)}
function updateStats(){const nv=nodes.filter(function(n){return n.visible}).length,ev=edges.filter(visibleEdge).length;document.getElementById('node-count').textContent=nv+' nodes';document.getElementById('edge-count').textContent=ev+' edges'}
function selectedNeighbor(n){return selected&&edges.some(function(e){return visibleEdge(e)&&((e.a===selected&&e.b===n)||(e.b===selected&&e.a===n))})}
function simulate(){if(!running||alpha<.002)return;const cellSize=150,cells=new Map();nodes.forEach(function(n){if(!n.visible||n===dragNode)return;const key=Math.floor(n.x/cellSize)+','+Math.floor(n.y/cellSize);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(n)});
  nodes.forEach(function(n){if(!n.visible||n===dragNode)return;const cx=Math.floor(n.x/cellSize),cy=Math.floor(n.y/cellSize);for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++){const group=cells.get(gx+','+gy)||[];group.forEach(function(m){if(m.index<=n.index)return;let dx=n.x-m.x,dy=n.y-m.y,d2=dx*dx+dy*dy+.5;if(d2>46000)return;const f=Math.min(3.4,3200/d2)*alpha,dist=Math.sqrt(d2);dx/=dist;dy/=dist;n.vx+=dx*f;n.vy+=dy*f;m.vx-=dx*f;m.vy-=dy*f})}n.vx+=-n.x*.00035*alpha;n.vy+=-n.y*.00035*alpha});
  edges.forEach(function(e){if(!visibleEdge(e))return;let dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,dist=Math.sqrt(dx*dx+dy*dy)||1,f=(dist-118)*.0022*alpha;dx/=dist;dy/=dist;if(e.a!==dragNode){e.a.vx+=dx*f;e.a.vy+=dy*f}if(e.b!==dragNode){e.b.vx-=dx*f;e.b.vy-=dy*f}});
  nodes.forEach(function(n){if(!n.visible||n===dragNode)return;n.vx*=.87;n.vy*=.87;n.x+=n.vx;n.y+=n.vy});alpha*=.986}
function drawArrow(a,b,color){const angle=Math.atan2(b.y-a.y,b.x-a.x),tipX=b.x-Math.cos(angle)*(b.radius*zoom+2),tipY=b.y-Math.sin(angle)*(b.radius*zoom+2);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(tipX,tipY);ctx.lineTo(tipX-Math.cos(angle-.48)*7,tipY-Math.sin(angle-.48)*7);ctx.lineTo(tipX-Math.cos(angle+.48)*7,tipY-Math.sin(angle+.48)*7);ctx.closePath();ctx.fill()}
function draw(){ctx.clearRect(0,0,width,height);const q=search.value.trim(),s=scale(),edgeAlpha=(.10+.16*Math.min(1,s)).toFixed(3);edges.forEach(function(e){if(!visibleEdge(e))return;const a=screenPoint(e.a),b=screenPoint(e.b),focus=selected&&(e.a===selected||e.b===selected);ctx.strokeStyle=focus?'rgba(190,174,245,.72)':'rgba(132,132,150,'+(selected?'.08':edgeAlpha)+')';ctx.lineWidth=focus?1.5:.75;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();if(focus)drawArrow(a,Object.assign({radius:e.b.radius},b),'rgba(190,174,245,.72)')});
  nodes.forEach(function(n){if(!n.visible)return;const p=screenPoint(n),match=matches(n),neighbor=selectedNeighbor(n),focus=n===selected||n===hovered||neighbor;let opacity=1;if(selected&&!focus)opacity=.18;else if(q&&!match)opacity=.13;ctx.globalAlpha=opacity;const r=Math.max(2.4,n.radius*zoom);ctx.fillStyle=colors.get(n.label);if(n===selected){ctx.shadowColor=colors.get(n.label);ctx.shadowBlur=18;ctx.strokeStyle='#f4efff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,r+3,0,Math.PI*2);ctx.stroke()}ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    const minDegree=s>1?2:s>.75?3:s>.5?5:s>.32?9:1e9,showLabel=n===selected||n===hovered||(q&&match)||degree.get(n.id)>minDegree;if(showLabel){ctx.globalAlpha=Math.max(opacity,.78);ctx.font=(n===selected?'600 ':'400 ')+Math.max(10,Math.min(14,11*s))+'px system-ui';ctx.fillStyle='#e8e8ee';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText(n.name,p.x,p.y+r+5)}ctx.globalAlpha=1})}
function loop(){simulate();draw();requestAnimationFrame(loop)}requestAnimationFrame(loop);
function nearest(sx,sy){let best=null,bestD=18;nodes.forEach(function(n){if(!n.visible)return;const p=screenPoint(n),d=Math.hypot(p.x-sx,p.y-sy);if(d<Math.max(bestD,n.radius*zoom+5)){best=n;bestD=d}});return best}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el}
function addSection(titleText,content){const section=element('div','section'),heading=element('h3','',titleText);section.append(heading,content);detailBody.append(section)}
function renderDetails(n){selected=n;detailBody.replaceChildren();detailBody.append(element('div','eyebrow',n.label),element('h2','node-title',n.name),element('div','node-id',n.id));if(n.description)addSection('Description',element('p','',n.description));if(n.aliases&&n.aliases.length){const chips=element('div','chips');n.aliases.forEach(function(x){chips.append(element('span','chip',x))});addSection('Aliases',chips)}
  const linked=edges.filter(function(e){return visibleEdge(e)&&(e.a===n||e.b===n)});const list=element('div','list');linked.forEach(function(e){const other=e.a===n?e.b:e.a,direction=e.a===n?'→':'←';list.append(element('div','list-item',direction+' '+e.relationship+' · '+other.name))});addSection('Relationships · '+linked.length,linked.length?list:element('p','empty','No visible relationships'));
  if(n.sourceRefs&&n.sourceRefs.length){const refs=element('div','list');n.sourceRefs.forEach(function(x){refs.append(element('div','list-item',x))});addSection('Sources',refs)}addSection('Raw metadata',element('div','metadata',JSON.stringify(n.metadata,null,2)));details.classList.add('open');draw()}
function showTooltip(n,event){if(!n){tooltip.style.display='none';return}tooltip.replaceChildren(element('strong','',n.name),element('div','tooltip-type',n.label+' · '+(degree.get(n.id)||0)+' links'));tooltip.style.display='block';tooltip.style.left=Math.min(innerWidth-270,event.clientX+14)+'px';tooltip.style.top=Math.min(innerHeight-70,event.clientY+14)+'px'}
canvas.addEventListener('pointerdown',function(event){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;startX=x;startY=y;moved=0;dragNode=nearest(x,y);panning=!dragNode;startPanX=panX;startPanY=panY;canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging')});
canvas.addEventListener('pointermove',function(event){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,dx=x-startX,dy=y-startY;moved=Math.max(moved,Math.hypot(dx,dy));if(dragNode){const point=graphPoint(x,y);dragNode.x=point.x;dragNode.y=point.y;dragNode.vx=0;dragNode.vy=0;alpha=Math.max(alpha,.15)}else if(panning){panX=startPanX+dx;panY=startPanY+dy}else{hovered=nearest(x,y);showTooltip(hovered,event)}draw()});
canvas.addEventListener('pointerup',function(event){if(moved<5&&dragNode)renderDetails(dragNode);else if(moved<5&&!dragNode){selected=null;details.classList.remove('open')}dragNode=null;panning=false;canvas.classList.remove('dragging');try{canvas.releasePointerCapture(event.pointerId)}catch{}draw()});
canvas.addEventListener('pointerleave',function(){if(!dragNode){hovered=null;showTooltip(null);draw()}});
canvas.addEventListener('wheel',function(event){event.preventDefault();const rect=canvas.getBoundingClientRect(),sx=event.clientX-rect.left,sy=event.clientY-rect.top,before=graphPoint(sx,sy),factor=Math.exp(-event.deltaY*.0012);zoom=Math.max(.06,Math.min(5,zoom*factor));const s=scale();panX=sx-before.x*s;panY=sy-before.y*s;draw()},{passive:false});
function fit(){const visible=nodes.filter(function(n){return n.visible});if(!visible.length)return;const xs=visible.map(function(n){return n.x}),ys=visible.map(function(n){return n.y}),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),margin=90,fitScale=Math.min((width-margin*2)/(maxX-minX||1),(height-margin*2)/(maxY-minY||1));zoom=Math.max(.06,Math.min(2.2,zoomForScale(fitScale)));const s=scale();panX=width/2-(minX+maxX)/2*s;panY=height/2-(minY+maxY)/2*s;draw()}
document.getElementById('fit').addEventListener('click',fit);document.getElementById('motion').addEventListener('click',function(event){running=!running;if(running)alpha=Math.max(alpha,.35);event.currentTarget.textContent=running?'Pause':'Resume'});
details.querySelector('.close').addEventListener('click',function(){selected=null;details.classList.remove('open');draw()});search.addEventListener('input',draw);typeFilter.addEventListener('change',applyFilters);relationFilter.addEventListener('change',function(){alpha=Math.max(alpha,.2);updateStats();draw()});
updateStats();resize();setTimeout(fit,40);
</script>
</body>
</html>`;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  const files = findGraphFiles(options);
  const graph = normalizeGraph(readJsonl(files.nodes), readJsonl(files.edges));
  const output = resolve(options.output || resolve(dirname(files.nodes), 'graph-view.html'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, page(graph, options.title), 'utf8');
  for (const item of graph.omitted) {
    console.warn(`Omitted edges.jsonl:${item.line} (${item.source} -> ${item.target}): ${item.reason}`);
  }
  console.log(JSON.stringify({
    output,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    omitted_edges: graph.omitted.length,
  }, null, 2));
} catch (error) {
  console.error(`render-graph-view: ${error.message}`);
  console.error(usage());
  process.exitCode = 1;
}
