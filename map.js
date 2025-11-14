import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1Ijoibml0aW5uZWwiLCJhIjoiY21odm5hYzR1MGNpcTJqcTRwbmQ3eDJ1biJ9.S6326raylncQDe2mwTmgTA';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12', 
  center: [-71.09415, 42.36027], 
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const BOSTON_BIKE_GEOJSON =
  'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?outSR=%7B%22latestWkid%22%3A3857%2C%22wkid%22%3A102100%7D';
const CAMBRIDGE_BIKE_GEOJSON =
  'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson';
const BLUEBIKES_STATIONS =
  'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
const BLUEBIKES_TRIPS_MAR_2024 =
  'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

let timeFilter = -1; 

const radiusScale = d3.scaleSqrt().domain([0, 1]).range([0, 25]); 
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]); 

const svg = d3.select('#map').select('svg');

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    const beforeMidnight = tripsByMinute.slice(minMinute);
    const afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function computeStationTraffic(stations, currentTimeFilter = -1) {
  const depTrips = filterByMinute(departuresByMinute, currentTimeFilter);
  const arrTrips = filterByMinute(arrivalsByMinute, currentTimeFilter);

  const departures = d3.rollup(
    depTrips,
    v => v.length,
    d => d.start_station_id
  );
  const arrivals = d3.rollup(
    arrTrips,
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.short_name; 
    const dep = departures.get(id) ?? 0;
    const arr = arrivals.get(id) ?? 0;
    station.departures = dep;
    station.arrivals = arr;
    station.totalTraffic = dep + arr;
    return station;
  });
}

map.on('load', async () => {
  map.addSource('boston_route', { type: 'geojson', data: BOSTON_BIKE_GEOJSON });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: { 'line-color': '#32D400', 'line-width': 3, 'line-opacity': 0.4 }
  });

  map.addSource('cambridge_route', { type: 'geojson', data: CAMBRIDGE_BIKE_GEOJSON });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: { 'line-color': '#32D400', 'line-width': 3, 'line-opacity': 0.4 }
  });

  const stationsJSON = await d3.json(BLUEBIKES_STATIONS);
  let stations = stationsJSON.data.stations;

  const circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', 5)
    .attr('opacity', 0.8)
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .style('--departure-ratio', 0.5)
    .each(function (d) {
      d3.select(this).append('title').text(`Loading…`);
    });

  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const trips = await d3.csv(
    BLUEBIKES_TRIPS_MAR_2024,
    trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      const sMin = minutesSinceMidnight(trip.started_at);
      const eMin = minutesSinceMidnight(trip.ended_at);
      departuresByMinute[sMin].push(trip);
      arrivalsByMinute[eMin].push(trip);
      return trip;
    }
  );

  stations = computeStationTraffic(stations, -1);

  radiusScale.domain([0, d3.max(stations, d => d.totalTraffic)]);

  circles
    .attr('r', d => radiusScale(d.totalTraffic))
    .style('--departure-ratio', d => stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5))
    .each(function (d) {
      d3.select(this).select('title')
        .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'inline';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  function updateScatterPlot(current) {
    const filteredStations = computeStationTraffic(stations, current);

    if (current === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    const maxNow = d3.max(filteredStations, d => d.totalTraffic);
    if (maxNow > 0) radiusScale.domain([0, maxNow]);

    circles
      .data(filteredStations, d => d.short_name)
      .join('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .style('--departure-ratio', d => stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5))
      .each(function (d) {
        d3.select(this).select('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

    updatePositions();
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
