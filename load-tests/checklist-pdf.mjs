import {dateText} from './model.mjs?v=20261019-2';
import {timeText} from './report.mjs';
import {workbookFor,CHECKS,LITERATURE} from './workbook.mjs?v=20261019-2';

const assetNames=['brand_sky.png','brand_mountains.png','packaging_photo.png',...LITERATURE.map(l=>l.image)];
export async function fetchChecklistAssets(){
  return Object.fromEntries(await Promise.all(assetNames.map(async name=>{
    const response=await fetch(new URL(`./assets/${name}`,import.meta.url));
    if(!response.ok)throw new Error('The checklist artwork could not load. Check your connection and try again.');
    return [name,new Uint8Array(await response.arrayBuffer())];
  })));
}
// Builds real AcroForm fields, including appearances for printing and saved values.
export async function makeChecklistPdf(test,scope,dirty,{assets,sampleBytes,PDFLib=globalThis.PDFLib}={}){
  if(!PDFLib)throw new Error('The editable PDF tools have not loaded. Reload this page and try again.');
  const {PDFDocument,StandardFonts,rgb,PDFName,PDFString}=PDFLib;
  const pdf=await PDFDocument.create(),form=pdf.getForm();
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const color=hex=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
  const navy=color('#17364B'),teal=color('#247C81'),ink=color('#243B4B'),muted=color('#536575'),line=color('#CCD9DF'),pale=color('#F0F7FC'),white=rgb(1,1,1);
  assets=assets||await fetchChecklistAssets();const images={};
  for(const name of assetNames)images[name]=await (name.endsWith('.jpg')?pdf.embedJpg(assets[name]):pdf.embedPng(assets[name]));
  let page,prefix='',overflow=[],serial=0;const branded=[];
  const clean=value=>Array.from(String(value??'').replace(/[–—]/g,'-').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/\t/g,' ')).map(ch=>{try{regular.encodeText(ch==='\n'?' ':ch);return ch;}catch{return '?';}}).join('');
  function text(value,x,y,size=10,font=regular,c=ink){page.drawText(clean(value),{x,y:792-y,size,font,color:c});}
  function rect(x,y,width,height,fill=pale,border){page.drawRectangle({x,y:792-y-height,width,height,color:fill,...(border?{borderColor:border,borderWidth:.6}:{})});}
  function wrap(value,width,size=10,font=regular){
    const lines=[];
    for(const paragraph of clean(value).split('\n')){
      let row='';for(const word of paragraph.split(/\s+/)){
        if(font.widthOfTextAtSize(`${row} ${word}`.trim(),size)<=width){row=`${row} ${word}`.trim();continue;}
        if(row)lines.push(row);row='';
        for(const char of word){if(font.widthOfTextAtSize(row+char,size)>width){lines.push(row);row='';}row+=char;}
      }lines.push(row);
    }return lines;
  }
  function paragraph(value,x,y,width,size=10,c=ink){const lines=wrap(value,width,size);lines.forEach((s,i)=>text(s,x,y+i*size*1.35,size,regular,c));return lines.length*size*1.35;}
  function heading(value,y){text(value,36,y,11,bold,teal);}
  function newPage(title,subtitle){
    page=pdf.addPage([612,792]);branded.push(page);
    page.drawImage(images['brand_sky.png'],{x:0,y:741.12,width:612,height:50.88});
    page.drawImage(images['brand_mountains.png'],{x:0,y:0,width:612,height:94.523});
    text('DENVER INTERNATIONAL CONVENTION 2027',36,83,8.5,bold,teal);
    const size=Math.min(24,540/bold.widthOfTextAtSize(clean(title),1));text(title,36,111,size,bold,navy);
    text(subtitle||dateText(test.date),36,127,Math.min(9.5,540/regular.widthOfTextAtSize(clean(subtitle||dateText(test.date)),1)),regular,muted);
    rect(36,137,540,.65,line);rect(36,679,540,.65,line);
  }
  function field(key,label,value,x,y,w,h=23,multi=false,size=10){
    if(label)text(label,x,y-5,8.4,regular,muted);
    const f=form.createTextField(`${prefix}${key}`),v=clean(value);
    f.setText(v);if(multi)f.enableMultiline();f.disableScrolling();
    const tooLong=multi?wrap(v,w-8,size).length*size*1.2>h-4:regular.widthOfTextAtSize(v.replaceAll('\n',' '),7)>w-7;
    if(tooLong||(!multi&&v.includes('\n')))overflow.push({label:label||key,value:v});
    const fontSize=multi?size:Math.max(7,Math.min(size,(w-7)/Math.max(regular.widthOfTextAtSize(v||' ',1),1)));
    f.addToPage(page,{x,y:792-y-h,width:w,height:h,font:regular,textColor:ink,backgroundColor:pale,borderColor:color('#8CAFC5'),borderWidth:.55});f.setFontSize(fontSize);
    f.acroField.dict.set(PDFName.of('TU'),PDFString.of(clean(label||key)));return f;
  }
  function check(key,label,value,x,y,size=10.5){
    const f=form.createCheckBox(`${prefix}${key}`);f.acroField.dict.set(PDFName.of('TU'),PDFString.of(clean(label||key)));
    f.addToPage(page,{x,y:792-y-size,width:size,height:size,borderWidth:.7,borderColor:teal,backgroundColor:pale,textColor:navy});
    if(value)f.check();else f.uncheck();
    if(label)text(label,x+19,y+9,9.3);
  }
  function imageFit(name,x,y,w,h){const im=images[name],s=Math.min(w/im.width,h/im.height);page.drawImage(im,{x:x+(w-im.width*s)/2,y:792-y-(h+im.height*s)/2,width:im.width*s,height:im.height*s});}
  function link(url,x,y,w,h){const a=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,792-y-h,x+w,792-y],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}});page.node.addAnnot(pdf.context.register(a));}
  function finishOverflow(site){
    if(!overflow.length)return;const entries=overflow;overflow=[];newPage('Additional notes',`${dateText(test.date)} | ${site.name||'Test coordination'}`);let y=163;
    for(const entry of entries){
      if(y>610){newPage('Additional notes - continued',site.name);y=163;}
      text(entry.label,36,y,10,bold,teal);y+=17;
      for(const row of wrap(entry.value,540,10)){
        if(y>654){newPage('Additional notes - continued',site.name);y=163;}
        text(row,36,y,10);y+=14;
      }y+=16;
    }
  }
  function contacts(site){
    const rows=site.contacts.length?site.contacts:[{role:'Contact',congregation:'',name:'',phone:'',email:'',notes:''}];
    rows.forEach((c,index)=>{
      const slot=index%4;if(!slot)newPage('Contacts & responsibilities',`${dateText(test.date)} | ${site.name||'Test coordination'}`);
      const y=161+slot*125;text(c.role||'Contact',36,y,11,bold,teal);
      field(`contact_${index}_congregation`,'Congregation',c.congregation,36,y+19,264);
      field(`contact_${index}_name`,'Contact name',c.name,312,y+19,264);
      field(`contact_${index}_phone`,'Phone',c.phone,36,y+60,168);
      field(`contact_${index}_email`,'Email',c.email,216,y+60,360);
      field(`contact_${index}_notes`,'Access / assignment notes',c.notes,36,y+99,540,18,false,9);
    });
  }
  function tasks(site){
    site.tasks.forEach((t,index)=>{
      const slot=index%4;if(!slot)newPage('Follow-up checklist',`${dateText(test.date)} | ${site.name||'Test coordination'}`);
      const y=156+slot*126;
      check(`task_${index}_complete`,'',t.status==='Complete',36,y+3);
      field(`task_${index}_title`,'',t.title,55,y,521,28,true,9);
      field(`task_${index}_owner`,'Assigned to',t.owner,36,y+47,252,21,false,9);
      field(`task_${index}_status`,'Status',t.status,300,y+47,138,21,false,9);
      field(`task_${index}_due`,'Due date',t.due,450,y+47,126,21,false,9);
      field(`task_${index}_notes`,'Completion check / follow-up notes',[t.evidence,t.notes].filter(Boolean).join('\n'),36,y+88,540,29,true,8.5);
    });
  }
  const sites=scope==='all'?[test.overall,...test.sites]:[scope==='overall'?test.overall:test.sites.find(s=>s.id===scope)].filter(Boolean);
  if(!sites.length)throw new Error('Choose a location to print.');
  for(const site of sites){
    prefix=`${site.id}_`;overflow=[];
    if(site.id==='overall'){
      newPage('Test coordination',`${dateText(test.date)} | ${test.name}`);
      field('test_name','Test name',test.name,36,166,540,30);
      field('test_notes','Overall notes & decisions',test.notes,36,226,540,410,true);
      contacts(site);tasks(site);finishOverflow(site);continue;
    }
    const b=workbookFor(site),f=b.fields,k=b.checks;
    const bound=(key,x,y,w,h=23,multi=false,label)=>field(key,label??key.replaceAll('_',' '),f[key],x,y,w,h,multi);
    const tick=(key,x,y,label)=>check(key,label??CHECKS.find(c=>c[0]===key)[1],k[key],x,y);
    newPage('Field Service Load Test',`${dateText(test.date)} | Location contacts & confirmation checklist`);
    field('location_name','Meeting point / Kingdom Hall',site.name,36,164,540,29,false,17);
    field('location_address','Address',site.address,36,211,540,24);
    field('territory_provider','Territory congregation',site.territory,36,254,540);
    field('host_congregations','Hosts',site.hosts,36,295,264);
    field('delegate_congregations','Delegates',site.delegates,312,295,264);
    // Same dimensions, color, spacing and typography as the supplied October 24 strip.
    page.drawSvgPath('M 3.28 0 H 536.72 Q 540 0 540 3.28 V 26.24 Q 540 29.52 536.72 29.52 H 3.28 Q 0 29.52 0 26.24 V 3.28 Q 0 0 3.28 0 Z',{x:36,y:792-342,color:navy});
    for(const [x,value,description] of [[48,timeText(site.openTime),'Hall opens; territory delivered'],[242,timeText(site.delegateTime),'Delegates arrive'],[421,site.closeTime?timeText(site.closeTime):(site.closeLabel||'After lunch').toUpperCase(),'Hall closes']]){
      text(value,x,354,Math.min(10,142/bold.widthOfTextAtSize(clean(value),1)),bold,white);text(description,x,365,8.4,regular,white);
    }
    heading('Confirm with the host congregation',397);text('Click a box to add / remove a check mark.',365,397,8,regular,muted);
    ['welcome_ready','presentation_language_confirmed','literature_ready','two_day_of_coordinators_assigned'].forEach((key,i)=>tick(key,36,412+i*22));
    bound('day_of_coordinator_1',36,516,264,22,false,'Brother 1 - name / phone');bound('day_of_coordinator_2',312,516,264,22,false,'Brother 2 - name / phone');
    bound('auditorium_access_contact',36,559,340,22,false,'Auditorium access contact - confirm locally');bound('auditorium_access_phone',388,559,188,22,false,'Access phone');
    tick('opening_closing_shared',36,596);bound('opening_closing_shared_date',450,590,126,21,false,'Shared on');
    bound('auditorium_access_arrangements',36,632,540,31,true,'Entry, key / door, opening and closing arrangements');
    contacts(site);
    newPage('Territory readiness & handoff',`${dateText(test.date)} | ${site.name}`);
    text(site.territory,36,162,10.5,bold,teal);
    bound('territory_contact_name',36,188,340,23,false,'Territory contact');bound('territory_contact_phone',388,188,188,23,false,'Phone');
    heading('Territory counts - confirm for this location',237);
    field('territory_target','Target territories',site.packetTarget,36,263,168);field('homes_per_territory','Target homes per territory',site.doorsPerPacket,222,263,168);
    bound('territory_status_date',408,263,168,23,false,'Status as of');
    [['territories_completed','Completed'],['territories_remaining','Remaining'],['packets_ready','Packets ready']].forEach(([key,label],i)=>bound(key,36+i*186,309,168,23,false,label));
    bound('territory_status_notes',36,355,540,33,true,'Readiness notes / scope / boundaries');
    heading('Territory delivery & handoff',411);
    bound('delivery_contact_name',36,438,340,23,false,'Delivery contact');bound('delivery_contact_phone',388,438,188,23,false,'Phone');
    bound('delivery_date_time',36,484,214,23,false,'Delivery date / time');bound('delivery_receiving_contact',262,484,314,23,false,'Receiving host - name / phone');
    bound('delivery_instructions',36,530,540,28,true,'Delivery / meeting-point instructions');
    ['territory_reviewed','packets_complete','delivery_arrangements_shared'].forEach((key,i)=>tick(key,36,571+i*20));
    bound('needs_concerns_handoff',36,640,540,25,true,'Needs, concerns or outstanding details');

    for(let start=0;start<b.packets.length;start+=25){
      newPage('Territory check-out / check-in',`${dateText(test.date)} | ${site.name}`);
      field(`checkout_brother_${start}`,'Check-out brother - name / phone',f.checkout_brother,36,173,264,22);field(`checkin_brother_${start}`,'Check-in brother - name / phone',f.checkin_brother,312,173,264,22);
      text('One packet per row. Check Returned when the complete packet is received.',36,211,8.8,regular,muted);
      const xs=[36,58,143,283,338,393,440,576],labels=['#','Territory ID','Assigned to / group leader','OUT','IN','Returned','Notes'];
      rect(36,221,540,23,navy);labels.forEach((label,i)=>text(label,xs[i]+4,236,7.8,bold,white));
      b.packets.slice(start,start+25).forEach((row,index)=>{const y=246+index*14.5,n=start+index;text(String(n+1),39,y+10,8);for(const [col,key] of [[1,'territory'],[2,'leader'],[3,'out'],[4,'in'],[6,'notes']])field(`packet_${n}_${key}`,'',row[key],xs[col]+1,y,xs[col+1]-xs[col]-2,13,false,8);check(`packet_${n}_returned`,'',row.returned,409,y+1,10);});
      for(const [i,key,label] of [[0,'packets_total_out','Total out'],[1,'packets_total_returned','Total returned'],[2,'packets_still_out','Still out']])field(`${key}_${start}`,label,f[key],36+i*114,636,102,22);
      field(`packet_log_checked_by_${start}`,'Log checked by',f.packet_log_checked_by,378,636,198,22);
    }
    newPage('Territory packet example','Packaging reference | Confirm the local territory assignment');
    rect(36,152,540,36);text(`For this load test: ${dateText(test.date)}`,48,167,10,bold,teal);text('The weekday labels in the photo illustrate the packaging format.',48,181,8.6,regular,muted);
    imageFit('packaging_photo.png',81,204,450,348);
    heading('Prepare each packet',574);
    ['packet_envelope_ready','packet_overview_visible','packet_documents_together','packet_date_instructions'].forEach((key,i)=>tick(key,36,589+i*20));

    newPage('Literature reference images','Invitation and tract examples | Confirm title, language and quantities locally');
    heading('Meeting invitation',161);imageFit('invitation.jpg',48,183,230,153);
    paragraph(LITERATURE[0].title,311,212,240,16,navy);paragraph('Confirm the selected title and language with the host congregations.',311,266,240,10,muted);
    text('View invitation on jw.org',311,321,10,regular,teal);link(LITERATURE[0].url,36,177,540,169);
    heading('Simple tract examples',376);text('Examples only. The chosen title and quantities remain editable on the next page.',36,394,9,regular,muted);
    LITERATURE.slice(1).forEach((item,i)=>{imageFit(item.image,61+i*179,415,126,188);paragraph(item.title,41+i*179,621,165,11,navy);link(item.url,41+i*179,411,165,245);});

    newPage('Literature & packet details',`${dateText(test.date)} | ${site.name}`);
    paragraph('Review the invitation and tract examples. Confirm the title, language and quantities with the host congregations.',36,163,540,10,muted);
    bound('literature_title',36,220,340,29,false,'Selected literature title / item');bound('literature_language',388,220,188,29,false,'Language / edition');
    [['literature_quantity_needed','Quantity needed'],['literature_quantity_ready','Quantity ready'],['literature_confirmed_date','Confirmed on']].forEach(([key,label],i)=>bound(key,36+i*186,278,168,29,false,label));
    bound('literature_contact',36,336,340,29,false,'Literature contact - name / phone');bound('literature_delivery_time',388,336,188,29,false,'Delivery date / time');
    field('presentation_language','Meeting / presentation language',site.language,36,394,264,26);
    field('tracts_per_packet','Tracts per packet',site.tractsPerPacket,312,394,264,26);
    bound('literature_notes',36,454,540,165,true,'Literature / packet needs or special instructions');
    text('The attached territory is a sample, not an assignment for this meeting point.',36,647,9,regular,muted);

    for(const role of ['Host','Delegate']){
      const rows=b.volunteers.map((row,i)=>({...row,index:i})).filter(row=>row.role===role);
      const congregations=[...new Set(rows.map(row=>row.congregation))];
      for(const congregation of congregations){
        const group=rows.filter(row=>row.congregation===congregation);
        for(let start=0;start<group.length;start+=25){
          newPage(`${role} volunteers`,`${dateText(test.date)} | ${site.name}`);
          field(`roster_${role}_${serial++}_congregation`,'Congregation',congregation,36,172,540,25);
          text('Entry spaces only; confirm volunteer totals locally.',36,216,9,regular,muted);
          rect(36,230,540,23,navy);[['#',40],['Volunteer name',64],['Phone',292],['Responsibility / notes',416]].forEach(([v,x])=>text(v,x,245,8.5,bold,white));
          group.slice(start,start+25).forEach((row,i)=>{const y=255+i*14.5;text(String(start+i+1),40,y+10,8);
            for(const [key,x,w] of [['name',60,225],['phone',289,118],['responsibility',411,165]])field(`volunteer_${row.index}_${key}`,'',row[key],x,y,w,13,false,8.5);
          });
          check(`volunteer_lists_shared_${serial}`,'Volunteer lists shared with the day-of coordinators.',k.volunteer_lists_shared,36,630);
          field(`volunteer_shared_on_${serial}`,'Shared on',f.volunteer_lists_shared_date,36,654,168,19,false,8.5);
          field(`volunteer_shared_by_${serial}`,'Shared by',f.volunteer_lists_shared_by,216,654,360,19,false,8.5);
        }
      }
    }
    newPage('Location notes & planning',`${dateText(test.date)} | ${site.name}`);
    for(const [i,key,label] of [[0,'hostTarget','Host target'],[1,'delegateTarget','Delegate target'],[2,'vehicleTarget','Vehicle target']])field(key,label,site[key],36+i*186,172,168,25);
    for(const [i,key,label] of [[0,'meetingTime','Meeting for service'],[1,'departTime','Departure'],[2,'lunchTime','Lunch']])field(key,label,site[key]?timeText(site[key]):'',36+i*186,225,168,25);
    field('location_notes','Location notes, needs & concerns',site.notes,36,283,540,200,true);
    field('overall_notes','Overall test notes',test.notes,36,515,540,145,true);
    tasks(site);finishOverflow(site);
  }
  if(test.sampleTerritory&&scope!=='overall'){
    if(!sampleBytes)throw new Error('The saved sample territory could not be loaded. Try again before exporting.');
    const sample=await PDFDocument.load(sampleBytes);if(sample.getPageCount()>30)throw new Error('Use a sample territory with 30 pages or fewer.');
    const pages=await pdf.copyPages(sample,sample.getPageIndices());
    for(const p of pages){pdf.addPage(p);const {width,height}=p.getSize();
      p.drawRectangle({x:18,y:height-19,width:width-36,height:16,color:white});
      p.drawText('SAMPLE TERRITORY | Reference only; confirm local assignments.',{x:24,y:height-14,size:8,font:bold,color:teal});
    }
  }
  const total=pdf.getPageCount();branded.forEach(p=>{
    const pageNumber=pdf.getPages().indexOf(p)+1;
    p.drawText(`${dirty?'UNSAVED DRAFT | ':''}Editable checklist. Save the PDF to keep your entries.`,{x:36,y:100,size:7.5,font:regular,color:muted});
    p.drawText(`${pageNumber} of ${total}`,{x:540,y:100,size:8,font:regular,color:muted});
  });
  form.updateFieldAppearances(regular);form.acroForm.dict.set(PDFName.of('NeedAppearances'),pdf.context.obj(false));
  pdf.setTitle(`${test.name} | ${scope==='all'?'All locations':sites[0].name||'Test coordination'} | Editable checklist`);
  pdf.setAuthor('Denver International Convention 2027');pdf.setSubject('Location confirmation, territory handoff, packet log, literature and volunteers');
  return pdf.save();
}
