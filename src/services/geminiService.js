import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { loadSettings } from './settingsStorage'

/**
 * Get or create ChatGoogleGenerativeAI model instance with current settings
 * @returns {ChatGoogleGenerativeAI} - Configured chat model
 */
function getChatModel() {
    const settings = loadSettings()

    if (!settings.apiKey) {
        throw new Error('Gemini API anahtarı yapılandırılmamış. Lütfen Ayarlar menüsünden API anahtarınızı girin.')
    }

    try {
        const model = new ChatGoogleGenerativeAI({
            apiKey: settings.apiKey,
            modelName: settings.model,
            temperature: settings.temperature,
            maxOutputTokens: 2048,
        })
        return model
    } catch (error) {
        console.error('Failed to initialize ChatGoogleGenerativeAI:', error)
        throw new Error('Gemini modeli başlatılamadı: ' + error.message)
    }
}

/**
 * Generate embedding for a single text using Gemini
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
export async function createEmbedding(text) {
    const embeddings = await _getEmbeddingsModel()
    const embedding = await embeddings.embedQuery(text)
    return embedding
}

/**
 * Generate embeddings for multiple texts using chunked mini-batches
 * Sends BATCH_SIZE texts per API call to avoid 429 rate limit errors
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
export async function createEmbeddings(texts) {
    if (!texts || texts.length === 0) return []

    // Gemini embedding free tier limits:
    // - 30,000 tokens/min (TPM)
    // - 100 requests/min (RPM)
    const FREE_TIER_TPM = 30000
    const AVG_CHARS_PER_TOKEN = 4
    const BATCH_SIZE = 10  // Small batches to keep each request light

    const embeddings = await _getEmbeddingsModel()
    const results = []
    const totalBatches = Math.ceil(texts.length / BATCH_SIZE)

    console.log(`⚡ Batch embedding: ${texts.length} chunk, ${totalBatches} grup halinde gönderiliyor (${BATCH_SIZE}/grup)`)

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1

        // Estimate tokens in this batch to compute required delay
        const batchTokenEstimate = batch.reduce((sum, t) => sum + Math.ceil(t.length / AVG_CHARS_PER_TOKEN), 0)
        // How many ms must pass so we stay under TPM?
        // delay = (batchTokens / TPM) * 60_000 ms, minimum 500ms
        const baseDelayMs = Math.ceil((batchTokenEstimate / FREE_TIER_TPM) * 60000)
        
        // Add %15 safety margin (hata payı) to the base delay
        const requiredDelayMs = Math.max(500, Math.ceil(baseDelayMs * 1.15))

        console.log(`  📦 Grup ${batchNum}/${totalBatches}: ${batch.length} chunk (~${batchTokenEstimate} token) → ${requiredDelayMs}ms bekleniyor (Hata payı dahil)`)

        const batchEmbeddings = await embeddings.embedDocuments(batch)
        results.push(...batchEmbeddings)

        // Wait proportional to token count to respect TPM limit
        if (i + BATCH_SIZE < texts.length) {
            await new Promise(resolve => setTimeout(resolve, requiredDelayMs))
        }
    }

    console.log(`✅ Tüm embedding'ler tamamlandı: ${results.length} chunk`)
    return results
}

/**
 * Internal: create and return an embeddings model instance
 */
async function _getEmbeddingsModel() {
    const settings = loadSettings()

    if (!settings.apiKey) {
        throw new Error('Gemini API anahtarı yapılandırılmamış. Lütfen Ayarlar menüsünden API anahtarınızı girin.')
    }

    try {
        const { GoogleGenerativeAIEmbeddings } = await import('@langchain/google-genai')
        return new GoogleGenerativeAIEmbeddings({
            apiKey: settings.apiKey,
            modelName: 'gemini-embedding-2-preview',
        })
    } catch (error) {
        console.error('Embedding model init error:', error)
        throw new Error(`Embedding modeli başlatılamadı: ${error.message}`)
    }
}

/**
 * Generate a response using LangChain's Google GenAI
 * @param {string} prompt - The prompt to send
 * @param {string} context - Context from retrieved documents
 * @param {Object} documentMetadata - Metadata about active documents
 * @returns {Promise<string>} - Generated response
 */
export async function generateResponse(prompt, context, documentMetadata = {}) {
    const chatModel = getChatModel()

    try {
        const fullPrompt = buildRAGPrompt(context, prompt, documentMetadata)

        console.log('🤖 Calling LangChain ChatGoogleGenerativeAI...')

        // Use LangChain's invoke method
        const response = await chatModel.invoke(fullPrompt)

        console.log('✅ Response received from Gemini')

        // Extract text from LangChain response
        return response.content
    } catch (error) {
        console.error('Generation error:', error)

        if (error.message?.includes('API key') || error.message?.includes('401')) {
            throw new Error('Geçersiz API anahtarı. Lütfen Ayarlar menüsünden API anahtarınızı kontrol edin')
        }

        if (error.message?.includes('quota') || error.message?.includes('429')) {
            throw new Error('API kotası aşıldı. Lütfen daha sonra tekrar deneyin')
        }

        if (error.message?.includes('404')) {
            throw new Error('Model bulunamadı. Lütfen API anahtarınızın Gemini modellerine erişimi olduğunu doğrulayın (https://aistudio.google.com/apikey)')
        }

        throw new Error(`Cevap oluşturulamadı: ${error.message}`)
    }
}

/**
 * Build a RAG-optimized prompt
 * @param {string} context - Retrieved context
 * @param {string} question - User question
 * @param {Object} documentMetadata - Metadata about documents
 * @returns {string} - Formatted prompt
 */
function buildRAGPrompt(context, question, documentMetadata = {}) {
    const { activeFileCount = 1, fileNames = [] } = documentMetadata

    // Detect comparison queries
    const comparisonKeywords = /compare|difference|contrast|versus|vs\.|which.*better|which.*more|both.*mention|similarities|distinctions/i
    const isComparisonQuery = comparisonKeywords.test(question)

    let basePrompt = `Sen, sağlanan belge bağlamına dayalı olarak soruları cevaplayan yardımcı bir yapay zeka asistanısın.`

    // Add comparison-specific instructions for multi-document queries
    if (isComparisonQuery && activeFileCount > 1) {
        basePrompt += `\n\n🔍 KARŞILAŞTIRMA MODU AKTİF:
Kullanıcı birden fazla belgeyi karşılaştırmak/zıtlaştırmak istiyor: ${fileNames.join(', ')}.

Karşılaştırma sorularını cevaplarken:
- Hangi bilginin hangi belgeden geldiğini açıkça belirt
- Benzerlikleri VE farklılıkları vurgula
- Kaynaklara atıfta bulunurken belge adlarını kullan
- Sadece ayrı özetler değil, karşılaştırmalı bir analiz sun
- Bir belge bir konuda daha fazla detaya sahipse, bunu açıkça belirt`
    }

    return `${basePrompt}

BELGELERDEN BAĞLAM:
${context}

KULLANICI SORUSU:
${question}

TALİMATLAR:
- Soruyu YALNIZCA yukarıdaki bağlamda sağlanan bilgilere dayanarak cevapla
- Cevap bağlamda bulunamazsa, "Bu bilgi sağlanan belgelerde bulunamadı" de
- Açık ve kapsamlı ol
- Mümkün olduğunda belirli alıntılar veya referanslar kullan
- Soru net değilse, açıklama iste
- Cevabı Türkçe olarak ver

CEVAP:`
}
