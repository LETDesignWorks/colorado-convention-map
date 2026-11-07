import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {makeChecklistPdf} from '../load-tests/checklist-pdf.mjs';
import {newTest} from '../load-tests/model.mjs';
import {LITERATURE} from '../load-tests/workbook.mjs';
import {ribbonLayout} from '../assets/pdf-ribbons.mjs';
const require=createRequire(import.meta.url),PDFLib=require('../load-tests/vendor/pdf-lib.min.js');
const {PDFDocument,StandardFonts,rgb,degrees,PDFName,PDFDict}=PDFLib;
const ribbonAssets={header:await readFile(new URL('../assets/print-header-sky.png',import.meta.url)),footer:await readFile(new URL('../assets/print-footer-hills.png',import.meta.url))};
// Neutral illustrations keep this regression focused on printing and field semantics.
const jpeg=Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD26iiirMz/2Q==','base64'));
const assets={'packaging_photo.png':ribbonAssets.header,...Object.fromEntries(LITERATURE.map(x=>[x.image,jpeg]))};
function imageDimensions(pdf,page){
  const resources=page.node.Resources().lookup(PDFName.of('XObject'),PDFDict);
  return resources.values().map(ref=>pdf.context.lookup(ref).dict).filter(dict=>dict.get(PDFName.of('Subtype'))?.toString()==='/Image')
    .map(dict=>[dict.get(PDFName.of('Width')).asNumber(),dict.get(PDFName.of('Height')).asNumber()]);
}

test('branded checklist preserves editable fields and fits rotated reference snapshots without changing the original',async()=>{
  const reference=await PDFDocument.create(),font=await reference.embedFont(StandardFonts.Helvetica),refForm=reference.getForm();
  const expected=[];
  for(const rotation of [0,90,180,270]){
    const p=reference.addPage([612,792]);p.setRotation(degrees(rotation));
    if(rotation===270)p.setCropBox(20,25,572,742);
    const {x,y,width,height}=p.getCropBox();expected.push(rotation===90||rotation===270?[height,width]:[width,height]);
    p.drawRectangle({x:x+4,y:y+4,width:width-8,height:height-8,borderColor:rgb(.7,.1,.1),borderWidth:1});
    p.drawText('REFERENCE '+rotation+' TOP EDGE',{x:x+14,y:y+height-24,size:12,font});
    p.drawText('REFERENCE '+rotation+' BOTTOM EDGE',{x:x+14,y:y+16,size:12,font});
    p.drawText('All original page content remains visible.',{x:x+35,y:y+height/2,size:14,font});
    if(!rotation){const f=refForm.createTextField('reference-only-field');f.setText('REFERENCE FIELD VALUE');f.addToPage(p,{x:60,y:500,width:240,height:30,font});}
  }
  refForm.updateFieldAppearances(font);const sampleBytes=await reference.save(),original=Buffer.from(sampleBytes);
  const plan=newTest('2026-11-07');plan.sites=[];plan.name='Synthetic meeting coordination';
  plan.overall.contacts=[{role:'Coordinator',name:'Fixture coordinator',congregation:'Fixture congregation',phone:'',email:'',notes:''}];
  plan.sampleTerritory={name:'Reference.pdf'};
  const bytes=await makeChecklistPdf(plan,'all',false,{assets,ribbonAssets,sampleBytes,PDFLib});
  assert.deepEqual(Buffer.from(sampleBytes),original);
  const originalAgain=await PDFDocument.load(sampleBytes);assert.equal(originalAgain.getForm().getTextField('reference-only-field').getText(),'REFERENCE FIELD VALUE');
  const pdf=await PDFDocument.load(bytes),form=pdf.getForm(),pages=pdf.getPages();
  assert.equal(form.getTextField('overall_test_name').getText(),plan.name);
  assert.equal(form.getTextField('overall_contact_0_name').getText(),'Fixture coordinator');
  assert.equal(form.getFields().some(f=>f.getName()==='reference-only-field'),false);
  form.getTextField('overall_test_name').setText('Edited coordination title');
  const after=await PDFDocument.load(await pdf.save());assert.equal(after.getForm().getTextField('overall_test_name').getText(),'Edited coordination title');
  assert.equal(pages.length,6);
  for(const [i,p] of pages.entries()){
    const images=imageDimensions(pdf,p);assert.ok(images.some(([w,h])=>w===2048&&h===170),'Header missing on '+i);
    assert.ok(images.some(([w,h])=>w===2048&&h===130),'Footer missing on '+i);
    if(i>=2){assert.equal(p.getRotation().angle,0);assert.deepEqual([p.getWidth(),p.getHeight()],expected[i-2]);}
  }
  for(const field of form.getFields())for(const widget of field.acroField.getWidgets()){
    const rect=widget.getRectangle(),bands=ribbonLayout(612,792);assert.ok(rect.y>bands.bottom);assert.ok(rect.y+rect.height<792-bands.top);
  }
  if(process.env.RIBBON_QA_OUT){await mkdir(process.env.RIBBON_QA_OUT,{recursive:true});await writeFile(process.env.RIBBON_QA_OUT+'/checklist-reference-ribbons.pdf',bytes);await writeFile(process.env.RIBBON_QA_OUT+'/original-reference.pdf',sampleBytes);}
});
