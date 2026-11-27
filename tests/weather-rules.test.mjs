import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherPlace,weatherDescription,weatherReadings} from '../lib/weather-rules.mjs';
test('weather location uses the configured operating region safely',()=>{
 assert.equal(weatherPlace('Lagos, Nigeria'),'Lagos');
 assert.equal(weatherPlace('Global'),null);
 assert.equal(weatherPlace(''),null);
});
test('WMO weather codes become readable business context',()=>{
 assert.equal(weatherDescription(61),'Slight rain');
 assert.equal(weatherDescription(95),'Thunderstorm');
 assert.equal(weatherDescription(999),'Unclassified conditions');
});
test('only observed numeric weather values are persisted with their source',()=>{
 const rows=weatherReadings({time:'2026-11-26T10:00',temperature_2m:28,precipitation:0,wind_speed_10m:14,weather_code:2},{precipitation_probability_max:[35]},'Lagos',new Date('2026-11-26T10:00:00Z'),'https://api.open-meteo.com/test');
 assert.equal(rows.length,5);
 assert.equal(rows[0].label,'Temperature in Lagos');
 assert.equal(rows[3].label,'Weather in Lagos: Partly cloudy');
 assert.equal(rows[4].value,35);
 assert.ok(rows.every(x=>x.source===undefined&&x.url.includes('open-meteo')));
});
