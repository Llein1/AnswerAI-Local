import { MessageSquare, Calendar } from 'lucide-react'
import { highlightMatches } from '../services/searchService'

export default function SearchResults({ results, query, onSelectResult, selectedIndex }) {
    if (!query || query.trim() === '') {
        return null
    }

    if (results.length === 0) {
        return (
            <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 
                            rounded-lg shadow-xl z-50 p-8 text-center">
                <div className="text-gray-400">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Sonuç bulunamadı</p>
                    <p className="text-xs text-gray-500 mt-1">
                        Farklı anahtar kelimeler deneyin
                    </p>
                </div>
            </div>
        )
    }

    // Group results by conversation
    const groupedResults = results.reduce((acc, result) => {
        const convId = result.conversationId
        if (!acc[convId]) {
            acc[convId] = {
                title: result.conversationTitle,
                results: []
            }
        }
        acc[convId].results.push(result)
        return acc
    }, {})

    return (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 
                        rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
            {Object.entries(groupedResults).map(([convId, group], groupIdx) => (
                <div key={convId} className={groupIdx > 0 ? 'border-t border-slate-700' : ''}>
                    {/* Conversation Header */}
                    <div className="px-4 py-2 bg-slate-700/50 text-xs text-gray-400 font-medium sticky top-0">
                        {group.title}
                    </div>

                    {/* Results for this conversation */}
                    {group.results.map((result, resultIdx) => {
                        const globalIdx = results.indexOf(result)
                        const isSelected = globalIdx === selectedIndex

                        return (
                            <button
                                key={`${result.conversationId}-${result.messageIndex}`}
                                onClick={() => onSelectResult(result)}
                                className={`w-full px-4 py-3 text-left hover:bg-slate-700/50 
                                           transition-colors border-l-2 ${isSelected
                                        ? 'border-primary-500 bg-slate-700/50'
                                        : 'border-transparent'
                                    }`}
                            >
                                {/* Message Role Badge */}
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs px-2 py-0.5 rounded ${result.message.role === 'user'
                                            ? 'bg-blue-500/20 text-blue-300'
                                            : 'bg-purple-500/20 text-purple-300'
                                        }`}>
                                        {result.message.role === 'user' ? 'Siz' : 'AI'}
                                    </span>

                                    {/* Timestamp */}
                                    <span className="text-xs text-gray-500 flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {new Date(result.timestamp).toLocaleDateString('tr-TR')}
                                    </span>

                                    {/* Match Count */}
                                    {result.matchCount > 1 && (
                                        <span className="text-xs text-primary-400">
                                            {result.matchCount} eşleşme
                                        </span>
                                    )}
                                </div>

                                {/* Message Preview with Highlighting */}
                                <div
                                    className="text-sm text-gray-300 line-clamp-2"
                                    dangerouslySetInnerHTML={{
                                        __html: highlightMatches(result.preview, query)
                                    }}
                                />
                            </button>
                        )
                    })}
                </div>
            ))}

            {/* Keyboard Navigation Hint */}
            <div className="px-4 py-2 bg-slate-700/30 border-t border-slate-700 text-xs text-gray-500 text-center">
                ↑↓ Gezin • Enter Seç • Esc Kapat
            </div>
        </div>
    )
}
