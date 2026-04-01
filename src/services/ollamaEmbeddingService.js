/**
 * Ollama Embedding Service
 * Local embedding via Ollama REST API — replaces Gemini embeddings.
 *
 * Model: qwen3-embedding:8b-q4_K_M
 * Ollama default endpoint: http://localhost:11434
 *
 * Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
 *
 * Make sure Ollama is running:
 *   ollama serve
 *   ollama pull qwen3-embedding:8b-q4_K_M
 */

const OLLAMA_EMBEDDING_MODEL = 'qwen3-embedding:8b-q4_K_M'

// Vite proxy yolu: /ollama/* → http://localhost:11434/*
const OLLAMA_BASE = '/ollama'

// Paralel istek limiti — Ollama tek process olduğundan çok fazla eşzamanlı
// istek göndermeyelim; 4 paralel genellikle güvenli.
const CONCURRENCY = 4

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function ollamaFetch(path, body) {
    const url = `${OLLAMA_BASE}${path}`
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })

    if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText)
        throw new Error(`Ollama API hatası [${response.status}]: ${errText}`)
    }

    return response.json()
}

// ─── Health check ─────────────────────────────────────────────────────────────

/**
 * Ollama'nın çalışıp çalışmadığını kontrol et.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function checkOllamaHealth() {
    try {
        const response = await fetch(`${OLLAMA_BASE}/api/tags`, {
            signal: AbortSignal.timeout(5000)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error.message }
    }
}

// ─── Single embedding ─────────────────────────────────────────────────────────

/**
 * Tek bir metin için embedding vektörü üret.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function createEmbedding(text) {
    if (!text || text.trim().length === 0) {
        throw new Error('Embedding için boş metin gönderilemez')
    }

    const data = await ollamaFetch('/api/embed', {
        model: OLLAMA_EMBEDDING_MODEL,
        input: text
    })

    // Ollama /api/embed yanıtı: { embeddings: [[...]] }
    const embedding = data?.embeddings?.[0]
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        throw new Error(`Ollama geçersiz embedding döndürdü: ${JSON.stringify(data)}`)
    }

    return embedding
}

// ─── Batch embeddings ─────────────────────────────────────────────────────────

/**
 * Birden fazla metin için embedding'leri paralel olarak üret.
 * CONCURRENCY limiti dahilinde Ollama'ya paralel istek gönderir.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function createEmbeddings(texts) {
    if (!texts || texts.length === 0) return []

    console.log(`⚡ Ollama batch embedding: ${texts.length} chunk, ${CONCURRENCY} paralel istek`)

    const results = new Array(texts.length)

    // CONCURRENCY limiti dahilinde slice'lara böl
    for (let i = 0; i < texts.length; i += CONCURRENCY) {
        const slice = texts.slice(i, i + CONCURRENCY)
        const batchNum = Math.floor(i / CONCURRENCY) + 1
        const totalBatches = Math.ceil(texts.length / CONCURRENCY)

        console.log(`  📦 Grup ${batchNum}/${totalBatches}: ${slice.length} chunk`)

        const embeddings = await Promise.all(
            slice.map((text, j) =>
                createEmbedding(text).catch(err => {
                    console.error(`[Ollama] Chunk ${i + j} embedding başarısız:`, err.message)
                    return null  // Geçersiz chunk'ı null ile işaretle; ragService filtreler
                })
            )
        )

        embeddings.forEach((emb, j) => {
            results[i + j] = emb
        })
    }

    const validCount = results.filter(e => e !== null).length
    console.log(`✅ Ollama embedding tamamlandı: ${validCount}/${texts.length} chunk başarılı`)

    return results
}
