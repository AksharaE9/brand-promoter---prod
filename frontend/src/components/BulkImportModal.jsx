import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const BulkImportModal = ({ isOpen, onClose, onImportComplete, title, endpoint, templateHeaders }) => {
    const [file, setFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const handleFileChange = (e) => {
        const selected = e.target.files[0];
        if (selected) {
            setFile(selected);
            setError('');
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setIsUploading(true);
        setError('');
        setResult(null);

        const formData = new FormData();
        formData.append('file', file);

        const token = localStorage.getItem('ats_token');
        const apiBaseUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

        try {
            const response = await fetch(`${apiBaseUrl}/sales${endpoint}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData,
            });

            const resData = await response.json();
            if (!response.ok) throw new Error(resData.message || 'Import failed');

            setResult(resData.data);
            if (onImportComplete) onImportComplete();
        } catch (err) {
            setError(err.message || 'An error occurred during import.');
        } finally {
            setIsUploading(false);
        }
    };

    const downloadTemplate = () => {
        const csvContent = templateHeaders.join(',') + '\n';
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_${title.toLowerCase().replace(' ', '_')}.csv`;
        a.click();
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
                >
                    <div className="p-8">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-2xl font-bold text-[#121c3e] font-[Manrope]">{title}</h3>
                            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                                <span className="material-symbols-outlined text-gray-500">close</span>
                            </button>
                        </div>

                        {!result ? (
                            <div className="space-y-6">
                                <div className="p-8 border-2 border-dashed border-[#dce4ee] rounded-3xl bg-[#f8fbff] text-center group hover:border-[#1f52cc] transition-colors">
                                    <span className="material-symbols-outlined text-6xl text-[#1f52cc] mb-4">upload_file</span>
                                    <div className="text-[#121c3e] font-semibold mb-2">
                                        {file ? file.name : 'Select your Excel or CSV file'}
                                    </div>
                                    <div className="text-sm text-[#5d6784]">Support .xlsx, .xls, .csv</div>
                                    <input
                                        type="file"
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        onChange={handleFileChange}
                                        accept=".xlsx, .xls, .csv"
                                    />
                                </div>

                                <div className="flex items-center justify-between p-4 bg-[#f3f6f9] rounded-2xl">
                                    <div className="flex items-center gap-3">
                                        <span className="material-symbols-outlined text-[#1f52cc]">info</span>
                                        <span className="text-sm font-medium text-[#121c3e]">Download sample template</span>
                                    </div>
                                    <button
                                        onClick={downloadTemplate}
                                        className="text-[#1f52cc] text-sm font-bold hover:underline"
                                    >
                                        Template.csv
                                    </button>
                                </div>

                                {error && (
                                    <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm">
                                        {error}
                                    </div>
                                )}

                                <button
                                    onClick={handleUpload}
                                    disabled={!file || isUploading}
                                    className="os-btn-primary w-full h-14 text-lg flex items-center justify-center gap-2"
                                >
                                    {isUploading ? (
                                        <>
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-symbols-outlined">dataset_linked</span>
                                            Start Bulk Import
                                        </>
                                    )}
                                </button>
                            </div>
                        ) : (
                            <div className="text-center space-y-6">
                                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                                    <span className="material-symbols-outlined text-5xl">check_circle</span>
                                </div>
                                <div>
                                    <h4 className="text-xl font-bold text-[#121c3e]">Import Complete</h4>
                                    <p className="mt-2 text-[#5d6784]">
                                        We've successfully processed your file.
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-green-50 rounded-2xl border border-green-100">
                                        <div className="text-2xl font-bold text-green-700">{result.imported}</div>
                                        <div className="text-xs font-semibold text-green-600 uppercase tracking-wider">Imported</div>
                                    </div>
                                    <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100">
                                        <div className="text-2xl font-bold text-orange-700">{result.skipped}</div>
                                        <div className="text-xs font-semibold text-orange-600 uppercase tracking-wider">Skipped/Errors</div>
                                    </div>
                                </div>

                                {result.errors?.length > 0 && (
                                    <div className="max-h-40 overflow-y-auto text-left space-y-2 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                        <div className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Error Details</div>
                                        {result.errors.slice(0, 10).map((err, i) => (
                                            <div key={i} className="text-xs text-red-500 bg-white p-2 rounded-lg border border-red-50">
                                                <span className="font-bold">{err.row}:</span> {err.error}
                                            </div>
                                        ))}
                                        {result.errors.length > 10 && (
                                            <div className="text-[10px] text-center text-gray-400">...and {result.errors.length - 10} more</div>
                                        )}
                                    </div>
                                )}

                                <button
                                    onClick={onClose}
                                    className="os-btn-primary w-full h-12"
                                >
                                    Close & Refresh
                                </button>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default BulkImportModal;
