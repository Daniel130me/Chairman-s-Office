const descriptions=Object.freeze({
 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Depositing rime fog',
 51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle',56:'Light freezing drizzle',57:'Dense freezing drizzle',
 61:'Slight rain',63:'Moderate rain',65:'Heavy rain',66:'Light freezing rain',67:'Heavy freezing rain',
 71:'Slight snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains',
 80:'Slight rain showers',81:'Moderate rain showers',82:'Violent rain showers',
 85:'Slight snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with slight hail',99:'Thunderstorm with heavy hail'
});
export function weatherPlace(region){
 const value=String(region??'').split(',')[0].trim();
 return value.length>=2&&!/^(global|international|worldwide)$/i.test(value)?value:null;
}
export function weatherDescription(code){return descriptions[Number(code)]||'Unclassified conditions';}
export function weatherReadings(current,daily,locationName,observedAt,sourceUrl){
 if(!current||!observedAt||!Number.isFinite(new Date(observedAt).getTime()))return [];
 const place=String(locationName||'the selected region');
 const values=[
  ['weather:temperature_c','weather','Temperature in '+place,current.temperature_2m,'°C'],
  ['weather:precipitation_mm','weather','Current precipitation in '+place,current.precipitation,'mm'],
  ['weather:wind_kmh','weather','Wind speed in '+place,current.wind_speed_10m,'km/h'],
  ['weather:code','weather','Weather in '+place+': '+weatherDescription(current.weather_code),current.weather_code,'WMO code'],
  ['weather:rain_probability','weather','Forecast precipitation probability in '+place,daily?.precipitation_probability_max?.[0],'%']
 ];
 return values.filter(x=>x[3]!==null&&x[3]!==undefined&&Number.isFinite(Number(x[3]))).map(([key,type,label,value,unit])=>({key,type,label,value:Number(value),unit,observed:observedAt,url:sourceUrl}));
}
