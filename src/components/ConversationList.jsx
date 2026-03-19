import { useState } from 'react'
import { MessageSquare, Plus, Trash2, Edit2, Check, X, Search } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'

export default function ConversationList({
    conversations,
    activeId,
    onSelect,
    onDelete,
    onNew,
    onRename
}) {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [conversationToDelete, setConversationToDelete] = useState(null)
    const [editingId, setEditingId] = useState(null)
    const [editingTitle, setEditingTitle] = useState('')
    const [searchQuery, setSearchQuery] = useState('')

    const formatDate = (timestamp) => {
        const date = new Date(timestamp)
        const now = new Date()
        const diffMs = now - date
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return 'Az önce'
        if (diffMins < 60) return `${diffMins}dk önce`
        if (diffHours < 24) return `${diffHours}sa önce`
        if (diffDays < 7) return `${diffDays}g önce`
        return date.toLocaleDateString('tr-TR')
    }

    // Filter conversations based on search query
    const filteredConversations = conversations.filter(conv =>
        conv.title.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="flex flex-col h-full">
            {/* Header with New Chat button */}
            <div className="p-4 border-b border-slate-700">
                <button
                    onClick={onNew}
                    className="w-full bg-gradient-to-r from-primary-600 to-accent-600 hover:from-primary-700 hover:to-accent-700 text-white rounded-lg px-4 py-2.5 flex items-center justify-center gap-2 transition-all"
                >
                    <Plus className="w-5 h-5" />
                    <span className="font-medium">Yeni Sohbet</span>
                </button>
            </div>

            {/* Conversations Header with Search */}
            <div className="px-3 py-2 border-b border-slate-600">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                        Sohbetler ({conversations.length})
                    </h3>
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                        <input
                            type="text"
                            placeholder="Ara..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-slate-700/50 border border-slate-600 rounded-md pl-8 pr-2 py-1 text-xs text-gray-300 placeholder-gray-500 focus:outline-none focus:border-primary-500 transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* Conversation List */}
            <div className="flex-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                    <div className="p-4 text-center text-gray-500">
                        <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">
                            {searchQuery ? 'Sohbet bulunamadı' : 'Henüz sohbet yok'}
                        </p>
                        <p className="text-xs mt-1">
                            {searchQuery ? 'Farklı bir arama deneyin' : 'Başlamak için yeni sohbet oluşturun'}
                        </p>
                    </div>
                ) : (
                    <div className="p-2 space-y-1">
                        {filteredConversations.map((conv) => (
                            <div
                                key={conv.id}
                                className={`group relative rounded-lg p-3 ${editingId === conv.id ? '' : 'cursor-pointer'} transition-all ${activeId === conv.id
                                    ? 'bg-primary-600/20 border border-primary-500/50'
                                    : 'hover:bg-slate-700/50 border border-transparent'
                                    }`}
                                onClick={() => editingId !== conv.id && onSelect(conv.id)}
                            >
                                <div className="flex items-start gap-2">
                                    <MessageSquare className={`w-4 h-4 mt-0.5 flex-shrink-0 ${activeId === conv.id ? 'text-primary-400' : 'text-gray-500'
                                        }`} />

                                    <div className="flex-1 min-w-0">
                                        {editingId === conv.id ? (
                                            <div className="flex items-center gap-1 mb-1">
                                                <input
                                                    type="text"
                                                    value={editingTitle}
                                                    onChange={(e) => setEditingTitle(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="flex-1 text-sm font-medium bg-slate-700 text-gray-200 
                                                               px-2 py-1 rounded border border-primary-500/50 focus:outline-none 
                                                               focus:border-primary-500"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            onRename(conv.id, editingTitle)
                                                            setEditingId(null)
                                                        } else if (e.key === 'Escape') {
                                                            setEditingId(null)
                                                        }
                                                    }}
                                                />
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        onRename(conv.id, editingTitle)
                                                        setEditingId(null)
                                                    }}
                                                    className="p-1 hover:bg-green-500/20 rounded"
                                                    title="Kaydet"
                                                >
                                                    <Check className="w-3.5 h-3.5 text-green-400" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setEditingId(null)
                                                    }}
                                                    className="p-1 hover:bg-red-500/20 rounded"
                                                    title="İptal"
                                                >
                                                    <X className="w-3.5 h-3.5 text-red-400" />
                                                </button>
                                            </div>
                                        ) : (
                                            <p className={`text-sm font-medium truncate ${activeId === conv.id ? 'text-gray-200' : 'text-gray-300'
                                                }`}>
                                                {conv.title}
                                            </p>
                                        )}
                                        <div className="flex items-center gap-2 mt-1">
                                            <p className="text-xs text-gray-500">
                                                {formatDate(conv.updatedAt)}
                                            </p>
                                            <span className="text-xs text-gray-600">•</span>
                                            <p className="text-xs text-gray-500">
                                                {conv.messages.length} mesaj
                                            </p>
                                        </div>
                                    </div>

                                    {editingId !== conv.id && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setEditingId(conv.id)
                                                    setEditingTitle(conv.title)
                                                }}
                                                className="p-1 hover:bg-primary-500/20 rounded"
                                                title="Başlığı düzenle"
                                            >
                                                <Edit2 className="w-4 h-4 text-gray-400 hover:text-primary-400" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setConversationToDelete(conv.id)
                                                    setDeleteDialogOpen(true)
                                                }}
                                                className="p-1 hover:bg-red-500/20 rounded"
                                                title="Sohbeti sil"
                                            >
                                                <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Confirmation Dialog */}
            <ConfirmDialog
                isOpen={deleteDialogOpen}
                title="Sohbeti Sil"
                message="Bu sohbeti silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
                onConfirm={() => {
                    if (conversationToDelete) {
                        onDelete(conversationToDelete)
                    }
                    setDeleteDialogOpen(false)
                    setConversationToDelete(null)
                }}
                onCancel={() => {
                    setDeleteDialogOpen(false)
                    setConversationToDelete(null)
                }}
            />
        </div>
    )
}
