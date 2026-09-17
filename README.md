# Monitoreo de Tucuras — Chubut

Sistema de relevamiento georreferenciado de focos de tucuras para el **Programa Provincial de Monitoreo y Manejo Integrado de Tucuras (MIP Tucuras)**.

Son dos piezas que trabajan juntas:

| Carpeta | Qué es | Quién la usa |
|---|---|---|
| `app/` | Aplicación de campo para el celular (PWA). Saca la foto, le pega la ubicación y arma el mensaje de WhatsApp. | Técnicos, paratécnicos, personal municipal, productores |
| `mapa/` | Herramienta de escritorio que arma el mapa de focos con lo que llega por WhatsApp. | Dirección de Sanidad Vegetal / Agricultura |

No hay servidor, ni base de datos, ni cuentas de usuario. Todo corre en el navegador y los datos no salen del dispositivo salvo cuando el técnico decide mandarlos por WhatsApp.

---

## Lo primero que hay que saber: WhatsApp borra los metadatos

Cuando una imagen se envía por WhatsApp **como foto**, WhatsApp la recomprime y **borra el EXIF completo, incluida la ubicación GPS**. Esto no es un defecto de la app: es cómo funciona WhatsApp, y le pasa a cualquier aplicación.

Por eso cada registro viaja por **tres vías en paralelo**:

1. **Coordenadas escritas sobre la imagen** (marca de agua). Sobreviven siempre, porque son píxeles. Se leen a ojo.
2. **Texto del mensaje.** WhatsApp nunca lo modifica. Ahí va el bloque legible más una línea `#TUCURA|...` que el software de mapeo lee automáticamente. **Esta es la vía principal para armar el mapa.**
3. **Metadatos EXIF con GPS.** Sobreviven únicamente si el archivo se manda como **Documento** (Adjuntar → Documento → Explorar), no como Galería.

Con que llegue cualquiera de las tres, el punto se ubica en el mapa. En la práctica la vía 2 funciona siempre.

### La tira grabada en la imagen

La marca de agua incluye una **tira fina de cuadrados blancos y negros** en el borde inferior. No es decorativa: guarda las **coordenadas y la fecha en los propios píxeles**, para que el software de mapeo pueda recuperar el punto **de la foto sola** — aunque WhatsApp la haya recomprimido y le haya borrado el EXIF, y aunque llegue sin el texto del mensaje.

- 83 celdas a lo ancho de la imagen: 4 de sincronismo, 75 de datos (versión, latitud, longitud, fecha y verificación) y 4 de sincronismo
- Precisión: 1·10⁻⁵ grados, poco más de un metro
- Sobrevive porque WhatsApp **reescala pero no recorta ni rota**: la geometría relativa se mantiene, y los bloques son grandes comparados con el ruido del JPEG
- Verificado hasta 800 px de ancho con calidad 0,35 (27 KB), y con cero falsos positivos sobre 200 fotos sin tira

Es lo que hace que cargar sólo la imagen alcance. Ver [`app/codigo-optico.js`](app/codigo-optico.js).

---

## Puesta en marcha

### 1. Publicar la app de campo

La app necesita **HTTPS** para acceder a la cámara y al GPS (los navegadores lo exigen). Cualquiera de estas opciones sirve y es gratis:

- **GitHub Pages** — subir el repositorio y activar Pages. Queda en `https://<usuario>.github.io/<repo>/app/`
- **Netlify Drop** — arrastrar la carpeta del proyecto a <https://app.netlify.com/drop>
- **Servidor propio de la provincia** — copiar la carpeta a cualquier hosting con certificado

Después se le pasa el link a los técnicos por WhatsApp una sola vez.

### 2. Instalarla en el teléfono

Al abrir el link **lo único que aparece es la instalación**. Nada más: ni menús, ni pestañas, ni la cámara. La pantalla se adapta al teléfono:

