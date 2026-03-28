/**
 * GraphRAG Service
 * Real GraphRAG implementation — Microsoft paper (Edge et al., 2024)
 *
 * INDEXING (per file, runs once):
 *   Chunks → Entity/Relation Extraction (Gemini) → Knowledge Graph
 *         → Greedy Louvain Community Detection
 *         → Community Summarization (Gemini)
 *         → IndexedDB (graphData table)
 *
 * LOCAL SEARCH (per query):
 *   Query → Entity Extraction → Subgraph Traversal (1-hop)
 *         → Community Summaries + ChromaDB chunk lookup → Context
 *
 * Rate limits (Free Tier):
 *   - 30 requests / minute  (RPM)
 *   - 15,000 input tokens / minute (TPM)
 */

import { invokeLLM, createEmbedding } from './geminiService'
import { queryChunks, getChunksByFile } from './chromaDBService'
import { loadGraphData, saveGraphData, hasGraphData } from './indexedDBService'

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

const _RPM_LIMIT = 30
const _TPM_LIMIT = 15000
const _MIN_DELAY_MS = 2200   // ~60 000 / 30 + 200 ms safety margin

const _callWindow = []  // { ts: number, tokens: number }[]

async function _rateLimitedLLMCall(prompt) {
    const now = Date.now()
    const estTokens = Math.ceil(prompt.length / 4)

    // Prune entries older than 60 s
    while (_callWindow.length > 0 && now - _callWindow[0].ts > 60_000) {
        _callWindow.shift()
    }

    const windowReqs   = _callWindow.length
    const windowTokens = _callWindow.reduce((s, e) => s + e.tokens, 0)

    let waitMs = _MIN_DELAY_MS

    if (windowReqs >= _RPM_LIMIT - 2 && _callWindow.length > 0) {
        const needed = _callWindow[0].ts + 61_000 - Date.now()
        if (needed > waitMs) {
            console.log(`[GraphRAG Rate] RPM eşiği (${windowReqs}/dk), ${Math.ceil(needed / 1000)}s bekleniyor`)
            waitMs = needed
        }
    }

    if (windowTokens + estTokens > _TPM_LIMIT * 0.88 && _callWindow.length > 0) {
        const needed = _callWindow[0].ts + 61_000 - Date.now()
        if (needed > waitMs) {
            console.log(`[GraphRAG Rate] Token eşiği (~${windowTokens} token), ${Math.ceil(needed / 1000)}s bekleniyor`)
            waitMs = needed
        }
    }

    await new Promise(r => setTimeout(r, Math.max(waitMs, 0)))

    const response = await invokeLLM(prompt)
    _callWindow.push({ ts: Date.now(), tokens: estTokens })
    return response
}

// ─── JSON Utilities ───────────────────────────────────────────────────────────

function _extractJSON(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fenced) return fenced[1].trim()
    const raw = text.match(/\{[\s\S]*\}/)
    if (raw) return raw[0]
    return text
}

function _safeParseJSON(text, fallback = {}) {
    try { return JSON.parse(_extractJSON(text)) } catch { return fallback }
}

// ─── Entity / Relation Extraction ─────────────────────────────────────────────

function _buildExtractionPrompt(chunks) {
    const body = chunks
        .map((t, i) => `[Parça ${i + 1}]:\n${t.substring(0, 600)}`)
        .join('\n\n---\n\n')

    return `Aşağıdaki metin parçalarından önemli varlıkları ve ilişkileri çıkar.

${body}

YALNIZCA şu JSON formatında yanıt ver, başka metin ekleme:
{"entities":[{"name":"Ad","type":"PERSON|PLACE|ORG|CONCEPT|EVENT","description":"kısa açıklama"}],"relations":[{"source":"kaynak_adı","target":"hedef_adı","relation":"ilişki"}]}

Kurallar: maks 10 entity, 15 relation; yalnızca metinde geçen belirgin varlıklar.`
}

async function _extractBatch(chunks, fileId, startIdx) {
    const response = await _rateLimitedLLMCall(_buildExtractionPrompt(chunks))
    const parsed   = _safeParseJSON(response, { entities: [], relations: [] })

    const entities = (parsed.entities || [])
        .map((e, i) => ({
            id: `${fileId}_ent_${startIdx}_${i}`,
            name: String(e.name || '').trim(),
            type: String(e.type || 'CONCEPT').trim(),
            description: String(e.description || '').trim(),
            sourceChunkIds: Array.from(
                { length: chunks.length },
                (_, j) => `${fileId}_chunk_${startIdx + j}`
            ),
            fileId
        }))
        .filter(e => e.name.length > 0)

    const relations = (parsed.relations || [])
        .map(r => ({
            source: String(r.source || '').toLowerCase().trim(),
            target: String(r.target || '').toLowerCase().trim(),
            relation: String(r.relation || 'ilgili').trim(),
            fileId
        }))
        .filter(r => r.source && r.target && r.source !== r.target)

    return { entities, relations }
}

