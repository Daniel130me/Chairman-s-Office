const notifications=Object.freeze({
 'colleague-message':{title:'New business message',body:'A colleague sent you a business update. Open Chairman’s Office to reply.'},
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
 'travel-booking-confirmed':{title:'Travel booking confirmed',body:'A travel booking has been confirmed in your office.'}
});
export const pushEventKinds=Object.freeze(Object.keys(notifications));
export function notificationForEvent(kind){return notifications[kind]||null;}
