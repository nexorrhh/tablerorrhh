// ════════════════════════════════════════════════════════════════════════════════════════════
// NEXO RRHH — Autorización de permisos por responsable de área
// Cambios para la Edge Function "rapid-function" (los DOS proyectos: Cimomet y Co.mo.ing).
//
// Qué hace:
//   · Al cargarse un permiso, el mail le llega SOLO al responsable del área de esa persona (los
//     responsables y sus puestos se arman en el Tablero de RRHH → Desempeño → Parametrización →
//     Evaluadores). Si su puesto no tiene responsable con email, le llega a los autorizadores
//     generales como hasta ahora (permisos_config.emails_autorizadores).
//   · El mail trae un botón "Revisar y autorizar" que abre la página Autorizaciones/ del Tablero
//     con el detalle del pedido y los botones Autorizar / Rechazar. Sin usuario ni contraseña:
//     el link lleva una clave firmada (HMAC) que solo sirve para ese responsable y vence a los 30
//     días. No se aprueba nada desde el mail mismo: Outlook y los antivirus abren los links solos
//     para revisarlos, y aprobarían permisos sin que nadie los toque.
//
// ── CÓMO APLICARLO ──────────────────────────────────────────────────────────────────────────
// Partí SIEMPRE del código que está publicado hoy en Supabase (Edge Functions → rapid-function
// → Code), no de las copias .txt viejas de Documents\Nexo_RRHH.
//
//   1) BLOQUE A — reemplaza el bloque entero que empieza con
//        // ── NOTIFICAR NUEVA SOLICITUD DE PERMISO (a autorizadores) ───
//      y termina en el `}` que cierra `if (... action === "notificar_permiso_nuevo") { ... }`.
//   2) BLOQUE B — se pega justo ANTES de la última línea del serve:
//        return json({ error: "Acción no reconocida." }, 400)
//   3) CAMBIO C — en "notificar_permiso" (mail al empleado), reemplazar
//        fue <strong style="color:#15803d">aprobada</strong> por Recursos Humanos.</p>
//      por
//        fue <strong style="color:#15803d">aprobada</strong>.</p>
//      y "Comentario de RRHH:" por "Comentario:" (ahora aprueba el responsable, no siempre RRHH;
//      el comentario ya dice "Aprobado por <nombre>").
//
//   4) Secrets nuevos (Edge Functions → Secrets), en CADA proyecto:
//        TABLERO_SUPABASE_URL       = https://bmueojeeexheprteavay.supabase.co
//        TABLERO_SUPABASE_ANON_KEY  = (la anon key del Tablero — la de data/fuentes.js)
//        TABLERO_EMPRESA            = CIMOMET   (en el proyecto de Co.mo.ing: COMOING)
//        AUTORIZACIONES_URL         = <URL publicada del Tablero>/Autorizaciones/
//        PERMISOS_LINK_SECRET       = una frase larga y secreta inventada (distinta en cada proyecto)
//
//   Mientras falte TABLERO_SUPABASE_URL, AUTORIZACIONES_URL o PERMISOS_LINK_SECRET, la función
//   sigue mandando el mail a los autorizadores generales como hoy: aplicar esto no rompe nada.
// ════════════════════════════════════════════════════════════════════════════════════════════


