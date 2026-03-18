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

  // ── MODO 1: VERIFICAR COMPROVANTE (PDF ou imagem) ──────────────────
  if (mode === "verify_pdf") {
    const { pdf, image, imageType, expectedMin = 30 } = body;

    if (!pdf && !image) {
      return res.status(400).json({ error: "Envie pdf ou image em base64" });
    }

    const prompt = "Voce eh um analisador de comprovantes e extratos bancarios brasileiros. Analise o documento e responda APENAS com JSON valido sem markdown. Procure: depositos em poupanca, transferencias PIX para conta propria, qualquer movimentacao que indique que o usuario GUARDOU dinheiro (nao compras ou gastos). Formato obrigatorio: {\"found\": true ou false, \"amount\": numero em reais ou null, \"description\": \"descricao curta\" ou null, \"confidence\": \"high\" ou \"medium\" ou \"low\"}. Se nao for comprovante bancario: found=false. Confidence low = ilegivel ou muito incerto. Valor minimo esperado: R$ " + expectedMin;

    // monta o content dependendo do tipo de arquivo
    let contentSource;
    if (pdf) {
      contentSource = { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } };
    } else {
      const mime = imageType || "image/jpeg";
      contentSource = { type: "image", source: { type: "base64", media_type: mime, data: image } };
    }

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
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [
              contentSource,
              { type: "text", text: prompt }
            ]
          }]
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Anthropic error verify:", err);
        return res.status(502).json({ error: "Erro Anthropic: " + err.slice(0, 300) });
      }

      const data = await response.json();
      const raw = (data?.content?.[0]?.text ?? "{}").replace(/```json|```/g, "").trim();

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error("JSON parse fail:", raw);
        return res.status(200).json({
          verified: false, amount: null,
          message: "Nao consegui ler o comprovante. Tente uma imagem mais nitida."
        });
      }

      const verified =
        parsed.found === true &&
        typeof parsed.amount === "number" &&
        parsed.amount >= expectedMin &&
        parsed.confidence !== "low";

      let message;
      if (verified) {
        message = "Comprovante aceito! " + (parsed.description || "Deposito de R$" + parsed.amount.toFixed(2) + " identificado.");
      } else if (parsed.found && typeof parsed.amount === "number" && parsed.amount < expectedMin) {
        message = "Encontrei R$" + parsed.amount.toFixed(2) + ", mas a meta minima e R$" + expectedMin + ". Guarde mais!";
      } else {
        message = "Nao encontrei deposito ou poupanca valida neste comprovante.";
      }

      return res.status(200).json({
        verified,
        amount: parsed.found ? parsed.amount : null,
        description: parsed.description || null,
        confidence: parsed.confidence || null,
        message
      });

    } catch (err) {
      console.error("Fetch error verify:", err.message);
      return res.status(500).json({ error: "Erro interno: " + err.message });
    }
  }

  // ── MODO 2: FALA DO PET ────────────────────────────────────────────
  const { health = 100, balance = 0, streak = 0, daysLeft = 30,
          event = "none", monthlyGoal = 30, fedThisMonth = 0, petType = "cat" } = body;

  const petNames = { cat: "Mingau", dog: "Farofa", bunny: "Bolinha" };
  const petDesc  = { cat: "gato", dog: "cachorro", bunny: "coelho" };
  const name = petNames[petType] || "Poupinzinho";
  const desc = petDesc[petType]  || "pet";

  const events = {
    start:               "app abriu",
    deposit:             "dono depositou com comprovante VALIDADO - comemore!",
    deposit_rejected:    "comprovante REJEITADO - nao era poupanca valida",
    deposit_below_min:   "comprovante ok mas valor abaixo da meta",
    month_passed_no_feed:"mes virou sem meta batida - CRISE",
    month_passed_fed:    "mes virou com meta batida - celebracao",
    goal_changed:        "meta atualizada",
    revive:              "pet ressuscitado",
  };

  const isDrama = ["deposit_rejected", "deposit_below_min", "month_passed_no_feed"].includes(event);

  const prompt = [
    "Voce e " + name + ", um " + desc + " virtual fofo e dramatico de um app de poupanca. Fale na primeira pessoa.",
    "Vida=" + Math.round(health) + "%, Saldo=R$" + Number(balance).toFixed(2) +
      ", Meta=R$" + monthlyGoal + ", Guardado este mes=R$" + Number(fedThisMonth).toFixed(2) +
      ", Sequencia=" + streak + " meses, Dias restantes=" + daysLeft + ".",
    "Evento: " + (events[event] || event),
    isDrama ? "INSTRUCAO: Drama maximo! MAIUSCULAS, reticencias, apelos emotivos." : "",
    "Responda com 1-2 frases curtas em portugues informal. Criativo e engracado. Sem hashtags."
  ].filter(Boolean).join(" ");

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
        messages: [{ role: "user", content: prompt }]
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error pet:", err);
      return res.status(502).json({ error: "Erro Anthropic: " + err.slice(0, 300) });
    }

    const data = await response.json();
    return res.status(200).json({ message: data?.content?.[0]?.text?.trim() || "..." });

  } catch (err) {
    console.error("Fetch error pet:", err.message);
    return res.status(500).json({ error: "Erro interno: " + err.message });
  }
};
