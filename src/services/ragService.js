import { createEmbedding, createEmbeddings, generateResponse as geminiGenerateResponse, generateResponse } from './geminiService'
import { loadSettings } from './settingsStorage'
import { addChunks, queryChunks, getChunkCount, clearAll } from './chromaDBService'
import { ensureGraphIndexed, retrieveGraphRAGLocal } from './graphRAGService'

// ─── RAG Method Definitions ────────────────────────────────────────────────────

export const RAG_METHODS = {
    naive: {
        id: 'naive',
        name: 'Naive Dense Retrieval',
        shortName: 'Dense Retrieval',
        icon: '🔍',
        description: 'Temel vektör benzerlik araması. Sorgu embedding\'i hesaplanır ve en yakın chunk\'lar cosine benzerliğiyle bulunur.',
        speed: 5,      // 1-5 (5=en hızlı)
        quality: 3,    // 1-5 (5=en iyi)
        badge: 'Hızlı'
    },
    mmr: {
        id: 'mmr',
        name: 'MMR - Maximal Marginal Relevance',
        shortName: 'MMR',
        icon: '🧩',
        description: 'Alakalı VE çeşitli sonuçlar döndürür. Benzer chunk\'ların tekrarını önleyerek kapsamlı bağlam oluşturur.',
        speed: 4,
        quality: 4,
        badge: 'Çeşitli'
    },
    hyde: {
        id: 'hyde',
        name: 'HyDE - Hypothetical Document Embedding',
        shortName: 'HyDE',
        icon: '💭',
        description: 'AI, soruya cevap veren varsayımsal bir belge üretir. Bu belgenin embedding\'i gerçek chunk\'larla eşleştirilir.',
        speed: 3,
        quality: 4,
        badge: 'Dönüşüm'
    },
    bm25Hybrid: {
        id: 'bm25Hybrid',
        name: 'BM25 Hybrid Search',
        shortName: 'Hybrid BM25',
        icon: '⚖️',
        description: 'Anlamsal vektör aramasını anahtar kelime eşleşmesiyle (BM25-benzeri) birleştirir. İki skor ağırlıklı olarak toplanır.',
        speed: 4,
        quality: 4,
        badge: 'Hibrit'
    },
    selfRag: {
        id: 'selfRag',
        name: 'Self-RAG',
        shortName: 'Self-RAG',
        icon: '🤔',
        description: 'Her chunk için AI "Bu soruyla ne kadar alakalı?" diye kendi kendini değerlendirir. Düşük puanlı chunk\'lar elenir.',
        speed: 1,
        quality: 5,
        badge: 'Öz-değerlendirme'
    },
    graphRag: {
        id: 'graphRag',
        name: 'GraphRAG - Graph-Based Retrieval',
        shortName: 'GraphRAG',
        icon: '🕸️',
        description: 'Chunk\'lar arasında semantik bir ilişki grafı kurulur. Sorguyla en alakalı pivot chunk\'tan başlayarak komşu chunk\'lara BFS ile yayılır; bağlantılı bağlamları birleştirir.',
        speed: 2,
        quality: 5,
        badge: 'Graf Tabanlı'
    }
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/**
 * Sentence-aware text chunker.
 * Tries to split at sentence boundaries (., !, ?) to avoid cutting mid-sentence.
 * Falls back to hard-split when no boundary is found within the window.
 */
function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
    const chunks = []
    let startIndex = 0
    const sentenceEnd = /[.!?]/

    while (startIndex < text.length) {
        const rawEnd = Math.min(startIndex + chunkSize, text.length)

        // Try to find a sentence boundary near the end of the window
        let endIndex = rawEnd
        if (rawEnd < text.length) {
            // Look forward up to 150 chars for a sentence boundary
            const searchZone = text.slice(rawEnd, Math.min(rawEnd + 150, text.length))
            const matchFwd = searchZone.search(sentenceEnd)
            if (matchFwd !== -1) {
                endIndex = rawEnd + matchFwd + 1
            } else {
                // Look backward within the last 30% of the chunk
                const lookback = text.slice(Math.max(startIndex, rawEnd - Math.floor(chunkSize * 0.3)), rawEnd)
                const matchBwd = lookback.lastIndexOf('.')
                if (matchBwd !== -1) {
                    endIndex = rawEnd - lookback.length + matchBwd + 1
                }
                // If still no boundary, accept the hard cut
            }
        }

        const chunk = text.slice(startIndex, endIndex)
        if (chunk.trim().length > 0) chunks.push(chunk.trim())
        
        // Eğer metnin sonuna geldiysek işlemi sonlandır
        if (endIndex >= text.length) {
            break
        }
        
        // Güvenlik amacıyla en az 1 karakter ilerlemesini sağla (sonsuz döngüyü engeller)
        startIndex = Math.max(startIndex + 1, endIndex - overlap)
    }

    return chunks
}

