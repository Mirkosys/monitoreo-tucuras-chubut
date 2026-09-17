/* =====================================================================
   codigo-optico.js — Coordenadas grabadas en los propios píxeles de la foto
   App Monitoreo Tucuras (Chubut)

   PARA QUÉ EXISTE
   WhatsApp recomprime las imágenes que viajan como foto y les borra el EXIF
   entero, ubicación incluida. Cuando a la oficina le llega sólo la imagen,
   sin el texto del mensaje, la ubicación se perdía.

   Esta tira de cuadrados en el borde inferior guarda las coordenadas en la
   propia imagen. Sobrevive a la recompresión porque no depende de leer
   texto: son bloques grandes de blanco y negro, y WhatsApp reescala pero no
   recorta ni rota, así que la geometría relativa se mantiene intacta.

   FORMATO (83 celdas a lo ancho de la imagen)
     4 celdas de sincronismo   1 0 1 0
     75 celdas de datos:
          4 bits  versión (2)
         25 bits  latitud   = round(lat * 100000) + 9.000.000
         26 bits  longitud  = round(lon * 100000) + 18.000.000
         15 bits  fecha     = días transcurridos desde el 1/1/2020
          5 bits  verificación (suma módulo 31)
     4 celdas de sincronismo   0 1 0 1

   Precisión: 1e-5 grados, algo más de un metro. Un bit en 1 se dibuja negro.
   La fecha va porque sin ella el foco recuperado no cae en ninguna campaña,
   y la temporada es justamente lo que ordena el registro provincial.
   ===================================================================== */
