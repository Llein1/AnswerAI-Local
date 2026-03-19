import Toast from './Toast'

export default function ToastContainer({ toasts, onClose }) {
    if (toasts.length === 0) return null

    return (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-3 pointer-events-none">
            <div className="pointer-events-auto flex flex-col gap-3">
                {toasts.map((toast) => (
                    <Toast
                        key={toast.id}
                        {...toast}
                        onClose={onClose}
                    />
                ))}
            </div>
        </div>
    )
}