// ════════════════════════ BLOQUE A ════════════════════════
  // ── PERMISOS POR RESPONSABLE DE ÁREA: configuración y helpers ─────────────
  const TABLERO_SB_URL = Deno.env.get("TABLERO_SUPABASE_URL") || ""
  const TABLERO_SB_KEY = Deno.env.get("TABLERO_SUPABASE_ANON_KEY") || ""
  const TABLERO_EMPRESA = (Deno.env.get("TABLERO_EMPRESA") || "").toUpperCase()   // "CIMOMET" | "COMOING"
  const AUTORIZACIONES_URL = Deno.env.get("AUTORIZACIONES_URL") || ""
  const LINK_SECRET = Deno.env.get("PERMISOS_LINK_SECRET") || ""
  const LINK_VIGENCIA_MS = 30 * 24 * 60 * 60 * 1000
  const porResponsableHabilitado = !!(TABLERO_SB_URL && TABLERO_SB_KEY && TABLERO_EMPRESA && AUTORIZACIONES_URL && LINK_SECRET)

  const tipoPermisoLabel = (t: string) =>
    t === "salida_anticipada" ? "Salida anticipada" : t === "ausencia" ? "Ausencia" : "Llegada tarde"

  // Vista v_responsables_permisos del Tablero (sql/permisos_responsables.sql): quién autoriza a quién.
  async function consultarResponsables(filtro: string): Promise<any[]> {
    if (!porResponsableHabilitado) return []
    try {
      const r = await fetch(
        `${TABLERO_SB_URL}/rest/v1/v_responsables_permisos?empresa=eq.${TABLERO_EMPRESA}&${filtro}&select=legajo,responsable_nombre,responsable_email`,
        { headers: { apikey: TABLERO_SB_KEY, Authorization: `Bearer ${TABLERO_SB_KEY}` } },
      )
      return r.ok ? await r.json() : []
    } catch { return [] }
  }
  async function responsablesDeLegajo(legajo: string | number) {
    const filas = await consultarResponsables(`legajo=eq.${encodeURIComponent(String(legajo))}`)
    const porEmail = new Map<string, string>()
    filas.forEach((f: any) => porEmail.set(f.responsable_email, f.responsable_nombre))
    return [...porEmail].map(([email, nombre]) => ({ email, nombre }))
  }
  async function areaDeResponsable(email: string) {
    const filas = await consultarResponsables(`responsable_email=eq.${encodeURIComponent(email)}`)
    return {
      nombre: filas[0]?.responsable_nombre ?? "",
      legajos: new Set(filas.map((f: any) => String(f.legajo))),
    }
  }

  // Link firmado: base64url({ e: email, x: vencimiento }) + "." + HMAC-SHA256.
  const enc = new TextEncoder()
  const b64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const desdeB64url = (s: string) =>
    atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))
  async function firmar(texto: string) {
    const key = await crypto.subtle.importKey("raw", enc.encode(LINK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(texto))))
  }
  async function crearTokenResponsable(email: string) {
    const payload = b64url(enc.encode(JSON.stringify({ e: email, x: Date.now() + LINK_VIGENCIA_MS })))
    return `${payload}.${await firmar(payload)}`
  }
  async function emailDesdeToken(token: string): Promise<string | null> {
    if (!LINK_SECRET || typeof token !== "string") return null
    const [payload, firma] = token.split(".")
    if (!payload || !firma || (await firmar(payload)) !== firma) return null
    try {
      const datos = JSON.parse(desdeB64url(payload))
      return datos.x > Date.now() ? String(datos.e) : null
    } catch { return null }
  }

  // ── NOTIFICAR NUEVA SOLICITUD DE PERMISO (al responsable del área) ───
  if (req.method === "POST" && action === "notificar_permiso_nuevo") {
    const { permiso_id } = await req.json()
    const { data: permiso } = await sb
      .from("permisos_solicitudes")
      .select("*, empleados(nombre, apellido, legajo)")
      .eq("id", permiso_id)
      .single()
    if (!permiso) return json({ error: "Permiso no encontrado." }, 400)
    const emp = permiso.empleados
    const tipoLabel = tipoPermisoLabel(permiso.tipo)
    const fechaFmt = new Date(permiso.fecha + "T00:00:00").toLocaleDateString("es-AR")
    const horaFmt = (permiso.hora ?? "").slice(0, 5)
    const fechaHoraStr = permiso.tipo === "ausencia" ? `${fechaFmt} - Jornada completa` : `${fechaFmt} a las ${horaFmt}`
    const motivoHTML = permiso.motivo
      ? `<p style="margin:8px 0 0"><strong>Motivo:</strong> ${permiso.motivo}</p>`
      : ""
    const cuerpo = (boton: string) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px">
      <h2 style="color:#1a1a2e">Nueva solicitud de permiso - ${empresa.nombre}</h2>
      <p><strong>${emp.apellido}, ${emp.nombre}</strong> (Leg. ${emp.legajo}) cargó una nueva solicitud:</p>
      <div style="margin:20px 0;padding:16px 20px;background:#f9f8f6;border:1px solid #e5e1d8;border-radius:8px">
        <p style="margin:0"><strong>Tipo:</strong> ${tipoLabel}</p>
        <p style="margin:8px 0 0"><strong>Fecha:</strong> ${fechaHoraStr}</p>
        ${motivoHTML}
      </div>
      <p>La solicitud está <strong>pendiente de aprobación</strong>.</p>
      ${boton}
      ${mailFooter}
    </div>`
    const asunto = `${empresa.nombre} - Nueva solicitud - ${emp.apellido}, ${emp.nombre} - ${tipoLabel}`

    // 1) Al responsable del área, con el link para autorizar.
    const responsables = await responsablesDeLegajo(emp.legajo)
    if (responsables.length > 0) {
      for (const r of responsables) {
        const token = await crearTokenResponsable(r.email)
        const link = `${AUTORIZACIONES_URL}?tenant=${TABLERO_EMPRESA.toLowerCase()}&permiso=${permiso.id}&t=${encodeURIComponent(token)}`
        await sendEmail(r.email, asunto, cuerpo(
          `<a href="${link}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#be185d;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Revisar y autorizar</a>
           <p style="color:#666;font-size:13px">Te llega porque sos responsable del área de ${emp.nombre}. El link es personal: no lo reenvíes.</p>`,
        ))
      }
      return json({ ok: true, enviados: responsables.length, destino: "responsable" })
    }

    // 2) Sin responsable con email: a los autorizadores generales, como siempre.
    const { data: cfg } = await sb.from("permisos_config").select("emails_autorizadores").single()
    const destinos: string[] = cfg?.emails_autorizadores ?? []
    if (destinos.length === 0) return json({ ok: true, enviados: 0 })
    const tableroUrl = Deno.env.get("TABLERO_URL") || APP_URL
    const html = cuerpo(`<a href="${tableroUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#be185d;color:white;text-decoration:none;border-radius:8px;font-weight:bold">Ver permisos pendientes</a>`)
    for (const dest of destinos) {
      await sendEmail(dest, asunto, html)
    }
    return json({ ok: true, enviados: destinos.length, destino: "generales" })
  }
// ══════════════════════ FIN BLOQUE A ══════════════════════


// ════════════════════════ BLOQUE B ════════════════════════
  // ── AUTORIZACIONES (página del responsable): pendientes de su área ──
  if (req.method === "POST" && action === "autorizador_pendientes") {
    const { token } = await req.json()
    const email = await emailDesdeToken(token)
    if (!email) return json({ error: "El link venció o no es válido. Pedí que te reenvíen el aviso." }, 401)
    const area = await areaDeResponsable(email)
    if (area.legajos.size === 0) return json({ error: "No tenés personas asignadas para autorizar." }, 403)
    const { data: permisos } = await sb
      .from("permisos_solicitudes")
      .select("id, tipo, fecha, hora, motivo, created_at, empleados(nombre, apellido, legajo)")
      .eq("estado", "pendiente")
      .order("fecha", { ascending: true })
    const mios = (permisos ?? []).filter((p: any) => area.legajos.has(String(p.empleados?.legajo)))
    return json({
      ok: true,
      empresa: empresa.nombre,
      responsable: area.nombre,
      permisos: mios.map((p: any) => ({
        id: p.id, tipo: p.tipo, fecha: p.fecha, hora: p.hora, motivo: p.motivo, created_at: p.created_at,
        empleado: { nombre: p.empleados.nombre, apellido: p.empleados.apellido, legajo: p.empleados.legajo },
      })),
    })
  }

  // ── AUTORIZACIONES (página del responsable): historial de la persona ──
  // Los últimos permisos que pidió la misma persona (sin contar el que se está revisando), para
  // que el responsable decida con contexto. Mismo control que el resto: solo gente de su área.
  if (req.method === "POST" && action === "autorizador_historial") {
    const { token, permiso_id } = await req.json()
    const email = await emailDesdeToken(token)
    if (!email) return json({ error: "El link venció o no es válido. Pedí que te reenvíen el aviso." }, 401)
    const area = await areaDeResponsable(email)
    const { data: permiso } = await sb
      .from("permisos_solicitudes")
      .select("id, empleado_id, empleados(legajo)")
      .eq("id", permiso_id)
      .single()
    if (!permiso || !area.legajos.has(String((permiso as any).empleados?.legajo))) {
      return json({ error: "Este permiso no corresponde a tu área." }, 403)
    }
    const { data: historial } = await sb
      .from("permisos_solicitudes")
      .select("id, tipo, fecha, hora, motivo, estado, observacion_rrhh, created_at")
      .eq("empleado_id", (permiso as any).empleado_id)
      .neq("id", permiso_id)
      .order("fecha", { ascending: false })
      .limit(10)
    return json({ ok: true, historial: historial ?? [] })
  }

  // ── AUTORIZACIONES (página del responsable): autorizar / rechazar ──
  if (req.method === "POST" && action === "autorizador_resolver") {
    const { token, permiso_id, accion, observacion } = await req.json()
    const email = await emailDesdeToken(token)
    if (!email) return json({ error: "El link venció o no es válido. Pedí que te reenvíen el aviso." }, 401)
    if (!permiso_id || (accion !== "aprobar" && accion !== "rechazar")) return json({ error: "Pedido inválido." }, 400)
    if (accion === "rechazar" && !String(observacion ?? "").trim()) return json({ error: "Indicá el motivo del rechazo." }, 400)

    const area = await areaDeResponsable(email)
    const { data: permiso } = await sb
      .from("permisos_solicitudes")
      .select("id, estado, empleados(legajo)")
      .eq("id", permiso_id)
      .single()
    // Se vuelve a chequear del lado del servidor que la persona sea de su área: el link solo
    // identifica al responsable, no habilita a resolver cualquier permiso.
    if (!permiso || !area.legajos.has(String((permiso as any).empleados?.legajo))) {
      return json({ error: "Este permiso no corresponde a tu área." }, 403)
    }
    if (permiso.estado !== "pendiente") return json({ error: "Este permiso ya fue resuelto.", estado: permiso.estado }, 409)

    const quien = area.nombre || email
    const obs = String(observacion ?? "").trim()
    const obsRrhh = accion === "aprobar"
      ? (obs ? `${obs} — Aprobado por ${quien}` : `Aprobado por ${quien}`)
      : `${obs} — Rechazado por ${quien}`
    const { error: errUp } = await sb
      .from("permisos_solicitudes")
      .update({
        estado: accion === "aprobar" ? "aprobado" : "rechazado",
        aprobado_por: null,
        aprobado_at: new Date().toISOString(),
        observacion_rrhh: obsRrhh,
      })
      .eq("id", permiso_id)
      .eq("estado", "pendiente")
    if (errUp) return json({ error: errUp.message }, 500)
    if (accion === "aprobar") {
      // Mismo aviso que al aprobar desde el Tablero: mail al empleado + lista de distribución.
      const funcUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/rapid-function?action=notificar_permiso`
      fetch(funcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ permiso_id }),
      }).catch(() => {})
    }
    return json({ ok: true })
  }
// ══════════════════════ FIN BLOQUE B ══════════════════════
