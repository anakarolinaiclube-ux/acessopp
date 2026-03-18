module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Body invalido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY nao configurada" });

  const mode = body.mode || "pet_reaction";

  // ── MODO 1: VERIFICAR PDF ──────────────────────────────────────────
  if (mode === "verify_pdf") {
    const { pdf, expectedMin = 30 } = body;
    if (!pdf) return res.status(400).json({ error: "Campo obrigatorio: pdf (base64)" });

    const prompt = "Voce eh um analisador de extratos bancarios brasileiros. Analise o PDF e responda APENAS com JSON valido, sem markdown. Procure depositos em poupanca, transferencias PIX para conta propria ou qualquer movimentacao que indique que o usuario guardou dinheiro. Formato: {\"found\": true ou false, \"amount\": numero em reais ou null, \"description\": \"descricao curta\" ou null, \"confidence\": \"high\" ou \"medium\" ou \"low\"}. Se nao for extrato bancario: found=false. Valor minimo esperado: R$ " + expectedMin + ".";

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
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
              { type: "text", text: prompt }
            ]
          }]
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Anthropic PDF error:", err);
        return res.status(502).json({ error: "Erro na API da Anthropic: " + err.slice(0, 200) });
      }

      const data = await response.json();
      const raw = (data?.content?.[0]?.text ?? "{}").replace(/```json|```/g, "").trim();

      let parsed;
      try { parsed = JSON.parse(raw); }
      catch {
        console.error("JSON parse error:", raw);
        return res.status(200).json({ verified: false, amount: null, message: "Nao consegui ler o documento. Tente um PDF mais nitido." });
      }

      const verified = parsed.found === true && typeof parsed.amount === "number" && parsed.amount >= expectedMin && parsed.confidence !== "low";

      let message;
      if (verified) {
        message = "Comprovante aceito! " + (parsed.description || "Deposito de R$" + parsed.amount.toFixed(2) + " identificado.");
      } else if (parsed.found && typeof parsed.amount === "number" && parsed.amount < expectedMin) {
        message = "Encontrei R$" + parsed.amount.toFixed(2) + ", mas a meta minima e R$" + expectedMin + ". Preciso de mais!";
      } else {
        message = "Nao encontrei nenhum deposito ou poupanca valida neste documento.";
      }

      return res.status(200).json({ verified, amount: parsed.found ? parsed.amount : null, description: parsed.description || null, confidence: parsed.confidence || null, message });

    } catch (err) {
      console.error("Fetch error verify_pdf:", err);
      return res.status(500).json({ error: "Erro interno: " + err.message });
    }
  }

  // ── MODO 2: FALA DO PET ────────────────────────────────────────────
  const { health, balance, streak, daysLeft, event, monthlyGoal, fedThisMonth, petType } = body;
  if (health === undefined || balance === undefined) {
    return res.status(400).json({ error: "health e balance sao obrigatorios" });
  }

  const goal = monthlyGoal || 30;
  const fed  = fedThisMonth || 0;
  const petNames = { cat: "Mingau", dog: "Farofa", bunny: "Bolinha" };
  const petName  = petNames[petType] || "Poupinzinho";
  const petDesc  = petType === "cat" ? "gato" : petType === "dog" ? "cachorro" : petType === "bunny" ? "coelho" : "pet";

  const eventMap = {
    start:               "o app acabou de abrir",
    deposit:             "o dono depositou com comprovante VALIDADO - celebre!",
    deposit_rejected:    "o comprovante foi REJEITADO - nao era deposito de poupanca",
    deposit_below_min:   "comprovante valido mas valor abaixo da meta",
    month_passed_no_feed:"o mes virou e o dono NAO bateu a meta - crise total",
    month_passed_fed:    "o mes virou e o dono bateu a meta - celebracao",
    goal_changed:        "o dono atualizou a meta mensal",
    revive:              "o pet foi ressuscitado",
  };

  const eventDesc = eventMap[event] || event || "nenhum evento";
  const isDrama   = ["deposit_rejected", "deposit_below_min", "month_passed_no_feed"].includes(event);

  const lines = [
    "Voce e " + petName + ", um " + petDesc + " virtual fofo e dramatico de um app de poupanca.",
    "Fale na primeira pessoa.",
    "",
    "Estado: Vida=" + health + "%, Saldo=R$" + Number(balance).toFixed(2) + ", Meta=R$" + goal + " (guardado este mes: R$" + Number(fed).toFixed(2) + "), Sequencia=" + streak + " meses, Dias restantes=" + daysLeft,
    "Evento: " + eventDesc,
    "",
    isDrama ? "DRAMA MAXIMO: chore, implore, faca cena de novela. Use MAIUSCULAS e reticencias." : "",
    "",
    "Responda com 1 a 2 frases curtas em portugues brasileiro informal. Criativo e engracado. Sem hashtags."
  ].filter(l => l !== undefined).join("\n");

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
        messages: [{ role: "user", content: lines }]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic pet error:", err);
      return res.status(502).json({ error: "Erro na API da Anthropic: " + err.slice(0, 200) });
    }

    const data = await response.json();
    return res.status(200).json({ message: data?.content?.[0]?.text?.trim() || "..." });

  } catch (err) {
    console.error("Fetch error pet_reaction:", err);
    return res.status(500).json({ error: "Erro interno: " + err.message });
  }
};
