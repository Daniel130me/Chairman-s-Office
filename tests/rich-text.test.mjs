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
