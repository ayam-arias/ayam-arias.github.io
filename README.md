# CV vivo – Ian Arias Carrasco

Sitio estático publicado con GitHub Pages en **https://ayam-arias.github.io**.
No usa frameworks ni servicios de pago: todo el contenido sale de dos archivos JSON.

## Estructura

| Ruta | Qué contiene |
|---|---|
| `index.html` | La página (no es necesario tocarla). |
| `data/cv.json` | Perfil, experiencia, formación, diplomados, reconocimientos y competencias. |
| `data/certificados.json` | Listado de certificados que se muestran en la sección «Certificaciones». |
| `certificados/` | Los PDF de títulos, diplomados y cursos. |
| `assets/` | Foto, logos, códigos QR, imagen para compartir y CV en PDF. |

## Agregar un certificado nuevo

1. En GitHub entra a la carpeta `certificados/` → **Add file → Upload files** y sube el PDF.
   Nómbralo en minúsculas, sin tildes ni espacios (usa guiones). Ejemplo: `curso-qgis-avanzado-esri.pdf`.
2. Abre `data/certificados.json` → ícono del lápiz (**Edit**) y agrega una entrada antes del último `]`
   (recuerda la coma entre entradas):

```json
{
 "titulo": "Curso QGIS Avanzado",
 "institucion": "Esri",
 "horas": 20,
 "areas": ["Geomática y SIG"],
 "archivo": "curso-qgis-avanzado-esri.pdf",
 "tipo": "curso"
}
```

- `tipo` puede ser `titulo`, `diplomado`, `curso` o `documento`.
- `horas` puede ser `null` si el certificado no lo indica.
- `areas` usa los mismos nombres de área ya existentes para que el filtro los agrupe.
- El contador de certificaciones se calcula solo.

3. Pulsa **Commit changes**.

## Editar perfil, experiencia o formación

Edita `data/cv.json` con el lápiz de GitHub. Cada sección es una lista; copia un bloque existente, cámbiale el texto y guarda con **Commit changes**.
Antes de guardar puedes revisar que el JSON sea válido en https://jsonlint.com.

## Publicación

Los cambios se publican solos **1–2 minutos** después de cada commit. Si no ves el cambio, recarga la página con Ctrl + F5.

## Criterios de publicación

- No se publica la cédula de identidad.
- El teléfono no aparece en texto visible: solo como botón de WhatsApp.
- La institución pública de origen aparece solo con nombre genérico.
