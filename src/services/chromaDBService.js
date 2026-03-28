/**
 * ChromaDB Service
 * Communicates with a locally running ChromaDB server via HTTP REST API.
 * ChromaDB stores document chunk embeddings for semantic vector search.
 *
 * Setup:
 *   pip install chromadb
 *   chroma run --host localhost --port 8000
 */

import { loadSettings } from './settingsStorage'

const COLLECTION_NAME = 'answerai_chunks'

// ChromaDB 1.0 introduced tenant + database scoping for all collection APIs.
// These are the built-in defaults used when running a standalone ChromaDB server.
const TENANT = 'default_tenant'
const DATABASE = 'default_database'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBaseUrl() {
    // Use Vite's dev proxy to avoid CORS issues. All /chroma/* requests
    // are transparently forwarded to http://localhost:8000 by the proxy.
    return '/chroma'
}

/** Base path for all collection-scoped endpoints (ChromaDB ≥ 1.0) */
function collectionsBase() {
    return `/tenants/${TENANT}/databases/${DATABASE}/collections`
}

async function chromaFetch(path, options = {}, retries = 2) {
    const url = `${getBaseUrl()}/api/v2${path}`
    let lastError

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            })

            // 5xx errors are retryable; 4xx are not
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText)
                const err = new Error(`ChromaDB API hatası [${response.status}]: ${errorText}`)
                if (response.status >= 500 && attempt < retries) {
                    lastError = err
                    const delay = 600 * Math.pow(2, attempt) // 600ms, 1200ms
                    console.warn(`[ChromaDB] ${response.status} hatası, ${delay}ms sonra tekrar deneniyor (${attempt + 1}/${retries})...`)
                    await new Promise(r => setTimeout(r, delay))
                    continue
                }
                throw err
            }

            return response.json()
        } catch (error) {
            // Network-level errors (fetch throws) are retryable
            if (error.name === 'TypeError' && attempt < retries) {
                lastError = error
                const delay = 600 * Math.pow(2, attempt)
                console.warn(`[ChromaDB] Ağ hatası, ${delay}ms sonra tekrar deneniyor (${attempt + 1}/${retries})...`)
                await new Promise(r => setTimeout(r, delay))
                continue
            }
            throw error
        }
    }

    throw lastError
}

// ─── Health ───────────────────────────────────────────────────────────────────

/**
 * Check if ChromaDB server is reachable
 * @returns {Promise<{ok: boolean, version?: string, error?: string}>}
 */