// ─── Greedy Louvain Community Detection ───────────────────────────────────────

function _detectCommunities(entities, relations) {
    if (entities.length === 0) return []

    // Build adjacency (entity.id ↔ entity.id)
    const adj = new Map(entities.map(e => [e.id, new Set()]))
    for (const r of relations) {
        if (adj.has(r.source) && adj.has(r.target)) {
            adj.get(r.source).add(r.target)
            adj.get(r.target).add(r.source)
        }
    }
    const m = Math.max(relations.length, 1)

    // Each entity starts in its own community (keyed by entity.id)
    const community = new Map(entities.map(e => [e.id, e.id]))

    let improved = true
    let iter = 0
    while (improved && iter < 15) {
        improved = false
        iter++
        for (const entity of entities) {
            const curComm   = community.get(entity.id)
            const neighbors = adj.get(entity.id) || new Set()

            // Tally links per neighbor community
            const commLinks = new Map()
            for (const nb of neighbors) {
                const nc = community.get(nb)
                commLinks.set(nc, (commLinks.get(nc) || 0) + 1)
            }

            let bestComm = curComm
            let bestGain = 0
            for (const [nc, linkCount] of commLinks) {
                if (nc === curComm) continue
                const commSize = [...community.values()].filter(c => c === nc).length
                const gain = linkCount / (neighbors.size + 1) - commSize / (2 * m)
                if (gain > bestGain) { bestGain = gain; bestComm = nc }
            }

            if (bestComm !== curComm) {
                community.set(entity.id, bestComm)
                improved = true
            }
        }
    }

    // Group into community objects
    const commMap = new Map()
    for (const [entityId, commId] of community) {
        if (!commMap.has(commId)) commMap.set(commId, [])
        commMap.get(commId).push(entityId)
    }

    return [...commMap.entries()].map(([, entityIds], idx) => ({
        id: `comm_${idx}`,
        entityIds,
        level: 0,
        summary: null
    }))
}

// ─── Community Summarization ──────────────────────────────────────────────────

async function _summarizeCommunity(community, entityMap, allRelations) {
    const commEntities  = community.entityIds.map(id => entityMap.get(id)).filter(Boolean)
    if (commEntities.length === 0) return null

    const idSet      = new Set(community.entityIds)
    const internalR  = allRelations.filter(r => idSet.has(r.source) && idSet.has(r.target))

    const entityList = commEntities
        .map(e => `• ${e.name} (${e.type}): ${e.description || ''}`)
        .join('\n')

    const relList = internalR
        .slice(0, 20)
        .map(r => `• ${entityMap.get(r.source)?.name || r.source} → ${r.relation} → ${entityMap.get(r.target)?.name || r.target}`)
        .join('\n')

    const prompt = `Aşağıdaki bilgi ağı grubunu analiz et ve 2-3 cümlelik kapsamlı bir özet yaz.
Bu özet, bu varlıklar hakkında sorulan sorulara yanıt vermek için kullanılacak.

VARliklar:
${entityList}

${relList ? `İLİŞKİLER:\n${relList}` : '(İç ilişki bulunamadı)'}

Özet:`

    return await _rateLimitedLLMCall(prompt)
}

// ─── Indexing Pipeline ────────────────────────────────────────────────────────

/**
 * Build and persist the knowledge graph for a single file.
 * Called once per file the first time GraphRAG is used.
 *
 * @param {string}   fileId
 * @param {string}   fileName
 * @param {string[]} chunkTexts  raw text of each chunk (in order)
 */
