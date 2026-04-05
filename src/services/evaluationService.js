/**
 * RAG Evaluation Service
 * ─────────────────────────────────────────────────────────────────────────────
 * 6 RAG yöntemini bir soru seti üzerinde otomatik değerlendirir.
 *
 * Değerlendirilen metrikler:
 *   1. Context Relevance   — LLM hakem (1-5)
 *   2. Faithfulness        — LLM hakem (1-5)
 *   3. Answer Relevance    — LLM hakem (1-5)
 *   4. ROUGE-L             — yerel LCS algoritması (0-1)
 *   5. Latency             — ms cinsinden gerçek süre
 *   6. Est. Token          — yaklaşık token tahmini (len/4)
 *
 * Rate Limit Stratejisi (Free Tier: 30 RPM / 15,000 TPM):
 *   - Her API çağrısı öncesi MIN_DELAY_MS bekler → en fazla 10 çağrı/dk
 *   - Son 65 sn içindeki tahmini token sayısı TPM_BUDGET'ı geçecekse
 *     yeni dakika açılana kadar bekler
 *   - 429 hatası alınırsa exponential backoff: 15s → 30s → 60s → 120s
 *   - Tüm bu önlemler birlikte asla rate limit'e takılmaz, uzun sürer ama güvenlidir
 */

import { generateRAGResponse } from './ragService'
import { invokeLLM } from './geminiService'

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
            const startTs = performance.now()
            let answer  = ''
            let context = ''
            let latency = 0
            let ragError = false

            try {
                // generateRAGResponse zaten kendi içinde Gemini çağrısı yapıyor.
                // Biz sadece MIN_DELAY_MS'i sağlamak için öncesine gecikme ekliyoruz.
                await sleep(RL.MIN_DELAY_MS)
                callLog.push({ ts: Date.now(), tokens: estimateTokens(q.question) + 200 })

                const ragResult = await generateRAGResponse(q.question, activeFiles, method)
                answer  = typeof ragResult.response === 'string' ? ragResult.response : String(ragResult.response ?? '')
                context = (ragResult.sources ?? []).map(s => s.text ?? '').join('\n')
                latency = Math.round(performance.now() - startTs)
            } catch (err) {
                if (err.message === 'ABORTED') {
                    saveCheckpoint({ results, methodIdx: mi, qIdx: qi })
                    return { interrupted: true, results }
                }
                console.error(`[Eval] RAG hatası (${method}, ${q.id}):`, err.message)
                ragError = true
                latency  = Math.round(performance.now() - startTs)
                answer   = `[HATA: ${err.message}]`
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

            // ── Adım 3: ROUGE-L (Yerel hesaplama, API yok) ─────────────────
            const rougeLScore       = ragError ? 0 : calculateROUGEL(answer, q.ground_truth)
            const estimatedTokens   = estimateTokens(q.question + context + answer)

            const entry = {
                method,
                questionId: q.id,
                question:   q.question,
                answer,
                groundTruth:      q.ground_truth,
                contextRelevance: scores.contextRelevance,
                faithfulness:     scores.faithfulness,
                answerRelevance:  scores.answerRelevance,
                rougeL:           rougeLScore,
                latency,
                estimatedTokens,
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
                sumCR: 0, sumF: 0, sumAR: 0, sumRL: 0,
                sumLatency: 0, sumTokens: 0
            }
        }
        const m = byMethod[r.method]
        m.count++
        if (r.error) { m.errorCount++; continue }
        m.sumCR      += r.contextRelevance
        m.sumF       += r.faithfulness
        m.sumAR      += r.answerRelevance
        m.sumRL      += r.rougeL
        m.sumLatency += r.latency
        m.sumTokens  += r.estimatedTokens ?? 0
    }

    return Object.values(byMethod).map(m => {
        const v = m.count - m.errorCount
        return {
            method:             m.method,
            questionCount:      m.count,
            errorCount:         m.errorCount,
            avgContextRelevance: v > 0 ? parseFloat((m.sumCR / v).toFixed(2)) : 0,
            avgFaithfulness:     v > 0 ? parseFloat((m.sumF  / v).toFixed(2)) : 0,
            avgAnswerRelevance:  v > 0 ? parseFloat((m.sumAR / v).toFixed(2)) : 0,
            avgRougeL:           v > 0 ? parseFloat((m.sumRL / v).toFixed(4)) : 0,
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
        'Bağlam Alaka (1-5)', 'Sadakat (1-5)', 'Cevap Alaka (1-5)',
        'ROUGE-L (0-1)', 'Gecikme (ms)', 'Tahmini Token', 'Hata'
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
        r.rougeL,
        r.latency,
        r.estimatedTokens ?? 0,
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
