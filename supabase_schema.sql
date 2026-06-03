-- ============================================================
--  COLADERA DE LA CALLE — Esquema Supabase
--  Ejecuta esto en: Supabase → SQL Editor → New query
-- ============================================================

-- ── 1. TABLA DE VECINOS ─────────────────────────────────────
--  Catálogo base de personas de la calle.
--  nombre es obligatorio; apellido y casa son opcionales.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vecinos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT        NOT NULL,
  apellido    TEXT,
  casa        TEXT,
  creado_por  TEXT        NOT NULL,          -- 'eva' | 'arm'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. TABLA DE PAGOS ────────────────────────────────────────
--  Un vecino puede tener múltiples registros de pago
--  (pagos parciales en distintos días).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  vecino_id   UUID        NOT NULL REFERENCES vecinos(id) ON DELETE CASCADE,
  monto       NUMERIC(10,2) NOT NULL DEFAULT 0,
  fecha_pago  DATE        NOT NULL DEFAULT CURRENT_DATE,
  nota        TEXT,
  registrado_por TEXT     NOT NULL,          -- 'eva' | 'arm'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. TABLA DE PROYECTOS ───────────────────────────────────
--  Guarda la meta económica de cada proyecto.
--  Así en el futuro puedes reutilizar la app para otro proyecto.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proyectos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT        NOT NULL,
  descripcion TEXT,
  meta_sin_entrega NUMERIC(10,2) NOT NULL DEFAULT 225.00,
  meta_con_entrega NUMERIC(10,2) NOT NULL DEFAULT 307.00,
  activo      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proyecto inicial: coladera
INSERT INTO proyectos (nombre, descripcion, meta_sin_entrega, meta_con_entrega)
VALUES (
  'Coladera 2024',
  '2 botes de grava, 2 botes de arena, 1 bulto de cemento 25 kg. Tabiques cotizar aparte a $8.50 c/u.',
  225.00,
  307.00
);

-- ── 4. TRIGGER: updated_at automático ───────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vecinos_updated_at
  BEFORE UPDATE ON vecinos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. VISTA: resumen por vecino ────────────────────────────
--  Suma todos los pagos de cada vecino en una sola fila.
--  El Worker y el frontend la usan para mostrar la tabla.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vecinos_resumen AS
SELECT
  v.id,
  v.nombre,
  v.apellido,
  v.casa,
  v.creado_por,
  v.created_at,
  v.updated_at,
  COALESCE(SUM(p.monto), 0)           AS total_pagado,
  COUNT(p.id)                          AS num_pagos,
  MAX(p.fecha_pago)                    AS ultimo_pago
FROM vecinos v
LEFT JOIN pagos p ON p.vecino_id = v.id
GROUP BY v.id;

-- ── 6. VISTA: resumen general del proyecto activo ───────────
CREATE OR REPLACE VIEW resumen_proyecto AS
SELECT
  pr.nombre                                      AS proyecto,
  pr.meta_sin_entrega,
  pr.meta_con_entrega,
  COUNT(DISTINCT v.id)                           AS total_vecinos,
  COUNT(DISTINCT p.vecino_id)                    AS vecinos_pagaron,
  COALESCE(SUM(p.monto), 0)                      AS total_recaudado,
  pr.meta_sin_entrega - COALESCE(SUM(p.monto),0) AS faltante
FROM proyectos pr
LEFT JOIN vecinos v ON TRUE
LEFT JOIN pagos   p ON TRUE
WHERE pr.activo = TRUE
GROUP BY pr.id;

-- ── 7. ROW LEVEL SECURITY (RLS) ─────────────────────────────
--  El Worker usa la Service Role Key (secreta, solo en el Worker).
--  RLS bloquea acceso directo desde el navegador.
-- ────────────────────────────────────────────────────────────
ALTER TABLE vecinos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;

-- Solo el service role (Worker) puede leer/escribir.
-- Nadie más (anon key pública) tiene acceso.
CREATE POLICY "solo_service_role" ON vecinos
  USING (auth.role() = 'service_role');

CREATE POLICY "solo_service_role" ON pagos
  USING (auth.role() = 'service_role');

CREATE POLICY "solo_service_role" ON proyectos
  USING (auth.role() = 'service_role');

-- ── 8. ÍNDICES para rendimiento ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pagos_vecino   ON pagos(vecino_id);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha    ON pagos(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_vecinos_nombre ON vecinos(nombre);
CREATE INDEX IF NOT EXISTS idx_vecinos_casa   ON vecinos(casa);

-- ============================================================
--  FIN DEL ESQUEMA
--  Después de ejecutar esto verifica en:
--  Supabase → Table Editor → vecinos, pagos, proyectos
-- ============================================================
