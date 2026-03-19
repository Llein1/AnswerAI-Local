import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker - use local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

/**
 * Extract text content from a PDF file
 * @param {File} file - PDF file object
 * @returns {Promise<string>} - Extracted text
 */
export async function extractTextFromPDF(file) {
    try {
        // Validate file
        validatePDFFile(file)

        // Read file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer()

        // Load PDF document
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

        const pages = []
        let fullText = ''

        // Extract text from each page
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum)
            const textContent = await page.getTextContent()

            const pageText = textContent.items
                .map(item => item.str)
                .join(' ')

            const cleanedPageText = cleanText(pageText)

            pages.push({
                pageNumber: pageNum,
                text: cleanedPageText
            })

            fullText += cleanedPageText + '\n\n'
        }

        if (!fullText || fullText.trim().length < 10) {
            throw new Error('PDF boş veya okunamıyor görünüyor')
        }

        return {
            text: fullText.trim(),
            pageCount: pdf.numPages,
            pages: pages  // Array of {pageNumber, text}
        }
    } catch (error) {
        console.error('PDF extraction error:', error)
        throw new Error(`PDF çıkarılırken hata oluştu: ${error.message}`)
    }
}

/**
 * Validate PDF file before processing
 * @param {File} file - File to validate
 * @throws {Error} - If validation fails
 */
export function validatePDFFile(file) {
    const maxSize = 10 * 1024 * 1024 // 10MB

    if (!file) {
        throw new Error('Dosya bulunamadı')
    }

    if (file.type !== 'application/pdf') {
        throw new Error('Yalnızca PDF dosyaları desteklenmektedir')
    }

    if (file.size > maxSize) {
        throw new Error('Dosya boyutu 10MB\'den küçük olmalıdır')
    }

    if (file.size === 0) {
        throw new Error('Dosya boş')
    }

    return true
}

/**
 * Clean and normalize extracted text
 * @param {string} text - Raw text
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
    return text
        // Remove excessive whitespace
        .replace(/\s+/g, ' ')
        // Remove null bytes
        .replace(/\0/g, '')
        // Normalize line breaks
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        // Trim
        .trim()
}
