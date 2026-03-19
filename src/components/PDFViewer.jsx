import { useState, useEffect, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

export default function PDFViewer({ fileData, fileName, initialPage = 1, onClose }) {
    const [currentPage, setCurrentPage] = useState(initialPage)
    const [numPages, setNumPages] = useState(0)
    const [scale, setScale] = useState(1.0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [pdfDoc, setPdfDoc] = useState(null)

    // Drag-to-scroll state
    const [isDragging, setIsDragging] = useState(false)
    const [lastPosition, setLastPosition] = useState({ x: 0, y: 0 })

    const canvasRef = useRef(null)
    const containerRef = useRef(null)

    // Load PDF document
    useEffect(() => {
        if (!fileData) return

        const loadPDF = async () => {
            try {
                setLoading(true)
                setError(null)

                // Clone the ArrayBuffer to prevent detachment issues with PDF.js worker
                const clonedData = fileData.slice(0)

                const loadingTask = pdfjsLib.getDocument({ data: clonedData })
                const pdf = await loadingTask.promise

                setPdfDoc(pdf)
                setNumPages(pdf.numPages)
                setLoading(false)
            } catch (err) {
                console.error('PDF yükleme hatası:', err)
                setError('PDF yüklenemedi')
                setLoading(false)
            }
        }

        loadPDF()
    }, [fileData])

    // Render current page
    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return

        let renderTask = null

        const renderPage = async () => {
            try {
                setLoading(true)

                const page = await pdfDoc.getPage(currentPage)
                const canvas = canvasRef.current
                const context = canvas.getContext('2d')

                const viewport = page.getViewport({ scale })

                canvas.height = viewport.height
                canvas.width = viewport.width

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                }

                renderTask = page.render(renderContext)
                await renderTask.promise
                setLoading(false)
            } catch (err) {
                // Ignore cancellation errors
                if (err.name === 'RenderingCancelledException') {
                    console.log('Render cancelled (expected)')
                } else {
                    console.error('Sayfa render hatası:', err)
                    setError('Sayfa görüntülenemedi')
                    setLoading(false)
                }
            }
        }

        renderPage()

        // Cleanup: cancel ongoing render when dependencies change
        return () => {
            if (renderTask) {
                renderTask.cancel()
            }
        }
    }, [pdfDoc, currentPage, scale])

    // Navigate to specific page (when initialPage changes)
    useEffect(() => {
        if (initialPage && initialPage !== currentPage && initialPage <= numPages) {
            setCurrentPage(initialPage)
        }
    }, [initialPage, numPages])

    const handlePrevPage = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1)
        }
    }

    const handleNextPage = () => {
        if (currentPage < numPages) {
            setCurrentPage(currentPage + 1)
        }
    }

    const handleZoomIn = () => {
        setScale(prev => Math.min(prev + 0.25, 3.0))
    }

    const handleZoomOut = () => {
        setScale(prev => Math.max(prev - 0.25, 0.5))
    }

    const handleFitToWidth = () => {
        if (containerRef.current && canvasRef.current) {
            const containerWidth = containerRef.current.clientWidth - 32 // padding
            const canvasWidth = canvasRef.current.width / scale
            const newScale = containerWidth / canvasWidth
            setScale(Math.min(newScale, 2.0))
        }
    }

    const handlePageInput = (e) => {
        const pageNum = parseInt(e.target.value)
        if (pageNum >= 1 && pageNum <= numPages) {
            setCurrentPage(pageNum)
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

            {/* Controls */}
            <div className="flex items-center justify-between gap-4 p-3 bg-slate-800/50 border-b border-slate-700 flex-shrink-0">
                {/* Page Navigation */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={handlePrevPage}
                        disabled={currentPage === 1}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Önceki sayfa"
                    >
                        <ChevronLeft className="w-4 h-4 text-gray-400" />
                    </button>

                    <div className="flex items-center gap-1 text-sm">
                        <input
                            type="number"
                            min="1"
                            max={numPages}
                            value={currentPage}
                            onChange={handlePageInput}
                            className="w-12 px-2 py-1 bg-slate-700 text-gray-200 rounded text-center border border-slate-600 focus:outline-none focus:border-primary-500"
                        />
                        <span className="text-gray-400">/ {numPages}</span>
                    </div>

                    <button
                        onClick={handleNextPage}
                        disabled={currentPage === numPages}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Sonraki sayfa"
                    >
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                    </button>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-2">
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
            </div>

            {/* PDF Canvas */}
            <div
                ref={containerRef}
                className="flex-1 min-h-0 overflow-auto p-4 bg-slate-800/30"
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
            >
                {loading && (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-gray-400">Yükleniyor...</div>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    className="shadow-2xl"
                    style={{ display: loading ? 'none' : 'block' }}
                />
            </div>
        </div>
    )
}