export async function indexGraphForFile(fileId, fileName, chunkTexts) {
    console.log(`[GraphRAG] 📊 "${fileName}" indeksleniyor (${chunkTexts.length} chunk)…`)

    const BATCH_SIZE   = 5
    const allEntities  = []
    const nameMap      = new Map()   // lower-cased name → entity (dedup)
    const allRelations = []

    const totalBatches = Math.ceil(chunkTexts.length / BATCH_SIZE)

    // ── Extraction phase ──────────────────────────────────────────────────────
    for (let i = 0; i < chunkTexts.length; i += BATCH_SIZE) {
        const batch    = chunkTexts.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1
        console.log(`[GraphRAG] 🔍 Extraction batch ${batchNum}/${totalBatches}`)

        let extracted
        try {
            extracted = await _extractBatch(batch, fileId, i)
        } catch (err) {
            console.warn(`[GraphRAG] Batch ${batchNum} başarısız, atlanıyor:`, err.message)
            continue
        }

        // Merge entities (deduplicate by name)
        for (const ent of extracted.entities) {
            const key = ent.name.toLowerCase()
            if (!nameMap.has(key)) {
                nameMap.set(key, ent)
                allEntities.push(ent)
            } else {
                // Merge sourceChunkIds into existing entity
                const existing = nameMap.get(key)
                for (const cid of ent.sourceChunkIds) {
                    if (!existing.sourceChunkIds.includes(cid)) existing.sourceChunkIds.push(cid)
                }
            }
        }

        // Translate relation names → entity IDs
        for (const rel of extracted.relations) {
            const srcEnt = nameMap.get(rel.source)
            const tgtEnt = nameMap.get(rel.target)
            if (srcEnt && tgtEnt) {
                allRelations.push({
                    source: srcEnt.id,
                    target: tgtEnt.id,
                    relation: rel.relation,
                    fileId
                })
            }
        }
    }

    console.log(`[GraphRAG] ✅ ${allEntities.length} entity, ${allRelations.length} ilişki`)

    // ── Community detection ───────────────────────────────────────────────────
    const communities = _detectCommunities(allEntities, allRelations)
    console.log(`[GraphRAG] 🏘️ ${communities.length} community`)

    // ── Community summarization (≥2 members, max 10 calls) ───────────────────
    const entityMap   = new Map(allEntities.map(e => [e.id, e]))
    const toSummarize = communities.filter(c => c.entityIds.length >= 2).slice(0, 10)

    for (let i = 0; i < toSummarize.length; i++) {
        const comm = toSummarize[i]
        console.log(`[GraphRAG] 📝 Community ${i + 1}/${toSummarize.length} özetleniyor (${comm.entityIds.length} entity)`)
        try {
            comm.summary = await _summarizeCommunity(comm, entityMap, allRelations)
        } catch (err) {
            console.warn(`[GraphRAG] Community ${i + 1} özet başarısız:`, err.message)
            const names = comm.entityIds.slice(0, 5).map(id => entityMap.get(id)?.name || id).join(', ')
            comm.summary = `Bu küme şu varlıkları içeriyor: ${names}.`
        }
    }

    const graphData = {
        fileId,
        fileName,
        entities:    allEntities,
        relations:   allRelations,
        communities,
        indexedAt:   Date.now(),
        version:     1
    }

    await saveGraphData(fileId, graphData)
    console.log(`[GraphRAG] ✅ Graf IndexedDB'e kaydedildi`)
    return graphData
}

/**
 * Ensure all active files have a graph index.
 * Fetches chunk texts from ChromaDB if graph is missing.
 * @param {Array<{id: string, name: string}>} activeFiles
 */
export async function ensureGraphIndexed(activeFiles) {
    for (const file of activeFiles) {
        const exists = await hasGraphData(file.id)
        if (!exists) {
            console.log(`[GraphRAG] "${file.name}" için graf verisi yok, indeksleniyor…`)
            const chunks     = await getChunksByFile(file.id)
            const chunkTexts = chunks.map(c => c.text).filter(Boolean)
            if (chunkTexts.length === 0) {
                console.warn(`[GraphRAG] "${file.name}" için ChromaDB'de chunk bulunamadı, atlanıyor`)
                continue
            }
            await indexGraphForFile(file.id, file.name, chunkTexts)
        } else {
            console.log(`[GraphRAG] ✓ "${file.name}" graf verisi hazır`)
        }
    }
}

// ─── Local Search (Query Pipeline) ───────────────────────────────────────────

/**
 * GraphRAG Local Search retrieval.
 *
 * 1. Extract entities from query (LLM)
 * 2. Match to graph entities (fuzzy name match)
 * 3. Expand 1-hop via relations
 * 4. Collect relevant community summaries
 * 5. ChromaDB vector search for raw chunks
 * 6. Return merged context
 *
 * @param {string}   query
 * @param {string[]} activeFileIds
 * @param {number}   topK
 * @param {number}   minSimilarity
 */
