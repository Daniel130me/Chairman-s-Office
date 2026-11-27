import test from 'node:test';
import assert from 'node:assert/strict';
import {disposalBlockers} from '../lib/subsidiary-disposal.mjs';
test('disposal blockers preserve tenant and company perimeter and return actionable counts',async()=>{
 const ids=['company-a','company-b'],calls=[];
 const q=async(sql,params)=>{calls.push(sql);assert.deepEqual(params,['tenant-a',ids]);assert.match(sql,/WHERE user_id=\$1 AND .*ANY\(\$2::uuid\[\]\)/);return [{n:sql.includes('FROM employment_records')?3:sql.includes('FROM purchase_orders')?2:0}];};
 assert.deepEqual(await disposalBlockers(q,'tenant-a',ids),[{label:'active employees',count:3},{label:'open purchase orders',count:2}]);assert.equal(calls.length,15);
});