export async function checkHealth() {
    try {
        const baseUrl = getBaseUrl()
        const response = await fetch(`${baseUrl}/api/v2/heartbeat`, {
            signal: AbortSignal.timeout(5000)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        return { ok: true, version: data['nanosecond heartbeat'] ? 'ChromaDB' : 'Unknown' }
    } catch (error) {
        return { ok: false, error: error.message }
    }
}

// ─── Collection Management ────────────────────────────────────────────────────

/**
 * Get or create the main collection.
 * @returns {Promise<string>} collection id
 */
async function getOrCreateCollection() {
    try {
        // Try to get existing collection (ChromaDB 1.0 path includes tenant + database)
        const col = await chromaFetch(`${collectionsBase()}/${COLLECTION_NAME}`)
        return col.id
    } catch {
        // Create it if it doesn't exist
        const col = await chromaFetch(collectionsBase(), {
            method: 'POST',
            body: JSON.stringify({
                name: COLLECTION_NAME,
                metadata: { 'hnsw:space': 'cosine' }
            })
        })
        return col.id
    }
}

// ─── CRUD Operations ──────────────────────────────────────────────────────────

/**
 * Add chunks (with embeddings) to ChromaDB.
 * @param {string} fileId - File identifier
 * @param {Array<{id: string, text: string, embedding: number[], chunkIndex: number, fileName: string, pageNumbers: number[]|null}>} chunks
 * @returns {Promise<void>}
 */
export async function addChunks(fileId, chunks) {
    if (!chunks || chunks.length === 0) return

    const collectionId = await getOrCreateCollection()

    const ids = chunks.map(c => c.id)
    const embeddings = chunks.map(c => c.embedding)
    const documents = chunks.map(c => c.text)
    const metadatas = chunks.map(c => ({
        fileId,
        fileName: c.fileName,
        chunkIndex: c.chunkIndex,
        pageNumbers: c.pageNumbers ? JSON.stringify(c.pageNumbers) : ''
    }))

    // ChromaDB upsert: add or update
    await chromaFetch(`${collectionsBase()}/${collectionId}/upsert`, {
        method: 'POST',
        body: JSON.stringify({ ids, embeddings, documents, metadatas })
    })

    console.log(`✅ ChromaDB: ${chunks.length} chunk eklendi (fileId: ${fileId})`)
}

/**
 * Semantic search: find the most relevant chunks for a query embedding.
 * @param {number[]} queryEmbedding - Query vector
 * @param {string[]} fileIds - Only search within these file IDs
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array<{id, text, metadata, distance}>>}
 */
export async function queryChunks(queryEmbedding, fileIds, topK = 4) {
    const collectionId = await getOrCreateCollection()

    const body = {
        query_embeddings: [queryEmbedding],
        n_results: topK,
        where: fileIds.length === 1
            ? { fileId: { $eq: fileIds[0] } }
            : { fileId: { $in: fileIds } },
        include: ['documents', 'metadatas', 'distances', 'embeddings']
    }

    const result = await chromaFetch(`${collectionsBase()}/${collectionId}/query`, {
        method: 'POST',
        body: JSON.stringify(body)
    })

    // Parse ChromaDB response format
    const ids = result.ids?.[0] || []
    const documents = result.documents?.[0] || []
    const metadatas = result.metadatas?.[0] || []
    const distances = result.distances?.[0] || []
    const embeddings = result.embeddings?.[0] || []

    return ids.map((id, i) => ({
        id,
        text: documents[i],
        metadata: metadatas[i],
        distance: distances[i],
        embedding: embeddings[i] || null,
        // Convert cosine distance → similarity (0-1)
        similarity: 1 - (distances[i] || 0)
    }))
}

/**
 * Delete all chunks belonging to a specific file.
 * @param {string} fileId
 * @returns {Promise<void>}
 */
export async function deleteChunks(fileId) {
    try {
        const collectionId = await getOrCreateCollection()
        await chromaFetch(`${collectionsBase()}/${collectionId}/delete`, {
            method: 'POST',
            body: JSON.stringify({ where: { fileId: { $eq: fileId } } })
        })
        console.log(`🗑️ ChromaDB: ${fileId} chunk'ları silindi`)
    } catch (error) {
        console.error('ChromaDB chunk silme hatası:', error)
    }
}

/**
 * Check if a file's chunks are already stored in ChromaDB.
 * @param {string} fileId
 * @returns {Promise<number>} Number of chunks stored (0 if not cached)
 */
export async function getChunkCount(fileId) {
    try {
        const collectionId = await getOrCreateCollection()
        const result = await chromaFetch(`${collectionsBase()}/${collectionId}/get`, {
            method: 'POST',
            body: JSON.stringify({
                where: { fileId: { $eq: fileId } },
                include: ['metadatas']
            })
        })
        return result.ids?.length || 0
    } catch {
        return 0
    }
}

/**
 * Retrieve all chunks for a specific file (used to rebuild in-memory state if needed).
 * @param {string} fileId
 * @returns {Promise<Array>}
 */
export async function getChunksByFile(fileId) {
    try {
        const collectionId = await getOrCreateCollection()
        const result = await chromaFetch(`${collectionsBase()}/${collectionId}/get`, {
            method: 'POST',
            body: JSON.stringify({
                where: { fileId: { $eq: fileId } },
                include: ['documents', 'metadatas', 'embeddings']
            })
        })

        const ids = result.ids || []
        const documents = result.documents || []
        const metadatas = result.metadatas || []
        const embeddings = result.embeddings || []

        return ids.map((id, i) => ({
            id,
            text: documents[i],
            fileId: metadatas[i]?.fileId,
            fileName: metadatas[i]?.fileName,
            chunkIndex: metadatas[i]?.chunkIndex,
            pageNumbers: metadatas[i]?.pageNumbers
                ? JSON.parse(metadatas[i].pageNumbers)
                : null,
            embedding: embeddings[i] || null
        }))
    } catch (error) {
        console.error('ChromaDB getChunksByFile hatası:', error)
        return []
    }
}

/**
 * Delete the entire collection (wipe all data).
 * @returns {Promise<void>}
 */
export async function clearAll() {
    try {
        // Get the collection UUID first (required by ChromaDB v2 API)
        const collectionId = await getOrCreateCollection()
        await chromaFetch(`${collectionsBase()}/${collectionId}`, { method: 'DELETE' })
        console.log('🗑️ ChromaDB: Tüm chunk koleksiyonu temizlendi')
    } catch (error) {
        // Collection may not exist yet — that’s fine
        console.warn('ChromaDB clearAll (koleksiyon bulunamadı, sorun değil):', error.message)
    }
}
