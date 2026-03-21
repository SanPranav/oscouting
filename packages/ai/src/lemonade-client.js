const DEFAULT_BASE = process.env.LEMONADE_BASE || 'http://localhost:8080/v1';
const DEFAULT_MODEL = process.env.LEMONADE_MODEL || 'SmolLM3-3B-GGUF';
const FALLBACK_MODELS = [
  DEFAULT_MODEL,
  'SmolLM3-3B-GGUF',
  'SmolLM3-3B',
  'SmolLM3-3B-128K-UD-Q4_K_XL.gguf'
];

export async function callSmolLM(systemPrompt, userContent, expectJson = true) {
  let lastError = null;

  for (const modelName of FALLBACK_MODELS) {
    try {
      const response = await fetch(`${DEFAULT_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          temperature: expectJson ? 0.1 : 0.6,
          max_tokens: 768,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          ...(expectJson ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!response.ok) {
        lastError = new Error(`Lemonade request failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content?.trim() || '{}';

      if (!expectJson) return text;
      const cleaned = text.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned || '{}');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Lemonade request failed for all configured model names');
}
