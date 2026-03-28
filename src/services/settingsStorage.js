/**
 * Settings Storage Service
 * Manages application settings persistence in localStorage
 */

const STORAGE_KEY = 'answerAI_settings'

// Default settings configuration
export const DEFAULT_SETTINGS = {
    apiKey: '',
    chunkSize: 1000,
    chunkOverlap: 200,  // Auto-calculated as chunkSize / 5
    topK: 4,
    minSimilarity: 0.3, // Cosine similarity eşiği (literatür standardı: 0.3)
    temperature: 0.7,
    maxOutputTokens: 2048,
    model: 'gemini-2.5-flash',
    chromaDBUrl: 'http://localhost:8000',
    ragMethod: 'naive',      // RAG retrieval yöntemi
    responseLanguage: 'auto' // Yanıt dili: 'auto' | 'tr' | 'en'
}

/**
 * Load settings from localStorage
 * @returns {Object} - Current settings
 */
export function loadSettings() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) {
            return { ...DEFAULT_SETTINGS }
        }

        const parsed = JSON.parse(stored)

        // Merge with defaults to handle new settings added in updates
        return {
            ...DEFAULT_SETTINGS,
            ...parsed
        }
    } catch (error) {
        console.error('Failed to load settings:', error)
        return { ...DEFAULT_SETTINGS }
    }
}

/**
 * Save settings to localStorage
 * @param {Object} settings - Settings to save
 * @returns {boolean} - Success status
 */
export function saveSettings(settings) {
    try {
        // Validate before saving
        const validated = validateSettings(settings)
        if (!validated.valid) {
            console.error('Invalid settings:', validated.errors)
            return false
        }

        // Auto-calculate overlap as 1/5 of chunk size
        const settingsToSave = {
            ...settings,
            chunkOverlap: Math.floor(settings.chunkSize / 5)
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsToSave))
        console.log('✅ Settings saved successfully')
        return true
    } catch (error) {
        console.error('Failed to save settings:', error)
        return false
    }
}

/**
 * Validate settings object
 * @param {Object} settings - Settings to validate
 * @returns {Object} - Validation result {valid: boolean, errors: string[]}
 */
export function validateSettings(settings) {
    const errors = []

    // API Key validation (optional but should be string)
    if (settings.apiKey !== undefined && typeof settings.apiKey !== 'string') {
        errors.push('API key must be a string')
    }

    // Chunk size validation
    if (!Number.isInteger(settings.chunkSize) || settings.chunkSize < 500 || settings.chunkSize > 2000) {
        errors.push('Chunk size must be between 500 and 2000')
    }

    // Top-K validation
    if (!Number.isInteger(settings.topK) || settings.topK < 1 || settings.topK > 10) {
        errors.push('Top-K must be between 1 and 10')
    }

    // minSimilarity validation
    if (settings.minSimilarity !== undefined &&
        (typeof settings.minSimilarity !== 'number' || settings.minSimilarity < 0 || settings.minSimilarity > 1)) {
        errors.push('minSimilarity must be between 0.0 and 1.0')
    }

    // Temperature validation
    if (typeof settings.temperature !== 'number' || settings.temperature < 0 || settings.temperature > 1) {
        errors.push('Temperature must be between 0.0 and 1.0')
    }

    // maxOutputTokens validation
    if (settings.maxOutputTokens !== undefined &&
        (!Number.isInteger(settings.maxOutputTokens) || settings.maxOutputTokens < 256 || settings.maxOutputTokens > 8192)) {
        errors.push('maxOutputTokens must be between 256 and 8192')
    }

    // Model validation
    const validModels = [
        'gemini-3.1-flash-lite-preview',
        'gemini-3-flash-preview',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemma-3-27b-it'
    ]
    if (!validModels.includes(settings.model)) {
        errors.push(`Model must be one of: ${validModels.join(', ')}`)
    }

    // RAG Method validation (yalnızca mevcut 5 yöntem)
    const validRagMethods = ['naive', 'mmr', 'hyde', 'bm25Hybrid', 'selfRag', 'graphRag']
    if (settings.ragMethod !== undefined && !validRagMethods.includes(settings.ragMethod)) {
        errors.push(`RAG yöntemi geçersiz: ${settings.ragMethod}`)
    }

    // Response language validation
    const validLanguages = ['auto', 'tr', 'en']
    if (settings.responseLanguage !== undefined && !validLanguages.includes(settings.responseLanguage)) {
        errors.push(`Yanıt dili geçersiz: ${settings.responseLanguage}`)
    }

    return {
        valid: errors.length === 0,
        errors
    }
}

/**
 * Reset settings to defaults
 * @returns {boolean} - Success status
 */
export function resetSettings() {
    try {
        // Keep API key when resetting (don't lose user's key)
        const current = loadSettings()
        const resetted = {
            ...DEFAULT_SETTINGS,
            apiKey: current.apiKey  // Preserve API key
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(resetted))
        console.log('✅ Settings reset to defaults (API key preserved)')
        return true
    } catch (error) {
        console.error('Failed to reset settings:', error)
        return false
    }
}

/**
 * Validate API key format
 * @param {string} key - API key to validate
 * @returns {boolean} - True if format is valid
 */
export function validateApiKey(key) {
    if (!key || typeof key !== 'string') {
        return false
    }

    // Basic format check: should start with "AIza" and be reasonably long
    return key.startsWith('AIza') && key.length > 30
}
