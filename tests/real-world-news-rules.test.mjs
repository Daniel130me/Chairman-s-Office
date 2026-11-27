import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalArticleUrl,parseGdeltDate,buildGdeltQuery,normalizeGdeltArticle} from '../lib/real-world-news-rules.mjs';
test('article URLs are restricted to HTTP(S) and tracking parameters are removed',()=>{
 assert.equal(canonicalArticleUrl('https://example.com/story?utm_source=x&keep=1#top'),'https://example.com/story?keep=1');
 assert.equal(canonicalArticleUrl('javascript:alert(1)'),null);
});
test('GDELT timestamps are parsed as UTC',()=>{
 assert.equal(parseGdeltDate('20261126T103000Z').toISOString(),'2026-11-26T10:30:00.000Z');
 assert.equal(parseGdeltDate('invalid'),null);
});
test('news queries include region and company sectors',()=>{
 assert.equal(buildGdeltQuery('Lagos, Nigeria',['Technology','Real Estate']),'"Lagos" ("Technology" OR "Real Estate")');
 assert.match(buildGdeltQuery('Global',[]),/business OR economy/);
});
test('malformed article records are discarded',()=>{
 assert.equal(normalizeGdeltArticle({title:'Missing URL'}),null);
 const article=normalizeGdeltArticle({title:'Market update',url:'https://news.example.com/a?utm_campaign=x',domain:'news.example.com',seendate:'20261126T103000Z'});
 assert.equal(article.url,'https://news.example.com/a');
 assert.equal(article.domain,'news.example.com');
 assert.equal(article.publishedAt.toISOString(),'2026-11-26T10:30:00.000Z');
});
