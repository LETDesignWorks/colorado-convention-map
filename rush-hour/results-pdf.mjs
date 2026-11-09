import {createPdfLibRibbons,loadPdfRibbonAssets,ribbonLayout} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';
import {details,sourceUrl} from './results-report.mjs?v=rush-pdf-20261109-1';
let libraryPromise;
export function loadPdfLibrary(d=globalThis.document,w=globalThis.window){
  if(w.PDFLib?.PDFDocument)return Promise.resolve(w.PDFLib);
  if(libraryPromise)return libraryPromise;
  libraryPromise=new Promise((resolve,reject)=>{const script=d.createElement('script');script.src=new URL('../load-tests/vendor/pdf-lib.min.js',import.meta.url).href;script.async=true;let settled=false;
    const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);script.onload=script.onerror=null;if(error){script.remove();reject(error);}else resolve(w.PDFLib);};
    const timer=setTimeout(()=>finish(Error('PDF tools took too long to load. Retry or use Print / Save PDF.')),15000);
    script.onload=()=>finish(w.PDFLib?.PDFDocument?null:Error('PDF tools could not start.'));script.onerror=()=>finish(Error('PDF tools could not load. Retry or use Print / Save PDF.'));d.head.append(script);
  }).catch(error=>{libraryPromise=null;throw error;});return libraryPromise;
}
export function printable(value,font){return [...String(value??'').replace(/[‐‑‒–—]/g,'-').replace(/…/g,'...').replace(/[\r\t\u00a0]/g,' ')].map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');}
export function wrap(value,font,size,width){const lines=[];for(const paragraph of printable(value,font).split('\n')){let line='';for(const word of paragraph.split(/\s+/)){if(font.widthOfTextAtSize(line?line+' '+word:word,size)<=width){line=line?line+' '+word:word;continue;}if(line){lines.push(line);line='';}for(const char of word){if(line&&font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}}lines.push(line);}return lines;}
export async function buildResultsPdf(report,{PDFLib,ribbonAssets,logoBytes,now=new Date()}={}){
  if(!report?.rows?.length)throw Error('No results to export.');
  if(!PDFLib?.PDFDocument)throw Error('PDF tools are unavailable.');
  const {PDFDocument,StandardFonts,rgb,PDFString}=PDFLib,doc=await PDFDocument.create();
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const ribbons=await createPdfLibRibbons(doc,{ribbonAssets});
  const logo=logoBytes?await doc.embedPng(logoBytes):null;
  const W=612,H=792,M=36,RIGHT=W-M,WIDTH=W-2*M,frame=ribbonLayout(W,H),BOTTOM=frame.bottom+36;
  const navy=rgb(.03,.25,.45),ink=rgb(.10,.17,.23),muted=rgb(.33,.40,.46),line=rgb(.82,.87,.90);
  let page,y;
  const text=(value,x,yy,size=10,font=regular,color=ink)=>page.drawText(printable(value,font),{x,y:yy,size,font,color});
  function newPage(){page=doc.addPage([W,H]);y=H-frame.top-17;
    if(logo){const dims=logo.scale(Math.min(85/logo.width,36/logo.height));page.drawImage(logo,{x:RIGHT-dims.width,y:y-dims.height+5,width:dims.width,height:dims.height});}
    text('DENVER 2027',M,y,9,bold,navy);y-=23;text(report.title,M,y,19,bold,navy);y-=19;text(report.groupTitle+' · '+(report.period==='am'?'Morning':'Afternoon'),M,y,11,bold);y-=16;
    text('Forecast snapshot · extra bus allowance '+report.allowance+' min',M,y,9,regular,muted);y-=12;page.drawLine({start:{x:M,y},end:{x:RIGHT,y},thickness:.7,color:line});y-=18;
  }
  function paragraph(value,{size=9,font=regular,color=ink,gap=6}={}){for(const entry of wrap(value,font,size,WIDTH)){if(y<BOTTOM+size+4)newPage();if(entry)text(entry,M,y,size,font,color);y-=size+4;}y-=gap;}
  function link(url,label){if(!sourceUrl(url))return;const size=9;for(const entry of wrap(label,regular,size,WIDTH)){if(y<BOTTOM+size+4)newPage();text(entry,M,y,size,regular,navy);const annotation=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[M,y-2,M+regular.widthOfTextAtSize(entry,size),y+size],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}}));page.node.addAnnot(annotation);y-=13;}y-=6;}
  doc.setTitle('Denver 2027 - '+report.title+' - '+report.groupTitle);doc.setSubject('Dated rush-hour forecasts and bus planning times');doc.setCreator('Denver 2027 Convention Planner');doc.setCreationDate(now);
  newPage();paragraph('Outbound from '+report.origin.name+'\n'+report.origin.address,{font:bold,size:10});paragraph(report.reference);paragraph('Forecasts checked: '+report.checkedDate+' | Prepared: '+report.created,{color:muted});paragraph(report.approvalStatus,{color:muted});
  paragraph(`${report.rows.length} of ${report.total} destinations${report.query?' | Search: '+report.query:' | No search filter'}`,{font:bold});paragraph(report.method,{size:8.5,color:muted,gap:12});
  const col=[M,M+330,M+440],widths=[318,98,88];
  function tableHead(){if(y<BOTTOM+65)newPage();page.drawRectangle({x:M,y:y-19,width:WIDTH,height:23,color:rgb(.92,.95,.97)});['Rank / destination','Google car range','Bus plan'].forEach((title,i)=>text(title,col[i]+4,y-11,9,bold,navy));y-=28;}
  tableHead();
  for(const row of report.rows){const columns=[wrap(`${row.rank??'-'}. ${row.displayLabel} · ${row.name}\n${row.address}`,regular,9,widths[0]),wrap(row.forecast?.routes?.[0]?.rangeText||'Needs traffic check',regular,9,widths[1]),wrap(row.planningMinutes==null?'Not ranked':row.planningMinutes+' min',bold,10,widths[2])];let offset=0;const total=Math.max(...columns.map(c=>c.length));
    while(offset<total){if(y<BOTTOM+28){newPage();tableHead();}const capacity=Math.max(1,Math.floor((y-BOTTOM-12)/13)),count=Math.min(total-offset,capacity);for(let i=0;i<3;i++)for(let n=0;n<count;n++){const value=columns[i][offset+n];if(value)text(value,col[i]+4,y-n*13,i===2?10:9,i===2?bold:regular);}
      y-=count*13+8;page.drawLine({start:{x:M,y:y+13},end:{x:RIGHT,y:y+13},thickness:.5,color:line});offset+=count;
    }
  }
  const detail=details(report);
  if(detail){y-=16;if(y<BOTTOM+100)newPage();paragraph('Selected route details',{size:13,font:bold,color:navy});paragraph(detail.title,{size:11,font:bold});for(const value of detail.lines)paragraph(value);if(detail.url)link(detail.url,'Open Google forecast / change date');}
  for(const[p,i]of doc.getPages().map((p,i)=>[p,i])){page=p;page.drawLine({start:{x:M,y:BOTTOM-10},end:{x:RIGHT,y:BOTTOM-10},thickness:.5,color:line});text('SAVED FORECAST - NOT LIVE TRAFFIC',M,BOTTOM-23,8,bold,muted);text(`${i+1} / ${doc.getPageCount()}`,RIGHT-35,BOTTOM-23,8,regular,muted);}
  ribbons.drawAllPages();const bytes=await doc.save();return{blob:new Blob([bytes],{type:'application/pdf'}),filename:`Denver-2027-Rush-Hour-${report.group}-${report.period.toUpperCase()}.pdf`,pages:doc.getPageCount()};
}
export async function exportResultsPdf(report){
  const [PDFLib,ribbonAssets]=await Promise.all([loadPdfLibrary(),loadPdfRibbonAssets()]);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);let logoBytes;
  try{const r=await fetch(new URL('../assets/denver-2027-territory-logo.png',import.meta.url),{signal:controller.signal});if(!r.ok)throw Error('The convention logo could not load. Retry or use Print / Save PDF.');logoBytes=new Uint8Array(await r.arrayBuffer());}finally{clearTimeout(timer);}
  return buildResultsPdf(report,{PDFLib,ribbonAssets,logoBytes});
}
