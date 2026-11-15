export const SERVICE_DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const SERVICE_DAYS_TYPE='congregation-service-days';
export function cleanServiceDays(days){if(!Array.isArray(days)||days.some(day=>!SERVICE_DAYS.includes(day)))throw Error('Choose valid weekdays.');return SERVICE_DAYS.filter(day=>days.includes(day));}
export const serviceDaysId=id=>'congregation-service-days-'+String(id).toLowerCase();
export function serviceDaysPayload(congregation,days){if(!congregation?.id)throw Error('Select a congregation.');return {recordType:SERVICE_DAYS_TYPE,congregationId:String(congregation.id),congregationName:congregation.name,serviceDays:cleanServiceDays(days),updatedBy:'Convention planning team'};}
export function serviceDaysLabel(days){return cleanServiceDays(days||[]).join(', ')||'Not set';}

export const readServiceDays=record=>SERVICE_DAYS.filter(d=>Array.isArray(record?.serviceDays)&&record.serviceDays.includes(d));
