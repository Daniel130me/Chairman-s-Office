const list = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? '').trim();
const normalise = value => clean(value).toLowerCase().replace(/\s+/g, ' ');
const firstDate = (...values) => {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
};
const money = value => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
    : '';
};
const categoryFor = kind => {
  const value = normalise(kind);
  if (/call|message|mail|invite|voicemail/.test(value)) return 'communication';
  if (/meeting|decision|board/.test(value)) return 'meetings';
  if (/invoice|payroll|transaction|loan|acquisition|investment|purchase.order|inventory|payment|ledger|financial/.test(value)) return 'finance';
  if (/employee|employment|hire|terminat|executive.appoint|people/.test(value)) return 'people';
  if (/security|investigation|evidence|fraud|incident/.test(value)) return 'security';
  if (/travel|booking|grant|personal|asset|family/.test(value)) return 'personal';
  if (/competitor|market|news|signal|external/.test(value)) return 'intelligence';
  if (/document|report|memo/.test(value)) return 'documents';
  if (/approval|request/.test(value)) return 'approvals';
  return 'business';
};
const targetFor = category => ({
  communication: 'messages',
  meetings: 'board',
  finance: 'finance',
  people: 'employees',
  security: 'security',
  personal: 'family',
  intelligence: 'intelligence',
  documents: 'documents',
  approvals: 'approvals',
  business: 'operations'
}[category] || 'activity');
const chairmanName = (value, user) => {
  const candidate = normalise(value);
  if (!candidate) return false;
  const known = [user?.id, user?.name, 'chairman', 'the chairman', 'you', "chairman's office", 'chairman’s office']
    .map(normalise).filter(Boolean);
  return known.includes(candidate) || candidate === 'chairman';
};
const needsAttention = status => ['pending', 'failed', 'open', 'in-review', 'reported', 'investigating', 'proposed', 'assigned'].includes(normalise(status));

