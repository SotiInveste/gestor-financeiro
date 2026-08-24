// ═══════════════════════════════════════════════════════════
// eb-ping — teste de ligação à Enable Banking
//
// Assina um JWT RS256 com a chave privada da aplicação e chama
// GET /application. Serve só para confirmar que as credenciais e a
// assinatura estão correctas antes de construir o resto da integração.
//
// Secrets necessários (Supabase → Settings → Edge Functions → Secrets):
//   EB_APPLICATION_ID  — o application_id da Enable Banking
//   EB_PRIVATE_KEY     — o conteúdo do .pem, em formato PKCS#8
//
// Ficheiro auto-contido de propósito: o deploy é feito pelo Dashboard,
// que não faz bundling de imports partilhados entre funções.
// ═══════════════════════════════════════════════════════════

const EB_BASE = "https://api.enablebanking.com";

// O SDK do Supabase envia apikey e x-client-info além do authorization.
// Se não constarem aqui, o preflight falha e o pedido nem chega a sair.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Extrai os bytes DER de um PEM PKCS#8. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")              // secret gravado com \n literais
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

/**
 * Assina o JWT que autentica a aplicação na Enable Banking.
 * O kid tem de ser o application_id; o TTL máximo aceite é 24h.
 */
async function signJwt(applicationId: string, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: applicationId };
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + 3600,
  };

  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input),
  );

  return `${input}.${b64url(new Uint8Array(sig))}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const applicationId = Deno.env.get("EB_APPLICATION_ID");
  const privateKey = Deno.env.get("EB_PRIVATE_KEY");

  if (!applicationId || !privateKey) {
    return json({
      ok: false,
      error: "Faltam os secrets EB_APPLICATION_ID e/ou EB_PRIVATE_KEY.",
    }, 500);
  }

  let jwt: string;
  try {
    jwt = await signJwt(applicationId, privateKey);
  } catch (err) {
    console.error("Falha ao assinar o JWT:", err);
    return json({
      ok: false,
      step: "assinatura",
      error: String((err as Error)?.message ?? err),
      dica: "Se a chave começa por '-----BEGIN RSA PRIVATE KEY-----' está em " +
            "PKCS#1 e tem de ser convertida para PKCS#8. Ver README.",
    }, 500);
  }

  try {
    const res = await fetch(`${EB_BASE}/application`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    const detail = await res.json().catch(() => null);

    if (!res.ok) {
      console.error("Enable Banking devolveu", res.status, detail);
      return json({ ok: false, step: "api", status: res.status, detail }, 502);
    }

    // Nunca devolver o JWT nem a chave na resposta.
    return json({ ok: true, application: detail });
  } catch (err) {
    console.error("Falha ao contactar a Enable Banking:", err);
    return json({
      ok: false,
      step: "rede",
      error: String((err as Error)?.message ?? err),
    }, 502);
  }
});
