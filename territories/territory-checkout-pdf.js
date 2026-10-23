import {checkoutOptions} from './territory-checkout-model.js?v=checkout-20261023-51';
export const CHECKOUT_LOGO = new URL('../assets/denver-2027-territory-logo.png', import.meta.url).href;
const LIBRARY = new URL('../load-tests/vendor/pdf-lib.min.js', import.meta.url).href;
let library;
export function loadCheckoutLibrary(d = globalThis.document, w = globalThis.window) {
  if (w.PDFLib?.PDFDocument) return Promise.resolve(w.PDFLib);
  if (library) return library;
  library = new Promise((resolve,reject) => {
    const script = d.createElement('script'); script.src = LIBRARY;
    const timer = setTimeout(() => finish(Error('The PDF library timed out. Please try again.')), 15000);
    const finish = error => {clearTimeout(timer); script.onload = script.onerror = null; if (error) {script.remove(); reject(error);} else resolve(w.PDFLib);};
    script.onload = () => finish(w.PDFLib?.PDFDocument ? null : Error('The PDF library could not start.'));
    script.onerror = () => finish(Error('The PDF library could not load. Please retry.'));
    d.head.append(script);
  }).catch(error => {library = null; throw error;});
  return library;
}
function printable(value, font) {
  return [...String(value ?? '').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()]
    .map(ch => {try {font.encodeText(ch); return ch;} catch {return '?';}}).join('');
}
function wrap(value, font, size, width) {
  const output = []; let line = '';
  for (const ch of printable(value,font)) {
    if (line && font.widthOfTextAtSize(line+ch,size) > width) {
      const split = line.lastIndexOf(' ');
      if (split > 0) {output.push(line.slice(0,split)); line = line.slice(split+1);}
      else {output.push(line); line = '';}
    }
    line += ch;
  }
  if (line) output.push(line);
  return output;
}
export async function buildCheckoutPdf(roster, options = {}, {PDFLib, logoBytes, now = new Date()} = {}) {
  if (!roster?.hall?.id || !Array.isArray(roster.rows)) throw Error('The meeting-place territory list is incomplete.');
  if (!PDFLib?.PDFDocument || !logoBytes?.length) throw Error('The PDF library or convention logo is unavailable. Please retry.');
  const config = checkoutOptions(options), {PDFDocument, StandardFonts, rgb} = PDFLib;
  const doc = await PDFDocument.create(), normal = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), logo = await doc.embedPng(logoBytes);
  const navy = rgb(.13,.25,.40), muted = rgb(.36,.41,.47), gray = rgb(.71,.76,.81), pale = rgb(.96,.97,.98), white = rgb(1,1,1);
  const safe = (value,font=normal) => printable(value,font);
  const rows = roster.rows.map(row => ({...row}));
  rows.push(...Array.from({length:config.blankRows}, () => null));
  if (!rows.length) throw Error('No territories are available. Load territories or choose extra blank lines.');
  if (rows.length > 1000) throw Error('This register is too large. Select one congregation to print a smaller sheet.');
  const widths = [106,190,62,62,62,64,190], left = 28, tableWidth = 736;
  const rowHeight = row => Math.max(36, row ? wrap(row.name,bold,9,widths[0]-12).length*11 + wrap(row.congregation,normal,7,widths[0]-12).length*9 + 10 : 36);
  const pages = []; let current = [], used = 0;
  for (const row of rows) {
    const height = rowHeight(row);
    if (height > 360) throw Error('A territory label is too long to fit on the sheet. Shorten its name.');
    if (current.length && used + height > 360) {pages.push(current); current = []; used = 0;}
    current.push({row,height}); used += height;
  }
  if (current.length) pages.push(current);
  const stamp = new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}).format(now)+' MT';
  doc.setTitle(`${roster.hall.name} - Territory check-out and check-in`);
  doc.setSubject('Denver 2027 meeting-place territory issue and return register'); doc.setCreationDate(now);
  const text = (page,value,x,y,size=9,font=normal,color=navy) => page.drawText(safe(value,font),{x,y,size,font,color});
  const rule = (page,x1,y1,x2,y2,color=gray,width=.6) => page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:width,color});
  for (let p = 0; p < pages.length; p++) {
    const page = doc.addPage([792,612]);
    const mark = logo.scale(Math.min(135/logo.width,72/logo.height)); page.drawImage(logo,{x:left,y:525,width:mark.width,height:mark.height});
    text(page,'TERRITORY CHECK-OUT / CHECK-IN',182,578,18,bold);
    let hy = 557;
    for (const line of wrap(roster.hall.name,bold,11,582)) {text(page,line,182,hy,11,bold); hy -= 13;}
    for (const line of wrap(roster.hall.address,normal,9,582)) {text(page,line,182,hy,9,normal,muted); hy -= 11;}
    const scope = roster.congregation ? `Congregation: ${roster.congregation}` : 'All congregations at this meeting place';
    for (const line of wrap(scope,normal,9,582)) {text(page,line,182,hy,9,normal,muted); hy -= 11;}
    if (hy < 503) throw Error('The meeting-place heading is too long. Shorten the location name or congregation label.');
    rule(page,left,509,764,509);
    const showDate = config.date ? config.date.slice(5,7)+'/'+config.date.slice(8,10)+'/'+config.date.slice(0,4) : '________________';
    text(page,`Activity date: ${showDate}`,left,491,10,bold);
    const sessionText=`Session / wave: ${config.session || '________________________________'}`;
    text(page,sessionText,255,491,Math.min(10,10*509/normal.widthOfTextAtSize(safe(sessionText),10)));
    const coordinatorText=`Coordinator: ${config.coordinator || '___________________________________'}`;
    text(page,coordinatorText,left,472,Math.min(10,10*500/normal.widthOfTextAtSize(safe(coordinatorText),10)));
    text(page,`${roster.rows.length ? roster.rows.length+' territories listed' : 'Blank write-in register'}  |  Page ${p+1} of ${pages.length}`,545,472,9,normal,muted);
    const top = 454, headHeight = 27; page.drawRectangle({x:left,y:top-headHeight,width:tableWidth,height:headHeight,color:navy});
    const headings = ['Territory / host','Assigned to / phone','Time out','Due back','Time in','C / P / N','Remaining work / notes'];
    let x=left;
    headings.forEach((heading,i) => {text(page,heading,x+6,top-17,9,bold,white); x+=widths[i];});
    let y=top-headHeight;
    const entries = [...pages[p]];
    let available = entries.reduce((sum,e) => sum+e.height,0);
    while (available + 36 <= 360) {entries.push({row:null,height:36}); available+=36;}
    for (const {row,height} of entries) {
      const bottom=y-height;
      if (row) page.drawRectangle({x:left,y:bottom,width:widths[0],height,color:pale});
      if (row) {
        let ry=y-13;
        for (const line of wrap(row.name,bold,9,widths[0]-12)) {text(page,line,left+6,ry,9,bold); ry-=11;}
        for (const line of wrap(row.congregation,normal,7,widths[0]-12)) {text(page,line,left+6,ry,7,normal,muted); ry-=9;}
      }
      if(row?.needsReview) text(page,'Review before issue',left+546+6,y-13,8,bold,muted);
      rule(page,left,bottom,764,bottom); x=left;
      for (const width of widths) {rule(page,x,y,x,bottom); x+=width;}
      rule(page,764,y,764,bottom);
      // Two clear writing lines for the person responsible and their phone.
      const personX=left+widths[0]+6;
      text(page,'Name:',personX,y-12,7,normal,muted); rule(page,personX+25,y-15,personX+widths[1]-12,y-15);
      text(page,'Phone:',personX,bottom+8,7,normal,muted); rule(page,personX+25,bottom+5,personX+widths[1]-12,bottom+5);
      y=bottom;
    }
    text(page,'Issued: ______    Returned: ______    Outstanding: ______    Checked by: __________________________',left,51,9,bold);
    text(page,'C = Complete   P = Partial   N = Not worked. Record unworked streets/homes in notes. Follow the territory avoid-address instructions.',left,36,8,normal,muted);
    text(page,`Prepared ${stamp}  |  Location ID: ${roster.hall.id}  |  Paper register - entries do not update the website.`,left,21,7,normal,muted);
  }
  const name=safe(roster.hall.name).replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'meeting-place';
  return {blob:new Blob([await doc.save()],{type:'application/pdf'}),filename:`${name}${config.date?'-'+config.date:''}-territory-check-out-in.pdf`,pages:pages.length};
}
