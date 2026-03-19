import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'

export default function ChatInput({ onSendMessage, disabled }) {
    const [input, setInput] = useState('')
    const textareaRef = useRef(null)

    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current
        if (textarea) {
            // Reset height to auto to get the correct scrollHeight
            textarea.style.height = 'auto'
            // Set height based on scrollHeight, max 4 lines (approx 96px)
            const maxHeight = 96 // 4 lines * 24px line-height
            textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px'
        }
    }, [input])

    const handleSubmit = (e) => {
        e.preventDefault()
        if (input.trim() && !disabled) {
            onSendMessage(input)
            setInput('')
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit(e)
        }
    }

    return (
        <div className="border-t border-slate-700 bg-slate-800/50 p-4">
            <form onSubmit={handleSubmit} className="flex gap-3">
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={disabled ? "Sohbete başlamak için dosya yükleyin ve aktifleştirin..." : "Dokümanlarınız hakkında soru sorun..."}
                    disabled={disabled}
                    rows={1}
                    className="flex-1 bg-slate-700 text-gray-200 placeholder-gray-500 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed overflow-y-auto"
                    style={{ minHeight: '48px', maxHeight: '96px' }}
                />
                <button
                    type="submit"
                    disabled={disabled || !input.trim()}
                    className="bg-gradient-to-r from-primary-600 to-accent-600 hover:from-primary-500 hover:to-accent-500 text-white p-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                >
                    <Send className="w-5 h-5" />
                </button>
            </form>
            <p className="text-xs text-gray-500 mt-2">
                Göndermek için Enter, yeni satır için Shift+Enter
            </p>
        </div>
    )
}