// ─── Document Processing ──────────────────────────────────────────────────────

export async function processDocument(text, fileId, fileName, pages = []) {
    try {
        const settings = loadSettings()
        const chunkSize = settings.chunkSize
        const overlap = settings.chunkOverlap

        const existingCount = await getChunkCount(fileId)
        if (existingCount > 0) {
            console.log(`✅ ChromaDB cache HIT: ${fileName} (${existingCount} chunk zaten mevcut)`)
            return existingCount
        }

        const chunks = splitTextIntoChunks(text, chunkSize, overlap)
        console.log(`📄 Processing ${chunks.length} chunks from ${fileName}`)

        const findChunkPages = (chunkText) => {
            if (!pages || pages.length === 0) return null
            const pageNumbers = []
            for (const page of pages) {
                if (text.includes(page.text) && chunkText.includes(page.text.substring(0, 50))) {
                    pageNumbers.push(page.pageNumber)
                }
            }
            if (pageNumbers.length === 0) {
                const chunkPosition = text.indexOf(chunkText)
                if (chunkPosition !== -1) {
                    let currentPos = 0
                    for (const page of pages) {
                        const pageLength = page.text.length
                        if (chunkPosition >= currentPos && chunkPosition < currentPos + pageLength) {
                            return [page.pageNumber]
                        }
                        currentPos += pageLength + 2
                    }
                }
            }
            return pageNumbers.length > 0 ? pageNumbers : null
        }

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

        // ChromaDB'ye kaydetmeden önce geçersiz embedding'leri temizle
        const validChunks = processedChunks.filter(c => c.embedding && Array.isArray(c.embedding) && c.embedding.length > 0)
        
        if (validChunks.length < processedChunks.length) {
            console.warn(`⚠️ ${processedChunks.length - validChunks.length} chunk geçersiz embedding nedeniyle atlandı.`)
        }

        if (validChunks.length > 0) {
            await addChunks(fileId, validChunks)
            
            const firstEmb = validChunks[0].embedding
            const dim = firstEmb.length
            const magnitude = Math.sqrt(firstEmb.reduce((sum, v) => sum + v * v, 0))
            console.log(`🔬 Embedding doğrulama: ${validChunks.length}/${processedChunks.length} chunk hazır, ${dim} boyut, magnitude=${magnitude.toFixed(4)}`)
        } else {
            throw new Error('Hiçbir chunk için geçerli embedding oluşturulamadı.')
        }

        console.log(`✅ ${validChunks.length} chunk ChromaDB'ye kaydedildi`)
        return validChunks.length
    } catch (error) {
        console.error('Document processing error:', error)
        throw new Error(`Belge işlenirken hata oluştu: ${error.message}`)
    }
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

/** Build context + sources from a list of scored chunks */
function buildContextFromChunks(topChunks) {
    const chunksByDocument = {}
    topChunks.forEach(chunk => {
        const fileName = chunk.metadata?.fileName || 'Bilinmeyen Dosya'
        if (!chunksByDocument[fileName]) chunksByDocument[fileName] = []
        chunksByDocument[fileName].push(chunk)
    })

    const contextParts = []
    Object.entries(chunksByDocument).forEach(([fileName, chunks]) => {
        contextParts.push(`\n=== DOCUMENT: ${fileName} ===`)
        chunks.forEach((chunk, i) => {
            /* Alıntı ve sayfa numaraları yoruma alındı (kodda kalsın, kullanılmasın)
            const pageNumbers = chunk.metadata?.pageNumbers
                ? JSON.parse(chunk.metadata.pageNumbers || '[]')
                : null
            const pages = pageNumbers && pageNumbers.length > 0 ? ` (Pages: ${pageNumbers.join(', ')})` : ''
            contextParts.push(`[Alıntı ${i + 1}${pages}]`)
            */
            contextParts.push(chunk.text)
            contextParts.push('')
        })
    })

    return {
        context: contextParts.join('\n'),
        sources: topChunks.map(chunk => ({
            fileName: chunk.metadata?.fileName || 'Bilinmeyen',
            similarity: chunk.similarity,
            chunkIndex: chunk.metadata?.chunkIndex,
            pageNumbers: chunk.metadata?.pageNumbers
                ? JSON.parse(chunk.metadata.pageNumbers || '[]')
                : null
        }))
    }
}

/** Quick LLM call helper (no RAG context) */
async function callLLM(prompt) {
    try {
        const response = await geminiGenerateResponse(prompt, '', {})
        return typeof response === 'string' ? response : response?.content || ''
    } catch (error) {
        console.error('[callLLM] LLM çağrısı başarısız:', error)
        throw error
    }
}

// Cosine similarity between two vectors
function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0
    let dot = 0, magA = 0, magB = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        magA += a[i] * a[i]
        magB += b[i] * b[i]
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB)
    return denom === 0 ? 0 : dot / denom
}