(function (global) {
  'use strict';

  var VERSION = 2;
  var SYNC_INI = [1, 0, 1, 0];
  var SYNC_FIN = [0, 1, 0, 1];
  var BITS_DATOS = 75;
  var TOTAL = SYNC_INI.length + BITS_DATOS + SYNC_FIN.length; // 83

  var BITS_VERSION = 4, BITS_LAT = 25, BITS_LON = 26, BITS_FECHA = 15, BITS_SUMA = 5;
  var BASE_LAT = 9000000, BASE_LON = 18000000;
  var ESCALA = 100000;
  var DIA = 86400000;
  var ORIGEN_FECHA = Date.UTC(2020, 0, 1);
  var MAX_DIAS = Math.pow(2, BITS_FECHA) - 1;   // hasta el año 2109

  /** Alto de la tira, proporcional a la imagen: sobrevive al reescalado. */
  function altoTira(h) {
    return Math.max(10, Math.round(h * 0.014));
  }

  /* ---------------- bits ---------------- */

  // Sin operadores de bits: los índices pasan de 2^25 y en JavaScript los
  // desplazamientos trabajan sobre enteros de 32 bits con signo.
  function aBits(valor, n) {
    var salida = [];
    for (var i = n - 1; i >= 0; i--) {
      salida.push(Math.floor(valor / Math.pow(2, i)) % 2);
    }
    return salida;
  }

  function deBits(bits, desde, n) {
    var v = 0;
    for (var i = 0; i < n; i++) v = v * 2 + bits[desde + i];
    return v;
  }

  function verificacion(latIdx, lonIdx, dias) {
    return (VERSION + latIdx + lonIdx + dias) % 31;
  }

  // 0 significa "sin fecha": se guarda el día, no la hora.
  function aDias(fecha) {
    if (!fecha) return 0;
    var f = fecha instanceof Date ? fecha : new Date(fecha);
    if (isNaN(f.getTime())) return 0;
    var utc = Date.UTC(f.getFullYear(), f.getMonth(), f.getDate());
    var dias = Math.round((utc - ORIGEN_FECHA) / DIA) + 1;
    return (dias < 1 || dias > MAX_DIAS) ? 0 : dias;
  }

  function deDias(dias) {
    if (!dias) return '';
    var f = new Date(ORIGEN_FECHA + (dias - 1) * DIA);
    var dos = function (n) { return (n < 10 ? '0' : '') + n; };
    return f.getUTCFullYear() + '-' + dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate());
  }

  function codificar(lat, lon, fecha) {
    var latIdx = Math.round(lat * ESCALA) + BASE_LAT;
    var lonIdx = Math.round(lon * ESCALA) + BASE_LON;
    if (latIdx < 0 || latIdx >= Math.pow(2, BITS_LAT)) return null;
    if (lonIdx < 0 || lonIdx >= Math.pow(2, BITS_LON)) return null;
    var dias = aDias(fecha);
    return aBits(VERSION, BITS_VERSION)
      .concat(aBits(latIdx, BITS_LAT))
      .concat(aBits(lonIdx, BITS_LON))
      .concat(aBits(dias, BITS_FECHA))
      .concat(aBits(verificacion(latIdx, lonIdx, dias), BITS_SUMA));
  }

  function decodificar(bits) {
    if (!bits || bits.length !== BITS_DATOS) return null;
    if (deBits(bits, 0, BITS_VERSION) !== VERSION) return null;
    var p = BITS_VERSION;
    var latIdx = deBits(bits, p, BITS_LAT); p += BITS_LAT;
    var lonIdx = deBits(bits, p, BITS_LON); p += BITS_LON;
    var dias = deBits(bits, p, BITS_FECHA); p += BITS_FECHA;
    var suma = deBits(bits, p, BITS_SUMA);
    if (suma !== verificacion(latIdx, lonIdx, dias)) return null;

    var lat = (latIdx - BASE_LAT) / ESCALA;
    var lon = (lonIdx - BASE_LON) / ESCALA;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat: lat, lon: lon, fecha: deDias(dias) };
  }

  /* ---------------- dibujo ---------------- */

  /**
   * Dibuja la tira en el borde inferior del lienzo.
   * Devuelve el alto ocupado, para que la marca de agua se corra hacia arriba.
   */
  function dibujar(ctx, w, h, lat, lon, fecha) {
    var datos = codificar(lat, lon, fecha);
    if (!datos) return 0;

    var alto = altoTira(h);
    var y = h - alto;
    var celda = w / TOTAL;
    var bits = SYNC_INI.concat(datos).concat(SYNC_FIN);

    // Fondo blanco parejo: los ceros tienen que ser blanco definido, no lo
    // que haya debajo en la foto.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, w, alto);
    ctx.fillStyle = '#000000';
    for (var i = 0; i < bits.length; i++) {
      if (!bits[i]) continue;
      var x0 = Math.round(i * celda);
      var x1 = Math.round((i + 1) * celda);
      ctx.fillRect(x0, y, Math.max(1, x1 - x0), alto);
    }
    return alto;
  }

  /* ---------------- lectura ---------------- */

  function luminancia(d, p) {
    return 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }

  /**
   * Lee la tira de un ImageData completo de la foto.
   * Devuelve {lat, lon, fecha} o null si no hay tira legible.
   */
  function leerImageData(img) {
    var w = img.width, h = img.height, d = img.data;
    if (w < TOTAL * 3 || h < 30) return null;   // demasiado chica para tener tira

    var alto = altoTira(h);
    var y0 = h - alto;
    var ya = Math.max(0, Math.round(y0 + alto * 0.25));
    var yb = Math.min(h - 1, Math.round(y0 + alto * 0.75));
    var celda = w / TOTAL;

    // Promedio del centro de cada celda: el borde se descarta porque ahí es
    // donde el JPEG deja los artefactos de la transición blanco/negro.
    var muestras = [];
    for (var i = 0; i < TOTAL; i++) {
      var cx = (i + 0.5) * celda;
      var xa = Math.max(0, Math.round(cx - celda * 0.25));
      var xb = Math.min(w - 1, Math.round(cx + celda * 0.25));
      var suma = 0, n = 0;
      for (var y = ya; y <= yb; y++) {
        var fila = y * w * 4;
        for (var x = xa; x <= xb; x++) {
          suma += luminancia(d, fila + x * 4);
          n++;
        }
      }
      muestras.push(n ? suma / n : 255);
    }

    // El umbral sale de las propias celdas de sincronismo, que sabemos de
    // qué color son: así no depende del brillo de la foto ni de la compresión.
    var negros = [], blancos = [];
    function clasificar(patron, base) {
      for (var k = 0; k < patron.length; k++) {
        (patron[k] ? negros : blancos).push(muestras[base + k]);
      }
    }
    clasificar(SYNC_INI, 0);
    clasificar(SYNC_FIN, TOTAL - SYNC_FIN.length);

    var prom = function (a) {
      return a.reduce(function (s, v) { return s + v; }, 0) / a.length;
    };
    var mNegro = prom(negros), mBlanco = prom(blancos);
    if (mBlanco - mNegro < 40) return null;     // sin contraste: no hay tira

    var umbral = (mNegro + mBlanco) / 2;
    var bits = muestras.map(function (m) { return m < umbral ? 1 : 0; });

    // El sincronismo tiene que dar exacto; si no, estamos leyendo cualquier cosa.
    for (var s = 0; s < SYNC_INI.length; s++) {
      if (bits[s] !== SYNC_INI[s]) return null;
      if (bits[TOTAL - SYNC_FIN.length + s] !== SYNC_FIN[s]) return null;
    }

    return decodificar(bits.slice(SYNC_INI.length, SYNC_INI.length + BITS_DATOS));
  }

  /** Lee la tira de una imagen ya decodificada (ImageBitmap o HTMLImageElement). */
  function leerImagen(img) {
    var w = img.width || img.naturalWidth;
    var h = img.height || img.naturalHeight;
    if (!w || !h) return null;
    var lienzo = document.createElement('canvas');
    lienzo.width = w;
    lienzo.height = h;
    var ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    try {
      return leerImageData(ctx.getImageData(0, 0, w, h));
    } catch (e) {
      return null; // lienzo contaminado (imagen de otro origen)
    }
  }

  /** Lee la tira de un archivo de imagen. Devuelve una promesa. */
  function leerArchivo(file) {
    var decodificarArchivo = global.createImageBitmap
      ? createImageBitmap(file)
      : new Promise(function (res, rej) {
          var url = URL.createObjectURL(file);
          var im = new Image();
          im.onload = function () { URL.revokeObjectURL(url); res(im); };
          im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('imagen ilegible')); };
          im.src = url;
        });
    return decodificarArchivo.then(function (img) {
      var r = leerImagen(img);
      if (img.close) img.close();
      return r;
    }).catch(function () { return null; });
  }

  global.CodigoOptico = {
    dibujar: dibujar,
    altoTira: altoTira,
    leerImageData: leerImageData,
    leerImagen: leerImagen,
    leerArchivo: leerArchivo,
    codificar: codificar,
    decodificar: decodificar,
    TOTAL: TOTAL
  };
})(typeof window !== 'undefined' ? window : this);
