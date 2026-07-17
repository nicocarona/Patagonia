# fleet-inventory-module — Inventario y Repuestos

Primer módulo nuevo de la hoja de ruta (`AUDITORIA_Y_HOJA_DE_RUTA.docx`,
sección 6, punto 1): rastrea el stock físico real de repuestos por
almacén, y se conecta con Mantenimiento para generar automáticamente una
orden de compra cuando un componente crítico está por vencer y no hay
repuesto disponible.

## Requisitos

Node.js 22+. Mismo patrón dual SQLite/PostgreSQL que los demás módulos —
ver `fleet-billing-module/README.md` para el detalle completo.

## Autenticación

Toda ruta salvo `GET /health` exige `Authorization: Bearer <token>`
(`POST /login` contra `fleet-auth-module`, puerto 3007). Recibir/sacar
stock y gestionar órdenes de compra exige rol `admin` o `maintenance`; el
flujo automático de `fleet-integration` usa el rol `integration` para
crear órdenes de compra. Ver `fleet-auth-module/README.md`.

## Uso rápido

```bash
node src/cli-demo.js          # Demo de consola
SEED=1 node src/server.js     # API en http://localhost:3008 con datos de ejemplo
```

## El enlace con Mantenimiento

La clave de enlace es `part_number` — el mismo texto libre que usa
`fleet-maintenance-module.components.part_number`. No hay una foreign key
real entre las dos bases de datos (son servicios independientes); es la
misma convención de "clave de negocio compartida" que `tail_number` para
aeronaves o `employee_code` para tripulantes en el resto del sistema.

## El bloqueo de stock negativo

`POST /stock/issue` (sacar unidades del almacén) revisa el stock actual
ANTES de escribir y **rechaza** la operación si no alcanza — mismo patrón
de "bloquear antes, no descubrir después" del resto del sistema. Un
componente instalado sin que el sistema sepa de dónde salió no debería
poder registrarse.

## Órdenes de compra

`POST /purchase-orders` crea una orden en estado `draft`. Al recibirla
(`POST /purchase-orders/:id/receive`), el estado pasa a `received` **y**
se da entrada al stock en un solo paso — para no depender de que alguien
recuerde hacer ambas cosas por separado. El campo `triggered_by` distingue
si la orden se creó a mano (`manual`) o automáticamente por el flujo de
integración con Mantenimiento (`auto_maintenance_alert`).

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/parts` | Listar / dar de alta una parte del catálogo |
| GET | `/parts/by-number/:partNumber` | Buscar por part_number (usado por la integración) |
| GET/POST | `/warehouses` | Listar / crear almacenes |
| POST | `/stock/receive` | Ingresar unidades |
| POST | `/stock/issue` | Sacar unidades (rechaza si no alcanza el stock) |
| GET | `/reorder-alerts` | Partes en o por debajo de su punto de reorden |
| GET | `/dashboard` | Stock total y órdenes abiertas por parte |
| GET/POST | `/purchase-orders` | Listar (`?status=`) / crear orden de compra |
| POST | `/purchase-orders/:id/receive` | Recibir (da entrada al stock automáticamente) |
| POST | `/purchase-orders/:id/cancel` | Cancelar |
| GET | `/purchase-orders/has-open-auto/:partId` | ¿Hay ya una OC automática abierta para esta parte? (evita duplicar alertas) |

## Qué falta para producción

- **Órdenes de compra multi-línea.** Hoy cada orden es de una sola parte —
  suficiente para el caso de uso crítico (reposición de un componente
  específico), pero un departamento de compras real agrupa varias partes
  del mismo proveedor en una sola orden.
- **Reservas de stock** (apartar unidades para una orden de trabajo
  planeada antes de sacarlas físicamente) — hoy `issueStock` es
  instantáneo, no hay un estado intermedio "reservado".
- **Certificados de conformidad** (8130-3 o equivalente) adjuntos a cada
  recepción de stock — crítico en aviación, no solo un detalle de
  inventario general.
- **Multi-moneda** — `unit_cost_cents` asume una sola moneda para todo el
  sistema.
- Autenticación y permisos ya cubiertos por `fleet-auth-module`, pero
  falta registrar QUÉ usuario ejecutó cada movimiento de stock (el token
  identifica al usuario en cada request, pero no se persiste todavía junto
  al movimiento).
