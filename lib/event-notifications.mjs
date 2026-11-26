const notifications=Object.freeze({
 'colleague-message':{title:'New business message',body:'A colleague sent you a business update. Open Chairman’s Office to reply.'},
 'news-digest':{title:'Market news update',body:'New external business reporting is available in your News app.'},
 'missed-call-message':{title:'New missed-call message',body:'Someone left you a message after an unanswered call.'},
 'approval-requested':{title:'Executive approval requested',body:'An executive is waiting for your decision.'},
 'investigation-opened':{title:'Security or compliance alert',body:'A new investigation needs your attention.'},
 'competitor-move':{title:'Competitor activity',body:'A competitor has made a move in your market.'},
 'task-completed':{title:'Executive task completed',body:'An assigned business task has been completed.'},
 'invoice-issued':{title:'Accounts update',body:'A company invoice has been issued.'},
 'contract-drafted':{title:'Contract ready for review',body:'A new commercial agreement is awaiting review.'},
 'employee-hired':{title:'People update',body:'A new employee has joined one of your companies.'},
 'employee-terminated':{title:'People update',body:'An employment change has been recorded.'},
 'loan-disbursed':{title:'Financing update',body:'Company financing has been disbursed and recorded.'},
 'acquisition-completed':{title:'Acquisition update',body:'A company acquisition has been completed.'},
 'travel-booking-confirmed':{title:'Travel booking confirmed',body:'A travel booking has been confirmed in your office.'},
 'security-incident-reported':{title:'Security incident reported',body:'A new incident report needs your review.'},
 'security-incident-investigating':{title:'Investigation update',body:'A security investigation has been updated.'},
 'security-incident-resolved':{title:'Incident resolved',body:'A security incident has been marked resolved.'},
 'security-incident-false-alarm':{title:'Incident review completed',body:'An incident has been classified as a false alarm.'},
 'purchase-order-approved':{title:'Procurement approval',body:'A company purchase order has been approved.'},
 'purchase-order-paid':{title:'Supplier payment recorded',body:'A purchase order payment has been recorded.'},
 'payroll-paid':{title:'Payroll completed',body:'A company payroll run has been recorded.'},
 'loan-approved':{title:'Financing approved',body:'A company financing proposal has been approved.'},
 'loan-repayment':{title:'Loan repayment recorded',body:'A company loan repayment has been recorded.'},
 'acquisition-approved':{title:'Acquisition approved',body:'A proposed company acquisition has been approved.'},
 'contract-active':{title:'Contract activated',body:'A commercial contract has become active.'}
});
export const pushEventKinds=Object.freeze(Object.keys(notifications));
export function notificationForEvent(kind){return notifications[kind]||null;}
