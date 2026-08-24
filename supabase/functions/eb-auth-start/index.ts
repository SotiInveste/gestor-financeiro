// ═══════════════════════════════════════════════════════════
// eb-auth-start — início da autorização open banking
//
// Duas acções, escolhidas pelo campo "action" do corpo do pedido:
//
//   { "action": "list" }
//     → lista os bancos disponíveis no país (por omissão PT)
//
//   { "action": "start", "aspsp_name": "...", "aspsp_country": "PT" }
//     → cria a sessão de autorização e devolve o URL para onde o
//       utilizador deve ser reencaminhado
//
// Secrets necessários:
//   EB_APPLICATION_ID  — application_id da Enable Banking
//   EB_PRIVATE_KEY     — chave privada .pem em PKCS#8
//   EB_REDIRECT_URL    — tem de ser IGUAL ao registado no painel da
//                        Enable Banking, incluindo a barra final
//
// SUPABASE_URL e SUPABASE_ANON_KEY são injectados automaticamente.
//
// Ficheiro auto-contido: o deploy é pelo Dashboard, que não faz
// bundling de imports partilhados entre funções.
// ═══════════════════════════════════════════════════════════

const EB_BASE = "https://api.enablebanking.com";

// Validade pedida para o consentimento. Os bancos costumam limitar a
// 180 dias e podem devolver menos — o valor real vem na resposta.
const CONSENT_DAYS = 180;

// O SDK do Supabase envia apikey e x-client-info além do authorization.
// Se não constarem aqui, o preflight falha e o pedido nem chega a sair.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ─── Assinatura do JWT da aplicação ───

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(applicationId: string, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: applicationId }))}.` +
    b64url(JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: now,
      exp: now + 3600,
    }));

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/**
 * Confirma que o pedido vem de um utilizador autenticado.
 * Verificação explícita — não depende do toggle verify_jwt do Dashboard.
 */
async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: anonKey },
  });
  if (!res.ok) return null;

  const user = await res.json().catch(() => null);
  return user?.id ? { id: user.id } : null;
}

// ─── Handler ───

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const user = await requireUser(req);
  if (!user) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }

  const applicationId = Deno.env.get("EB_APPLICATION_ID");
  const privateKey = Deno.env.get("EB_PRIVATE_KEY");
  const redirectUrl = Deno.env.get("EB_REDIRECT_URL");

  if (!applicationId || !privateKey) {
    return json({ ok: false, error: "Faltam os secrets EB_APPLICATION_ID / EB_PRIVATE_KEY." }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action ?? "list";

  let jwt: string;
  try {
    jwt = await signJwt(applicationId, privateKey);
  } catch (err) {
    console.error("Falha ao assinar o JWT:", err);
    return json({ ok: false, step: "assinatura", error: String((err as Error)?.message ?? err) }, 500);
  }

  const ebHeaders = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };

  // ─── Listar bancos ───
  if (action === "list") {
    const country = body?.country ?? "PT";
    try {
      const res = await fetch(`${EB_BASE}/aspsps?country=${encodeURIComponent(country)}`, {
        headers: ebHeaders,
      });
      const detail = await res.json().catch(() => null);
      if (!res.ok) {
        console.error("Enable Banking /aspsps devolveu", res.status, detail);
        return json({ ok: false, step: "api", status: res.status, detail }, 502);
      }
      // Devolver só o essencial para a interface.
      const aspsps = (detail?.aspsps ?? []).map((a: Record<string, unknown>) => ({
        name: a.name,
        country: a.country,
        logo: a.logo,
        psu_types: a.psu_types,
      }));
      return json({ ok: true, aspsps });
    } catch (err) {
      console.error("Falha a listar bancos:", err);
      return json({ ok: false, step: "rede", error: String((err as Error)?.message ?? err) }, 502);
    }
  }

  // ─── Iniciar autorização ───
  if (action === "start") {
    const aspspName = body?.aspsp_name;
    const aspspCountry = body?.aspsp_country ?? "PT";

    if (!aspspName) {
      return json({ ok: false, error: "Falta o campo aspsp_name." }, 400);
    }
    if (!redirectUrl) {
      return json({
        ok: false,
        error: "Falta o secret EB_REDIRECT_URL.",
        dica: "Tem de ser exactamente o URL registado no painel da Enable Banking.",
      }, 500);
    }

    // O state protege contra respostas cruzadas: a app guarda-o antes de
    // reencaminhar e compara-o quando o utilizador regressa.
    const state = crypto.randomUUID();

    const validUntil = new Date(Date.now() + CONSENT_DAYS * 86_400_000).toISOString();

    try {
      const res = await fetch(`${EB_BASE}/auth`, {
        method: "POST",
        headers: ebHeaders,
        body: JSON.stringify({
          access: { valid_until: validUntil },
          aspsp: { name: aspspName, country: aspspCountry },
          state,
          redirect_url: redirectUrl,
          psu_type: "personal",
        }),
      });

      const detail = await res.json().catch(() => null);
      if (!res.ok) {
        console.error("Enable Banking /auth devolveu", res.status, detail);
        return json({ ok: false, step: "api", status: res.status, detail }, 502);
      }

      return json({
        ok: true,
        url: detail?.url,
        authorization_id: detail?.authorization_id,
        state,
      });
    } catch (err) {
      console.error("Falha a iniciar autorização:", err);
      return json({ ok: false, step: "rede", error: String((err as Error)?.message ?? err) }, 502);
    }
  }

  return json({ ok: false, error: `Acção desconhecida: ${action}` }, 400);
});
