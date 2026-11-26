const notifications=Object.freeze({
  'colleague-message':{title:'New business message',body:'A colleague sent you a business update. Open Chairman’s Office to reply.',target:'messages'},
 'news-digest':{title:'Market news update',body:'New external business reporting is available in your News app.',target:'news'},
 'missed-call-message':{title:'New missed-call message',body:'Someone left you a message after an unanswered call.',target:'messages'},
 'approval-requested':{title:'Executive approval requested',body:'An executive is waiting for your decision.',target:'approvals'},
 'investigation-opened':{title:'Security or compliance alert',body:'A new investigation needs your attention.',target:'investigations'},
 'competitor-move':{title:'Competitor activity',body:'A competitor has made a move in your market.',target:'intelligence'},
 'task-completed':{title:'Executive task completed',body:'An assigned business task has been completed.',target:'activity'},
 'invoice-issued':{title:'Accounts update',body:'A company invoice has been issued.',target:'finance'},
 'contract-drafted':{title:'Contract ready for review',body:'A new commercial agreement is awaiting review.',target:'deals'},
 'employee-hired':{title:'People update',body:'A new employee has joined one of your companies.',target:'employees'},
 'employee-terminated':{title:'People update',body:'An employment change has been recorded.',target:'employees'},
 'loan-disbursed':{title:'Financing update',body:'Company financing has been disbursed and recorded.',target:'loans'},
 'acquisition-completed':{title:'Acquisition update',body:'A company acquisition has been completed.',target:'acquisitions'},
 'travel-booking-confirmed':{title:'Travel booking confirmed',body:'A travel booking has been confirmed in your office.',target:'travel'},
 'security-incident-reported':{title:'Security incident reported',body:'A new incident report needs your review.',target:'security'},
 'security-incident-investigating':{title:'Investigation update',body:'A security investigation has been updated.',target:'security'},
 'security-incident-resolved':{title:'Incident resolved',body:'A security incident has been marked resolved.',target:'security'},
 'security-incident-false-alarm':{title:'Incident review completed',body:'An incident has been classified as a false alarm.',target:'security'},
 'purchase-order-approved':{title:'Procurement approval',body:'A company purchase order has been approved.',target:'operations'},
 'purchase-order-paid':{title:'Supplier payment recorded',body:'A purchase order payment has been recorded.',target:'operations'},
 'payroll-paid':{title:'Payroll completed',body:'A company payroll run has been recorded.',target:'employees'},
 'loan-approved':{title:'Financing approved',body:'A company financing proposal has been approved.',target:'loans'},
 'loan-repayment':{title:'Loan repayment recorded',body:'A company loan repayment has been recorded.',target:'loans'},
 'acquisition-approved':{title:'Acquisition approved',body:'A proposed company acquisition has been approved.',target:'acquisitions'},
 'contract-active':{title:'Contract activated',body:'A commercial contract has become active.',target:'deals'}
});
export const pushEventKinds=Object.freeze(Object.keys(notifications));
export function notificationForEvent(kind){return notifications[kind]||null;}
