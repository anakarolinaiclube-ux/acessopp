const { OpenAI } = require('openai');
const pdfParse = require('pdf-parse');

// Inicializa a OpenAI puxando a chave da Vercel
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = async function handler(req, res) {
  // Permite apenas requisições POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const body = req.body;

    // ==========================================
    // MODO 1: REAÇÃO DO PET (Balão de fala)
    // ==========================================
    if (body.mode === 'pet_reaction') {
      const prompt = `Você é um pet virtual fofo e dramático (do tipo: ${body.petType}) em um app de finanças. 
      Sua saúde atual é ${body.health}%. 
      A meta mensal do seu dono é R$${body.monthlyGoal}, mas ele depositou R$${body.fedThisMonth} este mês.
      Faltam ${body.daysLeft} dias para o mês acabar. 
      O evento atual é: "${body.event}".
      
      Responda com apenas UMA frase curta (máximo 15 palavras). 
      Seja engraçado, faça chantagem emocional fofa. Se a saúde estiver baixa, seja muito dramático implorando por dinheiro/comida.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Modelo super rápido e inteligente
        messages: [{ role: "system", content: prompt }],
        max_tokens: 60,
      });

      return res.status(200).json({ message: response.choices[0].message.content.trim() });
    }

    // ==========================================
    // MODO 2: LER E VERIFICAR O COMPROVANTE PDF
    // ==========================================
    if (body.mode === 'verify_pdf') {
      
      // 1. Transforma o Base64 que veio do Frontend em um Buffer (arquivo legível)
      const pdfBuffer = Buffer.from(body.pdf, 'base64');
      
      // 2. Extrai todo o texto do PDF
      const pdfData = await pdfParse(pdfBuffer);
      const pdfText = pdfData.text;

      // 3. Pede para a OpenAI ler o texto extraído e procurar o valor do comprovante
      const prompt = `Você é um auditor financeiro rigoroso e divertido.
      Leia este texto extraído de um PDF de comprovante bancário:
      
      "${pdfText}"
      
      Instruções:
      1. Verifique se isso realmente parece um comprovante de transferência (Pix, TED, DOC, Boleto).
      2. Encontre o valor EXATO transferido.
      A meta mínima esperada do mês é R$${body.expectedMin}.
      
      Responda ESTRITAMENTE em formato JSON com as seguintes chaves:
      {
        "verified": true (se for um comprovante válido) ou false (se for inválido ou não achar valor),
        "amount": (apenas o número do valor transferido, ex: 25.50. Se não achar, coloque null),
        "message": "Uma frase curta e divertida como se fosse o Pet analisando o comprovante."
      }`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" }, // Força a IA a devolver um JSON perfeito
        messages: [{ role: "user", content: prompt }],
      });

      // Pega a resposta da OpenAI e devolve para o Frontend
      const result = JSON.parse(response.choices[0].message.content);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Modo não reconhecido.' });

  } catch (error) {
    console.error("Erro no Backend:", error);
    return res.status(500).json({ 
      error: "Ocorreu um erro no servidor.", 
      details: error.message 
    });
  }
};
