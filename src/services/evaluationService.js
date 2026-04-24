/**
 * RAG Evaluation Service
 * ─────────────────────────────────────────────────────────────────────────────
 * 6 RAG yöntemini bir soru seti üzerinde otomatik değerlendirir.
 *
 * Değerlendirilen metrikler:
 *   LLM-as-a-Judge : Context Relevance, Faithfulness, Answer Relevance (1-5)
 *   Referans Tabanlı: BLEU-4, ROUGE-1, ROUGE-2, ROUGE-L, METEOR (0-1)
 *   Retrieval       : Precision@K, Recall@K, MRR, nDCG@K (0-1)
 *   End-to-End      : Latency (ms), Token kullanımı
 *
 * Rate Limit Stratejisi (Free Tier: 30 RPM / 15,000 TPM):
 *   - Her API çağrısı öncesi MIN_DELAY_MS bekler → en fazla 10 çağrı/dk
 *   - Son 65 sn içindeki tahmini token sayısı TPM_BUDGET'ı geçecekse
 *     yeni dakika açılana kadar bekler
 *   - 429 hatası alınırsa exponential backoff: 15s → 30s → 60s → 120s
 *   - Tüm bu önlemler birlikte asla rate limit'e takılmaz, uzun sürer ama güvenlidir
 */

import { generateRAGResponse, prewarmActiveFiles } from './ragService'
import { invokeLLM, getAndResetTokenUsage } from './geminiService'

// ─── Sabitler ────────────────────────────────────────────────────────────────

/**
 * Rate limit ayarları — Free Tier için çok konservatif:
 *   30 RPM limitine karşılık biz en fazla 10/dk kullanıyoruz (%33)
 *   15,000 TPM limitine karşılık biz en fazla 10,000/dk kullanıyoruz (%67)
 */
const RL = {
    MIN_DELAY_MS:   6000,    // Her API çağrısı arasında en az 6 saniye (max 10/dk → 30 RPM'in 1/3'ü)
    TPM_BUDGET:     10000,   // 65 sn pencerede yumuşak token tavanı (gerçek limit: 15,000)
    WINDOW_MS:      65000,   // Token penceresi: 65 saniye
    MAX_RETRIES:    6,       // 429 sonrası maksimum deneme
    BACKOFF_BASE:   15000,   // İlk backoff: 15 saniye
    BACKOFF_MAX:    120000,  // Maksimum backoff: 2 dakika
}

// Çağrı kayıt listesi: { ts: timestamp, tokens: tahmini_token }
const callLog = []

// ─── Yardımcı Fonksiyonlar ────────────────────────────────────────────────────

/** Metni 4 karakter = 1 token olarak yaklaşık token sayısına çevirir */
function estimateTokens(text) {
    return Math.ceil((text || '').length / 4)
}

/** Son WINDOW_MS içindeki toplam tahmini token kullanımını döndürür */
function getWindowTokens() {
    const cutoff = Date.now() - RL.WINDOW_MS
    return callLog
        .filter(c => c.ts >= cutoff)
        .reduce((sum, c) => sum + c.tokens, 0)
}

/** Belirtilen ms kadar bekle */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Rate-Limited API Çağrısı ─────────────────────────────────────────────────

