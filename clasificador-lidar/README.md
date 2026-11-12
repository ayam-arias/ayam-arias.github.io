# Clasificador LiDAR · GeoIAN

Aplicación web para clasificar nubes de puntos LiDAR directamente en el navegador, sin instalar nada y sin subir los datos a ningún servidor.

**Abrir:** https://ayam-arias.github.io/clasificador-lidar/

## Qué hace

| Paso | Función |
|---|---|
| 0 · Cargar | Abre **LAS 1.0–1.4** (formatos de punto 0–10), **LAZ** y texto **XYZ / PNEZD / PENZD / CSV con encabezado**. Arrastra el archivo o usa la demo "Los Aromos". Nubes de más de 3 millones de puntos se submuestrean (1 de cada k); el máximo es configurable. |
| 1 · Clasificación automática | 4 etapas transparentes y parametrizables: ruido (7/18), suelo por densificación progresiva (2), vegetación por altura sobre el suelo (3/4/5) y edificación por planaridad (6). Se ejecuta en segundo plano. |
| 2 · Resultado | Conteo por clase ASPRS y concordancia con la referencia (demo) o con la clasificación original del archivo. |
| 3 · Edición manual | Selección por **clic en un punto**, **rectángulo**, **lazo**, **perfil** o **Shift + arrastrar en 3D**. Reclasificación "de clase → a clase", deshacer (Ctrl+Z), Enter = aplicar, Esc = limpiar. |
| 3D | Visor 3D (three.js) con la nube completa, la selección (con su entorno) o el corredor del perfil; exageración vertical y tamaño de punto. |
| 5 · Exportar | **LAS clasificado** (conserva todos los atributos y VLR del original; LAZ → LAS sin comprimir), PNEZD .csv/.txt, LandXML, script .scr para AutoCAD/Civil 3D y bitácora. |

## Estructura

```
clasificador-lidar/
├── index.html          interfaz
├── css/app.css         estilo GeoIAN
├── js/app.js           planta, perfil, selección, exportación
├── js/viewer3d.js      visor 3D
├── js/classify.js      algoritmo de clasificación (también usable en Node)
├── js/lasio.js         lectura/escritura LAS, LAZ y texto
├── js/worker.js        proceso en segundo plano
├── data/los-aromos.json  nube demo simulada (EPSG:5361)
└── vendor/             three.js r187 (MIT) y laz-perf 0.0.7 (Apache-2.0)
```

## Notas

- Los parámetros están en **metros**. Si la nube está en pies, la app lo avisa.
- El algoritmo es didáctico. Para producción, valida con PDAL, LAStools o CloudCompare.
- Necesita abrirse desde un servidor web (GitHub Pages o `python -m http.server`), no con doble clic en el archivo.

## Referencias

American Society for Photogrammetry and Remote Sensing. (2019). *LAS specification 1.4 – R15*. ASPRS. https://www.asprs.org/wp-content/uploads/2019/07/LAS_1_4_r15.pdf

Axelsson, P. (2000). DEM generation from laser scanner data using adaptive TIN models. *International Archives of Photogrammetry and Remote Sensing, 33*(B4), 110–117.

---
© 2026 Ian Arias Carrasco · **GeoIAN** · Licencia MIT ·
[Sitio](https://ayam-arias.github.io) · [LinkedIn](https://www.linkedin.com/in/ian-arias) · [Instagram @_geoia.n](https://www.instagram.com/_geoia.n) · [GitHub](https://github.com/ayam-arias) · [Correo](mailto:ian.arias.carrasco@gmail.com)
