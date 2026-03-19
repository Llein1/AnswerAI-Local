/**
 * Search Service
 * Provides full-text search across conversations with ranking and highlighting
 */

import * as ConvStorage from './conversationStorage'

// Search Result Cache
const searchCache = new Map()
const CACHE_SIZE_LIMIT = 50

/**
 * Generate cache key from query and options
 */
function getCacheKey(query, options) {
    return JSON.stringify({
        q: query.toLowerCase().trim(),
        ...options
    })
}

/**
 * Clear all cached search results (call when conversations change)
 */
export function invalidateSearchCache() {
    searchCache.clear()
    console.log('[Search] Cache cleared')
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Normalize text for searching (lowercase, trim)
 */
function normalizeText(text) {
    return text.toLowerCase().trim()
}

/**
 * Check if text contains all query words
 */
function matchesQuery(text, queryWords) {
    const normalizedText = normalizeText(text)
    return queryWords.every(word => normalizedText.includes(word))
}

/**
 * Count occurrences of query words in text
 */
function countMatches(text, queryWords) {
    const normalizedText = normalizeText(text)
    return queryWords.reduce((count, word) => {
        const regex = new RegExp(escapeRegex(word), 'gi')
        const matches = normalizedText.match(regex)
        return count + (matches ? matches.length : 0)
    }, 0)
}

/**
 * Highlight matched words in text
 * Returns HTML string with <mark> tags
 */
export function highlightMatches(text, query) {
    if (!query || !query.trim()) return text

    const words = normalizeText(query).split(/\s+/).filter(Boolean)
    let result = text

    words.forEach(word => {
        const regex = new RegExp(`(${escapeRegex(word)})`, 'gi')
        result = result.replace(regex, '<mark class="bg-primary-400/30 text-primary-200 rounded px-0.5">$1</mark>')
    })

    return result
}

/**
 * Search within a single conversation
 */
export function searchInConversation(conversation, query) {
    if (!query || !query.trim()) return []

    const queryWords = normalizeText(query).split(/\s+/).filter(Boolean)
    const results = []

    conversation.messages.forEach((message, index) => {
        if (matchesQuery(message.content, queryWords)) {
            const matchCount = countMatches(message.content, queryWords)

            results.push({
                conversationId: conversation.id,
                conversationTitle: conversation.title,
                messageIndex: index,
                message: message,
                matchCount,
                preview: message.content.slice(0, 150) + (message.content.length > 150 ? '...' : ''),
                timestamp: message.timestamp
            })
        }
    })

    return results
}

/**
 * Calculate date cutoff based on range
 */
function getDateCutoff(range) {
    const now = new Date()
    switch (range) {
        case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000)
        case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000)
        case '90d': return new Date(now - 90 * 24 * 60 * 60 * 1000)
        default: return new Date(0) // 'all' or invalid
    }
}

/**
 * Search across all conversations
 */
export function searchConversations(query, options = {}) {
    if (!query || !query.trim()) return []

    const {
        conversationIds = [],      // Array of conversation IDs to search
        messageType = 'all',       // 'user', 'ai', 'all'
        dateRange = 'all',         // '7d', '30d', '90d', 'custom', 'all'
        customDateFrom = null,     // Custom start date (YYYY-MM-DD)
        customDateTo = null        // Custom end date (YYYY-MM-DD)
    } = options

    // Check cache first
    const cacheKey = getCacheKey(query, options)
    if (searchCache.has(cacheKey)) {
        console.log('[Search] Cache HIT:', cacheKey.substring(0, 60) + '...')
        return searchCache.get(cacheKey)
    }

    console.log('[Search] Cache MISS, executing search...')

    // Load all conversations
    const conversations = ConvStorage.getConversationsInOrder()
    let allResults = []

    // Calculate date cutoff if needed
    let dateCutoff = null
    let dateUpperBound = null

    if (dateRange === 'custom') {
        // Custom date range
        if (customDateFrom) {
            dateCutoff = new Date(customDateFrom)
            dateCutoff.setHours(0, 0, 0, 0) // Start of day
        }
        if (customDateTo) {
            dateUpperBound = new Date(customDateTo)
            dateUpperBound.setHours(23, 59, 59, 999) // End of day
        }
    } else if (dateRange !== 'all') {
        // Preset date range
        dateCutoff = getDateCutoff(dateRange)
    }

    // Filter conversations
    const conversationsToSearch = conversationIds.length > 0
        ? conversations.filter(c => conversationIds.includes(c.id))
        : conversations

    // Search each conversation
    conversationsToSearch.forEach(conversation => {
        const results = searchInConversation(conversation, query)
        allResults.push(...results)
    })

    // Apply filters
    if (messageType !== 'all') {
        // Map 'ai' filter value to 'assistant' role in messages
        const roleToMatch = messageType === 'ai' ? 'assistant' : messageType
        allResults = allResults.filter(result => result.message.role === roleToMatch)
    }


    if (dateCutoff) {
        allResults = allResults.filter(result => new Date(result.timestamp) >= dateCutoff)
    }

    if (dateUpperBound) {
        allResults = allResults.filter(result => new Date(result.timestamp) <= dateUpperBound)
    }

    // Sort by relevance (match count desc, then recency)
    allResults.sort((a, b) => {
        if (b.matchCount !== a.matchCount) {
            return b.matchCount - a.matchCount
        }
        return b.timestamp - a.timestamp
    })

    // Cache the results (with FIFO eviction if needed)
    if (searchCache.size >= CACHE_SIZE_LIMIT) {
        // Remove oldest entry (first one added)
        const firstKey = searchCache.keys().next().value
        searchCache.delete(firstKey)
        console.log('[Search] Cache full, evicted oldest entry')
    }
    searchCache.set(cacheKey, allResults)
    console.log('[Search] Cached results for query')

    return allResults
}

/**
 * Get search suggestions based on query
 * (Future enhancement - returns recent searches or common terms)
 */
export function getSearchSuggestions(query) {
    // Placeholder for future implementation
    return []
}

/**
 * Debounce function for search input
 */
export function debounce(func, wait) {
    let timeout
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout)
            func(...args)
        }
        clearTimeout(timeout)
        timeout = setTimeout(later, wait)
    }
}
