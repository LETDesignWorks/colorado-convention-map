import {loadPdfLibrary, wrapText, printable} from './traffic-pdf.mjs?v=traffic-20261023-48';

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

export async function buildPhotoPdf({report, photos, loadImage, source = 'device'}, {PDFLib, now = new Date()} = {}) {
  PDFLib ||= await loadPdfLibrary();
  const {PDFDocument, StandardFonts, rgb} = PDFLib, pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(.043,.267,.494), gray = rgb(.32,.37,.43), black = rgb(.08,.1,.14);
  const selected = photos.filter(photo => photo.selected !== false);
  const exported = new Intl.DateTimeFormat('en-US', {timeZone:'America/Denver', dateStyle:'medium', timeStyle:'short'}).format(now) + ' MT';
  pdf.setTitle(`${report.name} - Location photos`); pdf.setAuthor('Colorado Convention Transportation Planning');
  let page, y;
  function newPage() {
    page = pdf.addPage([612,792]); y = 744;
    page.drawText('DENVER 2027  /  BUS ACCESS REVIEW', {x:48,y,size:10,font:bold,color:navy}); y -= 30;
  }
  function text(value, {size=11, font=regular, color=black, after=10} = {}) {
    for (const line of wrapText(value, font, size, 516)) {
      if (y < 70) newPage();
      page.drawText(line, {x:48,y,size,font,color}); y -= size*1.4;
    }
    y -= after;
  }
  newPage();
  text(`${report.marker ? report.marker + '. ' : ''}${report.name}`, {size:23,font:bold,color:navy});
  text(report.address, {size:12});
  text(`Bus access: ${report.status}`, {font:bold});
  text(`Largest bus reviewed: ${report.busSize}`);
  if (report.congregations.length) text(`Congregations / groups: ${report.congregations.join('; ')}`);
  if (report.publicSummary) {text('Saved public summary', {font:bold,color:navy}); text(report.publicSummary);}
  text(`Selected photos: ${selected.filter(p=>p.category==='interior').length} interior / ${selected.filter(p=>p.category==='exterior').length} exterior`, {font:bold});
  text(`Photo source: ${source === 'shared' ? 'Private shared library' : 'This device'}. Generated ${exported}.`, {size:10,color:gray});
  text('This report uses saved location information and selected photos. Unsaved review edits, private contacts, and internal inspection notes are excluded.', {size:10,color:gray});
  text('Planning record only. Verify current property permission, loading arrangements, and bus access on site.', {size:10,color:gray});
  if (selected.length) text('Photos are private planning material. Share this downloaded PDF only with the intended team.', {size:10,color:gray});
  for (let i=0; i<selected.length; i++) {
    const photo = selected[i];
    if (i%2===0) {
      newPage();
      const heading = wrapText(report.name, bold, 13, 516).slice(0,2);
      for (const line of heading) {page.drawText(line,{x:48,y,size:13,font:bold,color:navy}); y-=18;}
    }
    const top = i%2===0 ? 654 : 360;
    page.drawText(`${photo.category === 'interior' ? 'Interior' : 'Exterior'} - Photo ${i+1}`, {x:48,y:top,size:11,font:bold,color:navy});
    const blob = await loadImage(photo);
    if (!blob || blob.type !== 'image/jpeg') throw Error('A selected photo could not be loaded. No incomplete PDF was created.');
    const embedded = await pdf.embedJpg(await blob.arrayBuffer());
    const scale = Math.min(516/embedded.width,210/embedded.height), width = embedded.width*scale, height = embedded.height*scale;
    page.drawRectangle({x:48,y:top-226,width:516,height:214,color:rgb(.96,.97,.98)});
    page.drawImage(embedded,{x:48+(516-width)/2,y:top-224+(210-height)/2,width,height});
    const caption = wrapText(photo.caption || '',regular,10,516);
    for (let n=0;n<caption.length;n++) page.drawText(caption[n],{x:48,y:top-242-n*13,size:10,font:regular,color:gray});
  }
  const pages = pdf.getPages();
  for (let i=0;i<pages.length;i++) {
    pages[i].drawLine({start:{x:48,y:45},end:{x:564,y:45},thickness:.5,color:rgb(.75,.8,.84)});
    pages[i].drawText(printable(`Location ${report.marker || report.id} | ${i+1} / ${pages.length}`,regular),{x:48,y:30,font:regular,size:9,color:gray});
  }
  const slug = report.name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70) || 'location';
  return {blob:new Blob([await pdf.save()],{type:'application/pdf'}),filename:`${slug}-location-photos.pdf`,pages:pages.length};
}
