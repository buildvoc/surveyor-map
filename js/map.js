var socket = io(config.host)

mapboxgl.accessToken = 'pk.eyJ1IjoibnlwbGxhYnMiLCJhIjoiSFVmbFM0YyJ9.sl0CRaO71he1XMf_362FZQ'

var color = 'rgb(245, 68, 28)'

var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/nypllabs/cj2gmix25005o2rpapartqm07',
  center: [-73.98579, 40.71571],
  zoom: 13
})

var geojson = {
  type: 'FeatureCollection',
  features: []
}

map.on('load', function () {
  map.addControl(new mapboxgl.NavigationControl())

  map.addSource('submissions', {
    type: 'geojson',
    data: geojson
  })

  map.addLayer({
    id: 'points',
    type: 'symbol',
    source: 'submissions',
    layout: {
      'icon-image': 'marker-15',
      'icon-size': 2
    },
    paint: {
      'icon-color': color
    },
    filter: ['==', 'step', 'location']
  })

  map.addLayer({
    id: 'fields-of-view.fill',
    type: 'fill',
    source: 'submissions',
    paint: {
      'fill-color': color,
      'fill-opacity': 0.5
    },
    filter: [
      'all',
      ['==', '$type', 'Polygon'],
      ['==', 'step', 'bearing']
    ]
  })

  map.addLayer({
    id: 'fields-of-view.line',
    type: 'line',
    source: 'submissions',
    layout: {
      'line-join': 'round',
      'line-cap': 'round'
    },
    paint: {
      'line-color': '#555',
      'line-width': 2
    },
    filter: [
      'all',
      ['==', '$type', 'LineString'],
      ['==', 'step', 'bearing']
    ]
  })

  socket.on('submission', function (data) {
    if (!data || !data.submission || data.task.id !== config.taskId || data.submission.skipped) {
      return
    }

    var features

    if (data.submission.step === 'location') {
      features = [{
        type: 'Feature',
        properties: {
          step: data.submission.step,
          uuid: data.item.id
        },
        geometry: data.submission.data.geometry
      }]

      console.log(features)
    } else if (data.submission.step === 'bearing') {
      var point = data.submission.data.geometry.geometries[0].coordinates
      var lineString = data.submission.data.geometry.geometries[1].coordinates

      features = [
        {
          type: 'Feature',
          properties: {
            step: data.submission.step,
            uuid: data.item.id
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              lineString[0],
              point,
              lineString[1],
            ]
          }
        },
        {
          type: 'Feature',
          properties: {
            step: data.submission.step,
            uuid: data.item.id
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              point,
              lineString[0],
              lineString[1],
              point
            ]]
          }
        }
      ]

    }

    geojson.features = geojson.features.concat(features)

    map.getSource('submissions').setData(geojson)
  })
})

// d3.json(config.host + 'tasks/' + config.taskId + '/submissions/all', function (json) {
//   console.log(json)
// })
