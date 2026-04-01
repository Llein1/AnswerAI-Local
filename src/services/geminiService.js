import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { loadSettings } from './settingsStorage'

// ─── Embedding: Ollama'ya delege edildi ──────────────────────────────────────
// LLM (generateResponse, invokeLLM) bu dosyada kalıyor;
// embedding fonksiyonları local Ollama'ya taşındı.
export { createEmbedding, createEmbeddings } from './ollamaEmbeddingService'

// Module-level cache: aynı apiKey + model için yeniden instance üretme
let _chatModelCache = null
let _chatModelCacheKey = ''

/**
 * Get or create ChatGoogleGenerativeAI model instance with current settings
 * @returns {ChatGoogleGenerativeAI} - Configured chat model
 */
function getChatModel() {
    const settings = loadSettings()

    if (!settings.apiKey) {
        throw new Error('Gemini API anahtarı yapılandırılmamış. Lütfen Ayarlar menüsünden API anahtarınızı girin.')
    }

    // Cache key: API key + model + temperature + maxOutputTokens
    const cacheKey = `${settings.apiKey}|${settings.model}|${settings.temperature}|${settings.maxOutputTokens ?? 2048}`
    if (_chatModelCache && _chatModelCacheKey === cacheKey) {
        return _chatModelCache
    }

    try {
        _chatModelCache = new ChatGoogleGenerativeAI({
            apiKey: settings.apiKey,
            modelName: settings.model,
            temperature: settings.temperature,
            maxOutputTokens: settings.maxOutputTokens ?? 2048,
        })
        _chatModelCacheKey = cacheKey
        return _chatModelCache
    } catch (error) {
        console.error('Failed to initialize ChatGoogleGenerativeAI:', error)
        throw new Error('Gemini modeli başlatılamadı: ' + error.message)
    }
}

// createEmbedding ve createEmbeddings ollamaEmbeddingService'den re-export edildi (yukarıda).

/**
 * Direct LLM invocation — no RAG prompt wrapper.
 * Use for structured extraction tasks (JSON output, entity extraction, etc.)
 * @param {string} prompt - Raw prompt to send directly to the model
 * @returns {Promise<string>} - Model's text response
 */
export async function invokeLLM(prompt) {
    const chatModel = getChatModel()
    try {
        const response = await chatModel.invoke(prompt)
        return typeof response.content === 'string' ? response.content : String(response.content ?? '')
    } catch (error) {
        console.error('[invokeLLM] Hata:', error)
        throw error
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
 * Build a RAG-optimized prompt with language support
 * @param {string} context - Retrieved context
 * @param {string} question - User question
 * @param {Object} documentMetadata - Metadata about documents
 * @returns {string} - Formatted prompt
 */
function buildRAGPrompt(context, question, documentMetadata = {}) {
    const { activeFileCount = 1, fileNames = [] } = documentMetadata
    const settings = loadSettings()
    const lang = settings.responseLanguage ?? 'auto'

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

    // Language instruction based on setting
    let languageInstruction
    if (lang === 'tr') {
        languageInstruction = '- Cevabı MUTLAKA Türkçe olarak ver'
    } else if (lang === 'en') {
        languageInstruction = '- Always respond in English'
    } else {
        // auto: cevap, soru diliyle aynı olsun
        languageInstruction = '- Cevabı kullanıcının soru yazdığı dilde ver (Türkçe soruyorsa Türkçe, İngilizce soruyorsa İngilizce)'
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
- Soru net değilse, açıklama iste
${languageInstruction}

CEVAP:`

    /* İptal edilen prompt satırları (kodda tutuluyor, kullanılmıyor):
    - Mümkün olduğunda belirli alıntılar veya referanslar kullan
    */
}
