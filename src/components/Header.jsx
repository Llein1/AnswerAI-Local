import { Sparkles, Trash2, Settings } from 'lucide-react'
import SearchBar from './SearchBar'

export default function Header({ onClearChat, messageCount, onSearch, onClearSearch, searchResultCount, searchFilters, conversations, onFilterChange, onClearFilters, onFilterToggle, onOpenSettings }) {
    return (
        <header className="bg-slate-800/80 backdrop-blur-sm border-b border-slate-700 px-6 py-2">
            <div className="flex items-center justify-between gap-6">
                {/* Left: Logo & Title */}
                <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="bg-gradient-to-br from-primary-500 to-accent-600 p-2 rounded-lg">
                        <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-400 to-accent-400 bg-clip-text text-transparent">
                            AnswerAI
                        </h1>
                        <p className="text-sm text-gray-400">RAG Destekli Doküman Asistanı</p>
                    </div>
                </div>

                {/* Center: Search Bar - Always visible */}
                <div className="flex-1 max-w-xl mx-auto hidden md:block">
                    <SearchBar
                        onSearch={onSearch}
                        onClear={onClearSearch}
                        resultCount={searchResultCount}
                        filters={searchFilters}
                        conversations={conversations}
                        onFilterChange={onFilterChange}
                        onClearFilters={onClearFilters}
                        onFilterToggle={onFilterToggle}
                    />
                </div>

                {/* Settings Button */}
                <button
                    onClick={onOpenSettings}
                    className="flex-shrink-0 p-2 hover:bg-slate-700 rounded-lg transition-colors"
                    title="Ayarlar"
                >
                    <Settings className="w-5 h-5 text-gray-400 hover:text-gray-200" />
                </button>

                {/* Right: Clear Chat Button - Conditional with smooth transition */}
                <div
                    className="flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden"
                    style={{
                        width: messageCount > 0 ? '180px' : '0px',
                        opacity: messageCount > 0 ? 1 : 0
                    }}
                >
                    <button
                        onClick={onClearChat}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-lg transition-colors whitespace-nowrap"
                        disabled={messageCount === 0}
                    >
                        <Trash2 className="w-4 h-4" />
                        Sohbeti Temizle
                    </button>
                </div>
            </div>
        </header>
    )
}
