// ============================================================
//  CLOUDFLARE WORKER — API para Coladera de la Calle
//  Archivo: worker.js
//
//  CONFIGURACIÓN en Cloudflare Dashboard → Workers → Settings → Variables:
//    SUPABASE_URL  = https://xxxxxxxxxxxx.supabase.co
//    SUPABASE_KEY  = tu service_role key (secreta, NO la anon key)
//    EVA_PASS      = contraseña de Eva (cámbiala)
//    ARM_PASS      = contraseña de Arm (cámbiala)
//    CORS_ORIGIN   = https://tu-sitio.pages.dev  (o * para pruebas)
// ============================================================

const ACCOUNTS = (env) => ({
  eva: env.EVA_PASS,
  arm: env.ARM_PASS,
});

// ── Helpers ─────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.CORS_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : ''),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User, X-Pass',
  };
}

function withCors(response, env, request) {
  const headers = corsHeaders(env, request);
  const r = new Response(response.body, response);
  Object.entries(headers).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}

// ── Autenticación simple (usuario/pass en header) ───────────
function autenticar(request, env) {
  const user = (request.headers.get('X-User') || '').toLowerCase().trim();
  const pass = request.headers.get('X-Pass') || '';
  const cuentas = ACCOUNTS(env);
  if (!cuentas[user] || cuentas[user] !== pass) return null;
  return user;
}

// ── Cliente Supabase (REST directo) ─────────────────────────
async function supabase(env, method, path, body = null) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`;
  const opts = {
    method,
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

// ── Router principal ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    // Autenticación en todas las rutas excepto /health
    const user = autenticar(request, env);
    if (path !== '/health' && !user) {
      return withCors(json({ error: 'No autorizado' }, 401), env, request);
    }

    try {

      // ── GET /health ───────────────────────────────────────
      if (request.method === 'GET' && path === '/health') {
        return withCors(json({ ok: true, version: '1.0' }), env, request);
      }

      // ── GET /vecinos ──────────────────────────────────────
      //  Devuelve todos los vecinos con su total pagado (vista)
      if (request.method === 'GET' && path === '/vecinos') {
        const sort = url.searchParams.get('sort') || 'created_at';
        const q    = url.searchParams.get('q') || '';

        let supaPath = '/vecinos_resumen?select=*';

        // Ordenamiento
        const sortMap = {
          alfa:    'nombre.asc',
          casa:    'casa.asc',
          ultimo:  'created_at.desc',
          registro:'created_at.asc',
        };
        supaPath += `&order=${sortMap[sort] || 'created_at.asc'}`;

        // Búsqueda por nombre (ilike)
        if (q) supaPath += `&nombre=ilike.*${encodeURIComponent(q)}*`;

        const r = await supabase(env, 'GET', supaPath);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json(r.data), env, request);
      }

      // ── POST /vecinos ─────────────────────────────────────
      //  Crear vecino nuevo
      if (request.method === 'POST' && path === '/vecinos') {
        const body = await request.json();
        if (!body.nombre?.trim()) {
          return withCors(json({ error: 'El nombre es obligatorio' }, 400), env, request);
        }
        const payload = {
          nombre:     body.nombre.trim(),
          apellido:   body.apellido?.trim() || null,
          casa:       body.casa?.trim() || null,
          creado_por: user,
        };
        const r = await supabase(env, 'POST', '/vecinos', payload);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);

        // Si viene con monto, registrar pago inicial
        const vecino = Array.isArray(r.data) ? r.data[0] : r.data;
        if (body.monto && parseFloat(body.monto) > 0) {
          await supabase(env, 'POST', '/pagos', {
            vecino_id:      vecino.id,
            monto:          parseFloat(body.monto),
            fecha_pago:     body.fecha || new Date().toISOString().slice(0, 10),
            nota:           body.nota || null,
            registrado_por: user,
          });
        }
        return withCors(json(vecino, 201), env, request);
      }

      // ── PUT /vecinos/:id ──────────────────────────────────
      //  Editar datos del vecino (no el pago)
      const editMatch = path.match(/^\/vecinos\/([^/]+)$/);
      if (request.method === 'PUT' && editMatch) {
        const id = editMatch[1];
        const body = await request.json();
        if (!body.nombre?.trim()) {
          return withCors(json({ error: 'El nombre es obligatorio' }, 400), env, request);
        }
        const payload = {
          nombre:   body.nombre.trim(),
          apellido: body.apellido?.trim() || null,
          casa:     body.casa?.trim() || null,
        };
        const r = await supabase(env, 'PATCH', `/vecinos?id=eq.${id}`, payload);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json({ ok: true }), env, request);
      }

      // ── DELETE /vecinos/:id ───────────────────────────────
      if (request.method === 'DELETE' && editMatch) {
        const id = editMatch[1];
        const r = await supabase(env, 'DELETE', `/vecinos?id=eq.${id}`);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json({ ok: true }), env, request);
      }

      // ── GET /vecinos/:id/pagos ────────────────────────────
      //  Historial de pagos de un vecino
      const pagosMatch = path.match(/^\/vecinos\/([^/]+)\/pagos$/);
      if (request.method === 'GET' && pagosMatch) {
        const id = pagosMatch[1];
        const r = await supabase(env, 'GET', `/pagos?vecino_id=eq.${id}&order=fecha_pago.desc`);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json(r.data), env, request);
      }

      // ── POST /pagos ───────────────────────────────────────
      //  Registrar un pago (puede ser parcial, en otro día)
      if (request.method === 'POST' && path === '/pagos') {
        const body = await request.json();
        if (!body.vecino_id) return withCors(json({ error: 'vecino_id requerido' }, 400), env, request);
        if (!body.monto || parseFloat(body.monto) <= 0) {
          return withCors(json({ error: 'monto debe ser mayor a 0' }, 400), env, request);
        }
        const payload = {
          vecino_id:      body.vecino_id,
          monto:          parseFloat(body.monto),
          fecha_pago:     body.fecha || new Date().toISOString().slice(0, 10),
          nota:           body.nota || null,
          registrado_por: user,
        };
        const r = await supabase(env, 'POST', '/pagos', payload);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json(Array.isArray(r.data) ? r.data[0] : r.data, 201), env, request);
      }

      // ── DELETE /pagos/:id ─────────────────────────────────
      const pagoDelMatch = path.match(/^\/pagos\/([^/]+)$/);
      if (request.method === 'DELETE' && pagoDelMatch) {
        const id = pagoDelMatch[1];
        const r = await supabase(env, 'DELETE', `/pagos?id=eq.${id}`);
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json({ ok: true }), env, request);
      }

      // ── GET /resumen ──────────────────────────────────────
      //  Stats generales del proyecto activo
      if (request.method === 'GET' && path === '/resumen') {
        const r = await supabase(env, 'GET', '/resumen_proyecto?select=*&limit=1');
        if (!r.ok) return withCors(json({ error: r.data }, r.status), env, request);
        return withCors(json(Array.isArray(r.data) ? r.data[0] : r.data), env, request);
      }

      // ── 404 ───────────────────────────────────────────────
      return withCors(json({ error: 'Ruta no encontrada' }, 404), env, request);

    } catch (err) {
      return withCors(json({ error: 'Error interno', detail: err.message }, 500), env, request);
    }
  },
};
