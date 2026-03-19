// Storage keys
const STORAGE_KEYS = {
    CONVERSATIONS: 'answerai_conversations',
    ACTIVE_ID: 'answerai_active_conversation',
    ORDER: 'answerai_conversation_order'
}

/**
 * Generate unique ID for conversations
 */
function generateId() {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Get all conversations from localStorage
 */
export function getAllConversations() {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS)
        return stored ? JSON.parse(stored) : {}
    } catch (error) {
        console.error('Error loading conversations:', error)
        return {}
    }
}

/**
 * Get conversation order
 */
export function getConversationOrder() {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.ORDER)
        return stored ? JSON.parse(stored) : []
    } catch (error) {
        console.error('Error loading conversation order:', error)
        return []
    }
}

/**
 * Save all conversations to localStorage
 */
function saveAllConversations(conversations) {
    try {
        localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations))
        return true
    } catch (error) {
        console.error('Error saving conversations:', error)
        if (error.name === 'QuotaExceededError') {
            alert('Storage quota exceeded. Please delete old conversations.')
        }
        return false
    }
}

/**
 * Save conversation order
 */
function saveConversationOrder(order) {
    try {
        localStorage.setItem(STORAGE_KEYS.ORDER, JSON.stringify(order))
    } catch (error) {
        console.error('Error saving conversation order:', error)
    }
}

/**
 * Create a new conversation
 */
export function createNewConversation(title = 'Yeni Sohbet') {
    const conversation = {
        id: generateId(),
        title: title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        activeFileIds: []
    }

    const conversations = getAllConversations()
    conversations[conversation.id] = conversation

    const order = getConversationOrder()
    order.unshift(conversation.id) // Add to beginning

    saveAllConversations(conversations)
    saveConversationOrder(order)
    setActiveConversationId(conversation.id)

    return conversation
}

/**
 * Save or update a conversation
 */
export function saveConversation(conversation) {
    if (!conversation || !conversation.id) {
        console.error('Invalid conversation object')
        return false
    }

    const conversations = getAllConversations()

    // Update timestamp
    conversation.updatedAt = Date.now()

    // Auto-generate title from first user message if still default
    if (conversation.title === 'Yeni Sohbet' && conversation.messages.length > 0) {
        const firstUserMsg = conversation.messages.find(m => m.role === 'user')
        if (firstUserMsg) {
            conversation.title = firstUserMsg.content.substring(0, 50) +
                (firstUserMsg.content.length > 50 ? '...' : '')
        }
    }

    conversations[conversation.id] = conversation

    // Update order (move to top)
    let order = getConversationOrder()
    order = order.filter(id => id !== conversation.id)
    order.unshift(conversation.id)

    saveAllConversations(conversations)
    saveConversationOrder(order)

    return true
}

/**
 * Load a specific conversation
 */
export function loadConversation(id) {
    const conversations = getAllConversations()
    return conversations[id] || null
}

/**
 * Delete a conversation
 */
export function deleteConversation(id) {
    const conversations = getAllConversations()
    delete conversations[id]

    const order = getConversationOrder().filter(convId => convId !== id)

    saveAllConversations(conversations)
    saveConversationOrder(order)

    // If this was active, clear active ID
    if (getActiveConversationId() === id) {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID)
    }

    return true
}

/**
 * Get active conversation ID
 */
export function getActiveConversationId() {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_ID)
}

/**
 * Set active conversation ID
 */
export function setActiveConversationId(id) {
    if (id) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, id)
    } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID)
    }
}

/**
 * Get conversations in display order (sorted)
 */
export function getConversationsInOrder() {
    const conversations = getAllConversations()
    const order = getConversationOrder()

    return order
        .map(id => conversations[id])
        .filter(conv => conv !== undefined)
}

/**
 * Clear all conversations (for testing/reset)
 */
export function clearAllConversations() {
    localStorage.removeItem(STORAGE_KEYS.CONVERSATIONS)
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_ID)
    localStorage.removeItem(STORAGE_KEYS.ORDER)
}
