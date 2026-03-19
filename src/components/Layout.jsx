export default function Layout({ children }) {
    return (
        <div className="h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-gray-100 flex flex-col overflow-hidden">
            {children}
        </div>
    )
}
