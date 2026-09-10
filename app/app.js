/* =====================================================================
   app.js — App Monitoreo Tucuras (Chubut)
   Captura de foto georreferenciada, registro local y envio por WhatsApp.
   ===================================================================== */
(function () {
  'use strict';

  var T = window.Tucuras;
  var $ = function (id) { return document.getElementById(id); };

  var estado = {
    posicion: null,      // ultima lectura del GPS
    borrador: null,      // registro en edicion
    archivoOriginal: null,
    urlPrevia: null,
    urlsLista: []
  };

  var AJUSTES_CLAVE = 'tucuras.ajustes.v1';
  var ajustes = {
    nombre: '', zona: '', telefono: '', tamano: '1600', marca: true
  };

  /* ================== Ajustes ================== */

  function cargarAjustes() {
    try {
      var g = JSON.parse(localStorage.getItem(AJUSTES_CLAVE) || '{}');
      Object.keys(ajustes).forEach(function (k) {
        if (g[k] !== undefined) ajustes[k] = g[k];
      });
    } catch (e) { /* ajustes corruptos: seguimos con los valores por defecto */ }
    $('aNombre').value = ajustes.nombre;
    $('aZona').value = ajustes.zona;
    $('aTelefono').value = ajustes.telefono;
    $('aTamano').value = ajustes.tamano;
    $('aMarca').checked = !!ajustes.marca;
  }

  function guardarAjustes() {
    ajustes.nombre = $('aNombre').value.trim();
    ajustes.zona = $('aZona').value.trim();
    ajustes.telefono = $('aTelefono').value.replace(/[^\d]/g, '');
    ajustes.tamano = $('aTamano').value;
    ajustes.marca = $('aMarca').checked;
    try { localStorage.setItem(AJUSTES_CLAVE, JSON.stringify(ajustes)); } catch (e) { /* sin espacio */ }
  }

  /* ================== Interfaz basica ================== */

  function brindis(texto, ms) {
    var previo = document.querySelector('.brindis');
    if (previo) previo.remove();
    var el = document.createElement('div');
    el.className = 'brindis';
    el.textContent = texto;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, ms || 3200);
  }

  function cargando(texto) {
    ocultarCargando();
    var el = document.createElement('div');
    el.className = 'cargando';
    el.id = 'capaCargando';
    el.innerHTML = '<div class="rueda"></div><div></div>';
    el.lastChild.textContent = texto || 'Procesando...';
    document.body.appendChild(el);
  }

  function ocultarCargando() {
    var el = $('capaCargando');
    if (el) el.remove();
  }

  function mostrarPantalla(nombre) {
    ['Capturar', 'Registros', 'Ajustes', 'Ayuda'].forEach(function (p) {
      $('pantalla' + p).classList.toggle('activa', p === nombre);
    });
    document.querySelectorAll('nav.pestanas button').forEach(function (b) {
      b.classList.toggle('activa', b.dataset.pantalla === nombre);
    });
    window.scrollTo(0, 0);
    if (nombre === 'Registros') renderRegistros();
    if (nombre === 'Ajustes') mostrarEspacio();
  }

  function llenarSelect(el, lista, textoVacio) {
    el.innerHTML = '';
    if (textoVacio) {
      var o = document.createElement('option');
      o.value = ''; o.textContent = textoVacio;
      el.appendChild(o);
    }
    lista.forEach(function (item) {
      var op = document.createElement('option');
      op.value = item.cod; op.textContent = item.nom;
      el.appendChild(op);
    });
  }

  /* ================== GPS ================== */

  function textoPrecision(m) {
    if (m == null) return '';
    return '+/- ' + (m < 10 ? m.toFixed(1) : Math.round(m)) + ' m';
  }

  function pintarGps() {
    var chip = $('chipGps'), txt = $('gpsTexto');
    var p = estado.posicion;
    chip.classList.remove('ok', 'malo');
    if (!p) {
      txt.textContent = 'Buscando ubicacion...';
      return;
    }
    if (p.error) {
      chip.classList.add('malo');
      txt.textContent = p.error;
      return;
    }
    var edad = Math.round((Date.now() - p.t) / 1000);
    var bueno = p.acc <= 30;
    chip.classList.add(bueno ? 'ok' : 'malo');
    txt.textContent = T.coord(p.lat) + ', ' + T.coord(p.lon) + '  ' + textoPrecision(p.acc) +
      (edad > 120 ? ' (hace ' + Math.round(edad / 60) + ' min)' : '');
  }

  var vigilanciaId = null;

  function iniciarGps() {
    if (!navigator.geolocation) {
      estado.posicion = { error: 'Este telefono no permite ubicacion' };
      pintarGps();
      return;
    }
    if (vigilanciaId !== null) navigator.geolocation.clearWatch(vigilanciaId);
    vigilanciaId = navigator.geolocation.watchPosition(function (pos) {
      estado.posicion = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        acc: pos.coords.accuracy,
        alt: (typeof pos.coords.altitude === 'number' && isFinite(pos.coords.altitude)) ? pos.coords.altitude : null,
        t: pos.timestamp || Date.now()
      };
      pintarGps();
    }, function (err) {
      var msg = 'No se pudo obtener la ubicacion';
      if (err.code === 1) msg = 'Permiso de ubicacion denegado';
      else if (err.code === 2) msg = 'Sin senal de GPS. Sali a cielo abierto';
      else if (err.code === 3) msg = 'El GPS tarda en responder. Reintentando...';
      estado.posicion = { error: msg };
      pintarGps();
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 });
  }

  /* ================== Captura y procesado de la foto ================== */

  function decodificar(file) {
    // createImageBitmap con orientacion desde EXIF es lo mas fiable; si no
    // esta disponible caemos a un <img>, que en navegadores actuales tambien
    // aplica la orientacion por su cuenta.
    if (window.createImageBitmap) {
      try {
        return createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(function () { return porImagen(file); });
      } catch (e) { /* argumento no soportado */ }
    }
    return porImagen(file);
  }

  function porImagen(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  function marcaDeAgua(ctx, w, h, reg) {
    var d = (reg.densidad === '' || reg.densidad == null) ? null : Number(reg.densidad);
    var nivel = T.nivelDensidad(d);
    var fecha = new Date(reg.fecha);

    var lineas = ['MONITOREO TUCURAS - CHUBUT  ' + reg.id];
    lineas.push(reg.lat != null
      ? T.coord(reg.lat) + ', ' + T.coord(reg.lon) + '   ' + textoPrecision(reg.acc)
      : 'SIN UBICACION GPS');
    var l3 = T.fechaHora(fecha);
    if (reg.zona) l3 += '  -  ' + reg.zona;
    if (reg.establecimiento) l3 += ' / ' + reg.establecimiento;
    lineas.push(l3);
    var l4 = [];
    if (reg.estadio) l4.push(T.nombrePorCod(T.ESTADIOS, reg.estadio));
    if (d != null) l4.push(d + ' tucuras/m2');
    if (l4.length) lineas.push(l4.join('  -  '));

    var base = Math.max(13, Math.round(w * 0.026));
    var interlinea = Math.round(base * 1.38);
    var pad = Math.round(base * 0.8);
    var alto = pad * 2 + lineas.length * interlinea;
    var y0 = h - alto;
    var fuente = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

    ctx.fillStyle = 'rgba(0,0,0,0.66)';
    ctx.fillRect(0, y0, w, alto);
    ctx.fillStyle = nivel.color;
    ctx.fillRect(0, y0, Math.max(5, Math.round(base * 0.4)), alto);

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    var x = pad + Math.round(base * 0.7);
    lineas.forEach(function (linea, i) {
      ctx.font = (i === 0 ? '700 ' : '400 ') + (i === 0 ? Math.round(base * 1.06) : base) + 'px ' + fuente;
      if (i === 1) ctx.font = '700 ' + Math.round(base * 1.1) + 'px ' + fuente; // coordenadas destacadas
      ctx.fillText(linea, x, y0 + pad + i * interlinea);
    });
  }

  function procesarFoto(file, reg) {
    var maxLado = parseInt(ajustes.tamano, 10) || 1600;
    return decodificar(file).then(function (img) {
      var w0 = img.width, h0 = img.height;
      var escala = Math.min(1, maxLado / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * escala));
      var h = Math.max(1, Math.round(h0 * escala));

      var lienzo = $('lienzo');
      lienzo.width = w; lienzo.height = h;
      var ctx = lienzo.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      if (img.close) img.close();

      if (ajustes.marca) marcaDeAgua(ctx, w, h, reg);

      return new Promise(function (res, rej) {
        lienzo.toBlob(function (blob) {
          if (!blob) { rej(new Error('No se pudo generar la imagen')); return; }
          res({ blob: blob, w: w, h: h });
        }, 'image/jpeg', 0.85);
      });
    }).then(function (r) {
      // El JPEG del canvas sale sin metadatos: le escribimos el EXIF completo.
      return window.ExifWriter.addExifToJpegBlob(r.blob, {
        lat: reg.lat, lon: reg.lon, altitude: reg.alt, accuracy: reg.acc,
        date: new Date(reg.fecha),
        description: T.descripcionExif(reg),
        userComment: T.construirMensaje(reg),
        width: r.w, height: r.h
      });
    });
  }

  /* ================== Ficha de captura ================== */

  function nuevoBorrador() {
    var ahora = new Date();
    var p = estado.posicion;
    var conGps = p && !p.error;
    return {
      id: T.nuevoId(ahora),
      fecha: T.fechaISO(ahora),
      lat: conGps ? p.lat : null,
      lon: conGps ? p.lon : null,
      acc: conGps ? p.acc : null,
      alt: conGps ? p.alt : null,
      gpsEdadSeg: conGps ? Math.round((Date.now() - p.t) / 1000) : null,
      zona: ajustes.zona || '',
      establecimiento: '', especie: '', estadio: '', metodo: '', ambiente: '',
      densidad: '', escalaPasos: '', superficie: '',
      monitoreador: ajustes.nombre || '',
      observaciones: '',
      enviado: false
    };
  }

  function pintarAvisoUbicacion() {
    var b = estado.borrador, cont = $('avisoUbicacion');
    if (!b) return;
    if (b.lat == null) {
      cont.innerHTML = '<div class="aviso error"><strong>Sin ubicacion.</strong> El registro no va a servir para el mapa. ' +
        'Revisa que el GPS este encendido y volve a intentar, o carga las coordenadas a mano.</div>';
      var btn = document.createElement('button');
      btn.className = 'secundario chico';
      btn.style.width = '100%';
      btn.textContent = 'Cargar coordenadas a mano';
      btn.onclick = coordenadasAMano;
      cont.appendChild(btn);
      return;
    }
    var clase = b.acc <= 30 ? 'info' : 'atencion';
    var extra = b.acc > 30
      ? ' La precision es baja: si podes, espera unos segundos a cielo abierto y volve a sacar la foto.'
      : '';
    var viejo = b.gpsEdadSeg > 120
      ? ' <strong>Atencion:</strong> la ultima lectura del GPS es de hace ' + Math.round(b.gpsEdadSeg / 60) + ' min.'
      : '';
    cont.innerHTML = '<div class="aviso ' + clase + '"><strong>Ubicacion registrada:</strong> ' +
      T.coord(b.lat) + ', ' + T.coord(b.lon) + ' (' + textoPrecision(b.acc) + ').' + extra + viejo + '</div>';
  }

  function coordenadasAMano() {
    var txt = prompt('Escribi las coordenadas separadas por coma.\nEjemplo: -42.512345, -68.345678');
    if (!txt) return;
    var m = /(-?\d+[.,]?\d*)\s*[,; ]\s*(-?\d+[.,]?\d*)/.exec(txt);
    if (!m) { brindis('No pude entender esas coordenadas'); return; }
    var lat = parseFloat(m[1].replace(',', '.'));
    var lon = parseFloat(m[2].replace(',', '.'));
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      brindis('Esas coordenadas estan fuera de rango');
      return;
    }
    estado.borrador.lat = lat;
    estado.borrador.lon = lon;
    estado.borrador.acc = null;
    estado.borrador.alt = null;
    pintarAvisoUbicacion();
  }

  function abrirFicha(file) {
    estado.archivoOriginal = file;
    estado.borrador = nuevoBorrador();

    if (estado.urlPrevia) URL.revokeObjectURL(estado.urlPrevia);
    estado.urlPrevia = URL.createObjectURL(file);
    $('previaImg').src = estado.urlPrevia;

    $('fZona').value = estado.borrador.zona;
    $('fEstablecimiento').value = '';
    $('fEstadio').value = '';
    $('fEspecie').value = '';
    $('fMetodo').value = '';
    $('fAmbiente').value = '';
    $('fDensidad').value = '';
    $('fSuperficie').value = '';
    $('fObs').value = '';
    $('fAros').value = '';
    $('resultadoAros').textContent = ' ';
    $('avisoUmbral').innerHTML = '';
    $('bloqueEscala').hidden = true;
    $('detalleDatos').open = false; // los datos arrancan plegados: son opcionales

    pintarAvisoUbicacion();
    $('tarjetaCaptura').hidden = true;
    $('cajaInstalar').hidden = true; // con la foto en pantalla, no distraemos
    $('fichaRegistro').hidden = false;
    window.scrollTo(0, 0);
  }

  function cerrarFicha() {
    if (estado.urlPrevia) { URL.revokeObjectURL(estado.urlPrevia); estado.urlPrevia = null; }
    estado.borrador = null;
    estado.archivoOriginal = null;
    $('previaImg').removeAttribute('src');
    $('fichaRegistro').hidden = true;
    $('tarjetaCaptura').hidden = false;
    $('cajaInstalar').hidden = false;
    $('entradaFoto').value = '';
  }

  function leerFormulario() {
    var b = estado.borrador;
    b.zona = $('fZona').value.trim();
    b.establecimiento = $('fEstablecimiento').value.trim();
    b.estadio = $('fEstadio').value;
    b.especie = $('fEspecie').value;
    b.metodo = $('fMetodo').value;
    b.ambiente = $('fAmbiente').value;
    b.densidad = $('fDensidad').value.trim();
    b.escalaPasos = $('fEscala').value;
    b.superficie = $('fSuperficie').value.trim();
    b.observaciones = $('fObs').value.trim();
    b.monitoreador = ajustes.nombre || '';
    return b;
  }

  function pintarAvisoUmbral() {
    var v = $('fDensidad').value.trim();
    var cont = $('avisoUmbral');
    if (v === '') { cont.innerHTML = ''; return; }
    var d = Number(v);
    if (!isFinite(d)) { cont.innerHTML = ''; return; }
    var n = T.nivelDensidad(d);
    var superaUmbral = d >= T.UMBRAL_MIN;
    cont.innerHTML = '<div class="aviso ' + (superaUmbral ? 'atencion' : 'info') + '">' +
      '<span class="etiqueta" style="background:' + n.color + '">' + n.nom + '</span> ' +
      (superaUmbral
        ? 'Supera el umbral de control del Programa (' + T.UMBRAL_MIN + '-' + T.UMBRAL_MAX + ' tucuras/m<sup>2</sup>).'
        : 'Por debajo del umbral de control (' + T.UMBRAL_MIN + '-' + T.UMBRAL_MAX + ' tucuras/m<sup>2</sup>).') +
      '</div>';
  }

  function calcularAros() {
    var nums = $('fAros').value.split(/[^\d.,]+/)
      .filter(function (s) { return s !== ''; })
      .map(function (s) { return parseFloat(s.replace(',', '.')); })
      .filter(function (n) { return isFinite(n); });
    if (!nums.length) {
      $('resultadoAros').textContent = ' ';
      $('btnUsarAros').disabled = true;
      return null;
    }
    var suma = nums.reduce(function (a, b) { return a + b; }, 0);
    var prom = suma / nums.length;
    var dens = Math.round(prom * 10 * 10) / 10; // cada aro es 0,1 m2
    $('resultadoAros').innerHTML = '<strong>' + nums.length + ' aros</strong>, total ' + suma +
      ', promedio ' + (Math.round(prom * 100) / 100) + ' por aro &rarr; <strong>' + dens + ' tucuras/m&sup2;</strong>';
    $('btnUsarAros').disabled = false;
    return dens;
  }

  /* ================== Guardar ================== */

  // El registro se guarda SIEMPRE antes de intentar enviarlo: si el envio se
  // cancela o falla, el relevamiento no se pierde y queda en Registros.
  function guardarRegistro(enviarAhora) {
    var reg = leerFormulario();
    if (!estado.archivoOriginal) { brindis('No hay foto para guardar'); return; }

    cargando(enviarAhora ? 'Preparando el envio...' : 'Guardando el registro...');
    procesarFoto(estado.archivoOriginal, reg).then(function (blob) {
      reg.foto = blob;
      reg.tamanoFoto = blob.size;
      return T.Store.guardar(reg);
    }).then(function () {
      ocultarCargando();
      cerrarFicha();
      actualizarGlobo();
      if (enviarAhora) {
        // Volvemos a Capturar: a campo lo normal es encadenar un foco tras otro.
        enviarRegistro(reg);
      } else {
        mostrarPantalla('Registros');
        brindis('Registro ' + reg.id + ' guardado. Envialo cuando tengas senal', 4500);
      }
    }).catch(function (e) {
      ocultarCargando();
      alert('No se pudo guardar el registro.\n\n' + (e && e.message ? e.message : e));
    });
  }

  /* ================== Envio ================== */

  function archivoDe(reg) {
    return new File([reg.foto], reg.id + '.jpg', { type: 'image/jpeg', lastModified: new Date(reg.fecha).getTime() });
  }

  // Sin numero configurado, wa.me deja elegir el contacto a mano.
  function enlaceWhatsApp(texto) {
    var tel = (ajustes.telefono || '').replace(/[^\d]/g, '');
    return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto);
  }

  function descargar(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function marcarEnviado(reg) {
    reg.enviado = true;
    reg.enviadoFecha = T.fechaISO(new Date());
    return T.Store.guardar(reg).then(function () {
      actualizarGlobo();
      renderRegistros();
    });
  }

  function enviarRegistro(reg) {
    var texto = T.construirMensaje(reg);
    var archivo = archivoDe(reg);

    // Camino ideal: compartir foto + texto en un solo paso (Web Share nivel 2).
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      navigator.share({ files: [archivo], text: texto, title: 'Monitoreo de tucuras ' + reg.id })
        .then(function () {
          marcarEnviado(reg);
          brindis('Registro ' + reg.id + ' enviado');
        })
        .catch(function (e) {
          // Si el usuario cancela, el registro ya quedo guardado en Registros.
          if (e && e.name === 'AbortError') {
            brindis('Envio cancelado. El registro quedo guardado en Registros', 4000);
            return;
          }
          envioEnDosPasos(reg, texto);
        });
      return;
    }
    envioEnDosPasos(reg, texto);
  }

  function envioEnDosPasos(reg, texto) {
    descargar(reg.foto, reg.id + '.jpg');
    window.open(enlaceWhatsApp(texto), '_blank');
    marcarEnviado(reg);
    brindis('Foto descargada y WhatsApp abierto con el texto', 5000);
  }

  function copiarTexto(reg) {
    var texto = T.construirMensaje(reg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto)
        .then(function () { brindis('Texto copiado'); })
        .catch(function () { alert(texto); });
    } else {
      alert(texto);
    }
  }

  /* ================== Lista de registros ================== */

  function limpiarUrlsLista() {
    estado.urlsLista.forEach(function (u) { URL.revokeObjectURL(u); });
    estado.urlsLista = [];
  }

  function renderRegistros() {
    T.Store.todos().then(function (regs) {
      limpiarUrlsLista();
      var cont = $('listaRegistros');
      cont.innerHTML = '';

      var pendientes = regs.filter(function (r) { return !r.enviado; }).length;
      var sinGps = regs.filter(function (r) { return r.lat == null; }).length;
      $('resumenRegistros').innerHTML = regs.length === 0
        ? 'Todavia no hay registros.'
        : '<strong>' + regs.length + '</strong> registro(s), <strong>' + pendientes + '</strong> sin enviar' +
          (sinGps ? ', <strong style="color:#cf2d2d">' + sinGps + ' sin ubicacion</strong>' : '');

      $('btnExportarCSV').disabled = $('btnExportarGeo').disabled = $('btnExportarKML').disabled = regs.length === 0;
      $('btnResumenWA').disabled = pendientes === 0;

      if (!regs.length) {
        cont.innerHTML = '<div class="tarjeta vacio">Sacale una foto al primer foco desde la pestana <strong>Capturar</strong>.</div>';
        return;
      }

      regs.forEach(function (reg) {
        var d = (reg.densidad === '' || reg.densidad == null) ? null : Number(reg.densidad);
        var nivel = T.nivelDensidad(d);
        var url = URL.createObjectURL(reg.foto);
        estado.urlsLista.push(url);

        var tarjeta = document.createElement('div');
        tarjeta.className = 'tarjeta registro' + (reg.enviado ? ' enviado' : '');

        var img = document.createElement('img');
        img.src = url;
        img.alt = 'Foto del registro ' + reg.id;
        tarjeta.appendChild(img);

        var cuerpo = document.createElement('div');
        cuerpo.className = 'cuerpo';
        var partes = [];
        if (reg.zona) partes.push(reg.zona);
        if (reg.estadio) partes.push(T.nombrePorCod(T.ESTADIOS, reg.estadio));
        cuerpo.innerHTML =
          '<div class="id">' + reg.id + (reg.enviado ? ' &#10003;' : '') + '</div>' +
          '<div class="meta">' + T.fechaHora(new Date(reg.fecha)) + (partes.length ? ' &middot; ' + partes.join(' &middot; ') : '') + '</div>' +
          '<div class="meta">' + (reg.lat != null
            ? T.coord(reg.lat) + ', ' + T.coord(reg.lon)
            : '<strong style="color:#cf2d2d">sin ubicacion</strong>') + '</div>' +
          (d != null ? '<div style="margin-top:6px"><span class="etiqueta" style="background:' + nivel.color + '">' +
            d + ' tucuras/m&sup2;</span></div>' : '');

        var acciones = document.createElement('div');
        acciones.className = 'acciones';

        var bEnviar = document.createElement('button');
        bEnviar.className = reg.enviado ? 'secundario' : 'whatsapp';
        bEnviar.textContent = reg.enviado ? 'Reenviar' : 'Enviar';
        bEnviar.onclick = function () { enviarRegistro(reg); };
        acciones.appendChild(bEnviar);

        var bDescargar = document.createElement('button');
        bDescargar.className = 'secundario';
        bDescargar.textContent = 'Descargar';
        bDescargar.title = 'Guardar la foto con los metadatos GPS para enviarla como Documento';
        bDescargar.onclick = function () {
          descargar(reg.foto, reg.id + '.jpg');
          brindis('Foto guardada. Mandala como Documento para conservar el GPS', 5000);
        };
        acciones.appendChild(bDescargar);

        var bTexto = document.createElement('button');
        bTexto.className = 'secundario';
        bTexto.textContent = 'Copiar texto';
        bTexto.onclick = function () { copiarTexto(reg); };
        acciones.appendChild(bTexto);

        var bBorrar = document.createElement('button');
        bBorrar.className = 'peligro';
        bBorrar.textContent = 'Borrar';
        bBorrar.onclick = function () {
          if (!confirm('Borrar el registro ' + reg.id + '? No se puede deshacer.')) return;
          T.Store.borrar(reg.id).then(function () {
            actualizarGlobo();
            renderRegistros();
            brindis('Registro borrado');
          });
        };
        acciones.appendChild(bBorrar);

        cuerpo.appendChild(acciones);
        tarjeta.appendChild(cuerpo);
        cont.appendChild(tarjeta);
      });
    });
  }

  function actualizarGlobo() {
    T.Store.todos().then(function (regs) {
      var n = regs.filter(function (r) { return !r.enviado; }).length;
      var g = $('globoPendientes');
      g.textContent = n;
      g.hidden = n === 0;
    });
  }

  /* ================== Exportaciones y resumen ================== */

  function exportar(tipo) {
    T.Store.todos().then(function (regs) {
      if (!regs.length) { brindis('No hay registros para exportar'); return; }
      var hoy = new Date();
      var sello = hoy.getFullYear() + T.dos(hoy.getMonth() + 1) + T.dos(hoy.getDate());
      var contenido, nombre, mime;
      if (tipo === 'csv') {
        contenido = T.aCSV(regs); nombre = 'tucuras-' + sello + '.csv'; mime = 'text/csv;charset=utf-8';
      } else if (tipo === 'geojson') {
        contenido = T.aGeoJSON(regs); nombre = 'tucuras-' + sello + '.geojson'; mime = 'application/geo+json';
      } else {
        contenido = T.aKML(regs); nombre = 'tucuras-' + sello + '.kml'; mime = 'application/vnd.google-earth.kml+xml';
      }
      var blob = new Blob([contenido], { type: mime });
      var archivo = new File([blob], nombre, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        navigator.share({ files: [archivo], title: nombre }).catch(function () { descargar(blob, nombre); });
      } else {
        descargar(blob, nombre);
      }
    });
  }

  function resumenWhatsApp() {
    T.Store.todos().then(function (regs) {
      var pend = regs.filter(function (r) { return !r.enviado; });
      if (!pend.length) { brindis('No hay registros sin enviar'); return; }
      var L = ['MONITOREO DE TUCURAS - CHUBUT', 'Resumen de ' + pend.length + ' punto(s) relevado(s)'];
      if (ajustes.nombre) L.push('Monitoreador: ' + ajustes.nombre);
      L.push('');
      pend.forEach(function (r) {
        var d = (r.densidad === '' || r.densidad == null) ? null : Number(r.densidad);
        L.push('- ' + r.id + ' | ' + T.fechaHora(new Date(r.fecha)) + ' | ' +
          (r.lat != null ? T.coord(r.lat) + ', ' + T.coord(r.lon) : 'sin ubicacion') +
          (r.zona ? ' | ' + r.zona : '') +
          (d != null ? ' | ' + d + ' tucuras/m2' : ''));
      });
      L.push('');
      L.push('Codigos para el mapa:');
      pend.forEach(function (r) { L.push(T.lineaCodigo(r)); });
      window.open(enlaceWhatsApp(L.join('\n')), '_blank');
    });
  }

  function mostrarEspacio() {
    T.Store.todos().then(function (regs) {
      var bytes = regs.reduce(function (a, r) { return a + (r.tamanoFoto || 0); }, 0);
      var enviados = regs.filter(function (r) { return r.enviado; }).length;
      $('infoEspacio').textContent = regs.length + ' registro(s) guardado(s), ' +
        (bytes / 1048576).toFixed(1) + ' MB de fotos. ' + enviados + ' ya enviado(s).';
      $('btnBorrarEnviados').disabled = enviados === 0;
    });
  }

  /* ================== Instalacion ================== */

  // El cartel de instalacion va en dos lugares: arriba de la pantalla de
  // captura, donde se ve al abrir la app por primera vez, y en Ayuda, para
  // quien lo cerro y despues quiere instalarla igual.
  function montarInstalacion() {
    var I = window.InstalarApp;
    if (!I) return;

    // Arriba de la pantalla de captura: se puede cerrar y no vuelve a molestar.
    I.montar('cajaInstalar');
    // En Ayuda: siempre visible, para quien lo cerro y despues se arrepiente.
    I.montar('cajaInstalarAyuda', { ignorarDescarte: true });

    if (I.yaInstalada()) {
      $('estadoInstalacion').innerHTML = '<strong>La app ya esta instalada en este telefono.</strong>';
    }

    document.addEventListener('tucuras:instalada', function () {
      $('estadoInstalacion').innerHTML = '<strong>La app ya esta instalada en este telefono.</strong>';
      brindis('App instalada. Ya podes abrirla desde el icono', 4500);
    });
  }

  /* ================== Arranque ================== */

  function conectar() {
    // Pestañas
    document.querySelectorAll('nav.pestanas button').forEach(function (b) {
      b.addEventListener('click', function () { mostrarPantalla(b.dataset.pantalla); });
    });

    // GPS
    $('chipGps').addEventListener('click', function () {
      iniciarGps();
      brindis('Actualizando ubicacion...');
    });

    // Captura
    $('btnFoto').addEventListener('click', function () {
      var inp = $('entradaFoto');
      inp.setAttribute('capture', 'environment');
      inp.click();
    });
    $('btnGaleria').addEventListener('click', function () {
      var inp = $('entradaFoto');
      inp.removeAttribute('capture');
      inp.click();
    });
    $('entradaFoto').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) abrirFicha(file);
    });

    // Formulario
    $('fDensidad').addEventListener('input', pintarAvisoUmbral);
    $('fMetodo').addEventListener('change', function () {
      $('bloqueEscala').hidden = $('fMetodo').value !== 'PAS';
      $('calcAros').open = $('fMetodo').value === 'ARO';
    });
    $('fAros').addEventListener('input', calcularAros);
    $('btnUsarAros').addEventListener('click', function (e) {
      e.preventDefault();
      var d = calcularAros();
      if (d == null) return;
      $('fDensidad').value = d;
      $('fMetodo').value = 'ARO';
      pintarAvisoUmbral();
      brindis('Densidad cargada: ' + d + ' tucuras/m2');
    });
    $('btnEnviarAhora').addEventListener('click', function () { guardarRegistro(true); });
    $('btnGuardar').addEventListener('click', function () { guardarRegistro(false); });
    $('btnDescartar').addEventListener('click', function () {
      if (confirm('Descartar esta foto sin guardarla?')) cerrarFicha();
    });

    // Registros
    $('btnExportarCSV').addEventListener('click', function () { exportar('csv'); });
    $('btnExportarGeo').addEventListener('click', function () { exportar('geojson'); });
    $('btnExportarKML').addEventListener('click', function () { exportar('kml'); });
    $('btnResumenWA').addEventListener('click', resumenWhatsApp);

    // Ajustes
    ['aNombre', 'aZona', 'aTelefono', 'aTamano', 'aMarca'].forEach(function (id) {
      $(id).addEventListener('change', guardarAjustes);
    });
    $('btnBorrarEnviados').addEventListener('click', function () {
      T.Store.todos().then(function (regs) {
        var enviados = regs.filter(function (r) { return r.enviado; });
        if (!enviados.length) return;
        if (!confirm('Borrar ' + enviados.length + ' registro(s) ya enviado(s)?')) return;
        return Promise.all(enviados.map(function (r) { return T.Store.borrar(r.id); }))
          .then(function () {
            brindis('Registros enviados borrados');
            mostrarEspacio();
            actualizarGlobo();
          });
      });
    });

    // Evitar perder un borrador por un cierre accidental
    window.addEventListener('beforeunload', function (e) {
      if (estado.borrador) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function iniciar() {
    llenarSelect($('fEstadio'), T.ESTADIOS, 'Seleccionar...');
    llenarSelect($('fEspecie'), T.ESPECIES, 'Seleccionar...');
    llenarSelect($('fMetodo'), T.METODOS, 'Seleccionar...');
    llenarSelect($('fAmbiente'), T.AMBIENTES, 'Seleccionar...');
    llenarSelect($('fEscala'), T.ESCALA_PASOS, 'Seleccionar...');

    var dl = $('listaZonas');
    T.ZONAS.forEach(function (z) {
      var o = document.createElement('option');
      o.value = z;
      dl.appendChild(o);
    });

    cargarAjustes();
    conectar();
    iniciarGps();
    actualizarGlobo();
    montarInstalacion();

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin modo offline */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
