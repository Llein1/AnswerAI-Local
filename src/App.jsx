import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Header from './components/Header'
import FileUpload from './components/FileUpload'
import FileList from './components/FileList'
import ChatInterface from './components/ChatInterface'
import ChatInput from './components/ChatInput'
import ConversationList from './components/ConversationList'
import ConfirmDialog from './components/ConfirmDialog'
import ToastContainer from './components/ToastContainer'
// Lazy load viewers to reduce initial bundle size
const PDFViewer = lazy(() => import('./components/PDFViewer'))
const DOCXViewer = lazy(() => import('./components/DOCXViewer'))
import SearchResults from './components/SearchResults'
import Settings from './components/Settings'
import EvaluationPanel from './components/EvaluationPanel'
import { ChevronDown, MessageSquare, BarChart3 } from 'lucide-react'
import { processFile } from './services/fileProcessingService'
import { generateRAGResponse, processDocument, clearVectorStore } from './services/ragService'
import { searchConversations, debounce, invalidateSearchCache } from './services/searchService'
import storageFacade from './services/storageFacade'

import { ToastProvider, useToast } from './hooks/useToast.jsx'

// React StrictMode in development mounts components twice to detect side effects.
// Keep one-time startup logic idempotent across that double-mount cycle.
let hasInitializedAppOnce = false
let hasCheckedApiKeyOnce = false

