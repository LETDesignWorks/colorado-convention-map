import {loadPdfLibrary,printable,wrap} from './results-pdf.mjs?v=rush-pdf-20261109-1';
import {createPdfLibRibbons,loadPdfRibbonAssets,ribbonLayout} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';
import {tripLines,TRIP_NOTE,trafficSource} from './trip-model.mjs?v=hotel-trips-20261109-1';
export async function buildTripPdf(result,{PDFLib,ribbonAssets}={}){
  PDFLib=PDFLib||await loadPdfLibrary();ribbonAssets=ribbonAssets||await loadPdfRibbonAssets();
  const {PDFDocument,StandardFonts,rgb,PDFString}=PDFLib,doc=await PDFDocument.create();
  const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),ribbons=await createPdfLibRibbons(doc,{ribbonAssets});
  const frame=ribbonLayout(612,792),left=38,width=536,bottom=frame.bottom+35,navy=rgb(.03,.25,.45),ink=rgb(.1,.17,.23);let page,y;
  const text=(value,x,yy,size=10,f=font)=>page.drawText(printable(value,f),{x,y:yy,size,font:f,color:ink});
  function newPage(){page=doc.addPage([612,792]);y=792-frame.top-24;page.drawText('DENVER 2027',{x:left,y,size:10,font:bold,color:navy});y-=27;text('Hotel & address trip',left,y,20,bold);y-=24;text(result.traffic?trafficSource(result.traffic):'Rush-hour time pending',left,y,10,bold);y-=27;}
  newPage();
  for(const [label,value] of tripLines(result)){
    const lines=wrap(value,font,10,width);if(y-bottom<Math.min(lines.length*14+31,120))newPage();
    text(label,left,y,10,bold);y-=16;
    for(const line of lines){if(y<bottom+14)newPage();text(line,left,y);y-=14;}y-=12;
  }
  for(const line of wrap(TRIP_NOTE,font,9,width)){if(y<bottom+14)newPage();text(line,left,y,9);y-=13;}
  y-=14;if(y<bottom+14)newPage();text('Open this route in Google Maps',left,y,10,bold);
  page.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[left,y-2,left+200,y+12],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(result.googleUrl)}})));
  doc.getPages().forEach((p,i)=>{page=p;text('Denver time · OSRM / OpenStreetMap · Traffic estimates: © TomTom',left,bottom-20,8);text((i+1)+' / '+doc.getPageCount(),540,bottom-20,8);});
  ribbons.drawAllPages();doc.setTitle('Denver 2027 - Hotel & address trip');
  return{blob:new Blob([await doc.save()],{type:'application/pdf'}),filename:'Denver-2027-Hotel-Address-Trip.pdf'};
}
