/**
 * EvaluationPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * RAG yöntemlerini otomatik değerlendiren kontrol paneli.
 *
 * Özellikler:
 *   - Yöntem seçimi (checkbox)
 *   - Başlat / Durdur / Devam Et
 *   - Canlı ilerleme (adım, tahmini süre, faz)
 *   - Özet tablosu (her yöntem için ortalama metrikler)
 *   - Ham sonuçlar tablosu (soru bazında)
 *   - CSV indirme
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
    PlayCircle, StopCircle, RotateCcw, Download,
    CheckSquare, Square, AlertTriangle, CheckCircle2,
    Clock, Zap, FileText, BarChart3, Info
} from 'lucide-react'
import { RAG_METHODS } from '../services/ragService'
import {
    runEvaluation,
    aggregateResults,
    exportToCSV,
    loadCheckpoint,
    clearCheckpoint
} from '../services/evaluationService'
import questionsData from '../data/questions.json'

// ─── Sabitler ────────────────────────────────────────────────────────────────

const METHOD_IDS  = Object.keys(RAG_METHODS)
const SAFE_RPM    = 10   // Kullandığımız çağrı hızı (gerçek limit 30)
const CALLS_PER_STEP = 2 // RAG çağrısı + hakem çağrısı

function estimateDuration(stepsRemaining) {
    // Her adım: 6s (RAG delay) + 6s (judge delay) + ~3s işlem = ~15s
    const secPerStep = (6 + 6 + 3)
    const totalSec   = stepsRemaining * secPerStep
    if (totalSec < 60) return `${totalSec}s`
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return sec > 0 ? `${min}dk ${sec}s` : `${min}dk`
}

// ─── Bileşenler ───────────────────────────────────────────────────────────────

function ScoreCell({ value, max = 5 }) {
    if (value === 0 || value === undefined) return <span className="text-slate-500">—</span>
    const pct = value / max
    const color = pct >= 0.8 ? 'text-emerald-400'
                : pct >= 0.6 ? 'text-yellow-400'
                :              'text-red-400'
    return <span className={`font-mono font-semibold ${color}`}>{value.toFixed(2)}</span>
}

function LatencyCell({ ms }) {
    if (!ms) return <span className="text-slate-500">—</span>
    const color = ms < 2000  ? 'text-emerald-400'
                : ms < 6000  ? 'text-yellow-400'
                :              'text-red-400'
    const display = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
    return <span className={`font-mono ${color}`}>{display}</span>
}

function MethodBadge({ methodId }) {
    const m = RAG_METHODS[methodId]
    if (!m) return <span className="text-slate-400">{methodId}</span>
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-700 text-slate-200">
            <span>{m.icon}</span> {m.shortName}
        </span>
    )
}

// ─── Ana Bileşen ─────────────────────────────────────────────────────────────

export default function EvaluationPanel({ activeFiles }) {
    // Seçili yöntemler
    const [selectedMethods, setSelectedMethods] = useState(METHOD_IDS)

    // Değerlendirme durumu
    const [isRunning,  setIsRunning]  = useState(false)
    const [isDone,     setIsDone]     = useState(false)
    const [progress,   setProgress]   = useState(null)
    const [rawResults, setRawResults] = useState([])
    const [summary,    setSummary]    = useState([])

    // Checkpoint
    const [checkpoint, setCheckpoint] = useState(() => loadCheckpoint())
    const abortRef = useRef(null)

    // Aktif dosya kontrolü
    const activeFile = activeFiles?.[0]
    const hasActiveFile = !!activeFile

    // Sorular (tüm soru seti)
    const questions = questionsData

    // ─── Handlers ────────────────────────────────────────────────────────────

    const toggleMethod = (id) => {
        setSelectedMethods(prev =>
            prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
        )
    }

    const toggleAll = () => {
        setSelectedMethods(prev => prev.length === METHOD_IDS.length ? [] : [...METHOD_IDS])
    }

    const handleProgress = useCallback((p) => {
        setProgress(p)
        if (p.latestResult) {
            setRawResults(prev => {
                const next = [...prev, p.latestResult]
                setSummary(aggregateResults(next))
                return next
            })
        }
    }, [])

    const startEvaluation = async (resumeData = null) => {
        if (selectedMethods.length === 0) return
        if (!hasActiveFile) return

        const controller = new AbortController()
        abortRef.current = controller
        setIsRunning(true)
        setIsDone(false)

        if (!resumeData) {
            // Temiz başlangıç: sonuçları sıfırla
            setRawResults([])
            setSummary([])
            setProgress(null)
        }

        try {
            const result = await runEvaluation({
                questions,
                activeFiles,
                selectedMethods: resumeData
                    ? [...new Set(resumeData.results.map(r => r.method))]
                    : selectedMethods,
                onProgress: handleProgress,
                signal: controller.signal,
                resumeFrom: resumeData
            })

            if (!result.interrupted) {
                setIsDone(true)
                setCheckpoint(null)
                // Tam sonuçları göster
                setRawResults(result.results)
                setSummary(aggregateResults(result.results))
            } else {
                // Interrupted: checkpoint hali kayıtlı, kullanıcı devam edebilir
                const saved = loadCheckpoint()
                setCheckpoint(saved)
            }
        } catch (err) {
            console.error('[EvaluationPanel] Hata:', err)
        } finally {
            setIsRunning(false)
        }
    }

    const stopEvaluation = () => {
        abortRef.current?.abort()
    }

    const resetEvaluation = () => {
        clearCheckpoint()
        setCheckpoint(null)
        setRawResults([])
        setSummary([])
        setProgress(null)
        setIsDone(false)
    }

    const handleResume = () => {
        const cp = loadCheckpoint()
        if (cp) startEvaluation(cp)
    }

    // Unmount'ta iptal et
    useEffect(() => {
        return () => { abortRef.current?.abort() }
    }, [])

    // ─── Hesaplamalar ─────────────────────────────────────────────────────────

    const totalSteps     = selectedMethods.length * questions.length
    const completedSteps = progress?.step ?? 0
    const progressPct    = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
    const stepsRemaining = totalSteps - completedSteps
    const estimatedETA   = isRunning ? estimateDuration(stepsRemaining) : null

    // ─── Render ──────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full overflow-y-auto bg-slate-900 text-gray-100">
            <div className="max-w-6xl mx-auto w-full p-6 space-y-6 pb-16">

                {/* Başlık */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                            <BarChart3 className="w-6 h-6 text-violet-400" />
                            RAG Değerlendirme Paneli
                        </h1>
                        <p className="text-sm text-slate-400 mt-1">
                            {questions.length} soru • 6 yöntem • 5 metrik (LLM hakem + ROUGE-L + Latency)
                        </p>
                    </div>
                    {isDone && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-sm font-medium">
                            <CheckCircle2 className="w-4 h-4" />
                            Tamamlandı
                        </span>
                    )}
                </div>

                {/* Aktif Dosya Uyarısı */}
                {!hasActiveFile && (
                    <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10">
                        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-amber-300 font-medium text-sm">Aktif Belge Gerekli</p>
                            <p className="text-amber-400/70 text-xs mt-0.5">
                                Değerlendirmeyi başlatmadan önce sol panelden bir belgeyi aktif edin
                                (ör. <strong>TCMB-Faaliyet-Raporu-2024.pdf</strong>).
                            </p>
                        </div>
                    </div>
                )}

                {/* Checkpoint Bildirimi */}
                {checkpoint && !isRunning && (
                    <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-violet-500/30 bg-violet-500/10">
                        <div className="flex items-start gap-3">
                            <RotateCcw className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-violet-300 font-medium text-sm">Yarıda Bırakılmış Değerlendirme</p>
                                <p className="text-violet-400/70 text-xs mt-0.5">
                                    {checkpoint.results?.length ?? 0} adım tamamlanmış. Kaldığı yerden devam edebilirsiniz.
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                            <button
                                onClick={resetEvaluation}
                                className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-400 hover:bg-slate-700 transition-colors"
                            >
                                Sıfırla
                            </button>
                            <button
                                onClick={handleResume}
                                disabled={!hasActiveFile}
                                className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors disabled:opacity-50"
                            >
                                Devam Et
                            </button>
                        </div>
                    </div>
                )}

                {/* Yöntem Seçimi */}
                <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-yellow-400" />
                            Test Edilecek Yöntemler
                        </h2>
                        <button
                            onClick={toggleAll}
                            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
                        >
                            {selectedMethods.length === METHOD_IDS.length
                                ? <><CheckSquare className="w-3.5 h-3.5" /> Tüm seçimleri kaldır</>
                                : <><Square className="w-3.5 h-3.5" /> Tümünü seç</>
                            }
                        </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {METHOD_IDS.map(id => {
                            const m = RAG_METHODS[id]
                            const selected = selectedMethods.includes(id)
                            return (
                                <button
                                    key={id}
                                    onClick={() => toggleMethod(id)}
                                    disabled={isRunning}
                                    className={`
                                        flex items-center gap-2 p-3 rounded-lg border text-left text-sm
                                        transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed
                                        ${selected
                                            ? 'border-violet-500/60 bg-violet-500/15 text-white'
                                            : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600'
                                        }
                                    `}
                                >
                                    <span className="text-base">{m.icon}</span>
                                    <div className="min-w-0">
                                        <div className="font-medium truncate">{m.shortName}</div>
                                        <div className="text-xs text-slate-500 truncate">{m.badge}</div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Rate Limit Bilgi Kutusu */}
                <div className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-700/50 bg-slate-800/30 text-xs text-slate-400">
                    <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-slate-500" />
                    <span>
                        Her API çağrısı arasında <strong className="text-slate-300">6 saniye</strong> beklenir.{' '}
                        {selectedMethods.length} yöntem × {questions.length} soru ={' '}
                        <strong className="text-slate-300">
                            {estimateDuration(selectedMethods.length * questions.length)}
                        </strong> tahmini süre.
                        Rate limit'e hiçbir şekilde takılmaz.
                    </span>
                </div>

                {/* Kontrol Butonları */}
                <div className="flex items-center gap-3">
                    {!isRunning ? (
                        <button
                            onClick={() => startEvaluation(null)}
                            disabled={!hasActiveFile || selectedMethods.length === 0 || !!checkpoint}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600
                                       hover:from-violet-700 hover:to-indigo-700 text-white font-semibold text-sm
                                       transition-all shadow-lg shadow-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed
                                       hover:shadow-violet-500/30 hover:scale-[1.02] active:scale-[0.99]"
                        >
                            <PlayCircle className="w-4 h-4" />
                            Değerlendirmeyi Başlat
                        </button>
                    ) : (
                        <button
                            onClick={stopEvaluation}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700
                                       text-white font-semibold text-sm transition-all"
                        >
                            <StopCircle className="w-4 h-4" />
                            Durdur
                        </button>
                    )}

                    {rawResults.length > 0 && (
                        <button
                            onClick={() => exportToCSV(rawResults)}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600
                                       text-slate-300 text-sm hover:bg-slate-700 hover:text-white transition-colors"
                        >
                            <Download className="w-4 h-4" />
                            CSV İndir
                        </button>
                    )}

                    {(isDone || rawResults.length > 0) && !isRunning && (
                        <button
                            onClick={resetEvaluation}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700
                                       text-slate-500 text-sm hover:text-slate-300 hover:border-slate-600 transition-colors"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Sıfırla
                        </button>
                    )}
                </div>

                {/* İlerleme Göstergesi */}
                {(isRunning || (progress && !isDone)) && (
                    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 text-slate-300">
                                <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                                <span className="font-medium">
                                    {progress?.phase === 'rag'   && '⚙️ RAG çalışıyor...'}
                                    {progress?.phase === 'judge' && '⚖️ LLM hakem değerlendiriyor...'}
                                    {progress?.phase === 'done'  && '✅ Adım tamamlandı'}
                                </span>
                                {progress?.method && (
                                    <MethodBadge methodId={progress.method} />
                                )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400">
                                <span>{progress?.step ?? 0} / {totalSteps}</span>
                                {estimatedETA && (
                                    <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> ~{estimatedETA} kaldı
                                    </span>
                                )}
                            </div>
                        </div>
                        {/* Progress Bar */}
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-500"
                                style={{ width: `${progressPct}%` }}
                            />
                        </div>
                        {progress?.questionText && (
                            <p className="text-xs text-slate-500 truncate">
                                <strong className="text-slate-400">{progress.questionId}:</strong> {progress.questionText}
                            </p>
                        )}
                    </div>
                )}

                {/* Özet Tablo */}
                {summary.length > 0 && (
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-violet-400" />
                                Yöntem Bazlı Özet
                            </h2>
                            <span className="text-xs text-slate-500">{rawResults.length} sonuç işlendi</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700 text-xs text-slate-400">
                                        <th className="px-4 py-2.5 text-left">Yöntem</th>
                                        <th className="px-3 py-2.5 text-center">Bağlam Alaka</th>
                                        <th className="px-3 py-2.5 text-center">Sadakat</th>
                                        <th className="px-3 py-2.5 text-center">Cevap Alaka</th>
                                        <th className="px-3 py-2.5 text-center">ROUGE-L</th>
                                        <th className="px-3 py-2.5 text-center">Ort. Gecikme</th>
                                        <th className="px-3 py-2.5 text-center">Sorular</th>
                                        <th className="px-3 py-2.5 text-center">Hata</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.map((row, i) => (
                                        <tr
                                            key={row.method}
                                            className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${i % 2 === 0 ? 'bg-slate-800/20' : ''}`}
                                        >
                                            <td className="px-4 py-3">
                                                <MethodBadge methodId={row.method} />
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <ScoreCell value={row.avgContextRelevance} />
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <ScoreCell value={row.avgFaithfulness} />
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <ScoreCell value={row.avgAnswerRelevance} />
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <ScoreCell value={row.avgRougeL} max={1} />
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <LatencyCell ms={row.avgLatency} />
                                            </td>
                                            <td className="px-3 py-3 text-center text-slate-400">
                                                {row.questionCount}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                {row.errorCount > 0
                                                    ? <span className="text-red-400 font-mono">{row.errorCount}</span>
                                                    : <span className="text-emerald-400">0</span>
                                                }
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Ham Sonuçlar Tablosu */}
                {rawResults.length > 0 && (
                    <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-2">
                            <FileText className="w-4 h-4 text-slate-400" />
                            <h2 className="text-sm font-semibold text-slate-200">Ham Sonuçlar</h2>
                            <span className="ml-auto text-xs text-slate-500">{rawResults.length} kayıt</span>
                        </div>
                        <div className="overflow-x-auto max-h-96 overflow-y-auto">
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-800 z-10">
                                    <tr className="border-b border-slate-700 text-slate-400">
                                        <th className="px-3 py-2 text-left">Yöntem</th>
                                        <th className="px-3 py-2 text-left">Soru</th>
                                        <th className="px-2 py-2 text-center">B.Alaka</th>
                                        <th className="px-2 py-2 text-center">Sadakat</th>
                                        <th className="px-2 py-2 text-center">C.Alaka</th>
                                        <th className="px-2 py-2 text-center">ROUGEL</th>
                                        <th className="px-2 py-2 text-center">ms</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rawResults.map((r, i) => (
                                        <tr
                                            key={`${r.method}-${r.questionId}-${i}`}
                                            className={`border-b border-slate-700/40 hover:bg-slate-700/30 transition-colors ${r.error ? 'bg-red-900/10' : ''}`}
                                        >
                                            <td className="px-3 py-2">
                                                <MethodBadge methodId={r.method} />
                                            </td>
                                            <td className="px-3 py-2 text-slate-400 max-w-[300px]">
                                                <span className="font-mono text-slate-500 mr-1">{r.questionId}</span>
                                                <span className="truncate block max-w-[280px]" title={r.question}>
                                                    {r.question?.substring(0, 60)}...
                                                </span>
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <ScoreCell value={r.contextRelevance} />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <ScoreCell value={r.faithfulness} />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <ScoreCell value={r.answerRelevance} />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <ScoreCell value={r.rougeL} max={1} />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                                <LatencyCell ms={r.latency} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