/**
 * invokeLLM'yi rate limit farkında şekilde çağırır.
 * @param {string} prompt
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
async function rateLimitedCall(prompt, signal) {
    // Abort kontrolü
    if (signal?.aborted) throw new Error('ABORTED')

    const estTokens = estimateTokens(prompt)
    const windowTokens = getWindowTokens()

    // Token penceresi kontrolü: taşacaksa yeni dakika açılana kadar bekle
    if (windowTokens + estTokens > RL.TPM_BUDGET) {
        const oldest = callLog.filter(c => c.ts >= Date.now() - RL.WINDOW_MS)[0]
        if (oldest) {
            const waitMs = RL.WINDOW_MS - (Date.now() - oldest.ts) + 2000  // 2s ekstra güvenlik
            const waitSec = Math.ceil(waitMs / 1000)
            console.log(`⏳ [RateLimit] Token penceresi dolu (${windowTokens + estTokens} est. > ${RL.TPM_BUDGET}). ${waitSec}s bekleniyor...`)
            await sleep(waitMs)
        }
    }

    // Minimum gecikme: çağrılar arası en az 6 saniye
    await sleep(RL.MIN_DELAY_MS)

    // Bu çağrıyı kayıt al
    callLog.push({ ts: Date.now(), tokens: estTokens })

    // Exponential backoff retry döngüsü
    for (let attempt = 0; attempt < RL.MAX_RETRIES; attempt++) {
        if (signal?.aborted) throw new Error('ABORTED')

        try {
            return await invokeLLM(prompt)
        } catch (err) {
            const is429 = err.message?.includes('429') ||
                          err.message?.includes('quota') ||
                          err.message?.includes('RESOURCE_EXHAUSTED')

            if (!is429 || attempt === RL.MAX_RETRIES - 1) throw err

            const backoffMs = Math.min(
                RL.BACKOFF_BASE * Math.pow(2, attempt),
                RL.BACKOFF_MAX
            )
            console.warn(`⚠️ [RateLimit] 429 alındı (deneme ${attempt + 1}/${RL.MAX_RETRIES}). ${backoffMs / 1000}s bekleniyor...`)
            await sleep(backoffMs)
        }
    }
}

// ─── ROUGE-L Hesaplama ────────────────────────────────────────────────────────

/**
 * ROUGE-L F1 skorunu hesaplar (Longest Common Subsequence tabanlı).
 * Python bağımlılığı gerektirmez, saf JS.
 * @param {string} generated  - Sistem tarafından üretilen metin
 * @param {string} reference  - Ground truth referans metni
 * @returns {number} 0-1 arası F1 skoru
 */
export function calculateROUGEL(generated, reference) {
    if (!generated || !reference) return 0

    const a = generated.toLowerCase().split(/\s+/).filter(Boolean)
    const b = reference.toLowerCase().split(/\s+/).filter(Boolean)

    if (a.length === 0 || b.length === 0) return 0

    // LCS dinamik programlama tablosu
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1] + 1
                : Math.max(dp[i - 1][j], dp[i][j - 1])
        }
    }

    const lcs = dp[a.length][b.length]
    const precision = lcs / a.length
    const recall    = lcs / b.length
    if (precision + recall === 0) return 0

    return parseFloat(((2 * precision * recall) / (precision + recall)).toFixed(4))
}

// ─── N-gram Yardımcı Fonksiyonlar ──────────────────────────────────────────────

/** Verilen token dizisinden n uzunluklu tüm n-gram'ları döndürür */
function getNgrams(tokens, n) {
    const ngrams = []
    for (let i = 0; i <= tokens.length - n; i++) {
        ngrams.push(tokens.slice(i, i + n).join(' '))
    }
    return ngrams
}

/** N-gram listesini frekans haritasına çevirir */
function countNgrams(ngrams) {
    const counts = {}
    for (const ng of ngrams) counts[ng] = (counts[ng] || 0) + 1
    return counts
}

/** Türkçe/İngilizce için basit suffix stripping */
function stem(word) {
    const suffixes = [
        'nın','nin','nun','nün','ların','lerin','lardan','lerden','larda','lerde',
        'lar','ler','ından','inden','dan','den','tan','ten','da','de','ta','te',
        'ını','ini','unu','ünü','yı','yi','yu','yü','ı','i','u','ü',
        'tion','ness','ing','ed','es','ly','er','est','s'
    ]
    let w = word
    for (const suf of suffixes) {
        if (w.endsWith(suf) && w.length - suf.length >= 3) {
            return w.slice(0, w.length - suf.length)
        }
    }
    return w
}

/** Eşleşen index kümesindeki ardışık olmayan segment sayısını döndürür */
function countChunks(matchedIndices) {
    if (matchedIndices.size === 0) return 0
    const sorted = [...matchedIndices].sort((a, b) => a - b)
    let chunks = 1
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) chunks++
    }
    return chunks
}

// ─── Referans Tabanlı Metrikler ───────────────────────────────────────────────

/**
 * BLEU-4 skoru (1-4 gram precision geometrik ortalaması + brevity penalty).
 * @param {string} generated
 * @param {string} reference
 * @returns {number} 0-1
 */
