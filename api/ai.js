// /api/ai.js — função serverless única do PetPoupança
//
// Dois modos via campo `mode`:
//   "verify_pdf"   → recebe base64 do PDF, extrai valor guardado, retorna { verified, amount, message }
//   "pet_reaction" → recebe estado do pet + evento, retorna { message } com fala do bichinho

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Body inválido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada" });

  const mode = body.mode || "pet_reaction";

  // ──────────────────────────────────────────────────────────────────
  // MODO 1: VERIFICAÇÃO DE PDF
  // Body: { mode: "verify_pdf", pdf: "<base64>", expectedMin: 30 }
  // Retorno: { verified, amount, description, confidence, message }
  // ──────────────────────────────────────────────────────────────────
  if (mode === "verify_pdf") {
    const { pdf, expectedMin = 30 } = body;
    if (!pdf) return res.status(400).json({ error: "Campo obrigatório: pdf (base64)" });

    const prompt = `
Você é um analisador de extratos e comprovantes bancários brasileiros.
Analise o PDF e responda APENAS com JSON válido, sem texto extra e sem markdown.

Procure por:
- Depósitos em conta poupança, cofre, reserva ou investimento
- Transferências PIX ou TED para conta de poupança própria
- Qualquer movimentação que indique que o usuário GUARDOU dinheiro (não compras ou saques comuns)

Formato de resposta (JSON puro, sem nada mais):
{
  "found": true ou false,
  "amount": número em reais (ex: 150.00) ou null se não encontrado,
  "description": "descrição curta (máx 10 palavras)" ou null,
  "confidence": "high", "medium" ou "low"
}

Regras:
- Se não for extrato/comprovante bancário: found = false
- Se houver múltiplos depósitos de poupança: some e retorne total
- confidence "low" = documento ilegível, duvidoso ou muito incerto
- Valor mínimo esperado: R$ ${expectedMin}
`.trim();

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 256,
          messages: [{
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdf },
              },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

      if (!response.ok) {
        console.error("Anthropic error:", await response.text());
        return res.status(502).json({ error: "Erro na API da Anthropic" });
      }

      const data = await response.json();
      const raw = (data?.content?.[0]?.text ?? "{}").replace(/```json|```/g, "").trim();

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error("JSON parse error:", raw);
        return res.status(200).json({
          verified: false, amount: null,
          message: "Não consegui ler o documento. Tente um PDF mais nítido.",
        });
      }

      const verified =
        parsed.found === true &&
        typeof parsed.amount === "number" &&
        parsed.amount >= expectedMin &&
        parsed.confidence !== "low";

      let message;
      if (verified) {
        message = `Comprovante aceito! ${parsed.description ?? "Depósito de R$" + parsed.amount.toFixed(2) + " identificado."}`;
      } else if (parsed.found && typeof parsed.amount === "number" && parsed.amount < expectedMin) {
        message = `Encontrei R$${parsed.amount.toFixed(2)}, mas a meta mínima é R$${expectedMin}. Preciso de mais!`;
      } else {
        message = "Não encontrei nenhum depósito ou poupança válida neste documento.";
      }

      return res.status(200).json({
        verified,
        amount: parsed.found ? parsed.amount : null,
        description: parsed.description ?? null,
        confidence: parsed.confidence ?? null,
        message,
      });
    } catch (err) {
      console.error("Fetch error:", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // MODO 2: FALA DO PET
  // Body: { mode: "pet_reaction", health, balance, streak, daysLeft, event }
  // Retorno: { message }
  // ──────────────────────────────────────────────────────────────────
  const { health, balance, streak, daysLeft, event,
          monthlyGoal, periodGoal, fedThisMonth, fedThisPeriod,
          petType = "pet" } = body;

  const goal = monthlyGoal || periodGoal || 30;
  const fed  = fedThisMonth || fedThisPeriod || 0;

  if (health === undefined || balance === undefined) {
    return res.status(400).json({ error: "health e balance sao obrigatorios" });
  }

  const petNames = { cat: "Mingau", dog: "Farofa", bunny: "Bolinha" };
  const petName  = petNames[petType] || "Poupinzinho";
  const petDesc  = petType === "cat" ? "gato" : petType === "dog" ? "cachorro" : petType === "bunny" ? "coelho" : "pet";

  const eventMap = {
    start:               "o app acabou de abrir",
    deposit:             "o dono depositou com comprovante VALIDADO — celebre!",
    deposit_rejected:    "o dono mandou comprovante mas foi REJEITADO — documento invalido",
    deposit_below_min:   "comprovante enviado mas o valor foi menor que a meta mensal",
    month_passed_no_feed:"o mes virou e o dono NAO bateu a meta — crise total",
    month_passed_fed:    "o mes virou e o dono bateu a meta — celebracao",
    goal_changed:        "o dono acabou de atualizar a meta mensal",
    revive:              "o pet foi ressuscitado depois de ter morrido",
  };

  const eventDesc = eventMap[event] ?? (event || "nenhum evento especial");
  const isDrama   = ["deposit_rejected", "deposit_below_min", "month_passed_no_feed"].includes(event);

  const petContext = [
    `Voce e ${petName}, um ${petDesc} virtual fofo e MUITO dramatico de um app de poupanca.`,
    `Fale sempre na primeira pessoa, como se fosse o proprio animal.`,
    ``,
    `Estado atual:`,
    `- Vida: ${health}%`,
    `- Saldo acumulado: R$ ${Number(balance).toFixed(2)}`,
    `- Meta mensal: R$ ${goal} (ja guardado este mes: R$ ${Number(fed).toFixed(2)})`,
    `- Meses consecutivos batidos: ${streak}`,
    `- Dias restantes no mes: ${daysLeft}`,
    `- Evento: ${eventDesc}`,
    ``,
    isDrama ? "INSTRUCAO: Drama maximo! Chore, implore, faca cena de novela brasileira. Use reticencias, MAIUSCULAS para gritar, metaforas de fome e abandono." : "",
    event === "goal_changed" ? "INSTRUCAO: Comente animado ou preocupado com a nova meta." : "",
    ``,
    `Responda com 1 a 2 frases curtas, em portugues brasileiro informal.`,
    `Criativo, engracado, memoravel. Sem hashtags. Sem emoji no inicio da frase.`,
  ].filter(Boolean).join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 140,
        messages: [{ role: "user", content: petContext }],
      }),
    });

    if (!response.ok) {
      console.error("Anthropic error:", await response.text());
      return res.status(502).json({ error: "Erro na API da Anthropic" });
    }

    const data = await response.json();
    return res.status(200).json({ message: data?.content?.[0]?.text?.trim() ?? "..." });
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
}