function AppContent() {
    const [files, setFiles] = useState([])
    const [messages, setMessages] = useState([])
    const [isLoading, setIsLoading] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [processingFiles, setProcessingFiles] = useState(new Set()) // tracks files being embedded
    const [activeTab, setActiveTab] = useState('chat') // 'chat' | 'evaluation'
    const { toasts, removeToast, showError } = useToast()

    // Conversation management
    const [conversations, setConversations] = useState([])
    const [activeConversationId, setActiveConversationId] = useState(null)
    const [clearChatDialogOpen, setClearChatDialogOpen] = useState(false)

    // PDF Preview state
    const [previewFile, setPreviewFile] = useState(null)
    const [previewPage, setPreviewPage] = useState(1)

    // Scroll to bottom state and ref
    const chatScrollRef = useRef(null)
    const [showScrollButton, setShowScrollButton] = useState(false)

    // Search state
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState([])
    const [selectedResultIndex, setSelectedResultIndex] = useState(0)
    const searchContainerRef = useRef(null)
    const [searchFilters, setSearchFilters] = useState({
        dateRange: 'all',
        customDateFrom: null,
        customDateTo: null,
        conversationIds: [],
        messageType: 'all'
    })
    const [filterPanelOpen, setFilterPanelOpen] = useState(false)

    // Settings state
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [settings, setSettings] = useState(storageFacade.settings.load())



    // Load conversations and files on mount
    useEffect(() => {
        if (hasInitializedAppOnce) return
        hasInitializedAppOnce = true

        const initializeApp = async () => {

            // Load files (now async)
            try {
                const savedFiles = await storageFacade.files.loadAll()
                setFiles(savedFiles)
                console.log(`Loaded ${savedFiles.length} files from storage`)
            } catch (error) {
                console.error('Error loading files:', error)
                showError('Dosyalar yüklenirken hata oluştu')
            }

            // ChromaDB health check
            const chromaResult = await storageFacade.vectors.checkHealth()
            if (chromaResult.ok) {
                console.log('✅ ChromaDB bağlantısı başarılı')
            } else {
                console.warn('⚠️ ChromaDB bağlantısı kurulamadı:', chromaResult.error)
                showError('⚠️ ChromaDB sunucusuna bağlanılamadı. Ayarlar → Kurulum Kılavuzu\'nu inceleyin.')
            }

            // Load conversations
            const convs = storageFacade.conversations.getInOrder()
            setConversations(convs)

            const activeId = storageFacade.conversations.getActiveId()
            if (activeId) {
                loadConversation(activeId)
            } else if (convs.length > 0) {
                loadConversation(convs[0].id)
            } else {
                handleNewConversation()
            }
        }

        initializeApp()
    }, [])

    // Check API key on mount
    useEffect(() => {
        if (hasCheckedApiKeyOnce) return
        hasCheckedApiKeyOnce = true

        const currentSettings = storageFacade.settings.load()
        if (!currentSettings.apiKey || currentSettings.apiKey.trim() === '') {
            // Open settings modal automatically if no API key
            setTimeout(() => {
                setSettingsOpen(true)
                showError('Lütfen Gemini API anahtarınızı yapılandırın')
            }, 500)
        } else {
            console.log('✅ API key configured')
        }
    }, [])

    // Auto-save current conversation when messages change
    useEffect(() => {
        if (activeConversationId && messages.length > 0) {
            const conversation = {
                id: activeConversationId,
                title: storageFacade.conversations.load(activeConversationId)?.title || 'Yeni Sohbet',
                createdAt: storageFacade.conversations.load(activeConversationId)?.createdAt || Date.now(),
                updatedAt: Date.now(),
                messages: messages,
                activeFileIds: files.filter(f => f.active).map(f => f.id)
            }
            storageFacade.conversations.save(conversation)

            // Invalidate search cache when conversations change
            invalidateSearchCache()

            // Refresh conversation list
            setConversations(storageFacade.conversations.getInOrder())
        }
    }, [messages, activeConversationId, files])

    const handleFileUpload = async (file) => {
        try {
            // Error handling via toast

            // Process file using unified service (supports PDF, TXT, MD, DOCX)
            const { text, metadata } = await processFile(file)

            // Read file as ArrayBuffer for preview (primarily for PDFs)
            const arrayBuffer = await file.arrayBuffer()

            const newFile = {
                id: Date.now().toString(),
                name: file.name,
                size: file.size,
                type: metadata.type, // Store file type (pdf, txt, md, docx)
                text: text,
                pageCount: metadata.pageCount || null, // PDF specific
                pages: metadata.pages || null,  // PDF specific
                data: arrayBuffer,  // Binary data for preview
                active: true,
                uploadedAt: new Date().toISOString()
            }

            // Save to storage (now async)
            try {
                const saved = await storageFacade.files.save(newFile)
                if (saved) {
                    // Yeni dosyayı aktif yap, diğerlerini pasife çek (tek-seçim kuralı)
                    setFiles(prev => [
                        ...prev.map(f => ({ ...f, active: false })),
                        newFile
                    ])
                    // Deactivate previously active files in storage
                    const prevActive = files.filter(f => f.active)
                    await Promise.all(prevActive.map(f => storageFacade.files.updateActiveState(f.id, false)))

                    console.log(`File uploaded: ${newFile.name}`)

                    // Trigger embedding immediately in background (embed on upload)
                    setProcessingFiles(prev => new Set([...prev, newFile.id]))
                    processDocument(newFile.text, newFile.id, newFile.name, newFile.pages || [])
                        .then(count => {
                            console.log(`✅ Embedding tamamlandı: ${newFile.name} (${count} chunk)`)
                        })
                        .catch(err => {
                            console.warn(`⚠️ Embedding başarısız (${newFile.name}):`, err.message)
                        })
                        .finally(() => {
                            setProcessingFiles(prev => {
                                const next = new Set(prev)
                                next.delete(newFile.id)
                                return next
                            })
                        })
                } else {
                    showError('Dosya kaydedilemedi')
                }
            } catch (error) {
                console.error('Error saving file:', error)
                showError('Dosya kaydedilemedi')
            }
        } catch (err) {
            showError(err.message)
            console.error('File upload error:', err)
        }
    }

    const handleDeleteFile = async (fileId) => {
        try {
            await storageFacade.removeFileEverywhere(fileId)
            setFiles(prev => prev.filter(f => f.id !== fileId))
        } catch (error) {
            console.error('Error deleting file:', error)
            showError('Dosya silinemedi')
        }
    }

    const handleToggleFileActive = async (fileId) => {
        try {
            const fileToToggle = files.find(f => f.id === fileId)
            if (!fileToToggle) return

            if (fileToToggle.active) {
                // Zaten aktifse → pasife çek
                const updatedFiles = files.map(f =>
                    f.id === fileId ? { ...f, active: false } : f
                )
                await storageFacade.files.updateActiveState(fileId, false)
                setFiles(updatedFiles)
            } else {
                // Diğer tüm aktif dosyaları pasife çek, sadece bu dosyayı aktif yap
                const updatedFiles = files.map(f => ({ ...f, active: f.id === fileId }))
                // Tüm dosyaların durumunu güncelle
                await Promise.all(
                    files.map(f => storageFacade.files.updateActiveState(f.id, f.id === fileId))
                )
                setFiles(updatedFiles)
            }
        } catch (error) {
            console.error('Error toggling file:', error)
            showError('Dosya durumu güncellenemedi')
        }
    }

    const handleSendMessage = async (message) => {
        if (!message.trim() || isLoading) return

        const activeFiles = files.filter(f => f.active)
        if (activeFiles.length === 0) {
            showError('Sohbete başlamak için lütfen en az bir dosya yükleyin ve aktifleştirin.')
            return
        }

        // Add user message
        const userMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: message,
            timestamp: new Date()
        }
        setMessages(prev => [...prev, userMessage])
        setIsLoading(true)
        // Error handling via toast

        try {
            // Generate AI response using RAG with selected method
            const { response, sources } = await generateRAGResponse(message, activeFiles, settings.ragMethod)

            const aiMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response,
                sources: sources,  // Add sources to message
                timestamp: new Date()
            }
            setMessages(prev => [...prev, aiMessage])
        } catch (err) {
            showError(err.message)
            console.error('Chat error:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const handleClearChat = () => {
        setClearChatDialogOpen(true)
    }

    const confirmClearChat = () => {
        if (activeConversationId) {
            // Delete the current conversation from storage
            storageFacade.conversations.remove(activeConversationId)

            // Create a new empty conversation
            const newConv = storageFacade.conversations.create()
            setActiveConversationId(newConv.id)
            setMessages([])
            // Cleared chat
            setConversations(storageFacade.conversations.getInOrder())
        }
        setClearChatDialogOpen(false)
    }

    // Conversation handlers
    const handleNewConversation = () => {
        const newConv = storageFacade.conversations.create()
        setActiveConversationId(newConv.id)
        setMessages([])
        // New conversation
        setConversations(storageFacade.conversations.getInOrder())
        console.log('Created new conversation:', newConv.id)
    }

    const loadConversation = (id) => {
        const conv = storageFacade.conversations.load(id)
        if (conv) {
            setActiveConversationId(id)
            setMessages(conv.messages || [])
            storageFacade.conversations.setActiveId(id)
            console.log('Loaded conversation:', id)
        }
    }

    const handleDeleteConversation = (id) => {
        storageFacade.conversations.remove(id)

        // Invalidate search cache when conversations are deleted
        invalidateSearchCache()

        const remainingConvs = storageFacade.conversations.getInOrder()
        setConversations(remainingConvs)

        // If deleting active conversation, switch to another or create new
        if (id === activeConversationId) {
            if (remainingConvs.length > 0) {
                loadConversation(remainingConvs[0].id)
            } else {
                handleNewConversation()
            }
        }
    }

    // Preview handlers
    const handlePreviewFile = (fileId, page = 1) => {
        const file = files.find(f => f.id === fileId)
        if (file && file.data) {
            setPreviewFile(file)
            setPreviewPage(page)
        }
    }

    const handleClosePreview = () => {
        setPreviewFile(null)
        setPreviewPage(1)
    }

    const handlePageClick = (fileName, pageNumber) => {
        const file = files.find(f => f.name === fileName)
        if (file) {
            handlePreviewFile(file.id, pageNumber)
        }
    }

    const handleRenameConversation = (id, newTitle) => {
        if (!newTitle.trim()) return

        const conv = storageFacade.conversations.load(id)
        if (conv) {
            const updatedConv = {
                ...conv,
                title: newTitle.trim(),
                updatedAt: Date.now()
            }
            storageFacade.conversations.save(updatedConv)
            setConversations(storageFacade.conversations.getInOrder())
        }
    }

    // Settings handlers
    const handleSaveSettings = (newSettings) => {
        const oldSettings = settings

        // Save via unified storage facade
        const saved = storageFacade.settings.save(newSettings)
        if (!saved) {
            showError('Ayarlar kaydedilemedi')
            return
        }

        setSettings(newSettings)
        setSettingsOpen(false)

        // Check if chunk size changed
        if (oldSettings.chunkSize !== newSettings.chunkSize) {
            // Clear vector store to force reprocessing
            clearVectorStore()
            showError('Chunk boyutu değişti. En iyi sonuçlar için dosyalarınızı yeniden yükleyin.')
        }

        console.log('✅ Settings saved:', newSettings)
    }

    // Search handlers
    const handleSearch = debounce((query) => {
        if (!query || !query.trim()) {
            setSearchResults([])
            setSearchQuery('')
            return
        }

        setSearchQuery(query)
        const results = searchConversations(query, searchFilters)
        setSearchResults(results)
        setSelectedResultIndex(0)
    }, 300)


    const handleClearSearch = () => {
        setSearchQuery('')
        setSearchResults([])
        setSelectedResultIndex(0)
    }

    // Close dropdown only (keep query text) - for click outside
    const handleCloseSearchResults = () => {
        setSearchResults([])
        setSelectedResultIndex(0)
    }

    // Filter handlers
    const handleFilterChange = (newFilters) => {
        setSearchFilters(newFilters)
        // Re-run search with new filters if query exists
        if (searchQuery) {
            const results = searchConversations(searchQuery, newFilters)
            setSearchResults(results)
            setSelectedResultIndex(0)
        }
    }

    const handleClearFilters = () => {
        const defaultFilters = {
            dateRange: 'all',
            customDateFrom: null,
            customDateTo: null,
            conversationIds: [],
            messageType: 'all'
        }
        setSearchFilters(defaultFilters)
        // Re-run search with cleared filters
        if (searchQuery) {
            const results = searchConversations(searchQuery, defaultFilters)
            setSearchResults(results)
            setSelectedResultIndex(0)
        }
    }

    const handleChromaConnected = async () => {
        const activeFiles = files.filter(f => f.active)
        for (const file of activeFiles) {
            const count = await storageFacade.vectors.getChunkCount(file.id)
            if (count === 0) {
                setProcessingFiles(prev => new Set([...prev, file.id]))
                processDocument(file.text, file.id, file.name, file.pages || [])
                    .then(count => {
                        console.log(`✅ Embedding tamamlandı (Test sonrası): ${file.name} (${count} chunk)`)
                    })
                    .catch(err => {
                        console.warn(`⚠️ Embedding başarısız (${file.name}):`, err.message)
                    })
                    .finally(() => {
                        setProcessingFiles(prev => {
                            const next = new Set(prev)
                            next.delete(file.id)
                            return next
                        })
                    })
            }
        }
    }

    const handleSelectSearchResult = (result) => {
        // Switch to the conversation containing the result
        if (result.conversationId !== activeConversationId) {
            loadConversation(result.conversationId)
        }

        // Wait for conversation to load, then scroll to message
        setTimeout(() => {
            const messageElements = document.querySelectorAll('[data-message-index]')
            const targetElement = Array.from(messageElements).find(
                el => parseInt(el.getAttribute('data-message-index')) === result.messageIndex
            )

            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                // Add temporary highlight
                targetElement.classList.add('bg-primary-500/20', 'ring-2', 'ring-primary-500/50')
                setTimeout(() => {
                    targetElement.classList.remove('bg-primary-500/20', 'ring-2', 'ring-primary-500/50')
                }, 2000)
            }
        }, 100)

        // Keep search open so user can navigate to other results
    }

    // Keyboard navigation for search results
    useEffect(() => {
        if (searchResults.length === 0) return

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedResultIndex(prev =>
                    prev < searchResults.length - 1 ? prev + 1 : prev
                )
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedResultIndex(prev => prev > 0 ? prev - 1 : 0)
            } else if (e.key === 'Enter' && searchResults[selectedResultIndex]) {
                e.preventDefault()
                handleSelectSearchResult(searchResults[selectedResultIndex])
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [searchResults, selectedResultIndex])

    // Click outside to close search results
    useEffect(() => {
        if (searchResults.length === 0) return

        const handleClickOutside = (e) => {
            if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
                handleCloseSearchResults()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [searchResults.length])

    // Scroll to bottom handler
    const scrollToBottom = () => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTo({
                top: chatScrollRef.current.scrollHeight,
                behavior: 'smooth'
            })
        }
    }

    // Chat scroll listener - show/hide scroll button
    const handleChatScroll = (e) => {
        if (!e.target) return
        const { scrollTop, scrollHeight, clientHeight } = e.target
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 200
        setShowScrollButton(!isNearBottom)
    }

    // Auto-scroll to bottom when new message arrives
    useEffect(() => {
        if (messages.length > 0) {
            scrollToBottom()
        }
    }, [messages.length])

    return (
        <Layout>
            {/* Fixed Header */}
            <div className="flex-shrink-0 z-20 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700">
                <div className="relative" ref={searchContainerRef}>
                    <Header
                        onClearChat={handleClearChat}
                        messageCount={messages.length}
                        onSearch={handleSearch}
                        onClearSearch={handleClearSearch}
                        searchResultCount={searchResults.length}
                        searchFilters={searchFilters}
                        conversations={conversations}
                        onFilterChange={handleFilterChange}
                        onClearFilters={handleClearFilters}
                        onFilterToggle={setFilterPanelOpen}
                        onOpenSettings={() => setSettingsOpen(true)}
                    />

                    {/* Search Results Dropdown - Hidden when filter panel is open */}
                    {searchQuery && searchResults.length > 0 && !filterPanelOpen && (
                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-full max-w-2xl px-6 z-50">
                            <SearchResults
                                results={searchResults}
                                query={searchQuery}
                                onSelectResult={handleSelectSearchResult}
                                selectedIndex={selectedResultIndex}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex-shrink-0 flex items-center gap-1 px-4 py-1.5 bg-slate-900/80 border-b border-slate-700/60">
                <button
                    id="tab-chat"
                    onClick={() => setActiveTab('chat')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        activeTab === 'chat'
                            ? 'bg-slate-700 text-white'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                >
                    <MessageSquare className="w-3.5 h-3.5" /> Sohbet
                </button>
                <button
                    id="tab-evaluation"
                    onClick={() => setActiveTab('evaluation')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        activeTab === 'evaluation'
                            ? 'bg-violet-600/80 text-white'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                >
                    <BarChart3 className="w-3.5 h-3.5" /> Değerlendirme
                </button>
            </div>

            <div className="flex-1 flex h-0 overflow-hidden relative">
                {/* Mobile Menu Button */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="md:hidden fixed top-4 left-4 z-50 p-2 bg-slate-800 rounded-lg border border-slate-700"
                >
                    <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {sidebarOpen ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                    </svg>
                </button>

                {/* Sidebar - Conversations & Files */}
                <div className={`w-80 bg-slate-800/50 border-r border-slate-700 flex flex-col overflow-hidden transition-transform duration-300 md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0 fixed inset-y-0 left-0 z-40' : '-translate-x-full fixed'
                    }`}>
                    {/* Conversation List - Top Half */}
                    <div className="min-h-0 border-b border-slate-700 flex flex-col max-h-[420px]">
                        <ConversationList
                            conversations={conversations}
                            activeId={activeConversationId}
                            onSelect={loadConversation}
                            onDelete={handleDeleteConversation}
                            onNew={handleNewConversation}
                            onRename={handleRenameConversation}
                        />
                    </div>

                    {/* File Management - Bottom Half */}
                    <div className="min-h-0 flex flex-col flex-1">
                        <FileUpload onFileUpload={handleFileUpload} />
                        <FileList
                            files={files}
                            onDelete={handleDeleteFile}
                            onToggle={handleToggleFileActive}
                            onPreview={handlePreviewFile}
                            processingFiles={processingFiles}
                        />
                    </div>
                </div>

                {/* Backdrop for mobile */}
                {sidebarOpen && (
                    <div
                        className="md:hidden fixed inset-0 bg-black/50 z-30"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                {/* Main Content Area — Chat veya Evaluation */}
                {activeTab === 'evaluation' ? (
                    <div className="flex-1 overflow-y-auto">
                        <EvaluationPanel activeFiles={files.filter(f => f.active)} />
                    </div>
                ) : (
                <div className={`flex-1 flex flex-col overflow-hidden relative ${previewFile ? 'lg:pr-96' : ''}`}>
                    {/* Scrollable Chat Interface */}
                    <div
                        ref={chatScrollRef}
                        onScroll={handleChatScroll}
                        className="flex-1 overflow-y-auto pb-24"
                    >
                        <ChatInterface
                            messages={messages}
                            isLoading={isLoading}
                            onPageClick={handlePageClick}
                        />
                    </div>

                    {/* Scroll to Bottom Button */}
                    {showScrollButton && (
                        <button
                            onClick={scrollToBottom}
                            className="fixed bottom-28 right-8 p-3 bg-gradient-to-br from-primary-500 to-accent-600 
                                       hover:from-primary-600 hover:to-accent-700 rounded-full shadow-lg 
                                       transition-all z-30 hover:scale-110"
                            title="En alta git"
                        >
                            <ChevronDown className="w-6 h-6 text-white" />
                        </button>
                    )}
                </div>
                )}

                {/* Document Preview Panel (PDF or DOCX) */}
                {previewFile && (
                    <div className="absolute right-0 top-0 bottom-0 w-96 overflow-hidden flex flex-col hidden lg:flex">
                        <ErrorBoundary fallback={
                            <div className="flex items-center justify-center h-full bg-slate-900/95 p-6 text-center">
                                <div>
                                    <p className="text-gray-300 mb-4">Görüntüleme hatası</p>
                                    <button
                                        onClick={handleClosePreview}
                                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded-lg"
                                    >
                                        Kapat
                                    </button>
                                </div>
                            </div>
                        }>
                            <Suspense fallback={
                                <div className="flex items-center justify-center h-full bg-slate-900/95">
                                    <div className="text-gray-400">Görüntüleyici yükleniyor...</div>
                                </div>
                            }>
                                {previewFile.type === 'pdf' ? (
                                    <PDFViewer
                                        fileData={previewFile.data}
                                        fileName={previewFile.name}
                                        initialPage={previewPage}
                                        onClose={handleClosePreview}
                                    />
                                ) : previewFile.type === 'docx' ? (
                                    <DOCXViewer
                                        fileData={previewFile.data}
                                        fileName={previewFile.name}
                                        onClose={handleClosePreview}
                                    />
                                ) : null}
                            </Suspense>
                        </ErrorBoundary>
                    </div>
                )}

                {/* Mobile Preview Modal */}
                {previewFile && (
                    <div className="lg:hidden fixed inset-0 z-50 bg-slate-900">
                        <ErrorBoundary>
                            <Suspense fallback={
                                <div className="flex items-center justify-center h-full">
                                    <div className="text-gray-400">Görüntüleyici yükleniyor...</div>
                                </div>
                            }>
                                {previewFile.type === 'pdf' ? (
                                    <PDFViewer
                                        fileData={previewFile.data}
                                        fileName={previewFile.name}
                                        initialPage={previewPage}
                                        onClose={handleClosePreview}
                                    />
                                ) : previewFile.type === 'docx' ? (
                                    <DOCXViewer
                                        fileData={previewFile.data}
                                        fileName={previewFile.name}
                                        onClose={handleClosePreview}
                                    />
                                ) : null}
                            </Suspense>
                        </ErrorBoundary>
                    </div>
                )}
            </div>

            {/* Fixed Text Input - Sadece Sohbet sekmesinde görünür */}
            {activeTab === 'chat' && (
            <div className="fixed bottom-0 left-0 md:left-80 right-0 bg-slate-900/95 backdrop-blur-sm 
                            border-t border-slate-700 z-20">
                <ChatInput
                    onSendMessage={handleSendMessage}
                    disabled={isLoading || files.filter(f => f.active).length === 0}
                />
            </div>
            )}

            {/* Toast Container */}
            <ToastContainer toasts={toasts} onClose={removeToast} />

            {/* Clear Chat Confirmation Dialog */}
            <ConfirmDialog
                isOpen={clearChatDialogOpen}
                title="Sohbeti Temizle"
                message="Bu sohbetteki tüm mesajları silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
                onConfirm={confirmClearChat}
                onCancel={() => setClearChatDialogOpen(false)}
            />

            {/* Settings Modal */}
            {settingsOpen && (
                <Settings
                    isOpen={settingsOpen}
                    currentSettings={settings}
                    onSave={handleSaveSettings}
                    onClose={() => setSettingsOpen(false)}
                    onChromaConnected={handleChromaConnected}
                />
            )}
        </Layout>
    )
}

// Wrap the app with ToastProvider
export default function App() {
    return (
        <ToastProvider>
            <AppContent />
        </ToastProvider>
    )
}

