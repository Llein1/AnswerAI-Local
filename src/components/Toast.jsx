import { useEffect } from 'react'
import { X, AlertCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react'

const TOAST_TYPES = {
    error: {
        icon: AlertCircle,
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/50',
        textColor: 'text-red-400',
        iconColor: 'text-red-400'
    },
    success: {
        icon: CheckCircle,
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/50',
        textColor: 'text-green-400',
        iconColor: 'text-green-400'
    },
    warning: {
        icon: AlertTriangle,
        bgColor: 'bg-yellow-500/10',
        borderColor: 'border-yellow-500/50',
        textColor: 'text-yellow-400',
        iconColor: 'text-yellow-400'
    },
    info: {
        icon: Info,
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/50',
        textColor: 'text-blue-400',
        iconColor: 'text-blue-400'
    }
}

export default function Toast({ id, type = 'info', title, message, duration = 5000, onClose }) {
    const config = TOAST_TYPES[type] || TOAST_TYPES.info
    const Icon = config.icon

    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                onClose(id)
            }, duration)

            return () => clearTimeout(timer)
        }
    }, [id, duration, onClose])

    return (
        <div
            className={`${config.bgColor} ${config.borderColor} border rounded-lg p-4 shadow-lg 
                        flex items-start gap-3 min-w-[320px] max-w-md animate-slideInDown`}
        >
            <Icon className={`w-5 h-5 ${config.iconColor} flex-shrink-0 mt-0.5`} />

            <div className="flex-1 min-w-0">
                {title && (
                    <p className={`${config.textColor} font-medium mb-1`}>
                        {title}
                    </p>
                )}
                <p className={`${config.textColor} text-sm opacity-90`}>
                    {message}
                </p>
            </div>

            <button
                onClick={() => onClose(id)}
                className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors"
                aria-label="Kapat"
            >
                <X className={`w-4 h-4 ${config.textColor}`} />
            </button>
        </div>
    )
}
