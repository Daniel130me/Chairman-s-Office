import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateHRProposal} from '../lib/hr-world.mjs';
const evidence={job_title:'Analyst',annual_salary:'80000.00',promotionEligible:true};
test('candidate role and salary are anchored to the vacancy, not invented by AI',()=>{
 const candidate=validateHRProposal('recruitment',{name:'Fictional candidate',profile:'Illustrative experience',reason:'Recorded vacancy',salary:'99999999',title:'CEO'},evidence);
 assert.equal(candidate.title,'Analyst');assert.equal(candidate.salary,'80000.00');
 assert.equal(validateHRProposal('recruitment',{name:'Candidate',profile:'Profile'},evidence),null);
});
test('promotion requires recorded eligibility and does not grant executive authority',()=>{
 const raw={reason:'Recorded task counts',development:'Training',recommendation:'promotion-review'};
 assert.equal(validateHRProposal('review',raw,{...evidence,promotionEligible:false}).recommendation,'develop');
 assert.equal(validateHRProposal('review',raw,{...evidence,job_title:'Group CFO'}).recommendation,'develop');
 assert.equal(validateHRProposal('review',raw,evidence).recommendation,'promotion-review');
});
test('voluntary notices cannot be converted into an unauthorized termination',()=>{
 assert.equal(validateHRProposal('resignation',{decision:'notice',reason:'Recorded workload'},evidence).decision,'notice');
 assert.equal(validateHRProposal('resignation',{decision:'fire',reason:'Invalid action'},evidence),null);
});
test('payroll uses employment terms and closed-month overlap, not the active roster',()=>{
 const operations=readFileSync(new URL('../lib/operations.mjs',import.meta.url),'utf8').split('export async function runPayroll')[1].split('export async function operationsSnapshot')[0];
 assert.match(operations,/FROM employment_terms/);
 assert.match(operations,/lead\(t.effective_on\)/);
 assert.match(operations,/calendar.closed/);
 assert.match(operations,/staff.reduce\(\(n,p\)=>n\+cents\(p.gross_pay\)/);
 assert.match(operations,/dueChange/);
});
