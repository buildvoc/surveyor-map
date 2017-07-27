var socket = io(config.host)

mapboxgl.accessToken = 'pk.eyJ1IjoibnlwbGxhYnMiLCJhIjoiSFVmbFM0YyJ9.sl0CRaO71he1XMf_362FZQ'

var colors = {
  location: 'rgb(3, 162, 255)',
  bearing: 'rgb(245, 68, 28)'
}

var dateModified = R.path(['submission', 'dateModified'])

var map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/nypllabs/cj2gmix25005o2rpapartqm07',
  center: [-73.98579, 40.71571],
  zoom: 13
})

var itemsById = {}
var submissions = []
var features = []

function geojson (features) {
  return {
    type: 'FeatureCollection',
    features: features || []
  }
}

function getProperties (data) {
  return {
    step: data.submission.step,
    itemId: data.itemId
  }
}

function toFeatures (data) {
  if (data.submission.step === 'location') {
    return [{
      type: 'Feature',
      properties: getProperties(data),
      geometry: data.submission.data.geometry
    }]
  } else if (data.submission.step === 'bearing') {
    var point = data.submission.data.geometry.geometries[0].coordinates
    var lineString = data.submission.data.geometry.geometries[1].coordinates

    return [
      {
        type: 'Feature',
        properties: getProperties(data),
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
        properties: getProperties(data),
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

  return []
}

function createPopupFromItem (lngLat, item) {
  var imageId = item.item.data.image_id

  var html = '<a href="' + item.item.data.url + '"><span>' + item.item.data.title + '</span><br />' +
    '<img width="100%" src="https://images.nypl.org/index.php?id=' + imageId + '&t=w" /></a>'

  new mapboxgl.Popup()
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map)
}

function showPopup (event) {
  // TODO: all event.features
  // console.log('zvoveel', event.features.length)

  var itemId = event.features[0].properties.itemId
  var item = itemsById[itemId]

  if (item) {
    createPopupFromItem(event.lngLat, item)
  }
}

function panToSubmission (submission) {
  if (submission.submission.step === 'location') {
    var point = submission.submission.data.geometry
    map.flyTo({
      center: point.coordinates,
      zoom: 17
    })
  } else if (submission.submission.step === 'bearing') {
    var point = submission.submission.data.geometry.geometries[0].coordinates
    var lineString = submission.submission.data.geometry.geometries[1].coordinates

    var fieldOfView = {
      type: 'LineString',
      coordinates: [
        lineString[0],
        point,
        lineString[1],
      ]
    }

    var bounds = fieldOfView.coordinates.reduce(function (bounds, coord) {
      return bounds.extend(coord)
    }, new mapboxgl.LngLatBounds(fieldOfView.coordinates[0], fieldOfView.coordinates[0]))

    map.fitBounds(bounds, {
      padding: 150
    })
  }
}

map.on('load', function () {
  map.addControl(new mapboxgl.NavigationControl())

  map.addSource('submissions', {
    type: 'geojson',
    data: geojson()
  })

  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'submissions',
    paint: {
      'circle-color': colors.location,
      'circle-radius': 7,
      'circle-opacity': 0.5
    },
    filter: ['==', 'step', 'location']
  })

  map.addLayer({
    id: 'fields-of-view.fill',
    type: 'fill',
    source: 'submissions',
    paint: {
      'fill-color': colors.bearing,
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
    if (!data || data.task.id !== config.taskId) {
      return
    }

    console.log('New submission!', data.item.id)
    addSubmissions([data])

    if (d3.select('#auto-pan').property('checked')) {
      panToSubmission(itemsToSubmissions([data])[0])
    }
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

function getItemId (data) {
  return data.organization.id + ':' + data.item.id
}

function storeItem (data) {
  var id = getItemId(data)
  itemsById[id] = {
    item: data.item,
    organization: data.organization
  }
}

function itemsToSubmissions (items) {
  return R.flatten(items.map(function (item) {
    return item.submissions
      .map(function (submission) {
        return submission.steps.map(function (step) {
          return {
            submission: step,
            itemId: getItemId(item),
            task: {
              id: item.task.id
            }
          }
        })
      })
    }))
    .filter(R.identity)
    .sort(function (a, b) {
      return new Date(dateModified(b)) - new Date(dateModified(a))
    })
    .filter(function (data) {
      if (data.submission.step === 'bearing') {
        if (!data.submission.data.distance || data.submission.data.distance > 1000) {
          return false
        }
      }

      return true
    })
}

function addSubmissions (items) {
  items.forEach(storeItem)

  var newSubmissions = itemsToSubmissions(items)
  var newFeatures = R.flatten(newSubmissions.map(toFeatures)).filter(R.identity)
  features = features.concat(newFeatures)

  submissions = newSubmissions.concat(submissions)

  updateList(submissions)
  updateMap(features)
}

function updateMap (features) {
  map.getSource('submissions').setData(geojson(features))
}

function updateList (submissions) {
  var submission = d3.select('#submissions').selectAll('li')
    .data(submissions, function (d) {
      return d.itemId + ':' + dateModified(d)
    })
    .enter()
    .append('li')
    .attr('class', function (d) {
      return d.submission.step
    })
    .on('click', function (d) {
      panToSubmission(d)
    })

  submission.append('h3')
    .text(function (d) {
      var item = itemsById[d.itemId]
      if (item) {
        return item.item.data.title
      } else {
        return ''
      }
    })

  submission.append('img')
    .attr('src', function (d) {
      return 'images/icons_' + d.submission.step + '.svg'
    })

  submission.append('span')
    .text(function (d) {
      var span = this
      var date = dateModified(d)

      window.setInterval(function () {
        d3.select(span).text(moment(date).fromNow())
      }, 1000 * 60 )

      return moment(date).fromNow()
    })
}

function getSubmissions () {
  d3.json(config.host + 'tasks/' + config.taskId + '/submissions/all', function (json) {
    addSubmissions(json)
  })
}
