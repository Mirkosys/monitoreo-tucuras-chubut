/* =====================================================================
   exif.js  —  Escritor de metadatos EXIF (incluye GPS) para JPEG
   App Monitoreo Tucuras — Programa Provincial MIP Tucuras, Chubut

   Sin dependencias. Construye un segmento APP1 (Exif) completo con
   IFD0 + Exif IFD + GPS IFD y lo inserta en el JPEG que genera
   canvas.toBlob(), que por definicion sale sin metadatos.

   Formato: TIFF little-endian ("II"), segun Exif 2.32 / JEITA CP-3451.
   ===================================================================== */
(function (global) {
  'use strict';

  var T_BYTE = 1, T_ASCII = 2, T_SHORT = 3, T_LONG = 4, T_RATIONAL = 5, T_UNDEFINED = 7;

  /* ---------------- utilidades de bytes ---------------- */

  // Los campos ASCII del EXIF son de 7 bits: transliteramos acentos para
  // que no aparezcan como basura en visores estrictos (exiftool, Windows).
  var DEACCENT = {
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
    'ü': 'u', 'ñ': 'n',
    'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
    'Ü': 'U', 'Ñ': 'N',
    'º': 'o', 'ª': 'a', '°': ' ', '²': '2', '·': '-',
    '–': '-', '—': '-', '“': '"', '”': '"', '’': "'"
  };

  function deaccent(str) {
    return String(str == null ? '' : str).replace(/[^\x20-\x7E]/g, function (c) {
      return DEACCENT[c] !== undefined ? DEACCENT[c] : '?';
    });
  }

  function asciiBytes(str) {
    var s = deaccent(str), out = new Uint8Array(s.length + 1);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7F;
    out[s.length] = 0; // NUL final obligatorio
    return out;
  }

  // UserComment: 8 bytes de codigo de caracteres + texto. Usamos UNICODE
  // (UTF-16LE) para guardar el registro completo con acentos.
  function userCommentBytes(str) {
    var s = String(str == null ? '' : str);
    var out = new Uint8Array(8 + s.length * 2);
    out.set([0x55, 0x4E, 0x49, 0x43, 0x4F, 0x44, 0x45, 0x00], 0); // UNICODE + NUL
    var dv = new DataView(out.buffer);
    for (var i = 0; i < s.length; i++) dv.setUint16(8 + i * 2, s.charCodeAt(i), true);
    return out;
  }

  function shortBytes(values) {
    var arr = [].concat(values), out = new Uint8Array(arr.length * 2);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < arr.length; i++) dv.setUint16(i * 2, arr[i] & 0xFFFF, true);
    return out;
  }

  function longBytes(values) {
    var arr = [].concat(values), out = new Uint8Array(arr.length * 4);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < arr.length; i++) dv.setUint32(i * 4, arr[i] >>> 0, true);
    return out;
  }

  function byteBytes(values) { return new Uint8Array([].concat(values)); }

  // pairs: [[numerador, denominador], ...]
  function rationalBytes(pairs) {
    var out = new Uint8Array(pairs.length * 8);
    var dv = new DataView(out.buffer);
    for (var i = 0; i < pairs.length; i++) {
      dv.setUint32(i * 8, pairs[i][0] >>> 0, true);
      dv.setUint32(i * 8 + 4, pairs[i][1] >>> 0, true);
    }
    return out;
  }

  /* ---------------- armado de un IFD ---------------- */

  function pad2(n) { return n + (n % 2); }

  // entries: [{tag, type, count, data:Uint8Array}]
  function ifdSize(entries) {
    var size = 2 + entries.length * 12 + 4;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].data.length > 4) size += pad2(entries[i].data.length);
    }
    return size;
  }

  // ifdOffset: desplazamiento del IFD respecto del inicio del header TIFF
  function writeIFD(entries, ifdOffset) {
    entries = entries.slice().sort(function (a, b) { return a.tag - b.tag; });
    var buf = new Uint8Array(ifdSize(entries));
    var dv = new DataView(buf.buffer);
    var dataPos = 2 + entries.length * 12 + 4; // area de datos, relativa al IFD

    dv.setUint16(0, entries.length, true);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], p = 2 + i * 12;
      dv.setUint16(p, e.tag, true);
      dv.setUint16(p + 2, e.type, true);
      dv.setUint32(p + 4, e.count, true);
      if (e.data.length <= 4) {
        buf.set(e.data, p + 8); // valor embebido, alineado a la izquierda
      } else {
        dv.setUint32(p + 8, ifdOffset + dataPos, true);
        buf.set(e.data, dataPos);
        dataPos += pad2(e.data.length);
      }
    }
    dv.setUint32(2 + entries.length * 12, 0, true); // no hay IFD siguiente
    return buf;
  }

  /* ---------------- coordenadas y fechas ---------------- */

  function degToDMSRational(deg) {
    var abs = Math.abs(deg);
    var d = Math.floor(abs);
    var rem = (abs - d) * 60;
    var m = Math.floor(rem);
    var sNum = Math.round((rem - m) * 60 * 10000); // segundos con 4 decimales
    if (sNum >= 600000) { sNum -= 600000; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    return [[d, 1], [m, 1], [sNum, 10000]];
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function exifDateTime(date) {
    return date.getFullYear() + ':' + two(date.getMonth() + 1) + ':' + two(date.getDate()) +
      ' ' + two(date.getHours()) + ':' + two(date.getMinutes()) + ':' + two(date.getSeconds());
  }

  function gpsDateStamp(date) {
    return date.getUTCFullYear() + ':' + two(date.getUTCMonth() + 1) + ':' + two(date.getUTCDate());
  }

  /* ---------------- construccion del APP1 ---------------- */

  /**
   * opts = {
   *   lat, lon        grados decimales (necesarios para escribir el GPS IFD)
   *   altitude        metros sobre el nivel del mar (opcional)
   *   accuracy        error horizontal en metros (opcional)
   *   date            Date del momento de captura
   *   description     ImageDescription, texto corto ASCII
   *   userComment     registro completo, admite acentos
   *   make, model, software, width, height
   * }
   */
  function buildExifAPP1(opts) {
    opts = opts || {};
    var date = opts.date instanceof Date ? opts.date : new Date();
    var dt = exifDateTime(date);

    /* --- GPS IFD --- */
    var gps = [];
    var hasGPS = typeof opts.lat === 'number' && typeof opts.lon === 'number' &&
                 isFinite(opts.lat) && isFinite(opts.lon);
    if (hasGPS) {
      gps.push({ tag: 0x0000, type: T_BYTE, count: 4, data: byteBytes([2, 3, 0, 0]) });
      gps.push({ tag: 0x0001, type: T_ASCII, count: 2, data: asciiBytes(opts.lat >= 0 ? 'N' : 'S') });
      gps.push({ tag: 0x0002, type: T_RATIONAL, count: 3, data: rationalBytes(degToDMSRational(opts.lat)) });
      gps.push({ tag: 0x0003, type: T_ASCII, count: 2, data: asciiBytes(opts.lon >= 0 ? 'E' : 'W') });
      gps.push({ tag: 0x0004, type: T_RATIONAL, count: 3, data: rationalBytes(degToDMSRational(opts.lon)) });

      if (typeof opts.altitude === 'number' && isFinite(opts.altitude)) {
        gps.push({ tag: 0x0005, type: T_BYTE, count: 1, data: byteBytes([opts.altitude < 0 ? 1 : 0]) });
        gps.push({ tag: 0x0006, type: T_RATIONAL, count: 1,
                   data: rationalBytes([[Math.round(Math.abs(opts.altitude) * 100), 100]]) });
      }

      // GPSTimeStamp va siempre en UTC
      gps.push({ tag: 0x0007, type: T_RATIONAL, count: 3, data: rationalBytes([
        [date.getUTCHours(), 1],
        [date.getUTCMinutes(), 1],
        [Math.round(date.getUTCSeconds() * 100), 100]
      ]) });

      gps.push({ tag: 0x0012, type: T_ASCII, count: 7, data: asciiBytes('WGS-84') });
      gps.push({ tag: 0x001D, type: T_ASCII, count: 11, data: asciiBytes(gpsDateStamp(date)) });

      if (typeof opts.accuracy === 'number' && isFinite(opts.accuracy) && opts.accuracy > 0) {
        gps.push({ tag: 0x001F, type: T_RATIONAL, count: 1,
                   data: rationalBytes([[Math.round(opts.accuracy * 100), 100]]) });
      }
    }

    /* --- Exif IFD --- */
    var exif = [];
    exif.push({ tag: 0x9000, type: T_UNDEFINED, count: 4, data: new Uint8Array([0x30, 0x32, 0x33, 0x32]) });
    exif.push({ tag: 0x9003, type: T_ASCII, count: 20, data: asciiBytes(dt) }); // DateTimeOriginal
    exif.push({ tag: 0x9004, type: T_ASCII, count: 20, data: asciiBytes(dt) }); // DateTimeDigitized
    if (opts.userComment) {
      var uc = userCommentBytes(opts.userComment);
      exif.push({ tag: 0x9286, type: T_UNDEFINED, count: uc.length, data: uc });
    }
    if (opts.width)  exif.push({ tag: 0xA002, type: T_LONG, count: 1, data: longBytes([opts.width]) });
    if (opts.height) exif.push({ tag: 0xA003, type: T_LONG, count: 1, data: longBytes([opts.height]) });

    /* --- IFD0 --- */
    var ifd0 = [];
    if (opts.description) {
      var dsc = asciiBytes(opts.description);
      ifd0.push({ tag: 0x010E, type: T_ASCII, count: dsc.length, data: dsc });
    }
    var mk = asciiBytes(opts.make || 'Monitoreo Tucuras Chubut');
    ifd0.push({ tag: 0x010F, type: T_ASCII, count: mk.length, data: mk });
    var md = asciiBytes(opts.model || 'App de campo');
    ifd0.push({ tag: 0x0110, type: T_ASCII, count: md.length, data: md });
    ifd0.push({ tag: 0x0112, type: T_SHORT, count: 1, data: shortBytes([1]) });             // Orientation
    ifd0.push({ tag: 0x011A, type: T_RATIONAL, count: 1, data: rationalBytes([[72, 1]]) });
    ifd0.push({ tag: 0x011B, type: T_RATIONAL, count: 1, data: rationalBytes([[72, 1]]) });
    ifd0.push({ tag: 0x0128, type: T_SHORT, count: 1, data: shortBytes([2]) });             // ResolutionUnit
    var sw = asciiBytes(opts.software || 'App Monitoreo Tucuras - Chubut v1');
    ifd0.push({ tag: 0x0131, type: T_ASCII, count: sw.length, data: sw });
    ifd0.push({ tag: 0x0132, type: T_ASCII, count: 20, data: asciiBytes(dt) });             // DateTime

    // Punteros: el valor real se completa cuando conocemos el layout.
    var exifPtr = { tag: 0x8769, type: T_LONG, count: 1, data: longBytes([0]) };
    ifd0.push(exifPtr);
    var gpsPtr = null;
    if (hasGPS) {
      gpsPtr = { tag: 0x8825, type: T_LONG, count: 1, data: longBytes([0]) };
      ifd0.push(gpsPtr);
    }

    /* --- layout --- */
    var ifd0Size = ifdSize(ifd0);
    var exifOffset = 8 + ifd0Size;
    var exifSize = ifdSize(exif);
    var gpsOffset = exifOffset + exifSize;
    var gpsSize = hasGPS ? ifdSize(gps) : 0;

    exifPtr.data = longBytes([exifOffset]);
    if (gpsPtr) gpsPtr.data = longBytes([gpsOffset]);

    var tiffSize = 8 + ifd0Size + exifSize + gpsSize;
    var tiff = new Uint8Array(tiffSize);
    var tdv = new DataView(tiff.buffer);
    tdv.setUint16(0, 0x4949, true); // II = little endian
    tdv.setUint16(2, 0x002A, true);
    tdv.setUint32(4, 8, true);      // offset del IFD0
    tiff.set(writeIFD(ifd0, 8), 8);
    tiff.set(writeIFD(exif, exifOffset), exifOffset);
    if (hasGPS) tiff.set(writeIFD(gps, gpsOffset), gpsOffset);

    // APP1 = FFE1 + longitud(2) + "Exif" + 2 NUL + TIFF
    var payloadLen = 2 + 6 + tiffSize;
    if (payloadLen > 65535) throw new Error('El bloque EXIF supera los 64 KB');
    var app1 = new Uint8Array(2 + payloadLen);
    app1[0] = 0xFF; app1[1] = 0xE1;
    app1[2] = (payloadLen >> 8) & 0xFF;
    app1[3] = payloadLen & 0xFF;
    app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4); // "Exif" + 2 NUL
    app1.set(tiff, 10);
    return app1;
  }

  /* ---------------- insercion en el JPEG ---------------- */

  function insertAPP1(jpegBytes, app1) {
    if (jpegBytes[0] !== 0xFF || jpegBytes[1] !== 0xD8) throw new Error('El archivo no es un JPEG');

    // Recorremos los segmentos de cabecera y descartamos un APP1/Exif previo.
    var pos = 2, cutStart = -1, cutEnd = -1;
    while (pos < jpegBytes.length - 3) {
      if (jpegBytes[pos] !== 0xFF) break;
      var marker = jpegBytes[pos + 1];
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { pos += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break; // empieza el scan
      var len = (jpegBytes[pos + 2] << 8) | jpegBytes[pos + 3];
      if (len < 2) break;
      if (marker === 0xE1 &&
          jpegBytes[pos + 4] === 0x45 && jpegBytes[pos + 5] === 0x78 &&
          jpegBytes[pos + 6] === 0x69 && jpegBytes[pos + 7] === 0x66) {
        cutStart = pos; cutEnd = pos + 2 + len;
        break;
      }
      pos += 2 + len;
    }

    var rest;
    if (cutStart >= 0) {
      rest = new Uint8Array(jpegBytes.length - 2 - (cutEnd - cutStart));
      rest.set(jpegBytes.subarray(2, cutStart), 0);
      rest.set(jpegBytes.subarray(cutEnd), cutStart - 2);
    } else {
      rest = jpegBytes.subarray(2);
    }

    var out = new Uint8Array(2 + app1.length + rest.length);
    out[0] = 0xFF; out[1] = 0xD8;
    out.set(app1, 2);
    out.set(rest, 2 + app1.length);
    return out;
  }

  /** Devuelve un Blob JPEG nuevo con el EXIF pedido. */
  function addExifToJpegBlob(blob, opts) {
    return blob.arrayBuffer().then(function (ab) {
      return new Blob([insertAPP1(new Uint8Array(ab), buildExifAPP1(opts))], { type: 'image/jpeg' });
    });
  }

  global.ExifWriter = {
    buildExifAPP1: buildExifAPP1,
    insertAPP1: insertAPP1,
    addExifToJpegBlob: addExifToJpegBlob,
    exifDateTime: exifDateTime,
    deaccent: deaccent
  };
})(typeof window !== 'undefined' ? window : this);
