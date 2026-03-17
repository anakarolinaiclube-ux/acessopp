import OpenAI from 'openai';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ result: "Método não permitido" });
    }

    try {
        const { cigsPerDay, packPrice, startDate } = req.body;

        // 1. Cálculos Matemáticos
        const start = new Date(startDate);
        const now = new Date();
        const diffTime = Math.abs(now - start);
        const daysSmokeFree = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

        const cigsNotSmoked = daysSmokeFree * parseInt(cigsPerDay);
        const pricePerCig = parseFloat(packPrice) / 20; // Maço padrão de 20
        const totalSaved = cigsNotSmoked * pricePerCig;
        
        // Projeções
        const dailyCost = parseInt(cigsPerDay) * pricePerCig;
        const monthlySavings = dailyCost * 30;
        const yearlySavings = dailyCost * 365;

        // Formatação BRL
        const fmt = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        // 2. Chamada OpenAI para Mensagem de Reforço
        let aiMessage = "Continue firme! Sua saúde e seu bolso agradecem.";
        
        if (process.env.OPENAI_API_KEY) {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Modelo rápido e eficiente
                messages: [
                    {
                        role: "system", 
                        content: "Você é um assistente motivacional para ex-fumantes. Responda em Português do Brasil. Seja breve (máximo 1 frase)."
                    },
                    {
                        role: "user",
                        content: `O usuário não fuma há ${daysSmokeFree} dias. Economizou ${fmt(totalSaved)}. Deixou de fumar ${cigsNotSmoked} cigarros. Dê uma mensagem de parabéns focada na saúde ou na liberdade.`
                    }
                ],
                max_tokens: 60,
            });
            aiMessage = completion.choices[0].message.content;
        }

        // 3. Montagem do HTML de resposta
        const htmlResponse = `
            <div class="result-card">
                <div>Você economizou até agora:</div>
                <span class="highlight">${fmt(totalSaved)}</span>
                
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-label">Cigarros evitados</span>
                        <span class="stat-value">${cigsNotSmoked}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Dias sem fumar</span>
                        <span class="stat-value">${daysSmokeFree}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Economia Mensal</span>
                        <span class="stat-value">${fmt(monthlySavings)}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Economia Anual</span>
                        <span class="stat-value">${fmt(yearlySavings)}</span>
                    </div>
                </div>

                <div class="ai-message">
                    "${aiMessage}"
                </div>
            </div>
        `;

        return res.status(200).json({ result: htmlResponse });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ result: "<p>Erro ao processar dados.</p>" });
    }
}