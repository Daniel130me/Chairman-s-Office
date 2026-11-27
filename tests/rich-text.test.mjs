import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRichText,inlineTokens,previewText} from '../frontend/src/rich-text.mjs';
test('executive brief renders title, header and multiline table as structured blocks',()=>{
 const blocks=parseRichText('**Fictional Business Development Brief**\n\n| **Element** | **Details** |\n|-------------|-------------|\n| **Executive** | **Amira Patel** |\n| **Issue** | Strategic acquisition |\n\n- First action\n- Second action');
 assert.deepEqual(blocks.map(b=>b.type),['paragraph','table','list']);
 assert.equal(blocks[1].rows.length,2);
 assert.equal(inlineTokens(blocks[1].header[0])[0].type,'strong');
});
test('single-line flattened executive table is recovered without discarding prefix or suffix',()=>{
 const blocks=parseRichText('**Brief** | **Element** | **Details** | |-------------|-------------| | **Issue** | Acquisition | | **Status** | Review |');
 assert.equal(blocks[0].text,'**Brief**');assert.equal(blocks[1].type,'table');assert.equal(blocks[1].rows[1][1],'Review');
});
test('plain text and escaped pipes remain text; invalid table remains readable',()=>{
 assert.equal(parseRichText('Ordinary message\nwith a new line')[0].text,'Ordinary message\nwith a new line');
 const b=parseRichText('| A | B |\n| --- | --- |\n| a\\|b | c |')[0];assert.equal(b.rows[0][0],'a|b');
 assert.equal(parseRichText('| A | B |\n| --- | --- | --- |')[0].type,'paragraph');
});
test('only safe HTTP links are clickable and raw HTML remains text',()=>{
 assert.equal(inlineTokens('[bad](javascript:alert)')[0].url,null);
 assert.equal(inlineTokens('[source](https://example.com)')[0].url,'https://example.com');
 assert.deepEqual(inlineTokens('<script>alert(1)</script>'),[{type:'text',text:'<script>alert(1)</script>'}]);
 assert.equal(previewText('**Title**\n[Source](https://example.com)'),'Title Source');
});
test('numbered and bullet lists, quotes and headings are structured',()=>{
 const b=parseRichText('# Heading\n\n1. First\n2. Second\n\n• Next\n\n> Quoted');
 assert.deepEqual(b.map(x=>x.type),['heading','list','list','quote']);assert.equal(b[1].ordered,true);assert.equal(b[2].ordered,false);
});

test('provider HTML comparison table keeps all rows and each list inside its cell',()=>{
 const raw='<table><tr><th>Option</th><th>Potential Gains</th><th>Risks / Consequences</th></tr><tr><td>1. Acquire PulseWave</td><td>- Immediate access<br>- Cross-sell opportunities</td><td><ul><li>Overvaluation</li><li>Integration delays</li></ul></td></tr><tr><td>2. Delay</td><td>Better price</td><td>Competitive bid</td></tr></table>';
 const blocks=parseRichText('**Decision brief**\n'+raw+'\n**Recommendation:** Review first.');
 assert.deepEqual(blocks.map(b=>b.type),['paragraph','html-table','paragraph']);
 const t=blocks[1];assert.equal(t.rows.length,3);assert.equal(t.rows[0][1].header,true);
 assert.deepEqual(parseRichText(t.rows[1][1].text)[0].items,['Immediate access','Cross-sell opportunities']);
 assert.deepEqual(parseRichText(t.rows[1][2].text).filter(b=>b.type==='list').flatMap(b=>b.items),['Overvaluation','Integration delays']);
 assert.equal(t.rows[2][2].text,'Competitive bid');
 assert.ok(!previewText(raw).includes('<table>'));
});
test('escaped and incomplete HTML tables recover without injecting arbitrary elements',()=>{
 const b=parseRichText('&lt;table&gt;&lt;tr&gt;&lt;th&gt;Option&lt;/th&gt;&lt;th&gt;Risk&lt;/th&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Delay&lt;/td&gt;&lt;td&gt;Wait &amp; review')[0];
 assert.equal(b.type,'html-table');assert.equal(b.rows[1][1].text,'Wait & review');
 const malicious=parseRichText('<table onclick="evil()"><tr><td colspan="2" onmouseover="evil()"><strong>Review</strong><img src=x onerror=evil()><script>evil()</script></td></tr></table>')[0];
 assert.equal(malicious.rows[0][0].colSpan,2);assert.equal(malicious.rows[0][0].text,'**Review**');assert.ok(!JSON.stringify(malicious).includes('evil'));
});
test('HTML prose, entities and mixed formatting work while code remains literal',()=>{
 const b=parseRichText('<h2>Decision</h2><p><strong>Priority</strong><br>Review &amp; respond</p><ol><li>First</li><li>Second</li></ol>');
 assert.equal(b[0].type,'heading');assert.equal(b[1].text,'**Priority**\nReview & respond');
 assert.deepEqual(b.filter(x=>x.type==='list').flatMap(x=>x.items),['First','Second']);
 assert.equal(parseRichText('~~'+ '~'+'html\n<table><tr><td>literal</td></tr></table>\n~~~')[0].text,'<table><tr><td>literal</td></tr></table>');
});