export function calculateBLEU(generated, reference) {
    if (!generated || !reference) return 0
    const gen = generated.toLowerCase().split(/\s+/).filter(Boolean)
    const ref = reference.toLowerCase().split(/\s+/).filter(Boolean)
    if (gen.length === 0 || ref.length === 0) return 0

    const bp = gen.length >= ref.length ? 1 : Math.exp(1 - ref.length / gen.length)

    let logSum = 0
    for (let n = 1; n <= 4; n++) {
        const genNg = getNgrams(gen, n)
        const refNg = getNgrams(ref, n)
        if (genNg.length === 0) return 0
        const refCounts = countNgrams(refNg)
        const genCounts = countNgrams(genNg)
        let clipped = 0
        for (const [ng, cnt] of Object.entries(genCounts)) {
            clipped += Math.min(cnt, refCounts[ng] || 0)
        }
        const prec = clipped / genNg.length
        if (prec === 0) return 0
        logSum += Math.log(prec)
    }
    return parseFloat((bp * Math.exp(logSum / 4)).toFixed(4))
}

/**
 * ROUGE-N F1 skoru (n=1 veya n=2).
 */
function calculateROUGEN(generated, reference, n) {
    if (!generated || !reference) return 0
    const gen = generated.toLowerCase().split(/\s+/).filter(Boolean)
    const ref = reference.toLowerCase().split(/\s+/).filter(Boolean)
    const genNg = getNgrams(gen, n)
    const refNg = getNgrams(ref, n)
    if (genNg.length === 0 || refNg.length === 0) return 0
    const refCounts = countNgrams(refNg)
    const genCounts = countNgrams(genNg)
    let overlap = 0
    for (const [ng, cnt] of Object.entries(genCounts)) {
        overlap += Math.min(cnt, refCounts[ng] || 0)
    }
    const precision = overlap / genNg.length
    const recall    = overlap / refNg.length
    if (precision + recall === 0) return 0
    return parseFloat(((2 * precision * recall) / (precision + recall)).toFixed(4))
}

export const calculateROUGE1 = (gen, ref) => calculateROUGEN(gen, ref, 1)
export const calculateROUGE2 = (gen, ref) => calculateROUGEN(gen, ref, 2)

/**
 * METEOR skoru (exact + stem eşleme, fragmentation penalty).
 * @param {string} generated
 * @param {string} reference
 * @returns {number} 0-1
 */
export function calculateMETEOR(generated, reference) {
    if (!generated || !reference) return 0
    const gen = generated.toLowerCase().split(/\s+/).filter(Boolean)
    const ref = reference.toLowerCase().split(/\s+/).filter(Boolean)
    if (gen.length === 0 || ref.length === 0) return 0

    const matchedRef = new Set()
    const matchedGen = new Set()

    // Exact match
    for (let i = 0; i < gen.length; i++) {
        for (let j = 0; j < ref.length; j++) {
            if (!matchedRef.has(j) && !matchedGen.has(i) && gen[i] === ref[j]) {
                matchedRef.add(j); matchedGen.add(i); break
            }
        }
    }
    // Stem match
    for (let i = 0; i < gen.length; i++) {
        if (matchedGen.has(i)) continue
        for (let j = 0; j < ref.length; j++) {
            if (!matchedRef.has(j) && stem(gen[i]) === stem(ref[j])) {
                matchedRef.add(j); matchedGen.add(i); break
            }
        }
    }

    const m = matchedGen.size
    if (m === 0) return 0

    const precision = m / gen.length
    const recall    = m / ref.length
    const alpha     = 0.9
    const fMean     = (precision * recall) / (alpha * precision + (1 - alpha) * recall)
    const chunks    = countChunks(matchedGen)
    const penalty   = 0.5 * Math.pow(chunks / m, 3)
    return parseFloat(Math.max(0, fMean * (1 - penalty)).toFixed(4))
}

// ─── Retrieval Metrikleri ─────────────────────────────────────────────────────

/** Chunk metni relevant_keywords'lerden herhangi birini içeriyor mu? */
function isChunkRelevant(text, keywords) {
    if (!keywords || keywords.length === 0 || !text) return false
    const lower = text.toLowerCase()
    return keywords.some(kw => lower.includes(kw.toLowerCase()))
}

/**
 * Precision@K: İlk K kaynak chunk'ın kaçı en az bir anahtar kelimeyi içeriyor?
 */
export function calculatePrecisionAtK(sources, keywords, k) {
    if (!keywords?.length || !sources?.length) return 0
    const top = sources.slice(0, k)
    const relevant = top.filter(s => isChunkRelevant(s.text, keywords))
    return parseFloat((relevant.length / top.length).toFixed(4))
}

/**
 * Recall@K: İlgili anahtar kelimelerin kaçı ilk K chunk'ta bulunuyor?
 */
