import { useState, useEffect, useRef } from 'react'
import { X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import mammoth from 'mammoth'

export default function DOCXViewer({ fileData, fileName, onClose }) {
    const [htmlContent, setHtmlContent] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [scale, setScale] = useState(1.0)

    // Drag-to-scroll state
    const [isDragging, setIsDragging] = useState(false)
    const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 })

    const containerRef = useRef(null)
    const contentRef = useRef(null)

    // Load and convert DOCX to HTML
    useEffect(() => {
        if (!fileData) return

        const loadDOCX = async () => {
            try {
                setLoading(true)
                setError(null)

                // Clone the ArrayBuffer to prevent detachment issues
                const clonedData = fileData.slice(0)

                // Convert DOCX to HTML using mammoth
                const result = await mammoth.convertToHtml({ arrayBuffer: clonedData })

                setHtmlContent(result.value)

                // Log any warnings from mammoth
                if (result.messages.length > 0) {
                    console.log('DOCX conversion messages:', result.messages)
                }

                setLoading(false)
            } catch (err) {
                console.error('DOCX yükleme hatası:', err)
                setError('DOCX dosyası yüklenemedi')
                setLoading(false)
            }
        }

        loadDOCX()
    }, [fileData])

    // Zoom handlers
    const handleZoomIn = () => {
        setScale(prev => Math.min(prev + 0.25, 3.0))
    }

    const handleZoomOut = () => {
        setScale(prev => Math.max(prev - 0.25, 0.5))
    }

    const handleFitToWidth = () => {
        if (containerRef.current && contentRef.current) {
            // Temporarily reset scale to get true content width
            const currentScale = scale
            setScale(1.0)

            // Wait for scale to apply, then calculate
            setTimeout(() => {
                if (containerRef.current && contentRef.current) {
                    const containerWidth = containerRef.current.clientWidth - 48 // padding
                    const contentWidth = contentRef.current.offsetWidth
                    const newScale = containerWidth / contentWidth
                    setScale(Math.min(Math.max(newScale, 0.5), 2.0)) // clamp between 0.5 and 2.0
                }
            }, 10)
        }
    }

    // Drag-to-scroll handlers
    const handleMouseDown = (e) => {
        if (!containerRef.current) return
        setIsDragging(true)
        setLastPosition({ x: e.clientX, y: e.clientY })
        containerRef.current.style.cursor = 'grabbing'
        e.preventDefault()
    }

    const handleMouseMove = (e) => {
        if (!isDragging || !containerRef.current) return

        const deltaX = e.clientX - lastPosition.x
        const deltaY = e.clientY - lastPosition.y

        containerRef.current.scrollLeft -= deltaX
        containerRef.current.scrollTop -= deltaY

        setLastPosition({ x: e.clientX, y: e.clientY })
    }

    const handleMouseUp = () => {
        setIsDragging(false)
        if (containerRef.current) {
            containerRef.current.style.cursor = 'grab'
        }
    }

    const handleMouseLeave = () => {
        if (isDragging) {
            setIsDragging(false)
            if (containerRef.current) {
                containerRef.current.style.cursor = 'grab'
            }
        }
    }

    if (error) {
        return (
            <div className="flex flex-col h-full bg-slate-900/95 backdrop-blur-sm border-l border-slate-700">
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <h3 className="text-lg font-semibold text-gray-200 truncate">{fileName}</h3>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-red-400">
                        <p>{error}</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-slate-900/95 backdrop-blur-sm border-l border-slate-700">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
                <h3 className="text-lg font-semibold text-gray-200 truncate pr-2">{fileName}</h3>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
                    title="Kapat"
                >
                    <X className="w-5 h-5 text-gray-400" />
                </button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center justify-center gap-2 p-3 bg-slate-800/50 border-b border-slate-700 flex-shrink-0">
                <button
                    onClick={handleZoomOut}
                    disabled={scale <= 0.5}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Uzaklaştır"
                >
                    <ZoomOut className="w-4 h-4 text-gray-400" />
                </button>

                <span className="text-sm text-gray-400 min-w-[3rem] text-center">
                    {Math.round(scale * 100)}%
                </span>

                <button
                    onClick={handleZoomIn}
                    disabled={scale >= 3.0}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Yakınlaştır"
                >
                    <ZoomIn className="w-4 h-4 text-gray-400" />
                </button>

                <button
                    onClick={handleFitToWidth}
                    className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Genişliğe sığdır"
                >
                    <Maximize2 className="w-4 h-4 text-gray-400" />
                </button>
            </div>

            {/* Document Content */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-auto p-6 bg-slate-800/30"
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            >
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-gray-400">Yükleniyor...</div>
                    </div>
                ) : (
                    <div
                        ref={contentRef}
                        className="bg-white p-8 rounded-lg shadow-2xl mx-auto transition-transform"
                        style={{
                            transform: `scale(${scale})`,
                            transformOrigin: 'top center',
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                            lineHeight: '1.6',
                            color: '#1f2937',
                            width: 'fit-content',
                            minWidth: '600px',
                            maxWidth: '900px',
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word'
                        }}
                        dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                )}
            </div>

            {/* Styling for mammoth-generated HTML */}
            <style>{`
                /* Prevent overflow */
                .bg-white {
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                }
                .bg-white * {
                    max-width: 100%;
                    word-wrap: break-word;
                }
                /* Style headings */
                .bg-white h1 {
                    font-size: 2em;
                    font-weight: bold;
                    margin-top: 1em;
                    margin-bottom: 0.5em;
                }
                .bg-white h2 {
                    font-size: 1.5em;
                    font-weight: bold;
                    margin-top: 0.8em;
                    margin-bottom: 0.4em;
                }
                .bg-white h3 {
                    font-size: 1.2em;
                    font-weight: bold;
                    margin-top: 0.6em;
                    margin-bottom: 0.3em;
                }
                .bg-white p {
                    margin-bottom: 1em;
                }
                .bg-white ul, .bg-white ol {
                    margin-left: 2em;
                    margin-bottom: 1em;
                }
                .bg-white li {
                    margin-bottom: 0.5em;
                }
                .bg-white strong {
                    font-weight: 600;
                }
                .bg-white em {
                    font-style: italic;
                }
                .bg-white table {
                    border-collapse: collapse;
                    width: 100%;
                    margin-bottom: 1em;
                }
                .bg-white td, .bg-white th {
                    border: 1px solid #d1d5db;
                    padding: 0.5em;
                }
                .bg-white th {
                    background-color: #f3f4f6;
                    font-weight: 600;
                }
            `}</style>
        </div>
    )
}