export async function retrieveGraphRAGLocal(query, activeFileIds, topK, minSimilarity) {
    console.log(`[GraphRAG] 🕸️ Local Search başlatıldı…`)

    // ── Load graph data ───────────────────────────────────────────────────────
    const allGraphData = (
        await Promise.all(activeFileIds.map(fid => loadGraphData(fid)))
    ).filter(Boolean)

    // If no graph data at all, log warning — caller ensures indexing beforehand
    if (allGraphData.length === 0) {
        console.warn('[GraphRAG] Graf verisi bulunamadı, naive fallback kullanılıyor')
    }

    const allEntities    = allGraphData.flatMap(gd => gd.entities)
    const allRelations   = allGraphData.flatMap(gd => gd.relations)
    const allCommunities = allGraphData.flatMap(gd => gd.communities)

    // ── Extract entities from query ───────────────────────────────────────────
    let queryEntityNames = []
    if (allEntities.length > 0) {
        const extractPrompt = `Aşağıdaki soruda geçen önemli varlıkları (kişi, yer, kuruluş, kavram) listele.
Yalnızca şu JSON formatında yanıt ver: {"entities":["varlık1","varlık2"]}
Soru: "${query}"`

        try {
            const raw    = await _rateLimitedLLMCall(extractPrompt)
            const parsed = _safeParseJSON(raw, { entities: [] })
            queryEntityNames = (parsed.entities || []).map(e => String(e).toLowerCase().trim())
        } catch {
            queryEntityNames = query.toLowerCase().split(/\s+/).filter(w => w.length > 3)
        }
    }

    // ── Fuzzy entity match ────────────────────────────────────────────────────
    const matchedEntityIds = new Set()
    for (const qName of queryEntityNames) {
        for (const ent of allEntities) {
            const entName = ent.name.toLowerCase()
            if (entName.includes(qName) || qName.includes(entName)) {
                matchedEntityIds.add(ent.id)
            }
        }
    }

    // ── 1-hop expansion via relations ─────────────────────────────────────────
    const subgraphIds = new Set(matchedEntityIds)
    for (const rel of allRelations) {
        if (subgraphIds.has(rel.source)) subgraphIds.add(rel.target)
        if (subgraphIds.has(rel.target)) subgraphIds.add(rel.source)
    }

    const subgraphEntities  = allEntities.filter(e => subgraphIds.has(e.id))
    const subgraphRelations = allRelations.filter(r => subgraphIds.has(r.source) && subgraphIds.has(r.target))

    // ── Relevant communities ──────────────────────────────────────────────────
    const relevantCommunities = allCommunities.filter(
        c => c.summary && c.entityIds.some(eid => subgraphIds.has(eid))
    )

    // ── ChromaDB vector search ────────────────────────────────────────────────
    const queryEmbedding = await createEmbedding(query)
    const vectorResults  = await queryChunks(queryEmbedding, activeFileIds, topK * 2)
    const filtered       = vectorResults.filter(c => c.similarity >= minSimilarity)
    const topChunks      = (filtered.length > 0 ? filtered : vectorResults.slice(0, 2)).slice(0, topK)

    // ── Assemble context ──────────────────────────────────────────────────────
    const parts = []

    if (relevantCommunities.length > 0) {
        parts.push('=== KONU KÜMELERİ ===')
        relevantCommunities.forEach((c, i) => {
            parts.push(`[Küme ${i + 1}]: ${c.summary}`)
        })
        parts.push('')
    }

    if (subgraphEntities.length > 0) {
        const entityMap = new Map(allEntities.map(e => [e.id, e]))
        parts.push('=== İLGİLİ VARliklar ===')
        subgraphEntities.slice(0, 15).forEach(e => {
            parts.push(`• ${e.name} (${e.type}): ${e.description}`)
        })
        parts.push('')

        if (subgraphRelations.length > 0) {
            parts.push('=== İLİŞKİLER ===')
            subgraphRelations.slice(0, 20).forEach(r => {
                const src = entityMap.get(r.source)?.name || r.source
                const tgt = entityMap.get(r.target)?.name || r.target
                parts.push(`• ${src} → ${r.relation} → ${tgt}`)
            })
            parts.push('')
        }
    }

    if (topChunks.length > 0) {
        parts.push('=== BELGE PARÇALARI ===')
        const byDoc = {}
        topChunks.forEach(chunk => {
            const fn = chunk.metadata?.fileName || 'Bilinmeyen'
            if (!byDoc[fn]) byDoc[fn] = []
            byDoc[fn].push(chunk)
        })
        Object.entries(byDoc).forEach(([fn, chunks]) => {
            parts.push(`\n=== DOCUMENT: ${fn} ===`)
            chunks.forEach(c => { parts.push(c.text); parts.push('') })
        })
    }

    const sources = topChunks.map(chunk => ({
        fileName:   chunk.metadata?.fileName || 'Bilinmeyen',
        similarity: chunk.similarity,
        chunkIndex: chunk.metadata?.chunkIndex,
        pageNumbers: chunk.metadata?.pageNumbers
            ? JSON.parse(chunk.metadata.pageNumbers || '[]')
            : null
    }))

    console.log(`[GraphRAG] ✅ ${subgraphEntities.length} entity, ${relevantCommunities.length} community, ${topChunks.length} chunk`)
    return { context: parts.join('\n'), sources }
}
