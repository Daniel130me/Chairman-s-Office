import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGoogleNewsRss} from '../lib/real-world-news.mjs';
test('parses RSS headlines with publisher domains and publication dates',()=>{
 const xml=\`<?xml version="1.0"?><rss><channel><item><title>Berlin technology market &amp; hiring update</title><link>https://news.google.com/rss/articles/abc123</link><pubDate>Sat, 28 Nov 2026 10:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item></channel></rss>\`;
 const articles=parseGoogleNewsRss(xml);
 assert.equal(articles.length,1);
 assert.equal(articles[0].title,'Berlin technology market & hiring update');
 assert.equal(articles[0].domain,'www.reuters.com');
 assert.equal(articles[0].language,'en');
 assert.equal(articles[0].publishedAt.toISOString(),'2026-11-28T10:00:00.000Z');
});