export function calculateRecallAtK(sources, keywords, k) {
    if (!keywords?.length || !sources?.length) return 0
    const top = sources.slice(0, k)
    const covered = keywords.filter(kw =>
        top.some(s => (s.text || '').toLowerCase().includes(kw.toLowerCase()))
    )
    return parseFloat((covered.length / keywords.length).toFixed(4))
}

/**
 * MRR: İlk ilgili chunk'ın sıralamadaki pozisyonunun tersi.
 */
export function calculateMRR(sources, keywords) {
    if (!keywords?.length || !sources?.length) return 0
    for (let i = 0; i < sources.length; i++) {
        if (isChunkRelevant(sources[i].text, keywords)) {
            return parseFloat((1 / (i + 1)).toFixed(4))
        }
    }
    return 0
}

/**
 * nDCG@K: Logaritmik konuma göre normalize edilmiş alaka skoru.
 */
export function calculateNDCG(sources, keywords, k) {
    if (!keywords?.length || !sources?.length) return 0
    const top = sources.slice(0, k)
    let dcg = 0
    for (let i = 0; i < top.length; i++) {
        const rel = isChunkRelevant(top[i].text, keywords) ? 1 : 0
        dcg += rel / Math.log2(i + 2)
    }
    const numRelevant = top.filter(s => isChunkRelevant(s.text, keywords)).length
    let idcg = 0
    for (let i = 0; i < numRelevant; i++) idcg += 1 / Math.log2(i + 2)
    if (idcg === 0) return 0
    return parseFloat((dcg / idcg).toFixed(4))
}

// ─── LLM Hakem ───────────────────────────────────────────────────────────────

/**
 * Gemini'yi hakem olarak kullanarak Context Relevance, Faithfulness ve
 * Answer Relevance skorlarını TEK bir API çağrısıyla alır.
 * @param {{ question, context, answer, groundTruth }} params
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ contextRelevance, faithfulness, answerRelevance }>}
 */
async function judgeWithLLM({ question, context, answer, groundTruth }, signal) {
    // Hakem prompt'undaki bağlamı kısalt → token tasarrufu + TPM azaltma
    const contextSnippet = (context || '').substring(0, 600)
    const answerSnippet  = (answer  || '').substring(0, 500)

    const prompt = `Sen bir RAG sistemi değerlendirme uzmanısın. Aşağıdaki çıktıyı 3 kriter bazında değerlendir.

SORU: ${question}
BAĞLAM (Getirilen Belgeler): ${contextSnippet}
SİSTEM CEVABI: ${answerSnippet}
REFERANS CEVAP: ${groundTruth}

Kriterleri 1-5 arasında puanla:
- context_relevance: Getirilen bağlam soruyla ne kadar ilgili? (1=alakasız, 5=çok alakalı)
- faithfulness: Cevap yalnızca bağlama mı dayanıyor, yoksa uydurma bilgi var mı? (1=tamamen uydurma, 5=tamamen bağlama dayalı)
- answer_relevance: Cevap soruyu tam ve doğru şekilde karşılıyor mu? (1=hiç karşılamıyor, 5=mükemmel)

Yalnızca geçerli JSON ile yanıt ver, başka hiçbir şey yazma:
{"context_relevance": X, "faithfulness": X, "answer_relevance": X}`

    const raw = await rateLimitedCall(prompt, signal)

    try {
        const match = raw.match(/\{[\s\S]*?\}/)
        if (!match) throw new Error('JSON bulunamadı')
        const parsed = JSON.parse(match[0])
        return {
            contextRelevance: Math.min(5, Math.max(1, parseFloat(parsed.context_relevance) || 0)),
            faithfulness:     Math.min(5, Math.max(1, parseFloat(parsed.faithfulness)     || 0)),
            answerRelevance:  Math.min(5, Math.max(1, parseFloat(parsed.answer_relevance) || 0)),
        }
    } catch {
        console.warn('[Judge] JSON parse başarısız, yanıt:', raw?.substring(0, 200))
        return { contextRelevance: 0, faithfulness: 0, answerRelevance: 0 }
    }
}

// ─── Checkpoint Yönetimi ──────────────────────────────────────────────────────

const CHECKPOINT_KEY = 'rag_eval_checkpoint_v1'

