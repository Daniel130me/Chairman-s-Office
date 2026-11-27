export const contractTransitions=Object.freeze({
 draft:['active','terminated'],
 active:['completed','disputed','terminated'],
 disputed:['active','suspended','terminated'],
 suspended:['disputed','terminated'],
 completed:[],
 terminated:[]
});
export function validPayrollMonth(value){
 return typeof value==='string'&&/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value);
}
export function canTransitionContract(from,to){
 return contractTransitions[from]?.includes(to)===true;
}
