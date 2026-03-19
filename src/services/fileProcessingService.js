import { extractTextFromPDF } from './pdfService'
import mammoth from 'mammoth'

/**
 * Supported file types configuration
 */
const SUPPORTED_TYPES = {
    pdf: {
        mimeTypes: ['application/pdf'],
        extensions: ['.pdf'],
        maxSize: 10 * 1024 * 1024 // 10MB
    },
    docx: {
        mimeTypes: [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ],
        extensions: ['.docx'],
        maxSize: 10 * 1024 * 1024 // 10MB
    }
}

/**
 * Detect file type from file object
 * @param {File} file - File object
 * @returns {string|null} - File type key (pdf, docx) or null
 */
function detectFileType(file) {
    const fileName = file.name.toLowerCase()

    for (const [type, config] of Object.entries(SUPPORTED_TYPES)) {
        // Check by extension first (more reliable)
        const hasExtension = config.extensions.some(ext => fileName.endsWith(ext))
        if (hasExtension) return type

        // Fallback to MIME type
        const hasMimeType = config.mimeTypes.includes(file.type)
        if (hasMimeType) return type
    }

    return null
}

/**
 * Validate file before processing
 * @param {File} file - File to validate
 * @throws {Error} - If validation fails
 */
function validateFile(file) {
    if (!file) {
        throw new Error('Dosya bulunamadı')
    }

    if (file.size === 0) {
        throw new Error('Dosya boş')
    }

    const fileType = detectFileType(file)

    if (!fileType) {
        throw new Error(
            'Desteklenmeyen dosya formatı. Sadece PDF ve DOCX dosyaları kabul edilir.'
        )
    }

    const maxSize = SUPPORTED_TYPES[fileType].maxSize
    if (file.size > maxSize) {
        const maxSizeMB = Math.round(maxSize / (1024 * 1024))
        throw new Error(
            `${fileType.toUpperCase()} dosyası ${maxSizeMB}MB'dan küçük olmalıdır`
        )
    }

    return true
}

/**
 * Process DOCX file using mammoth
 * @param {File} file - DOCX file
 * @returns {Promise<{text: string, metadata: object}>}
 */
async function processDocxFile(file) {
    try {
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.extractRawText({ arrayBuffer })

        const text = result.value

        if (!text || text.trim().length < 10) {
            throw new Error('DOCX dosyası boş görünüyor veya okunamıyor')
        }

        return {
            text: text.trim(),
            metadata: {
                type: 'docx',
                fileName: file.name,
                size: file.size,
                characterCount: text.length,
                messages: result.messages // Any warnings from mammoth
            }
        }
    } catch (error) {
        console.error('DOCX processing error:', error)
        throw new Error(`DOCX dosyası işlenirken hata oluştu: ${error.message}`)
    }
}

/**
 * Main file processing function - auto-detects type and processes accordingly
 * @param {File} file - File to process
 * @returns {Promise<{text: string, metadata: object}>}
 */
export async function processFile(file) {
    try {
        // Validate file first
        validateFile(file)

        const fileType = detectFileType(file)

        console.log(`[FileProcessor] Processing ${fileType.toUpperCase()} file: ${file.name}`)

        // Route to appropriate processor
        switch (fileType) {
            case 'pdf': {
                const { text, pageCount, pages } = await extractTextFromPDF(file)
                return {
                    text,
                    metadata: {
                        type: 'pdf',
                        fileName: file.name,
                        size: file.size,
                        pageCount,
                        pages
                    }
                }
            }



            case 'docx':
                return await processDocxFile(file)

            default:
                throw new Error('Desteklenmeyen dosya formatı')
        }
    } catch (error) {
        console.error('[FileProcessor] Error:', error)
        throw error
    }
}

/**
 * Get list of supported file extensions for UI display
 * @returns {string[]} - Array of file extensions
 */
export function getSupportedExtensions() {
    return Object.values(SUPPORTED_TYPES)
        .flatMap(config => config.extensions)
}

/**
 * Get accept attribute value for file input
 * @returns {string} - Comma-separated list of extensions
 */
export function getAcceptAttribute() {
    return getSupportedExtensions().join(',')
}

/**
 * Get file type icon/label for display
 * @param {string} fileName - File name
 * @returns {string} - File type label (PDF, DOCX)
 */
export function getFileTypeLabel(fileName) {
    const type = detectFileType({ name: fileName, type: '' })
    return type ? type.toUpperCase() : 'FILE'
}