/** localStorage'daki checkpoint'i yükle */
export function loadCheckpoint() {
    try {
        const saved = localStorage.getItem(CHECKPOINT_KEY)
        return saved ? JSON.parse(saved) : null
    } catch {
        return null
    }
}

/** Checkpoint'i temizle (değerlendirme tamamlandığında) */
export function clearCheckpoint() {
    localStorage.removeItem(CHECKPOINT_KEY)
}

function saveCheckpoint(data) {
    try {
        localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(data))
    } catch (e) {
        console.warn('[Checkpoint] Kayıt başarısız:', e.message)
    }
}

// ─── Ana Değerlendirme Çalıştırıcısı ─────────────────────────────────────────

/**
 * Seçilen RAG yöntemlerini tüm sorular üzerinde çalıştırır ve değerlendirir.
 *
 * @param {Object} options
 * @param {Array}  options.questions       - questions.json'dan yüklenen soru listesi
 * @param {Array}  options.activeFiles     - Aktif belgeler (ragService formatında)
 * @param {Array}  options.selectedMethods - Çalıştırılacak RAG yöntem ID'leri
 * @param {Function} [options.onProgress]  - İlerleme callback'i
 * @param {AbortSignal} [options.signal]   - İptal sinyali
 * @param {Object} [options.resumeFrom]    - Checkpoint verisi (devam senaryosu)
 * @returns {Promise<{ interrupted: boolean, results: Array }>}
 */
