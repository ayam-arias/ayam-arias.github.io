# CV vivo – Ian Arias Carrasco

[![LinkedIn](https://img.shields.io/badge/LinkedIn-ian--arias--carrasco-1B2A4A?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/ian-arias)
[![Instagram](https://img.shields.io/badge/Instagram-@__geoia.n-E8772A?style=flat-square&logo=instagram&logoColor=white)](https://www.instagram.com/_geoia.n)
![GIS](https://img.shields.io/badge/GIS-Geomática-21A9D8?style=flat-square)

Sitio estático publicado con GitHub Pages en **https://ayam-arias.github.io**.
No usa frameworks ni servicios de pago: todo el contenido sale de dos archivos JSON.

## Estructura

| Ruta | Qué contiene |
|---|---|
| `index.html` | La página (no es necesario tocarla). |
| `data/cv.json` | Perfil, experiencia, formación, diplomados, reconocimientos y competencias. |
| `data/certificados.json` | Listado de certificados que se muestran en la sección «Certificaciones». |
| `certificados/` | Los PDF de títulos, diplomados y cursos. |
| `scripts/` | Sincronización automática de certificados desde OneDrive. |
| `assets/` | Foto, logos, códigos QR, imagen para compartir y CV en PDF. |

## Agregar un certificado nuevo (automático)

1. Guarda el PDF en la subcarpeta de área que corresponda dentro de
   `OneDrive/Documentos/01_CAPACITACIONES`, con el nombre `SIGLA Nombre del curso.pdf`
   (ej.: `ESRI Fundamentos de SIG.pdf`). Si el nombre termina en ` - 40 h.` se toman las horas.
   Los diplomados van en `00 Títulos y Diplomados/DIPLOMADOS`.
2. Listo. El día 1 de cada mes a las 21:00 (o al encender el PC, si estaba apagado) la tarea de Windows **«Publicar certificados CV»** ejecuta
   `scripts/sync_certificados.bat`, que copia los PDF nuevos a `certificados/`, los agrega a
   `data/certificados.json` (y a los diplomados de `data/cv.json`), hace commit y push.
   Para publicar al instante, haz doble clic en `scripts/sync_certificados.bat`.

- Los PDF se reconocen por contenido: renombrar o mover uno no lo duplica.
- La sigla se traduce sola al nombre completo si ya hay certificados de esa institución
  (ESRI → Esri, UCH → Universidad de Chile). Si es nueva, revisa el campo `institucion` en el JSON.
- El área sale del nombre de la carpeta; si el mismo PDF está en dos carpetas, toma ambas áreas.
- Para que un PDF **no** se publique nunca, agrega su hash a `scripts/ignorados.txt` (instrucciones dentro).
- Probar sin publicar: `python scripts/sync_certificados.py --dry-run`. Registro: `scripts/sync.log`.
- Los certificados agregados en los últimos 60 días aparecen primero con la etiqueta «Nuevo».

## Documentos madre (se actualizan solos en el mismo proceso)

En `OneDrive/Documentos/02_INFORMACION PERSONAL`, cada certificado nuevo también se agrega a:

| Documento | Qué se agrega |
|---|---|
| `CV_MAESTRO_Ian_Arias_Carrasco_2026.docx` (CV base) | Una viñeta «Curso (N h), Institución (año).» al inicio de su área (y en Diplomados si corresponde). Suma el total «N capacitaciones certificadas». |
| `Curriculum_Maestro_Capacitaciones_Ian_Arias.docx` | Una fila en la tabla de su categoría; actualiza el resumen, el total y la fecha. |
| `Curriculum_Maestro_Capacitaciones_Ian_Arias.xlsx` | Una fila con categoría, institución, curso, horas, fecha y ruta del PDF (tabla con filtros). |

- Incluye **todos** los PDF nuevos, también los que no se publican en la web (`ignorados.txt` solo afecta al sitio).
- Antes de modificarlos se guarda una copia en `02_INFORMACION PERSONAL/_respaldos/`.
- Si algún documento está abierto en Word/Excel, se salta y se reintenta en la próxima ejecución.
- La fecha registrada es la del archivo PDF (no la impresa en el certificado): revísala si importa.
- Los PDF ya procesados quedan en `scripts/documentos_vistos.txt`.

## Editar perfil, experiencia o formación

Edita `data/cv.json` con el lápiz de GitHub. Cada sección es una lista; copia un bloque existente, cámbiale el texto y guarda con **Commit changes**.
Antes de guardar puedes revisar que el JSON sea válido en https://jsonlint.com.

## Publicación

Los cambios se publican solos **1–2 minutos** después de cada commit. Si no ves el cambio, recarga la página con Ctrl + F5.

## Criterios de publicación

- No se publica la cédula de identidad.
- El teléfono no aparece en texto visible: solo como botón de WhatsApp.
- La institución pública de origen aparece solo con nombre genérico.
