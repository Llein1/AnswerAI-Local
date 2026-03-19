import { createEmbedding, createEmbeddings } from './geminiService'
import { generateResponse } from './geminiService'
import { loadSettings } from './settingsStorage'
import { addChunks, queryChunks, getChunkCount, clearAll } from './chromaDBService'

/**
 * Split text into chunks for processing
 * @param {string} text - Text to split
 * @param {number} chunkSize - Size of each chunk
 * @param {number} overlap - Overlap between chunks
 * @returns {string[]} - Array of text chunks
 */
function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
    const chunks = []
    let startIndex = 0

    while (startIndex < text.length) {
        const endIndex = Math.min(startIndex + chunkSize, text.length)
        const chunk = text.slice(startIndex, endIndex)

        if (chunk.trim().length > 0) {
            chunks.push(chunk.trim())
        }

        startIndex += chunkSize - overlap
    }

    return chunks
}

/**
 * Process a document and store chunks + embeddings in ChromaDB.
 * Skips re-processing if chunks already exist in ChromaDB (cache hit).
 * @param {string} text - Document text
 * @param {string} fileId - File identifier
 * @param {string} fileName - File name
 * @param {Array} pages - Array of page objects with pageNumber and text
 * @returns {Promise<number>} Number of chunks processed
 */
export async function processDocument(text, fileId, fileName, pages = []) {
    try {
        const settings = loadSettings()
        const chunkSize = settings.chunkSize
        const overlap = settings.chunkOverlap

        // Check ChromaDB cache: if chunks already exist, skip re-embedding
        const existingCount = await getChunkCount(fileId)
        if (existingCount > 0) {
            console.log(`✅ ChromaDB cache HIT: ${fileName} (${existingCount} chunk zaten mevcut)`)
            return existingCount
        }

        // Split into chunks
        const chunks = splitTextIntoChunks(text, chunkSize, overlap)
        console.log(`📄 Processing ${chunks.length} chunks from ${fileName}`)

        // Helper function to find which page(s) a chunk belongs to
        const findChunkPages = (chunkText) => {
            if (!pages || pages.length === 0) return null

            const pageNumbers = []
            for (const page of pages) {
                if (text.includes(page.text) && chunkText.includes(page.text.substring(0, 50))) {
                    pageNumbers.push(page.pageNumber)
                }
            }

            // If we can't determine exact pages, estimate based on position
            if (pageNumbers.length === 0) {
                const chunkPosition = text.indexOf(chunkText)
                if (chunkPosition !== -1) {
                    let currentPos = 0
                    for (const page of pages) {
                        const pageLength = page.text.length
                        if (chunkPosition >= currentPos && chunkPosition < currentPos + pageLength) {
                            return [page.pageNumber]
                        }
                        currentPos += pageLength + 2 // +2 for \n\n separator
                    }
                }
            }

            return pageNumbers.length > 0 ? pageNumbers : null
        }

        // Create embeddings for ALL chunks in batches
        const processedChunks = []

        try {
            console.log(`⚡ Batch embedding başlatılıyor: ${chunks.length} chunk`)
            const allEmbeddings = await createEmbeddings(chunks)

            for (let i = 0; i < chunks.length; i++) {
                const pageNumbers = findChunkPages(chunks[i])
                processedChunks.push({
                    id: `${fileId}_chunk_${i}`,
                    fileId,
                    fileName,
                    text: chunks[i],
                    embedding: allEmbeddings[i],
                    chunkIndex: i,
                    pageNumbers
                })
            }
        } catch (error) {
            console.error('Batch embedding başarısız, tek tek deneniyor:', error)
            // Fallback: process one by one
            for (let i = 0; i < chunks.length; i++) {
                try {
                    const embedding = await createEmbedding(chunks[i])
                    const pageNumbers = findChunkPages(chunks[i])
                    processedChunks.push({
                        id: `${fileId}_chunk_${i}`,
                        fileId,
                        fileName,
                        text: chunks[i],
                        embedding,
                        chunkIndex: i,
                        pageNumbers
                    })
                } catch (chunkError) {
                    console.error(`Chunk ${i} işlenemedi:`, chunkError)
                }
            }
        }

        // Store in ChromaDB
        await addChunks(fileId, processedChunks)

        // Validate embedding quality
        const validChunks = processedChunks.filter(c => c.embedding && c.embedding.length > 0)
        const firstEmb = validChunks[0]?.embedding
        if (firstEmb) {
            const dim = firstEmb.length
            const magnitude = Math.sqrt(firstEmb.reduce((sum, v) => sum + v * v, 0))
            const hasNonZero = firstEmb.some(v => v !== 0)
            console.log(`🔬 Embedding doğrulama:`)
            console.log(`   ✅ Geçerli chunk sayısı: ${validChunks.length}/${processedChunks.length}`)
            console.log(`   ✅ Vektör boyutu: ${dim} boyut (beklenen: >100)`)
            console.log(`   ✅ Büyüklük (magnitude): ${magnitude.toFixed(4)}`)
            console.log(`   ✅ Sıfırdan farklı değer var mı: ${hasNonZero}`)
        }

        console.log(`✅ ${processedChunks.length} chunk ChromaDB'ye kaydedildi`)
        return processedChunks.length
    } catch (error) {
        console.error('Document processing error:', error)
        throw new Error(`Belge işlenirken hata oluştu: ${error.message}`)
    }
}

