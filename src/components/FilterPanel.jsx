import { useEffect, useRef } from 'react'
import { Calendar, MessageSquare, User } from 'lucide-react'

export default function FilterPanel({ filters, conversations, onFilterChange, onClearFilters, isOpen }) {
    const customDateRef = useRef(null)

    // Auto-scroll to custom date inputs when selected
    useEffect(() => {
        if (isOpen && filters.dateRange === 'custom' && customDateRef.current) {
            setTimeout(() => {
                customDateRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest'
                })
            }, 100)
        }
    }, [filters.dateRange, isOpen])

    if (!isOpen) return null

    const handleDateRangeChange = (range) => {
        onFilterChange({ ...filters, dateRange: range })
    }

    const handleConversationToggle = (convId) => {
        const newConvIds = filters.conversationIds.includes(convId)
            ? filters.conversationIds.filter(id => id !== convId)
            : [...filters.conversationIds, convId]
        onFilterChange({ ...filters, conversationIds: newConvIds })
    }

    const handleMessageTypeChange = (type) => {
        onFilterChange({ ...filters, messageType: type })
    }

    const activeFilterCount =
        (filters.dateRange !== 'all' ? 1 : 0) +
        (filters.conversationIds.length > 0 ? 1 : 0) +
        (filters.messageType !== 'all' ? 1 : 0)

    return (
        <div className="absolute right-0 top-full mt-2 w-80 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-[100] overflow-hidden max-h-[calc(100vh-120px)]">
            {/* Date Range Section */}
            <div className="p-4 border-b border-slate-700 max-h-[30vh] overflow-y-auto">
                <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-200">Tarih Aralığı</span>
                </div>
                <div className="space-y-2">
                    {[
                        { value: '7d', label: 'Son 7 gün' },
                        { value: '30d', label: 'Son 30 gün' },
                        { value: '90d', label: 'Son 90 gün' },
                        { value: 'custom', label: 'Özel tarih aralığı' },
                        { value: 'all', label: 'Tüm zamanlar' }
                    ].map(option => (
                        <label key={option.value} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-2 rounded transition-colors">
                            <input
                                type="radio"
                                name="dateRange"
                                value={option.value}
                                checked={filters.dateRange === option.value}
                                onChange={() => handleDateRangeChange(option.value)}
                                className="w-4 h-4 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-300">{option.label}</span>
                        </label>
                    ))}

                    {/* Custom Date Inputs */}
                    {filters.dateRange === 'custom' && (
                        <div ref={customDateRef} className="ml-6 mt-2 space-y-3 p-3 bg-slate-700/30 rounded border border-slate-600">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Başlangıç Tarihi</label>
                                <input
                                    type="date"
                                    value={filters.customDateFrom || ''}
                                    onChange={(e) => onFilterChange({
                                        ...filters,
                                        customDateFrom: e.target.value
                                    })}
                                    max={filters.customDateTo || new Date().toISOString().split('T')[0]}
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-gray-200 
                                             focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Bitiş Tarihi</label>
                                <input
                                    type="date"
                                    value={filters.customDateTo || ''}
                                    onChange={(e) => onFilterChange({
                                        ...filters,
                                        customDateTo: e.target.value
                                    })}
                                    min={filters.customDateFrom || ''}
                                    max={new Date().toISOString().split('T')[0]}
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-gray-200 
                                             focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Conversations Section */}
            <div className="p-4 border-b border-slate-700 max-h-[25vh] overflow-y-auto">
                <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-200">Konuşmalar</span>
                </div>
                <div className="space-y-2">
                    {conversations.length === 0 ? (
                        <p className="text-xs text-gray-500">Konuşma yok</p>
                    ) : (
                        conversations.map(conv => (
                            <label key={conv.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-2 rounded transition-colors">
                                <input
                                    type="checkbox"
                                    checked={filters.conversationIds.includes(conv.id)}
                                    onChange={() => handleConversationToggle(conv.id)}
                                    className="w-4 h-4 text-primary-500 rounded focus:ring-primary-500 focus:ring-offset-0"
                                />
                                <span className="text-sm text-gray-300 truncate flex-1">
                                    {conv.title || 'Başlıksız konuşma'}
                                </span>
                            </label>
                        ))
                    )}
                </div>
            </div>

            {/* Message Type Section */}
            <div className="p-4 border-b border-slate-700">
                <div className="flex items-center gap-2 mb-3">
                    <User className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-200">Mesaj Tipi</span>
                </div>
                <div className="space-y-2">
                    {[
                        { value: 'all', label: 'Tüm mesajlar' },
                        { value: 'user', label: 'Sadece kullanıcı' },
                        { value: 'ai', label: 'Sadece AI' }
                    ].map(option => (
                        <label key={option.value} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-2 rounded transition-colors">
                            <input
                                type="radio"
                                name="messageType"
                                value={option.value}
                                checked={filters.messageType === option.value}
                                onChange={() => handleMessageTypeChange(option.value)}
                                className="w-4 h-4 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
                            />
                            <span className="text-sm text-gray-300">{option.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            {/* Clear Filters Button */}
            {activeFilterCount > 0 && (
                <div className="p-4">
                    <button
                        onClick={onClearFilters}
                        className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 text-gray-200 rounded-lg transition-colors text-sm font-medium"
                    >
                        Filtreleri Temizle ({activeFilterCount})
                    </button>
                </div>
            )}
        </div>
    )
}