// ─── Method 1: Naive Dense Retrieval ─────────────────────────────────────────

async function retrieveNaive(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Naive Dense] Sorgu vektörleniyor...`)
    const queryEmbedding = await createEmbedding(query)
    const results = await queryChunks(queryEmbedding, activeFileIds, topK * 2)

    if (results.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    let relevant = results.filter(c => c.similarity >= minSimilarity)
    if (relevant.length === 0) relevant = [results[0]]

    return buildContextFromChunks(relevant.slice(0, topK))
}

// ─── Method 2: MMR - Maximal Marginal Relevance ───────────────────────────────

async function retrieveMMR(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: MMR] Maksimal marjinal alaka hesaplanıyor...`)
    const lambda = 0.5  // alaka vs çeşitlilik dengesi
    const queryEmbedding = await createEmbedding(query)
    const candidates = await queryChunks(queryEmbedding, activeFileIds, topK * 4)

    if (candidates.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    // MMR selection
    const selected = []
    const remaining = [...candidates]

    while (selected.length < topK && remaining.length > 0) {
        let bestIdx = 0
        let bestScore = -Infinity

        for (let i = 0; i < remaining.length; i++) {
            const candEmb = remaining[i].embedding
            const relevance = remaining[i].similarity

            // Guard: embedding yoksa salt similarity kullan
            if (!candEmb || candEmb.length === 0) {
                const mmrScore = lambda * relevance
                if (mmrScore > bestScore) {
                    bestScore = mmrScore
                    bestIdx = i
                }
                continue
            }

            // Max similarity to already selected
            let maxSim = 0
            for (const sel of selected) {
                if (sel.embedding && sel.embedding.length > 0) {
                    const s = cosineSim(candEmb, sel.embedding)
                    if (s > maxSim) maxSim = s
                }
            }

            const mmrScore = lambda * relevance - (1 - lambda) * maxSim
            if (mmrScore > bestScore) {
                bestScore = mmrScore
                bestIdx = i
            }
        }

        selected.push(remaining[bestIdx])
        remaining.splice(bestIdx, 1)
    }

    console.log(`[RAG: MMR] ${selected.length} çeşitli chunk seçildi`)
    return buildContextFromChunks(selected)
}

// ─── Method 3: HyDE - Hypothetical Document Embedding ────────────────────────

async function retrieveHyDE(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: HyDE] Varsayımsal belge üretiliyor...`)

    const hydePrompt = `Aşağıdaki soruya cevap veren kısa bir belge paragrafı yaz (150-200 kelime). 
Gerçekten var olan bir belgeden alıntı gibi yaz, soru sormadan doğrudan bilgi ver.
Soru: "${query}"
Belge paragrafı:`

    const hypotheticalDoc = await callLLM(hydePrompt)
    console.log(`[RAG: HyDE] Varsayımsal belge: "${hypotheticalDoc.substring(0, 100)}..."`)

    // Use the hypothetical document as the query
    const hydeEmbedding = await createEmbedding(hypotheticalDoc)
    const results = await queryChunks(hydeEmbedding, activeFileIds, topK * 2)

    if (results.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    let relevant = results.filter(c => c.similarity >= minSimilarity)
    if (relevant.length === 0) relevant = [results[0]]

    return buildContextFromChunks(relevant.slice(0, topK))
}

// ─── Method 4: BM25 Hybrid Search ────────────────────────────────────────────

async function retrieveBM25Hybrid(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: BM25 Hybrid] Anlamsal + anahtar kelime araması birleştiriliyor...`)

    const alpha = 0.7  // weight for semantic score
    const beta = 0.3   // weight for keyword score

    const queryEmbedding = await createEmbedding(query)
    const results = await queryChunks(queryEmbedding, activeFileIds, topK * 3)

    if (results.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    // Simple BM25-like keyword scoring
    const queryTerms = query.toLowerCase()
        .replace(/[^\w\sğüşıöçĞÜŞİÖÇ]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2)

    // Compute raw keyword scores first
    const rawScores = results.map(chunk => {
        const chunkText = (chunk.text || '').toLowerCase()
        let keywordScore = 0
        for (const term of queryTerms) {
            const regex = new RegExp(term, 'g')
            const matches = chunkText.match(regex)
            const tf = matches ? matches.length : 0
            const normalizedTF = tf / (chunkText.length / 100 + 1)
            keywordScore += normalizedTF
        }
        return keywordScore
    })

    // Dynamic normalization: use max raw score (avoid division by zero)
    const maxRawKeyword = Math.max(...rawScores, 1e-9)

    const scoredChunks = results.map((chunk, idx) => {
        const normalizedKeyword = rawScores[idx] / maxRawKeyword  // 0-1 range
        const hybridScore = alpha * chunk.similarity + beta * normalizedKeyword
        return { ...chunk, hybridScore, keywordScore: normalizedKeyword }
    })

    // Sort by hybrid score
    scoredChunks.sort((a, b) => b.hybridScore - a.hybridScore)

    const filtered = scoredChunks.filter(c => c.similarity >= minSimilarity)
    const topChunks = (filtered.length > 0 ? filtered : [scoredChunks[0]]).slice(0, topK)

    console.log(`[RAG: BM25 Hybrid] Hibrit skorlar: ${topChunks.map(c => c.hybridScore.toFixed(3)).join(', ')}`)

    // Use hybridScore as similarity for display
    const displayChunks = topChunks.map(c => ({ ...c, similarity: c.hybridScore }))
    return buildContextFromChunks(displayChunks)
}