export async function runEvaluation({
    questions,
    activeFiles,
    selectedMethods,
    onProgress,
    signal,
    resumeFrom = null
}) {
    const results       = resumeFrom?.results   ?? []
    const startMethodIdx = resumeFrom?.methodIdx ?? 0
    const startQIdx      = resumeFrom?.qIdx      ?? 0

    const totalSteps  = selectedMethods.length * questions.length
    let completedSteps = results.length

    if (startMethodIdx === 0 && startQIdx === 0) {
        onProgress?.({
            step: completedSteps,
            total: totalSteps,
            method: 'Hazırlık',
            questionId: '-',
            questionText: 'Belgeler kontrol ediliyor ve indeksleniyor (Pre-warming)...',
            phase: 'rag'
        })
        try {
            await prewarmActiveFiles(activeFiles, selectedMethods)
        } catch (err) {
            console.error('[Eval] Pre-warm hatası:', err)
        }
    }

    for (let mi = startMethodIdx; mi < selectedMethods.length; mi++) {
        const method = selectedMethods[mi]
        const startQ = (mi === startMethodIdx) ? startQIdx : 0

        for (let qi = startQ; qi < questions.length; qi++) {
            if (signal?.aborted) {
                saveCheckpoint({ results, methodIdx: mi, qIdx: qi })
                return { interrupted: true, results }
            }

            const q = questions[qi]

            onProgress?.({
                step: completedSteps + 1,
                total: totalSteps,
                method,
                questionId: q.id,
                questionText: q.question.substring(0, 70) + '...',
                phase: 'rag'
            })

            // ── Adım 1: RAG Pipeline ────────────────────────────────────────
            getAndResetTokenUsage() // Clear any previous token count
            
            let answer   = ''
            let context  = ''
            let sources  = []
            let latency  = 0
            let ragError = false
            let ragStartTs = performance.now()
            let ragTokens  = 0

            try {
                // generateRAGResponse zaten kendi içinde Gemini çağrısı yapıyor.
                // Biz sadece MIN_DELAY_MS'i sağlamak için öncesine gecikme ekliyoruz.
                await sleep(RL.MIN_DELAY_MS)
                callLog.push({ ts: Date.now(), tokens: estimateTokens(q.question) + 200 })

                ragStartTs = performance.now() // Gerçek başlangıç zamanı (bekleme sonrası)
                const ragResult = await generateRAGResponse(q.question, activeFiles, method)
                answer   = typeof ragResult.response === 'string' ? ragResult.response : String(ragResult.response ?? '')
                sources  = ragResult.sources ?? []
                context  = sources.map(s => s.text ?? '').join('\n')
                latency  = Math.round(performance.now() - ragStartTs)
                
                // Sadece RAG aşamasının tokenlarını alıyoruz (Hakem dahil edilmiyor)
                ragTokens = getAndResetTokenUsage()
            } catch (err) {
                if (err.message === 'ABORTED') {
                    saveCheckpoint({ results, methodIdx: mi, qIdx: qi })
                    return { interrupted: true, results }
                }
                console.error(`[Eval] RAG hatası (${method}, ${q.id}):`, err.message)
                ragError = true
                latency  = Math.round(performance.now() - ragStartTs)
                answer   = `[HATA: ${err.message}]`
                ragTokens = getAndResetTokenUsage()
            }

            // ── Adım 2: LLM Hakem ───────────────────────────────────────────
            onProgress?.({
                step: completedSteps + 1,
                total: totalSteps,
                method,
                questionId: q.id,
                questionText: q.question.substring(0, 70) + '...',
                phase: ragError ? 'skip' : 'judge'
            })

            let scores = { contextRelevance: 0, faithfulness: 0, answerRelevance: 0 }

            if (!ragError) {
                try {
                    scores = await judgeWithLLM({
                        question: q.question,
                        context,
                        answer,
                        groundTruth: q.ground_truth
                    }, signal)
                } catch (err) {
                    if (err.message === 'ABORTED') {
                        saveCheckpoint({ results, methodIdx: mi, qIdx: qi })
                        return { interrupted: true, results }
                    }
                    console.error(`[Eval] Judge hatası (${method}, ${q.id}):`, err.message)
                }
            }

            // ── Adım 3: Referans Tabanlı ve Retrieval Metrikleri ─────────────────
            const rougeLScore   = ragError ? 0 : calculateROUGEL(answer, q.ground_truth)
            const bleuScore     = ragError ? 0 : calculateBLEU(answer, q.ground_truth)
            const rouge1Score   = ragError ? 0 : calculateROUGE1(answer, q.ground_truth)
            const rouge2Score   = ragError ? 0 : calculateROUGE2(answer, q.ground_truth)
            const meteorScore   = ragError ? 0 : calculateMETEOR(answer, q.ground_truth)

            // Retrieval metrikleri: relevant_keywords yoksa 0 döner
            const kw = q.relevant_keywords
            const k  = sources.length || 1
            const precisionAtK = ragError ? 0 : calculatePrecisionAtK(sources, kw, k)
            const recallAtK    = ragError ? 0 : calculateRecallAtK(sources, kw, k)
            const mrr          = ragError ? 0 : calculateMRR(sources, kw)
            const ndcg         = ragError ? 0 : calculateNDCG(sources, kw, k)
            
            let usedTokens = ragTokens
            if (usedTokens === 0) {
                // Eğer API token dönmezse eski usul tahmin kullan
                usedTokens = estimateTokens(q.question + context + answer)
            }

            const entry = {
                method,
                questionId: q.id,
                question:   q.question,
                answer,
                groundTruth:      q.ground_truth,
                // LLM-as-a-Judge
                contextRelevance: scores.contextRelevance,
                faithfulness:     scores.faithfulness,
                answerRelevance:  scores.answerRelevance,
                // Referans Tabanlı
                bleu:             bleuScore,
                rouge1:           rouge1Score,
                rouge2:           rouge2Score,
                rougeL:           rougeLScore,
                meteor:           meteorScore,
                // Retrieval
                precisionAtK,
                recallAtK,
                mrr,
                ndcg,
                // End-to-End
                latency,
                usedTokens,
                error: ragError
            }

            results.push(entry)
            completedSteps++

            // Her soru bittikten sonra checkpoint kaydet
            saveCheckpoint({ results, methodIdx: mi, qIdx: qi + 1 })

            onProgress?.({
                step: completedSteps,
                total: totalSteps,
                method,
                questionId: q.id,
                phase: 'done',
                latestResult: entry
            })
        }
    }

    clearCheckpoint()
    return { interrupted: false, results }
}

// ─── Sonuç Agregasyonu ────────────────────────────────────────────────────────

/**
 * Ham sonuç listesini yöntem bazında özetler.
 * @param {Array} results
 * @returns {Array} Her yöntem için ortalama metrikler
 */
