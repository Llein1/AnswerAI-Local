/**
 * Ollama LLM Service
 * ─────────────────────────────────────────────────────────────────────────────
 * Tüm LLM çağrılarını yerel Ollama sunucusuna yönlendirir.
 * Model: gemma4:e2b-it-q4_K_M
 */

import { loadSettings } from './settingsStorage'

// ─── Token Tracking ───────────────────────────────────────────────────────────
let _totalTokens = 0

export function getAndResetTokenUsage() {
    const tokens = _totalTokens
    _totalTokens = 0
    return tokens
}

function _updateTokens(promptTokens, completionTokens) {
    _totalTokens += (promptTokens || 0) + (completionTokens || 0)
}
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Direct LLM invocation via Ollama REST API.
 * @param {string} prompt - Raw prompt to send directly to the model
 * @returns {Promise<string>} - Model's text response
 */
export async function invokeLLM(prompt) {
    const settings = loadSettings()
    const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434'
    const model = settings.model || 'gemma4:e2b-it-q4_K_M'

    const body = {
        model,
        prompt,
        stream: false,
        options: {
            temperature: settings.temperature ?? 0.7,
            num_predict: settings.maxOutputTokens ?? 2048,
        }
    }

    try {
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            const text = await response.text()
            throw new Error(`Ollama HTTP ${response.status}: ${text}`)
        }

        const data = await response.json()
        _updateTokens(data.prompt_eval_count, data.eval_count)

        return data.response ?? ''
    } catch (error) {
        console.error('[invokeLLM] Ollama hatası:', error)
        throw new Error(`Ollama LLM çağrısı başarısız: ${error.message}`)
    }
}

/**
 * Generate a RAG response using local Ollama.
 * @param {string} prompt - The user question
 * @param {string} context - Context from retrieved documents
 * @param {Object} documentMetadata - Metadata about active documents
 * @returns {Promise<string>} - Generated response
 */
export async function generateResponse(prompt, context, documentMetadata = {}) {
    const fullPrompt = buildRAGPrompt(context, prompt, documentMetadata)

    console.log('🤖 Calling Ollama LLM...')
    try {
        const result = await invokeLLM(fullPrompt)
        console.log('✅ Response received from Ollama')
        return result
    } catch (error) {
        console.error('Ollama generation error:', error)

        if (error.message?.includes('connection refused') || error.message?.includes('ECONNREFUSED')) {
            throw new Error('Ollama\'ya bağlanılamadı. Lütfen "ollama serve" komutunu çalıştırdığınızdan emin olun.')
        }

        if (error.message?.includes('model') && error.message?.includes('not found')) {
            throw new Error(`Model bulunamadı. Lütfen "ollama pull ${loadSettings().model}" komutunu çalıştırın.`)
        }

        throw new Error(`Cevap oluşturulamadı: ${error.message}`)
    }
}

/**
 * Build a RAG-optimized prompt with language support
 */
function buildRAGPrompt(context, question, documentMetadata = {}) {
    const settings = loadSettings()
    const lang = settings.responseLanguage ?? 'auto'

    const basePrompt = `Sen, sağlanan belge bağlamına dayalı olarak soruları cevaplayan yardımcı bir yapay zeka asistanısın.`

    let languageInstruction
    if (lang === 'tr') {
        languageInstruction = '- Cevabı MUTLAKA Türkçe olarak ver'
    } else if (lang === 'en') {
        languageInstruction = '- Always respond in English'
    } else {
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
}