| Teléfono | Qué muestra |
|---|---|
| Android, Chrome de escritorio | Botón **Instalar la aplicación**: un toque y listo |
| iPhone con Safari | Los tres pasos de Safari, numerados. Apple no permite instalar de un toque desde ninguna web |
| iPhone con Chrome u otro | Aviso de que solo Safari puede instalar, con botón para copiar el link |
| Otros navegadores | Dónde está la opción en el menú |

Abajo hay un **Continuar sin instalar** discreto, para que nadie quede trabado: quien lo toca entra a la app y no vuelve a ver la pantalla.

**Una vez instalada, la app se opera sólo desde el ícono del teléfono.** Si se vuelve a abrir el link en el navegador, la pantalla avisa que ya está instalada y no deja trabajar desde ahí: tener dos copias abiertas confunde, y sólo la instalada es la que guarda los registros y funciona sin señal. Por si alguien la desinstala, esa misma pantalla tiene un acceso discreto para volver a usarla en el navegador.

La app queda con ícono propio y **abre sin internet**. En la meseta esto es lo importante: el GPS del teléfono funciona aunque no haya señal de datos.

El permiso de ubicación **se pide recién al entrar a la app**, no en la pantalla de instalación: nadie quiere que el teléfono pregunte por el GPS antes de haber entrado siquiera.

### 3. Configurar una vez, en Ajustes

Sólo dos cosas, y ninguna obligatoria:

- Nombre del monitoreador
- Zona habitual (se completa sola en cada registro)

Todo lo demás está decidido por defecto y no se pregunta: la foto sale siempre al **máximo tamaño** (2048 px de lado mayor, ~200 KB) y **siempre con las coordenadas encima**. Al enviar, WhatsApp abre para elegir el contacto.

### 4. Abrir el mapa en la oficina

Abrir `mapa/index.html` con doble clic (funciona con doble clic, no necesita servidor). Necesita internet solo para descargar el fondo cartográfico.

---

## Cómo se usa a campo

Con señal, son **dos toques**:

1. Pararse sobre el foco, esperar el indicador **verde** y tocar **Tomar foto del foco**.
2. Tocar **Enviar por WhatsApp**.

Sin señal, el segundo toque es **Guardar para enviar después**. Las fotos se acumulan y arriba de la pantalla aparece un aviso con cuántas quedan sin enviar; al volver al pueblo se mandan **todas juntas de un toque**.

La app no tiene listados ni exportaciones: el técnico saca la foto y la manda, nada más. Todo lo que tiene que ver con archivos, formatos y mapas vive en la oficina.

### El GPS no necesita señal de celular

El chip recibe directo de los satélites y funciona en plena meseta sin una barra de señal. Dos cosas que sí importan:

- **Sin datos, el primer arreglo tarda más.** Con señal el teléfono usa A‑GPS y engancha en segundos; sin señal tiene que leer la información de los propios satélites: de medio minuto a un par de minutos, a cielo abierto y quieto. Para eso está el botón grande **Actualizar ubicación**.
- **El modo de ubicación tiene que estar en «Alta precisión».** En «ahorro de batería» el teléfono se ubica por antenas y wifi —eso sí necesita señal— y puede errarle por kilómetros.

El registro guarda la **fecha y la posición del momento en que se sacó la foto**, no del momento del envío. Un relevamiento hecho el martes en Gan Gan y enviado el viernes desde Trelew se mapea igual, en Gan Gan y con fecha del martes. Esto era el requisito principal.

### Los datos del monitoreo son opcionales

Para armar el mapa alcanza con la foto y la ubicación, que la app pone sola. El resto está detrás de **Agregar datos del monitoreo**, plegado, y ningún campo es obligatorio: si no se completa nada, el punto se registra igual.

Cuando sí se cargan, siguen los vocabularios del Programa Provincial:

- **Estadio:** desove (canutos), mosquita (I‑II), saltona (III‑V), adulto/voladora, mixto
- **Especie:** *Bufonacris claraziana* (tucura sapo), *Dichroplus maculipennis* (alas manchadas), otra, no determinada
- **Método:** aros de 0,1 m² (Onsager y Henry, 1977), recorrida lineal por pasos, red de arrastre, estimación visual
- **Ambiente:** mallín, perimallín, estepa, meseta, pastura implantada, bordura/alambrado, periurbano
- **Densidad** en tucuras/m², con aviso automático cuando **supera el umbral de control de 8‑10 tucuras/m²**

