import Dexie from 'dexie'

/**
 * IndexedDB Database for AnswerAI
 * Using Dexie.js for easier IndexedDB management
 */
class AnswerAIDB extends Dexie {
    constructor() {
        super('AnswerAI')

        // v1: chunks table held embeddings — now moved to ChromaDB
        this.version(1).stores({
            files: 'id, name, uploadedAt, type',
            chunks: '++id, fileId, chunkIndex',
            conversations: 'id, updatedAt',
            settings: 'key'
        })

        // v2: chunks table removed (embeddings live in ChromaDB)
        this.version(2).stores({
            files: 'id, name, uploadedAt, type',
            chunks: null,               // drop the chunks table
            conversations: 'id, updatedAt',
            settings: 'key'
        })
    }
}

// Initialize database
const db = new AnswerAIDB()

/**
 * Check if IndexedDB is available
 * @returns {boolean}
 */
export function isIndexedDBAvailable() {
    try {
        return 'indexedDB' in window && indexedDB !== null
    } catch {
        return false
    }
}

// ===== FILES OPERATIONS =====

/**
 * Save a file to IndexedDB
 * @param {Object} file - File object to save
 * @returns {Promise<string>} - File ID
 */
export async function saveFileToIndexedDB(file) {
    try {
        await db.files.put(file)
        console.log(`✅ File saved to IndexedDB: ${file.name}`)
        return file.id
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            throw new Error('Depolama alanı dolu. Lütfen eski dosyaları silin.')
        }
        console.error('Error saving file to IndexedDB:', error)
        throw new Error(`Dosya kaydedilemedi: ${error.message}`)
    }
}

/**
 * Load all files from IndexedDB
 * @returns {Promise<Array>} - Array of files
 */
export async function loadFilesFromIndexedDB() {
    try {
        const files = await db.files.toArray()
        console.log(`📂 Loaded ${files.length} files from IndexedDB`)
        return files
    } catch (error) {
        console.error('Error loading files from IndexedDB:', error)
        return []
    }
}

/**
 * Delete a file from IndexedDB
 * @param {string} fileId - File ID to delete
 * @returns {Promise<void>}
 */
export async function deleteFileFromIndexedDB(fileId) {
    try {
        // Delete file record
        await db.files.delete(fileId)

        // Delete associated chunks only if the chunks table still exists
        // (it was dropped in DB v2 — embeddings now live in ChromaDB)
        if (db.chunks) {
            await db.chunks.where('fileId').equals(fileId).delete()
        }

        console.log(`🗑️ File deleted from IndexedDB: ${fileId}`)
    } catch (error) {
        console.error('Error deleting file from IndexedDB:', error)
        throw new Error(`Dosya silinemedi: ${error.message}`)
    }
}

/**
 * Clear all files from IndexedDB
 * @returns {Promise<void>}
 */
export async function clearAllFilesFromIndexedDB() {
    try {
        await db.files.clear()
        // Guard: chunks table was dropped in DB v2
        if (db.chunks) {
            await db.chunks.clear()
        }
        console.log('🗑️ All files cleared from IndexedDB')
    } catch (error) {
        console.error('Error clearing files from IndexedDB:', error)
    }
}

// ===== CHUNKS OPERATIONS =====

/**
 * Save chunks to IndexedDB
 * @param {string} fileId - File ID
 * @param {Array} chunks - Array of chunk objects
 * @param {Object} metadata - Chunk metadata (chunkSize, overlap)
 * @returns {Promise<void>}
 */
export async function saveChunksToIndexedDB(fileId, chunks, metadata = {}) {
    try {
        // Delete existing chunks for this file
        await db.chunks.where('fileId').equals(fileId).delete()

        // Add new chunks
        const chunksToAdd = chunks.map(chunk => ({
            ...chunk,
            fileId,
            metadata
        }))

        await db.chunks.bulkAdd(chunksToAdd)
        console.log(`✅ ${chunks.length} chunks saved to IndexedDB for file: ${fileId}`)
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            throw new Error('Depolama alanı dolu. Lütfen eski dosyaları silin.')
        }
        console.error('Error saving chunks to IndexedDB:', error)
        throw new Error(`Chunk'lar kaydedilemedi: ${error.message}`)
    }
}

/**
 * Load chunks from IndexedDB
 * @param {string} fileId - File ID
 * @param {number} chunkSize - Expected chunk size
 * @param {number} overlap - Expected overlap
 * @returns {Promise<Array|null>} - Array of chunks or null if not found/mismatch
 */
export async function loadChunksFromIndexedDB(fileId, chunkSize, overlap) {
    try {
        const chunks = await db.chunks.where('fileId').equals(fileId).toArray()

        if (chunks.length === 0) {
            return null
        }

        // Verify metadata matches (same chunk size and overlap)
        const firstChunk = chunks[0]
        if (firstChunk.metadata) {
            const { chunkSize: cachedChunkSize, overlap: cachedOverlap } = firstChunk.metadata
            if (cachedChunkSize !== chunkSize || cachedOverlap !== overlap) {
                console.log(`⚠️ Chunk parameters mismatch for ${fileId}, will reprocess`)
                return null
            }
        }

        console.log(`📦 Loaded ${chunks.length} chunks from IndexedDB for file: ${fileId}`)
        return chunks
    } catch (error) {
        console.error('Error loading chunks from IndexedDB:', error)
        return null
    }
}

/**
 * Delete chunks for a specific file
 * @param {string} fileId - File ID
 * @returns {Promise<void>}
 */
export async function deleteChunksFromIndexedDB(fileId) {
    try {
        await db.chunks.where('fileId').equals(fileId).delete()
        console.log(`🗑️ Chunks deleted for file: ${fileId}`)
    } catch (error) {
        console.error('Error deleting chunks from IndexedDB:', error)
    }
}

// ===== STORAGE INFO =====

/**
 * Get storage usage information
 * @returns {Promise<Object>} - Storage usage stats
 */
export async function getStorageInfo() {
    try {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate()
            return {
                usage: estimate.usage || 0,
                quota: estimate.quota || 0,
                usageInMB: ((estimate.usage || 0) / (1024 * 1024)).toFixed(2),
                quotaInMB: ((estimate.quota || 0) / (1024 * 1024)).toFixed(2),
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(1)
            }
        }
        return null
    } catch (error) {
        console.error('Error getting storage info:', error)
        return null
    }
}

export default db
