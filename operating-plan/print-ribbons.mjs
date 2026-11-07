import {mountPrintRibbons,waitForPrintRibbons} from '../assets/pdf-ribbons.mjs?v=ribbons-20261107-1';

const installed=new WeakMap();
// The plan is a compiled React app. Guard its two translated print labels,
// then replay just that click so the existing image and print flow stays intact.
export function installOperatingPlanPrintGuard(d=globalThis.document,{wait=waitForPrintRibbons}={}){
  if(!d?.body)return;
  if(installed.has(d))return installed.get(d);
  mountPrintRibbons(d);
  const pending=new WeakSet(),replay=new WeakSet();
  const onClick=async event=>{
    const button=event.target?.closest?.('.toolbar-actions button');
    if(!button||!['Print / PDF','Imprimir / PDF'].includes(button.textContent.trim()))return;
    if(replay.has(button)){replay.delete(button);return;}
    if(button.disabled)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(pending.has(button))return;
    const book=d.querySelector('.print-book'),busy=button.getAttribute('aria-busy');
    pending.add(button);button.setAttribute('aria-busy','true');
    try{
      await wait(d);
      if(!button.isConnected||button.disabled||!book||book!==d.querySelector('.print-book'))return;
      replay.add(button);button.click();
    }catch(error){
      if(button.isConnected)d.defaultView?.alert(button.textContent.trim()==='Imprimir / PDF'
        ?'No se pudo cargar la cabecera, el pie de página o el diseño de impresión. Compruebe la conexión y vuelva a elegir Imprimir / PDF.'
        :error?.message||'The convention artwork or print layout could not load. Check your connection, then choose Print / PDF again.');
    }finally{
      replay.delete(button);pending.delete(button);
      if(busy===null)button.removeAttribute('aria-busy');else button.setAttribute('aria-busy',busy);
    }
  };
  d.addEventListener('click',onClick,true);
  const remove=()=>{d.removeEventListener('click',onClick,true);installed.delete(d);};
  installed.set(d,remove);return remove;
}
if(globalThis.document)installOperatingPlanPrintGuard();
