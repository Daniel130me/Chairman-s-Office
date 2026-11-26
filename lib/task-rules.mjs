export const taskRoles=Object.freeze({
 'financial-review':['Group CFO','Chief Operating Officer','Chief of Staff'],
 'contract-review':['General Counsel','Chief of Staff'],
 'investigation-review':['Internal Audit Director','Chief Security Officer','General Counsel'],
 'employee-review':['Group Human Resources Director','Chief of Staff'],
 'portfolio-review':['Group CFO','Group Strategy Director'],
 'meeting-preparation':['Chief of Staff','Board Chair','Group Strategy Director'],
 'prepare-briefing':['Chief of Staff']
});
export function validTaskType(type){return type==='general'||Object.hasOwn(taskRoles,type);}
export function canAssignTask(type,title){return type==='general'||(taskRoles[type]||[]).includes(title);}