export function aggregateResults(results) {
    const byMethod = {}

    for (const r of results) {
        if (!byMethod[r.method]) {
            byMethod[r.method] = {
                method: r.method,
                count: 0, errorCount: 0,
                sumCR: 0, sumF: 0, sumAR: 0,
                sumBLEU: 0, sumR1: 0, sumR2: 0, sumRL: 0, sumMETEOR: 0,
                sumPrec: 0, sumRec: 0, sumMRR: 0, sumNDCG: 0,
                sumLatency: 0, sumTokens: 0
            }
        }
        const m = byMethod[r.method]
        m.count++
        if (r.error) { m.errorCount++; continue }
        m.sumCR      += r.contextRelevance
        m.sumF       += r.faithfulness
        m.sumAR      += r.answerRelevance
        m.sumBLEU    += r.bleu    ?? 0
        m.sumR1      += r.rouge1  ?? 0
        m.sumR2      += r.rouge2  ?? 0
        m.sumRL      += r.rougeL
        m.sumMETEOR  += r.meteor  ?? 0
        m.sumPrec    += r.precisionAtK ?? 0
        m.sumRec     += r.recallAtK    ?? 0
        m.sumMRR     += r.mrr          ?? 0
        m.sumNDCG    += r.ndcg         ?? 0
        m.sumLatency += r.latency
        m.sumTokens  += r.usedTokens ?? r.estimatedTokens ?? 0
    }

    return Object.values(byMethod).map(m => {
        const v = m.count - m.errorCount
        return {
            method:              m.method,
            questionCount:       m.count,
            errorCount:          m.errorCount,
            avgContextRelevance: v > 0 ? parseFloat((m.sumCR   / v).toFixed(2)) : 0,
            avgFaithfulness:     v > 0 ? parseFloat((m.sumF    / v).toFixed(2)) : 0,
            avgAnswerRelevance:  v > 0 ? parseFloat((m.sumAR   / v).toFixed(2)) : 0,
            avgBLEU:             v > 0 ? parseFloat((m.sumBLEU / v).toFixed(4)) : 0,
            avgROUGE1:           v > 0 ? parseFloat((m.sumR1   / v).toFixed(4)) : 0,
            avgROUGE2:           v > 0 ? parseFloat((m.sumR2   / v).toFixed(4)) : 0,
            avgRougeL:           v > 0 ? parseFloat((m.sumRL   / v).toFixed(4)) : 0,
            avgMETEOR:           v > 0 ? parseFloat((m.sumMETEOR / v).toFixed(4)) : 0,
            avgPrecisionAtK:     v > 0 ? parseFloat((m.sumPrec / v).toFixed(4)) : 0,
            avgRecallAtK:        v > 0 ? parseFloat((m.sumRec  / v).toFixed(4)) : 0,
            avgMRR:              v > 0 ? parseFloat((m.sumMRR  / v).toFixed(4)) : 0,
            avgNDCG:             v > 0 ? parseFloat((m.sumNDCG / v).toFixed(4)) : 0,
            avgLatency:          v > 0 ? Math.round(m.sumLatency / v) : 0,
            avgTokens:           v > 0 ? Math.round(m.sumTokens  / v) : 0,
        }
    })
}

// ─── CSV Dışa Aktarma ─────────────────────────────────────────────────────────

/** Ham sonuçları CSV olarak indirmeye başlar */
export function exportToCSV(results) {
    const headers = [
        'Yöntem', 'Soru ID', 'Soru', 'Sistem Cevabı', 'Referans Cevap',
        // LLM-as-a-Judge
        'Bağlam Alaka (1-5)', 'Sadakat (1-5)', 'Cevap Alaka (1-5)',
        // Referans Tabanlı
        'BLEU-4 (0-1)', 'ROUGE-1 (0-1)', 'ROUGE-2 (0-1)', 'ROUGE-L (0-1)', 'METEOR (0-1)',
        // Retrieval
        'Precision@K (0-1)', 'Recall@K (0-1)', 'MRR (0-1)', 'nDCG@K (0-1)',
        // End-to-End
        'Gecikme (ms)', 'Kullanılan Token', 'Hata'
    ]

    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`

    const rows = results.map(r => [
        r.method,
        r.questionId,
        esc(r.question),
        esc(r.answer),
        esc(r.groundTruth),
        r.contextRelevance,
        r.faithfulness,
        r.answerRelevance,
        r.bleu    ?? 0,
        r.rouge1  ?? 0,
        r.rouge2  ?? 0,
        r.rougeL,
        r.meteor  ?? 0,
        r.precisionAtK ?? 0,
        r.recallAtK    ?? 0,
        r.mrr          ?? 0,
        r.ndcg         ?? 0,
        r.latency,
        r.usedTokens ?? r.estimatedTokens ?? 0,
        r.error ? 'EVET' : 'HAYIR'
    ].join(','))

    const csv  = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `rag-degerlendirme-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
