// Sanity-check the score spread across every route/mode/time combination.
// Mirrors src/lib/risk.ts; if the two drift this will stop matching the app.
import { readFileSync } from 'node:fs'
const L = n => JSON.parse(readFileSync(`public/data/${n}.json`, 'utf8'))
const data = { places:L('places'), hotspots:L('hotspots'), districts:L('districts'),
  conditions:L('conditions'), exposure:L('exposure') }
const KLAT=110.57, KLON=111.32*Math.cos(20.3*Math.PI/180)
const segd=(p,a,b)=>{const py=(p[0]-a.lat)*KLAT,px=(p[1]-a.lon)*KLON,by=(b.lat-a.lat)*KLAT,bx=(b.lon-a.lon)*KLON
  const d=bx*bx+by*by; if(!d) return Math.hypot(px,py); const t=Math.max(0,Math.min(1,(px*bx+py*by)/d))
  return Math.hypot(px-t*bx,py-t*by)}
const W={hotspots:.35,district:.25,mode:.25,time:.15}
const TB={day:'Day light','dawn-dusk':'Dawn dusk','night-lit':'Darkness street lights present and lit','night-unlit':'Darkness no street lighting'}
const GRP={car:'other',bus:'other',motorcycle:'rider',pedestrian:'pedestrian'}
const clamp=n=>Math.max(0,Math.min(1,n))
const norm=(v,mn,mx)=> mx<=mn?0:clamp((v-mn)/(mx-mn))
const ds=data.districts.districts
const island={pedestrian:data.exposure.pedestrianCasualtyShare,rider:data.exposure.riderCasualtyShare,other:1-data.exposure.vulnerableShare}
const pressures=ds.map(d=>d.pressureIndex)
const ratios=ds.flatMap(d=>[d.pedestrianShare/island.pedestrian,d.riderShare/island.rider,d.otherShare/island.other])
const fs=data.conditions.light.conditions.map(c=>c.fatalShare)
const B={pressure:{min:Math.min(...pressures),max:Math.max(...pressures)},
  modeRatio:{min:Math.min(...ratios),max:Math.max(...ratios)},
  fatalShare:{min:Math.min(...fs),max:Math.max(...fs)}}
console.log('bounds', JSON.stringify(B))
const p90=data.hotspots.scale.p90Count
function score(o,d,mode,tb){
  const names=new Set([...o.policeDistricts,...d.policeDistricts])
  const dd=ds.filter(x=>names.has(x.name))
  const hs=data.hotspots.hotspots.filter(h=>Math.min(...h.points.map(p=>segd(p,o,d)))<=data.hotspots.corridorRadiusKm)
  const g=GRP[mode]
  const share=dd.reduce((s,x)=>s+(g==='pedestrian'?x.pedestrianShare:g==='rider'?x.riderShare:x.otherShare),0)/dd.length
  const light=data.conditions.light.conditions.find(c=>c.condition===TB[tb])
  const r=clamp(hs.length/p90)*W.hotspots
    + norm(dd.reduce((s,x)=>s+x.pressureIndex,0)/dd.length,B.pressure.min,B.pressure.max)*W.district
    + norm(share/island[g],B.modeRatio.min,B.modeRatio.max)*W.mode
    + norm(light.fatalShare,B.fatalShare.min,B.fatalShare.max)*W.time
  return {score:Math.round(100-r*100), hs:hs.length}
}
const P=data.places.places, rows=[]
for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++)
  for(const m of ['car','motorcycle','bus','pedestrian'])for(const t of Object.keys(TB))
    rows.push({...score(P[i],P[j],m,t), a:P[i].name,b:P[j].name,m,t})
const sc=rows.map(r=>r.score).sort((x,y)=>x-y)
const q=p=>sc[Math.floor(p*sc.length)]
console.log('combinations:',rows.length)
console.log('score  min',sc[0],' p10',q(.1),' median',q(.5),' p90',q(.9),' max',sc[sc.length-1])
const bands={good:0,moderate:0,high:0,severe:0}
for(const s of sc) bands[s>=80?'good':s>=65?'moderate':s>=50?'high':'severe']++
console.log('bands  ', Object.entries(bands).map(([k,v])=>`${k} ${(100*v/sc.length).toFixed(0)}%`).join('  '))
const show=(f,label)=>{const r=rows.filter(f); if(r.length) console.log(`  ${label.padEnd(30)} ${String(r[0].score).padStart(3)}/100  (${r[0].hs} hotspots)`)}
console.log('\nspecimen routes:')
show(r=>r.a==='Grand Baie'&&r.b==='Port Louis'&&r.m==='motorcycle'&&r.t==='night-unlit','Grand Baie->PL moto, unlit night')
show(r=>r.a==='Grand Baie'&&r.b==='Port Louis'&&r.m==='car'&&r.t==='day','Grand Baie->PL car, day')
show(r=>r.a==='Bon Accueil'&&r.b==='Centre de Flacq'&&r.m==='car'&&r.t==='day','Bon Accueil->Flacq car, day')
show(r=>r.a==='Curepipe'&&r.b==='Port Louis'&&r.m==='car'&&r.t==='day','Curepipe->PL car, day')
show(r=>r.a==='Curepipe'&&r.b==='Port Louis'&&r.m==='pedestrian'&&r.t==='night-unlit','Curepipe->PL on foot, night')
