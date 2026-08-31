// ═══════════════════════════════════════════════════════════
// eb-sync — vai buscar movimentos ao banco
//
// Corpo do pedido:
//   {
//     "account_id": "<uuid de fin_bank_accounts>",
//     "strategy": "longest",     // opcional; usar na 1ª sincronização
//     "date_from": "2025-01-01", // opcional
//     "debug": false
//   }
//
// Proxy fino de propósito: só faz aqui o que tem de ser feito no
// servidor — assinar o JWT e falar com o banco. O mapeamento para
// categorias fica no frontend, que já tem as regras em categories.js.
// Duplicá-las aqui daria dois sítios para manter.
//
// Devolve os movimentos normalizados; quem grava é o frontend.
//
// Ficheiro auto-contido: o deploy é pelo Dashboard, que não faz
// bundling de imports partilhados entre funções.
// ═══════════════════════════════════════════════════════════

const EB_BASE = "https://api.enablebanking.com";

// Travão de segurança: evita um ciclo infinito se a paginação
// devolver sempre uma continuation_key.
const MAX_PAGES = 25;

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

// ─── Normalização dos movimentos ───

/**
 * Converte um movimento da Enable Banking para a forma usada pela app.
 *
 * A API devolve sempre o montante positivo, com o sentido em
 * credit_debit_indicator — é preciso aplicar o sinal à mão.
 *
 * O mês de um movimento é determinado pela value_date, nunca pela
 * booking_date (ver CLAUDE.md).
 */
function normalizeTransaction(tx: Record<string, any>) {
  const rawAmount = Number(
    tx?.transaction_amount?.amount ?? tx?.amount?.amount ?? tx?.amount ?? 0,
  );
  if (!Number.isFinite(rawAmount)) return null;

  const isDebit = String(
    tx?.credit_debit_indicator ?? tx?.creditDebitIndicator ?? "",
  ).toUpperCase() === "DBIT";

  const amount = isDebit ? -Math.abs(rawAmount) : Math.abs(rawAmount);

  // A descrição pode vir em vários sítios; usar o primeiro com conteúdo.
  const remittance = Array.isArray(tx?.remittance_information)
    ? tx.remittance_information.filter(Boolean).join(" ")
    : tx?.remittance_information ?? "";

  const counterparty = isDebit
    ? tx?.creditor?.name ?? tx?.creditor_name
    : tx?.debtor?.name ?? tx?.debtor_name;

  const description = String(
    remittance || counterparty || tx?.additional_information || "",
  ).trim().replace(/\s+/g, " ");

  const bookingDate = tx?.booking_date ?? tx?.bookingDate ?? null;
  const valueDate = tx?.value_date ?? tx?.valueDate ?? bookingDate;

  const entryReference = tx?.entry_reference ?? tx?.entryReference ?? null;

  // Sem entry_reference não há deduplicação fiável — nunca usar
  // transaction_id, que não é estável entre autorizações.
  if (!entryReference) return null;

  return {
    entry_reference: String(entryReference),
    movement_date: bookingDate ?? valueDate,
    value_date: valueDate ?? bookingDate,
    description,
    amount: Number(amount.toFixed(2)),
  };
}

// ─── Handler ───

/**
 * Traduz os erros da Enable Banking em algo accionável.
 *
 * O mais frequente é o ASPSP_ERROR: a Enable Banking chegou ao banco
 * mas o banco recusou, e quase nunca diz porquê (detail vem a null).
 * Costuma ser transitório — manutenção nocturna, processamento de
 * fecho do dia, ou limitação temporária do lado do banco. Distinguir
 * isto de um problema de autorização evita reautorizações inúteis.
 */
