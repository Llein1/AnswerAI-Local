import { useState } from 'react'
import { FileText, Trash2, Eye, EyeOff, ExternalLink, Search } from 'lucide-react'
import ConfirmDialog from './ConfirmDialog'
import { getFileTypeLabel } from '../services/fileProcessingService'

export default function FileList({ files, onDelete, onToggle, onPreview, processingFiles = new Set() }) {
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [fileToDelete, setFileToDelete] = useState(null)
    const [searchQuery, setSearchQuery] = useState('')

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B'
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    }

    // Filter files based on search query
    const filteredFiles = files.filter(file =>
        file.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    if (files.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <div className="text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Henüz dosya yüklenmedi</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Sticky Header */}
            <div className="px-3 py-2 border-b border-slate-600 bg-slate-800/95 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                        Dosyalar ({files.length})
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
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3">
                {filteredFiles.length === 0 ? (
                    <div className="p-4 text-center text-gray-500">
                        <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Dosya bulunamadı</p>
                        <p className="text-xs mt-1">Farklı bir arama deneyin</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {filteredFiles.map((file) => (
                            <div
                                key={file.id}
                                className={`
              p-3 rounded-lg border transition-all animate-slideIn
              ${file.active
                                        ? 'bg-slate-700/50 border-primary-500/50'
                                        : 'bg-slate-800/30 border-slate-700'
                                    }
            `}
                            >
                                <div className="flex items-start gap-2">
                                    <FileText className={`w-5 h-5 flex-shrink-0 mt-0.5 ${file.active ? 'text-primary-400' : 'text-gray-500'}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className={`text-sm font-medium truncate ${file.active ? 'text-gray-200' : 'text-gray-400'}`}>
                                                {file.name}
                                            </p>
                                            {/* File Type Badge */}
                                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${getFileTypeLabel(file.name) === 'PDF' ? 'bg-red-500/20 text-red-300' :
                                                getFileTypeLabel(file.name) === 'DOCX' ? 'bg-blue-500/20 text-blue-300' :
                                                    'bg-gray-500/20 text-gray-300'
                                                }`}>
                                                {getFileTypeLabel(file.name)}
                                            </span>
                                            {/* Processing indicator */}
                                            {processingFiles.has(file.id) && (
                                                <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 flex-shrink-0 animate-pulse">
                                                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                                                    </svg>
                                                    İşleniyor
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {formatFileSize(file.size)}
                                            {file.pageCount && ` · ${file.pageCount} sayfa`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {onPreview && (
                                            <button
                                                onClick={() => onPreview(file.id)}
                                                className="p-1 hover:bg-primary-500/20 rounded transition-colors"
                                                title="Belgeyi önizle"
                                            >
                                                <ExternalLink className="w-4 h-4 text-primary-400" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => onToggle(file.id)}
                                            className="p-1 hover:bg-slate-600 rounded transition-colors"
                                            title={file.active ? 'Pasifleştir' : 'Aktifleştir'}
                                        >
                                            {file.active ? (
                                                <Eye className="w-4 h-4 text-primary-400" />
                                            ) : (
                                                <EyeOff className="w-4 h-4 text-gray-500" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => {
                                                setFileToDelete(file.id)
                                                setDeleteDialogOpen(true)
                                            }}
                                            className="p-1 hover:bg-red-500/20 rounded transition-colors"
                                            title="Dosyayı sil"
                                        >
                                            <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-400" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Delete Confirmation Dialog */}
                <ConfirmDialog
                    isOpen={deleteDialogOpen}
                    title="Dosyayı Sil"
                    message="Bu dosyayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
                    onConfirm={() => {
                        if (fileToDelete) {
                            onDelete(fileToDelete)
                        }
                        setDeleteDialogOpen(false)
                        setFileToDelete(null)
                    }}
                    onCancel={() => {
                        setDeleteDialogOpen(false)
                        setFileToDelete(null)
                    }}
                />
            </div>
        </div>
    )
}
