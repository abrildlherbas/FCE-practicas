# Guía de estilo HTML para revistas

## Estructura y clases

Una página contiene un único `<header class="header">`, un `<main>` y un
`<footer class="footer">`, en ese orden. El header identifica a la revista; el
main contiene el artículo y el footer conserva el contenido fijo del estándar.
Header y footer ocupan todo el ancho, con su contenido alineado a la columna del
main.

Las clases del estándar son literales y no se renombran:

| Clase | Uso |
| --- | --- |
| `.header` | Cabecera de la revista |
| `.info` | Datos editoriales agrupados en la cabecera |
| `.identidad` | ISSN, eISSN y DOI |
| `.footer` | Pie común de las revistas |
| `.mailto` | Enlace de correo |
| `.logo` | Logo fijo del footer |
| `.iconos` | Grupo de iconos, si corresponde al estándar |

El header contiene el único `<h1>` de la página. El título del artículo usa
`<h2>` y los encabezados del cuerpo comienzan en `<h3>`; se conserva el orden
jerárquico. El HTML no agrega clases específicas de una revista ni estilos
inline.

## IDs y referencias

Los atributos `data-obc-id`, `data-revista-id` y `data-articulo-id` identifican
la publicación en el header. Los IDs DOM deben ser únicos en la página. Cada
bloque de `article.body` lleva `data-bloque-id="b-<n>"`, donde `<n>` es su índice
estable dentro del artículo. Las referencias y citas conservan sus IDs y enlaces
de vuelta para permitir la navegación entre ellas.

## Theming y accesibilidad

La única personalización por revista es `--revista-color`, un hexadecimal
`#RRGGBB` válido. Se define una sola vez en un bloque `<style>`:

```html
<style>:root{--revista-color:#123A70}</style>
```

Ese color se usa como fondo de `.header` y `.footer`, y como acento de enlaces y
marcadores de nota del main. El texto de header y footer mantiene el color fijo
del CSS común. El main usa fondo neutro, una columna de hasta `70ch`, texto del
sistema e interlineado `1.6`. No se agregan sombras, degradados ni animaciones.
Los enlaces muestran foco visible y el movimiento respeta
`prefers-reduced-motion`.

## Cómo proponer un estilo

Un estilo nuevo se propone como cambio al estándar compartido: actualizar la
plantilla/CSS comunes, documentar la regla, agregar o ajustar pruebas de
conformidad y subir `src/template/VERSION`. No se parchea una revista en
particular ni se agrega otra variable personalizable. Antes de adoptar un cambio,
se verifica que conserve la estructura, los IDs y la accesibilidad del estándar.
