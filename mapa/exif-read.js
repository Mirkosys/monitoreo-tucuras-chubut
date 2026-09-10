/* =====================================================================
   exif-read.js  —  Lector de metadatos EXIF de un JPEG
   App Monitoreo Tucuras — Programa Provincial MIP Tucuras, Chubut

   Extrae GPS (lat/lon/alt/precision), fecha de captura y los campos de
   texto que escribe la app de campo (ImageDescription / UserComment).
   Funciona tanto con fotos de esta app como con fotos sacadas por la
   camara nativa del telefono con la ubicacion activada.
   ===================================================================== */
(function (global) {
  'use strict';

  function readUint16(dv, off, le) { return dv.getUint16(off, le); }
  function readUint32(dv, off, le) { return dv.getUint32(off, le); }

  function typeSize(type) {
    switch (type) {
      case 1: case 2: case 6: case 7: return 1;
      case 3: case 8: return 2;
      case 4: case 9: return 4;
      case 5: case 10: return 8;
      case 11: return 4;
      case 12: return 8;
      default: return 1;
    }
  }

  function readValue(dv, tiffStart, entryOff, le) {
    var type = readUint16(dv, entryOff + 2, le);
    var count = readUint32(dv, entryOff + 4, le);
    var total = typeSize(type) * count;
    var valOff = total <= 4 ? entryOff + 8 : tiffStart + readUint32(dv, entryOff + 8, le);
    if (valOff + total > dv.byteLength) return null;

    var i, out;
    switch (type) {
      case 1: case 7: // BYTE / UNDEFINED
        out = [];
        for (i = 0; i < count; i++) out.push(dv.getUint8(valOff + i));
        return out;
      case 2: // ASCII
        var s = '';
        for (i = 0; i < count; i++) {
          var c = dv.getUint8(valOff + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s;
      case 3: // SHORT
        out = [];
        for (i = 0; i < count; i++) out.push(dv.getUint16(valOff + i * 2, le));
        return count === 1 ? out[0] : out;
      case 4: // LONG
        out = [];
        for (i = 0; i < count; i++) out.push(dv.getUint32(valOff + i * 4, le));
        return count === 1 ? out[0] : out;
      case 5: // RATIONAL
        out = [];
        for (i = 0; i < count; i++) {
          var num = dv.getUint32(valOff + i * 8, le);
          var den = dv.getUint32(valOff + i * 8 + 4, le);
          out.push(den === 0 ? 0 : num / den);
        }
        return count === 1 ? out[0] : out;
      case 10: // SRATIONAL
        out = [];
        for (i = 0; i < count; i++) {
          var n2 = dv.getInt32(valOff + i * 8, le);
          var d2 = dv.getInt32(valOff + i * 8 + 4, le);
          out.push(d2 === 0 ? 0 : n2 / d2);
        }
        return count === 1 ? out[0] : out;
      default:
        return null;
    }
  }

  // Decodifica el UserComment: 8 bytes de codigo de caracteres + texto.
  function decodeUserComment(bytes) {
    if (!bytes || bytes.length < 8) return '';
    var head = '';
    for (var i = 0; i < 8; i++) head += String.fromCharCode(bytes[i]);
    var body = bytes.slice(8), s = '', j;
    if (head.indexOf('UNICODE') === 0) {
      // UTF-16. El endianness sigue al del TIFF; probamos LE y caemos a BE.
      for (j = 0; j + 1 < body.length; j += 2) {
        s += String.fromCharCode(body[j] | (body[j + 1] << 8));
      }
      // Heuristica: si salio lleno de caracteres de control, era big-endian.
      if (/[Ā-￿]/.test(s) && !/[\x20-\x7E]/.test(s)) {
        s = '';
        for (j = 0; j + 1 < body.length; j += 2) {
          s += String.fromCharCode((body[j] << 8) | body[j + 1]);
        }
      }
    } else {
      for (j = 0; j < body.length; j++) {
        if (body[j] === 0) break;
        s += String.fromCharCode(body[j]);
      }
    }
    return s.replace(/\0+$/, '').trim();
  }

  function parseIFD(dv, tiffStart, ifdOffset, le, tags, out) {
    if (ifdOffset + 2 > dv.byteLength) return;
    var n = readUint16(dv, ifdOffset, le);
    if (ifdOffset + 2 + n * 12 > dv.byteLength) return;
    for (var i = 0; i < n; i++) {
      var entryOff = ifdOffset + 2 + i * 12;
      var tag = readUint16(dv, entryOff, le);
      var name = tags[tag];
      if (name) out[name] = readValue(dv, tiffStart, entryOff, le);
    }
  }

  var IFD0_TAGS = {
    0x010E: 'ImageDescription', 0x010F: 'Make', 0x0110: 'Model',
    0x0112: 'Orientation', 0x0131: 'Software', 0x0132: 'DateTime',
    0x8769: 'ExifIFDPointer', 0x8825: 'GPSInfoIFDPointer'
  };
  var EXIF_TAGS = {
    0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
    0x9286: 'UserComment', 0xA002: 'PixelXDimension', 0xA003: 'PixelYDimension'
  };
  var GPS_TAGS = {
    0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude',
    0x0005: 'GPSAltitudeRef', 0x0006: 'GPSAltitude',
    0x0007: 'GPSTimeStamp', 0x0012: 'GPSMapDatum',
    0x001D: 'GPSDateStamp', 0x001F: 'GPSHPositioningError'
  };

  function dmsToDeg(dms, ref) {
    if (!dms) return null;
    var arr = [].concat(dms);
    if (arr.length < 3) return null;
    var deg = arr[0] + arr[1] / 60 + arr[2] / 3600;
    if (ref === 'S' || ref === 'W') deg = -deg;
    return deg;
  }

  // "2026:09:10 14:23:05" -> Date local
  function parseExifDate(str) {
    if (!str) return null;
    var m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(str).trim());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  /**
   * Lee el EXIF de un ArrayBuffer de JPEG.
   * Devuelve null si no hay segmento Exif; si no, un objeto con los campos
   * encontrados mas lat/lon normalizados en grados decimales.
   */
  function readExif(arrayBuffer) {
    var dv = new DataView(arrayBuffer);
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null; // no es JPEG

    // Buscamos el segmento APP1 con firma Exif.
    var pos = 2, tiffStart = -1;
    while (pos < dv.byteLength - 3) {
      if (dv.getUint8(pos) !== 0xFF) break;
      var marker = dv.getUint8(pos + 1);
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { pos += 2; continue; }
      if (marker === 0xDA || marker === 0xD9) break;
      var len = dv.getUint16(pos + 2);
      if (len < 2) break;
      if (marker === 0xE1 && pos + 10 <= dv.byteLength &&
          dv.getUint32(pos + 4) === 0x45786966 && dv.getUint16(pos + 8) === 0x0000) {
        tiffStart = pos + 10;
        break;
      }
      pos += 2 + len;
    }
    if (tiffStart < 0) return null;

    var bom = dv.getUint16(tiffStart);
    if (bom !== 0x4949 && bom !== 0x4D4D) return null;
    var le = bom === 0x4949;
    if (readUint16(dv, tiffStart + 2, le) !== 0x002A) return null;

    var out = {};
    parseIFD(dv, tiffStart, tiffStart + readUint32(dv, tiffStart + 4, le), le, IFD0_TAGS, out);
    if (out.ExifIFDPointer) {
      parseIFD(dv, tiffStart, tiffStart + out.ExifIFDPointer, le, EXIF_TAGS, out);
    }
    if (out.GPSInfoIFDPointer) {
      parseIFD(dv, tiffStart, tiffStart + out.GPSInfoIFDPointer, le, GPS_TAGS, out);
    }

    if (Array.isArray(out.UserComment)) out.UserComment = decodeUserComment(out.UserComment);

    out.lat = dmsToDeg(out.GPSLatitude, out.GPSLatitudeRef);
    out.lon = dmsToDeg(out.GPSLongitude, out.GPSLongitudeRef);
    if (typeof out.GPSAltitude === 'number') {
      out.altitude = out.GPSAltitudeRef === 1 || (Array.isArray(out.GPSAltitudeRef) && out.GPSAltitudeRef[0] === 1)
        ? -out.GPSAltitude : out.GPSAltitude;
    }
    if (typeof out.GPSHPositioningError === 'number') out.accuracy = out.GPSHPositioningError;
    out.fecha = parseExifDate(out.DateTimeOriginal || out.DateTime);

    return out;
  }

  function readExifFromFile(file) {
    return file.arrayBuffer().then(function (ab) {
      try { return readExif(ab); } catch (e) { return null; }
    });
  }

  global.ExifReader = {
    readExif: readExif,
    readExifFromFile: readExifFromFile,
    parseExifDate: parseExifDate
  };
})(typeof window !== 'undefined' ? window : this);
