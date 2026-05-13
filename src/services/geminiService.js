/**
 * LLM Service (Ollama backend)
 * ─────────────────────────────────────────────────────────────────────────────
 * Artık yerel Ollama LLM (gemma4:e2b-it-q4_K_M) kullanılıyor.
 * Bu dosya, eski import referanslarını kırmamak için Ollama servisini re-export eder.
 */

// Embedding: Ollama'ya delege edildi
export { createEmbedding, createEmbeddings } from './ollamaEmbeddingService'

// LLM: Yerel Ollama'ya delege edildi
export {
    invokeLLM,
    generateResponse,
    getAndResetTokenUsage
} from './ollamaLLMService'