Incluye una **calculadora del método de aros**: se cargan los conteos de los 30 o 40 aros separados por espacio y calcula la densidad (promedio por aro × 10).

---

## Cómo se arma el mapa en la oficina

Se abre `mapa/index.html` y se le da de comer cualquiera de estas cosas, sueltas o mezcladas:

| Entrada | Cómo se consigue |
|---|---|
| **Chat exportado** (`_chat.txt`) | En WhatsApp: chat → ⋮ → *Más* → *Exportar chat* → *Sin archivos*. Es la vía más cómoda para procesar toda la campaña de una vez. |
| **Fotos `.jpg`** | Sirven las que llegaron como Documento (conservan el GPS en el EXIF), las de la cámara común con ubicación activada, **y también las recomprimidas por WhatsApp**: de esas el punto se recupera leyendo la tira grabada en la imagen. |
| **Texto pegado** | Copiar los mensajes desde WhatsApp Web y pegarlos en el recuadro. |
| **`.csv` / `.geojson`** | Exportados desde la app de campo o desde otra corrida del mapa. |

El mapa también reconoce los **mensajes de ubicación** de WhatsApp (los que se mandan con "Compartir ubicación"), aunque sin datos de densidad.

Si el mismo punto llega por varias vías —la foto y el texto, por ejemplo— se fusiona en un solo registro, quedándose con la información más completa. Reimportar el mismo chat no duplica nada.

### Qué sale del mapa

- Mapa con los focos coloreados y dimensionados por densidad, sobre calles, satelital o relieve
- Filtros por zona, estadio, nivel de densidad, rango de fechas y texto libre
- Resumen: puntos relevados, cuántos superan el umbral, densidad máxima, zonas afectadas, superficie declarada
- Exportación a **CSV** (punto y coma, listo para Excel en castellano), **GeoJSON** (QGIS) y **KML** (Google Earth, Google My Maps)
- **Quitar puntos mal cargados**: con la × de su fila, con el botón del globo en el mapa, o marcando varios con la casilla

## Integración con el Sistema de Consulta Integral de Productores

Este visor sirve para armar el mapa de una jornada y exportarlo. Para el **registro provincial que se acumula campaña tras campaña**, los mismos partes se cargan en el Sistema de Consulta Integral de Productores (botón **🦗 Tucuras**), que además:

- **Cruza cada foco contra el parcelario del catastro**: RENSPA, establecimiento, departamento y productor identificado, con salto directo a su ficha completa
- Guarda los focos en una base propia que sobrevive a las actualizaciones de datos
- Separa las campañas (el ciclo de la tucura va de julio a junio) y permite **reproducir el avance** de los focos a lo largo de la temporada
- Borra puntos de forma reversible, con papelera que registra quién los sacó y por qué

Acepta exactamente las mismas entradas que este visor: el chat exportado, las fotos, el CSV y el GeoJSON.

Los colores son los mismos en la app, en la marca de agua de la foto y en el mapa:

| Densidad | Nivel | Color |
|---|---|---|
| < 8 tucuras/m² | Bajo, debajo del umbral | verde |
| 8 – 15 | En umbral de control | ámbar |
| 15 – 30 | Alto | naranja |
| > 30 | Muy alto | rojo |

---

## Formato de la línea `#TUCURA`

Es la línea que va al final de cada mensaje y la que hace que el mapeo sea automático. Campos separados por `|`, en posición fija:

```
#TUCURA|1|id|lat|lon|precision_m|fecha_iso|zona|establecimiento|especie|estadio|densidad|metodo|ambiente|superficie_ha|monitoreador|observaciones
```

Ejemplo real:

```
#TUCURA|1|TUC-260910-0941-WPZ|-42.512346|-68.345679|7|2026-09-10T09:41:36|Gan Gan|El Álamo|BC|SAL|29.7|ARO|MAL|150|J. Pérez|Foco sobre el alambrado norte
```

