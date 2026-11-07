import {createPdfLibRibbons, ribbonLayout} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';
import {loadPdfLibrary, wrapText, printable, PDF_LOGO_URL} from './traffic-pdf.mjs?v=street-names-20261107-1';

export const PHOTO_PDF_PAGE = Object.freeze({width:960, height:540});

// Only this explicit public-data allowlist can reach the report. Private reviews
// and site contacts are never passed into the PDF builder.
export function publicPhotoReport(location, summary = {}) {
  return {
    id: String(location.id), name: String(location.name || 'Meeting location'),
    marker: String(location.markerLabel || location.number || ''), address: String(location.address || ''),
    congregations: Array.isArray(location.congregations) ? location.congregations.map(String) : [],
    status: String(summary.status || 'Not reviewed'), busSize: String(summary.busSize || 'Not selected'),
    publicSummary: String(summary.publicSummary || '')
  };
}

async function loadLogo(fetcher) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    if(typeof fetcher!=='function')throw Error('No image loader.');
    const response=await fetcher(PDF_LOGO_URL,{signal:controller.signal,cache:'force-cache'});
    if(!response.ok)throw Error('Logo request failed.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length<8||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw Error('Invalid logo.');
    return bytes;
  } catch {
    throw Error('The convention logo could not load. Check your connection and create the PDF again.');
  } finally {clearTimeout(timer);}
}

function noteParagraphs(value) {
  return String(value??'').replace(/\r\n?/g,'\n').split('\n')
    .map(line=>line.trim().replace(/^(?:[-*](?:\s+|$)|[\u2022\u2023\u25e6\u25aa]\s*|\d{1,3}[.)]\s+)/,''))
    .filter(Boolean);
}

