import { useState, useEffect, useRef } from 'react'
import { Search, X, Filter } from 'lucide-react'
import FilterPanel from './FilterPanel'

export default function SearchBar({ onSearch, onClear, resultCount, filters, conversations, onFilterChange, onClearFilters, onFilterToggle }) {
    const [query, setQuery] = useState('')
    const [isExpanded, setIsExpanded] = useState(false)
    const [showFilters, setShowFilters] = useState(false)
    const inputRef = useRef(null)
    const filterRef = useRef(null)

    // Keyboard shortcut: Ctrl+K or Cmd+K to focus search
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault()
                setIsExpanded(true)
                setTimeout(() => inputRef.current?.focus(), 0)
            }

            // Escape to close and clear
            if (e.key === 'Escape' && isExpanded) {
                handleClear()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isExpanded])

    // Auto-expand if user starts typing
    const handleChange = (e) => {
        const value = e.target.value
        setQuery(value)

        if (value.trim()) {
            setIsExpanded(true)
            onSearch(value)
        } else {
            onClear()
        }
    }

    const handleClear = () => {
        setQuery('')
        setIsExpanded(false)
        setShowFilters(false)
        onClear()
        inputRef.current?.blur()
    }

    const handleFocus = () => {
        setIsExpanded(true)
    }

    // Calculate active filter count
    const activeFilterCount =
        (filters?.dateRange !== 'all' ? 1 : 0) +
        (filters?.conversationIds?.length > 0 ? 1 : 0) +
        (filters?.messageType !== 'all' ? 1 : 0)

    return (
        <div className={`relative transition-all duration-300 ${isExpanded ? 'w-80' : 'w-64'}`}>
            <div className="relative">
                {/* Search Icon */}
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

                {/* Input Field */}
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    onBlur={(e) => {
                        // Don't collapse if clicking on filter button or if there's a query
                        setTimeout(() => {
                            if (!query.trim() && !filterRef.current?.contains(document.activeElement)) {
                                setIsExpanded(false)
                            }
                        }, 150)
                    }}
                    placeholder="Ara..."
                    className="w-full pl-10 pr-20 py-2 bg-slate-800/50 border border-slate-700 
                               rounded-lg text-sm text-gray-200 placeholder-gray-500
                               focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500
                               transition-all"
                />

                {/* Result Count & Clear Button */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {query && resultCount !== undefined && resultCount > 0 && (
                        <span className="text-xs text-gray-400 px-2 py-0.5 bg-slate-700 rounded">
                            {resultCount} sonuç
                        </span>
                    )}

                    {/* Filter Button */}
                    <div className="relative" ref={filterRef}>
                        <button
                            onClick={() => {
                                const newState = !showFilters
                                setShowFilters(newState)
                                onFilterToggle?.(newState)
                            }}
                            className={`p-1 rounded transition-colors relative ${showFilters ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-slate-700 text-gray-400'
                                }`}
                            title="Filtreler"
                        >
                            <Filter className="w-4 h-4" />
                            {activeFilterCount > 0 && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary-500 text-white text-xs rounded-full flex items-center justify-center">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>

                        {/* Filter Panel */}
                        <FilterPanel
                            isOpen={showFilters}
                            filters={filters}
                            conversations={conversations || []}
                            onFilterChange={onFilterChange}
                            onClearFilters={onClearFilters}
                        />
                    </div>

                    {query && (
                        <button
                            onClick={handleClear}
                            className="p-1 hover:bg-slate-700 rounded transition-colors"
                            title="Temizle"
                        >
                            <X className="w-4 h-4 text-gray-400 hover:text-gray-200" />
                        </button>
                    )}
                </div>
            </div>


        </div>
    )
}
