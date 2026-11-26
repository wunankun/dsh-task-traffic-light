# Semáforo de tareas de DSH

[![npm](https://img.shields.io/npm/v/dsh-task-traffic-light?label=npm)](https://www.npmjs.com/package/dsh-task-traffic-light)
[![downloads](https://img.shields.io/npm/dm/dsh-task-traffic-light?label=downloads)](https://www.npmjs.com/package/dsh-task-traffic-light)
[![check](https://github.com/wunankun/dsh-task-traffic-light/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/wunankun/dsh-task-traffic-light/actions/workflows/check.yml)
[![release](https://img.shields.io/github/v/release/wunankun/dsh-task-traffic-light?label=release)](https://github.com/wunankun/dsh-task-traffic-light/releases/latest)
[![macOS](https://img.shields.io/badge/macOS-13%2B-lightgrey?logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![MIT](https://img.shields.io/github/license/wunankun/dsh-task-traffic-light)](LICENSE)

Un semáforo que corre en macOS: mira si cada tarea sigue en marcha, te espera o ya terminó sin volver a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), y pulsa una luz encendida para ir a esa sesión.

<img src="docs/demo.gif" width="452" alt="La luz se enciende mientras las sesiones trabajan o esperan; la verde sigue encendida hasta que abres la sesión terminada.">

[简体中文](README.md) · [English](README.en.md) · **Español** · [日本語](README.ja.md) · [한국어](README.ko.md) · [MIT](LICENSE)

## Tres luces, tres hechos

| Luz | Encendida mientras | Al pulsarla |
|---|---|---|
| 🔴&nbsp;roja | al menos una sesión de primer nivel se está ejecutando | trae DSH al frente y abre la **siguiente** sesión en ejecución (cada clic pasa a otra) |
| 🟡&nbsp;amarilla | una sesión espera tu aprobación o tu respuesta | trae DSH al frente y abre la **primera** sesión en espera |
| 🟢&nbsp;verde | una sesión terminada todavía muestra su punto de no leída en DSH | trae DSH al frente y abre la **más antigua** sin leer |

Las luces son independientes: la roja y la verde pueden estar encendidas a la vez. Si pulsas una luz apagada o el borde vacío del panel, solo traes DSH al frente sin cambiar de sesión.

## Instalación

**1 — el plugin** (dentro de DSH):

```sh
dsh plugin add dsh-task-traffic-light
```

También puedes instalarlo desde el mercado de plugins de la aplicación. Casi siempre hay que refrescar la página después.

**2 — la aplicación:**

Lo más sencillo: abre **Plugins → este plugin** en DSH y pulsa **Install the lamp app**. El plugin descarga la versión publicada, la descomprime en `/Applications`, quita la cuarentena y la abre. A partir de ahí el control sigue a la aplicación: **Running** mientras está abierta, **Start** cuando la cierras y una línea pequeña **Update available v1.0.3** debajo del botón cuando hay una versión nueva. Los textos de la interfaz están en inglés o chino.

También puedes hacerlo desde la terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/wunankun/dsh-task-traffic-light/main/scripts/install-app.sh | sh
```

El script instala `TaskTrafficLight.app` en `/Applications` y la abre. ¿Prefieres hacerlo a mano? Descarga `TaskTrafficLight.zip` desde [Releases](https://github.com/wunankun/dsh-task-traffic-light/releases/latest), descomprímelo, arrástralo a Aplicaciones y haz clic derecho → Abrir la primera vez (la compilación está firmada ad hoc, sin notarizar).

**3 — listo.** Reinicia DSH, refresca su página y coloca el semáforo donde quieras. Se puede arrastrar a cualquier sitio; la posición se recuerda.

**Actualizaciones.** Solo hay una cosa que actualizar: el plugin. Una vez instalada la aplicación, el siguiente arranque la sustituye por la versión que trae el plugin. Una aplicación ausente nunca se instala sola: eso sigue siendo un clic.

## La luz verde sigue a DSH, no a una marca de tiempo

DSH ya pone un pequeño punto verde delante de una sesión que terminó mientras mirabas otra cosa. Ese punto es la verdad que esta aplicación dibuja:

- la luz está encendida mientras al menos una sesión lleve ese punto;
- abrir la sesión —pulsando la luz o de cualquier otra forma— borra el punto, y la luz lo sigue en menos de un segundo;
- la luz se apaga solo cuando desaparece el último punto.

Con varias sesiones sin leer, cada clic abre la más antigua y la da por vista, así que dos clics recorren una pequeña cola.

Hay un caso que DSH no marca y aquí sí: si la sesión seleccionada termina **mientras la ventana de DSH no está a la vista** —otra aplicación delante o la pestaña oculta—, cuenta como no leída y la luz se enciende. DSH solo sabe qué sesión es la vista principal, no si su ventana está visible; al volver a la ventana ese aviso se borra.

## Cómo funciona

```
DSH Host plugin ──escribe──> ~/.dsh/task-traffic-light/state.json <──lee── TaskTrafficLight.app
        ▲                                                                          │
        └────── /api/task-light/focus (autenticado, mismo origen) ◀── focus.json ──┘
```

- El plugin escribe una instantánea: sesiones en ejecución, interacciones pendientes, ids de sesiones en espera, ids sin leer y la velocidad de tokens.
- La aplicación consulta ese archivo y dibuja las luces.
- Un clic escribe `focus.json`; el plugin lo valida contra la luz de la que viene y se lo entrega a la interfaz web por el canal local autenticado de DSH. La página abre la sesión y confirma la petición.
- Las sesiones de subagentes se filtran: no tienen fila que abrir, así que nunca pueden dejar una luz encendida.

## Privacidad

Sin puerto abierto. El plugin escribe un JSON en `~/.dsh/task-traffic-light/`; la aplicación escribe otro cuando pulsas una luz. Nada sale de la máquina por sí solo.

La única excepción es el botón de instalación de la página del plugin: al pulsarlo descarga el archivo de la versión desde GitHub y ejecuta `ditto`, `xattr` y `open` del sistema para colocar la aplicación. No se ejecuta de otro modo, y desinstalar el plugin elimina ese botón. Desinstalarlo también borra la aplicación instalada y sus preferencias `local.tasktrafficlight` unos segundos después, sin dejar nada en `/Applications`. En total son unas 600 líneas de JavaScript y 500 de Swift: se puede leer entero en una sentada.

## Requisitos

- macOS 13 o posterior, Apple silicon o Intel (la versión publicada es universal)
- DeepSeek Harness 0.2.1 o posterior, con un perfil al que puedas añadir plugins

Los menús de la aplicación están en chino por ahora; una traducción sería muy bienvenida.

## Problemas

**Todas las luces apagadas.** Sin un `state.json` actualizado en 10 segundos significa «DSH no está en marcha». Comprueba que el plugin está activo (`dsh plugin list`) y luego `tail -f ~/.dsh/task-traffic-light/state.json`.

**Al pulsar no pasa nada.** El clic lo aplica la página de DSH, así que hace falta una página que haya cargado la mitad cliente del plugin: refresca DSH una vez tras instalar. Una petición de más de 30 segundos caduca en silencio.

**La luz está encendida pero no parece pasar nada.** El plugin solo cuenta sesiones de primer nivel; los subagentes nunca encienden nada por su cuenta.

## Compilar desde el código

```sh
git clone https://github.com/wunankun/dsh-task-traffic-light
cd dsh-task-traffic-light
./macos/build.sh          # binario universal, requiere las herramientas de línea de comandos de Xcode
open macos/TaskTrafficLight.app
```

## Licencia

MIT © 2026 wunankun
