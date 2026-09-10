/* =====================================================================
   instalar.js — Boton para instalar la app en el telefono
   App Monitoreo Tucuras (Chubut)

   Android y Chrome de escritorio disparan 'beforeinstallprompt' y se puede
   instalar con un solo toque. iPhone no lo soporta: ahi solo se puede
   mostrar el paso a paso de Safari. El componente se esconde solo cuando
   la app ya esta instalada.
   ===================================================================== */
(function (global) {
  'use strict';

  var eventoInstalacion = null;
  var montajes = []; // [{ el, ignorarDescarte }]
  var CLAVE_OCULTO = 'tucuras.instalar.oculto';
  var CLAVE_INSTALADA = 'tucuras.instalada';

  function recordar(clave, valor) {
    try {
      if (valor) localStorage.setItem(clave, '1');
      else localStorage.removeItem(clave);
    } catch (e) { /* almacenamiento lleno o bloqueado */ }
  }

  function recordado(clave) {
    try { return localStorage.getItem(clave) === '1'; } catch (e) { return false; }
  }

  // El evento llega una sola vez y hay que atraparlo apenas se dispara,
  // por eso el listener se registra al cargar el archivo y no despues.
  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // evitamos el cartel automatico del navegador
    eventoInstalacion = e;
    // El navegador solo ofrece instalar si NO esta instalada: si antes la
    // habiamos dado por instalada y el usuario la desinstalo, nos corregimos.
    recordar(CLAVE_INSTALADA, false);
    pintar();
  });

  global.addEventListener('appinstalled', function () {
    eventoInstalacion = null;
    marcarInstalada();
  });

  // Tras instalar, la pestaña original sigue siendo una pestaña comun: el
  // modo standalone no alcanza para detectarlo, hace falta dejarlo anotado.
  function marcarInstalada() {
    recordar(CLAVE_INSTALADA, true);
    recordar(CLAVE_OCULTO, true);
    pintar();
    document.dispatchEvent(new CustomEvent('tucuras:instalada'));
  }

  /* ---------------- deteccion ---------------- */

  function yaInstalada() {
    try {
      if (global.matchMedia('(display-mode: standalone)').matches) return true;
      if (global.matchMedia('(display-mode: fullscreen)').matches) return true;
      if (global.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (e) { /* navegador viejo */ }
    if (global.navigator.standalone === true) return true;           // iOS
    if (document.referrer.indexOf('android-app://') === 0) return true;
    return recordado(CLAVE_INSTALADA);
  }

  function esIOS() {
    var ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPad con iPadOS 13+ se presenta como Mac de escritorio
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  // En iPhone solo Safari puede instalar. Chrome, Firefox y Edge en iOS usan
  // el mismo motor pero no ofrecen "Agregar a inicio".
  function esSafariIOS() {
    var ua = navigator.userAgent;
    return esIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(ua);
  }

  function oculto() { return recordado(CLAVE_OCULTO); }

  /* ---------------- estilos ---------------- */

  var CSS = [
    '.inst-caja{background:#fff;border:1px solid #d7ddd6;border-left:5px solid #e8a82c;',
    'border-radius:14px;padding:14px;margin-bottom:14px;',
    'box-shadow:0 1px 3px rgba(0,0,0,.10),0 4px 14px rgba(0,0,0,.06)}',
    '.inst-fila{display:flex;align-items:center;gap:12px}',
    '.inst-icono{font-size:28px;line-height:1;flex:none}',
    '.inst-texto{flex:1;min-width:0}',
    '.inst-texto strong{display:block;font-size:15px}',
    '.inst-texto span{font-size:13px;color:#5a655e}',
    '.inst-cerrar{flex:none;border:none;background:none;font-size:22px;line-height:1;',
    'color:#98a29b;cursor:pointer;padding:4px 2px;width:auto;min-height:auto}',
    '.inst-boton{margin-top:12px;width:100%;min-height:50px;border:none;border-radius:12px;',
    'background:#1c5e3e;color:#fff;font:inherit;font-weight:700;font-size:16px;cursor:pointer;',
    'display:flex;align-items:center;justify-content:center;gap:9px}',
    '.inst-boton:active{transform:translateY(1px)}',
    '.inst-pasos{margin:12px 0 0;padding-left:22px;font-size:14px;line-height:1.6}',
    '.inst-pasos li{margin-bottom:6px}',
    '.inst-pasos b{background:#e7f1ea;border-radius:5px;padding:1px 6px}',
    '.inst-nota{font-size:13px;color:#5a655e;margin:10px 0 0}'
  ].join('');

  function inyectarCSS() {
    if (document.getElementById('inst-css')) return;
    var s = document.createElement('style');
    s.id = 'inst-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------------- interfaz ---------------- */

  function ocultarSiempre() {
    recordar(CLAVE_OCULTO, true);
    pintar();
  }

  function instalarConUnToque() {
    if (!eventoInstalacion) return;
    var ev = eventoInstalacion;
    eventoInstalacion = null;
    ev.prompt();
    ev.userChoice.then(function (r) {
      // No todos los navegadores disparan 'appinstalled' de forma confiable,
      // asi que tambien lo damos por instalada cuando el usuario acepta.
      if (r && r.outcome === 'accepted') marcarInstalada();
      else pintar(); // rechazo: dejamos el cartel por si cambia de idea
    }).catch(function () { pintar(); });
  }

  function caja(icono, titulo, subtitulo, conCerrar) {
    var div = document.createElement('div');
    div.className = 'inst-caja';
    var fila = document.createElement('div');
    fila.className = 'inst-fila';
    fila.innerHTML = '<span class="inst-icono">' + icono + '</span>' +
      '<span class="inst-texto"><strong>' + titulo + '</strong><span>' + subtitulo + '</span></span>';
    if (conCerrar) {
      var cerrar = document.createElement('button');
      cerrar.className = 'inst-cerrar';
      cerrar.setAttribute('aria-label', 'No mostrar mas');
      cerrar.innerHTML = '&times;';
      cerrar.onclick = ocultarSiempre;
      fila.appendChild(cerrar);
    }
    div.appendChild(fila);
    return div;
  }

  // Arma el contenido segun el navegador. `conCerrar` solo en la copia de la
  // pantalla principal: la de Ayuda se muestra siempre.
  function contenido(conCerrar) {
    // Caso 1: Android y escritorio. Instalacion con un toque.
    if (eventoInstalacion) {
      var c1 = caja('&#128241;', 'Instalá la app en el teléfono',
        'Abre sin señal y queda con ícono propio', conCerrar);
      var b = document.createElement('button');
      b.className = 'inst-boton';
      b.innerHTML = '<span>&#11015;</span> Instalar la app';
      b.onclick = instalarConUnToque;
      c1.appendChild(b);
      return c1;
    }

    // Caso 2: iPhone con Safari. Solo se puede explicar el paso a paso.
    if (esSafariIOS()) {
      var c2 = caja('&#128241;', 'Agregá la app a tu iPhone',
        'Abre sin señal y queda con ícono propio', conCerrar);
      var ol = document.createElement('ol');
      ol.className = 'inst-pasos';
      ol.innerHTML =
        '<li>Tocá el botón <b>Compartir</b>, abajo al centro de la pantalla.</li>' +
        '<li>Deslizá hacia abajo y elegí <b>Agregar a inicio</b>.</li>' +
        '<li>Tocá <b>Agregar</b>, arriba a la derecha.</li>';
      c2.appendChild(ol);
      return c2;
    }

    // Caso 3: iPhone con otro navegador. Hay que pasar a Safari.
    if (esIOS()) {
      return caja('&#9888;', 'Abrí esta página en Safari',
        'En iPhone solo Safari permite agregar la app a la pantalla de inicio', conCerrar);
    }

    // Caso 4: navegador sin instalacion automatica (Firefox en Android, etc.)
    var c4 = caja('&#128241;', 'Instalá la app en el teléfono',
      'Abre sin señal y queda con ícono propio', conCerrar);
    var p = document.createElement('p');
    p.className = 'inst-nota';
    p.innerHTML = 'Abrí el menú del navegador y elegí <b>Instalar aplicación</b> ' +
      'o <b>Agregar a pantalla principal</b>. Con Chrome se instala de un toque.';
    c4.appendChild(p);
    return c4;
  }

  function pintar() {
    inyectarCSS();
    montajes.forEach(function (m) {
      m.el.innerHTML = '';
      if (yaInstalada()) return;
      if (oculto() && !m.ignorarDescarte) return;
      m.el.appendChild(contenido(!m.ignorarDescarte));
    });
  }

  /**
   * Monta el componente dentro del elemento indicado. Se puede llamar antes
   * o despues de que llegue 'beforeinstallprompt', y en varios lugares.
   * opciones.ignorarDescarte: mostrarlo aunque el usuario haya cerrado el
   * cartel (se usa en la pantalla de Ayuda).
   */
  function montar(el, opciones) {
    var nodo = typeof el === 'string' ? document.getElementById(el) : el;
    if (!nodo) return;
    for (var i = 0; i < montajes.length; i++) {
      if (montajes[i].el === nodo) { montajes[i].ignorarDescarte = !!(opciones && opciones.ignorarDescarte); pintar(); return; }
    }
    montajes.push({ el: nodo, ignorarDescarte: !!(opciones && opciones.ignorarDescarte) });
    pintar();
    // Algunos navegadores tardan en decidir si la app es instalable.
    setTimeout(pintar, 1500);
  }

  global.InstalarApp = {
    montar: montar,
    yaInstalada: yaInstalada,
    disponible: function () { return !!eventoInstalacion; }
  };
})(typeof window !== 'undefined' ? window : this);
