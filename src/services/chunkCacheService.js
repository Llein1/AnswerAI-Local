/**
 * Chunk Cache Service
 * Thin wrapper — all chunk storage is now delegated to ChromaDB.
 * IndexedDB no longer stores embeddings.
 */

import {
    addChunks,
    getChunkCount,
    getChunksByFile,
    deleteChunks
} from './chromaDBService'

/**
 * Get cached chunks for a file from ChromaDB.
 * Returns null if not found (caller should re-embed).
 * @param {string} fileId
 * @param {number} chunkSize - (kept for API compatibility, not used in ChromaDB)
 * @param {number} chunkOverlap - (kept for API compatibility)
 * @returns {Promise<Array|null>}
 */
export async function getCachedChunks(fileId, chunkSize = 1000, chunkOverlap = 200) {
    try {
        const count = await getChunkCount(fileId)
        if (count === 0) return null

        const chunks = await getChunksByFile(fileId)
        if (!chunks || chunks.length === 0) return null

        console.log(`[ChromaDB Cache] HIT for ${fileId} (${chunks.length} chunks)`)
        return chunks
    } catch (error) {
        console.error('[ChromaDB Cache] getCachedChunks hatası:', error)
        return null
    }
}

/**
 * Save chunks to ChromaDB.
 * @param {string} fileId
 * @param {Array} chunks
 * @param {number} chunkSize - (kept for API compatibility)
 * @param {number} chunkOverlap - (kept for API compatibility)
 * @returns {Promise<void>}
 */
export async function setCachedChunks(fileId, chunks, chunkSize = 1000, chunkOverlap = 200) {
    await addChunks(fileId, chunks)
}

/**
 * Invalidate (delete) cache for a specific file.
 * @param {string} fileId
 * @returns {Promise<void>}
 */
export async function invalidateCache(fileId) {
    await deleteChunks(fileId)
}

/**
 * (Noop) Old-style cache cleanup — not needed with ChromaDB.
 */
export async function clearOldCache() {
    console.log('[ChromaDB Cache] clearOldCache: ChromaDB ile gereksiz, atlandı.')
    return 0
}

/**
 * Get storage info.
 */
export async function getCacheStats() {
    return {
        storage: 'ChromaDB',
        message: 'Chunk embedding\'ler ChromaDB\'de saklanıyor'
    }
}
