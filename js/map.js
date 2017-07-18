var socket = io(config.host)

mapboxgl.accessToken = 'pk.eyJ1IjoibnlwbGxhYnMiLCJhIjoiSFVmbFM0YyJ9.sl0CRaO71he1XMf_362FZQ'

var color = 'rgb(245, 68, 28)'

var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/nypllabs/cj2gmix25005o2rpapartqm07',
  center: [-73.98579, 40.71571],
  zoom: 13
})

var itemsByUuid = {}

var geojson = {
  type: 'FeatureCollection',
  features: []
}

function toFeatures (data) {
  if (data.submission.step === 'location') {
    return [{
      type: 'Feature',
      properties: {
        step: data.submission.step,
        uuid: data.item.id
      },
      geometry: data.submission.data.geometry
    }]
  } else if (data.submission.step === 'bearing') {
    if (!data.submission.data.distance || data.submission.data.distance > 1000) {
      return
    }

    var point = data.submission.data.geometry.geometries[0].coordinates
    var lineString = data.submission.data.geometry.geometries[1].coordinates

    return [
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
}

function createPopupFromItem (lngLat, item) {
  var imageId = item.data.image_id

  var html = '<a href="' + item.data.url + '">' + item.data.title + '</a><br />' +
  '<img width="200px" src="https://images.nypl.org/index.php?id=' + imageId + '&t=w" />'

  new mapboxgl.Popup()
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map)
}

function showPopup (event) {
  var uuid = event.features[0].properties.uuid

  if (itemsByUuid[uuid]) {
    createPopupFromItem(event.lngLat, itemsByUuid[uuid])
  } else {
    d3.json(config.host + 'organizations/nypl/items/' + uuid, function (item) {
      itemsByUuid[uuid] = item
      createPopupFromItem(event.lngLat, item)
    })
  }
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

  getSubmissions()

  socket.on('submission', function (data) {
    if (!data || !data.submission || data.task.id !== config.taskId || data.submission.skipped) {
      return
    }

    var features = toFeatures(data).filter(R.identity)
    geojson.features = geojson.features.concat(features)
    map.getSource('submissions').setData(geojson)
  })

  map.on('click', 'points', showPopup)
  map.on('click', 'fields-of-view.fill', showPopup)

  function setPointer () {
    map.getCanvas().style.cursor = 'pointer'
  }

  function resetPointer () {
    map.getCanvas().style.cursor = ''
  }

  map.on('mouseenter', 'points', setPointer)
  map.on('mouseenter', 'fields-of-view.fill', setPointer)
  map.on('mouseleave', 'points', resetPointer)
  map.on('mouseleave', 'fields-of-view.fill', resetPointer)
})

function getSubmissions () {
  d3.json(config.host + 'tasks/' + config.taskId + '/submissions/all', function (json) {
    var submissions = json.map(function (item) {
      return item.submissions
        .map(function (submission) {
          return submission.steps.map(function (step) {
            return {
              submission: step,
              organization: {
                id: item.organization.id
              },
              item: {
                id: item.item.id
              },
              task: {
                id: item.task.id
              }
            }
          })
        })
    })

    var features = R.flatten(submissions).map(toFeatures)
    geojson.features = R.flatten(features).filter(R.identity)
    map.getSource('submissions').setData(geojson)
  })
}
