/**
 * ai-keywords.mjs
 *
 * Lista versionada de keywords AI para el filtro del fetcher ExploreYC.
 * Editable en un solo lugar sin tocar el pipeline.
 *
 * Estrategia:
 *   - ExploreYC tiene 10 industries (B2B, Consumer, Software, etc) — no hay
 *     slug "AI"/"ML". Esto es 100% keyword-based.
 *   - Match en name + one_liner + long_description + subindustry + industry
 *     (todo lowercase, contains-match).
 *   - Score = sumas ponderadas; threshold = AI_MIN_SCORE.
 *
 * Tuning:
 *   - Subir de score → bajar threshold, agregar más keywords strong.
 *   - Bajar falsos positivos → subir threshold, mover keyword a medium/strong.
 */

export const AI_KEYWORDS = {
  // Score 3 por match — solo matches muy claros de AI/IA/agent
  strong: [
    ' ai ', ' ai.', ' ai,', "ai'", // palabra aislada (con boundaries)
    'a.i.', 'artificial intelligence',
    'llm', 'llms', 'large language model',
    'gpt', 'chatgpt', 'claude', 'gemini', 'mistral', 'llama', 'qwen',
    'foundation model', 'fm ', 'gen ai', 'genai', 'generative ai',
    'agent', 'agents', 'agentic', 'autonomous agent', 'multi-agent', 'multiagent',
    'copilot', 'autopilot',
    'rag', 'retrieval augmented', 'retrieval-augmented',
    'embedding', 'embeddings', 'vector database', 'vector search',
    'fine-tuning', 'finetune', 'rlhf',
  ],

  // Score 1 por match — capabilities / tech AI
  medium: [
    'machine learning', 'deep learning', 'neural network', 'transformer',
    'computer vision', 'image generation', 'video generation',
    'voice ai', 'speech-to-text', 'text-to-speech', 'voice synthesis',
    'chatbot', 'conversational ai', 'nlp', 'natural language',
    'stable diffusion', 'diffusion model', 'midjourney', 'dall-e', 'sora',
    'workflow automation', 'intelligent automation', 'robotic process automation',
    'recommendation engine', 'recommender system',
    'ml ', 'mlops', 'synthetic data', 'computer use',
    'mcp', 'model context protocol',
    'openai', 'anthropic', 'hugging face',
  ],
};

export const AI_WEIGHTS = {
  strong: 3,
  medium: 1,
};

/**
 * Score mínimo para considerar una empresa AI-relevant.
 * Con solo 1 match medium no alcanza; con 3 medium sí (3≥3) o 1 strong (3≥3).
 * Filtra ~75% del ruido en YC (que es B2B/Software-heavy) sin perder nada AI.
 */
export const AI_MIN_SCORE = 3;
