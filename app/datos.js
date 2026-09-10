/* =====================================================================
   datos.js  —  Vocabularios del Programa Provincial MIP Tucuras (Chubut),
   almacenamiento local (IndexedDB) y armado del mensaje de WhatsApp.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ============ Catalogos segun el Programa Provincial ============ */

  var ESPECIES = [
    { cod: 'BC', nom: 'Bufonacris claraziana (tucura sapo)' },
    { cod: 'DM', nom: 'Dichroplus maculipennis (alas manchadas)' },
    { cod: 'OT', nom: 'Otra especie' },
    { cod: 'ND', nom: 'No determinada' }
  ];

  // Estados del ciclo biologico tal como los nombra el Programa.
  var ESTADIOS = [
    { cod: 'DES', nom: 'Desove (canutos)' },
    { cod: 'MOS', nom: 'Mosquita (estadios I-II)' },
    { cod: 'SAL', nom: 'Saltona (estadios III-V)' },
    { cod: 'ADU', nom: 'Adulto / voladora' },
    { cod: 'MIX', nom: 'Mixto (varios estadios)' }
  ];

  var METODOS = [
    { cod: 'ARO', nom: 'Aros de 0,1 m2 (Onsager y Henry)' },
    { cod: 'PAS', nom: 'Recorrida lineal (pasos)' },
    { cod: 'RED', nom: 'Red de arrastre (200 golpes)' },
    { cod: 'VIS', nom: 'Estimacion visual' }
  ];

  var AMBIENTES = [
    { cod: 'MAL', nom: 'Mallin' },
    { cod: 'PER', nom: 'Perimallin' },
    { cod: 'EST', nom: 'Estepa' },
    { cod: 'MES', nom: 'Meseta' },
    { cod: 'PIM', nom: 'Pastura implantada' },
    { cod: 'BOR', nom: 'Bordura / alambrado' },
    { cod: 'PUR', nom: 'Periurbano' }
  ];

  // Escala cualitativa de la recorrida lineal (punto 2 de "Determinacion
  // de la densidad absoluta" del Programa).
  var ESCALA_PASOS = [
    { cod: '1', nom: '1 - No saltan tucuras en la mayoria de los pasos (sin accion)' },
    { cod: '2', nom: '2 - Un par de tucuras cada 5 pasos (observar la semana siguiente)' },
    { cod: '3', nom: '3 - En la mayoria de los pasos salta alguna (controlar)' },
    { cod: '4', nom: '4 - En cada paso saltan varias (controlar de inmediato)' }
  ];

  // Localidades y parajes de la red de monitoreo provincial.
  var ZONAS = [
    'Cushamen', 'Ranquil Huao', 'El Maiten', 'Gualjaina', 'Telsen', 'Gastre',
    'Gan Gan', 'Talagapa', 'Lagunita Salada', 'El Mirasol', 'Paso de Indios',
    'Paso del Sapo', 'Colan Conhue', 'Tecka', 'Languineo', 'Tehuelches',
    'El Escorial', 'Valle de Genoa', 'Jose de San Martin', 'Rio Pico'
  ];

  // Umbral de control del Programa: 8 a 10 tucuras/m2.
  var UMBRAL_MIN = 8, UMBRAL_MAX = 10;

  function nivelDensidad(d) {
    if (d == null || isNaN(d)) return { cod: 'SD', nom: 'Sin dato', color: '#8a8f98' };
    if (d < UMBRAL_MIN) return { cod: 'BAJO', nom: 'Bajo (debajo del umbral)', color: '#2f9e5e' };
    if (d <= 15) return { cod: 'UMBRAL', nom: 'En umbral de control', color: '#e8a82c' };
    if (d <= 30) return { cod: 'ALTO', nom: 'Alto', color: '#e2701e' };
    return { cod: 'MUYALTO', nom: 'Muy alto', color: '#cf2d2d' };
  }

  function nombrePorCod(lista, cod) {
    for (var i = 0; i < lista.length; i++) if (lista[i].cod === cod) return lista[i].nom;
    return '';
  }

  /* ============ Utilidades ============ */

  function dos(n) { return (n < 10 ? '0' : '') + n; }

  function fechaHora(d) {
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  function fechaISO(d) {
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) +
      'T' + dos(d.getHours()) + ':' + dos(d.getMinutes()) + ':' + dos(d.getSeconds());
  }

  // Identificador corto y legible: TUC-AAMMDD-HHMM-XXX
  function nuevoId(d) {
    var letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', suf = '';
    for (var i = 0; i < 3; i++) suf += letras.charAt(Math.floor(Math.random() * letras.length));
    return 'TUC-' + String(d.getFullYear()).slice(2) + dos(d.getMonth() + 1) + dos(d.getDate()) +
      '-' + dos(d.getHours()) + dos(d.getMinutes()) + '-' + suf;
  }

  function coord(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(6) : ''; }

  /* ============ Mensaje para WhatsApp ============ */

  // La ultima linea es el "codigo" que lee el software de mapeo. Los campos
  // van en posiciones fijas separadas por "|"; los valores no pueden
  // contener "|" ni saltos de linea.
  function limpiarCampo(v) {
    return String(v == null ? '' : v).replace(/[|\r\n]+/g, ' ').trim();
  }

  var ORDEN_CODIGO = ['id', 'lat', 'lon', 'acc', 'fecha', 'zona', 'establecimiento',
    'especie', 'estadio', 'densidad', 'metodo', 'ambiente', 'superficie',
    'monitoreador', 'observaciones'];

  function lineaCodigo(r) {
    var v = ORDEN_CODIGO.map(function (k) {
      if (k === 'lat') return coord(r.lat);
      if (k === 'lon') return coord(r.lon);
      if (k === 'acc') return r.acc != null ? Math.round(r.acc) : '';
      return limpiarCampo(r[k]);
    });
    return '#TUCURA|1|' + v.join('|');
  }

  function construirMensaje(r) {
    var d = r.fecha ? new Date(r.fecha) : new Date();
    var L = [];
    L.push('MONITOREO DE TUCURAS - CHUBUT');
    L.push('Programa Provincial MIP Tucuras');
    L.push('');
    L.push('ID: ' + r.id);
    L.push('Fecha de captura: ' + fechaHora(d));
    if (r.lat != null && r.lon != null) {
      L.push('Coordenadas: ' + coord(r.lat) + ', ' + coord(r.lon) +
        (r.acc != null ? ' (+/- ' + Math.round(r.acc) + ' m)' : ''));
      L.push('Mapa: https://www.google.com/maps?q=' + coord(r.lat) + ',' + coord(r.lon));
    } else {
      L.push('Coordenadas: SIN UBICACION');
    }
    if (r.zona) L.push('Zona / paraje: ' + r.zona);
    if (r.establecimiento) L.push('Establecimiento: ' + r.establecimiento);
    if (r.ambiente) L.push('Ambiente: ' + nombrePorCod(AMBIENTES, r.ambiente));
    if (r.especie) L.push('Especie: ' + nombrePorCod(ESPECIES, r.especie));
    if (r.estadio) L.push('Estadio: ' + nombrePorCod(ESTADIOS, r.estadio));

    if (r.densidad !== '' && r.densidad != null) {
      var dens = Number(r.densidad);
      var nv = nivelDensidad(dens);
      var linea = 'Densidad: ' + dens + ' tucuras/m2';
      if (r.metodo) linea += ' (' + nombrePorCod(METODOS, r.metodo) + ')';
      L.push(linea);
      L.push('Nivel: ' + nv.nom +
        (dens >= UMBRAL_MIN ? ' - SUPERA EL UMBRAL DE CONTROL (' + UMBRAL_MIN + '-' + UMBRAL_MAX + '/m2)' : ''));
    } else if (r.metodo === 'PAS' && r.escalaPasos) {
      L.push('Recorrida lineal: ' + nombrePorCod(ESCALA_PASOS, r.escalaPasos));
    }

    if (r.superficie) L.push('Superficie afectada estimada: ' + r.superficie + ' ha');
    if (r.monitoreador) L.push('Monitoreador: ' + r.monitoreador);
    if (r.observaciones) L.push('Observaciones: ' + r.observaciones);
    L.push('');
    L.push(lineaCodigo(r));
    return L.join('\n');
  }

  // Texto corto que se escribe en el EXIF (ImageDescription, campo ASCII).
  function descripcionExif(r) {
    var p = ['Monitoreo tucuras Chubut', r.id];
    if (r.zona) p.push(r.zona);
    if (r.estadio) p.push(nombrePorCod(ESTADIOS, r.estadio));
    if (r.densidad !== '' && r.densidad != null) p.push(r.densidad + ' tucuras/m2');
    return p.join(' - ');
  }

  /* ============ Exportaciones ============ */

  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  var COLUMNAS = [
    ['id', 'ID'], ['fecha', 'Fecha'], ['lat', 'Latitud'], ['lon', 'Longitud'],
    ['acc', 'Precision_m'], ['alt', 'Altitud_m'], ['zona', 'Zona'],
    ['establecimiento', 'Establecimiento'], ['ambiente', 'Ambiente'],
    ['especie', 'Especie'], ['estadio', 'Estadio'], ['densidad', 'Densidad_tucuras_m2'],
    ['nivel', 'Nivel'], ['metodo', 'Metodo'], ['superficie', 'Superficie_ha'],
    ['monitoreador', 'Monitoreador'], ['observaciones', 'Observaciones'],
    ['archivo', 'Archivo_foto']
  ];

  function filaPlana(r) {
    var dens = (r.densidad === '' || r.densidad == null) ? null : Number(r.densidad);
    return {
      id: r.id,
      fecha: r.fecha ? fechaISO(new Date(r.fecha)) : '',
      lat: coord(r.lat), lon: coord(r.lon),
      acc: r.acc != null ? Math.round(r.acc) : '',
      alt: r.alt != null ? Math.round(r.alt) : '',
      zona: r.zona || '', establecimiento: r.establecimiento || '',
      ambiente: nombrePorCod(AMBIENTES, r.ambiente),
      especie: nombrePorCod(ESPECIES, r.especie),
      estadio: nombrePorCod(ESTADIOS, r.estadio),
      densidad: dens != null ? dens : '',
      nivel: nivelDensidad(dens).nom,
      metodo: nombrePorCod(METODOS, r.metodo),
      superficie: r.superficie || '',
      monitoreador: r.monitoreador || '',
      observaciones: r.observaciones || '',
      archivo: r.id + '.jpg'
    };
  }

  // Se usa ";" como separador porque Excel en configuracion regional
  // castellana lo espera; el BOM evita que rompa con los acentos.
  function aCSV(registros) {
    var out = [COLUMNAS.map(function (c) { return c[1]; }).join(';')];
    registros.forEach(function (r) {
      var f = filaPlana(r);
      out.push(COLUMNAS.map(function (c) { return csvEscape(f[c[0]]); }).join(';'));
    });
    return '﻿' + out.join('\r\n');
  }

  function aGeoJSON(registros) {
    var feats = registros.filter(function (r) { return r.lat != null && r.lon != null; })
      .map(function (r) {
        var f = filaPlana(r);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(coord(r.lon)), Number(coord(r.lat))] },
          properties: f
        };
      });
    return JSON.stringify({ type: 'FeatureCollection', name: 'Focos de tucuras - Chubut', features: feats }, null, 2);
  }

  function xmlEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function aKML(registros) {
    var estilos = ['BAJO:2f9e5e', 'UMBRAL:e8a82c', 'ALTO:e2701e', 'MUYALTO:cf2d2d', 'SD:8a8f98']
      .map(function (e) {
        var p = e.split(':'), c = p[1];
        // KML usa aabbggrr
        var kml = 'ff' + c.slice(4, 6) + c.slice(2, 4) + c.slice(0, 2);
        return '<Style id="' + p[0] + '"><IconStyle><color>' + kml + '</color><scale>1.1</scale>' +
          '<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>' +
          '</IconStyle></Style>';
      }).join('\n');

    var marcas = registros.filter(function (r) { return r.lat != null && r.lon != null; })
      .map(function (r) {
        var f = filaPlana(r);
        var dens = (r.densidad === '' || r.densidad == null) ? null : Number(r.densidad);
        var desc = COLUMNAS.map(function (c) { return c[1] + ': ' + f[c[0]]; }).join('\n');
        return '<Placemark><name>' + xmlEsc(r.id + (dens != null ? ' (' + dens + '/m2)' : '')) + '</name>' +
          '<styleUrl>#' + nivelDensidad(dens).cod + '</styleUrl>' +
          '<description>' + xmlEsc(desc) + '</description>' +
          '<Point><coordinates>' + coord(r.lon) + ',' + coord(r.lat) + ',0</coordinates></Point></Placemark>';
      }).join('\n');

    return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n' +
      '<name>Focos de tucuras - Chubut</name>\n' + estilos + '\n' + marcas + '\n</Document>\n</kml>';
  }

  /* ============ Almacenamiento local (IndexedDB) ============ */

  var DB_NOMBRE = 'tucuras-monitoreo', DB_VERSION = 1, TIENDA = 'registros';

  function abrir() {
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB_NOMBRE, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(TIENDA)) {
          var st = db.createObjectStore(TIENDA, { keyPath: 'id' });
          st.createIndex('fecha', 'fecha');
        }
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function conTienda(modo, fn) {
    return abrir().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(TIENDA, modo);
        var st = tx.objectStore(TIENDA);
        var salida = fn(st);
        tx.oncomplete = function () { db.close(); res(salida && salida.result !== undefined ? salida.result : salida); };
        tx.onerror = function () { db.close(); rej(tx.error); };
        tx.onabort = function () { db.close(); rej(tx.error); };
      });
    });
  }

  var Store = {
    guardar: function (reg) { return conTienda('readwrite', function (st) { st.put(reg); return reg; }); },
    borrar: function (id) { return conTienda('readwrite', function (st) { st.delete(id); }); },
    obtener: function (id) {
      return conTienda('readonly', function (st) { return st.get(id); });
    },
    todos: function () {
      return conTienda('readonly', function (st) { return st.getAll(); }).then(function (arr) {
        arr = arr || [];
        arr.sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); });
        return arr;
      });
    },
    limpiar: function () { return conTienda('readwrite', function (st) { st.clear(); }); }
  };

  global.Tucuras = {
    ESPECIES: ESPECIES, ESTADIOS: ESTADIOS, METODOS: METODOS, AMBIENTES: AMBIENTES,
    ESCALA_PASOS: ESCALA_PASOS, ZONAS: ZONAS,
    UMBRAL_MIN: UMBRAL_MIN, UMBRAL_MAX: UMBRAL_MAX,
    nivelDensidad: nivelDensidad, nombrePorCod: nombrePorCod,
    nuevoId: nuevoId, fechaHora: fechaHora, fechaISO: fechaISO, coord: coord, dos: dos,
    construirMensaje: construirMensaje, lineaCodigo: lineaCodigo, descripcionExif: descripcionExif,
    aCSV: aCSV, aGeoJSON: aGeoJSON, aKML: aKML, filaPlana: filaPlana, COLUMNAS: COLUMNAS,
    Store: Store
  };
})(typeof window !== 'undefined' ? window : this);
