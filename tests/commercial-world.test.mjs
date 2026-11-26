import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommercialProposal,parseCustomerResponse,parsePaymentDecision} from '../lib/commercial-world.mjs';
test('commercial proposals require a title, scope and reason',()=>{assert.equal(parseCommercialProposal({decision:'propose',reason:'fit'}),null);assert.deepEqual(parseCommercialProposal({decision:'defer',reason:'No fit'}),{decision:'defer',reason:'No fit'});assert.equal(parseCommercialProposal({decision:'propose',title:'Service',scope:'Review',reason:'Fit',amount:9000000}).amount,undefined);});
test('customer response may decline and cannot itself create payment',()=>{assert.deepEqual(parseCustomerResponse({decision:'decline',reason:'No need'}),{decision:'decline',reason:'No need'});assert.equal(parseCustomerResponse({decision:'paid',reason:'Sent'}),null);});

test('settlement requires an explicit valid fictional customer decision',()=>{assert.equal(parsePaymentDecision({decision:'paid',reason:'Already sent'}),null);assert.equal(parsePaymentDecision({decision:'pay',reason:''}),null);assert.deepEqual(parsePaymentDecision({decision:'delay',reason:'Request time'}),{decision:'delay',reason:'Request time'});});
