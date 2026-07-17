# Cómo poner el sistema en internet (Render)

Esta guía asume que nunca has desplegado nada a la nube. Son 3 pasos:
subir el código a GitHub, conectar Render a ese repositorio, y esperar.

## Paso 1 — Crear cuenta y subir el código a GitHub

1. Crea una cuenta gratis en [github.com](https://github.com) si no tienes.
2. Crea un repositorio nuevo (botón verde "New"), dale un nombre como
   `flota-helicopteros`, déjalo **vacío** (sin README, sin .gitignore —
   este proyecto ya los trae).
3. En tu terminal, dentro de la carpeta `sistema-flota-helicopteros`
   (la que contiene `fleet-billing-module`, `fleet-scheduling-module`,
   etc. y este mismo archivo):

```bash
git init
git add -A
git commit -m "Sistema de control de flota de helicópteros"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/flota-helicopteros.git
git push -u origin main
```

Reemplaza `TU-USUARIO` por tu usuario de GitHub. Te va a pedir iniciar
sesión la primera vez (sigue las instrucciones en pantalla).

## Paso 2 — Conectar Render

1. Crea una cuenta gratis en [render.com](https://render.com) (puedes
   entrar directo con tu cuenta de GitHub).
2. En el panel, click **New** → **Blueprint**.
3. Selecciona el repositorio `flota-helicopteros` que acabas de subir.
4. Render detecta automáticamente el archivo `render.yaml` en la raíz y te
   muestra un resumen: va a crear **11 servicios web** (autenticación,
   maestro, facturación, programación, tripulación, SMS, mantenimiento,
   inventario, despacho de vuelo, entrenamiento y vigencias,
   combustible), **11 bases de datos PostgreSQL** (una por módulo — ver
   nota de arquitectura federada en `AUDITORIA_Y_HOJA_DE_RUTA.docx`), **1
   grupo de variables compartidas** (`fleet-shared`, con `AUTH_SECRET`
   generado automáticamente por Render), y **1 Cron Job**
   (`fleet-sync-job`) que corre los **7 flujos** de
   `fleet-integration/sync.js` cada 15
   minutos (despacho de vuelo solo participa del cron en el flujo 6, hacia
   combustible — ver `fleet-dispatch-module/README.md`).
5. Click **Apply** / **Create**.

## Paso 3 — Esperar y probar

Render tarda unos minutos en construir y arrancar todo. Cuando termine, te
da once URLs públicas, algo como:

```
https://fleet-auth-api.onrender.com
https://fleet-core-api.onrender.com
https://fleet-billing-api.onrender.com
https://fleet-scheduling-api.onrender.com
https://fleet-crew-api.onrender.com
https://fleet-sms-api.onrender.com
https://fleet-maintenance-api.onrender.com
https://fleet-inventory-api.onrender.com
https://fleet-dispatch-api.onrender.com
https://fleet-training-api.onrender.com
https://fleet-fuel-api.onrender.com
```

Primero inicia sesión para conseguir un token (los usuarios de demo y sus
contraseñas están en `fleet-auth-module/README.md`):

```
curl -X POST https://fleet-auth-api.onrender.com/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123"}'
```

Con el `token` que te devuelve, pruébalo contra cualquiera de los otros
módulos igual que hiciste en tu computadora, pero con esa URL en vez de
`localhost` y el header `Authorization`:

```
curl https://fleet-core-api.onrender.com/aircraft -H "Authorization: Bearer TU_TOKEN"
curl https://fleet-billing-api.onrender.com/customers -H "Authorization: Bearer TU_TOKEN"
curl https://fleet-maintenance-api.onrender.com/dashboard -H "Authorization: Bearer TU_TOKEN"
```

Si ves las listas de clientes/aeronaves en JSON, ya está en vivo — cualquier
persona con un usuario válido (en cualquier parte del país) puede usarlo.
Sin token, o con un rol que no alcanza para la operación, la API responde
401 o 403 en vez de datos — es el comportamiento esperado.

## Después de esto — importante

- **El plan gratis de Render "duerme" cada servicio** si nadie lo usa por 15
  minutos; la siguiente solicitud tarda ~30 segundos en despertarlo. Con 11
  servicios + 1 cron job esto es más notorio que con 2 — si el cron de
  sincronización corre mientras un servicio está dormido, esa corrida puede
  fallar o tardar; revisa los logs del Cron Job en el panel de Render. Para
  uso real de la empresa, cambia a un plan pagado (unos $7 USD/mes por
  servicio) desde el panel de Render.
- **La sección `fromService` del `render.yaml`** que apunta las URLs del
  Cron Job a cada servicio web, y el grupo `envVarGroups` que comparte
  `AUTH_SECRET`, usan la sintaxis de Render Blueprints tal como la
  documentan al momento de escribir esto — no las probamos contra una
  cuenta real de Render (no tengo forma de desplegar por ti en esta
  sesión). Si al aplicar el blueprint Render marca alguna de las dos como
  inválida: para `fromService`, reemplázala a mano por las URLs públicas
  literales una vez que Render te las asigne; para `envVarGroups`, define
  `AUTH_SECRET` manualmente como el mismo valor literal en cada uno de los
  7 servicios (Environment → Add Environment Variable) — ambas son
  alternativas simples que siempre funcionan.
- **Cambia las contraseñas de demostración antes de usar datos reales.**
  Los 8 usuarios que siembra `fleet-auth-module` (`admin`, `ana.reyes`,
  etc.) todos tienen la contraseña `changeme123` — ver
  `fleet-auth-module/README.md`. Créate un usuario propio
  (`POST /users` contra `fleet-auth-api`, con el token de `admin`) y
  desactiva o elimina los de demostración.
- **Cada módulo tiene su propia base de datos** (arquitectura federada, ver
  el documento de auditoría) — no hay una sola base "del sistema". Esto es
  intencional y honesto sobre cómo está construido, pero significa que un
  respaldo/restauración tiene que cubrir las 11 bases, no una.
- Para actualizar el sistema más adelante: solo vuelve a hacer
  `git add -A && git commit -m "cambios" && git push` — Render redespliega
  solo cada vez que hay un push a `main`.
