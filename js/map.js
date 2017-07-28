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

var currentPopup
var newPopup

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

function setPopupContents (itemId) {
  var contents = d3.select('#popup-contents')
  var item = itemsById[itemId]
  var imageId = item.item.data.image_id

  var html = '<a href="' + item.item.data.url + '"><div>' + item.item.data.title + '</div>' +
    '<img width="100%" src="https://images.nypl.org/index.php?id=' + imageId + '&t=w" /></a>'

  contents
    .html(html)
}

function setPopupLinksAndContents () {
  var contents = d3.select('#popup-contents')
  var itemId = contents.attr('data-item-id')
  setPopupContents(itemId)

  d3.selectAll('#popup-items li a')
    .on('click', function () {
      var itemId = d3.select(this).attr('data-item-id')
      setPopupContents(itemId)
    })
}

function createPopupFromItemIds (lngLat, itemIds) {
  var itemList = ''
  if (itemIds.length > 1) {
    itemList = '<ol id="popup-items">' + itemIds.reduce(function (previous, itemId, index) {
      return previous + '<li><a href="javascript:void(0);" data-item-id="' + itemId + '">' + (index + 1) + '</a></li>'
    }, '') + '</ol>'
  }

  var html = itemList + '<div id="popup-contents" data-item-id="' + itemIds[0] + '">'

  return new mapboxgl.Popup()
    .setLngLat(lngLat)
    .setHTML(html)
}

function removePopup () {
  if (currentPopup) {
    currentPopup.remove()
    currentPopup = undefined
  }
}

function addPopup(popup) {
  currentPopup = popup
  if (map && popup) {
    popup.addTo(map)
    setPopupLinksAndContents()
  }
}

function mapClick (event) {
  if (!event || !event.features || !event.features.length) {
    return
  }

  var itemIds = event.features
    .map(function (feature) {
      return feature.properties.itemId
    })

  removePopup()
  if (itemIds.length) {
    addPopup(createPopupFromItemIds(event.lngLat, itemIds))
  }
}

function flyToSubmission (submission) {
  removePopup()
  var popupCoordinates

  if (submission.submission.step === 'location') {
    var point = submission.submission.data.geometry
    map.flyTo({
      center: point.coordinates,
      zoom: 17
    })

    popupCoordinates = point.coordinates
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

    popupCoordinates = bounds.getCenter()
  }

  if (popupCoordinates) {
    newPopup = createPopupFromItemIds(popupCoordinates, [submission.itemId])
  }
}

map.on('load', function () {
  map.on('moveend', function () {
    if (newPopup) {
      removePopup()
      addPopup(newPopup)
      newPopup = undefined
    }
  })

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
      'fill-opacity': 0.1
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
      flyToSubmission(itemsToSubmissions([data])[0])
    }
  })

  map.on('click', 'points', mapClick)
  map.on('click', 'fields-of-view.fill', mapClick)

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
      var step = data.submission.step
      if (step === 'bearing') {
        if (!data.submission.data.distance || data.submission.data.distance > 1000) {
          return false
        }
        return true
      } else if (step === 'location') {
        return true
      }

      return false
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
      flyToSubmission(d)
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
      }, 1000 * 60)

      return moment(date).fromNow()
    })
}

function getSubmissions () {
  d3.json(config.host + 'tasks/' + config.taskId + '/submissions/all', function (json) {
    addSubmissions(json)
  })
}
