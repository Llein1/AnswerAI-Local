import { useEffect, useRef } from 'react'
import { Bot, User, AlertCircle, FileQuestion } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import CopyButton from './CopyButton'
import SourceReferences from './SourceReferences'

export default function ChatInterface({ messages, isLoading, onPageClick }) {
    const messagesEndRef = useRef(null)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages, isLoading])

    if (messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center max-w-md">
                    <FileQuestion className="w-16 h-16 mx-auto mb-4 text-primary-400/50" />
                    <h2 className="text-xl font-semibold text-gray-300 mb-2">
                        Sorularınızı Cevaplamaya Hazır
                    </h2>
                    <p className="text-gray-500 mb-6">
                        Bir PDF belgesi yükleyin ve içeriği hakkında sorular sormaya başlayın.
                    </p>
                    <div className="space-y-2 text-sm text-left bg-slate-800/50 rounded-lg p-4">
                        <p className="text-gray-400 font-medium mb-2">Örnek sorular:</p>
                        <ul className="space-y-1 text-gray-500">
                            <li>• "Bu belge ne hakkında?"</li>
                            <li>• "Ana noktaları özetle"</li>
                            <li>• "Önemli bulgular neler?"</li>
                        </ul>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.map((message, index) => (
                <div
                    key={message.id}
                    data-message-index={index}
                    className={`flex gap-3 animate-fadeIn transition-all rounded-lg ${message.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                >
                    {message.role === 'assistant' && (
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center">
                            <Bot className="w-5 h-5 text-white" />
                        </div>
                    )}

                    <div
                        className={`max-w-3xl rounded-lg p-4 ${message.role === 'user'
                            ? 'bg-primary-600 text-white'
                            : 'bg-slate-800 text-gray-200'
                            }`}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                                {message.role === 'assistant' ? (
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                code({ node, inline, className, children, ...props }) {
                                                    const match = /language-(\w+)/.exec(className || '')
                                                    return !inline && match ? (
                                                        <SyntaxHighlighter
                                                            style={vscDarkPlus}
                                                            language={match[1]}
                                                            PreTag="div"
                                                            {...props}
                                                        >
                                                            {String(children).replace(/\n$/, '')}
                                                        </SyntaxHighlighter>
                                                    ) : (
                                                        <code className={className} {...props}>
                                                            {children}
                                                        </code>
                                                    )
                                                }
                                            }}
                                        >
                                            {message.content}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                                )}
                                <p className="text-xs mt-2 opacity-60">
                                    {new Date(message.timestamp).toLocaleTimeString()}
                                </p>
                            </div>
                            <CopyButton text={message.content} />
                        </div>
                        {message.role === 'assistant' && message.sources && (
                            <SourceReferences sources={message.sources} onPageClick={onPageClick} />
                        )}
                    </div>

                    {message.role === 'user' && (
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                            <User className="w-5 h-5 text-gray-300" />
                        </div>
                    )}
                </div>
            ))}

            {isLoading && (
                <div className="flex gap-3 animate-fadeIn">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-accent-600 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <div className="bg-slate-800 rounded-lg p-4">
                        <div className="flex gap-1">
                            <span className="dot-pulse"></span>
                            <span className="dot-pulse"></span>
                            <span className="dot-pulse"></span>
                        </div>
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    )
}
