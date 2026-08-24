// ═══════════════════════════════════════════════════════════
// eb-auth-callback — troca o código de autorização por uma sessão
//
// Corpo do pedido:
//   { "code": "...", "debug": false }
//
// Faz POST /sessions na Enable Banking e grava as contas devolvidas
// em fin_bank_accounts, associando por identification_hash: ao
// reautorizar, o session_id e o account_uid mudam mas o hash não,
// por isso a linha existente é actualizada em vez de duplicada.
//
// A escrita usa o token do próprio utilizador (respeita o RLS),
// nunca a service_role.
//
// Ficheiro auto-contido: o deploy é pelo Dashboard, que não faz
// bundling de imports partilhados entre funções.
// ═══════════════════════════════════════════════════════════

const EB_BASE = "https://api.enablebanking.com";

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

/** Confirma que o pedido vem de um utilizador autenticado. */
async function requireUser(req: Request): Promise<{ id: string; token: string } | null> {
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
  return user?.id ? { id: user.id, token: auth.slice(7) } : null;
}

// ─── Normalização das contas ───

/**
 * A forma exacta da resposta varia com a versão da API, por isso os
 * campos são lidos defensivamente com várias alternativas.
 */
function normalizeAccount(acc: Record<string, any>) {
  const iban = acc?.account_id?.iban ?? acc?.iban ?? null;
  const hash = acc?.identification_hash ?? acc?.identification_hashes?.[0] ?? null;
  const uid = acc?.uid ?? acc?.account_uid ?? null;

  const tail = iban ? String(iban).slice(-4) : null;
  const label = acc?.name ?? acc?.product ?? acc?.details ?? null;

  return { uid, hash, iban, tail, label };
}

// ─── Handler ───

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const user = await requireUser(req);
  if (!user) return json({ ok: false, error: "Não autenticado." }, 401);

  const applicationId = Deno.env.get("EB_APPLICATION_ID");
  const privateKey = Deno.env.get("EB_PRIVATE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!applicationId || !privateKey || !supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração incompleta nos secrets." }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const code = body?.code;
  const debug = body?.debug === true;

  if (!code) return json({ ok: false, error: "Falta o campo code." }, 400);

  // ─── 1. Trocar o código por uma sessão ───

  let sessionData: Record<string, any>;
  try {
    const jwt = await signJwt(applicationId, privateKey);
    const res = await fetch(`${EB_BASE}/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    sessionData = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Enable Banking /sessions devolveu", res.status, sessionData);
      return json({ ok: false, step: "sessions", status: res.status, detail: sessionData }, 502);
    }
  } catch (err) {
    console.error("Falha ao criar sessão:", err);
    return json({ ok: false, step: "rede", error: String((err as Error)?.message ?? err) }, 502);
  }

  const sessionId = sessionData?.session_id ?? null;
  const aspspName = sessionData?.aspsp?.name ?? null;
  const aspspCountry = sessionData?.aspsp?.country ?? null;
  const validUntil = sessionData?.access?.valid_until ?? null;

  const rawAccounts: Record<string, any>[] =
    sessionData?.accounts ?? sessionData?.accounts_data ?? [];

  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    console.error("Sessão sem contas utilizáveis:", sessionData);
    return json({
      ok: false,
      step: "contas",
      error: "A sessão não devolveu contas.",
      detail: debug ? sessionData : undefined,
    }, 502);
  }

  // ─── 2. Gravar as contas ───

  const rows = rawAccounts
    .map(normalizeAccount)
    .filter(a => a.hash)          // sem hash não há como reassociar
    .map(a => ({
      user_id: user.id,
      identification_hash: a.hash,
      account_uid: a.uid,
      session_id: sessionId,
      aspsp_name: aspspName,
      aspsp_country: aspspCountry,
      display_name: [aspspName, a.tail ? `••••${a.tail}` : a.label]
        .filter(Boolean).join(" "),
      consent_expires_at: validUntil,
      // Uma autorização nova abre uma janela nova de histórico completo
      // (cerca de 1 hora). Repor a data obriga a sincronização seguinte
      // a usar outra vez a estratégia mais longa disponível.
      last_synced_at: null,
      deleted_at: null,
    }));

  if (rows.length === 0) {
    console.error("Nenhuma conta trazia identification_hash:", rawAccounts);
    return json({
      ok: false,
      step: "contas",
      error: "As contas devolvidas não trazem identification_hash.",
      detail: debug ? sessionData : undefined,
    }, 502);
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/fin_bank_accounts?on_conflict=user_id,identification_hash`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${user.token}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(rows),
      },
    );

    const saved = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("Falha a gravar contas:", res.status, saved);
      return json({ ok: false, step: "gravar", status: res.status, detail: saved }, 500);
    }

    return json({
      ok: true,
      accounts: saved,
      consent_expires_at: validUntil,
      raw: debug ? sessionData : undefined,
    });
  } catch (err) {
    console.error("Erro ao gravar contas:", err);
    return json({ ok: false, step: "gravar", error: String((err as Error)?.message ?? err) }, 500);
  }
});