export function buildActivityFeed(state = {}, user = {}) {
  const items = [];
  const contacts = new Map(list(state.contacts).map(contact => [contact.id, contact]));
  const contactName = id => contacts.get(id)?.name || '';
  const companyName = id => list(state.companies).find(company => company.id === id)?.name || '';
  const meetingMap = new Map(list(state.meetings).map(meeting => [meeting.id, meeting]));
  const turnsByMeeting = new Map();
  for (const turn of list(state.meeting_turns)) {
    const turns = turnsByMeeting.get(turn.meeting_id) || [];
    turns.push(turn);
    turnsByMeeting.set(turn.meeting_id, turns);
  }

  const add = (sourceKey, record, options = {}) => {
    const date = firstDate(options.date);
    const title = clean(options.title);
    if (!date || !title) return;
    const actor = clean(options.actor);
    const participation = options.participation || (chairmanName(actor, user) ? 'you' : 'away');
    const source = options.source || sourceKey;
    const id = options.id || `${sourceKey}:${record?.id || items.length}`;
    const body = clean(options.body);
    items.push({
      id,
      timestamp: date.toISOString(),
      category: options.category || categoryFor(options.kind || sourceKey),
      kind: options.kind || sourceKey,
      title,
      body,
      source,
      actor,
      person: clean(options.person),
      company: clean(options.company),
      status: clean(options.status),
      participation,
      requiresAttention: Boolean(options.requiresAttention),
      target: options.target || targetFor(options.category || categoryFor(options.kind || sourceKey)),
      contactId: options.contactId || record?.contact_id || record?.sender_contact_id || null,
      threadId: options.threadId || record?.thread_id || null,
      meetingId: options.meetingId || record?.meeting_id || null,
      record
    });
  };

  const eventTargets = {
    'colleague-message': 'messages',
    'missed-call-message': 'messages',
    'approval-requested': 'approvals',
    'investigation-opened': 'investigations',
    'competitor-move': 'intelligence',
    'task-completed': 'operations',
    'task-assigned': 'operations',
    'invoice-issued': 'finance',
    'contract-drafted': 'deals',
    'employee-hired': 'employees',
    'employee-terminated': 'employees',
    'employment-opened': 'employees',
    'executive-appointed': 'employees',
    'loan-disbursed': 'loans',
    'loan-approved': 'loans',
    'loan-repayment': 'loans',
    'loan-overdue': 'loans',
    'acquisition-completed': 'acquisitions',
    'acquisition-approved': 'acquisitions',
    'travel-booking-confirmed': 'travel',
    'board-motion-opened': 'board',
    'board-vote-cast': 'board',
    'board-vote-closed': 'board',
    'board-motion-decided': 'board',
    'stakeholder-contact': 'messages',
    'supplier-quote': 'inventory',
    'personal-debt-created': 'family',
    'personal-debt-payment': 'family',
    'personal-upkeep': 'family',
    'travel-refund': 'travel',
    'travel-itinerary-changed': 'travel',
    'hr-proposal': 'employees',
    'hr-review-completed': 'employees',
    'hr-decision': 'employees',
    'hr-recruitment-completed': 'employees',
    'employee-resignation-notice': 'employees',
    'employee-resigned': 'employees',
    'employee-promoted': 'employees',
    'purchase-order-drafted': 'inventory',
    'purchase-order-received': 'inventory',
    'inventory-sale': 'inventory',
    'purchase-order-approved': 'inventory',
    'purchase-order-paid': 'inventory',
    'payroll-paid': 'employees'
  };

  for (const event of list(state.events)) {
    const actor = event.actor_name || event.actor || contactName(event.contact_id) || 'Office';
    const category = categoryFor(event.kind);
    add('world-event', event, {
      id: event.id,
      date: event.created_at,
      kind: event.kind,
      category,
      title: event.title || 'Office event',
      body: event.body,
      source: 'World events',
      actor,
      person: contactName(event.contact_id),
      participation: event.actor_type === 'chairman' || chairmanName(actor, user) ? 'you' : 'away',
      requiresAttention: /approval|missed.call|fraud|security|investigation|urgent|overdue|hr-proposal|resignation-notice/i.test(event.kind || '') || ['high', 'critical'].includes(normalise(event.priority)),
      target: eventTargets[event.kind] || targetFor(category),
      threadId: event.thread_id,
      contactId: event.contact_id
    });
  }

  const audit = state.operations?.auditLog || [];
  for (const entry of list(audit)) {
    const actor = entry.actor_name || entry.actor || entry.actor_type || 'Office';
    const category = categoryFor(entry.entity_type || entry.action);
    const target = /invoice|payroll|transaction|ledger/.test(normalise(entry.entity_type)) ? 'finance'
      : /contract|tender|bid/.test(normalise(entry.entity_type)) ? 'deals'
      : /investigation|evidence/.test(normalise(entry.entity_type)) ? 'investigations'
      : /security|incident/.test(normalise(entry.entity_type)) ? 'security'
      : /employee|employment/.test(normalise(entry.entity_type)) ? 'employees'
      : targetFor(category);
    add('audit', entry, {
      date: entry.created_at,
      kind: 'audit',
      category,
      title: [entry.action, entry.entity_type].filter(Boolean).join(' · ') || 'Recorded office action',
      body: [entry.reason, entry.entity_id ? 'Record updated' : ''].filter(Boolean).join(' · '),
      source: 'Audit trail',
      actor,
      participation: entry.actor_type === 'chairman' || chairmanName(actor, user) ? 'you' : 'away',
      target
    });
  }

  for (const message of list(state.messages)) {
    const incoming = normalise(message.direction) === 'incoming';
    const contact = contactName(message.contact_id) || 'Contact';
    const email = normalise(message.channel) === 'email';
    const voice=['voicemail','voice-note'].includes(message.channel);
    add('message', message, {
      date: message.created_at,
      kind: email ? 'email' : voice ? message.channel : 'message',
      category: 'communication',
      title: incoming
        ? `${email ? 'Email' : voice ? 'Voice message' : 'Message'} from ${contact}`
        : `${email ? 'Email sent to' : voice ? 'Voice message to' : 'Message sent to'} ${contact}`,
      body: [message.subject, message.body].filter(Boolean).join(' — '),
      source: email ? 'Mail' : 'Messages',
      actor: incoming ? contact : user?.name || 'You',
      person: contact,
      participation: incoming ? 'addressed' : 'you',
      requiresAttention: incoming && !message.read_at,
      status: incoming && !message.read_at ? 'Unread' : incoming ? 'Received' : 'Sent',
      target: email ? 'mail' : 'messages',
      contactId: message.contact_id
    });
  }

  for (const call of list(state.colleagueCalls)) {
    const caller=contactName(call.caller_id)||'Colleague',recipient=contactName(call.recipient_id)||'Contact';
    add('colleague-call',call,{date:call.started_at,kind:'colleague-call',category:'communication',title:caller+' called '+recipient,body:call.reason,source:'Colleague calls',actor:caller,person:recipient,status:call.status,participation:'away',target:'messages'});
  }
  for (const message of list(state.worldConversationMessages)) {
    const sender = message.sender_name || contactName(message.sender_contact_id) || 'Colleague';
    add('group-message', message, {
      date: message.created_at,
      kind: 'group-message',
      category: 'communication',
      title: `Team conversation · ${sender}`,
      body: message.body,
      source: 'Team messages',
      actor: sender,
      person: sender,
      participation: chairmanName(sender, user) ? 'you' : 'away',
      target: 'messages',
      contactId: message.sender_contact_id
    });
  }

  for (const call of list(state.calls)) {
    const status = clean(call.status || 'recorded');
    const direction = call.direction || (call.invite_id ? 'incoming' : 'outgoing');
    const contact = contactName(call.contact_id) || 'Contact';
    const incoming = normalise(direction) !== 'outgoing';
    add('call', call, {
      date: call.started_at || call.created_at,
      kind: 'call',
      category: 'communication',
      title: `${incoming ? 'Incoming' : 'Outgoing'} call · ${contact}`,
      body: [call.summary, status].filter(Boolean).join(' · '),
      source: 'Phone',
      actor: incoming ? contact : user?.name || 'You',
      person: contact,
      participation: incoming ? 'addressed' : 'you',
      status,
      requiresAttention: ['missed', 'declined', 'failed'].includes(normalise(status)),
      target: 'phone',
      contactId: call.contact_id
    });
  }

  for (const invite of list(state.invites)) {
    const status = clean(invite.status || 'pending');
    const contact = contactName(invite.contact_id) || 'Executive';
    const title = normalise(status) === 'missed' ? `Missed call · ${contact}`
      : normalise(status) === 'declined' ? `Declined call · ${contact}`
      : normalise(status) === 'pending' ? `Incoming call · ${contact}`
      : invite.subject || `Office invitation · ${contact}`;
    add('invite', invite, {
      date: invite.due_at || invite.created_at,
      kind: 'invite',
      category: 'communication',
      title,
      body: invite.preview || invite.subject || invite.kind || '',
      source: 'Phone',
      actor: contact,
      person: contact,
      participation: 'addressed',
      status,
      requiresAttention: ['pending', 'missed'].includes(normalise(status)),
      target: 'phone',
      contactId: invite.contact_id
    });
  }

  for (const meeting of list(state.meetings)) {
    const turns = turnsByMeeting.get(meeting.id) || [];
    const hasChairmanTurn = turns.some(turn => chairmanName(turn.speaker || contactName(turn.contact_id), user));
    const attendees = list(meeting.attendees).map(attendee => {
      if (typeof attendee === 'string') return contactName(attendee) || attendee;
      return attendee?.name || contactName(attendee?.id) || '';
    }).filter(Boolean);
    const hasChairmanAttendee = attendees.some(name => chairmanName(name, user));
    const completed = normalise(meeting.status) === 'completed';
    add('meeting', meeting, {
      date: completed ? (meeting.start_at || meeting.created_at) : (meeting.created_at || meeting.start_at),
      kind: 'meeting',
      category: 'meetings',
      title: `${completed ? 'Meeting concluded' : 'Meeting scheduled'} · ${meeting.title || 'Executive meeting'}`,
      body: meeting.minutes || (attendees.length ? `Participants: ${attendees.join(', ')}` : meeting.status || ''),
      source: 'Calendar & Boardroom',
      actor: 'Executive office',
      participation: hasChairmanTurn || hasChairmanAttendee ? 'you' : 'away',
      status: meeting.status,
      requiresAttention: normalise(meeting.status) === 'scheduled' && firstDate(meeting.start_at)?.getTime() <= Date.now() + 24 * 60 * 60 * 1000,
      target: 'board',
      meetingId: meeting.id
    });
  }

  for (const turn of list(state.meeting_turns)) {
    const speaker = turn.speaker || contactName(turn.contact_id) || 'Executive';
    const meeting = meetingMap.get(turn.meeting_id);
    add('meeting-turn', turn, {
      date: turn.created_at,
      kind: 'meeting-turn',
      category: 'meetings',
      title: `${meeting?.title || 'Boardroom discussion'} · ${speaker}`,
      body: turn.message,
      source: 'Boardroom transcript',
      actor: speaker,
      person: speaker,
      participation: chairmanName(speaker, user) ? 'you' : 'away',
      target: 'board',
      meetingId: turn.meeting_id
    });
  }

  for (const decision of list(state.decisions)) {
    add('decision', decision, {
      date: decision.created_at,
      kind: 'decision',
      category: 'meetings',
      title: 'Decision recorded',
      body: decision.content,
      source: 'Decisions',
      actor: decision.actor_name || 'Executive office',
      participation: chairmanName(decision.actor_name, user) ? 'you' : 'away',
      target: 'board',
      threadId: decision.thread_id
    });
  }

  for (const document of list(state.documents)) {
    add('document', document, {
      date: document.created_at,
      kind: 'document',
      category: 'documents',
      title: `Document created · ${document.title || 'Untitled document'}`,
      body: [document.kind, contactName(document.contact_id)].filter(Boolean).join(' · '),
      source: 'Documents',
      actor: contactName(document.contact_id) || 'Office',
      target: 'documents',
      threadId: document.thread_id
    });
  }

  for (const tender of list(state.tenders)) {
    add('tender', tender, {
      date: tender.created_at,
      kind: 'tender',
      category: 'business',
      title: `Tender opened · ${tender.title || 'Contract opportunity'}`,
      body: [tender.status, tender.budget ? money(tender.budget) : ''].filter(Boolean).join(' · '),
      source: 'Tenders',
      status: tender.status,
      requiresAttention: ['open', 'evaluating'].includes(normalise(tender.status)),
      target: 'deals'
    });
  }

  for (const bid of list(state.bids)) {
    const contact = contactName(bid.contact_id) || 'Bidder';
    add('bid', bid, {
      date: bid.created_at,
      kind: 'bid',
      category: 'business',
      title: `Bid received · ${contact}`,
      body: [money(bid.amount), bid.weeks ? `${bid.weeks} weeks` : '', bid.status].filter(Boolean).join(' · '),
      source: 'Tenders & Bids',
      actor: contact,
      person: contact,
      status: bid.status,
      requiresAttention: ['submitted', 'under-review'].includes(normalise(bid.status)),
      target: 'deals'
    });
  }

  for (const entry of list(state.economy?.journal)) {
    const actor = entry.actor || 'Finance';
    add('ledger', entry, {
      date: entry.effective_at,
      kind: 'financial-transaction',
      category: 'finance',
      title: `${entry.company_name || companyName(entry.company_id) || 'Company'} · ${entry.kind || 'Ledger entry'}`,
      body: [entry.description, money(entry.amount), actor].filter(Boolean).join(' · '),
      source: 'Company ledger',
      actor,
      company: entry.company_name || companyName(entry.company_id),
      participation: chairmanName(actor, user) ? 'you' : 'away',
      target: 'finance'
    });
  }

  for (const task of list(state.economy?.tasks)) {
    const completed = normalise(task.status) === 'completed';
    add('task', task, {
      date: completed ? (task.completed_at || task.created_at) : task.created_at,
      kind: 'task',
      category: 'people',
      title: `${completed ? 'Task completed' : 'Task assigned'} · ${task.title || 'Executive task'}`,
      body: [task.assignee_name, task.outcome || task.detail].filter(Boolean).join(' · '),
      source: 'Executive tasks',
      actor: task.assignee_name || 'Executive',
      status: task.status,
      requiresAttention: normalise(task.status) === 'assigned' && task.due_at && firstDate(task.due_at)?.getTime() < Date.now(),
      target: 'operations'
    });
  }

  for (const employee of list(state.employees)) {
    add('employment-hired', employee, {
      date: employee.hired_at,
      kind: 'employment',
      category: 'people',
      title: `Joined the organisation · ${employee.name || employee.job_title || 'Employee'}`,
      body: [employee.job_title, employee.company_name].filter(Boolean).join(' · '),
      source: 'People & Culture',
      actor: employee.name || 'Human Resources',
      target: 'employees'
    });
    if (employee.terminated_at) {
      add('employment-ended', employee, {
        date: employee.terminated_at,
        kind: 'employment',
        category: 'people',
        title: `Employment ended · ${employee.name || employee.job_title || 'Employee'}`,
        body: [employee.job_title, employee.termination_reason].filter(Boolean).join(' · '),
        source: 'People & Culture',
        actor: 'Human Resources',
        status: 'terminated',
        target: 'employees'
      });
    }
  }

  const operations = state.operations || {};
  for(const o of list(operations.opportunities))add('commercial-opportunity',o,{date:o.updated_at||o.created_at,kind:'commercial-opportunity',category:'business',title:o.proposal?.title||'Customer opportunity',body:[o.proposal?.reason,o.negotiation?.reason,money(o.proposed_value)].filter(Boolean).join(' · '),source:'Deals',company:o.company_name||companyName(o.company_id),status:o.stage,target:'deals'});
  for(const m of list(operations.milestones))add('commercial-milestone',m,{date:m.updated_at||m.created_at,kind:'commercial-milestone',category:'business',title:'Commercial milestone · '+m.status,body:[money(m.amount),m.payment_decision?.reason].filter(Boolean).join(' · '),source:'Deals',company:companyName(m.company_id),status:m.status,requiresAttention:m.status==='blocked',target:'deals'});
  for (const invoice of list(operations.invoices)) {
    add('invoice-issued', invoice, {
      date: invoice.issued_at,
      kind: 'invoice',
      category: 'finance',
      title: `Invoice issued · ${invoice.invoice_number || invoice.customer_name || 'Customer'}`,
      body: [invoice.company_name, invoice.customer_name, invoice.description, money(invoice.amount), invoice.status].filter(Boolean).join(' · '),
      source: 'Finance',
      company: invoice.company_name,
      status: invoice.status,
      requiresAttention: invoice.status === 'issued' && firstDate(invoice.due_at)?.getTime() < Date.now(),
      target: 'finance'
    });
    if (invoice.paid_at) add('invoice-paid', invoice, {
      date: invoice.paid_at, kind: 'invoice-payment', category: 'finance',
      title: `Invoice paid · ${invoice.invoice_number || invoice.customer_name || 'Customer'}`,
      body: [invoice.company_name, invoice.customer_name, money(invoice.amount)].filter(Boolean).join(' · '),
      source: 'Finance', company: invoice.company_name, status: 'paid', target: 'finance'
    });
  }

  for (const contract of list(operations.contracts)) {
    const updated = firstDate(contract.updated_at)?.getTime() > firstDate(contract.created_at)?.getTime();
    add('contract', contract, {
      date: updated ? contract.updated_at : contract.created_at,
      kind: 'contract',
      category: 'business',
      title: `Contract ${contract.status || 'created'} · ${contract.title || 'Agreement'}`,
      body: [contract.company_name, contract.counterparty, money(contract.value), contract.contract_type].filter(Boolean).join(' · '),
      source: 'Contracts',
      company: contract.company_name,
      status: contract.status,
      requiresAttention: ['disputed', 'draft'].includes(normalise(contract.status)),
      target: 'deals'
    });
  }

  for (const payroll of list(operations.payroll)) {
    add('payroll', payroll, {
      date: payroll.paid_at,
      kind: 'payroll',
      category: 'finance',
      title: `Payroll processed · ${payroll.period_month || 'Payroll period'}`,
      body: [payroll.company_name, money(payroll.total), payroll.employee_count ? `${payroll.employee_count} employees` : ''].filter(Boolean).join(' · '),
      source: 'Payroll',
      company: payroll.company_name,
      status: payroll.status,
      target: 'employees'
    });
  }

  for (const investigation of list(operations.investigations)) {
    add('investigation', investigation, {
      date: investigation.updated_at || investigation.opened_at,
      kind: 'investigation',
      category: 'security',
      title: `Investigation ${investigation.status || 'opened'} · ${investigation.title}`,
      body: [investigation.company_name, investigation.severity, investigation.finding || investigation.allegation].filter(Boolean).join(' · '),
      source: 'Investigations',
      company: investigation.company_name,
      status: investigation.status,
      requiresAttention: ['open', 'in-review'].includes(normalise(investigation.status)) || ['high', 'critical'].includes(normalise(investigation.severity)),
      target: 'investigations'
    });
  }

  for (const evidence of list(operations.evidence)) {
    add('investigation-evidence', evidence, {
      date: evidence.created_at,
      kind: 'evidence',
      category: 'security',
      title: 'Investigation evidence added',
      body: [evidence.evidence_type, evidence.description, evidence.collected_by].filter(Boolean).join(' · '),
      source: 'Investigations',
      actor: evidence.collected_by,
      target: 'investigations'
    });
  }

  for (const order of list(operations.purchaseOrders)) {
    const milestones = [
      ['created_at', 'Purchase order created'],
      ['approved_at', 'Purchase order approved'],
      ['received_at', 'Purchase order received'],
      ['paid_at', 'Purchase order paid']
    ];
    for (const [field, label] of milestones) if (order[field]) add(`purchase-order-${field}`, order, {
      date: order[field],
      kind: 'purchase-order',
      category: 'finance',
      title: `${label} · ${order.po_number || order.vendor_name || 'Order'}`,
      body: [order.company_name, order.vendor_name, order.description, money(order.total), order.status].filter(Boolean).join(' · '),
      source: 'Procurement',
      company: order.company_name,
      status: order.status,
      requiresAttention: field === 'created_at' && order.status === 'draft',
      target: 'operations'
    });
  }

  for (const movement of list(operations.inventoryMovements)) {
    add('inventory-movement', movement, {
      date: movement.created_at,
      kind: 'inventory',
      category: 'finance',
      title: `Inventory ${movement.direction === 'in' ? 'received' : 'issued'} · ${movement.item_name || 'Stock item'}`,
      body: [movement.company_name, movement.quantity ? `Qty ${movement.quantity}` : '', movement.source_type].filter(Boolean).join(' · '),
      source: 'Inventory',
      company: movement.company_name,
      status: movement.direction,
      target: 'inventory'
    });
  }

  for (const loan of list(operations.loans)) {
    for (const [field, label] of [['created_at', 'Loan proposed'], ['approved_at', 'Loan approved'], ['disbursed_at', 'Loan disbursed']]) {
      if (loan[field]) add(`loan-${field}`, loan, {
        date: loan[field], kind: 'loan', category: 'finance',
        title: `${label} · ${loan.lender_name || 'Lender'}`,
        body: [loan.company_name, money(loan.principal), loan.purpose, loan.status].filter(Boolean).join(' · '),
        source: 'Loans', company: loan.company_name, status: loan.status,
        requiresAttention: field === 'created_at' && loan.status === 'draft', target: 'loans'
      });
    }
  }

  for (const payment of list(operations.loanPayments)) {
    add('loan-payment', payment, {
      date: payment.paid_at, kind: 'loan-payment', category: 'finance',
      title: 'Loan repayment recorded',
      body: [money(payment.total_paid), payment.reason].filter(Boolean).join(' · '),
      source: 'Loans', target: 'loans'
    });
  }

  for (const acquisition of list(operations.acquisitions)) {
    for (const [field, label] of [['created_at', 'Acquisition proposed'], ['approved_at', 'Acquisition approved'], ['completed_at', 'Acquisition completed']]) {
      if (acquisition[field]) add(`acquisition-${field}`, acquisition, {
        date: acquisition[field], kind: 'acquisition', category: 'finance',
        title: `${label} · ${acquisition.target_name || 'Target company'}`,
        body: [acquisition.buyer_name, acquisition.target_sector, acquisition.seller_name, money(acquisition.purchase_price), acquisition.status].filter(Boolean).join(' · '),
        source: 'Corporate development', company: acquisition.buyer_name, status: acquisition.status,
        requiresAttention: field === 'created_at' && acquisition.status === 'draft', target: 'acquisitions'
      });
    }
  }

  for (const investment of list(operations.investments)) {
    add('company-investment', investment, {
      date: investment.acquired_at, kind: 'investment', category: 'finance',
      title: `Investment recorded · ${investment.target_name || 'Company'}`,
      body: [investment.investor_name, investment.sector, investment.ownership_percentage ? `${investment.ownership_percentage}% ownership` : '', money(investment.current_value)].filter(Boolean).join(' · '),
      source: 'Corporate investments', company: investment.investor_name, target: 'acquisitions'
    });
  }

  for (const request of list(state.actionRequests)) {
    add('action-request', request, {
      date: request.created_at, kind: 'approval', category: 'approvals',
      title: `Approval requested · ${request.title || request.action_type}`,
      body: [request.requester_name, request.reason, request.company_name].filter(Boolean).join(' · '),
      source: 'Approvals', actor: request.requester_name, person: request.requester_name,
      participation: 'addressed', status: request.status,
      requiresAttention: ['pending', 'failed'].includes(normalise(request.status)), target: 'approvals'
    });
    if (request.decided_at || request.executed_at) add('approval-result', request, {
      date: request.executed_at || request.decided_at, kind: 'approval-result', category: 'approvals',
      title: `Approval ${request.status} · ${request.title || request.action_type}`,
      body: [request.decision_reason, request.last_error].filter(Boolean).join(' · '),
      source: 'Approvals', status: request.status, target: 'approvals'
    });
  }

  for (const trip of list(state.trips)) {
    add('trip', trip, {
      date: trip.created_at,
      kind: 'travel',
      category: 'personal',
      title: `Trip ${trip.status || 'planned'} · ${trip.title || trip.destination}`,
      body: [trip.origin, trip.destination, trip.purpose, trip.trip_type].filter(Boolean).join(' · '),
      source: 'Travel & Lifestyle',
      status: trip.status,
      requiresAttention: trip.status === 'planning',
      target: 'travel'
    });
  }

  for (const booking of list(state.travelBookings)) {
    add('travel-booking', booking, {
      date: booking.booked_at || booking.created_at,
      kind: 'travel-booking',
      category: 'personal',
      title: `Travel booking ${booking.status || 'created'} · ${booking.booking_type || 'Reservation'}`,
      body: [booking.trip_title, booking.provider, booking.description, money(booking.amount)].filter(Boolean).join(' · '),
      source: 'Travel & Lifestyle',
      status: booking.status,
      requiresAttention: booking.status === 'pending',
      target: 'travel'
    });
  }

  for (const incident of list(state.securityIncidents)) {
    add('security-incident', incident, {
      date: incident.updated_at || incident.created_at,
      kind: 'security-incident',
      category: 'security',
      title: `Security incident · ${incident.title}`,
      body: [incident.severity, incident.status, incident.location, incident.description].filter(Boolean).join(' · '),
      source: 'Security',
      status: incident.status,
      requiresAttention: ['reported', 'investigating'].includes(normalise(incident.status)) || ['high', 'critical'].includes(normalise(incident.severity)),
      target: 'security'
    });
  }

  for (const evidence of list(state.securityEvidence)) {
    add('security-evidence', evidence, {
      date: evidence.created_at,
      kind: 'security-evidence',
      category: 'security',
      title: 'Security evidence recorded',
      body: [evidence.evidence_type, evidence.description].filter(Boolean).join(' · '),
      source: 'Security',
      target: 'security'
    });
  }

  for (const grant of list(state.grants)) {
    for (const [field, label] of [['created_at', 'Grant proposed'], ['approved_at', 'Grant approved'], ['paid_at', 'Grant paid']]) {
      if (grant[field]) add(`grant-${field}`, grant, {
        date: grant[field], kind: 'grant', category: 'personal',
        title: `${label} · ${grant.recipient || 'Recipient'}`,
        body: [grant.program, grant.purpose, money(grant.amount), grant.funding_source].filter(Boolean).join(' · '),
        source: 'Philanthropy', status: grant.status,
        requiresAttention: field === 'created_at' && grant.status === 'proposed', target: 'giving'
      });
    }
  }

  for (const transaction of list(state.personalTransactions)) {
    add('personal-transaction', transaction, {
      date: transaction.created_at,
      kind: 'personal-transaction',
      category: 'personal',
      title: `Personal ${transaction.direction || 'account'} · ${transaction.description || 'Transaction'}`,
      body: [transaction.account_name, money(transaction.amount), transaction.source_type].filter(Boolean).join(' · '),
      source: 'Family Office',
      status: transaction.direction,
      target: 'family'
    });
  }

  for (const asset of list(state.personalAssets)) {
    add('personal-asset', asset, {
      date: asset.sold_at || asset.acquired_at,
      kind: 'personal-asset',
      category: 'personal',
      title: `${asset.status === 'sold' ? 'Asset sold' : 'Asset acquired'} · ${asset.name}`,
      body: [asset.category, money(asset.estimated_value), asset.notes].filter(Boolean).join(' · '),
      source: 'Family Office',
      status: asset.status,
      target: 'family'
    });
  }

  for (const investment of list(state.personalInvestments)) {
    add('personal-investment', investment, {
      date: investment.updated_at || investment.purchased_at,
      kind: 'personal-investment',
      category: 'personal',
      title: `Personal investment · ${investment.name}`,
      body: [investment.asset_class, investment.risk_level, money(investment.current_value), investment.status].filter(Boolean).join(' · '),
      source: 'Family Office',
      status: investment.status,
      target: 'family'
    });
  }

  for (const move of list(state.marketMoves)) {
    add('market-move', move, {
      date: move.created_at,
      kind: 'market-move',
      category: 'intelligence',
      title: `Market development · ${move.organization_name || move.contact_name || 'External stakeholder'}`,
      body: [move.move_type, move.description, move.company_name].filter(Boolean).join(' · '),
      source: 'Market intelligence',
      actor: move.contact_name,
      person: move.contact_name,
      company: move.company_name,
      target: 'intelligence'
    });
  }

  for (const news of list(state.realWorldNews)) {
    add('real-world-news', news, {
      date: news.published_at || news.created_at,
      kind: 'external-news',
      category: 'intelligence',
      title: news.title || 'External news report',
      body: [news.domain, news.summary || news.snippet].filter(Boolean).join(' · '),
      source: 'External intelligence',
      status: news.domain,
      target: 'news'
    });
  }

  const deduplicated = [];
  const exact = new Map();
  for (const item of items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) {
    const key = [item.category, normalise(item.title), normalise(item.body), item.timestamp.slice(0, 16)].join('|');
    const previous = exact.get(key);
    if (previous && previous.source !== item.source) {
      previous.source = `${previous.source} · ${item.source}`;
      previous.requiresAttention = previous.requiresAttention || item.requiresAttention;
      continue;
    }
    exact.set(key, item);
    deduplicated.push(item);
  }
  return deduplicated;
}

// Merge older records into the current snapshot without replacing live values.
// Source paths are fixed by the backend registry; reject prototype-like keys.
export function mergeActivityHistory(state,rows){
 const out={...state,economy:{...state.economy},operations:{...state.operations}};
 const groups=new Map();
 for(const item of list(rows)){
  const path=String(item?.source||'').split('.');
  if(path.length>2||path.some(key=>!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)||['constructor','prototype','__proto__'].includes(key)))continue;
  if(path.length===2&&!['economy','operations'].includes(path[0]))continue;
  if(!item.record?.id)continue;
  const key=path.join('.');if(!groups.has(key))groups.set(key,{path,records:[]});
  groups.get(key).records.push(item.record);
 }
 for(const {path,records} of groups.values()){
  const parent=path.length===2?out[path[0]]:out,key=path.at(-1);
  const current=list(parent[key]),byId=new Map(records.map(record=>[record.id,record]));
  for(const record of current)byId.set(record.id,record);
  parent[key]=[...byId.values()];
 }
 return out;
}
