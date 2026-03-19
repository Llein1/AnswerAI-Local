import * as ConversationStorage from './conversationStorage'
import * as FileStorage from './fileStorage'
import * as SettingsStorage from './settingsStorage'
import * as ChromaDB from './chromaDBService'

// Central storage entry point. This keeps callers decoupled from backend details
// while preserving the current storage split by data type.
export const storageFacade = {
    conversations: {
        getAll: ConversationStorage.getAllConversations,
        getOrder: ConversationStorage.getConversationOrder,
        getInOrder: ConversationStorage.getConversationsInOrder,
        create: ConversationStorage.createNewConversation,
        save: ConversationStorage.saveConversation,
        load: ConversationStorage.loadConversation,
        remove: ConversationStorage.deleteConversation,
        clearAll: ConversationStorage.clearAllConversations,
        getActiveId: ConversationStorage.getActiveConversationId,
        setActiveId: ConversationStorage.setActiveConversationId
    },

    files: {
        loadAll: FileStorage.loadFiles,
        save: FileStorage.saveFile,
        remove: FileStorage.deleteFile,
        updateActiveState: FileStorage.updateFileActiveState,
        clearAll: FileStorage.clearAllFiles,
        getInfo: FileStorage.getStorageInfo
    },

    settings: {
        load: SettingsStorage.loadSettings,
        save: SettingsStorage.saveSettings,
        reset: SettingsStorage.resetSettings,
        validate: SettingsStorage.validateSettings,
        validateApiKey: SettingsStorage.validateApiKey
    },

    vectors: {
        checkHealth: ChromaDB.checkHealth,
        addChunks: ChromaDB.addChunks,
        queryChunks: ChromaDB.queryChunks,
        getChunkCount: ChromaDB.getChunkCount,
        getChunksByFile: ChromaDB.getChunksByFile,
        removeFileChunks: ChromaDB.deleteChunks,
        clearAll: ChromaDB.clearAll
    },

    // Cross-store helpers to keep orchestration consistent.
    async removeFileEverywhere(fileId) {
        await this.files.remove(fileId)
        await this.vectors.removeFileChunks(fileId)
    }
}

export default storageFacade