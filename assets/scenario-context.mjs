const contexts=new Map(),listeners=new Set();
export function registerScenarioContext(name,context){contexts.set(name,context);for(const fn of listeners)fn();return ()=>{if(contexts.get(name)===context)contexts.delete(name);};}
export const scenarioContext=name=>contexts.get(name);
export function onScenarioContext(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
