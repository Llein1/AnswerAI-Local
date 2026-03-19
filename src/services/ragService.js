import { createEmbedding, createEmbeddings, generateResponse as geminiGenerateResponse } from './geminiService'
import { generateResponse } from './geminiService'
import { loadSettings } from './settingsStorage'
import { addChunks, queryChunks, getChunkCount, clearAll } from './chromaDBService'

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
    queryExpansion: {
        id: 'queryExpansion',
        name: 'Query Expansion',
        shortName: 'Query Expansion',
        icon: '🔎',
        description: 'Sorgu sinonimler ve ilişkili terimlerle genişletilir. Daha geniş kapsam sayesinde ilgili belgeler kaçırılmaz.',
        speed: 3,
        quality: 4,
        badge: 'Genişletme'
    },
    multiQuery: {
        id: 'multiQuery',
        name: 'Multi-Query Retrieval',
        shortName: 'Multi-Query',
        icon: '🔀',
        description: 'Aynı soru 3 farklı perspektiften yeniden yazılır. Her versiyon ayrı sorgulanır, sonuçlar birleştirilir.',
        speed: 2,
        quality: 5,
        badge: 'Kapsamlı'
    },
    contextualCompression: {
        id: 'contextualCompression',
        name: 'Contextual Compression',
        shortName: 'Sıkıştırma',
        icon: '🗜️',
        description: 'Önce fazla chunk alınır, ardından AI alakasız kısımları budayarak yalnızca en önemli bilgiyi tutar.',
        speed: 2,
        quality: 5,
        badge: 'Hassas'
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
    rrf: {
        id: 'rrf',
        name: 'Reciprocal Rank Fusion (RRF)',
        shortName: 'RRF',
        icon: '🔗',
        description: 'Orijinal sorgu ve yeniden yazılmış sorgudan iki ayrı sıralı liste üretilir. RRF formülüyle birleştirilir.',
        speed: 3,
        quality: 4,
        badge: 'Füzyon'
    },
    stepBack: {
        id: 'stepBack',
        name: 'Step-Back Prompting',
        shortName: 'Step-Back',
        icon: '⬆️',
        description: 'Spesifik sorudan bir adım geri çekilir, daha genel konsept sorusu üretilir. Her iki soru da ayrı aranır.',
        speed: 3,
        quality: 4,
        badge: 'Genel→Özel'
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
    }
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
    const chunks = []
    let startIndex = 0

    while (startIndex < text.length) {
        const endIndex = Math.min(startIndex + chunkSize, text.length)
        const chunk = text.slice(startIndex, endIndex)
        if (chunk.trim().length > 0) chunks.push(chunk.trim())
        startIndex += chunkSize - overlap
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

        await addChunks(fileId, processedChunks)

        const validChunks = processedChunks.filter(c => c.embedding && c.embedding.length > 0)
        if (validChunks[0]?.embedding) {
            const dim = validChunks[0].embedding.length
            const magnitude = Math.sqrt(validChunks[0].embedding.reduce((sum, v) => sum + v * v, 0))
            console.log(`🔬 Embedding doğrulama: ${validChunks.length}/${processedChunks.length} chunk, ${dim} boyut, magnitude=${magnitude.toFixed(4)}`)
        }

        console.log(`✅ ${processedChunks.length} chunk ChromaDB'ye kaydedildi`)
        return processedChunks.length
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
            const pageNumbers = chunk.metadata?.pageNumbers
                ? JSON.parse(chunk.metadata.pageNumbers || '[]')
                : null
            const pages = pageNumbers && pageNumbers.length > 0 ? ` (Pages: ${pageNumbers.join(', ')})` : ''
            contextParts.push(`[Alıntı ${i + 1}${pages}]`)
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
    const response = await geminiGenerateResponse(prompt, '', {})
    return typeof response === 'string' ? response : response?.content || ''
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

            // Max similarity to already selected
            let maxSim = 0
            for (const sel of selected) {
                const s = cosineSim(candEmb, sel.embedding)
                if (s > maxSim) maxSim = s
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

// ─── Method 4: Query Expansion ────────────────────────────────────────────────

async function retrieveQueryExpansion(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Query Expansion] Sorgu genişletiliyor...`)

    const expansionPrompt = `Aşağıdaki arama sorgusunu sinonimler ve ilişkili terimler ekleyerek genişlet.
Orijinal sorgu ile birlikte tek bir zenginleştirilmiş sorgu cümlesi yaz.
Orijinal sorgu: "${query}"
Genişletilmiş sorgu (sadece sorgu metnini yaz, açıklama ekleme):`

    const expandedQuery = await callLLM(expansionPrompt)
    const cleanExpanded = expandedQuery.trim().replace(/^["']|["']$/g, '')
    console.log(`[RAG: Query Expansion] Genişletilmiş: "${cleanExpanded.substring(0, 100)}"`)

    // Embed the expanded query
    const expandedEmbedding = await createEmbedding(cleanExpanded)
    const results = await queryChunks(expandedEmbedding, activeFileIds, topK * 2)

    if (results.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    let relevant = results.filter(c => c.similarity >= minSimilarity)
    if (relevant.length === 0) relevant = [results[0]]

    return buildContextFromChunks(relevant.slice(0, topK))
}

// ─── Method 5: Multi-Query Retrieval ─────────────────────────────────────────

async function retrieveMultiQuery(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Multi-Query] 3 farklı sorgu üretiliyor...`)

    const multiPrompt = `Aşağıdaki soruyu 3 farklı perspektiften yeniden yaz. 
Her biri farklı kelimeler ve yaklaşım kullansın.
Sadece 3 sorguyu numaralı liste halinde yaz.
Orijinal soru: "${query}"
Alternatif sorgular:`

    const multiResponse = await callLLM(multiPrompt)
    
    // Parse the 3 queries
    const lines = multiResponse.split('\n').filter(l => l.trim())
    const queries = []
    for (const line of lines) {
        const cleaned = line.replace(/^[\d\.\-\*\s]+/, '').trim()
        if (cleaned.length > 10) queries.push(cleaned)
        if (queries.length === 3) break
    }
    
    // Fallback if parsing fails
    if (queries.length === 0) queries.push(query)
    queries.unshift(query) // include original
    
    console.log(`[RAG: Multi-Query] ${queries.length} sorgu kullanılıyor`)

    // Query each version
    const allChunksMap = new Map()
    for (const q of queries) {
        try {
            const emb = await createEmbedding(q)
            const results = await queryChunks(emb, activeFileIds, topK)
            for (const chunk of results) {
                if (!allChunksMap.has(chunk.id) || allChunksMap.get(chunk.id).similarity < chunk.similarity) {
                    allChunksMap.set(chunk.id, chunk)
                }
            }
        } catch (e) {
            console.warn(`[RAG: Multi-Query] Sorgu başarısız:`, e.message)
        }
    }

    if (allChunksMap.size === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    const merged = Array.from(allChunksMap.values())
        .filter(c => c.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)

    const topChunks = merged.length > 0 ? merged.slice(0, topK) : [Array.from(allChunksMap.values())[0]]
    return buildContextFromChunks(topChunks)
}

// ─── Method 6: Contextual Compression ────────────────────────────────────────

async function retrieveContextualCompression(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Contextual Compression] Fazla chunk alınıp sıkıştırılıyor...`)

    const queryEmbedding = await createEmbedding(query)
    const bigK = Math.min(topK * 3, 15)
    const results = await queryChunks(queryEmbedding, activeFileIds, bigK)

    if (results.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    // Filter by basic threshold first
    const candidates = results.filter(c => c.similarity >= Math.max(minSimilarity - 0.1, 0.3))
    const toCompress = candidates.length > 0 ? candidates.slice(0, Math.min(8, candidates.length)) : [results[0]]

    // Ask LLM to compress/filter
    const chunksText = toCompress.map((c, i) =>
        `[Chunk ${i + 1}]\n${c.text}`
    ).join('\n\n---\n\n')

    const compressPrompt = `Aşağıdaki metin parçalarından, şu soruyla doğrudan ilgili bilgileri özetle ve filtrele:
Soru: "${query}"

Metin parçaları:
${chunksText}

GÖREV: Her chunk için sadece soruyla alakalı kısımları çıkar. Alakasız bilgileri at.
Çıktı formatı: Her alakalı alıntı için "[Kaynak: Chunk X]" başlığı koy, sonra özeti yaz.
Eğer bir chunk tamamen alakasızsa, onu dahil etme.`

    const compressedText = await callLLM(compressPrompt)

    // Build synthetic result with original sources
    const syntheticChunk = {
        id: 'compressed_result',
        text: compressedText,
        metadata: {
            fileName: toCompress[0]?.metadata?.fileName || 'Birleştirilmiş Kaynaklar',
            chunkIndex: 0,
            pageNumbers: null
        },
        similarity: toCompress[0]?.similarity || 0.8
    }

    return {
        context: `\n=== SIKIŞTIRILAN BAĞLAM ===\n${compressedText}`,
        sources: toCompress.slice(0, topK).map(chunk => ({
            fileName: chunk.metadata?.fileName || 'Bilinmeyen',
            similarity: chunk.similarity,
            chunkIndex: chunk.metadata?.chunkIndex,
            pageNumbers: chunk.metadata?.pageNumbers
                ? JSON.parse(chunk.metadata.pageNumbers || '[]')
                : null
        }))
    }
}

// ─── Method 7: BM25 Hybrid Search ────────────────────────────────────────────

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

    const scoredChunks = results.map(chunk => {
        const chunkText = (chunk.text || '').toLowerCase()
        
        // TF-IDF-like keyword score
        let keywordScore = 0
        for (const term of queryTerms) {
            const regex = new RegExp(term, 'g')
            const matches = chunkText.match(regex)
            const tf = matches ? matches.length : 0
            // Normalize by chunk length
            const normalizedTF = tf / (chunkText.length / 100 + 1)
            keywordScore += normalizedTF
        }
        
        // Normalize keyword score to 0-1
        const maxKeyword = 1.0
        const normalizedKeyword = Math.min(keywordScore / maxKeyword, 1)

        // Hybrid score
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

// ─── Method 8: Reciprocal Rank Fusion (RRF) ───────────────────────────────────

async function retrieveRRF(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: RRF] İki sıralı liste birleştiriliyor...`)

    const k = 60  // RRF constant

    // Generate a reformulated query
    const reformulatePrompt = `Aşağıdaki soruyu farklı kelimelerle ama aynı anlamı koruyarak yeniden yaz.
Sadece yeniden yazılmış soruyu döndür, açıklama ekleme.
Soru: "${query}"
Yeniden yazılmış soru:`

    let reformulated = query
    try {
        const resp = await callLLM(reformulatePrompt)
        reformulated = resp.trim().replace(/^["']|["']$/g, '') || query
    } catch (e) {
        console.warn('[RAG: RRF] Sorgu yeniden yazılamadı, orijinal kullanılıyor')
    }

    console.log(`[RAG: RRF] Sorgu 1: "${query.substring(0, 60)}..."`)
    console.log(`[RAG: RRF] Sorgu 2: "${reformulated.substring(0, 60)}..."`)

    // Get two ranked lists
    const emb1 = await createEmbedding(query)
    const emb2 = await createEmbedding(reformulated)

    const [list1, list2] = await Promise.all([
        queryChunks(emb1, activeFileIds, topK * 2),
        queryChunks(emb2, activeFileIds, topK * 2)
    ])

    // RRF scoring
    const rrfScores = new Map()
    const chunkData = new Map()

    const score = (list, rankBonus = 0) => {
        list.forEach((chunk, rank) => {
            const prev = rrfScores.get(chunk.id) || 0
            rrfScores.set(chunk.id, prev + 1 / (rank + 1 + k))
            if (!chunkData.has(chunk.id)) chunkData.set(chunk.id, chunk)
        })
    }
    score(list1)
    score(list2)

    const merged = Array.from(rrfScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map(([id, rrfScore]) => ({ ...chunkData.get(id), similarity: rrfScore }))

    if (merged.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    console.log(`[RAG: RRF] ${merged.length} chunk RRF ile birleştirildi`)
    return buildContextFromChunks(merged)
}

// ─── Method 9: Step-Back Prompting ───────────────────────────────────────────

async function retrieveStepBack(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Step-Back] Genel prensip sorusu üretiliyor...`)

    const stepBackPrompt = `Aşağıdaki spesifik sorunun arkasındaki daha genel/temel kavram veya prensibi soran 
bir soru yaz. Spesifik detaylardan soyutla, genel kavramı sor.
Spesifik soru: "${query}"
Genel/step-back soru (sadece soruyu yaz):`

    let stepBackQuery = query
    try {
        const resp = await callLLM(stepBackPrompt)
        stepBackQuery = resp.trim().replace(/^["']|["']$/g, '') || query
    } catch (e) {
        console.warn('[RAG: Step-Back] Step-back sorgu üretilemedi')
    }

    console.log(`[RAG: Step-Back] Genel soru: "${stepBackQuery.substring(0, 80)}"`)

    // Search with both queries
    const [emb1, emb2] = await Promise.all([
        createEmbedding(query),
        createEmbedding(stepBackQuery)
    ])

    const [results1, results2] = await Promise.all([
        queryChunks(emb1, activeFileIds, topK),
        queryChunks(emb2, activeFileIds, topK)
    ])

    // Merge, deduplicate by ID, keep best similarity
    const merged = new Map()
    for (const chunk of [...results1, ...results2]) {
        if (!merged.has(chunk.id) || merged.get(chunk.id).similarity < chunk.similarity) {
            merged.set(chunk.id, chunk)
        }
    }

    const sorted = Array.from(merged.values())
        .filter(c => c.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)

    const topChunks = sorted.length > 0 ? sorted.slice(0, topK) : [Array.from(merged.values())[0]]

    if (!topChunks[0]) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    return buildContextFromChunks(topChunks)
}

// ─── Method 10: Self-RAG ──────────────────────────────────────────────────────

async function retrieveSelfRAG(query, activeFileIds, topK, minSimilarity) {
    console.log(`[RAG: Self-RAG] AI öz-değerlendirme yapıyor...`)

    const queryEmbedding = await createEmbedding(query)
    const candidateK = Math.min(topK * 3, 12)
    const candidates = await queryChunks(queryEmbedding, activeFileIds, candidateK)

    if (candidates.length === 0) throw new Error('Aktif dosyalardan işlenmiş içerik bulunamadı')

    // LLM grades each chunk
    const scoredChunks = []

    // Batch evaluation for efficiency
    const evalPrompt = `Soru: "${query}"

Aşağıdaki metin parçalarının her birini bu soru için değerlendir.
Her parça için: YÜKSEK, ORTA veya DÜŞÜK yazarak alaka düzeyini belirt.
Format: "Chunk X: YÜKSEK/ORTA/DÜŞÜK"

${candidates.slice(0, 6).map((c, i) => `Chunk ${i + 1}:\n${c.text.substring(0, 200)}`).join('\n\n---\n\n')}

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

    candidates.slice(0, 6).forEach((chunk, i) => {
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
    candidates.slice(6).forEach(chunk => {
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
    const minSimilarity = 0.4

    console.log(`🔍 RAG Yöntemi: "${ragMethod}" | Sorgu: "${query}" | ${activeFileIds.length} dosya`)

    const method = RAG_METHODS[ragMethod]
    if (method) {
        console.log(`📌 ${method.icon} ${method.name}`)
    }

    switch (ragMethod) {
        case 'mmr':
            return retrieveMMR(query, activeFileIds, topK, minSimilarity)
        case 'hyde':
            return retrieveHyDE(query, activeFileIds, topK, minSimilarity)
        case 'queryExpansion':
            return retrieveQueryExpansion(query, activeFileIds, topK, minSimilarity)
        case 'multiQuery':
            return retrieveMultiQuery(query, activeFileIds, topK, minSimilarity)
        case 'contextualCompression':
            return retrieveContextualCompression(query, activeFileIds, topK, minSimilarity)
        case 'bm25Hybrid':
            return retrieveBM25Hybrid(query, activeFileIds, topK, minSimilarity)
        case 'rrf':
            return retrieveRRF(query, activeFileIds, topK, minSimilarity)
        case 'stepBack':
            return retrieveStepBack(query, activeFileIds, topK, minSimilarity)
        case 'selfRag':
            return retrieveSelfRAG(query, activeFileIds, topK, minSimilarity)
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
