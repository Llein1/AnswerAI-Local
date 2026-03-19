import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'

export default function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel }) {
    if (!isOpen) return null

    return createPortal(
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fadeIn"
                onClick={onCancel}
            >
                {/* Modal */}
                <div
                    className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl max-w-md w-full p-6 animate-scaleIn"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Icon and Title */}
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center">
                            <AlertTriangle className="w-6 h-6 text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
                        </div>
                    </div>

                    {/* Message */}
                    <p className="text-gray-400 mb-6">{message}</p>

                    {/* Action Buttons */}
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-gray-300 transition-colors"
                        >
                            İptal
                        </button>
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
                        >
                            Sil
                        </button>
                    </div>
                </div>
            </div>
        </>,
        document.body
    )
}
