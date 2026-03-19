/**
 * File Storage Service
 * Manages persistence of uploaded PDF files using IndexedDB (via Dexie)
 * Migrated from localStorage for better capacity and performance
 */

import {
    saveFileToIndexedDB,
    loadFilesFromIndexedDB,
    deleteFileFromIndexedDB,
    clearAllFilesFromIndexedDB,
    isIndexedDBAvailable,
    getStorageInfo as getIndexedDBStorageInfo
} from './indexedDBService'

// Fallback to localStorage if IndexedDB not available
const USE_INDEXEDDB = isIndexedDBAvailable()

if (!USE_INDEXEDDB) {
    console.warn('⚠️ IndexedDB not available, falling back to localStorage (limited capacity)')
}

// ===== localStorage FALLBACK (for old browsers) =====

const FILES_STORAGE_KEY = 'answerai_files'

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
}

function loadFilesFromLocalStorage() {
    try {
        const filesJson = localStorage.getItem(FILES_STORAGE_KEY)
        if (!filesJson) return []

        const files = JSON.parse(filesJson)
        const filesWithArrayBuffer = files.map(file => {
            if (file.dataBase64) {
                return {
                    ...file,
                    data: base64ToArrayBuffer(file.dataBase64)
                }
            }
            return file
        })

        return Array.isArray(filesWithArrayBuffer) ? filesWithArrayBuffer : []
    } catch (error) {
        console.error('Error loading files from localStorage:', error)
        return []
    }
}

function saveFileToLocalStorage(fileData) {
    try {
        const files = loadFilesFromLocalStorage()
        const fileToSave = { ...fileData }

        if (fileData.data instanceof ArrayBuffer) {
            fileToSave.dataBase64 = arrayBufferToBase64(fileData.data)
            delete fileToSave.data
        }

        const existingIndex = files.findIndex(f => f.id === fileData.id)
        if (existingIndex >= 0) {
            files[existingIndex] = { ...files[existingIndex], ...fileToSave }
        } else {
            files.push(fileToSave)
        }

        const filesToStore = files.map(f => {
            const { data, ...rest } = f
            return rest
        })

        localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(filesToStore))
        return true
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            alert('Depolama limiti doldu. Yeni dosya yüklemek için bazı dosyaları silin.')
        }
        console.error('Error saving file to localStorage:', error)
        return false
    }
}

function deleteFileFromLocalStorage(fileId) {
    try {
        const files = loadFilesFromLocalStorage()
        const filteredFiles = files.filter(f => f.id !== fileId)
        localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(filteredFiles))
        return true
    } catch (error) {
        console.error('Error deleting file from localStorage:', error)
        return false
    }
}

// ===== PUBLIC API (Auto-selects IndexedDB or localStorage) =====

/**
 * Load all files from storage
 * @returns {Promise<Array>} Array of file objects
 */
export async function loadFiles() {
    if (USE_INDEXEDDB) {
        return await loadFilesFromIndexedDB()
    } else {
        return loadFilesFromLocalStorage()
    }
}

/**
 * Save a file to storage
 * @param {Object} fileData - File object with metadata and content
 * @returns {Promise<boolean>} Success status
 */
export async function saveFile(fileData) {
    if (USE_INDEXEDDB) {
        try {
            await saveFileToIndexedDB(fileData)
            return true
        } catch (error) {
            console.error('Error saving file:', error)
            return false
        }
    } else {
        return saveFileToLocalStorage(fileData)
    }
}

/**
 * Delete a file from storage
 * @param {string} fileId - ID of file to delete
 * @returns {Promise<boolean>} Success status
 */
export async function deleteFile(fileId) {
    if (USE_INDEXEDDB) {
        try {
            await deleteFileFromIndexedDB(fileId)
            return true
        } catch (error) {
            console.error('Error deleting file:', error)
            return false
        }
    } else {
        return deleteFileFromLocalStorage(fileId)
    }
}

/**
 * Update the active state of a file
 * @param {string} fileId - ID of file to update
 * @param {boolean} active - New active state
 * @returns {Promise<boolean>} Success status
 */
export async function updateFileActiveState(fileId, active) {
    try {
        const files = await loadFiles()
        const file = files.find(f => f.id === fileId)

        if (file) {
            file.active = active
            await saveFile(file)
            console.log(`File ${fileId} active state updated to: ${active}`)
            return true
        }

        return false
    } catch (error) {
        console.error('Error updating file active state:', error)
        return false
    }
}

/**
 * Clear all files from storage
 * @returns {Promise<boolean>} Success status
 */
export async function clearAllFiles() {
    if (USE_INDEXEDDB) {
        try {
            await clearAllFilesFromIndexedDB()
            return true
        } catch (error) {
            console.error('Error clearing files:', error)
            return false
        }
    } else {
        try {
            localStorage.removeItem(FILES_STORAGE_KEY)
            return true
        } catch (error) {
            console.error('Error clearing files:', error)
            return false
        }
    }
}

/**
 * Get storage usage info
 * @returns {Promise<Object>} Storage info with file count and estimated size
 */
export async function getStorageInfo() {
    if (USE_INDEXEDDB) {
        return await getIndexedDBStorageInfo()
    } else {
        try {
            const files = loadFilesFromLocalStorage()
            const filesJson = localStorage.getItem(FILES_STORAGE_KEY) || '[]'
            const sizeInBytes = new Blob([filesJson]).size
            const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2)

            return {
                fileCount: files.length,
                sizeInBytes: sizeInBytes,
                sizeInMB: sizeInMB,
                files: files.map(f => ({
                    id: f.id,
                    name: f.name,
                    size: f.size,
                    active: f.active
                }))
            }
        } catch (error) {
            console.error('Error getting storage info:', error)
            return {
                fileCount: 0,
                sizeInBytes: 0,
                sizeInMB: '0.00',
                files: []
            }
        }
    }
}