El `1` es la versión del formato. Los códigos (`BC`, `SAL`, `ARO`, `MAL`) están definidos en [`app/datos.js`](app/datos.js). Si el mensaje pierde esta línea porque alguien lo reescribió a mano, el mapa igual lo entiende leyendo el bloque legible (`Coordenadas:`, `Zona:`, `Densidad:`, etc.).

---

## Estructura del proyecto

```
index.html                  Raíz: lleva directo a la app de campo

app/                        Aplicación de campo (PWA)
  index.html                Portada de instalación + Capturar, Registros, Ajustes, Ayuda
  app.js                    Lógica: GPS, cámara, marca de agua, envío
  datos.js                  Vocabularios del Programa, IndexedDB, CSV/GeoJSON/KML
  exif.js                   Escritor de EXIF con GPS, sin dependencias
  codigo-optico.js          Tira que graba coordenadas y fecha en los píxeles
  instalar.js               Botón de instalación, según navegador y sistema
  styles.css                Alto contraste y botones grandes, para uso a sol pleno
  sw.js                     Service worker: la app abre sin señal
  manifest.webmanifest      Para instalarla como aplicación
  icons/

mapa/                       Software de mapeo (escritorio)
  index.html
  mapa.js                   Importadores, mapa, filtros, exportación
  exif-read.js              Lector de EXIF/GPS
```

Los documentos de contexto que dieron origen al sistema —el informe a la Legislatura y el Programa Provincial 2025— quedan **fuera del repositorio** por `.gitignore`: son documentos oficiales de trabajo interno y este repositorio es público.

`mapa/index.html` carga `../app/datos.js` para compartir los vocabularios y los exportadores. Si se copia la carpeta `mapa/` a otro lado, hay que llevarse `app/datos.js` también.

---

## Notas técnicas

- **Sin dependencias en la app de campo.** El escritor de EXIF (`app/exif.js`) construye el segmento APP1 completo —IFD0, Exif IFD y GPS IFD, TIFF little‑endian según Exif 2.32— a mano. El mapa usa Leaflet desde CDN, únicamente para dibujar.
- **Verificación del EXIF.** Las coordenadas escritas se releyeron con Pillow (parser independiente): coinciden con error menor a 10⁻⁶ grados (≈ 10 cm), junto con altitud, error horizontal, datum WGS‑84, fecha de captura y hora GPS en UTC.
- **Tamaño de las fotos.** Se redimensionan a 1600 px de lado mayor por defecto y quedan en torno a 120‑200 KB, pensando en la conectividad de la meseta. Configurable en Ajustes.
- **Almacenamiento.** Los registros y las fotos van a IndexedDB; los ajustes, a localStorage. Nada se borra solo: hay un botón para eliminar los ya enviados.
- **Actualizaciones.** El service worker usa **red primero** para la página y el código, con la caché como respaldo. Así el técnico recibe las correcciones apenas tiene señal, en vez de quedarse con una versión vieja; los íconos, que no cambian, van por caché primero. Al publicar una corrección conviene subir el número de `CACHE` en `app/sw.js`.
- **Privacidad.** El mapa procesa todo en la computadora local; ningún dato se sube a internet.

### Si no hay señal de GPS

La app avisa y permite **cargar las coordenadas a mano** (por ejemplo leídas de un GPS de mano o de otro teléfono). Los registros sin ubicación quedan marcados en rojo en la lista para que no se envíen por error.

---

## Posibles pasos siguientes

Cosas que no están y podrían sumar, según cómo funcione la primera campaña:

- **Bot de WhatsApp** con la API oficial: elimina el paso manual de exportar el chat y carga los puntos solos. Requiere cuenta de WhatsApp Business y un servidor.
- **Publicación del mapa** como capa web permanente para consulta de los comités locales y las comunas.
- **Comparación entre campañas** para seguir la evolución de los focos entre temporadas.
- **Registro de aplicaciones de control** (producto, dosis, superficie, fecha), para cerrar el circuito monitoreo → decisión → control → verificación.