// ─── Method 5: Self-RAG ──────────────────────────────────────────────────────

async function retrieveSelfRAG(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Self-RAG] AI öz-değerlendirme yapıyor...`)

    const queryEmbedding = await createEmbedding(query)
    // Evaluate up to topK*2 candidates (dinamik, sabit 6 değil)
    const evalBatchSize = Math.min(topK * 2, 12)
    const candidateK = Math.min(topK * 3, 18)
    const candidates = await queryChunks(queryEmbedding, activeFileIds, candidateK)

    if (candidates.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    // LLM grades each chunk
    const scoredChunks = []

    // Batch evaluation for efficiency
    const evalCandidates = candidates.slice(0, evalBatchSize)
    const evalPrompt = `Soru: "${query}"

Aşağıdaki metin parçalarının her birini bu soru için değerlendir.
Her parça için: YÜKSEK, ORTA veya DÜŞÜK yazarak alaka düzeyini belirt.
Format: "Chunk X: YÜKSEK/ORTA/DÜŞÜK"

${evalCandidates.map((c, i) => `Chunk ${i + 1}:\n${c.text.substring(0, 200)}`).join('\n\n---\n\n')}

Değerlendirme:`

    let selfEvalResult = ''
    try {
        selfEvalResult = await callLLM(evalPrompt)
        console.log(`[RAG: Self-RAG] Değerlendirme: "${selfEvalResult.substring(0, 200)}"`)
    } catch (e) {
        console.warn('[RAG: Self-RAG] Değerlendirme başarısız, similarity skoru kullanılıyor')
        return buildContextFromChunks(candidates.slice(0, topK))
    }

    // Parse grades
    const gradeMap = { 'YÜKSEK': 1.0, 'YUKSEK': 1.0, 'HIGH': 1.0, 'ORTA': 0.6, 'MEDIUM': 0.6, 'DÜŞÜK': 0.2, 'DUSUK': 0.2, 'LOW': 0.2 }
    const lines = selfEvalResult.toUpperCase().split('\n')

    evalCandidates.forEach((chunk, i) => {
        const chunkNum = i + 1
        const line = lines.find(l => l.includes(`CHUNK ${chunkNum}`) || l.includes(`${chunkNum}:`))
        let grade = 0.5  // default

        if (line) {
            for (const [keyword, score] of Object.entries(gradeMap)) {
                if (line.includes(keyword)) {
                    grade = score
                    break
                }
            }
        }

        // Combine LLM grade with vector similarity
        const finalScore = 0.6 * grade + 0.4 * chunk.similarity
        scoredChunks.push({ ...chunk, similarity: finalScore, selfRagGrade: grade })
    })

    // Add remaining candidates (not evaluated) with reduced score
    candidates.slice(evalBatchSize).forEach(chunk => {
        scoredChunks.push({ ...chunk, similarity: chunk.similarity * 0.7 })
    })

    scoredChunks.sort((a, b) => b.similarity - a.similarity)

    const topChunks = scoredChunks.filter(c => c.similarity >= 0.3).slice(0, topK)
    const finalChunks = topChunks.length > 0 ? topChunks : [scoredChunks[0]]

    console.log(`[RAG: Self-RAG] ${finalChunks.length} chunk seçildi (LLM değerlendirme + similarity)`)
    return buildContextFromChunks(finalChunks)
}


// ─── Main Retrieval Dispatcher ────────────────────────────────────────────────

export async function retrieveContext(query, activeFileIds, ragMethod = 'naive') {
    const settings = loadSettings()
    const topK = settings.topK
    const minSimilarity = settings.minSimilarity ?? 0.3

    console.log(`🔍 RAG Yöntemi: "${ragMethod}" | Sorgu: "${query}" | ${activeFileIds.length} dosya | minSim=${minSimilarity}`)

    const method = RAG_METHODS[ragMethod]
    if (method) {
        console.log(`📌 ${method.icon} ${method.name}`)
    }

    switch (ragMethod) {
        case 'mmr':
            return retrieveMMR(query, activeFileIds, topK, minSimilarity)
        case 'hyde':
            return retrieveHyDE(query, activeFileIds, topK, minSimilarity)
        case 'bm25Hybrid':
            return retrieveBM25Hybrid(query, activeFileIds, topK, minSimilarity)
        case 'selfRag':
            return retrieveSelfRAG(query, activeFileIds, topK, minSimilarity)
        case 'graphRag':
            return retrieveGraphRAGLocal(query, activeFileIds, topK, minSimilarity)
        default:
            return retrieveNaive(query, activeFileIds, topK, minSimilarity)
    }
}

// ─── Full RAG Pipeline ────────────────────────────────────────────────────────

export async function generateRAGResponse(question, activeFiles, ragMethod) {
    try {
        const settings = loadSettings()
        const method = ragMethod || settings.ragMethod || 'naive'

        console.log(`💬 RAG pipeline başlatıldı | Yöntem: "${method}" | Soru: "${question}"`)
        console.log(`📁 Aktif dosyalar: ${activeFiles.map(f => f.name).join(', ')}`)

        // Ensure all files are embedded
        for (const file of activeFiles) {
            const count = await getChunkCount(file.id)
            if (count === 0) {
                console.log(`⚠️ ${file.name} ChromaDB'de bulunamadı, işleniyor...`)
                await processDocument(file.text, file.id, file.name, file.pages || [])
            } else {
                console.log(`✓ ${file.name} hazır (${count} chunk)`)
            }
        }

        const activeFileIds = activeFiles.map(f => f.id)

        // If GraphRAG: ensure knowledge graph index is built before retrieval
        if (method === 'graphRag') {
            console.log('🕸️ GraphRAG: bilgi grafı indekslemesi kontrol ediliyor...')
            await ensureGraphIndexed(activeFiles)
        }

        // Retrieve context using selected method
        const { context, sources } = await retrieveContext(question, activeFileIds, method)

        console.log(`✅ ${sources.length} kaynak chunk alındı`)

        const documentMetadata = {
            activeFileCount: activeFiles.length,
            fileNames: activeFiles.map(f => f.name),
            totalChunks: sources.length,
            ragMethod: method
        }

        console.log('🤖 AI yanıtı üretiliyor...')
        const response = await generateResponse(question, context, documentMetadata)

        console.log('✅ Yanıt başarıyla oluşturuldu')
        return { response, sources }
    } catch (error) {
        console.error('RAG pipeline error:', error)
        throw new Error(`Cevap oluşturulurken hata oluştu: ${error.message}`)
    }
}

export async function clearVectorStore() {
    await clearAll()
    console.log('🗑️ ChromaDB vektör deposu temizlendi')
}

export async function prewarmActiveFiles(activeFiles, selectedMethods = []) {
    console.log('🔥 [Pre-warm] Değerlendirme öncesi belgeler hazırlanıyor...')
    
    // 1. Vector Indexing (Chroma)
    for (const file of activeFiles) {
        const count = await getChunkCount(file.id)
        if (count === 0) {
            console.log(`🔥 [Pre-warm] ${file.name} ChromaDB'de bulunamadı, işleniyor...`)
            await processDocument(file.text, file.id, file.name, file.pages || [])
        } else {
            console.log(`🔥 [Pre-warm] ✓ ${file.name} ChromaDB'de zaten hazır (${count} chunk)`)
        }
    }

    // 2. Graph Indexing (GraphRAG)
    if (selectedMethods.includes('graphRag')) {
        console.log('🔥 [Pre-warm] GraphRAG için bilgi grafı kontrol ediliyor...')
        await ensureGraphIndexed(activeFiles)
    }
    
    console.log('🔥 [Pre-warm] Belgeler değerlendirme için hazır.')
}
