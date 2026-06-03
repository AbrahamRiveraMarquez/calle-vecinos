# 🏘️ Coladera de la Calle — Guía de despliegue

Tres archivos, tres pasos. Todo gratis.

---

## Archivos del proyecto

```
calle/
├── index.html          ← Frontend (va a Cloudflare Pages)
├── worker.js           ← Backend API (va a Cloudflare Workers)
├── supabase_schema.sql ← Base de datos (se ejecuta en Supabase)
└── README.md           ← Esta guía
```

---

## PASO 1 — Supabase (base de datos)

1. Ve a https://supabase.com y crea una cuenta gratis
2. Crea un **New Project** (nombre: `calle-coladera`)
3. Espera ~2 min a que inicialice
4. Ve a **SQL Editor** → **New query**
5. Pega todo el contenido de `supabase_schema.sql` y haz clic en **Run**
6. Verifica en **Table Editor** que se crearon las tablas: `vecinos`, `pagos`, `proyectos`
7. Guarda estos datos (los necesitas en el Paso 2):
   - **Project URL**: `https://xxxxxxxxxxxx.supabase.co`  
     (Settings → API → Project URL)
   - **service_role key**: la clave larga que empieza con `eyJ...`  
     (Settings → API → Project API keys → service_role → Reveal)

   ⚠️ La `service_role` key es secreta. NUNCA la pongas en el HTML.

---

## PASO 2 — Cloudflare Worker (backend/API)

### 2a. Crear el Worker

1. Ve a https://dash.cloudflare.com y crea una cuenta gratis
2. En el menú lateral: **Workers & Pages** → **Create** → **Create Worker**
3. Nómbralo: `calle-api`
4. En el editor que aparece, **borra todo** y pega el contenido de `worker.js`
5. Haz clic en **Deploy**

### 2b. Configurar las variables de entorno (secretos)

En el Worker recién creado:
**Settings** → **Variables and Secrets** → agrega estas variables:

| Variable       | Valor                                      |
|----------------|---------------------------------------------|
| `SUPABASE_URL` | `https://xxxxxxxxxxxx.supabase.co`          |
| `SUPABASE_KEY` | Tu service_role key (la que empieza `eyJ…`) |
| `EVA_PASS`     | La contraseña que quieras para Eva          |
| `ARM_PASS`     | La contraseña que quieras para Arm          |
| `CORS_ORIGIN`  | `*` por ahora (después pon tu URL de Pages) |

Guarda y vuelve a hacer **Deploy**.

### 2c. Anota la URL del Worker

Será algo como:  
`https://calle-api.TU-USUARIO.workers.dev`

---

## PASO 3 — Cloudflare Pages (frontend)

### 3a. Editar index.html

Abre `index.html` y en la línea donde dice:

```javascript
const API = 'https://TU-WORKER.TU-USUARIO.workers.dev';
```

Cambia por la URL real de tu Worker del Paso 2c.

### 3b. Subir a Pages

**Opción A — Subida directa (más fácil):**

1. En Cloudflare Dashboard: **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Nómbralo: `calle-vecinos`
3. Arrastra el archivo `index.html` (solo ese archivo)
4. Haz clic en **Deploy site**
5. Tu sitio estará en: `https://calle-vecinos.pages.dev`

**Opción B — Desde GitHub (recomendado para actualizaciones):**

1. Sube `index.html` a un repositorio GitHub privado
2. En Pages: **Connect to Git** → selecciona el repo
3. Framework preset: **None**
4. Build command: (vacío)
5. Build output directory: `/`
6. Deploy

### 3c. Actualizar CORS_ORIGIN en el Worker

Una vez que tengas la URL de Pages (ej. `https://calle-vecinos.pages.dev`):

1. Ve al Worker → Settings → Variables
2. Cambia `CORS_ORIGIN` de `*` a `https://calle-vecinos.pages.dev`
3. Re-deploy el Worker

---

## Credenciales de acceso

Las contraseñas las defines tú en las variables del Worker:

- Usuario **eva** → lo que pusiste en `EVA_PASS`
- Usuario **arm** → lo que pusiste en `ARM_PASS`

---

## Cómo funciona el sistema

```
Navegador (index.html en Pages)
    │
    │  HTTPS + X-User / X-Pass headers
    ▼
Cloudflare Worker (worker.js)
    │  autentica, valida, construye query
    │
    │  service_role key (secreta)
    ▼
Supabase (PostgreSQL)
    │  vecinos, pagos, proyectos
    │  Row Level Security habilitado
    ▼
Respuesta JSON → Worker → Navegador
```

- El navegador **nunca** toca Supabase directamente
- La `service_role` key vive solo en el Worker
- RLS en Supabase bloquea cualquier acceso directo

---

## Modo sin conexión

Si el Worker no está disponible, la app guarda en `localStorage` del navegador y sincroniza cuando vuelve la conexión.

---

## Rutas del API (Worker)

| Método | Ruta                     | Qué hace                        |
|--------|--------------------------|---------------------------------|
| GET    | `/health`                | Verifica que el Worker vive     |
| GET    | `/vecinos?sort=&q=`      | Lista todos los vecinos         |
| POST   | `/vecinos`               | Crear vecino (+ pago opcional)  |
| PUT    | `/vecinos/:id`           | Editar datos del vecino         |
| DELETE | `/vecinos/:id`           | Eliminar vecino y sus pagos     |
| GET    | `/vecinos/:id/pagos`     | Historial de pagos de un vecino |
| POST   | `/pagos`                 | Registrar un pago               |
| DELETE | `/pagos/:id`             | Eliminar un pago                |
| GET    | `/resumen`               | Stats generales del proyecto    |

---

## Para el futuro (próximos proyectos)

La tabla `proyectos` permite reutilizar la app para otras recolecciones. Solo inserta un nuevo proyecto y marca el anterior como `activo = false`.

---

## Costos

| Servicio            | Plan gratuito incluye                        |
|---------------------|----------------------------------------------|
| Supabase            | 500 MB DB, 2 GB transferencia/mes            |
| Cloudflare Workers  | 100,000 requests/día                         |
| Cloudflare Pages    | Hosting ilimitado, deploys ilimitados        |

Para una calle con 50–100 vecinos: **$0 al mes**.
