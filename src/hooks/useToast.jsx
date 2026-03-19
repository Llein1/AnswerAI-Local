import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])

    const addToast = useCallback((toast) => {
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 9)
        setToasts((prev) => [...prev, { ...toast, id }])
        return id
    }, [])

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, [])

    const showError = useCallback((message, title = 'Hata') => {
        return addToast({ type: 'error', title, message, duration: 5000 })
    }, [addToast])

    const showSuccess = useCallback((message, title = 'Başarılı') => {
        return addToast({ type: 'success', title, message, duration: 3000 })
    }, [addToast])

    const showWarning = useCallback((message, title = 'Uyarı') => {
        return addToast({ type: 'warning', title, message, duration: 4000 })
    }, [addToast])

    const showInfo = useCallback((message, title = 'Bilgi') => {
        return addToast({ type: 'info', title, message, duration: 3000 })
    }, [addToast])

    const value = {
        toasts,
        addToast,
        removeToast,
        showError,
        showSuccess,
        showWarning,
        showInfo
    }

    return (
        <ToastContext.Provider value={value}>
            {children}
        </ToastContext.Provider>
    )
}

export function useToast() {
    const context = useContext(ToastContext)
    if (!context) {
        throw new Error('useToast hook ToastProvider içinde kullanılmalıdır')
    }
    return context
}