function explicarErro(status: number, payload: Record<string, any> | null): string {
  const codigo = payload?.error ?? "";

  if (codigo === "ASPSP_ERROR") {
    return "O banco recusou o pedido e não explicou porquê. Costuma ser " +
           "temporário — tenta daqui a algumas horas, de preferência em " +
           "horário útil. Não é preciso voltar a ligar o banco.";
  }

  if (status === 401 || status === 403) {
    return "A autorização de acesso ao banco caducou. É preciso voltar a " +
           "ligar o banco.";
  }

  if (status === 429) {
    return "Demasiadas recolhas seguidas. O limite é de cerca de quatro por " +
           "dia — espera e tenta outra vez.";
  }

  return payload?.message || `O banco respondeu com o estado ${status}.`;
}

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
  const accountId = body?.account_id;
  const strategy = body?.strategy ?? null;
  const dateFrom = body?.date_from ?? null;
  const debug = body?.debug === true;

  if (!accountId) return json({ ok: false, error: "Falta o campo account_id." }, 400);

  // ─── 1. Carregar a conta (o RLS garante que é do utilizador) ───

  let account: Record<string, any> | null = null;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/fin_bank_accounts?id=eq.${encodeURIComponent(accountId)}` +
      `&deleted_at=is.null&select=id,account_uid,session_id,aspsp_name,consent_expires_at`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${user.token}` } },
    );
    const rows = await res.json().catch(() => null);
    if (!res.ok) {
      console.error("Falha a ler a conta:", res.status, rows);
      return json({ ok: false, step: "conta", status: res.status, detail: rows }, 500);
    }
    account = Array.isArray(rows) ? rows[0] ?? null : null;
  } catch (err) {
    console.error("Erro ao ler a conta:", err);
    return json({ ok: false, step: "conta", error: String((err as Error)?.message ?? err) }, 500);
  }

  if (!account) return json({ ok: false, error: "Conta não encontrada." }, 404);
  if (!account.account_uid) {
    return json({ ok: false, error: "A conta não tem account_uid — é preciso reautorizar." }, 409);
  }

  if (account.consent_expires_at && new Date(account.consent_expires_at) < new Date()) {
    return json({
      ok: false,
      step: "consentimento",
      error: "O consentimento expirou. É preciso reautorizar o acesso ao banco.",
      consent_expires_at: account.consent_expires_at,
    }, 409);
  }

  // ─── 2. Ir buscar os movimentos, página a página ───

  let jwt: string;
  try {
    jwt = await signJwt(applicationId, privateKey);
  } catch (err) {
    console.error("Falha ao assinar o JWT:", err);
    return json({ ok: false, step: "assinatura", error: String((err as Error)?.message ?? err) }, 500);
  }

  // Cabeçalhos PSU: sinalizam que o utilizador está presente, para o
  // pedido não contar para o limite de recolhas em background (~4/dia).
  //
  // O nome do cabeçalho com o IP do cliente varia com a infraestrutura,
  // por isso tentam-se vários. Sem IP não há cabeçalhos PSU e todas as
  // chamadas passam a gastar a quota de background — daí o aviso no log.
  const psuIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    null;
  const psuAgent = req.headers.get("user-agent");

  if (!psuIp) {
    console.error(
      "Sem IP do cliente — o pedido vai sem cabeçalhos PSU e conta para o " +
      "limite de recolhas em background. Cabeçalhos recebidos: " +
      JSON.stringify([...req.headers.keys()]),
    );
  }

  const ebHeaders: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };
  if (psuIp) ebHeaders["PSU-IP-Address"] = psuIp;
  if (psuAgent) ebHeaders["PSU-User-Agent"] = psuAgent;

  // ─── Modo de diagnóstico ───
  //
  // Um ASPSP_ERROR diz apenas "o banco recusou". Para saber o quê, é
  // preciso bater à porta por caminhos diferentes: o estado da sessão
  // (que não chega a tocar no banco), os saldos (que tocam, mas por
  // outro endpoint) e os movimentos com um intervalo explícito.
  // O que responder e o que falhar delimita a causa.
  if (body?.diagnostico === true) {
    const resultado: Record<string, unknown> = {
      account_uid: account.account_uid,
      tem_session_id: Boolean(account.session_id),
      consent_expires_at: account.consent_expires_at,
      psu_headers: Boolean(psuIp),
    };

    const sondar = async (nome: string, url: string) => {
      try {
        const r = await fetch(url, { headers: ebHeaders });
        resultado[nome] = { status: r.status, corpo: await r.json().catch(() => null) };
      } catch (err) {
        resultado[nome] = { erro: String((err as Error)?.message ?? err) };
      }
    };

    if (account.session_id) {
      await sondar("sessao", `${EB_BASE}/sessions/${encodeURIComponent(account.session_id)}`);
    }

    const uid = encodeURIComponent(account.account_uid);
    await sondar("saldos", `${EB_BASE}/accounts/${uid}/balances`);

    const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    await sondar("movimentos_com_data", `${EB_BASE}/accounts/${uid}/transactions?date_from=${desde}`);
    await sondar("movimentos_sem_data", `${EB_BASE}/accounts/${uid}/transactions`);

    return json({ ok: true, diagnostico: resultado });
  }

  const collected: Record<string, any>[] = [];
  let continuationKey: string | null = null;
  let pages = 0;
  let lastPayload: unknown = null;

  try {
    do {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (strategy) params.set("strategy", strategy);
      if (continuationKey) params.set("continuation_key", continuationKey);

      const url = `${EB_BASE}/accounts/${encodeURIComponent(account.account_uid)}` +
        `/transactions${params.toString() ? `?${params}` : ""}`;

      const res = await fetch(url, { headers: ebHeaders });
      const payload = await res.json().catch(() => null);
      lastPayload = payload;

      if (!res.ok) {
        console.error("Enable Banking /transactions devolveu", res.status, payload);
        return json({
          ok: false,
          step: "transacoes",
          status: res.status,
          error: explicarErro(res.status, payload),
          detail: payload,
          pagina: pages + 1,
          recolhidos: collected.length,
        }, 502);
      }

      const batch = payload?.transactions ?? [];
      if (Array.isArray(batch)) collected.push(...batch);

      continuationKey = payload?.continuation_key ?? null;
      pages++;
    } while (continuationKey && pages < MAX_PAGES);
  } catch (err) {
    console.error("Falha a obter movimentos:", err);
    return json({ ok: false, step: "rede", error: String((err as Error)?.message ?? err) }, 502);
  }

  // ─── 3. Normalizar ───

  const normalized = collected
    .map(normalizeTransaction)
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const ignorados = collected.length - normalized.length;
  if (ignorados > 0) {
    console.error(`${ignorados} movimentos ignorados por falta de entry_reference ou montante inválido.`);
  }

  // Uma lista vazia não é erro para a API, mas quase nunca é o que se
  // espera. O caso observado a 24/08/2026 foi o limite de recolhas
  // esgotado: a Enable Banking responde 200 com [] em vez de 429.
  if (collected.length === 0) {
    console.error("A API devolveu zero movimentos.", JSON.stringify({
      date_from: dateFrom,
      strategy,
      psu_headers: Boolean(psuIp),
      account_uid: account.account_uid,
    }));
  }

  // ─── 4. Marcar a sincronização ───
  // Falhar aqui não invalida os movimentos já obtidos — só se regista.

  try {
    await fetch(
      `${supabaseUrl}/rest/v1/fin_bank_accounts?id=eq.${encodeURIComponent(accountId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${user.token}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ last_synced_at: new Date().toISOString() }),
      },
    );
  } catch (err) {
    console.error("Não foi possível actualizar last_synced_at:", err);
  }

  return json({
    ok: true,
    transactions: normalized,
    total: normalized.length,
    ignorados,
    paginas: pages,
    truncado: pages >= MAX_PAGES && Boolean(continuationKey),
    raw: debug ? lastPayload : undefined,
  });
});
