import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1Ijoibml0aW5uZWwiLCJhIjoiY21odm5hYzR1MGNpcTJqcTRwbmQ3eDJ1biJ9.S6326raylncQDe2mwTmgTA';

const map = new mapboxgl.Map({
  container:'map',
  style:'mapbox://styles/mapbox/streets-v12',
  center:[-71.09415,42.36027],
  zoom:12,
  minZoom:5,
  maxZoom:18
});


const BOSTON='https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?outSR=%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D';
const CAMBRIDGE='https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const STATIONS='https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const TRIPS='https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

const svg=d3.select('#map').select('svg');
const radiusScale=d3.scaleSqrt().domain([0,1]).range([0,25]);
let timeFilter=-1;


function getCoords(s){const p=map.project([+s.lon,+s.lat]);return{cx:p.x,cy:p.y};}
function minutesSinceMidnight(d){return d.getHours()*60+d.getMinutes();}
function formatTime(m){return new Date(0,0,0,0,m).toLocaleString('en-US',{timeStyle:'short'});}


let departuresByMinute=Array.from({length:1440},()=>[]);
let arrivalsByMinute=Array.from({length:1440},()=>[]);

function filterByMinute(arr,m){
  if(m===-1)return arr.flat();
  let min=(m-60+1440)%1440,max=(m+60)%1440;
  return min>max?arr.slice(min).concat(arr.slice(0,max)).flat():arr.slice(min,max).flat();
}

function computeStationTraffic(stations,m=-1){
  const dep=filterByMinute(departuresByMinute,m);
  const arr=filterByMinute(arrivalsByMinute,m);
  const depCt=d3.rollup(dep,v=>v.length,d=>d.start_station_id);
  const arrCt=d3.rollup(arr,v=>v.length,d=>d.end_station_id);
  return stations.map(s=>{
    const id=s.short_name;
    s.departures=depCt.get(id)||0;
    s.arrivals=arrCt.get(id)||0;
    s.totalTraffic=s.departures+s.arrivals;
    return s;
  });
}

map.on('load',async()=>{

  map.addSource('boston',{type:'geojson',data:BOSTON});
  map.addLayer({id:'boston-lanes',type:'line',source:'boston',
    paint:{'line-color':'#32D400','line-width':3,'line-opacity':0.4}});
  map.addSource('cambridge',{type:'geojson',data:CAMBRIDGE});
  map.addLayer({id:'cambridge-lanes',type:'line',source:'cambridge',
    paint:{'line-color':'#32D400','line-width':3,'line-opacity':0.4}});


  const json=await d3.json(STATIONS);
  let stations=json.data.stations;

  const circles=svg.selectAll('circle')
    .data(stations,d=>d.short_name)
    .enter().append('circle')
    .attr('r',5)
    .attr('stroke','white')
    .style('--departure-ratio',0.5)
    .each(function(){d3.select(this).append('title').text('Loading…');});

  function updatePositions(){
    circles.attr('cx',d=>getCoords(d).cx).attr('cy',d=>getCoords(d).cy);
  }
  map.on('move',updatePositions);
  map.on('zoom',updatePositions);
  map.on('resize',updatePositions);
  updatePositions();

  await d3.csv(TRIPS,t=>{
    t.started_at=new Date(t.started_at);
    t.ended_at=new Date(t.ended_at);
    departuresByMinute[minutesSinceMidnight(t.started_at)].push(t);
    arrivalsByMinute[minutesSinceMidnight(t.ended_at)].push(t);
    return t;
  });

  stations=computeStationTraffic(stations,-1);
  radiusScale.domain([0,d3.max(stations,d=>d.totalTraffic)]);

  circles.attr('r',d=>radiusScale(d.totalTraffic))
    .attr('fill', d => {
  const ratio = d.totalTraffic ? d.departures / d.totalTraffic : 0.5;
  const dep = d3.color('oklch(65% 0.15 250)');  
  const arr = d3.color('oklch(70% 0.22 50)');   

  const mix = d3.interpolateLab(arr, dep)(ratio);
  return mix;
})
    .each(function(d){
      d3.select(this).select('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  const slider=document.getElementById('time-slider');
  const sel=document.getElementById('selected-time');
  const any=document.getElementById('any-time');
  let timer;

  function updateScatter(current){
    const filtered=computeStationTraffic(stations,current);
    radiusScale.range(current===-1?[0,25]:[3,50]);
    radiusScale.domain([0,d3.max(filtered,d=>d.totalTraffic)]);
    circles.data(filtered,d=>d.short_name)
      .join('circle')
      .attr('r',d=>radiusScale(d.totalTraffic))
      .attr('fill', d => {
  const ratio = d.totalTraffic ? d.departures / d.totalTraffic : 0.5;
  const dep = d3.color('oklch(65% 0.15 250)');  
  const arr = d3.color('oklch(70% 0.22 50)');   

  const mix = d3.interpolateLab(arr, dep)(ratio);
  return mix;
})
      .each(function(d){
        d3.select(this).select('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });
    updatePositions();
  }

  slider.addEventListener('input',()=>{
    const v=+slider.value;
    timeFilter=v;
    if(v===-1){sel.textContent='';any.style.display='inline';}
    else{sel.textContent=formatTime(v);any.style.display='none';}
    clearTimeout(timer);
    timer=setTimeout(()=>updateScatter(v),150);
  });

  updateScatter(-1);
});
