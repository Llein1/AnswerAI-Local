import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, RotateCcw, Save, Settings as SettingsIcon, Wifi, WifiOff, Terminal } from 'lucide-react'
import { validateApiKey, validateSettings } from '../services/settingsStorage'
import { checkHealth } from '../services/chromaDBService'

export default function Settings({ isOpen, currentSettings, onSave, onClose }) {
    const [settings, setSettings] = useState(currentSettings)
    const [showApiKey, setShowApiKey] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [chromaStatus, setChromaStatus] = useState(null) // null | 'checking' | 'ok' | 'error'
    const [chromaError, setChromaError] = useState('')
    const [showSetupGuide, setShowSetupGuide] = useState(false)

    // Update local state when currentSettings changes
    useEffect(() => {
        setSettings(currentSettings)
        setHasChanges(false)
    }, [currentSettings])

    // Check if settings have changed
    useEffect(() => {
        const changed = JSON.stringify(settings) !== JSON.stringify(currentSettings)
        setHasChanges(changed)
    }, [settings, currentSettings])

    // ESC key to close
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape' && isOpen && !showResetConfirm) {
                onClose()
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [isOpen, showResetConfirm, onClose])

    if (!isOpen) return null

    const handleChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }))
    }

    const handleSave = () => {
        const validation = validateSettings(settings)
        if (!validation.valid) {
            alert('Geçersiz ayarlar:\n' + validation.errors.join('\n'))
            return
        }
        onSave(settings)
    }

    const handleReset = () => {
        setShowResetConfirm(true)
    }

    const confirmReset = () => {
        setSettings({
            ...currentSettings,
            chunkSize: 1000,
            topK: 4,
            temperature: 0.7,
            model: 'gemini-2.0-flash-exp',
            chromaDBUrl: 'http://localhost:8000'
            // API key is preserved
        })
        setShowResetConfirm(false)
    }

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose()
        }
    }

    const handleTestChroma = async () => {
        setChromaStatus('checking')
        setChromaError('')
        try {
            // Use Vite's proxy (/chroma) to avoid CORS issues
            const response = await fetch('/chroma/api/v2/heartbeat', {
                signal: AbortSignal.timeout(5000)
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            setChromaStatus('ok')
        } catch (err) {
            setChromaStatus('error')
            setChromaError(err.message)
        }
    }

    const isApiKeyValid = validateApiKey(settings.apiKey)
    const chunkSizeChanged = settings.chunkSize !== currentSettings.chunkSize

    const setupCommands = [
        { label: 'pip kurulumu', cmd: 'pip install chromadb' },
        { label: 'sunucu başlatma', cmd: 'chroma run --host localhost --port 8000' },
    ]

    return (
        <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-primary-500 to-accent-600 rounded-lg">
                            <SettingsIcon className="w-5 h-5 text-white" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-100">Ayarlar</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                        title="Kapat (Esc)"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* API Key Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-gray-200">Gemini API Anahtarı</h3>
                            {isApiKeyValid && (
                                <span className="text-xs text-green-400 bg-green-500/20 px-2 py-0.5 rounded">✓ Geçerli</span>
                            )}
                        </div>
                        <div className="relative">
                            <input
                                type={showApiKey ? 'text' : 'password'}
                                value={settings.apiKey}
                                onChange={(e) => handleChange('apiKey', e.target.value)}
                                placeholder="AIzaSy..."
                                className="w-full px-4 py-3 pr-12 bg-slate-900 border border-slate-600 rounded-lg text-gray-200
                                         placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                            />
                            <button
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-700 rounded transition-colors"
                                title={showApiKey ? 'Gizle' : 'Göster'}
                            >
                                {showApiKey ? (
                                    <EyeOff className="w-5 h-5 text-gray-400" />
                                ) : (
                                    <Eye className="w-5 h-5 text-gray-400" />
                                )}
                            </button>
                        </div>
                        <p className="text-sm text-gray-400">
                            API anahtarınızı{' '}
                            <a
                                href="https://aistudio.google.com/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-400 hover:text-primary-300 underline"
                            >
                                Google AI Studio
                            </a>
                            {' '}adresinden alabilirsiniz.
                        </p>
                    </div>

                    {/* ChromaDB Section */}
                    <div className="space-y-4 pt-4 border-t border-slate-700">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-gray-200">ChromaDB Vektör Veritabanı</h3>
                            <button
                                onClick={() => setShowSetupGuide(v => !v)}
                                className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors"
                            >
                                <Terminal className="w-3.5 h-3.5" />
                                {showSetupGuide ? 'Kılavuzu Gizle' : 'Kurulum Kılavuzu'}
                            </button>
                        </div>

                        {/* Setup Guide */}
                        {showSetupGuide && (
                            <div className="bg-slate-900/70 border border-slate-600 rounded-lg p-4 space-y-3">
                                <p className="text-sm text-gray-300 font-medium">📦 ChromaDB Kurulumu (bir kez yapılır)</p>
                                <p className="text-xs text-gray-400">
                                    Python 3.8+ gereklidir. Terminale sırasıyla şu komutları çalıştırın:
                                </p>
                                <div className="space-y-2">
                                    {setupCommands.map((item, i) => (
                                        <div key={i} className="space-y-0.5">
                                            <p className="text-xs text-gray-500">{i + 1}. {item.label}:</p>
                                            <div className="flex items-center gap-2 bg-slate-950 rounded px-3 py-2">
                                                <code className="flex-1 text-xs text-green-400 font-mono">{item.cmd}</code>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(item.cmd)}
                                                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors shrink-0"
                                                    title="Kopyala"
                                                >
                                                    📋
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-start gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-300">
                                    <span className="shrink-0">⚠️</span>
                                    <span>Uygulamayı her kullandığınızda 2. komutu (sunucu başlatma) çalıştırmanız gerekir.</span>
                                </div>
                            </div>
                        )}

                        {/* URL Input */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Sunucu URL</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={settings.chromaDBUrl || 'http://localhost:8000'}
                                    onChange={(e) => handleChange('chromaDBUrl', e.target.value)}
                                    placeholder="http://localhost:8000"
                                    className="flex-1 px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-gray-200
                                             placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500
                                             font-mono text-sm"
                                />
                                <button
                                    onClick={handleTestChroma}
                                    disabled={chromaStatus === 'checking'}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600
                                             text-gray-200 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                                >
                                    {chromaStatus === 'checking' ? (
                                        <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                    ) : chromaStatus === 'ok' ? (
                                        <Wifi className="w-4 h-4 text-green-400" />
                                    ) : chromaStatus === 'error' ? (
                                        <WifiOff className="w-4 h-4 text-red-400" />
                                    ) : (
                                        <Wifi className="w-4 h-4 text-gray-400" />
                                    )}
                                    Test Et
                                </button>
                            </div>

                            {/* Connection Status */}
                            {chromaStatus === 'ok' && (
                                <div className="flex items-center gap-2 text-sm text-green-400">
                                    <span>✅</span>
                                    <span>ChromaDB bağlantısı başarılı</span>
                                </div>
                            )}
                            {chromaStatus === 'error' && (
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-sm text-red-400">
                                        <span>❌</span>
                                        <span>Bağlantı kurulamadı: {chromaError}</span>
                                    </div>
                                    <p className="text-xs text-gray-400 ml-6">
                                        Kurulum kılavuzunu açarak ChromaDB'yi başlatın.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RAG Parameters Section */}
                    <div className="space-y-4 pt-4 border-t border-slate-700">
                        <h3 className="text-lg font-semibold text-gray-200">RAG Parametreleri</h3>

                        {/* Chunk Size */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-300">Chunk Boyutu</label>
                                <span className="text-sm text-gray-400">
                                    {settings.chunkSize} karakter (~{Math.round(settings.chunkSize / 5)} kelime)
                                </span>
                            </div>
                            <input
                                type="range"
                                min="500"
                                max="2000"
                                step="100"
                                value={settings.chunkSize}
                                onChange={(e) => handleChange('chunkSize', parseInt(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                         [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full
                                         [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:bg-primary-400"
                            />
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>500</span>
                                <span>1000 (önerilen)</span>
                                <span>2000</span>
                            </div>
                            {chunkSizeChanged && (
                                <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                    <span className="text-amber-400 text-xs mt-0.5">⚠️</span>
                                    <p className="text-xs text-amber-300">
                                        Chunk boyutu değişti. En iyi sonuçlar için dosyalarınızı yeniden yükleyin.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Top-K */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-300">Top-K (Chunk Sayısı)</label>
                                <span className="text-sm text-gray-400">{settings.topK} chunk</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="10"
                                step="1"
                                value={settings.topK}
                                onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                         [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full
                                         [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:bg-primary-400"
                            />
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>1 (hızlı)</span>
                                <span>4 (önerilen)</span>
                                <span>10 (kapsamlı)</span>
                            </div>
                        </div>

                        {/* Temperature */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-300">Temperature</label>
                                <span className="text-sm text-gray-400">{settings.temperature.toFixed(1)}</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={settings.temperature}
                                onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                                         [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full
                                         [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:hover:bg-primary-400"
                            />
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>0.0 (kesin)</span>
                                <span>0.7 (önerilen)</span>
                                <span>1.0 (yaratıcı)</span>
                            </div>
                        </div>

                        {/* Model Selection */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-300">Model</label>
                            <select
                                value={settings.model}
                                onChange={(e) => handleChange('model', e.target.value)}
                                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-gray-200
                                         focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                            >
                                <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (Yeni - Hızlı)</option>
                                <option value="gemini-3-flash-preview">Gemini 3 Flash (Dengeli ve Hızlı)</option>
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                                <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (Ekonomik)</option>
                                <option value="gemma-3-27b-it">Gemma 3 27B (En Ekonomik)</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700 bg-slate-900/50">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 text-gray-400 hover:text-gray-200 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Varsayılana Dön
                    </button>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-gray-200 rounded-lg transition-colors"
                        >
                            İptal
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!hasChanges}
                            className="flex items-center gap-2 px-6 py-2 bg-gradient-to-br from-primary-500 to-accent-600
                                     hover:from-primary-600 hover:to-accent-700 text-white rounded-lg transition-all
                                     disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Save className="w-4 h-4" />
                            Kaydet
                        </button>
                    </div>
                </div>

                {/* Reset Confirmation Dialog */}
                {showResetConfirm && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
                        <div className="bg-slate-800 rounded-lg border border-slate-700 p-6 max-w-md">
                            <h3 className="text-lg font-semibold text-gray-200 mb-2">Varsayılana Dön?</h3>
                            <p className="text-sm text-gray-400 mb-4">
                                Tüm ayarlar varsayılan değerlere döndürülecek. API anahtarınız korunacak.
                            </p>
                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={() => setShowResetConfirm(false)}
                                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-200 rounded-lg transition-colors"
                                >
                                    İptal
                                </button>
                                <button
                                    onClick={confirmReset}
                                    className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
                                >
                                    Sıfırla
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