/**
 * Retrieve relevant context for a query using ChromaDB semantic search.
 * @param {string} query - User query
 * @param {string[]} activeFileIds - IDs of active files
 * @returns {Promise<Object>} - Retrieved context and sources
 */
export async function retrieveContext(query, activeFileIds) {
    try {
        const settings = loadSettings()
        const topK = settings.topK
        const minSimilarity = 0.4

        console.log(`🔍 ChromaDB semantic search: "${query}" (${activeFileIds.length} dosya)`)

        // Create embedding for query
        const queryEmbedding = await createEmbedding(query)

        // Query ChromaDB for relevant chunks
        const results = await queryChunks(queryEmbedding, activeFileIds, topK * 2)

        if (results.length === 0) {
            throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')
        }

        // Filter by similarity threshold
        let relevantChunks = results.filter(c => c.similarity >= minSimilarity)

        // If nothing meets threshold, take the best one
        if (relevantChunks.length === 0) {
            relevantChunks = [results[0]]
        }

        // Limit to topK
        const topChunks = relevantChunks.slice(0, topK)

        console.log(`📊 Seçilen ${topChunks.length} chunk (eşik: ${minSimilarity})`)
        console.log('📊 Benzerlik skorları:', topChunks.map(c => c.similarity.toFixed(3)))

        // Group chunks by document
        const chunksByDocument = {}
        topChunks.forEach(chunk => {
            const fileName = chunk.metadata?.fileName || 'Bilinmeyen Dosya'
            if (!chunksByDocument[fileName]) {
                chunksByDocument[fileName] = []
            }
            chunksByDocument[fileName].push(chunk)
        })

        // Build context
        const contextParts = []
        Object.entries(chunksByDocument).forEach(([fileName, chunks]) => {
            contextParts.push(`\n=== DOCUMENT: ${fileName} ===`)
            chunks.forEach((chunk, i) => {
                const pageNumbers = chunk.metadata?.pageNumbers
                    ? JSON.parse(chunk.metadata.pageNumbers || '[]')
                    : null
                const pages = pageNumbers && pageNumbers.length > 0
                    ? ` (Pages: ${pageNumbers.join(', ')})`
                    : ''
                contextParts.push(`[Alıntı ${i + 1}${pages}]`)
                contextParts.push(chunk.text)
                contextParts.push('') // blank line between excerpts
            })
        })

        const context = contextParts.join('\n')

        return {
            context,
            sources: topChunks.map(chunk => ({
                fileName: chunk.metadata?.fileName || 'Bilinmeyen',
                similarity: chunk.similarity,
                chunkIndex: chunk.metadata?.chunkIndex,
                pageNumbers: chunk.metadata?.pageNumbers
                    ? JSON.parse(chunk.metadata.pageNumbers || '[]')
                    : null
            }))
        }
    } catch (error) {
        console.error('Context retrieval error:', error)
        throw new Error(`Bağlam alınırken hata oluştu: ${error.message}`)
    }
}

/**
 * Complete RAG pipeline: retrieve context and generate response.
 * @param {string} question - User question
 * @param {Array} activeFiles - Array of active file objects
 * @returns {Promise<{response: string, sources: Array}>}
 */
export async function generateRAGResponse(question, activeFiles) {
    try {
        console.log(`💬 Generating RAG response for: "${question}"`)
        console.log(`📁 Active files: ${activeFiles.map(f => f.name).join(', ')}`)

        // Verify all active files are embedded in ChromaDB
        for (const file of activeFiles) {
            const count = await getChunkCount(file.id)
            if (count === 0) {
                console.log(`⚠️ ${file.name} ChromaDB'de bulunamadı, şimdi işleniyor...`)
                await processDocument(file.text, file.id, file.name, file.pages || [])
            } else {
                console.log(`✓ ${file.name} hazır (${count} chunk Chrome DB'de)`)
            }
        }

        const activeFileIds = activeFiles.map(f => f.id)

        // Retrieve relevant context via ChromaDB
        const { context, sources } = await retrieveContext(question, activeFileIds)

        console.log(`✅ ${sources.length} ilgili chunk alındı`)

        // Prepare document metadata for comparison-aware prompting
        const documentMetadata = {
            activeFileCount: activeFiles.length,
            fileNames: activeFiles.map(f => f.name),
            totalChunks: sources.length
        }

        // Generate response using Gemini
        console.log('🤖 Generating AI response...')
        const response = await generateResponse(question, context, documentMetadata)

        console.log('✅ Yanıt başarıyla oluşturuldu')

        return { response, sources }
    } catch (error) {
        console.error('RAG pipeline error:', error)
        throw new Error(`Cevap oluşturulurken hata oluştu: ${error.message}`)
    }
}

/**
 * Clear all processed documents from ChromaDB.
 */
export async function clearVectorStore() {
    await clearAll()
    console.log('🗑️ ChromaDB vektör deposu temizlendi')
}
