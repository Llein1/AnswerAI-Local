import { useState } from 'react'
import { ChevronDown, ChevronUp, FileText } from 'lucide-react'

export default function SourceReferences({ sources, onPageClick }) {
    const [expanded, setExpanded] = useState(false)

    if (!sources || sources.length === 0) return null

    // Helper to get match quality label and color
    const getMatchQuality = (similarity) => {
        if (similarity >= 0.7) return { label: 'Yüksek Eşleşme', color: 'text-green-400', bg: 'bg-green-500/20' }
        if (similarity >= 0.5) return { label: 'Orta Eşleşme', color: 'text-yellow-400', bg: 'bg-yellow-500/20' }
        return { label: 'Düşük Eşleşme', color: 'text-orange-400', bg: 'bg-orange-500/20' }
    }

    // Helper to format page numbers
    const formatPageNumbers = (pageNumbers) => {
        if (!pageNumbers || pageNumbers.length === 0) return null

        if (pageNumbers.length === 1) {
            return `Sayfa ${pageNumbers[0]}`
        }

        // Sort and remove duplicates
        const uniquePages = [...new Set(pageNumbers)].sort((a, b) => a - b)

        if (uniquePages.length === 2 && uniquePages[1] === uniquePages[0] + 1) {
            // Consecutive pages
            return `Sayfa ${uniquePages[0]}-${uniquePages[1]}`
        }

        // Multiple pages
        return `Sayfa ${uniquePages.join(', ')}`
    }

    return (
        <div className="mt-3 pt-3 border-t border-slate-700">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
            >
                <FileText className="w-4 h-4" />
                <span>
                    {sources.length} kaynak kullanıldı
                </span>
                {expanded ? (
                    <ChevronUp className="w-4 h-4" />
                ) : (
                    <ChevronDown className="w-4 h-4" />
                )}
            </button>

            {expanded && (
                <div className="mt-2 space-y-2">
                    {sources.map((source, index) => {
                        const quality = getMatchQuality(source.similarity)
                        const pageInfo = formatPageNumbers(source.pageNumbers)

                        return (
                            <div
                                key={index}
                                className="bg-slate-700/30 rounded-md p-3 text-sm"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium text-gray-300 flex items-center gap-2">
                                        <FileText className="w-3.5 h-3.5" />
                                        {source.fileName}
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${quality.bg} ${quality.color}`}>
                                        {quality.label}
                                    </span>
                                </div>
                                {pageInfo && (
                                    <div className="text-xs text-gray-400">
                                        {onPageClick && source.pageNumbers && source.pageNumbers.length > 0 ? (
                                            <button
                                                onClick={() => onPageClick(source.fileName, source.pageNumbers[0])}
                                                className="hover:text-primary-400 hover:underline transition-colors"
                                                title="Bu sayfayı önizle"
                                            >
                                                {pageInfo}
                                            </button>
                                        ) : (
                                            pageInfo
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
