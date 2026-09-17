/* =====================================================================
   mapa.js — Mapa de focos de tucuras (Chubut)
   Arma el mapa a partir de lo que llega por WhatsApp: fotos con EXIF,
   chats exportados, texto pegado y archivos CSV/GeoJSON de la app.
   ===================================================================== */
(function () {
  'use strict';

  var T = window.Tucuras;
  var $ = function (id) { return document.getElementById(id); };

  var registros = [];      // todos los puntos cargados
  var capas = {};          // clave -> marcador de Leaflet
  var seleccion = {};      // claves marcadas para quitar
  var mapa, grupo;

  /* ================== Mapa ================== */

  function iniciarMapa() {
    mapa = L.map('mapa', { preferCanvas: true }).setView([-43.3, -68.8], 6); // Chubut

    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    });
    var satelite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Imagenes &copy; Esri'
      });
    var relieve = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '&copy; OpenTopoMap'
    });

    osm.addTo(mapa);
    L.control.layers({ 'Calles': osm, 'Satelital': satelite, 'Relieve': relieve }, null,
      { position: 'topright' }).addTo(mapa);
    L.control.scale({ imperial: false }).addTo(mapa);

    grupo = L.layerGroup().addTo(mapa);
    leyenda();

    // El contenedor cambia de tamano al cargar datos, al rotar el telefono o
    // al volver a una pestana que estaba en segundo plano.
    window.addEventListener('resize', aplicarEncuadre);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) aplicarEncuadre();
    });
    window.mapaTucuras = mapa; // util para diagnosticar desde la consola
  }

  function leyenda() {
    var ctrl = L.control({ position: 'bottomright' });
    ctrl.onAdd = function () {
      var div = L.DomUtil.create('div', 'leyenda');
      var filas = [
        ['Muy alto (> 30/m2)', '#cf2d2d'],
        ['Alto (15-30/m2)', '#e2701e'],
        ['En umbral (8-15/m2)', '#e8a82c'],
        ['Bajo (< 8/m2)', '#2f9e5e'],
        ['Sin dato de densidad', '#8a8f98']
      ];
      div.innerHTML = '<strong>Densidad</strong>' + filas.map(function (f) {
        return '<span><i style="background:' + f[1] + '"></i>' + f[0] + '</span>';
      }).join('');
      return div;
    };
    ctrl.addTo(mapa);
  }

  function radio(d) {
    if (d == null || isNaN(d)) return 6;
    return Math.max(6, Math.min(26, 5 + Math.sqrt(d) * 2.6));
  }

  function popup(r) {
    var f = T.filaPlana(r);
    var filas = [
      ['Fecha', f.fecha.replace('T', ' ')],
      ['Coordenadas', f.lat + ', ' + f.lon + (f.acc ? ' (+/- ' + f.acc + ' m)' : '')],
      ['Zona', f.zona], ['Establecimiento', f.establecimiento],
      ['Ambiente', f.ambiente], ['Especie', f.especie], ['Estadio', f.estadio],
      ['Densidad', f.densidad !== '' ? f.densidad + ' tucuras/m2 (' + f.nivel + ')' : ''],
      ['Metodo', f.metodo], ['Superficie', f.superficie ? f.superficie + ' ha' : ''],
      ['Monitoreador', f.monitoreador], ['Observaciones', f.observaciones],
      ['Origen', r.origen || '']
    ].filter(function (x) { return x[1]; });

    var html = '<div class="popup"><h4>' + esc(r.id) + '</h4>';
    if (r.urlFoto) html += '<img src="' + r.urlFoto + '" alt="Foto del foco">';
    html += '<table>' + filas.map(function (x) {
      return '<tr><th>' + x[0] + '</th><td>' + esc(x[1]) + '</td></tr>';
    }).join('') + '</table>';
    html += '<a href="https://www.google.com/maps?q=' + f.lat + ',' + f.lon +
      '" target="_blank" rel="noopener">Abrir en Google Maps</a>';
    html += '<button class="borrar-punto" data-clave="' + esc(r.clave) + '">Quitar este punto</button>';
    html += '</div>';
    return html;
  }

  /* ---- Borrado de puntos mal cargados ---- */

  function borrarPunto(clave, preguntar) {
    var i = -1;
    for (var k = 0; k < registros.length; k++) {
      if (registros[k].clave === clave) { i = k; break; }
    }
    if (i === -1) return false;
    var r = registros[i];
    if (preguntar && !confirm('Quitar el punto ' + r.id + '?\n\n' +
        'Se saca de este mapa. El registro original que mando el tecnico no se toca.')) {
      return false;
    }
    if (r.urlFoto) URL.revokeObjectURL(r.urlFoto);
    registros.splice(i, 1);
    refrescarOpcionesFiltro();
    dibujar();
    aviso('Se quito el punto ' + r.id + '. Quedan ' + registros.length + '.', 'info');
    return true;
  }

  function borrarSeleccionados() {
    var claves = Object.keys(seleccion);
    if (!claves.length) return;
    if (!confirm('Quitar los ' + claves.length + ' punto(s) marcados?\n\n' +
        'Se sacan de este mapa. Los registros originales no se tocan.')) return;
    registros = registros.filter(function (r) {
      if (!seleccion[r.clave]) return true;
      if (r.urlFoto) URL.revokeObjectURL(r.urlFoto);
      return false;
    });
    seleccion = {};
    refrescarOpcionesFiltro();
    dibujar();
    aviso(claves.length + ' punto(s) quitado(s). Quedan ' + registros.length + '.', 'info');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function dibujar() {
    grupo.clearLayers();
    capas = {};
    var visibles = filtrar();

    visibles.forEach(function (r) {
      if (r.lat == null || r.lon == null) return;
      var d = (r.densidad === '' || r.densidad == null) ? null : Number(r.densidad);
      var nivel = T.nivelDensidad(d);
      var m = L.circleMarker([r.lat, r.lon], {
        radius: radio(d),
        color: seleccion[r.clave] ? '#cf2d2d' : '#ffffff',
        weight: seleccion[r.clave] ? 4 : 2,
        fillColor: nivel.color, fillOpacity: 0.85
      }).bindPopup(popup(r), { maxWidth: 320 });
      m.addTo(grupo);
      capas[r.clave] = m;
    });

    renderTabla(visibles);
    renderResumen(visibles);

    encuadrar(visibles);
  }

  var encuadrePendiente = null;

  // Encuadra el mapa sobre los puntos visibles. Si el contenedor todavia no
  // tiene tamano (pestana en segundo plano, panel que aun no se acomodo),
  // Leaflet calcularia un zoom absurdo: dejamos el encuadre pendiente y lo
  // aplicamos cuando el mapa tenga medidas reales.
  function encuadrar(visibles) {
    var conPunto = (visibles || []).filter(function (r) {
      return typeof r.lat === 'number' && isFinite(r.lat) &&
             typeof r.lon === 'number' && isFinite(r.lon);
    });
    if (!conPunto.length) { encuadrePendiente = null; return; }
    encuadrePendiente = L.latLngBounds(conPunto.map(function (r) { return [r.lat, r.lon]; }));
    aplicarEncuadre();
  }

  function aplicarEncuadre() {
    if (!encuadrePendiente) return;
    mapa.invalidateSize({ animate: false });
    var t = mapa.getSize();
    if (!t.x || !t.y) return; // sin tamano util: queda pendiente
    mapa.fitBounds(encuadrePendiente.pad(0.2), { animate: false, maxZoom: 13 });
    encuadrePendiente = null;
  }

  /* ================== Filtros ================== */

  function filtrar() {
    var zona = $('filtroZona').value;
    var estadio = $('filtroEstadio').value;
    var nivel = $('filtroNivel').value;
    var desde = $('filtroDesde').value;
    var hasta = $('filtroHasta').value;
    var texto = $('filtroTexto').value.trim().toLowerCase();

    return registros.filter(function (r) {
      if (zona && r.zona !== zona) return false;
      if (estadio && r.estadio !== estadio) return false;
      if (nivel) {
        var d = (r.densidad === '' || r.densidad == null) ? null : Number(r.densidad);
        if (T.nivelDensidad(d).cod !== nivel) return false;
      }
      var fecha = (r.fecha || '').slice(0, 10);
      if (desde && fecha && fecha < desde) return false;
      if (hasta && fecha && fecha > hasta) return false;
      if (texto) {
        var todo = [r.id, r.zona, r.establecimiento, r.monitoreador, r.observaciones]
          .join(' ').toLowerCase();
        if (todo.indexOf(texto) === -1) return false;
      }
      return true;
    });
  }

  function refrescarOpcionesFiltro() {
    var zonas = {};
    registros.forEach(function (r) { if (r.zona) zonas[r.zona] = true; });
    var sel = $('filtroZona'), actual = sel.value;
    sel.innerHTML = '<option value="">Todas las zonas</option>';
    Object.keys(zonas).sort().forEach(function (z) {
      var o = document.createElement('option');
      o.value = z; o.textContent = z;
      sel.appendChild(o);
    });
    sel.value = actual;
  }

  /* ================== Tabla y resumen ================== */

  function renderTabla(visibles) {
    var cuerpo = $('cuerpoTabla');
    cuerpo.innerHTML = '';
    visibles.slice().sort(function (a, b) {
      return (b.fecha || '').localeCompare(a.fecha || '');
    }).forEach(function (r) {
      var d = (r.densidad === '' || r.densidad == null) ? null : Number(r.densidad);
      var nivel = T.nivelDensidad(d);
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="sel"><input type="checkbox"' + (seleccion[r.clave] ? ' checked' : '') + '></td>' +
        '<td><span class="punto" style="background:' + nivel.color + '"></span>' + esc(r.id) + '</td>' +
        '<td>' + esc((r.fecha || '').replace('T', ' ').slice(0, 16)) + '</td>' +
        '<td>' + esc(r.zona || '') + '</td>' +
        '<td>' + esc(T.nombrePorCod(T.ESTADIOS, r.estadio)) + '</td>' +
        '<td class="num">' + (d != null ? d : '') + '</td>' +
        '<td class="mono">' + T.coord(r.lat) + ', ' + T.coord(r.lon) + '</td>' +
        '<td class="sel"><button class="quitar" title="Quitar este punto">&times;</button></td>';

      tr.querySelector('input[type=checkbox]').onclick = function (e) {
        e.stopPropagation();
        if (this.checked) seleccion[r.clave] = true; else delete seleccion[r.clave];
        pintarBarraSeleccion();
        if (capas[r.clave]) {
          capas[r.clave].setStyle({
            color: this.checked ? '#cf2d2d' : '#ffffff',
            weight: this.checked ? 4 : 2
          });
        }
      };
      tr.querySelector('button.quitar').onclick = function (e) {
        e.stopPropagation();
        borrarPunto(r.clave, true);
      };
      tr.onclick = function () {
        if (!capas[r.clave]) return;
        mapa.setView([r.lat, r.lon], 13);
        capas[r.clave].openPopup();
      };
      cuerpo.appendChild(tr);
    });
    $('conteoTabla').textContent = visibles.length + ' punto(s)';
    pintarBarraSeleccion();
  }

  function pintarBarraSeleccion() {
    var n = Object.keys(seleccion).length;
    var b = $('btnBorrarSeleccion');
    b.hidden = n === 0;
    b.textContent = 'Quitar ' + n + ' punto(s) marcado(s)';
  }

  function renderResumen(visibles) {
    var conDens = visibles.filter(function (r) {
      return r.densidad !== '' && r.densidad != null && isFinite(Number(r.densidad));
    });
    var sobreUmbral = conDens.filter(function (r) { return Number(r.densidad) >= T.UMBRAL_MIN; });
    var maxD = conDens.reduce(function (a, r) { return Math.max(a, Number(r.densidad)); }, 0);
    var zonas = {};
    visibles.forEach(function (r) { if (r.zona) zonas[r.zona] = (zonas[r.zona] || 0) + 1; });

    var sup = visibles.reduce(function (a, r) {
      var s = Number(r.superficie);
      return a + (isFinite(s) ? s : 0);
    }, 0);

    $('resumen').innerHTML =
      tarjeta(visibles.length, 'puntos relevados') +
      tarjeta(sobreUmbral.length, 'sobre el umbral (' + T.UMBRAL_MIN + '/m2)', sobreUmbral.length ? '#cf2d2d' : null) +
      tarjeta(maxD ? maxD + '/m2' : '-', 'densidad maxima') +
      tarjeta(Object.keys(zonas).length, 'zonas con registros') +
      tarjeta(sup ? Math.round(sup) + ' ha' : '-', 'superficie declarada');
  }

  function tarjeta(valor, texto, color) {
    return '<div class="dato"><strong' + (color ? ' style="color:' + color + '"' : '') + '>' +
      valor + '</strong><span>' + texto + '</span></div>';
  }

  /* ================== Ingreso de datos ================== */

  var contadorPuntos = 0;

  function agregar(reg, origen) {
    if (reg.lat == null || reg.lon == null) return false;
    if (!isFinite(reg.lat) || !isFinite(reg.lon)) return false;
    reg.origen = origen;

    // La clave sirve para no duplicar; el id es lo que se muestra. Un punto
    // sin id propio (por ejemplo una ubicacion compartida) se identifica por
    // sus coordenadas y su fecha.
    reg.clave = reg.id || ('@' + T.coord(reg.lat) + ',' + T.coord(reg.lon) + '@' + (reg.fecha || '').slice(0, 16));

    // Si el mismo punto llega dos veces (foto + texto), nos quedamos con el
    // que traiga mas informacion.
    var previo = null;
    for (var i = 0; i < registros.length; i++) {
      if (registros[i].clave === reg.clave) { previo = registros[i]; break; }
    }
    if (previo) {
      Object.keys(reg).forEach(function (k) {
        if (reg[k] !== '' && reg[k] != null && (previo[k] === '' || previo[k] == null)) previo[k] = reg[k];
      });
      if (reg.urlFoto && !previo.urlFoto) previo.urlFoto = reg.urlFoto;
      return false;
    }
    if (!reg.id) reg.id = 'PUNTO-' + (++contadorPuntos);
    registros.push(reg);
    return true;
  }

  function vacio() {
    return {
      id: '', fecha: '', lat: null, lon: null, acc: null, alt: null,
      zona: '', establecimiento: '', especie: '', estadio: '', densidad: '',
      metodo: '', ambiente: '', superficie: '', monitoreador: '', observaciones: ''
    };
  }

  /* ---- 1. Linea de codigo #TUCURA ---- */

  var ORDEN = ['id', 'lat', 'lon', 'acc', 'fecha', 'zona', 'establecimiento',
    'especie', 'estadio', 'densidad', 'metodo', 'ambiente', 'superficie',
    'monitoreador', 'observaciones'];

  function desdeLineaCodigo(linea) {
    var m = /#TUCURA\|(\d+)\|(.*)$/.exec(linea);
    if (!m) return null;
    var partes = m[2].split('|');
    var r = vacio();
    ORDEN.forEach(function (k, i) {
      var v = (partes[i] || '').trim();
      if (k === 'lat' || k === 'lon' || k === 'acc') {
        r[k] = v === '' ? null : parseFloat(v);
      } else {
        r[k] = v;
      }
    });
    if (r.lat == null || !isFinite(r.lat) || r.lon == null || !isFinite(r.lon)) return null;
    return r;
  }

  /* ---- 2. Bloque de texto legible ---- */

  var ETIQUETAS = {
    'id': 'id',
    'fecha de captura': 'fecha', 'fecha': 'fecha',
    'zona / paraje': 'zona', 'zona': 'zona', 'paraje': 'zona',
    'establecimiento': 'establecimiento', 'campo': 'establecimiento',
    'superficie afectada estimada': 'superficie', 'superficie': 'superficie',
    'monitoreador': 'monitoreador', 'tecnico': 'monitoreador',
    'observaciones': 'observaciones', 'obs': 'observaciones'
  };

  function normalizar(s) {
    return s.toLowerCase()
      .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
      .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
      .trim();
  }

  function codigoPorNombre(lista, texto) {
    var t = normalizar(texto || '');
    if (!t) return ''; // sin texto no hay codigo: si no, coincidiria con el primero
    // Si ya viene el codigo (BC, SAL, ARO...), lo damos por bueno.
    for (var k = 0; k < lista.length; k++) {
      if (lista[k].cod.toLowerCase() === t) return lista[k].cod;
    }
    for (var i = 0; i < lista.length; i++) {
      var n = normalizar(lista[i].nom);
      if (t === n || t.indexOf(n) === 0 || n.indexOf(t) === 0) return lista[i].cod;
    }
    // Coincidencia por palabra clave
    for (var j = 0; j < lista.length; j++) {
      var clave = normalizar(lista[j].nom).split(/[ (]/)[0];
      if (clave.length > 3 && t.indexOf(clave) !== -1) return lista[j].cod;
    }
    return '';
  }

  // Fechas tipo "10/09/2026 14:23"
  function fechaCastellana(txt) {
    var m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[,]?\s+(\d{1,2}):(\d{2}))?/.exec(txt);
    if (!m) return '';
    var anio = m[3].length === 2 ? '20' + m[3] : m[3];
    return anio + '-' + T.dos(+m[2]) + '-' + T.dos(+m[1]) +
      'T' + T.dos(m[4] ? +m[4] : 0) + ':' + T.dos(m[5] ? +m[5] : 0) + ':00';
  }

  function desdeBloque(lineas) {
    var r = vacio();
    var tieneAlgo = false;

    lineas.forEach(function (linea) {
      var m = /^\s*(?:\[[^\]]*\]\s*)?(?:[^:]{0,40}?:\s*)?([A-Za-zÁÉÍÓÚÑáéíóúñ .\/]+)\s*:\s*(.+)$/.exec(linea);
      if (!m) return;
      var etiqueta = normalizar(m[1]);
      var valor = m[2].trim();

      if (ETIQUETAS[etiqueta]) {
        var campo = ETIQUETAS[etiqueta];
        if (campo === 'fecha') {
          r.fecha = fechaCastellana(valor) || valor;
        } else if (campo === 'superficie') {
          var s = parseFloat(valor.replace(',', '.'));
          r.superficie = isFinite(s) ? String(s) : '';
        } else {
          r[campo] = valor;
        }
        tieneAlgo = true;
        return;
      }

      if (etiqueta === 'coordenadas') {
        var c = /(-?\d+[.,]\d+)\s*,\s*(-?\d+[.,]\d+)/.exec(valor);
        if (c) {
          r.lat = parseFloat(c[1].replace(',', '.'));
          r.lon = parseFloat(c[2].replace(',', '.'));
          tieneAlgo = true;
        }
        var a = /\+\/-\s*(\d+)\s*m/.exec(valor);
        if (a) r.acc = parseFloat(a[1]);
      } else if (etiqueta === 'especie') {
        r.especie = codigoPorNombre(T.ESPECIES, valor); tieneAlgo = true;
      } else if (etiqueta === 'estadio') {
        r.estadio = codigoPorNombre(T.ESTADIOS, valor); tieneAlgo = true;
      } else if (etiqueta === 'ambiente') {
        r.ambiente = codigoPorNombre(T.AMBIENTES, valor); tieneAlgo = true;
      } else if (etiqueta === 'densidad') {
        var d = /(-?\d+[.,]?\d*)/.exec(valor);
        if (d) { r.densidad = String(parseFloat(d[1].replace(',', '.'))); tieneAlgo = true; }
        var met = /\(([^)]+)\)/.exec(valor);
        if (met) r.metodo = codigoPorNombre(T.METODOS, met[1]);
      }
    });

    // Ubicacion suelta en un enlace de Google Maps (mensaje de ubicacion)
    if (r.lat == null) {
      for (var i = 0; i < lineas.length; i++) {
        var g = /maps(?:\.google)?[^\s]*[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(lineas[i]) ||
                /google\.[^\s]*\/maps[^\s]*?(-?\d\d\.\d{4,}),(-?\d\d?\.\d{4,})/.exec(lineas[i]);
        if (g) {
          r.lat = parseFloat(g[1]);
          r.lon = parseFloat(g[2]);
          tieneAlgo = true;
          break;
        }
      }
    }

    // Si el mensaje no trae fecha propia (por ejemplo una ubicacion
    // compartida), usamos la del encabezado que pone WhatsApp al exportar.
    if (!r.fecha && lineas.length) {
      for (var k = 0; k < lineas.length; k++) {
        if (INICIO_MENSAJE.test(lineas[k])) {
          r.fecha = fechaCastellana(lineas[k]);
          break;
        }
      }
    }

    if (!tieneAlgo || r.lat == null || r.lon == null) return null;
    return r;
  }

  /* ---- 3. Texto completo (chat exportado o pegado) ---- */

  // Las lineas de un chat exportado arrancan con fecha y hora; las
  // continuaciones de un mensaje multilinea, no.
  var INICIO_MENSAJE = /^\s*(?:\[)?\d{1,2}\/\d{1,2}\/\d{2,4}[,]?\s+\d{1,2}:\d{2}/;

  function procesarTexto(texto, origen) {
    var lineas = texto.split(/\r?\n/);
    var nuevos = 0;
    var ids = {};

    // Paso 1: lineas de codigo, que son las mas confiables.
    lineas.forEach(function (l) {
      var r = desdeLineaCodigo(l);
      if (r) {
        ids[r.id] = true;
        if (agregar(r, origen)) nuevos++;
      }
    });

    // Paso 2: bloques legibles, para los mensajes que perdieron el codigo
    // (por ejemplo si alguien reescribio el mensaje a mano).
    var bloque = [];
    function cerrar() {
      if (!bloque.length) return;
      var r = desdeBloque(bloque);
      if (r && !(r.id && ids[r.id])) {
        if (agregar(r, origen)) nuevos++;
      }
      bloque = [];
    }
    lineas.forEach(function (l) {
      // Cortamos en el encabezado de cada mensaje del chat exportado y
      // tambien en el titulo del parte, porque al copiar desde WhatsApp Web
      // los mensajes llegan pegados y sin fecha.
      if (INICIO_MENSAJE.test(l) || /monitoreo de tucuras/i.test(l)) cerrar();
      bloque.push(l);
    });
    cerrar();

    return nuevos;
  }

  /* ---- 4. Fotos ---- */

  function procesarFoto(file) {
    return window.ExifReader.readExifFromFile(file).then(function (ex) {
      if (!ex || ex.lat == null || ex.lon == null) return { ok: false, nombre: file.name };

      var r = null;
      // Si la foto salio de la app de campo, el registro entero viaja en el
      // UserComment y es preferible a los campos sueltos.
      if (ex.UserComment && ex.UserComment.indexOf('#TUCURA|') !== -1) {
        ex.UserComment.split(/\r?\n/).forEach(function (l) {
          var c = desdeLineaCodigo(l);
          if (c) r = c;
        });
      }
      if (!r) {
        r = vacio();
        r.lat = ex.lat;
        r.lon = ex.lon;
        r.acc = ex.accuracy != null ? ex.accuracy : null;
        r.alt = ex.altitude != null ? Math.round(ex.altitude) : null;
        r.fecha = ex.fecha ? T.fechaISO(ex.fecha) : '';
        r.observaciones = ex.ImageDescription || '';
      }
      r.urlFoto = URL.createObjectURL(file);
      var nuevo = agregar(r, 'foto: ' + file.name);
      return { ok: true, nuevo: nuevo, nombre: file.name };
    });
  }

  /* ---- 5. Archivos CSV / GeoJSON ---- */

  // Los nombres de las propiedades cambian segun quien haya generado el
  // archivo (la app usa claves internas, el CSV usa encabezados legibles y
  // QGIS puede reescribirlos). Buscamos por varios alias, sin distinguir
  // mayusculas ni acentos.
  function buscarProp(props, alias) {
    var mapa = {};
    Object.keys(props).forEach(function (k) { mapa[normalizar(k)] = props[k]; });
    for (var i = 0; i < alias.length; i++) {
      var v = mapa[normalizar(alias[i])];
      if (v !== undefined && v !== null && v !== '') return String(v);
    }
    return '';
  }

  function procesarGeoJSON(texto, origen) {
    var g = JSON.parse(texto);
    var n = 0;
    (g.features || []).forEach(function (f) {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      var p = f.properties || {};
      var r = vacio();
      r.id = buscarProp(p, ['id']);
      r.lon = f.geometry.coordinates[0];
      r.lat = f.geometry.coordinates[1];
      r.fecha = buscarProp(p, ['fecha']);
      r.zona = buscarProp(p, ['zona']);
      r.establecimiento = buscarProp(p, ['establecimiento']);
      r.densidad = buscarProp(p, ['densidad', 'Densidad_tucuras_m2']);
      r.especie = codigoPorNombre(T.ESPECIES, buscarProp(p, ['especie']));
      r.estadio = codigoPorNombre(T.ESTADIOS, buscarProp(p, ['estadio']));
      r.metodo = codigoPorNombre(T.METODOS, buscarProp(p, ['metodo']));
      r.ambiente = codigoPorNombre(T.AMBIENTES, buscarProp(p, ['ambiente']));
      r.superficie = buscarProp(p, ['superficie', 'Superficie_ha']);
      r.monitoreador = buscarProp(p, ['monitoreador']);
      r.observaciones = buscarProp(p, ['observaciones']);
      var acc = parseFloat(buscarProp(p, ['acc', 'Precision_m']));
      r.acc = isFinite(acc) ? acc : null;
      var alt = parseFloat(buscarProp(p, ['alt', 'Altitud_m']));
      r.alt = isFinite(alt) ? alt : null;
      if (agregar(r, origen)) n++;
    });
    return n;
  }

  function partirCSV(linea, sep) {
    var out = [], actual = '', comillas = false;
    for (var i = 0; i < linea.length; i++) {
      var c = linea[i];
      if (comillas) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
        else if (c === '"') comillas = false;
        else actual += c;
      } else if (c === '"') comillas = true;
      else if (c === sep) { out.push(actual); actual = ''; }
      else actual += c;
    }
    out.push(actual);
    return out;
  }

  function procesarCSV(texto, origen) {
    texto = texto.replace(/^﻿/, '');
    var lineas = texto.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (lineas.length < 2) return 0;
    var sep = (lineas[0].split(';').length >= lineas[0].split(',').length) ? ';' : ',';
    var cab = partirCSV(lineas[0], sep).map(function (s) { return normalizar(s); });

    function col(fila, nombre) {
      var i = cab.indexOf(normalizar(nombre));
      return i === -1 ? '' : (fila[i] || '').trim();
    }

    var n = 0;
    for (var i = 1; i < lineas.length; i++) {
      var fila = partirCSV(lineas[i], sep);
      var lat = parseFloat((col(fila, 'Latitud') || col(fila, 'lat')).replace(',', '.'));
      var lon = parseFloat((col(fila, 'Longitud') || col(fila, 'lon')).replace(',', '.'));
      if (!isFinite(lat) || !isFinite(lon)) continue;
      var r = vacio();
      r.id = col(fila, 'ID');
      r.lat = lat; r.lon = lon;
      r.fecha = col(fila, 'Fecha');
      r.zona = col(fila, 'Zona');
      r.establecimiento = col(fila, 'Establecimiento');
      r.densidad = col(fila, 'Densidad_tucuras_m2').replace(',', '.');
      r.especie = codigoPorNombre(T.ESPECIES, col(fila, 'Especie'));
      r.estadio = codigoPorNombre(T.ESTADIOS, col(fila, 'Estadio'));
      r.metodo = codigoPorNombre(T.METODOS, col(fila, 'Metodo'));
      r.ambiente = codigoPorNombre(T.AMBIENTES, col(fila, 'Ambiente'));
      r.superficie = col(fila, 'Superficie_ha');
      r.monitoreador = col(fila, 'Monitoreador');
      r.observaciones = col(fila, 'Observaciones');
      var acc = parseFloat(col(fila, 'Precision_m'));
      r.acc = isFinite(acc) ? acc : null;
      if (agregar(r, origen)) n++;
    }
    return n;
  }

  /* ================== Entrada de archivos ================== */

  function leerTexto(file) {
    return file.text ? file.text() : new Promise(function (res) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.readAsText(file);
    });
  }

  function cargarArchivos(files) {
    var lista = Array.prototype.slice.call(files);
    if (!lista.length) return;

    aviso('Leyendo ' + lista.length + ' archivo(s)...');
    var nuevos = 0, sinGps = [];

    var tareas = lista.map(function (f) {
      var nombre = f.name.toLowerCase();
      if (/\.(jpe?g)$/.test(nombre) || f.type === 'image/jpeg') {
        return procesarFoto(f).then(function (res) {
          if (!res.ok) sinGps.push(res.nombre);
          else if (res.nuevo) nuevos++;
        });
      }
      if (/\.(geojson|json)$/.test(nombre)) {
        return leerTexto(f).then(function (t) {
          try { nuevos += procesarGeoJSON(t, 'archivo: ' + f.name); }
          catch (e) { nuevos += procesarTexto(t, 'archivo: ' + f.name); }
        });
      }
      if (/\.csv$/.test(nombre)) {
        return leerTexto(f).then(function (t) { nuevos += procesarCSV(t, 'archivo: ' + f.name); });
      }
      if (/\.(txt|log)$/.test(nombre)) {
        return leerTexto(f).then(function (t) { nuevos += procesarTexto(t, 'chat: ' + f.name); });
      }
      if (/\.zip$/.test(nombre)) {
        sinGps.push(f.name + ' (descomprimi el ZIP y carga el _chat.txt y las fotos)');
        return Promise.resolve();
      }
      return leerTexto(f).then(function (t) { nuevos += procesarTexto(t, 'archivo: ' + f.name); });
    });

    Promise.all(tareas).then(function () {
      refrescarOpcionesFiltro();
      dibujar();
      var msg = nuevos + ' punto(s) nuevo(s) agregado(s). Total: ' + registros.length + '.';
      if (sinGps.length) msg += ' Sin ubicacion utilizable: ' + sinGps.join(', ') + '.';
      aviso(msg, sinGps.length ? 'atencion' : 'ok');
    }).catch(function (e) {
      aviso('Hubo un error al leer los archivos: ' + (e && e.message ? e.message : e), 'error');
    });
  }

  function aviso(texto, tipo) {
    var el = $('aviso');
    el.textContent = texto;
    el.className = 'aviso ' + (tipo || 'info');
    el.hidden = false;
  }

  /* ================== Exportar ================== */

  function descargar(contenido, nombre, mime) {
    var blob = new Blob([contenido], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  function exportar(tipo) {
    var visibles = filtrar();
    if (!visibles.length) { aviso('No hay puntos para exportar', 'atencion'); return; }
    var hoy = new Date();
    var sello = hoy.getFullYear() + T.dos(hoy.getMonth() + 1) + T.dos(hoy.getDate());
    if (tipo === 'csv') descargar(T.aCSV(visibles), 'focos-tucuras-' + sello + '.csv', 'text/csv;charset=utf-8');
    else if (tipo === 'geojson') descargar(T.aGeoJSON(visibles), 'focos-tucuras-' + sello + '.geojson', 'application/geo+json');
    else descargar(T.aKML(visibles), 'focos-tucuras-' + sello + '.kml', 'application/vnd.google-earth.kml+xml');
  }

  /* ================== Arranque ================== */

  function conectar() {
    var zona = $('zonaSoltar');
    ['dragenter', 'dragover'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        zona.classList.add('encima');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zona.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        zona.classList.remove('encima');
      });
    });
    zona.addEventListener('drop', function (e) { cargarArchivos(e.dataTransfer.files); });
    zona.addEventListener('click', function () { $('entradaArchivos').click(); });
    $('entradaArchivos').addEventListener('change', function (e) { cargarArchivos(e.target.files); });

    $('btnPegar').addEventListener('click', function () {
      var t = $('areaPegar').value;
      if (!t.trim()) { aviso('Pega primero el texto de los mensajes', 'atencion'); return; }
      var n = procesarTexto(t, 'texto pegado');
      refrescarOpcionesFiltro();
      dibujar();
      aviso(n + ' punto(s) nuevo(s) desde el texto pegado. Total: ' + registros.length + '.', n ? 'ok' : 'atencion');
    });

    ['filtroZona', 'filtroEstadio', 'filtroNivel', 'filtroDesde', 'filtroHasta']
      .forEach(function (id) { $(id).addEventListener('change', dibujar); });
    $('filtroTexto').addEventListener('input', dibujar);
    $('btnLimpiarFiltros').addEventListener('click', function () {
      ['filtroZona', 'filtroEstadio', 'filtroNivel', 'filtroDesde', 'filtroHasta', 'filtroTexto']
        .forEach(function (id) { $(id).value = ''; });
      dibujar();
    });

    // El boton de quitar vive dentro del globo de Leaflet, que se crea y se
    // destruye solo: escuchamos el clic en el contenedor del mapa.
    $('mapa').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.borrar-punto');
      if (!b) return;
      mapa.closePopup();
      borrarPunto(b.dataset.clave, true);
    });
    $('btnBorrarSeleccion').addEventListener('click', borrarSeleccionados);

    $('btnCSV').addEventListener('click', function () { exportar('csv'); });
    $('btnGeo').addEventListener('click', function () { exportar('geojson'); });
    $('btnKML').addEventListener('click', function () { exportar('kml'); });
    $('btnVaciar').addEventListener('click', function () {
      if (!registros.length) return;
      if (!confirm('Quitar los ' + registros.length + ' punto(s) cargados?')) return;
      registros.forEach(function (r) { if (r.urlFoto) URL.revokeObjectURL(r.urlFoto); });
      registros = [];
      seleccion = {};
      refrescarOpcionesFiltro();
      dibujar();
      aviso('Se vacio la sesion.', 'info');
    });
  }

  function iniciar() {
    var sel = $('filtroEstadio');
    T.ESTADIOS.forEach(function (e) {
      var o = document.createElement('option');
      o.value = e.cod; o.textContent = e.nom;
      sel.appendChild(o);
    });
    iniciarMapa();
    conectar();
    dibujar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