/** A complete site-visit snapshot. Exporting never changes notes or photo records. */
export async function buildPhotoPdf({report, photos=[], loadImage, source='device', notes='', overviewPhotoId=''},
  {PDFLib, now=new Date(), ribbonAssets, logoBytes, fetch:fetcher=globalThis.fetch}={}) {
  PDFLib ||= await loadPdfLibrary();
  const {PDFDocument,StandardFonts,rgb}=PDFLib,pdf=await PDFDocument.create();
  const ribbons=await createPdfLibRibbons(pdf,{ribbonAssets});
  let logo;
  try {logo=await pdf.embedPng(logoBytes??await loadLogo(fetcher));}
  catch {throw Error('The convention logo could not load. Check your connection and create the PDF again.');}
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const {width:W,height:H}=PHOTO_PDF_PAGE,frame=ribbonLayout(W,H);
  const margin=32,gap=22,contentWidth=W-margin*2,contentTop=H-frame.top-4;
  const footerY=frame.bottom+5,footerLineY=footerY+15,bodyBottom=footerLineY+15;
  const bodyTop=contentTop-76,leftWidth=330,rightX=margin+leftWidth+24,rightWidth=W-margin-rightX;
  const navy=rgb(.06,.24,.43),ink=rgb(.11,.16,.21),muted=rgb(.34,.40,.47);
  const pale=rgb(.956,.969,.978),lineColor=rgb(.80,.85,.89);
  const selected=photos.filter(photo=>photo.selected!==false),noteLines=noteParagraphs(notes);
  const exported=new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}).format(now)+' MT';
  const allText=[report.name,report.address,report.status,report.busSize,...(report.congregations||[]),report.publicSummary,...noteLines,...selected.map(p=>p.caption||'')].join('\n');
  const textWarning=[...allText].some(char=>{
    if(/[\n\r\t\u2010-\u2014\u2026\u00a0]/.test(char))return false;
    try {regular.encodeText(char);return false;}catch{return true;}
  });
  pdf.setTitle(`${report.name} - Site visit overview`);
  pdf.setSubject('Saved location details, selected photos, and PDF notes');
  pdf.setAuthor('Denver 2027 Convention');pdf.setCreator('Denver 2027 Bus Access Review');pdf.setCreationDate(now);
  const drawText=(page,value,x,y,size=11,font=regular,color=ink)=>{
    if(value)page.drawText(printable(value,font),{x,y,size,font,color});
  };
  function shortLabel(value,font,size,width) {
    const text=printable(value,font);if(font.widthOfTextAtSize(text,size)<=width)return text;
    let label=text;while(label&&font.widthOfTextAtSize(label+'...',size)>width)label=label.slice(0,-1);
    return label+'...';
  }
  function brandHeader(page,section='Site visit',continued=false) {
    const scale=Math.min(112/logo.width,60/logo.height),width=logo.width*scale,height=logo.height*scale;
    page.drawImage(logo,{x:margin,y:contentTop-height,width,height});
    drawText(page,'DENVER 2027',margin+126,contentTop-12,9,bold,navy);
    drawText(page,section,margin+126,contentTop-35,continued?19:17,bold,navy);
    drawText(page,continued?shortLabel(report.name,regular,10.5,W-margin*2-126):'BUS ACCESS REVIEW',
      margin+126,contentTop-53,continued?10.5:8.5,regular,muted);
  }
  const addPage=(section,continued=false)=>{const page=pdf.addPage([W,H]);brandHeader(page,section,continued);return page;};
  const block=(text,options={})=>({text:String(text??''),size:11,leading:14.5,font:regular,color:ink,before:0,after:5,...options});
  const heading=text=>block(text,{size:11.5,leading:15,font:bold,color:navy,before:6,after:4,heading:true});
  const mainBlocks=[
    block(`${report.marker?report.marker+'. ':''}${report.name}`,{size:23,leading:27.5,font:bold,color:navy,after:8}),
    block(report.address,{size:12.5,leading:16,color:navy,after:8}),
    block(`Bus access: ${report.status}`,{size:11.5,leading:14.5,font:bold,after:2}),
    block(`Largest bus reviewed: ${report.busSize}`,{after:4})
  ];
  if(report.congregations?.length)mainBlocks.push(block(`Congregations / groups: ${report.congregations.join('; ')}`,{after:4}));
  if(noteLines.length){mainBlocks.push(heading('Site visit notes'));for(const text of noteLines)mainBlocks.push(block(text,{size:11.5,leading:15,bullet:true,after:3}));}
  if(report.publicSummary)mainBlocks.push(heading('Saved public summary'),block(report.publicSummary,{leading:15,after:8}));
  if(textWarning)mainBlocks.push(heading('Text notice'),block('Some characters could not be printed and appear as ?. The original PDF notes and photo captions are unchanged.',{size:10,leading:14,color:muted}));

  // A flow remembers every line that remains. Page/column breaks never truncate
  // a location name, address, note, or caption to make it fit the overview.
  const makeFlow=blocks=>({blocks:blocks.filter(b=>b.text.trim()),index:0,line:0,lines:null,splitBlock:false});
  const hasMore=flow=>flow.index<flow.blocks.length;
  function fillColumn(page,x,top,width,bottom,flow) {
    let y=top;
    while(hasMore(flow)) {
      const item=flow.blocks[flow.index],indent=item.bullet?13:0;
      let splitFollowing=false;
      if(!flow.lines)flow.lines=wrapText(item.text,item.font,item.size,width-indent);
      if(!flow.line) {
        const next=flow.blocks[flow.index+1];
        const whole=item.leading*flow.lines.length+item.after;
        const nextHeight=next?.bullet?next.leading*wrapText(next.text,next.font,next.size,width-13).length+next.after:next?.size;
        const pairFits=next&&item.before+whole+next.before+nextHeight<=bodyTop-bodyBottom;
        // A near-column-length note can fit by itself but not with its heading.
        // In that case retain its first line here, then allow the note to split.
        splitFollowing=Boolean(item.heading&&next?.bullet&&!pairFits);
        const keep=item.heading&&next?whole+next.before+(pairFits?nextHeight:next.size):
          item.bullet&&!flow.splitBlock&&whole<=bodyTop-bodyBottom?whole:item.size;
        if(y-item.before-keep<bottom)break;
        y-=item.before;
      }
      while(flow.line<flow.lines.length&&y-item.size>=bottom) {
        const text=flow.lines[flow.line],baseline=y-item.size;
        if(item.bullet&&flow.line===0)page.drawCircle({x:x+2.5,y:baseline+4.3,size:1.65,color:navy});
        drawText(page,text,x+indent,baseline,item.size,item.font,item.color);
        y-=item.leading;flow.line++;
      }
      if(flow.line<flow.lines.length)break;
      y-=item.after;flow.index++;flow.line=0;flow.lines=null;flow.splitBlock=splitFollowing;
    }
    return y;
  }
  function continueFlow(flow,section) {
    const width=(contentWidth-gap)/2;
    while(hasMore(flow)) {
      const page=addPage(section,true),before=[flow.index,flow.line];
      fillColumn(page,margin,bodyTop,width,bodyBottom,flow);
      if(hasMore(flow))fillColumn(page,margin+width+gap,bodyTop,width,bodyBottom,flow);
      if(flow.index===before[0]&&flow.line===before[1])throw Error('The location text could not be laid out. Shorten its longest heading and try again.');
    }
  }

  // Decode in the original selection order. Reordering the overview changes
  // placement only; it never writes to the photo library or drops another image.
  const images=[];
  for(const [index,photo]of selected.entries()) {
    const blob=await loadImage(photo);
    if(!blob||typeof blob.arrayBuffer!=='function')throw Error('A selected photo could not be loaded. No incomplete PDF was created.');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.length<3||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw Error('A selected photo is not a valid JPEG. No incomplete PDF was created.');
    const embedded=await pdf.embedJpg(bytes);
    if(![embedded.width,embedded.height].every(value=>Number.isFinite(value)&&value>0))throw Error('A selected photo has an invalid size. No incomplete PDF was created.');
    images.push({photo,embedded,number:index+1});
  }
  const chosen=images.find(item=>String(item.photo.id)===String(overviewPhotoId))||images.find(item=>item.photo.category==='exterior')||images[0];
  const ordered=chosen?[chosen,...images.filter(item=>item!==chosen)]:[];
  const captionOverflow=[];
  function photoCard(page,item,box,overview=false) {
    const caption=String(item.photo.caption||''),category=item.photo.category==='interior'?'Interior':'Exterior';
    const captionSize=9.5,captionLeading=11.5,labelHeight=12;
    let lines=caption?wrapText(caption,regular,captionSize,box.width):[];
    const maxLines=Math.max(1,Math.floor((box.height-Math.min(96,box.height*.63)-labelHeight-5)/captionLeading));
    if(lines.length>maxLines) {
      captionOverflow.push(heading(`Photo ${item.number} - ${category}`),block(caption,{size:11,leading:15,after:10}));
      lines=['Full caption follows.'];
    }
    const captionHeight=labelHeight+lines.length*captionLeading;
    const imageBox={x:box.x,y:box.y+captionHeight+5,width:box.width,height:box.height-captionHeight-5};
    if(imageBox.height<40)throw Error('A selected photo could not fit its page. Shorten the caption and try again.');
    page.drawRectangle({...imageBox,color:pale,borderColor:lineColor,borderWidth:.5});
    const scale=Math.min(imageBox.width/item.embedded.width,imageBox.height/item.embedded.height);
    const width=item.embedded.width*scale,height=item.embedded.height*scale;
    page.drawImage(item.embedded,{x:imageBox.x+(imageBox.width-width)/2,y:imageBox.y+(imageBox.height-height)/2,width,height});
    let y=imageBox.y-labelHeight;
    drawText(page,`${overview?'Overview - ':''}${category} | Photo ${item.number}`,box.x,y,8.5,bold,navy);
    for(const line of lines){y-=captionLeading;drawText(page,line,box.x,y,captionSize,regular,muted);}
  }

  const first=addPage('Site visit'),flow=makeFlow(mainBlocks);
  if(ordered.length) {
    fillColumn(first,margin,bodyTop,leftWidth,bodyBottom,flow);
    const height=contentTop-bodyBottom,firstImages=ordered.slice(0,3);
    if(firstImages.length===1)photoCard(first,firstImages[0],{x:rightX,y:bodyBottom,width:rightWidth,height},true);
    else {
      const photoGap=12,heroHeight=height*.61,lowerHeight=height-heroHeight-photoGap;
      photoCard(first,firstImages[0],{x:rightX,y:bodyBottom+lowerHeight+photoGap,width:rightWidth,height:heroHeight},true);
      const width=(rightWidth-photoGap)/2;
      firstImages.slice(1).forEach((item,index)=>photoCard(first,item,{x:firstImages.length===2?rightX+(rightWidth-width)/2:rightX+index*(width+photoGap),y:bodyBottom,width,height:lowerHeight}));
    }
  } else {
    const width=(contentWidth-gap)/2;
    fillColumn(first,margin,bodyTop,width,bodyBottom,flow);
    if(hasMore(flow))fillColumn(first,margin+width+gap,bodyTop,width,bodyBottom,flow);
  }
  flow.blocks.push(...captionOverflow.splice(0));
  continueFlow(flow,'Site visit - continued');

  // Two large supporting photos per page keep the remaining views useful on
  // screen and in print. The opening collage already contains its three images.
  for(let index=3;index<ordered.length;index+=2) {
    const page=addPage('Location photos',true),items=ordered.slice(index,index+2),width=(contentWidth-gap)/2,height=bodyTop-bodyBottom;
    items.forEach((item,column)=>photoCard(page,item,{x:items.length===1?(W-650)/2:margin+column*(width+gap),y:bodyBottom,width:items.length===1?650:width,height}));
  }
  if(captionOverflow.length)continueFlow(makeFlow(captionOverflow),'Photo captions');

  const pages=pdf.getPages();
  for(const [index,page]of pages.entries()) {
    page.drawLine({start:{x:margin,y:footerLineY},end:{x:W-margin,y:footerLineY},thickness:.55,color:lineColor});
    drawText(page,shortLabel(`Location ${report.marker||report.id}`,regular,8.5,220)+` | ${index+1} / ${pages.length}`,margin,footerY,8.5,regular,muted);
    const label=`Prepared ${exported}${selected.length?' | '+(source==='shared'?'Shared photo library':'Photos from this device'):''}`;
    drawText(page,label,W-margin-regular.widthOfTextAtSize(printable(label,regular),8.5),footerY,8.5,regular,muted);
  }
  ribbons.drawAllPages();
  const slug=report.name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'location';
  return {blob:new Blob([await pdf.save()],{type:'application/pdf'}),filename:`${slug}-location-photos.pdf`,pages:pages.length,textWarning};
}
